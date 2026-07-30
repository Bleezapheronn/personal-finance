import Database from "better-sqlite3";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import { controlPathForProfile } from "./lib/authorityOpsControl.js";
import { AUTHORITY_REQUIRED_CAPABILITY_NAMES } from "./lib/authorityOpsCapabilities.js";
import { currentAuthorityBuildReceipt } from "./lib/authorityOpsBuild.js";
import { AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, readAuthorityOpsProfile, writeAuthorityOpsProfileAtomic, type AuthorityOpsProfile } from "./lib/authorityOpsProfile.js";
import { writeJsonAtomic } from "./lib/authorityOpsSession.js";
import { prepareSqliteAuthorityCutover, readSqliteAuthorityManifestDescriptor } from "./lib/sqliteAuthorityCutover.js";
import { readCanonicalAuthorityLogicalFingerprintAtPath, readSqliteLogicalVerificationAtPath } from "./lib/sqliteLogicalVerification.js";

const port = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const a = s.address(); s.close(() => typeof a === "object" && a ? resolve(a.port) : reject(new Error("port_unavailable"))); }); });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (stage: string, ready: () => Promise<boolean>, timeoutMs = 30_000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (await ready()) return; await delay(100); } throw new Error(`${stage}_timeout`); };
const request = (port: number, method: string, pathname: string, token?: string, body?: unknown) => new Promise<{ status: number; body: unknown }>((resolve, reject) => { const payload = body === undefined ? undefined : JSON.stringify(body); const r = http.request({ host: "127.0.0.1", port, path: pathname, method, timeout: 3_000, headers: { ...(token ? { "x-personal-finance-token": token } : {}), ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (response) => { let data = ""; response.on("data", (chunk) => { data += chunk; }); response.on("end", () => { try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) }); } catch { reject(new Error("response_invalid")); } }); }); r.on("error", reject); r.on("timeout", () => r.destroy(new Error("request_timeout"))); if (payload) r.write(payload); r.end(); });
const responseStatus = (port: number, pathname: string) => new Promise<number>((resolve) => { const r = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 3_000 }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }); r.on("error", () => resolve(0)); r.on("timeout", () => { r.destroy(); resolve(0); }); });
const waitExit = (child: ReturnType<typeof spawn>, stage: string, timeoutMs = 30_000) => {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${stage}_timeout`)), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    child.once("error", () => { clearTimeout(timer); reject(new Error(`${stage}_spawn_failed`)); });
  });
};
const terminateOwnedChild = async (child: ReturnType<typeof spawn>, stage: string) => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  try { await waitExit(child, `${stage}_terminate`, 2_000); }
  catch { child.kill("SIGKILL"); await waitExit(child, `${stage}_force_terminate`, 2_000).catch(() => undefined); }
};
const count = (databasePath: string) => { const db = new Database(databasePath, { readonly: true }); try { return Number((db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as { count: number }).count); } finally { db.close(); } };
const tableCount = (databasePath: string, table: "budgets" | "budgetSnapshots" | "transactions") => { const db = new Database(databasePath, { readonly: true }); try { return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); } finally { db.close(); } };
const sha256 = (filePath: string) => createHash("sha256").update(readFileSync(filePath)).digest("hex");
const buildCurrentServerArtifacts = () => {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync(
    process.execPath,
    [path.join(serverRoot, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(serverRoot, "tsconfig.json")],
    { cwd: serverRoot, stdio: "inherit", windowsHide: true },
  );
};
const zeroMutationChange = process.argv.includes("--zero-mutation-change");
const routeFamilies = process.argv.includes("--route-families");
const transactionDeleteProcess = process.argv.includes("--transaction-delete");
const recipientLifecycleProcess = process.argv.includes("--recipient-lifecycle");
const accountLifecycleProcess = process.argv.includes("--account-lifecycle");
const categoryLifecycleProcess = process.argv.includes("--category-lifecycle");
const bucketLifecycleProcess = process.argv.includes("--bucket-lifecycle");
const recipientActiveSmsProcess = process.argv.includes("--recipient-active-sms");
const transferLifecycleProcess = process.argv.includes("--transfer-lifecycle");
const budgetDefinitionProcess = process.argv.includes("--budget-definition");
const occurrenceCreateDeleteProcess = process.argv.includes("--occurrence-create-delete");
const occurrenceChangeLinkProcess = process.argv.includes("--occurrence-change-link");
const occurrenceUnlinkProcess = process.argv.includes("--occurrence-unlink");
const occurrenceCreateAndLinkProcess = process.argv.includes("--occurrence-create-and-link");
const snapshotGenerationProcess = process.argv.includes("--snapshot-generation");
const budgetFromTransactionProcess = process.argv.includes("--budget-from-transaction");
const occurrenceLinkProcess = process.argv.includes("--occurrence-link");
const writeCount = zeroMutationChange ? 0 : routeFamilies ? 10 : transactionDeleteProcess ? 6 : recipientLifecycleProcess ? 10 : accountLifecycleProcess ? 12 : categoryLifecycleProcess ? 12 : bucketLifecycleProcess ? 13 : recipientActiveSmsProcess ? 11 : transferLifecycleProcess ? 7 : budgetDefinitionProcess ? 7 : occurrenceCreateDeleteProcess ? 7 : snapshotGenerationProcess ? 6 : budgetFromTransactionProcess ? 6 : occurrenceCreateAndLinkProcess ? 7 : occurrenceUnlinkProcess ? 11 : occurrenceChangeLinkProcess ? 10 : occurrenceLinkProcess ? 8 : process.argv.includes("--three") ? 3 : 1;
const crashAfterWrite = process.argv.includes("--crash");
const receiptGate = process.argv.includes("--receipt-gate");
const missingReceipt = process.argv.includes("--missing-receipt");
const malformedReceipt = process.argv.includes("--malformed-receipt");
const fingerprintFault = process.argv.includes("--fingerprint-fault");
const quiescenceFault = process.argv.includes("--quiescence-fault");
const checkpointBackupFault = process.argv.includes("--checkpoint-backup-fault");
const checkpointVerificationFault = process.argv.includes("--checkpoint-verification-fault");
const profileRotationFault = process.argv.includes("--profile-rotation-fault");
const acceptanceFence = process.argv.includes("--acceptance-fence");
const viteChildExit = process.argv.includes("--vite-child-exit");
const postSealViteExit = process.argv.includes("--post-seal-vite-exit");
const drainSuccess = process.argv.includes("--drain-success");
const drainTimeout = process.argv.includes("--drain-timeout");
const receiptWithoutExit = process.argv.includes("--receipt-without-exit");
const shutdownRequestRace = process.argv.includes("--shutdown-request-race");
const shutdownRequestRaceFailure = process.argv.includes("--shutdown-request-race-failure");
const finalCleanupControlCloseFailure = process.argv.includes("--final-cleanup-control-close-failure");
const finalCleanupDescriptorFailure = process.argv.includes("--final-cleanup-descriptor-failure");
const finalCleanupLockReleaseFailure = process.argv.includes("--final-cleanup-lock-release-failure");
const finalCleanupRaceDescriptorFailure = process.argv.includes("--final-cleanup-race-descriptor-failure");
const mixedBeforeFirst = process.argv.includes("--mixed-before-first");
const mixedAfterApproved = process.argv.includes("--mixed-after-approved");
const mixedBetweenApproved = process.argv.includes("--mixed-between-approved");
const mixedConcurrent = process.argv.includes("--mixed-concurrent");
const noOpRollback = process.argv.includes("--no-op-rollback");
const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-one-write-")); const profilePath = path.join(root, "authority-profile.json"); const active = path.join(root, "runtime", "active.sqlite"); const backups = path.join(root, "backups"); const tokenPath = path.join(root, "token"); const source = path.join(root, "source.json"); const initialManifest = path.join(backups, "cutover.manifest.json");
let supervisor: ReturnType<typeof spawn> | undefined;
let unrelated: ReturnType<typeof spawn> | undefined;
let supervisorDiagnostics = "";
let cleanRaceDiagnosticAfterFinalCleanup = false;
let gatePending = receiptGate;
let acceptanceFencePending = acceptanceFence;
let acceptancePaths:
  | { active: string; safety: string; candidate: string }
  | undefined;
let acceptanceFingerprints:
  | Record<string, { logical: string; database: string; journalMode: string }>
  | undefined;
let occurrenceLinkExpected: { snapshotId: number | null; previousSnapshotId?: number; transactionId: number; budgetId: number; accountId: number; categoryId: number; recipientId: number; amount: number; date: string; description: string } | undefined;
try {
  mkdirSync(path.dirname(active), { recursive: true }); mkdirSync(backups, { recursive: true });
  const db = new Database(active); try { db.exec(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"), "utf8")); } finally { db.close(); }
  const tables = Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, []])); writeFileSync(source, JSON.stringify({ tables, integrity: { counts: Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, 0])) } }), "utf8"); const token = "disposable-test-token"; writeFileSync(tokenPath, `${token}\n`, "utf8");
  await prepareSqliteAuthorityCutover({ sourceBackupPath: source, candidatePath: active, backupOutputPath: path.join(backups, "cutover.sqlite"), manifestPath: initialManifest, asOf: new Date(2026, 6, 27) });
  const apiPort = await port(); let vitePort = await port(); while (apiPort === vitePort) vitePort = await port();
  const profile: AuthorityOpsProfile = { schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, mode: "authoritative", activeDatabasePath: active, authorityManifestPath: initialManifest, sourceBackupPath: source, tokenFilePath: tokenPath, backupDirectory: backups, apiHost: "127.0.0.1", apiPort, viteHost: "127.0.0.1", vitePort, enabledWriteCapabilities: [...new Set([...AUTHORITY_REQUIRED_CAPABILITY_NAMES, ...(routeFamilies ? ["budgetLifecycleWrites" as const] : []), ...(transactionDeleteProcess ? ["transactionDeleteWrites" as const] : []), ...((recipientLifecycleProcess || accountLifecycleProcess || categoryLifecycleProcess || bucketLifecycleProcess) ? ["recipientDeleteMergeWrites" as const] : []), ...(accountLifecycleProcess || recipientActiveSmsProcess ? ["accountDeleteMergeWrites" as const] : []), ...(categoryLifecycleProcess ? ["categoryDeleteMergeWrites" as const] : []), ...(bucketLifecycleProcess ? ["bucketDeleteMergeWrites" as const] : []), ...(budgetDefinitionProcess ? ["budgetDeleteWrites" as const] : []), ...((occurrenceCreateDeleteProcess || occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess || occurrenceCreateAndLinkProcess || budgetFromTransactionProcess) ? ["budgetSnapshotOccurrenceWrites" as const] : [])])] };
  writeAuthorityOpsProfileAtomic(profilePath, profile);
  // The supervisor starts server/dist. Never mark source inputs current until
  // those compiled artifacts have been rebuilt successfully in this process.
  buildCurrentServerArtifacts();
  writeJsonAtomic(path.join(root, ".authority-ops-runtime", "build-receipt.json"), currentAuthorityBuildReceipt());
  const beforeSequence = readSqliteAuthorityManifestDescriptor(initialManifest).checkpointSequence; const beforeRecipients = count(active); const beforeCheckpoints = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-")).length; const sourceBefore = sha256(source); const originalProfile = readFileSync(profilePath, "utf8");
  const src = path.dirname(fileURLToPath(import.meta.url)); const tsx = path.join(src, "..", "node_modules", "tsx", "dist", "cli.mjs"); const cli = path.join(src, "authorityOps.ts"); const faultRunner = path.join(src, "..", "test-support", "authorityOpsFaultRunner.ts");
  const externalWriter = path.join(src, "..", "test-support", "authorityOpsExternalWriter.ts");
  const externalWrite = async (name: string) => {
    const child = spawn(process.execPath, [tsx, externalWriter, "--sqlite", active, "--name", name], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(child, "external_writer_exit") !== 0) throw new Error("external_writer_failed");
  };
  const gatePath = path.join(root, ".authority-ops-runtime", "receipt-gate");
  const viteChildPath = path.join(root, ".authority-ops-runtime", "vite-child.json");
  const start = () => { const useGate = gatePending; gatePending = false; const useAcceptanceFence = acceptanceFencePending; acceptanceFencePending = acceptanceFencePending; const faultScenario = finalCleanupRaceDescriptorFailure ? "shutdown-request-race-final-cleanup-descriptor-failure" : finalCleanupControlCloseFailure ? "final-cleanup-control-close-failure" : finalCleanupDescriptorFailure ? "final-cleanup-descriptor-failure" : finalCleanupLockReleaseFailure ? "final-cleanup-lock-release-failure" : quiescenceFault ? "sqlite-quiescence-failure" : checkpointBackupFault ? "checkpoint-backup-failure" : checkpointVerificationFault ? "checkpoint-verification-failure" : profileRotationFault ? "profile-rotation-failure" : useAcceptanceFence ? "checkpoint-acceptance-fence" : postSealViteExit ? "post-seal-vite-exit" : receiptWithoutExit ? "receipt-without-exit" : shutdownRequestRaceFailure ? "shutdown-request-race-failure" : shutdownRequestRace ? "shutdown-request-race" : drainTimeout ? "drain-timeout" : drainSuccess ? "drain-success" : mixedConcurrent ? "mutation-lock-hold" : noOpRollback ? "rollback-route" : viteChildExit ? "vite-exit-observer" : undefined; const args = crashAfterWrite ? [tsx, faultRunner, "--profile", profilePath, "--scenario", "api-crash"] : faultScenario ? [tsx, faultRunner, "--profile", profilePath, "--scenario", faultScenario, ...((drainTimeout || drainSuccess || mixedConcurrent || useAcceptanceFence || postSealViteExit || viteChildExit) ? ["--gate", drainTimeout || drainSuccess || mixedConcurrent || useAcceptanceFence || postSealViteExit ? gatePath : viteChildPath] : [])] : useGate ? [tsx, faultRunner, "--profile", profilePath, "--scenario", "receipt-gate", "--gate", gatePath] : [tsx, cli, "--profile", profilePath, "run"]; supervisor = spawn(process.execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }); const collect = (chunk: Buffer) => { const output = chunk.toString("utf8"); supervisorDiagnostics += output.slice(0, 512); if (output.includes("api_shutdown_request_failed_clean_shutdown_verified")) cleanRaceDiagnosticAfterFinalCleanup = !existsSync(controlPathForProfile(profilePath)) && !existsSync(`${profilePath}.lock`); }; supervisor.stdout?.on("data", collect); supervisor.stderr?.on("data", collect); return supervisor; };
  start();
  try {
    await wait("supervisor_readiness", async () => existsSync(controlPathForProfile(profilePath)) && (await request(apiPort, "GET", "/health").catch(() => ({ status: 0 }))).status === 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "supervisor_readiness_failed";
    throw new Error(`${code}:${supervisorDiagnostics || "no_supervisor_diagnostics"}`);
  }
  if (viteChildExit) await wait("vite_child_readiness", async () => (await responseStatus(vitePort, "/")) === 200 && existsSync(viteChildPath));
  if (snapshotGenerationProcess) {
    const write = async (p: string,b: Record<string,unknown>) => { const r=await request(apiPort,"POST",p,token,b); const id=(r.body as {targetId?:unknown})?.targetId; if(r.status!==200||typeof id!=="number")throw new Error("snapshot_generation_setup"); return id; }; const bucketId=await write("/prototype/repositories/buckets/write/create",{name:"generation-bucket",description:null,dryRunReviewed:true,confirmation:"create bucket in disposable sqlite"}); const categoryId=await write("/prototype/repositories/categories/write/create",{name:"generation-category",bucketId,description:null,dryRunReviewed:true,confirmation:"create category in disposable sqlite"}); const accountId=await write("/prototype/repositories/accounts/write/create",{name:"generation-account",currency:"KES",isCredit:false,creditLimit:null,dryRunReviewed:true,confirmation:"create account in disposable sqlite"}); const recipientId=await write("/prototype/repositories/recipients/write/create",{name:"generation-recipient",aliases:null,email:null,phone:null,tillNumber:null,paybill:null,accountNumber:null,description:null,dryRunReviewed:true,confirmation:"create recipient in disposable sqlite"}); const budget=await request(apiPort,"POST","/prototype/repositories/budgets/write/create",token,{description:"generation budget",categoryId,accountId,recipientId,amount:-50,transactionCost:null,frequency:"monthly",frequencyDetails:{dayOfMonth:15},isGoal:false,isFlexible:false,goalPercentage:null,goalDirection:null,remainingCyclesTotal:null,dueDate:"2026-08-15T00:00:00.000Z",dryRunReviewed:true,confirmation:"create budget definition in disposable sqlite"}); const budgetId=(budget.body as {targetId?:unknown})?.targetId; if(budget.status!==200||typeof budgetId!=="number")throw new Error("snapshot_generation_budget"); const asOf="2026-09-15"; const dry=await request(apiPort,"POST","/prototype/repositories/budget-snapshots/lifecycle/dry-run/generate",token,{asOf}); if(dry.status!==200)throw new Error("snapshot_generation_dry"); const generated=await request(apiPort,"POST","/prototype/repositories/budget-snapshots/lifecycle/write/generate",token,{asOf,dryRunReviewed:true,confirmation:"generate missing budget snapshots in disposable sqlite"}); const generation=generated.body as {rowsInserted?:unknown;eligibleBudgetCount?:unknown;proposedSnapshotCount?:unknown;activeCoverageThrough?:unknown}; if(generated.status!==200||generation.rowsInserted!==14||generation.eligibleBudgetCount!==1||generation.proposedSnapshotCount!==14||generation.activeCoverageThrough!=="2027-09-15"||tableCount(active,"budgetSnapshots")!==14)throw new Error("snapshot_generation_write"); const replay=await request(apiPort,"POST","/prototype/repositories/budget-snapshots/lifecycle/write/generate",token,{asOf,dryRunReviewed:true,confirmation:"generate missing budget snapshots in disposable sqlite"}); if(replay.status!==200||(replay.body as {rowsInserted?:unknown}).rowsInserted!==0||tableCount(active,"budgetSnapshots")!==14)throw new Error("snapshot_generation_replay");
  } else if (budgetFromTransactionProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => { const response = await request(apiPort, "POST", pathname, token, body); const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined; if (response.status !== 200 || typeof id !== "number") throw new Error(`budget_from_transaction_setup_failed_${pathname.replaceAll("/", "_")}`); return id; };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "budget-from-transaction-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "budget-from-transaction-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "budget-from-transaction-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "budget-from-transaction-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const amount = -125; const transactionCost = -3; const date = "2026-10-15T12:00:00.000Z"; const description = "budget from transaction source";
    const transactionId = await write("/prototype/repositories/transactions/write/create", { classification: "expense", date, amount, transactionCost, categoryId, accountId, recipientId, description, dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    const definition = { description: "budget from transaction definition", categoryId, accountId, recipientId, amount, transactionCost, frequency: "monthly", frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false, goalPercentage: null, goalDirection: null, remainingCyclesTotal: null, dueDate: "2026-10-15T00:00:00.000Z" };
    const occurrenceDate = "2026-10-15";
    const beforeDryRun = new Database(active, { readonly: true }); try { if (tableCount(active, "budgets") !== 0 || tableCount(active, "budgetSnapshots") !== 0) throw new Error("budget_from_transaction_precondition_invalid"); const row = beforeDryRun.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate, isTransfer, accountId, categoryId, recipientId, amount, transactionCost, date, description FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number | null; budgetId: number | null; occurrenceDate: string | null; isTransfer: number; accountId: number; categoryId: number; recipientId: number; amount: number; transactionCost: number | null; date: string; description: string } | undefined; if (!row || row.budgetSnapshotId !== null || row.budgetId !== null || row.occurrenceDate !== null || row.isTransfer !== 0 || row.accountId !== accountId || row.categoryId !== categoryId || row.recipientId !== recipientId || row.amount !== amount || row.transactionCost !== transactionCost || row.date !== date || row.description !== description) throw new Error("budget_from_transaction_source_invalid"); } finally { beforeDryRun.close(); }
    const dry = await request(apiPort, "POST", "/prototype/repositories/budgets/from-transaction/dry-run", token, { definition, transactionId, occurrenceDate }); const dryBody = dry.body as { ok?: unknown; wouldMutate?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgets?: unknown; budgetSnapshots?: unknown; transactions?: unknown; total?: unknown }; planFingerprint?: unknown }; const fingerprint = dryBody.planFingerprint;
    if (dry.status !== 200 || dryBody.ok !== true || dryBody.wouldMutate !== true || dryBody.sqliteMutated !== false || dryBody.rowsChanged?.budgets !== 0 || dryBody.rowsChanged?.budgetSnapshots !== 0 || dryBody.rowsChanged?.transactions !== 0 || dryBody.rowsChanged?.total !== 0 || typeof fingerprint !== "string") throw new Error("budget_from_transaction_dry_run_invalid");
    if (tableCount(active, "budgets") !== 0 || tableCount(active, "budgetSnapshots") !== 0) throw new Error("budget_from_transaction_dry_run_mutated");
    const committed = await request(apiPort, "POST", "/prototype/repositories/budgets/from-transaction/write", token, { definition, transactionId, occurrenceDate, dryRunReviewed: true, confirmation: "create one budget and occurrence from one transaction in sqlite", expectedPlanFingerprint: fingerprint }); const committedBody = committed.body as { ok?: unknown; sqliteMutated?: unknown; targetBudgetId?: unknown; targetTransactionId?: unknown; occurrenceDate?: unknown; rowsChanged?: { budgets?: unknown; budgetSnapshots?: unknown; transactions?: unknown; total?: unknown } }; const budgetId = committedBody.targetBudgetId;
    if (committed.status !== 200 || committedBody.ok !== true || committedBody.sqliteMutated !== true || typeof budgetId !== "number" || committedBody.targetTransactionId !== transactionId || committedBody.occurrenceDate !== occurrenceDate || committedBody.rowsChanged?.budgets !== 1 || committedBody.rowsChanged?.budgetSnapshots !== 1 || committedBody.rowsChanged?.transactions !== 1 || committedBody.rowsChanged?.total !== 3) throw new Error("budget_from_transaction_write_invalid");
    const replay = await request(apiPort, "POST", "/prototype/repositories/budgets/from-transaction/write", token, { definition, transactionId, occurrenceDate, dryRunReviewed: true, confirmation: "create one budget and occurrence from one transaction in sqlite", expectedPlanFingerprint: fingerprint });
    if (replay.status !== 409 || (replay.body as { code?: unknown }).code !== "transaction_already_has_budget_linkage" || tableCount(active, "budgets") !== 1 || tableCount(active, "budgetSnapshots") !== 1) throw new Error("budget_from_transaction_replay_not_rejected");
    const state = new Database(active, { readonly: true }); try { const snapshot = state.prepare("SELECT id, budgetId, occurrenceDate FROM budgetSnapshots WHERE budgetId = ?").get(budgetId) as { id: number; budgetId: number; occurrenceDate: string } | undefined; const row = state.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate, isTransfer, accountId, categoryId, recipientId, amount, transactionCost, date, description FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number; budgetId: number; occurrenceDate: string; isTransfer: number; accountId: number; categoryId: number; recipientId: number; amount: number; transactionCost: number | null; date: string; description: string } | undefined; if (!snapshot) throw new Error("budget_from_transaction_state_invalid_snapshot_missing"); if (!row) throw new Error("budget_from_transaction_state_invalid_transaction_missing"); const stateIssue = row.budgetSnapshotId !== snapshot.id ? "snapshot_link" : row.budgetId !== budgetId ? "budget_link" : row.occurrenceDate !== snapshot.occurrenceDate ? "occurrence_link" : row.isTransfer !== 0 ? "transfer" : row.accountId !== accountId ? "account" : row.categoryId !== categoryId ? "category" : row.recipientId !== recipientId ? "recipient" : row.amount !== amount ? "amount" : row.transactionCost !== transactionCost ? "transaction_cost" : row.date !== date ? "date" : row.description !== description ? "description" : undefined; if (stateIssue) throw new Error(`budget_from_transaction_state_invalid_${stateIssue}`); occurrenceLinkExpected = { snapshotId: snapshot.id, transactionId, budgetId, accountId, categoryId, recipientId, amount, date, description }; } finally { state.close(); }
  } else if (occurrenceCreateAndLinkProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => { const response = await request(apiPort, "POST", pathname, token, body); const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined; if (response.status !== 200 || typeof id !== "number") throw new Error(`occurrence_create_and_link_setup_failed_${pathname.replaceAll("/", "_")}`); return id; };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "occurrence-create-link-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" }); const categoryId = await write("/prototype/repositories/categories/write/create", { name: "occurrence-create-link-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" }); const accountId = await write("/prototype/repositories/accounts/write/create", { name: "occurrence-create-link-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" }); const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "occurrence-create-link-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const budget = await request(apiPort, "POST", "/prototype/repositories/budgets/write/create", token, { description: "occurrence create and link budget", categoryId, accountId, recipientId, amount: -50, transactionCost: null, frequency: "monthly", frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false, goalPercentage: null, goalDirection: null, remainingCyclesTotal: null, dueDate: "2026-08-15T00:00:00.000Z", dryRunReviewed: true, confirmation: "create budget definition in disposable sqlite" }); const budgetId = (budget.body as { targetId?: unknown }).targetId; if (budget.status !== 200 || typeof budgetId !== "number") throw new Error("occurrence_create_and_link_budget_failed");
    const amount = -50; const date = "2026-11-15T12:00:00.000Z"; const description = "occurrence create and link transaction"; const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date, amount, transactionCost: null, categoryId, accountId, recipientId, description, dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" }); const transactionId = (transaction.body as { targetId?: unknown }).targetId; if (transaction.status !== 200 || typeof transactionId !== "number") throw new Error("occurrence_create_and_link_transaction_failed");
    const occurrenceDate = "2026-11-15"; const before = new Database(active, { readonly: true }); try { const snapshotCount = Number((before.prepare("SELECT COUNT(*) AS count FROM budgetSnapshots WHERE budgetId = ? AND substr(occurrenceDate, 1, 10) = ?").get(budgetId, occurrenceDate) as { count: number }).count); const row = before.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number | null; budgetId: number | null; occurrenceDate: string | null }; if (snapshotCount !== 0 || row.budgetSnapshotId !== null || row.budgetId !== null || row.occurrenceDate !== null) throw new Error("occurrence_create_and_link_start_invalid"); } finally { before.close(); }
    const dry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/createAndLink", token, { budgetId, occurrenceDate, transactionId }); const dryBody = dry.body as { ok?: unknown; wouldMutate?: unknown; sqliteMutated?: unknown; planFingerprint?: unknown; rowsChanged?: { total?: unknown } }; const fingerprint = dryBody.planFingerprint; if (dry.status !== 200 || dryBody.ok !== true || dryBody.wouldMutate !== true || dryBody.sqliteMutated !== false || dryBody.rowsChanged?.total !== 0 || typeof fingerprint !== "string") throw new Error("occurrence_create_and_link_dry_invalid");
    const created = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/createAndLink", token, { budgetId, occurrenceDate, transactionId, dryRunReviewed: true, confirmation: "create one budget occurrence and link one transaction in sqlite", expectedPlanFingerprint: fingerprint }); const createdBody = created.body as { ok?: unknown; sqliteMutated?: unknown; target?: { snapshotId?: unknown }; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown } }; const snapshotId = createdBody.target?.snapshotId; if (created.status !== 200 || createdBody.ok !== true || createdBody.sqliteMutated !== true || typeof snapshotId !== "number" || createdBody.rowsChanged?.budgetSnapshots !== 1 || createdBody.rowsChanged?.transactions !== 1 || createdBody.rowsChanged?.total !== 2) throw new Error("occurrence_create_and_link_write_invalid");
    const replay = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/createAndLink", token, { budgetId, occurrenceDate, transactionId, dryRunReviewed: true, confirmation: "create one budget occurrence and link one transaction in sqlite", expectedPlanFingerprint: fingerprint }); if (replay.status !== 409) throw new Error("occurrence_create_and_link_replay_not_rejected");
    const state = new Database(active, { readonly: true }); try { const row = state.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate, isTransfer, accountId, categoryId, recipientId, amount, transactionCost, date, description FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number; budgetId: number; occurrenceDate: string; isTransfer: number; accountId: number; categoryId: number; recipientId: number; amount: number; transactionCost: number | null; date: string; description: string }; const snapshot = state.prepare("SELECT id, budgetId, occurrenceDate FROM budgetSnapshots WHERE id = ?").get(snapshotId) as { id: number; budgetId: number; occurrenceDate: string } | undefined; if (!snapshot || row.budgetSnapshotId !== snapshotId || row.budgetId !== budgetId || row.occurrenceDate !== snapshot.occurrenceDate || row.isTransfer !== 0 || row.accountId !== accountId || row.categoryId !== categoryId || row.recipientId !== recipientId || row.amount !== amount || row.transactionCost !== null || row.date !== date || row.description !== description) throw new Error("occurrence_create_and_link_state_invalid"); } finally { state.close(); }
    occurrenceLinkExpected = { snapshotId, transactionId, budgetId, accountId, categoryId, recipientId, amount, date, description };
  } else if (occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => { const response = await request(apiPort, "POST", pathname, token, body); const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined; if (response.status !== 200 || typeof id !== "number") throw new Error(`occurrence_link_setup_failed_${pathname.replaceAll("/", "_")}`); return id; };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "occurrence-link-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "occurrence-link-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "occurrence-link-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "occurrence-link-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const budget = await request(apiPort, "POST", "/prototype/repositories/budgets/write/create", token, { description: "occurrence link budget", categoryId, accountId, recipientId, amount: -50, transactionCost: null, frequency: "monthly", frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false, goalPercentage: null, goalDirection: null, remainingCyclesTotal: null, dueDate: "2026-08-15T00:00:00.000Z", dryRunReviewed: true, confirmation: "create budget definition in disposable sqlite" });
    const budgetId = budget.body && typeof budget.body === "object" && !Array.isArray(budget.body) ? (budget.body as { targetId?: unknown }).targetId : undefined;
    if (budget.status !== 200 || typeof budgetId !== "number") throw new Error("occurrence_link_budget_create_failed");
    const occurrenceDate = "2026-09-15";
    const createDry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/create", token, { budgetId, occurrenceDate });
    const createFingerprint = createDry.body && typeof createDry.body === "object" && !Array.isArray(createDry.body) ? (createDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (createDry.status !== 200 || typeof createFingerprint !== "string") throw new Error("occurrence_link_create_dry_failed");
    const occurrence = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/create", token, { budgetId, occurrenceDate, dryRunReviewed: true, confirmation: "create one budget occurrence in sqlite", expectedPlanFingerprint: createFingerprint });
    const snapshotId = occurrence.body && typeof occurrence.body === "object" && !Array.isArray(occurrence.body) ? (occurrence.body as { target?: { snapshotId?: unknown } }).target?.snapshotId : undefined;
    if (occurrence.status !== 200 || typeof snapshotId !== "number") throw new Error("occurrence_link_create_failed");
    const amount = -50; const date = "2026-09-15T12:00:00.000Z"; const description = "occurrence link transaction";
    const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date, amount, transactionCost: null, categoryId, accountId, recipientId, description, dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    const transactionId = transaction.body && typeof transaction.body === "object" && !Array.isArray(transaction.body) ? (transaction.body as { targetId?: unknown }).targetId : undefined;
    if (transaction.status !== 200 || typeof transactionId !== "number") throw new Error("occurrence_link_transaction_create_failed");
    const beforeLink = new Database(active, { readonly: true }); try { const row = beforeLink.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number | null; budgetId: number | null; occurrenceDate: string | null } | undefined; if (!row || row.budgetSnapshotId !== null || row.budgetId !== null || row.occurrenceDate !== null) throw new Error("occurrence_link_transaction_not_unlinked"); } finally { beforeLink.close(); }
    const linkDry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/link", token, { snapshotId, transactionId });
    const linkDryBody = linkDry.body as { ok?: unknown; wouldMutate?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown }; planFingerprint?: unknown };
    const linkFingerprint = linkDryBody.planFingerprint;
    if (linkDry.status !== 200 || linkDryBody.ok !== true || linkDryBody.wouldMutate !== true || linkDryBody.sqliteMutated !== false || linkDryBody.rowsChanged?.budgetSnapshots !== 0 || linkDryBody.rowsChanged?.transactions !== 0 || linkDryBody.rowsChanged?.total !== 0 || typeof linkFingerprint !== "string") throw new Error("occurrence_link_dry_run_invalid");
    const linked = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/link", token, { snapshotId, transactionId, dryRunReviewed: true, confirmation: "link one transaction to one budget occurrence in sqlite", expectedPlanFingerprint: linkFingerprint });
    const linkedBody = linked.body as { ok?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown } };
    if (linked.status !== 200 || linkedBody.ok !== true || linkedBody.sqliteMutated !== true || linkedBody.rowsChanged?.budgetSnapshots !== 0 || linkedBody.rowsChanged?.transactions !== 1 || linkedBody.rowsChanged?.total !== 1) throw new Error("occurrence_link_write_invalid");
    const replay = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/link", token, { snapshotId, transactionId, dryRunReviewed: true, confirmation: "link one transaction to one budget occurrence in sqlite", expectedPlanFingerprint: linkFingerprint });
    if (replay.status !== 409 || (replay.body as { code?: unknown }).code !== "budget_snapshot_occurrence_plan_stale") throw new Error("occurrence_link_replay_not_rejected");
    let finalSnapshotId = snapshotId;
    if (occurrenceChangeLinkProcess || occurrenceUnlinkProcess) {
      const targetOccurrenceDate = "2026-10-15";
      const targetDry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/create", token, { budgetId, occurrenceDate: targetOccurrenceDate });
      const targetFingerprint = targetDry.body && typeof targetDry.body === "object" && !Array.isArray(targetDry.body) ? (targetDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
      if (targetDry.status !== 200 || typeof targetFingerprint !== "string") throw new Error("occurrence_change_link_target_create_dry_failed");
      const targetCreated = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/create", token, { budgetId, occurrenceDate: targetOccurrenceDate, dryRunReviewed: true, confirmation: "create one budget occurrence in sqlite", expectedPlanFingerprint: targetFingerprint });
      const targetSnapshotId = targetCreated.body && typeof targetCreated.body === "object" && !Array.isArray(targetCreated.body) ? (targetCreated.body as { target?: { snapshotId?: unknown } }).target?.snapshotId : undefined;
      if (targetCreated.status !== 200 || typeof targetSnapshotId !== "number" || targetSnapshotId === snapshotId) throw new Error("occurrence_change_link_target_create_failed");
      const moveDry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/changeLink", token, { snapshotId: targetSnapshotId, transactionId, expectedCurrentSnapshotId: snapshotId });
      const moveDryBody = moveDry.body as { ok?: unknown; wouldMutate?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown }; planFingerprint?: unknown };
      const moveFingerprint = moveDryBody.planFingerprint;
      if (moveDry.status !== 200 || moveDryBody.ok !== true || moveDryBody.wouldMutate !== true || moveDryBody.sqliteMutated !== false || moveDryBody.rowsChanged?.budgetSnapshots !== 0 || moveDryBody.rowsChanged?.transactions !== 0 || moveDryBody.rowsChanged?.total !== 0 || typeof moveFingerprint !== "string") throw new Error("occurrence_change_link_dry_run_invalid");
      const moved = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/changeLink", token, { snapshotId: targetSnapshotId, transactionId, expectedCurrentSnapshotId: snapshotId, dryRunReviewed: true, confirmation: "change one transaction budget occurrence link in sqlite", expectedPlanFingerprint: moveFingerprint });
      const movedBody = moved.body as { ok?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown } };
      if (moved.status !== 200 || movedBody.ok !== true || movedBody.sqliteMutated !== true || movedBody.rowsChanged?.budgetSnapshots !== 0 || movedBody.rowsChanged?.transactions !== 1 || movedBody.rowsChanged?.total !== 1) throw new Error("occurrence_change_link_write_invalid");
      const staleReplay = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/changeLink", token, { snapshotId: targetSnapshotId, transactionId, expectedCurrentSnapshotId: snapshotId, dryRunReviewed: true, confirmation: "change one transaction budget occurrence link in sqlite", expectedPlanFingerprint: moveFingerprint });
      if (staleReplay.status !== 409 || (staleReplay.body as { code?: unknown }).code !== "transaction_snapshot_link_stale") throw new Error("occurrence_change_link_replay_not_rejected");
      finalSnapshotId = targetSnapshotId;
    }
    if (occurrenceUnlinkProcess) {
      const unlinkDry = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/dry-run/unlink", token, { transactionId });
      const unlinkDryBody = unlinkDry.body as { ok?: unknown; wouldMutate?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown }; planFingerprint?: unknown };
      const unlinkFingerprint = unlinkDryBody.planFingerprint;
      if (unlinkDry.status !== 200 || unlinkDryBody.ok !== true || unlinkDryBody.wouldMutate !== true || unlinkDryBody.sqliteMutated !== false || unlinkDryBody.rowsChanged?.budgetSnapshots !== 0 || unlinkDryBody.rowsChanged?.transactions !== 0 || unlinkDryBody.rowsChanged?.total !== 0 || typeof unlinkFingerprint !== "string") throw new Error("occurrence_unlink_dry_run_invalid");
      const unlinked = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/unlink", token, { transactionId, dryRunReviewed: true, confirmation: "unlink one transaction from its budget occurrence in sqlite", expectedPlanFingerprint: unlinkFingerprint });
      const unlinkedBody = unlinked.body as { ok?: unknown; sqliteMutated?: unknown; rowsChanged?: { budgetSnapshots?: unknown; transactions?: unknown; total?: unknown } };
      if (unlinked.status !== 200 || unlinkedBody.ok !== true || unlinkedBody.sqliteMutated !== true || unlinkedBody.rowsChanged?.budgetSnapshots !== 0 || unlinkedBody.rowsChanged?.transactions !== 1 || unlinkedBody.rowsChanged?.total !== 1) throw new Error("occurrence_unlink_write_invalid");
      const staleReplay = await request(apiPort, "POST", "/prototype/repositories/budget-snapshot-occurrences/write/unlink", token, { transactionId, dryRunReviewed: true, confirmation: "unlink one transaction from its budget occurrence in sqlite", expectedPlanFingerprint: unlinkFingerprint });
      if (staleReplay.status !== 409 || (staleReplay.body as { code?: unknown }).code !== "budget_snapshot_occurrence_plan_stale") throw new Error("occurrence_unlink_replay_not_rejected");
      finalSnapshotId = 0;
    }
    const linkedState = new Database(active, { readonly: true }); try { const row = linkedState.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate, isTransfer, accountId, categoryId, recipientId, amount, date, description, transactionCost FROM transactions WHERE id = ?").get(transactionId) as { budgetSnapshotId: number | null; budgetId: number | null; occurrenceDate: string | null; isTransfer: number; accountId: number; categoryId: number; recipientId: number; amount: number; date: string; description: string; transactionCost: number | null } | undefined; const snapshot = finalSnapshotId ? linkedState.prepare("SELECT id, budgetId, occurrenceDate FROM budgetSnapshots WHERE id = ?").get(finalSnapshotId) as { id: number; budgetId: number; occurrenceDate: string } | undefined : undefined; const sourceSnapshot = linkedState.prepare("SELECT id FROM budgetSnapshots WHERE id = ?").get(snapshotId); const budgetRow = linkedState.prepare("SELECT id FROM budgets WHERE id = ?").get(budgetId); if (!row || !sourceSnapshot || !budgetRow || (finalSnapshotId ? (!snapshot || row.budgetSnapshotId !== finalSnapshotId || row.budgetId !== budgetId || row.occurrenceDate !== snapshot.occurrenceDate) : (row.budgetSnapshotId !== null || row.budgetId !== null || row.occurrenceDate !== null)) || row.isTransfer !== 0 || row.accountId !== accountId || row.categoryId !== categoryId || row.recipientId !== recipientId || row.amount !== amount || row.date !== date || row.description !== description || row.transactionCost !== null) throw new Error("occurrence_link_state_invalid"); } finally { linkedState.close(); }
    occurrenceLinkExpected = { snapshotId: finalSnapshotId || null, ...((occurrenceChangeLinkProcess || occurrenceUnlinkProcess) ? { previousSnapshotId: snapshotId } : {}), transactionId, budgetId, accountId, categoryId, recipientId, amount, date, description };
  } else if (occurrenceCreateDeleteProcess) {
    const write = async (p: string, b: Record<string, unknown>) => { const r = await request(apiPort, "POST", p, token, b); const id = r.body && typeof r.body === "object" && !Array.isArray(r.body) ? (r.body as { targetId?: unknown }).targetId : undefined; if (r.status !== 200 || typeof id !== "number") throw new Error(`occurrence_setup_${p}`); return id; };
    const bucketId=await write("/prototype/repositories/buckets/write/create",{name:"occ-b",description:null,dryRunReviewed:true,confirmation:"create bucket in disposable sqlite"}); const categoryId=await write("/prototype/repositories/categories/write/create",{name:"occ-c",bucketId,description:null,dryRunReviewed:true,confirmation:"create category in disposable sqlite"}); const accountId=await write("/prototype/repositories/accounts/write/create",{name:"occ-a",currency:"KES",isCredit:false,creditLimit:null,dryRunReviewed:true,confirmation:"create account in disposable sqlite"}); const recipientId=await write("/prototype/repositories/recipients/write/create",{name:"occ-r",aliases:null,email:null,phone:null,tillNumber:null,paybill:null,accountNumber:null,description:null,dryRunReviewed:true,confirmation:"create recipient in disposable sqlite"});
    const b={description:"occurrence budget",categoryId,accountId,recipientId,amount:-50,transactionCost:null,frequency:"monthly",frequencyDetails:{dayOfMonth:15},isGoal:false,isFlexible:false,goalPercentage:null,goalDirection:null,remainingCyclesTotal:null,dueDate:"2026-08-15T00:00:00.000Z"}; const made=await request(apiPort,"POST","/prototype/repositories/budgets/write/create",token,{...b,dryRunReviewed:true,confirmation:"create budget definition in disposable sqlite"}); const budgetId=(made.body as {targetId?:number}).targetId; if(made.status!==200||typeof budgetId!=="number")throw new Error("occ_budget");
    const createDry=await request(apiPort,"POST","/prototype/repositories/budget-snapshot-occurrences/dry-run/create",token,{budgetId,occurrenceDate:"2026-09-15"}); const createPlan=(createDry.body as {planFingerprint?:string}).planFingerprint; if(createDry.status!==200||!createPlan)throw new Error("occ_create_dry"); const created=await request(apiPort,"POST","/prototype/repositories/budget-snapshot-occurrences/write/create",token,{budgetId,occurrenceDate:"2026-09-15",dryRunReviewed:true,confirmation:"create one budget occurrence in sqlite",expectedPlanFingerprint:createPlan}); const snapshotId=(created.body as {target?:{snapshotId?:number}}).target?.snapshotId; if(created.status!==200||typeof snapshotId!=="number")throw new Error("occ_create");
    const deleteDry=await request(apiPort,"POST","/prototype/repositories/budget-snapshot-occurrences/dry-run/delete",token,{snapshotId}); const deletePlan=(deleteDry.body as {planFingerprint?:string}).planFingerprint; if(deleteDry.status!==200||!deletePlan)throw new Error("occ_delete_dry"); const deleted=await request(apiPort,"POST","/prototype/repositories/budget-snapshot-occurrences/write/delete",token,{snapshotId,dryRunReviewed:true,confirmation:"delete one unlinked budget occurrence from sqlite",expectedPlanFingerprint:deletePlan}); if(deleted.status!==200)throw new Error("occ_delete");
  } else if (budgetDefinitionProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => { const response = await request(apiPort, "POST", pathname, token, body); const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined; if (response.status !== 200 || typeof id !== "number") throw new Error(`budget_definition_setup_failed_${pathname.replaceAll("/", "_")}`); return id; };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "budget-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "budget-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "budget-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "budget-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const budget = (id?: number, amount = -50) => ({ ...(id ? { id } : {}), description: "budget definition", categoryId, accountId, recipientId, amount, transactionCost: null, frequency: "monthly", frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false, goalPercentage: null, goalDirection: null, remainingCyclesTotal: null, dueDate: "2026-08-15T00:00:00.000Z" });
    const created = await request(apiPort, "POST", "/prototype/repositories/budgets/write/create", token, { ...budget(), dryRunReviewed: true, confirmation: "create budget definition in disposable sqlite" });
    const budgetId = created.body && typeof created.body === "object" && !Array.isArray(created.body) ? (created.body as { targetId?: unknown }).targetId : undefined;
    if (created.status !== 200 || typeof budgetId !== "number") throw new Error("budget_definition_create_failed");
    const updated = await request(apiPort, "POST", "/prototype/repositories/budgets/write/update", token, { ...budget(budgetId, -75), dryRunReviewed: true, confirmation: "update budget definition in disposable sqlite" });
    if (updated.status !== 200) throw new Error("budget_definition_update_failed");
    const dry = await request(apiPort, "POST", "/prototype/repositories/budgets/delete/dry-run", token, { budgetId }); const plan = dry.body && typeof dry.body === "object" && !Array.isArray(dry.body) ? (dry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (dry.status !== 200 || typeof plan !== "string") throw new Error("budget_definition_delete_dry_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/budgets/delete/write", token, { budgetId, dryRunReviewed: true, confirmation: "delete budget and unlinked snapshots from disposable sqlite", expectedPlanFingerprint: plan });
    if (deleted.status !== 200) throw new Error("budget_definition_delete_failed");
  } else if (transferLifecycleProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`transfer_lifecycle_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "transfer-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "transfer-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "transfer-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const sourceAccountId = await write("/prototype/repositories/accounts/write/create", { name: "transfer-source", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const destinationAccountId = await write("/prototype/repositories/accounts/write/create", { name: "transfer-destination", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const payload = { sourceAccountId, destinationAccountId, sourceRecipientId: recipientId, destinationRecipientId: recipientId, date: "2026-07-27T13:00:00.000Z", amount: 10, transactionCost: null, originalAmount: null, originalCurrency: null, exchangeRate: null, transactionReference: null, categoryId, description: "transfer lifecycle" };
    const invalid = await request(apiPort, "POST", "/prototype/repositories/transactions/transfers/write/create", token, { ...payload, destinationAccountId: sourceAccountId, dryRunReviewed: true, confirmation: "create paired transfer in disposable sqlite" });
    if (invalid.status !== 400) throw new Error("transfer_lifecycle_same_account_failed");
    const created = await request(apiPort, "POST", "/prototype/repositories/transactions/transfers/write/create", token, { ...payload, dryRunReviewed: true, confirmation: "create paired transfer in disposable sqlite" });
    const sourceId = created.body && typeof created.body === "object" && !Array.isArray(created.body) ? (created.body as { sourceTransactionId?: unknown }).sourceTransactionId : undefined;
    const destinationId = created.body && typeof created.body === "object" && !Array.isArray(created.body) ? (created.body as { destinationTransactionId?: unknown }).destinationTransactionId : undefined;
    if (created.status !== 200 || typeof sourceId !== "number" || typeof destinationId !== "number") throw new Error("transfer_lifecycle_create_failed");
    const pair = new Database(active, { readonly: true }); try { const rows = pair.prepare("SELECT id, accountId, amount, transferPairId, isTransfer FROM transactions WHERE id IN (?, ?) ORDER BY id").all(sourceId, destinationId) as Array<{ id: number; accountId: number; amount: number; transferPairId: number; isTransfer: number }>; if (rows.length !== 2 || rows[0].transferPairId !== rows[1].id || rows[1].transferPairId !== rows[0].id || rows.some((row) => row.isTransfer !== 1) || !rows.some((row) => row.accountId === sourceAccountId && row.amount === -10) || !rows.some((row) => row.accountId === destinationAccountId && row.amount === 10)) throw new Error("transfer_lifecycle_pair_invalid"); } finally { pair.close(); }
    const updated = await request(apiPort, "POST", "/prototype/repositories/transactions/transfers/write/update", token, { ...payload, id: sourceId, amount: 12, description: "transfer lifecycle updated", dryRunReviewed: true, confirmation: "update paired transfer in disposable sqlite" });
    if (updated.status !== 200) throw new Error("transfer_lifecycle_update_failed");
    const afterUpdate = new Database(active, { readonly: true }); try { const rows = afterUpdate.prepare("SELECT amount FROM transactions WHERE id IN (?, ?) ORDER BY amount").all(sourceId, destinationId) as Array<{ amount: number }>; if (rows.length !== 2 || rows[0].amount !== -12 || rows[1].amount !== 12) throw new Error("transfer_lifecycle_update_pair_invalid"); } finally { afterUpdate.close(); }
  } else if (recipientActiveSmsProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`recipient_active_sms_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "active-state-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const deactivate = await request(apiPort, "POST", "/prototype/repositories/recipients/write/deactivate", token, { id: recipientId, expectedIsActive: true, dryRunReviewed: true, confirmation: "deactivate recipient in disposable sqlite" });
    if (deactivate.status !== 200) throw new Error("recipient_active_sms_deactivate_failed");
    const activate = await request(apiPort, "POST", "/prototype/repositories/recipients/write/activate", token, { id: recipientId, expectedIsActive: false, dryRunReviewed: true, confirmation: "activate recipient in disposable sqlite" });
    if (activate.status !== 200) throw new Error("recipient_active_sms_activate_failed");
    const missingActive = await request(apiPort, "POST", "/prototype/repositories/recipients/write/deactivate", token, { id: 99999, expectedIsActive: true, dryRunReviewed: true, confirmation: "deactivate recipient in disposable sqlite" });
    if (missingActive.status !== 404) throw new Error("recipient_active_sms_missing_failed");
    const sourceAccountId = await write("/prototype/repositories/accounts/write/create", { name: "sms-source-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const targetAccountId = await write("/prototype/repositories/accounts/write/create", { name: "sms-target-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const template = (id?: number, accountId = sourceAccountId) => ({ ...(id ? { id } : {}), name: "sms-template", description: null, accountId, referencePattern: null, amountPattern: null, recipientNamePattern: null, recipientPhonePattern: null, dateTimePattern: null, costPattern: null, incomePattern: null, expensePattern: null });
    const templateCreate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/create", token, { ...template(), dryRunReviewed: true, confirmation: "create sms import template in disposable sqlite" });
    const templateId = templateCreate.body && typeof templateCreate.body === "object" && !Array.isArray(templateCreate.body) ? (templateCreate.body as { targetId?: unknown }).targetId : undefined;
    if (templateCreate.status !== 200 || typeof templateId !== "number") throw new Error("recipient_active_sms_template_create_failed");
    const malformedTemplate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/create", token, { name: "bad" });
    if (malformedTemplate.status !== 400) throw new Error("recipient_active_sms_template_malformed_failed");
    const mergeDry = await request(apiPort, "POST", "/prototype/repositories/accounts/merge/dry-run", token, { sourceAccountId, targetAccountId });
    const mergePlan = mergeDry.body && typeof mergeDry.body === "object" && !Array.isArray(mergeDry.body) ? (mergeDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (mergeDry.status !== 200 || typeof mergePlan !== "string") throw new Error("recipient_active_sms_account_merge_dry_failed");
    const merged = await request(apiPort, "POST", "/prototype/repositories/accounts/merge/write", token, { sourceAccountId, targetAccountId, dryRunReviewed: true, confirmation: "merge account references in disposable sqlite", expectedPlanFingerprint: mergePlan });
    if (merged.status !== 200) throw new Error("recipient_active_sms_account_merge_failed");
    const reassigned = new Database(active, { readonly: true }); let templateAccountId: number | undefined; try { templateAccountId = Number((reassigned.prepare("SELECT accountId FROM smsImportTemplates WHERE id = ?").get(templateId) as { accountId: number }).accountId); } finally { reassigned.close(); }
    if (templateAccountId !== targetAccountId) throw new Error("recipient_active_sms_template_not_reassigned");
    const templateUpdate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/update", token, { ...template(templateId, targetAccountId), description: "updated", dryRunReviewed: true, confirmation: "update sms import template in disposable sqlite" });
    if (templateUpdate.status !== 200) throw new Error("recipient_active_sms_template_update_failed");
    const templateDeactivate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/deactivate", token, { id: templateId, dryRunReviewed: true, confirmation: "deactivate sms import template in disposable sqlite" });
    if (templateDeactivate.status !== 200) throw new Error("recipient_active_sms_template_deactivate_failed");
    const templateActivate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/activate", token, { id: templateId, dryRunReviewed: true, confirmation: "activate sms import template in disposable sqlite" });
    if (templateActivate.status !== 200) throw new Error("recipient_active_sms_template_activate_failed");
    const templateDelete = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/delete", token, { id: templateId, dryRunReviewed: true, confirmation: "delete sms import template from disposable sqlite" });
    if (templateDelete.status !== 200) throw new Error("recipient_active_sms_template_delete_failed");
    const missingTemplate = await request(apiPort, "POST", "/prototype/repositories/sms-import-templates/write/delete", token, { id: templateId, dryRunReviewed: true, confirmation: "delete sms import template from disposable sqlite" });
    if (missingTemplate.status !== 404) throw new Error("recipient_active_sms_template_missing_failed");
  } else if (bucketLifecycleProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`bucket_lifecycle_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const bucket = (name: string) => ({ name, description: null, minPercentage: null, maxPercentage: null, minFixedAmount: null, excludeFromReports: false, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "bucket-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "bucket-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const sourceBucketId = await write("/prototype/repositories/buckets/write/create", bucket("bucket-source"));
    const targetBucketId = await write("/prototype/repositories/buckets/write/create", bucket("bucket-target"));
    const unusedBucketId = await write("/prototype/repositories/buckets/write/create", bucket("bucket-unused"));
    const malformed = await request(apiPort, "POST", "/prototype/repositories/buckets/write/create", token, { name: "bad" });
    if (malformed.status !== 400) throw new Error("bucket_lifecycle_malformed_create_failed");
    const updated = await request(apiPort, "POST", "/prototype/repositories/buckets/write/update", token, { id: targetBucketId, name: "bucket-target-updated", description: "updated", minPercentage: null, maxPercentage: null, minFixedAmount: null, excludeFromReports: false, dryRunReviewed: true, confirmation: "update bucket in disposable sqlite" });
    if (updated.status !== 200) throw new Error("bucket_lifecycle_update_failed");
    const setActive = async (action: "activate" | "deactivate", id: number, expectedActive: boolean) => {
      const dry = await request(apiPort, "POST", `/prototype/repositories/buckets/active-state/dry-run/${action}`, token, { id });
      const fingerprint = dry.body && typeof dry.body === "object" && !Array.isArray(dry.body) ? (dry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
      if (dry.status !== 200 || typeof fingerprint !== "string") throw new Error(`bucket_lifecycle_${action}_dry_run_failed`);
      const stale = await request(apiPort, "POST", `/prototype/repositories/buckets/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} bucket in authoritative sqlite`, expectedPlanFingerprint: "0".repeat(64) });
      if (stale.status !== 409) throw new Error(`bucket_lifecycle_${action}_stale_failed`);
      const write = await request(apiPort, "POST", `/prototype/repositories/buckets/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} bucket in authoritative sqlite`, expectedPlanFingerprint: fingerprint });
      if (write.status !== 200) throw new Error(`bucket_lifecycle_${action}_write_failed`);
      const observed = new Database(active, { readonly: true }); try { const row = observed.prepare("SELECT isActive FROM buckets WHERE id = ?").get(id) as { isActive: number } | undefined; if (!row || Boolean(row.isActive) !== expectedActive) throw new Error(`bucket_lifecycle_${action}_not_persisted`); } finally { observed.close(); }
    };
    await setActive("deactivate", unusedBucketId, false);
    await setActive("activate", unusedBucketId, true);
    const reorderedIds = [unusedBucketId, targetBucketId, sourceBucketId];
    const reorderDry = await request(apiPort, "POST", "/prototype/repositories/buckets/reorder/dry-run", token, { orderedBucketIds: reorderedIds });
    const reorderFingerprint = reorderDry.body && typeof reorderDry.body === "object" && !Array.isArray(reorderDry.body) ? (reorderDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (reorderDry.status !== 200 || typeof reorderFingerprint !== "string") throw new Error("bucket_lifecycle_reorder_dry_run_failed");
    const staleReorder = await request(apiPort, "POST", "/prototype/repositories/buckets/reorder/write", token, { orderedBucketIds: reorderedIds, dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: "0".repeat(64) });
    if (staleReorder.status !== 409) throw new Error("bucket_lifecycle_reorder_stale_failed");
    const reordered = await request(apiPort, "POST", "/prototype/repositories/buckets/reorder/write", token, { orderedBucketIds: reorderedIds, dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: reorderFingerprint });
    if (reordered.status !== 200) throw new Error("bucket_lifecycle_reorder_write_failed");
    const reorderObserved = new Database(active, { readonly: true }); try { const rows = reorderObserved.prepare("SELECT id FROM buckets ORDER BY displayOrder, id").all() as Array<{ id: number }>; if (rows.map((row) => row.id).join(",") !== reorderedIds.join(",")) throw new Error("bucket_lifecycle_reorder_not_atomic"); } finally { reorderObserved.close(); }
    const missingUpdate = await request(apiPort, "POST", "/prototype/repositories/buckets/write/update", token, { id: 99999, name: "missing", description: null, minPercentage: null, maxPercentage: null, minFixedAmount: null, excludeFromReports: false, dryRunReviewed: true, confirmation: "update bucket in disposable sqlite" });
    if (missingUpdate.status !== 404) throw new Error("bucket_lifecycle_missing_update_failed");
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "bucket-linked-category", bucketId: sourceBucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: null, categoryId, accountId, recipientId, description: "bucket-link", dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    if (transaction.status !== 200 || tableCount(active, "transactions") !== 1) throw new Error("bucket_lifecycle_transaction_setup_failed");
    const mergeDry = await request(apiPort, "POST", "/prototype/repositories/buckets/merge/dry-run", token, { sourceBucketId, targetBucketId });
    const mergePlan = mergeDry.body && typeof mergeDry.body === "object" && !Array.isArray(mergeDry.body) ? (mergeDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (mergeDry.status !== 200 || typeof mergePlan !== "string") throw new Error("bucket_lifecycle_merge_dry_run_failed");
    const invalidMerge = await request(apiPort, "POST", "/prototype/repositories/buckets/merge/dry-run", token, { sourceBucketId: targetBucketId, targetBucketId });
    if (invalidMerge.status !== 409) throw new Error("bucket_lifecycle_invalid_merge_failed");
    const merged = await request(apiPort, "POST", "/prototype/repositories/buckets/merge/write", token, { sourceBucketId, targetBucketId, dryRunReviewed: true, confirmation: "merge bucket references in disposable sqlite", expectedPlanFingerprint: mergePlan });
    if (merged.status !== 200) throw new Error("bucket_lifecycle_merge_failed");
    const linkedCategory = new Database(active, { readonly: true }); let categoryBucket: number | undefined; try { categoryBucket = Number((linkedCategory.prepare("SELECT bucketId FROM categories WHERE id = ?").get(categoryId) as { bucketId: number }).bucketId); } finally { linkedCategory.close(); }
    if (categoryBucket !== targetBucketId) throw new Error("bucket_lifecycle_category_not_reassigned");
    const deleteDry = await request(apiPort, "POST", "/prototype/repositories/buckets/delete/dry-run", token, { bucketId: unusedBucketId });
    const deletePlan = deleteDry.body && typeof deleteDry.body === "object" && !Array.isArray(deleteDry.body) ? (deleteDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (deleteDry.status !== 200 || typeof deletePlan !== "string") throw new Error("bucket_lifecycle_delete_dry_run_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/buckets/delete/write", token, { bucketId: unusedBucketId, dryRunReviewed: true, confirmation: "delete unused bucket from disposable sqlite", expectedPlanFingerprint: deletePlan });
    if (deleted.status !== 200) throw new Error("bucket_lifecycle_delete_failed");
    const repeated = await request(apiPort, "POST", "/prototype/repositories/buckets/delete/dry-run", token, { bucketId: unusedBucketId });
    if (repeated.status !== 404) throw new Error("bucket_lifecycle_repeated_delete_failed");
  } else if (categoryLifecycleProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`category_lifecycle_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "category-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "category-account", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "category-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const category = (name: string) => ({ name, bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const sourceCategoryId = await write("/prototype/repositories/categories/write/create", category("category-source"));
    const targetCategoryId = await write("/prototype/repositories/categories/write/create", category("category-target"));
    const unusedCategoryId = await write("/prototype/repositories/categories/write/create", category("category-unused"));
    const malformed = await request(apiPort, "POST", "/prototype/repositories/categories/write/create", token, { name: "bad" });
    if (malformed.status !== 400) throw new Error("category_lifecycle_malformed_create_failed");
    const updated = await request(apiPort, "POST", "/prototype/repositories/categories/write/update", token, { id: targetCategoryId, name: "category-target-updated", bucketId, description: "updated", dryRunReviewed: true, confirmation: "update category in disposable sqlite" });
    if (updated.status !== 200) throw new Error("category_lifecycle_update_failed");
    const setActive = async (action: "activate" | "deactivate", id: number, expectedActive: boolean) => {
      const dry = await request(apiPort, "POST", `/prototype/repositories/categories/active-state/dry-run/${action}`, token, { id });
      const fingerprint = dry.body && typeof dry.body === "object" && !Array.isArray(dry.body) ? (dry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
      if (dry.status !== 200 || typeof fingerprint !== "string") throw new Error(`category_lifecycle_${action}_dry_run_failed`);
      const stale = await request(apiPort, "POST", `/prototype/repositories/categories/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} category in authoritative sqlite`, expectedPlanFingerprint: "0".repeat(64) });
      if (stale.status !== 409) throw new Error(`category_lifecycle_${action}_stale_failed`);
      const write = await request(apiPort, "POST", `/prototype/repositories/categories/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} category in authoritative sqlite`, expectedPlanFingerprint: fingerprint });
      if (write.status !== 200) throw new Error(`category_lifecycle_${action}_write_failed`);
      const observed = new Database(active, { readonly: true }); try { const row = observed.prepare("SELECT isActive FROM categories WHERE id = ?").get(id) as { isActive: number } | undefined; if (!row || Boolean(row.isActive) !== expectedActive) throw new Error(`category_lifecycle_${action}_not_persisted`); } finally { observed.close(); }
    };
    await setActive("deactivate", unusedCategoryId, false);
    await setActive("activate", unusedCategoryId, true);
    const missingUpdate = await request(apiPort, "POST", "/prototype/repositories/categories/write/update", token, { id: 99999, name: "missing", bucketId, description: null, dryRunReviewed: true, confirmation: "update category in disposable sqlite" });
    if (missingUpdate.status !== 404) throw new Error("category_lifecycle_missing_update_failed");
    const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: null, categoryId: sourceCategoryId, accountId, recipientId, description: "category-link", dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    if (transaction.status !== 200 || tableCount(active, "transactions") !== 1) throw new Error("category_lifecycle_transaction_setup_failed");
    const mergeDry = await request(apiPort, "POST", "/prototype/repositories/categories/merge/dry-run", token, { sourceCategoryId, targetCategoryId });
    const mergePlan = mergeDry.body && typeof mergeDry.body === "object" && !Array.isArray(mergeDry.body) ? (mergeDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (mergeDry.status !== 200 || typeof mergePlan !== "string") throw new Error("category_lifecycle_merge_dry_run_failed");
    const invalidMerge = await request(apiPort, "POST", "/prototype/repositories/categories/merge/dry-run", token, { sourceCategoryId: targetCategoryId, targetCategoryId });
    if (invalidMerge.status !== 409) throw new Error("category_lifecycle_invalid_merge_failed");
    const merged = await request(apiPort, "POST", "/prototype/repositories/categories/merge/write", token, { sourceCategoryId, targetCategoryId, dryRunReviewed: true, confirmation: "merge category references in disposable sqlite", expectedPlanFingerprint: mergePlan });
    if (merged.status !== 200) throw new Error("category_lifecycle_merge_failed");
    const transactionCategory = new Database(active, { readonly: true }); let linkedCategory: number | undefined; try { linkedCategory = Number((transactionCategory.prepare("SELECT categoryId FROM transactions").get() as { categoryId: number }).categoryId); } finally { transactionCategory.close(); }
    if (linkedCategory !== targetCategoryId) throw new Error("category_lifecycle_link_not_reassigned");
    const deleteDry = await request(apiPort, "POST", "/prototype/repositories/categories/delete/dry-run", token, { categoryId: unusedCategoryId });
    const deletePlan = deleteDry.body && typeof deleteDry.body === "object" && !Array.isArray(deleteDry.body) ? (deleteDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (deleteDry.status !== 200 || typeof deletePlan !== "string") throw new Error("category_lifecycle_delete_dry_run_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/categories/delete/write", token, { categoryId: unusedCategoryId, dryRunReviewed: true, confirmation: "delete unused category from disposable sqlite", expectedPlanFingerprint: deletePlan });
    if (deleted.status !== 200) throw new Error("category_lifecycle_delete_failed");
    const repeated = await request(apiPort, "POST", "/prototype/repositories/categories/delete/dry-run", token, { categoryId: unusedCategoryId });
    if (repeated.status !== 404) throw new Error("category_lifecycle_repeated_delete_failed");
  } else if (accountLifecycleProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`account_lifecycle_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const account = (name: string) => ({ name, currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "account-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "account-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "account-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const sourceAccountId = await write("/prototype/repositories/accounts/write/create", account("account-source"));
    const targetAccountId = await write("/prototype/repositories/accounts/write/create", account("account-target"));
    const unusedAccountId = await write("/prototype/repositories/accounts/write/create", account("account-unused"));
    const malformed = await request(apiPort, "POST", "/prototype/repositories/accounts/write/create", token, { name: "bad" });
    if (malformed.status !== 400) throw new Error("account_lifecycle_malformed_create_failed");
    const updated = await request(apiPort, "POST", "/prototype/repositories/accounts/write/update", token, { id: targetAccountId, name: "account-target-updated", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "update account in disposable sqlite" });
    if (updated.status !== 200) throw new Error("account_lifecycle_update_failed");
    const setActive = async (action: "activate" | "deactivate", id: number, expectedActive: boolean) => {
      const dry = await request(apiPort, "POST", `/prototype/repositories/accounts/active-state/dry-run/${action}`, token, { id });
      const fingerprint = dry.body && typeof dry.body === "object" && !Array.isArray(dry.body) ? (dry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
      if (dry.status !== 200 || typeof fingerprint !== "string") throw new Error(`account_lifecycle_${action}_dry_run_failed`);
      const stale = await request(apiPort, "POST", `/prototype/repositories/accounts/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} account in authoritative sqlite`, expectedPlanFingerprint: "0".repeat(64) });
      if (stale.status !== 409) throw new Error(`account_lifecycle_${action}_stale_failed`);
      const write = await request(apiPort, "POST", `/prototype/repositories/accounts/active-state/write/${action}`, token, { id, dryRunReviewed: true, confirmation: `${action} account in authoritative sqlite`, expectedPlanFingerprint: fingerprint });
      if (write.status !== 200) throw new Error(`account_lifecycle_${action}_write_failed`);
      const observed = new Database(active, { readonly: true }); try { const row = observed.prepare("SELECT isActive FROM accounts WHERE id = ?").get(id) as { isActive: number } | undefined; if (!row || Boolean(row.isActive) !== expectedActive) throw new Error(`account_lifecycle_${action}_not_persisted`); } finally { observed.close(); }
    };
    await setActive("deactivate", unusedAccountId, false);
    await setActive("activate", unusedAccountId, true);
    const missingUpdate = await request(apiPort, "POST", "/prototype/repositories/accounts/write/update", token, { id: 99999, name: "missing", currency: "KES", isCredit: false, creditLimit: null, dryRunReviewed: true, confirmation: "update account in disposable sqlite" });
    if (missingUpdate.status !== 404) throw new Error("account_lifecycle_missing_update_failed");
    const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: null, categoryId, accountId: sourceAccountId, recipientId, description: "account-link", dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    if (transaction.status !== 200 || tableCount(active, "transactions") !== 1) throw new Error("account_lifecycle_transaction_setup_failed");
    const mergeDry = await request(apiPort, "POST", "/prototype/repositories/accounts/merge/dry-run", token, { sourceAccountId, targetAccountId });
    const mergePlan = mergeDry.body && typeof mergeDry.body === "object" && !Array.isArray(mergeDry.body) ? (mergeDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (mergeDry.status !== 200 || typeof mergePlan !== "string") throw new Error("account_lifecycle_merge_dry_run_failed");
    const invalidMerge = await request(apiPort, "POST", "/prototype/repositories/accounts/merge/dry-run", token, { sourceAccountId: targetAccountId, targetAccountId });
    if (invalidMerge.status !== 409) throw new Error("account_lifecycle_invalid_merge_failed");
    const merged = await request(apiPort, "POST", "/prototype/repositories/accounts/merge/write", token, { sourceAccountId, targetAccountId, dryRunReviewed: true, confirmation: "merge account references in disposable sqlite", expectedPlanFingerprint: mergePlan });
    if (merged.status !== 200) throw new Error("account_lifecycle_merge_failed");
    const transactionAccount = new Database(active, { readonly: true }); let linkedAccount: number | undefined; try { linkedAccount = Number((transactionAccount.prepare("SELECT accountId FROM transactions").get() as { accountId: number }).accountId); } finally { transactionAccount.close(); }
    if (linkedAccount !== targetAccountId) throw new Error("account_lifecycle_link_not_reassigned");
    const deleteDry = await request(apiPort, "POST", "/prototype/repositories/accounts/delete/dry-run", token, { accountId: unusedAccountId });
    const deletePlan = deleteDry.body && typeof deleteDry.body === "object" && !Array.isArray(deleteDry.body) ? (deleteDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (deleteDry.status !== 200 || typeof deletePlan !== "string") throw new Error("account_lifecycle_delete_dry_run_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/accounts/delete/write", token, { accountId: unusedAccountId, dryRunReviewed: true, confirmation: "delete unused account from disposable sqlite", expectedPlanFingerprint: deletePlan });
    if (deleted.status !== 200) throw new Error("account_lifecycle_delete_failed");
    const repeated = await request(apiPort, "POST", "/prototype/repositories/accounts/delete/dry-run", token, { accountId: unusedAccountId });
    if (repeated.status !== 404) throw new Error("account_lifecycle_repeated_delete_failed");
  } else if (recipientLifecycleProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`recipient_lifecycle_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const recipientBody = (name: string) => ({ name, aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "recipient-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "recipient-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "recipient-account", currency: "KES", isCredit: false, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const targetRecipientId = await write("/prototype/repositories/recipients/write/create", recipientBody("recipient-target"));
    const sourceRecipientId = await write("/prototype/repositories/recipients/write/create", recipientBody("recipient-source"));
    const updated = await request(apiPort, "POST", "/prototype/repositories/recipients/write/update", token, { id: targetRecipientId, ...recipientBody("recipient-target-updated"), confirmation: "update recipient in disposable sqlite" });
    if (updated.status !== 200) throw new Error("recipient_lifecycle_update_failed");
    const transaction = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: null, categoryId, accountId, recipientId: targetRecipientId, description: "recipient-link", dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    if (transaction.status !== 200 || tableCount(active, "transactions") !== 1) throw new Error("recipient_lifecycle_transaction_setup_failed");
    const mergeDry = await request(apiPort, "POST", "/prototype/repositories/recipients/merge/dry-run", token, { sourceRecipientId, targetRecipientId });
    const mergePlan = mergeDry.body && typeof mergeDry.body === "object" && !Array.isArray(mergeDry.body) ? (mergeDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (mergeDry.status !== 200 || typeof mergePlan !== "string") throw new Error("recipient_lifecycle_merge_dry_run_failed");
    const invalidMerge = await request(apiPort, "POST", "/prototype/repositories/recipients/merge/dry-run", token, { sourceRecipientId: targetRecipientId, targetRecipientId });
    if (invalidMerge.status !== 409 || count(active) !== 2) throw new Error("recipient_lifecycle_invalid_merge_failed");
    const merged = await request(apiPort, "POST", "/prototype/repositories/recipients/merge/write", token, { sourceRecipientId, targetRecipientId, dryRunReviewed: true, confirmation: "merge recipient references in disposable sqlite", expectedPlanFingerprint: mergePlan });
    if (merged.status !== 200 || count(active) !== 1) throw new Error("recipient_lifecycle_merge_failed");
    const transactionRecipient = new Database(active, { readonly: true }); let linkedRecipient: number | undefined; try { linkedRecipient = Number((transactionRecipient.prepare("SELECT recipientId FROM transactions").get() as { recipientId: number }).recipientId); } finally { transactionRecipient.close(); }
    if (linkedRecipient !== targetRecipientId) throw new Error("recipient_lifecycle_link_not_reassigned");
    const unusedRecipientId = await write("/prototype/repositories/recipients/write/create", recipientBody("recipient-unused"));
    const deleteDry = await request(apiPort, "POST", "/prototype/repositories/recipients/delete/dry-run", token, { recipientId: unusedRecipientId });
    const deletePlan = deleteDry.body && typeof deleteDry.body === "object" && !Array.isArray(deleteDry.body) ? (deleteDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (deleteDry.status !== 200 || typeof deletePlan !== "string") throw new Error("recipient_lifecycle_delete_dry_run_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/recipients/delete/write", token, { recipientId: unusedRecipientId, dryRunReviewed: true, confirmation: "delete unused recipient from disposable sqlite", expectedPlanFingerprint: deletePlan });
    if (deleted.status !== 200 || count(active) !== 1) throw new Error("recipient_lifecycle_delete_failed");
    const repeated = await request(apiPort, "POST", "/prototype/repositories/recipients/delete/dry-run", token, { recipientId: unusedRecipientId });
    if (repeated.status !== 404 || count(active) !== 1) throw new Error("recipient_lifecycle_repeated_delete_failed");
  } else if (transactionDeleteProcess) {
    const write = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      const id = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? (response.body as { targetId?: unknown }).targetId : undefined;
      if (response.status !== 200 || typeof id !== "number") throw new Error(`transaction_delete_process_setup_failed_${pathname.replaceAll("/", "_")}`);
      return id;
    };
    const bucketId = await write("/prototype/repositories/buckets/write/create", { name: "delete-bucket", description: null, dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const categoryId = await write("/prototype/repositories/categories/write/create", { name: "delete-category", bucketId, description: null, dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountId = await write("/prototype/repositories/accounts/write/create", { name: "delete-account", currency: "KES", isCredit: false, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const recipientId = await write("/prototype/repositories/recipients/write/create", { name: "delete-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const created = await request(apiPort, "POST", "/prototype/repositories/transactions/write/create", token, { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: null, categoryId, accountId, recipientId, description: "disposable-delete", dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    const id = created.body && typeof created.body === "object" && !Array.isArray(created.body) ? (created.body as { targetId?: unknown }).targetId : undefined;
    if (created.status !== 200 || typeof id !== "number" || tableCount(active, "transactions") !== 1) throw new Error("transaction_delete_process_create_failed");
    const dry = await request(apiPort, "POST", "/prototype/repositories/transactions/delete/dry-run", token, { id });
    const plan = dry.body && typeof dry.body === "object" && !Array.isArray(dry.body) ? (dry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (dry.status !== 200 || typeof plan !== "string") throw new Error("transaction_delete_process_dry_run_failed");
    const malformed = await request(apiPort, "POST", "/prototype/repositories/transactions/delete/write", token, { id, dryRunReviewed: true, expectedPlanFingerprint: plan });
    if (malformed.status !== 400 || tableCount(active, "transactions") !== 1) throw new Error("transaction_delete_process_malformed_confirmation_failed");
    const stale = await request(apiPort, "POST", "/prototype/repositories/transactions/delete/write", token, { id, dryRunReviewed: true, confirmation: "delete transaction or transfer pair from disposable sqlite", expectedPlanFingerprint: "0".repeat(64) });
    if (stale.status !== 409 || tableCount(active, "transactions") !== 1) throw new Error("transaction_delete_process_stale_confirmation_failed");
    const deleted = await request(apiPort, "POST", "/prototype/repositories/transactions/delete/write", token, { id, dryRunReviewed: true, confirmation: "delete transaction or transfer pair from disposable sqlite", expectedPlanFingerprint: plan });
    if (deleted.status !== 200 || tableCount(active, "transactions") !== 0) { const diagnostic = deleted.body && typeof deleted.body === "object" && !Array.isArray(deleted.body) ? String((deleted.body as { code?: unknown }).code ?? "unknown") : "unknown"; throw new Error(`transaction_delete_process_write_failed_${deleted.status}_${diagnostic}`); }
    const repeated = await request(apiPort, "POST", "/prototype/repositories/transactions/delete/dry-run", token, { id });
    if (repeated.status !== 404 || tableCount(active, "transactions") !== 0) throw new Error("transaction_delete_process_repeat_failed");
  } else if (routeFamilies) {
    const checkedWrite = async (pathname: string, body: Record<string, unknown>) => {
      const response = await request(apiPort, "POST", pathname, token, body);
      if (response.status !== 200 || !response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
        const code = response.body && typeof response.body === "object" && !Array.isArray(response.body) ? String((response.body as { code?: unknown }).code ?? "unknown") : "unknown";
        throw new Error(`route_family_write_failed_${pathname.replaceAll("/", "_")}_${response.status}_${code}`);
      }
      return response.body as Record<string, unknown>;
    };
    const recipient = await checkedWrite("/prototype/repositories/recipients/write/create", { name: "route-family-recipient", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    const bucket = await checkedWrite("/prototype/repositories/buckets/write/create", { name: "route-family-bucket", description: "disposable", dryRunReviewed: true, confirmation: "create bucket in disposable sqlite" });
    const category = await checkedWrite("/prototype/repositories/categories/write/create", { name: "route-family-category", bucketId: bucket.targetId, description: "disposable", dryRunReviewed: true, confirmation: "create category in disposable sqlite" });
    const accountOne = await checkedWrite("/prototype/repositories/accounts/write/create", { name: "route-family-account-one", currency: "KES", isCredit: false, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const accountTwo = await checkedWrite("/prototype/repositories/accounts/write/create", { name: "route-family-account-two", currency: "KES", isCredit: false, dryRunReviewed: true, confirmation: "create account in disposable sqlite" });
    const transactionPayload = { classification: "expense", date: "2026-07-27T12:00:00.000Z", amount: -100, transactionCost: -2, categoryId: category.targetId, accountId: accountOne.targetId, recipientId: recipient.targetId, description: "route-family-transaction" };
    const transaction = await checkedWrite("/prototype/repositories/transactions/write/create", { ...transactionPayload, dryRunReviewed: true, confirmation: "create basic transaction in disposable sqlite" });
    await checkedWrite("/prototype/repositories/transactions/write/update", { ...transactionPayload, id: transaction.targetId, amount: -101, dryRunReviewed: true, confirmation: "update basic transaction in disposable sqlite" });
    await checkedWrite("/prototype/repositories/transactions/transfers/write/create", { sourceAccountId: accountOne.targetId, destinationAccountId: accountTwo.targetId, sourceRecipientId: recipient.targetId, destinationRecipientId: recipient.targetId, date: "2026-07-27T13:00:00.000Z", amount: 10, categoryId: category.targetId, description: "route-family-transfer", dryRunReviewed: true, confirmation: "create paired transfer in disposable sqlite" });
    const budgetPayload = { description: "route-family-budget", categoryId: category.targetId, accountId: accountOne.targetId, recipientId: null, amount: -50, transactionCost: null, frequency: "monthly", frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false, goalPercentage: null, goalDirection: null, remainingCyclesTotal: 3, dueDate: "2026-08-15T00:00:00.000Z", isActive: true, asOf: "2026-07-27" };
    const budgetDry = await request(apiPort, "POST", "/prototype/repositories/budgets/lifecycle/dry-run/create", token, budgetPayload);
    const plan = budgetDry.body && typeof budgetDry.body === "object" && !Array.isArray(budgetDry.body) ? (budgetDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (budgetDry.status !== 200 || typeof plan !== "string") throw new Error("route_family_budget_plan_failed");
    await checkedWrite("/prototype/repositories/budgets/lifecycle/write/create", { ...budgetPayload, dryRunReviewed: true, confirmation: "create budget and lifecycle coverage in disposable sqlite", expectedPlanFingerprint: plan });
    const lifecycleUpdatePayload = { ...budgetPayload, id: 1, description: "route-family-budget-updated", amount: -75 };
    const updateDry = await request(apiPort, "POST", "/prototype/repositories/budgets/lifecycle/dry-run/update", token, lifecycleUpdatePayload);
    const updatePlan = updateDry.body && typeof updateDry.body === "object" && !Array.isArray(updateDry.body) ? (updateDry.body as { planFingerprint?: unknown }).planFingerprint : undefined;
    if (updateDry.status !== 200 || typeof updatePlan !== "string") throw new Error("route_family_budget_update_plan_failed");
    const beforeInvalidUpdate = tableCount(active, "budgets");
    const staleUpdate = await request(apiPort, "POST", "/prototype/repositories/budgets/lifecycle/write/update", token, { ...lifecycleUpdatePayload, dryRunReviewed: true, confirmation: "update budget and lifecycle coverage in disposable sqlite", expectedPlanFingerprint: "0".repeat(64) });
    if (staleUpdate.status === 200 || tableCount(active, "budgets") !== beforeInvalidUpdate) throw new Error("route_family_budget_stale_update_advanced_mutation");
    await checkedWrite("/prototype/repositories/budgets/lifecycle/write/update", { ...lifecycleUpdatePayload, dryRunReviewed: true, confirmation: "update budget and lifecycle coverage in disposable sqlite", expectedPlanFingerprint: updatePlan });
    const persistedBudget = new Database(active, { readonly: true }); try { const row = persistedBudget.prepare("SELECT description, amount FROM budgets WHERE id = 1").get() as { description: string; amount: number } | undefined; if (!row || row.description !== "route-family-budget-updated" || row.amount !== -75) throw new Error("route_family_budget_update_not_persisted"); } finally { persistedBudget.close(); }
    if (count(active) !== 1 || tableCount(active, "transactions") !== 3 || tableCount(active, "budgets") !== 1 || tableCount(active, "budgetSnapshots") < 1) throw new Error("route_family_database_result_failed");
  } else if (noOpRollback) {
    const noOp = await request(apiPort, "POST", "/test-support/write/no-op", token);
    const rollback = await request(apiPort, "POST", "/test-support/write/rollback", token);
    if (noOp.status !== 200 || rollback.status !== 500 || count(active) !== beforeRecipients) throw new Error("no_op_rollback_process_precondition_failed");
    const valid = await request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: "disposable-valid-after-rollback", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    if (valid.status !== 200 || count(active) !== beforeRecipients + 1) throw new Error("valid_after_rollback_failed");
  } else if (mixedConcurrent) {
    const apiWrite = request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: "disposable-locked", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    await wait("mutation_lock_gate", async () => existsSync(`${gatePath}.ready`));
    const externalMarker = `${gatePath}.external`;
    const external = spawn(process.execPath, [tsx, externalWriter, "--sqlite", active, "--name", "external-disposable-concurrent", "--marker", externalMarker], { windowsHide: true, stdio: "ignore" });
    await wait("external_writer_attempt", async () => existsSync(`${externalMarker}.attempting`));
    await delay(100);
    if (external.exitCode !== null || existsSync(`${externalMarker}.committed`) || count(active) !== beforeRecipients) throw new Error("external_writer_not_blocked_by_immediate_lock");
    writeFileSync(`${gatePath}.resume`, "resume\n", { flag: "wx" });
    const approved = await apiWrite;
    if (approved.status !== 200) throw new Error("locked_api_mutation_failed");
    if (await waitExit(external, "external_writer_after_release") !== 0 || !existsSync(`${externalMarker}.committed`) || count(active) !== beforeRecipients + 2) throw new Error("external_writer_did_not_commit_after_release");
  } else if (mixedBeforeFirst) {
    await externalWrite("external-disposable-before");
    const response = await request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: "disposable-rejected", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    if (response.status !== 409 || count(active) !== beforeRecipients + 1) throw new Error("mixed_before_first_not_rejected");
  } else for (let index = 0; index < writeCount; index += 1) {
    const response = await request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: `disposable-${index}`, aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
    if (response.status !== 200 || count(active) !== beforeRecipients + index + 1) {
      const code = response.body && typeof response.body === "object" && !Array.isArray(response.body)
        ? String((response.body as { code?: unknown }).code ?? "unknown")
        : "unknown";
      throw new Error(`committed_recipient_write_not_proven_${response.status}_${code}`);
    }
  }
  if (mixedAfterApproved || mixedBetweenApproved) {
    await externalWrite(mixedAfterApproved ? "external-disposable-after" : "external-disposable-between");
    if (mixedBetweenApproved) {
      const rejected = await request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: "disposable-second-rejected", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" });
      if (rejected.status !== 409 || count(active) !== beforeRecipients + 2) throw new Error("mixed_between_second_write_not_rejected");
    }
  }
  if (zeroMutationChange) {
    const external = new Database(active); try { external.prepare("INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)").run("external-disposable", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z"); } finally { external.close(); }
    if (count(active) !== beforeRecipients + 1 || (await request(apiPort, "GET", "/health")).status !== 200) throw new Error("zero_mutation_external_change_not_proven");
  }
  if (crashAfterWrite) {
    const profileBeforeCrash = readFileSync(profilePath, "utf8");
    const unauthenticated = await request(apiPort, "POST", "/test-support/authority-crash");
    if (unauthenticated.status !== 401 || (await request(apiPort, "GET", "/health")).status !== 200) throw new Error("test_crash_route_authentication_failed");
    await request(apiPort, "POST", "/test-support/authority-crash", token).catch(() => undefined);
    const crashExit = await waitExit(supervisor!, "api_crash_supervisor_exit"); supervisor = undefined;
    const checkpointArtifacts = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") || name.startsWith("authority-safety-before-checkpoint-"));
    if (crashExit === 0 || readFileSync(profilePath, "utf8") !== profileBeforeCrash || checkpointArtifacts.length !== beforeCheckpoints || count(active) !== beforeRecipients + 1 || existsSync(controlPathForProfile(profilePath))) throw new Error("api_crash_fail_closed_invariant_failed");
    const retry = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "run"], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(retry, "api_crash_restart_refusal") === 0 || readFileSync(profilePath, "utf8") !== profileBeforeCrash) throw new Error("changed_database_restart_not_refused");
    console.log("Authority real-process API-crash test: PASS");
    process.exitCode = 0;
  } else {
  let heldRequest: Promise<{ status: number; body: unknown }> | undefined;
  if (drainTimeout || drainSuccess || postSealViteExit) {
    heldRequest = request(apiPort, "POST", "/test-support/write/held", token);
    await wait("drain_gate", async () => existsSync(`${gatePath}.ready`));
  }
  if (postSealViteExit) {
    const stop = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "stop"], { windowsHide: true, stdio: "ignore" }); if (await waitExit(stop, "post_seal_stop_cli_exit") !== 0) throw new Error("post_seal_stop_cli_failed");
    await wait("post_seal_drain_gate", async () => existsSync(`${gatePath}.ready`) && existsSync(`${gatePath}.vite`));
    const descriptor = JSON.parse(readFileSync(`${gatePath}.vite`, "utf8")) as { pid?: unknown; expectedTestInjected?: unknown };
    if (typeof descriptor.pid !== "number" || descriptor.expectedTestInjected !== true || supervisor?.exitCode !== null) throw new Error("post_seal_vite_descriptor_invalid");
    unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
    if (!unrelated.pid || unrelated.exitCode !== null) throw new Error("post_seal_unrelated_process_not_alive");
    process.kill(descriptor.pid, "SIGTERM");
    writeFileSync(`${gatePath}.resume`, "resume\n", { flag: "wx" });
    const held = await heldRequest;
    if (held?.status !== 200) throw new Error("post_seal_held_request_did_not_complete");
  } else if (viteChildExit) {
    const descriptor = JSON.parse(readFileSync(viteChildPath, "utf8")) as { pid?: unknown; expectedTestInjected?: unknown };
    if (typeof descriptor.pid !== "number" || descriptor.expectedTestInjected !== true || readdirSync(backups).some((name) => name.startsWith("authority-checkpoint-"))) throw new Error("vite_child_descriptor_invalid");
    unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
    if (!unrelated.pid || unrelated.exitCode !== null) throw new Error("unrelated_process_not_alive");
    process.kill(descriptor.pid, "SIGTERM");
  } else {
    const stop = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "stop"], { windowsHide: true, stdio: "ignore" }); if (await waitExit(stop, "stop_cli_exit") !== 0) throw new Error("stop_cli_failed");
  }
  if (drainSuccess) {
    if (supervisor?.exitCode !== null || readdirSync(path.dirname(gatePath)).some((name) => name.startsWith("session-"))) throw new Error("active_request_not_draining");
    const lateWrite = await request(apiPort, "POST", "/prototype/repositories/recipients/write/create", token, { name: "late-disposable", aliases: null, email: null, phone: null, tillNumber: null, paybill: null, accountNumber: null, description: null, dryRunReviewed: true, confirmation: "create recipient in disposable sqlite" }).catch(() => ({ status: 0, body: undefined }));
    if (lateWrite.status === 200 || count(active) !== beforeRecipients + 1) throw new Error("post_shutdown_write_was_accepted");
    writeFileSync(`${gatePath}.resume`, "resume\n", { flag: "wx" });
    const held = await heldRequest;
    if (held?.status !== 200) throw new Error("held_request_did_not_complete");
  }
  if (drainTimeout) void heldRequest?.catch(() => undefined);
  if (receiptGate || missingReceipt || malformedReceipt || fingerprintFault) {
    await wait("receipt_gate", async () => existsSync(`${gatePath}.ready`));
    const sealedName = readdirSync(path.dirname(gatePath)).find((name) => name.startsWith("session-") && name.endsWith(".json"));
    const sealed = Boolean(sealedName);
    if (!sealed || readdirSync(backups).some((name) => name.startsWith("authority-checkpoint-")) || readFileSync(profilePath, "utf8") !== JSON.stringify(profile, null, 2) + "\n") throw new Error("receipt_gate_pre_resume_invariant_failed");
    if (missingReceipt) rmSync(path.join(path.dirname(gatePath), sealedName!));
    if (malformedReceipt) { const target = path.join(path.dirname(gatePath), sealedName!); const replacement = `${target}.replacement`; writeFileSync(replacement, "{", { flag: "wx" }); renameSync(replacement, target); }
    if (fingerprintFault) {
      const receipt = JSON.parse(readFileSync(path.join(path.dirname(gatePath), sealedName!), "utf8")) as { finalDatabaseFingerprint?: unknown };
      const beforeFingerprint = readSqliteLogicalVerificationAtPath(active).databaseIdentityFingerprint;
      if (receipt.finalDatabaseFingerprint !== beforeFingerprint) throw new Error("receipt_gate_initial_fingerprint_mismatch");
      const external = new Database(active); try { external.prepare("INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)").run("external-disposable", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z"); } finally { external.close(); }
      if (readSqliteLogicalVerificationAtPath(active).databaseIdentityFingerprint === beforeFingerprint || existsSync(`${active}-wal`) || existsSync(`${active}-shm`)) throw new Error("receipt_gate_external_change_not_verified");
    }
    writeFileSync(`${gatePath}.resume`, "resume\n", { flag: "wx" });
    acceptanceFencePending = false;
  }
  if (acceptanceFence) {
    await wait("checkpoint_acceptance_gate", async () =>
      existsSync(`${gatePath}.ready`) && existsSync(`${gatePath}.paths`),
    );
    acceptancePaths = JSON.parse(
      readFileSync(`${gatePath}.paths`, "utf8"),
    ) as { active: string; safety: string; candidate: string };
    if (
      acceptancePaths.active !== active ||
      path.dirname(acceptancePaths.safety) !== backups ||
      path.dirname(acceptancePaths.candidate) !== backups
    ) {
      throw new Error("checkpoint_acceptance_paths_invalid");
    }
    acceptanceFingerprints = Object.fromEntries(
      Object.values(acceptancePaths).map((databasePath) => {
        const verification =
          readSqliteLogicalVerificationAtPath(databasePath);
        if (verification.journalMode.toLowerCase() !== "delete") {
          throw new Error("checkpoint_acceptance_journal_mode_unexpected");
        }
        return [
          databasePath,
          {
            logical:
              readCanonicalAuthorityLogicalFingerprintAtPath(databasePath),
            database: verification.databaseIdentityFingerprint,
            journalMode: verification.journalMode,
          },
        ];
      }),
    );
    for (const [kind, databasePath] of Object.entries(acceptancePaths)) {
      const marker = `${gatePath}.${kind}-writer`;
      const writer = spawn(
        process.execPath,
        [
          tsx,
          externalWriter,
          "--sqlite",
          databasePath,
          "--name",
          `external-disposable-acceptance-${kind}`,
          "--marker",
          marker,
          "--busy-timeout",
          "100",
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      if (
        (await waitExit(writer, `checkpoint_acceptance_${kind}_writer`)) !==
          75 ||
        !existsSync(`${marker}.attempting`) ||
        existsSync(`${marker}.committed`)
      ) {
        throw new Error(`checkpoint_acceptance_${kind}_writer_not_blocked`);
      }
      const expected = acceptanceFingerprints[databasePath];
      if (
        readCanonicalAuthorityLogicalFingerprintAtPath(databasePath) !==
          expected.logical ||
        readSqliteLogicalVerificationAtPath(databasePath)
          .databaseIdentityFingerprint !== expected.database ||
        readSqliteLogicalVerificationAtPath(databasePath).journalMode !==
          expected.journalMode
      ) {
        throw new Error(`checkpoint_acceptance_${kind}_changed`);
      }
    }
    writeFileSync(`${gatePath}.resume`, "resume\n", { flag: "wx" });
  }
  const supervisorExit = await waitExit(supervisor!, "supervisor_exit"); supervisor = undefined;
  if (finalCleanupControlCloseFailure || finalCleanupDescriptorFailure || finalCleanupLockReleaseFailure || finalCleanupRaceDescriptorFailure) {
    const descriptorExpected = finalCleanupControlCloseFailure || finalCleanupDescriptorFailure || finalCleanupRaceDescriptorFailure;
    const lockExpected = finalCleanupLockReleaseFailure;
    const sequence = readSqliteAuthorityManifestDescriptor(readAuthorityOpsProfile(profilePath).authorityManifestPath!).checkpointSequence;
    const expectedSequence = finalCleanupLockReleaseFailure ? beforeSequence + 1 : beforeSequence;
    if (supervisorExit === 0 || !supervisorDiagnostics.includes(finalCleanupLockReleaseFailure ? "authority_lock_release_failed" : finalCleanupControlCloseFailure ? "authority_control_close_failed" : "authority_control_descriptor_cleanup_failed") || supervisorDiagnostics.includes("api_shutdown_request_failed_clean_shutdown_verified") || existsSync(controlPathForProfile(profilePath)) !== descriptorExpected || existsSync(`${profilePath}.lock`) !== lockExpected || sequence !== expectedSequence || count(active) !== beforeRecipients + 1) throw new Error("final_cleanup_fail_closed_invariant_failed");
    const retry = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "run"], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(retry, "final_cleanup_restart_refusal") === 0) throw new Error("final_cleanup_state_did_not_block_restart");
    console.log(`Authority real-process final-cleanup ${finalCleanupLockReleaseFailure ? "lock-release" : finalCleanupControlCloseFailure ? "control-close" : "descriptor"}-failure test: PASS`);
  } else if (postSealViteExit) {
    const artifacts = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") || name.startsWith("authority-safety-before-checkpoint-"));
    const receipts = readdirSync(path.join(root, ".authority-ops-runtime")).filter((name) => name.startsWith("session-") && name.endsWith(".json"));
    if (supervisorExit === 0 || !supervisorDiagnostics.includes("vite_exit_unexpected_during_seal") || artifacts.length !== beforeCheckpoints || receipts.length !== 1 || readFileSync(profilePath, "utf8") !== originalProfile || readSqliteAuthorityManifestDescriptor(initialManifest).checkpointSequence !== beforeSequence || count(active) !== beforeRecipients + 1 || unrelated?.exitCode !== null || existsSync(controlPathForProfile(profilePath))) throw new Error("post_seal_vite_exit_fail_closed_invariant_failed");
    const retry = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "run"], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(retry, "post_seal_vite_restart_refusal") === 0) throw new Error("post_seal_vite_changed_database_restart_not_refused");
    console.log("Authority real-process post-seal unexpected-Vite-exit test: PASS");
  } else if (viteChildExit) {
    const artifacts = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") || name.startsWith("authority-safety-before-checkpoint-"));
    const childExit = JSON.parse(readFileSync(`${viteChildPath}.exit`, "utf8")) as { pid?: unknown; code?: unknown; signal?: unknown; expectedTestInjected?: unknown };
    const receipts = readdirSync(path.join(root, ".authority-ops-runtime")).filter((name) => name.startsWith("session-") && name.endsWith(".json"));
    if (supervisorExit === 0 || artifacts.length !== beforeCheckpoints || receipts.length !== 0 || readFileSync(profilePath, "utf8") !== originalProfile || readSqliteAuthorityManifestDescriptor(initialManifest).checkpointSequence !== beforeSequence || count(active) !== beforeRecipients + 1 || unrelated?.exitCode !== null || childExit.expectedTestInjected !== true || existsSync(viteChildPath)) throw new Error("vite_child_fail_closed_invariant_failed");
    const retry = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "run"], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(retry, "vite_restart_refusal") === 0) throw new Error("vite_changed_database_restart_not_refused");
    unlinkSync(`${viteChildPath}.exit`);
    console.log("Authority real-process unexpected-Vite-exit test: PASS");
  } else if (missingReceipt || malformedReceipt || fingerprintFault || zeroMutationChange || quiescenceFault || checkpointBackupFault || checkpointVerificationFault || profileRotationFault || drainTimeout || receiptWithoutExit || shutdownRequestRaceFailure || mixedBeforeFirst || mixedAfterApproved || mixedBetweenApproved || mixedConcurrent) {
    const artifacts = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") || name.startsWith("authority-safety-before-checkpoint-"));
    const expectedRecipients = beforeRecipients + (fingerprintFault || mixedAfterApproved || mixedBetweenApproved || mixedConcurrent ? 2 : 1);
    const expectedArtifacts = beforeCheckpoints + (checkpointBackupFault ? 2 : checkpointVerificationFault ? 4 : profileRotationFault ? 4 : 0);
    const backupNames = readdirSync(backups);
    const checkpointBackups = backupNames.filter((name) => name.startsWith("authority-checkpoint-") && name.endsWith(".sqlite"));
    const checkpointManifests = backupNames.filter((name) => name.startsWith("authority-checkpoint-") && name.endsWith(".manifest.json"));
    const safetyBackups = backupNames.filter((name) => name.startsWith("authority-safety-before-checkpoint-") && name.endsWith(".sqlite"));
    const safetyManifests = backupNames.filter((name) => name.startsWith("authority-safety-before-checkpoint-") && name.endsWith(".manifest.json"));
    const previousProfiles = readdirSync(root).filter((name) => name.startsWith("authority-profile.json.") && name.endsWith(".bak"));
    const temporaryProfiles = readdirSync(root).filter((name) => name.startsWith("authority-profile.json.tmp-"));
    const rotationArtifactsValid = !profileRotationFault || (checkpointBackups.length === 1 && checkpointManifests.length === 1 && safetyBackups.length === 1 && safetyManifests.length === 1 && previousProfiles.length === 1 && temporaryProfiles.length === 0);
    const acceptedSequenceUnchanged = readSqliteAuthorityManifestDescriptor(initialManifest).checkpointSequence === beforeSequence;
    const lifecycleReceipts = readdirSync(path.join(root, ".authority-ops-runtime")).filter((name) => name.startsWith("session-") && name.endsWith(".json"));
    if (supervisorExit === 0 || (shutdownRequestRaceFailure && !supervisorDiagnostics.includes("api_shutdown_request_failed_shutdown_proof_failed:api_exit_abnormal")) || artifacts.length !== expectedArtifacts || ((drainTimeout || mixedBeforeFirst || mixedAfterApproved || mixedBetweenApproved || mixedConcurrent || zeroMutationChange || shutdownRequestRaceFailure) && lifecycleReceipts.length !== 0) || (receiptWithoutExit && lifecycleReceipts.length !== 1) || readFileSync(profilePath, "utf8") !== originalProfile || sha256(source) !== sourceBefore || count(active) !== expectedRecipients || existsSync(controlPathForProfile(profilePath)) || !rotationArtifactsValid || !acceptedSequenceUnchanged) throw new Error("receipt_fault_fail_closed_invariant_failed");
    const retry = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "run"], { windowsHide: true, stdio: "ignore" });
    if (await waitExit(retry, "receipt_fault_restart_refusal") === 0) throw new Error("receipt_fault_restart_not_refused");
    console.log(`Authority real-process ${mixedBeforeFirst ? "mixed-before-first" : mixedAfterApproved ? "mixed-after-approved" : mixedBetweenApproved ? "mixed-between-approved" : mixedConcurrent ? "mixed-concurrent" : receiptWithoutExit ? "receipt-without-exit" : drainTimeout ? "drain-timeout" : profileRotationFault ? "profile-rotation-fault" : checkpointVerificationFault ? "checkpoint-verification-fault" : checkpointBackupFault ? "checkpoint-backup-fault" : quiescenceFault ? "quiescence-fault" : zeroMutationChange ? "zero-mutation-change" : fingerprintFault ? "fingerprint-disagreement" : malformedReceipt ? "malformed" : "missing"}-receipt test: PASS`);
  } else {
  if (supervisorExit !== 0) { const code = /(?:authority|shutdown|mutation|checkpoint|api|clean)_[a-z_]+/.exec(supervisorDiagnostics)?.[0] ?? "failed"; throw new Error(`changed_supervisor_${code}`); }
  if (shutdownRequestRace && (!supervisorDiagnostics.includes("api_shutdown_request_failed_clean_shutdown_verified") || !cleanRaceDiagnosticAfterFinalCleanup)) throw new Error("shutdown_request_race_not_proof_reconciled");
  const updated = readAuthorityOpsProfile(profilePath); if (!updated.authorityManifestPath) throw new Error("profile_manifest_missing"); const after = readSqliteAuthorityManifestDescriptor(updated.authorityManifestPath); const checkpoints = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") && name.endsWith(".manifest.json")); const safety = readdirSync(backups).filter((name) => name.startsWith("authority-safety-before-checkpoint-") && name.endsWith(".sqlite"));
  const sessions = readdirSync(path.join(root, ".authority-ops-runtime")).filter((name) => name.startsWith("session-") && name.endsWith(".json")); const receipt = JSON.parse(readFileSync(path.join(root, ".authority-ops-runtime", sessions[0]), "utf8")) as { cleanShutdown?: unknown; mutationProofVersion?: unknown; approvedCommittedMutationCount?: unknown; startingLogicalFingerprint?: unknown; finalLogicalFingerprint?: unknown; mutationChainDigest?: unknown; confirmedMutationCount?: unknown; domainCounters?: { transactions?: unknown; recipients?: unknown; budgets?: unknown; budgetSnapshots?: unknown } };
  const counters: Record<string, unknown> = receipt.domainCounters ?? {}; const counterSum = Object.values(counters).reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
  const acceptedManifest = JSON.parse(readFileSync(updated.authorityManifestPath, "utf8")) as { backupFileName?: unknown };
  const acceptedBackup = typeof acceptedManifest.backupFileName === "string" ? path.join(path.dirname(updated.authorityManifestPath), acceptedManifest.backupFileName) : "";
  const activeLogical = readCanonicalAuthorityLogicalFingerprintAtPath(active);
  const backupLogical = acceptedBackup ? readCanonicalAuthorityLogicalFingerprintAtPath(acceptedBackup) : "";
  if (after.checkpointSequence !== beforeSequence + 1 || checkpoints.length !== beforeCheckpoints + 1 || safety.length !== 1 || receipt.cleanShutdown !== true || receipt.mutationProofVersion !== 1 || receipt.approvedCommittedMutationCount !== writeCount || receipt.confirmedMutationCount !== writeCount || counters.recipients !== (recipientActiveSmsProcess ? 3 : routeFamilies || transactionDeleteProcess || accountLifecycleProcess || categoryLifecycleProcess || bucketLifecycleProcess || transferLifecycleProcess || budgetDefinitionProcess || occurrenceCreateDeleteProcess || occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess || occurrenceCreateAndLinkProcess || budgetFromTransactionProcess || snapshotGenerationProcess ? 1 : recipientLifecycleProcess ? 6 : writeCount) || (budgetDefinitionProcess && counters.budgets !== 3) || ((occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess || occurrenceCreateAndLinkProcess || budgetFromTransactionProcess) && (counters.buckets !== 1 || counters.categories !== 1 || counters.accounts !== 1 || counters.recipients !== 1 || counters.budgets !== 1 || counters.budgetSnapshots !== (occurrenceChangeLinkProcess || occurrenceUnlinkProcess ? 2 : 1) || counters.transactions !== (occurrenceUnlinkProcess ? 4 : occurrenceChangeLinkProcess ? 3 : 2) || (!occurrenceCreateAndLinkProcess && !budgetFromTransactionProcess && counterSum !== writeCount))) || (routeFamilies && (counters.budgets !== 2 || counters.budgetSnapshots !== 2)) || (!routeFamilies && !recipientLifecycleProcess && !accountLifecycleProcess && !categoryLifecycleProcess && !bucketLifecycleProcess && !recipientActiveSmsProcess && !transferLifecycleProcess && !budgetDefinitionProcess && !occurrenceCreateDeleteProcess && !occurrenceLinkProcess && !occurrenceChangeLinkProcess && !occurrenceUnlinkProcess && !occurrenceCreateAndLinkProcess && !budgetFromTransactionProcess && counterSum !== writeCount) || typeof receipt.startingLogicalFingerprint !== "string" || typeof receipt.mutationChainDigest !== "string" || receipt.finalLogicalFingerprint !== activeLogical || backupLogical !== activeLogical) throw new Error("automatic_checkpoint_or_tracker_failed");
  const verify = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "verify"], { windowsHide: true, stdio: "ignore" }); if (await waitExit(verify, "checkpoint_verify_exit") !== 0) throw new Error("checkpoint_verify_failed");
  start(); await wait("restart_readiness", async () => existsSync(controlPathForProfile(profilePath)) && (await request(apiPort, "GET", "/health").catch(() => ({ status: 0 }))).status === 200); if (count(active) !== beforeRecipients + (routeFamilies || transactionDeleteProcess || recipientLifecycleProcess || accountLifecycleProcess || categoryLifecycleProcess || bucketLifecycleProcess || recipientActiveSmsProcess || transferLifecycleProcess || budgetDefinitionProcess || occurrenceCreateDeleteProcess || occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess || occurrenceCreateAndLinkProcess || budgetFromTransactionProcess || snapshotGenerationProcess ? 1 : writeCount) || (transactionDeleteProcess && tableCount(active, "transactions") !== 0) || ((recipientLifecycleProcess || accountLifecycleProcess || categoryLifecycleProcess || bucketLifecycleProcess || occurrenceLinkProcess || occurrenceChangeLinkProcess || occurrenceUnlinkProcess || occurrenceCreateAndLinkProcess || budgetFromTransactionProcess) && tableCount(active, "transactions") !== 1) || (transferLifecycleProcess && tableCount(active, "transactions") !== 2)) throw new Error("restart_write_not_persisted"); if (occurrenceLinkExpected) { const restarted = new Database(active, { readonly: true }); try { const row = restarted.prepare("SELECT budgetSnapshotId, budgetId, occurrenceDate, isTransfer, accountId, categoryId, recipientId, amount, date, description FROM transactions WHERE id = ?").get(occurrenceLinkExpected.transactionId) as { budgetSnapshotId: number | null; budgetId: number | null; occurrenceDate: string | null; isTransfer: number; accountId: number; categoryId: number; recipientId: number; amount: number; date: string; description: string } | undefined; const previousLinks = occurrenceLinkExpected.previousSnapshotId === undefined ? 0 : Number((restarted.prepare("SELECT COUNT(*) AS count FROM transactions WHERE budgetSnapshotId = ?").get(occurrenceLinkExpected.previousSnapshotId) as { count: number }).count); const anyLinks = occurrenceLinkExpected.snapshotId === null ? Number((restarted.prepare("SELECT COUNT(*) AS count FROM transactions WHERE id = ? AND budgetSnapshotId IS NOT NULL").get(occurrenceLinkExpected.transactionId) as { count: number }).count) : 0; if (!row || previousLinks !== 0 || anyLinks !== 0 || row.budgetSnapshotId !== occurrenceLinkExpected.snapshotId || (occurrenceLinkExpected.snapshotId === null ? (row.budgetId !== null || row.occurrenceDate !== null) : row.budgetId !== occurrenceLinkExpected.budgetId) || row.isTransfer !== 0 || row.accountId !== occurrenceLinkExpected.accountId || row.categoryId !== occurrenceLinkExpected.categoryId || row.recipientId !== occurrenceLinkExpected.recipientId || row.amount !== occurrenceLinkExpected.amount || row.date !== occurrenceLinkExpected.date || row.description !== occurrenceLinkExpected.description) throw new Error("occurrence_link_restart_state_invalid"); } finally { restarted.close(); } } const stopTwo = spawn(process.execPath, [tsx, cli, "--profile", profilePath, "stop"], { windowsHide: true, stdio: "ignore" }); if (await waitExit(stopTwo, "second_stop_cli_exit") !== 0) throw new Error("second_stop_cli_failed"); if (await waitExit(supervisor!, "restart_supervisor_exit") !== 0) throw new Error("restart_supervisor_exit_failed"); supervisor = undefined;
  if (readSqliteAuthorityManifestDescriptor(readAuthorityOpsProfile(profilePath).authorityManifestPath!).checkpointSequence !== after.checkpointSequence || existsSync(controlPathForProfile(profilePath)) || existsSync(`${profilePath}.lock`) || existsSync(`${active}-wal`) || existsSync(`${active}-shm`) || (acceptancePaths && Object.values(acceptancePaths).some((databasePath) => existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`))) || readdirSync(path.dirname(profilePath)).some((name) => name.startsWith(`${path.basename(profilePath)}.tmp-`) || name.startsWith(`${path.basename(profilePath)}.restore-`)) || (await request(apiPort, "GET", "/health").catch(() => ({ status: 0 }))).status === 200) throw new Error("restart_cleanup_or_extra_checkpoint_failed");
  if (receiptGate) {
    const counts = JSON.parse(readFileSync(`${gatePath}.counts`, "utf8")) as { seal?: unknown; abort?: unknown; apiTerminations?: unknown; viteTerminations?: unknown };
    if (counts.seal !== 1 || counts.abort !== 0 || counts.apiTerminations !== 0 || counts.viteTerminations !== 1) throw new Error("shutdown_transition_count_failed");
    unlinkSync(`${gatePath}.counts`);
  }
  console.log(`Authority real-process ${budgetFromTransactionProcess ? "budget-from-transaction " : occurrenceUnlinkProcess ? "occurrence-unlink " : occurrenceChangeLinkProcess ? "occurrence-change-link " : occurrenceLinkProcess ? "occurrence-link " : transferLifecycleProcess ? "transfer-lifecycle " : recipientActiveSmsProcess ? "recipient-active-sms " : bucketLifecycleProcess ? "bucket-lifecycle " : categoryLifecycleProcess ? "category-lifecycle " : accountLifecycleProcess ? "account-lifecycle " : recipientLifecycleProcess ? "recipient-lifecycle " : transactionDeleteProcess ? "transaction-delete " : routeFamilies ? "route-families " : noOpRollback ? "no-op-rollback " : acceptanceFence ? "acceptance-fence " : viteChildExit ? "vite-child-exit " : receiptGate ? "receipt-gate " : ""}${writeCount}-write checkpoint test: PASS`);
  }
  }
} finally { if (supervisor) await terminateOwnedChild(supervisor, "supervisor_cleanup"); if (unrelated) await terminateOwnedChild(unrelated, "unrelated_cleanup"); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }

import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import { authorityProfileIdentity, controlPathForProfile } from "./lib/authorityOpsControl.js";
import { AUTHORITY_REQUIRED_CAPABILITY_NAMES } from "./lib/authorityOpsCapabilities.js";
import { AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, writeAuthorityOpsProfileAtomic, type AuthorityOpsProfile } from "./lib/authorityOpsProfile.js";
import { prepareSqliteAuthorityCutover } from "./lib/sqliteAuthorityCutover.js";
import { currentAuthorityBuildReceipt } from "./lib/authorityOpsBuild.js";
import { writeJsonAtomic } from "./lib/authorityOpsSession.js";
import { terminateOwnedTestChild, waitForChildExit } from "./lib/authorityTestProcessWait.js";

const reservePort = () => new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("port_unavailable"))); }); });
const wait = async (stage: string, work: () => Promise<boolean>, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await work()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`${stage}_timeout`); };
const health = (port: number) => new Promise<boolean>((resolve) => { const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 500 }, (response) => { response.resume(); resolve(response.statusCode === 200); }); request.on("error", () => resolve(false)); request.on("timeout", () => { request.destroy(); resolve(false); }); });
const post = (port: number, pathname: string, token?: string) => new Promise<{ status: number; body: unknown }>((resolve, reject) => { const request = http.request({ host: "127.0.0.1", port, path: pathname, method: "POST", timeout: 1_000, headers: { ...(token ? { "x-personal-finance-token": token } : {}), "content-length": "0" } }, (response) => { let data = ""; response.on("data", (chunk) => { data += chunk; }); response.on("end", () => { try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) }); } catch { reject(new Error("signal_response_invalid")); } }); }); request.on("error", reject); request.on("timeout", () => request.destroy(new Error("signal_request_timeout"))); request.end(); });
const tables = Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((table) => [table, []]));
const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-process-"));
const profilePath = path.join(root, "authority-profile.json"); const active = path.join(root, "runtime", "active.sqlite"); const backups = path.join(root, "backups"); const token = path.join(root, "token"); const source = path.join(root, "source.json"); const manifest = path.join(backups, "cutover.manifest.json");
let child: ReturnType<typeof spawn> | undefined;
let supervisorOutput = "";
const lockReleaseFailure = process.argv.includes("--lock-release-failure");
const supervisedChildSignals = process.argv.includes("--supervised-child-signals");
const startupInterrupt = process.argv.includes("--startup-interrupt-after-api");
const duplicateDrainInterrupt = process.argv.includes("--duplicate-interrupt-drain");
const duplicateFinalCleanupInterrupt = process.argv.includes("--duplicate-interrupt-final-cleanup");
try {
  mkdirSync(path.dirname(active), { recursive: true }); mkdirSync(backups, { recursive: true });
  const fixtureDatabase = new Database(active); try { fixtureDatabase.exec(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"), "utf8")); } finally { fixtureDatabase.close(); } writeFileSync(source, JSON.stringify({ tables, integrity: { counts: Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((table) => [table, 0])) } }), "utf8"); writeFileSync(token, "disposable-test-token\n", "utf8");
  await prepareSqliteAuthorityCutover({ sourceBackupPath: source, candidatePath: active, backupOutputPath: path.join(backups, "cutover.sqlite"), manifestPath: manifest, asOf: new Date(2026, 6, 27) });
  const apiPort = await reservePort(); let vitePort = await reservePort(); while (vitePort === apiPort) vitePort = await reservePort();
  const profile: AuthorityOpsProfile = { schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, mode: "authoritative", activeDatabasePath: active, authorityManifestPath: manifest, sourceBackupPath: source, tokenFilePath: token, backupDirectory: backups, apiHost: "127.0.0.1", apiPort, viteHost: "127.0.0.1", vitePort, enabledWriteCapabilities: [...AUTHORITY_REQUIRED_CAPABILITY_NAMES] };
  writeAuthorityOpsProfileAtomic(profilePath, profile);
  writeJsonAtomic(path.join(root, ".authority-ops-runtime", "build-receipt.json"), currentAuthorityBuildReceipt());
  const sourceRoot = path.dirname(fileURLToPath(import.meta.url)); const tsx = path.join(sourceRoot, "..", "node_modules", "tsx", "dist", "cli.mjs"); const faultRunner = path.join(sourceRoot, "..", "test-support", "authorityOpsFaultRunner.ts"); const signalGate = path.join(root, ".authority-ops-runtime", "signal-shutdown");
  const checkpointCountBefore = readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") && name.endsWith(".manifest.json")).length;
  const scenario = startupInterrupt ? "startup-interrupt-after-api" : duplicateDrainInterrupt ? "duplicate-interrupt-drain" : duplicateFinalCleanupInterrupt ? "duplicate-interrupt-final-cleanup" : supervisedChildSignals ? "supervised-child-signals" : lockReleaseFailure ? "signal-final-cleanup-lock-release-failure" : "signal-shutdown";
  const runnerArgs = [tsx, faultRunner, "--profile", profilePath, "--scenario", scenario, "--gate", signalGate];
  child = spawn(process.execPath, runnerArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk: Buffer) => { supervisorOutput += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { supervisorOutput += chunk.toString("utf8"); });
  if (!startupInterrupt) {
    try {
      await wait("unchanged_session_readiness", async () => existsSync(`${signalGate}.ready`) && existsSync(controlPathForProfile(profilePath)) && await health(apiPort) && (!supervisedChildSignals || await health(vitePort)));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "unchanged_session_readiness_failed");
    }
  }
  const before = readFileSync(profilePath, "utf8");
  if (supervisedChildSignals) {
    const apiSignal = await post(apiPort, "/test-support/signal/inherited", "disposable-test-token");
    const viteSignal = await post(vitePort, "/test-support/signal/inherited");
    const apiBody = apiSignal.body as { ok?: unknown; sigintListeners?: unknown; sigbreakListeners?: unknown };
    const viteBody = viteSignal.body as { ok?: unknown; sigintListeners?: unknown; sigbreakListeners?: unknown };
    if (apiSignal.status !== 200 || viteSignal.status !== 200 || apiBody.ok !== true || viteBody.ok !== true || !Number.isInteger(apiBody.sigintListeners) || !Number.isInteger(apiBody.sigbreakListeners) || !Number.isInteger(viteBody.sigintListeners) || !Number.isInteger(viteBody.sigbreakListeners) || Number(apiBody.sigintListeners) < 1 || Number(apiBody.sigbreakListeners) < 1 || Number(viteBody.sigintListeners) < 1 || Number(viteBody.sigbreakListeners) < 1 || !(await health(apiPort)) || !(await health(vitePort))) throw new Error("supervised_child_console_signal_not_isolated");
  }
  if (!startupInterrupt) writeFileSync(`${signalGate}.resume`, "resume\n", { flag: "wx" });
  const exit = await waitForChildExit(child, "unchanged_supervisor_exit"); child = undefined;
  if ((startupInterrupt && exit === 0) || (!startupInterrupt && !lockReleaseFailure && exit !== 0) || (lockReleaseFailure && (exit === 0 || !supervisorOutput.includes("authority_lock_release_failed")))) throw new Error("unchanged_supervisor_signal_exit_failed");
  if (readFileSync(profilePath, "utf8") !== before || readdirSync(backups).filter((name) => name.startsWith("authority-checkpoint-") && name.endsWith(".manifest.json")).length !== checkpointCountBefore || existsSync(controlPathForProfile(profilePath)) || existsSync(`${active}-wal`) || existsSync(`${active}-shm`) || existsSync(`${profilePath}.lock`) !== lockReleaseFailure || (supervisedChildSignals && supervisorOutput.includes("api_exit_abnormal"))) throw new Error("unchanged_session_cleanup_or_profile_failed");
  if (await health(apiPort) || await health(vitePort)) throw new Error("fixture_port_still_occupied");
  if (authorityProfileIdentity(profilePath).length !== 64) throw new Error("profile_identity_invalid");
  console.log(`Authority real-process unchanged-session ${startupInterrupt ? "startup-interrupt" : duplicateDrainInterrupt ? "duplicate-interrupt-drain" : duplicateFinalCleanupInterrupt ? "duplicate-final-cleanup-interrupt" : supervisedChildSignals ? "supervised-child-signal" : lockReleaseFailure ? "lock-release-failure" : "Ctrl+C-equivalent"} test: PASS`);
} finally {
  if (child) await terminateOwnedTestChild(child, "unchanged_fixture_cleanup");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 }); break; }
    catch { if (attempt === 9) console.error("process_fixture_cleanup_pending"); else await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
}

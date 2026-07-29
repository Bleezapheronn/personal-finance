import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { FULL_BACKUP_TABLE_NAMES } from "../src/lib/backup.js";
import { prepareSqliteAuthorityCutover } from "../src/lib/sqliteAuthorityCutover.js";
import { readSqliteAuthorityManifestDescriptor } from "../src/lib/sqliteAuthorityCutover.js";
import { readCanonicalAuthorityLogicalFingerprintAtPath, readSqliteLogicalVerificationAtPath } from "../src/lib/sqliteLogicalVerification.js";
import { AUTHORITY_REQUIRED_CAPABILITY_NAMES } from "../src/lib/authorityOpsCapabilities.js";
import { AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, writeAuthorityOpsProfileAtomic, type AuthorityOpsProfile } from "../src/lib/authorityOpsProfile.js";
import { authorityProfileIdentity } from "../src/lib/authorityOpsControl.js";
import { buildAuthorityOpsStartPlan } from "../src/lib/authorityOps.js";
import { createAuthorityApiChildPlan } from "../src/lib/authorityApiChildPlan.js";
import type { AuthoritySessionContext } from "../src/lib/authorityOpsSession.js";
import { terminateOwnedTestChild } from "../src/lib/authorityTestProcessWait.js";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

export type AuthorityApiChildKind = "crash-api" | "lifecycle-api";
const availablePort = () => new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("port_unavailable"))); }); });
export const createDisposableAuthorityApiChildFixture = async (kind: AuthorityApiChildKind) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-api-child-fixture-"));
  const databasePath = path.join(root, "runtime", "active.sqlite"); const backups = path.join(root, "backups"); const source = path.join(root, "source.json"); const manifestPath = path.join(backups, "cutover.manifest.json"); const tokenPath = path.join(root, "token");
  mkdirSync(path.dirname(databasePath), { recursive: true }); mkdirSync(backups, { recursive: true });
  const database = new Database(databasePath); try { database.exec(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"), "utf8")); } finally { database.close(); }
  writeFileSync(source, JSON.stringify({ tables: Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, []])), integrity: { counts: Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, 0])) } }));
  await prepareSqliteAuthorityCutover({ sourceBackupPath: source, candidatePath: databasePath, backupOutputPath: path.join(backups, "cutover.sqlite"), manifestPath, asOf: new Date(2026, 6, 27) });
  const token = "disposable-api-child-token"; writeFileSync(tokenPath, `${token}\n`);
  const apiPort = await availablePort(); let vitePort = await availablePort(); while (vitePort === apiPort) vitePort = await availablePort();
  const profilePath = path.join(root, "authority-profile.json");
  const profile: AuthorityOpsProfile = { schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION, mode: "authoritative", activeDatabasePath: databasePath, authorityManifestPath: manifestPath, sourceBackupPath: source, tokenFilePath: tokenPath, backupDirectory: backups, apiHost: "127.0.0.1", apiPort, viteHost: "127.0.0.1", vitePort, enabledWriteCapabilities: [...AUTHORITY_REQUIRED_CAPABILITY_NAMES] };
  writeAuthorityOpsProfileAtomic(profilePath, profile);
  for (const value of [root, databasePath, tokenPath, manifestPath, profilePath]) requireDisposablePath(value, "authority_test_fixture_not_disposable");
  const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
  const context: AuthoritySessionContext = { version: 1, sessionId: "disposable-api-child-session", profileIdentity: authorityProfileIdentity(profilePath), receiptPath: path.join(root, ".authority-ops-runtime", "receipts", "session-disposable.json"), startingCheckpointId: descriptor.checkpointId, startingCheckpointSequence: descriptor.checkpointSequence, startingDatabaseFingerprint: readSqliteLogicalVerificationAtPath(databasePath).databaseIdentityFingerprint, startingLogicalFingerprint: readCanonicalAuthorityLogicalFingerprintAtPath(databasePath), startedAt: "2026-07-27T00:00:00.000Z" };
  const startPlan = buildAuthorityOpsStartPlan(profile, profilePath);
  const plan = createAuthorityApiChildPlan({ startPlan, sessionContext: context, sessionSecret: "disposable-session-secret-32-bytes-minimum" });
  const support = path.dirname(fileURLToPath(import.meta.url)); const tsx = path.join(support, "..", "node_modules", "tsx", "dist", "cli.mjs"); const entrypoint = path.join(support, kind === "crash-api" ? "authorityOpsCrashApiChild.ts" : "authorityOpsLifecycleApiChild.ts");
  const cleanup = async (child?: ChildProcess) => {
    if (child) await terminateOwnedTestChild(child, `${kind}_fixture_cleanup`);
    if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) throw new Error("authority_api_child_fixture_sqlite_sidecar_remained");
    rmSync(root, { recursive: true, force: true });
  };
  return { root, profilePath, profile, databasePath, token, apiPort, startPlan, apiChildPlan: plan, childSpec: { executable: process.execPath, args: [tsx, entrypoint, "--port", String(apiPort), ...(kind === "lifecycle-api" ? ["--behavior", "normal"] : [])], cwd: plan.childSpec.cwd, env: plan.environment }, cleanup };
};

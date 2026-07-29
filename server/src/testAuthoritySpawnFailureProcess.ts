import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import { controlPathForProfile } from "./lib/authorityOpsControl.js";
import { AUTHORITY_REQUIRED_CAPABILITY_NAMES } from "./lib/authorityOpsCapabilities.js";
import { currentAuthorityBuildReceipt } from "./lib/authorityOpsBuild.js";
import {
  AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
  writeAuthorityOpsProfileAtomic,
  type AuthorityOpsProfile,
} from "./lib/authorityOpsProfile.js";
import { writeJsonAtomic } from "./lib/authorityOpsSession.js";
import {
  prepareSqliteAuthorityCutover,
  readSqliteAuthorityManifestDescriptor,
} from "./lib/sqliteAuthorityCutover.js";
import {
  terminateOwnedTestChild,
  waitForChildExit,
} from "./lib/authorityTestProcessWait.js";

const mode = process.argv.includes("--vite") ? "vite" : "api";
if (process.argv.slice(2).filter((value) => value === "--api" || value === "--vite").length !== 1) {
  throw new Error("authority_spawn_failure_mode_invalid");
}
const reservePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => typeof address === "object" && address
      ? resolve(address.port)
      : reject(new Error("port_unavailable")));
  });
});
const portFree = async (port: number): Promise<boolean> => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
});

const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-spawn-failure-"));
const profilePath = path.join(root, "authority-profile.json");
const active = path.join(root, "runtime", "active.sqlite");
const backups = path.join(root, "backups");
const tokenPath = path.join(root, "token");
const source = path.join(root, "source.json");
const manifest = path.join(backups, "cutover.manifest.json");
let runner: ReturnType<typeof spawn> | undefined;
let unrelated: ReturnType<typeof spawn> | undefined;
try {
  mkdirSync(path.dirname(active), { recursive: true });
  mkdirSync(backups, { recursive: true });
  const database = new Database(active);
  try {
    database.exec(readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"),
      "utf8",
    ));
  } finally {
    database.close();
  }
  const tables = Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, []]));
  writeFileSync(source, JSON.stringify({ tables, integrity: { counts: Object.fromEntries(FULL_BACKUP_TABLE_NAMES.map((name) => [name, 0])) } }), "utf8");
  writeFileSync(tokenPath, "disposable-test-token\n", "utf8");
  await prepareSqliteAuthorityCutover({
    sourceBackupPath: source,
    candidatePath: active,
    backupOutputPath: path.join(backups, "cutover.sqlite"),
    manifestPath: manifest,
    asOf: new Date(2026, 6, 27),
  });
  const apiPort = await reservePort();
  let vitePort = await reservePort();
  while (vitePort === apiPort) vitePort = await reservePort();
  const profile: AuthorityOpsProfile = {
    schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
    mode: "authoritative",
    activeDatabasePath: active,
    authorityManifestPath: manifest,
    sourceBackupPath: source,
    tokenFilePath: tokenPath,
    backupDirectory: backups,
    apiHost: "127.0.0.1",
    apiPort,
    viteHost: "127.0.0.1",
    vitePort,
    enabledWriteCapabilities: [...AUTHORITY_REQUIRED_CAPABILITY_NAMES],
  };
  writeAuthorityOpsProfileAtomic(profilePath, profile);
  writeJsonAtomic(path.join(root, ".authority-ops-runtime", "build-receipt.json"), currentAuthorityBuildReceipt());
  const originalProfile = readFileSync(profilePath, "utf8");
  const originalSequence = readSqliteAuthorityManifestDescriptor(manifest).checkpointSequence;
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tsx = path.join(sourceDirectory, "..", "node_modules", "tsx", "dist", "cli.mjs");
  const faultRunner = path.join(sourceDirectory, "..", "test-support", "authorityOpsFaultRunner.ts");
  unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  if (!unrelated.pid || unrelated.exitCode !== null) throw new Error("spawn_failure_unrelated_not_alive");
  let diagnostics = "";
  runner = spawn(process.execPath, [tsx, faultRunner, "--profile", profilePath, "--scenario", `${mode}-spawn-failure`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  runner.stderr?.on("data", (chunk: Buffer) => { diagnostics += chunk.toString("utf8").slice(0, 512); });
  const exit = await waitForChildExit(runner, `${mode}_spawn_failure_supervisor`, 20_000);
  runner = undefined;
  const artifacts = existsSync(backups)
    ? readFileSync(profilePath, "utf8") === originalProfile &&
      readSqliteAuthorityManifestDescriptor(manifest).checkpointSequence === originalSequence &&
      !existsSync(controlPathForProfile(profilePath)) &&
      !readdirSync(path.join(root, ".authority-ops-runtime")).some((name) => name.startsWith("session-") && name.endsWith(".json")) &&
      !existsSync(`${active}-wal`) && !existsSync(`${active}-shm`) &&
      !existsSync(`${profilePath}.lock`)
    : false;
  if (
    exit === 0 ||
    !diagnostics.includes(`${mode}_spawn_failed`) ||
    diagnostics.includes("Unhandled 'error' event") ||
    !artifacts ||
    unrelated.exitCode !== null ||
    !(await portFree(apiPort)) ||
    !(await portFree(vitePort))
  ) {
    throw new Error("authority_spawn_failure_fail_closed_invariant_failed");
  }
  console.log(`Authority real-process ${mode} spawn-failure test: PASS`);
} finally {
  if (runner) await terminateOwnedTestChild(runner, "spawn_failure_runner_cleanup");
  if (unrelated) await terminateOwnedTestChild(unrelated, "spawn_failure_unrelated_cleanup");
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

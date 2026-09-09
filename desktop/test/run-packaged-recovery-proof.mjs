import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const installer = process.argv[2];
if (!installer || !path.isAbsolute(installer) || !existsSync(installer)) {
  throw new Error("usage: node desktop/test/run-packaged-recovery-proof.mjs <absolute-installer-path>");
}

const proofRoot = process.env.PF124_PROOF_ROOT
  ? path.resolve(process.env.PF124_PROOF_ROOT)
  : path.join(os.tmpdir(), `pf124-packaged-recovery-proof-${Date.now()}`);
if (path.basename(proofRoot).toLowerCase().startsWith("pf124-packaged-recovery-proof-") && existsSync(proofRoot)) {
  rmSync(proofRoot, { recursive: true, force: true });
}
mkdirSync(proofRoot, { recursive: true });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (condition, code, timeoutMs = 30_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await condition()) return;
    await delay(250);
  }
  throw new Error(code);
};

const listenPort = async () => {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
};

const scheduledTime = () => {
  const target = new Date(Date.now() + 150_000);
  target.setSeconds(0, 0);
  if (target.getTime() - Date.now() < 90_000) target.setMinutes(target.getMinutes() + 1);
  return `${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
};

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..", "..");
const serverRequire = createRequire(path.join(repositoryRoot, "server", "package.json"));
const Database = serverRequire("better-sqlite3");
const scheduledBackup = await import(pathToFileURL(path.join(repositoryRoot, "server", "dist", "lib", "scheduledSqliteBackup.js")).href);
const profileRoot = path.join(proofRoot, "profile");
const installRoot = path.join(proofRoot, "installation");
const backupRoot = path.join(proofRoot, "backups");
const stagingRoot = path.join(proofRoot, "staging");
const sqlitePath = path.join(profileRoot, "personal-finance.sqlite");
const tokenPath = path.join(profileRoot, "local.token");
const runtimeConfigPath = path.join(profileRoot, "runtime.json");
const taskName = `PF-124 disposable recovery ${process.pid}`;
const apiPort = await listenPort();
const frontendPort = await listenPort();
let application;
let taskInstalled = false;

const userVersion = () => {
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    return Number(database.pragma("user_version", { simple: true }));
  } finally {
    database.close();
  }
};

const setUserVersion = (value) => {
  const database = new Database(sqlitePath);
  try {
    database.pragma(`user_version = ${value}`);
  } finally {
    database.close();
  }
};

try {
  mkdirSync(profileRoot, { recursive: true });
  const database = new Database(sqlitePath);
  try {
    database.exec(readFileSync(path.join(repositoryRoot, "server", "schema", "prototype-schema.sql"), "utf8"));
  } finally {
    database.close();
  }
  writeFileSync(tokenPath, "pf124-disposable-token\n", { encoding: "utf8" });
  writeFileSync(runtimeConfigPath, `${JSON.stringify({
    version: 1,
    sqlitePath,
    tokenFilePath: tokenPath,
    apiHost: "127.0.0.1",
    apiPort,
    frontendHost: "127.0.0.1",
    frontendPort,
  }, null, 2)}\n`);
  scheduledBackup.initializeBackupSettings(runtimeConfigPath, {
    destinationDirectory: backupRoot,
    stagingDirectory: stagingRoot,
    dailyLocalTime: scheduledTime(),
    taskName,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(installer, ["/S", `/D=${installRoot}`], { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`installer_exit_${code ?? "unknown"}`)));
  });
  const executable = path.join(installRoot, "Personal Finance.exe");
  if (!existsSync(executable)) throw new Error("installed_executable_missing");

  application = spawn(executable, [`--pf-profile-root=${profileRoot}`], {
    stdio: "ignore",
    windowsHide: true,
  });
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok;
    } catch {
      return false;
    }
  }, "packaged_api_not_ready");

  const api = async (method, endpoint, payload) => {
    const response = await fetch(`http://127.0.0.1:${apiPort}${endpoint}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-personal-finance-token": "pf124-disposable-token",
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, body: await response.json() };
  };

  const enabled = await api("POST", "/prototype/settings/automatic-backups/enable", {});
  if (enabled.status !== 200 || enabled.body?.state?.scheduler?.installed !== true) {
    throw new Error("packaged_scheduler_install_failed");
  }
  taskInstalled = true;
  const taskXml = execFileSync("schtasks.exe", ["/Query", "/TN", taskName, "/XML"], {
    encoding: "utf8",
    windowsHide: true,
  }).toLowerCase();
  if (!taskXml.includes("personal finance.exe") || !taskXml.includes("--pf-run-scheduled-backup") || taskXml.includes("tsx") || taskXml.includes("runtimebackup.ts")) {
    throw new Error("packaged_scheduler_command_invalid");
  }

  await waitFor(() => {
    const statusPath = path.join(profileRoot, "backup-status.json");
    if (!existsSync(statusPath)) return false;
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    return status.lastResultCode === "pass" && typeof status.lastSuccessfulAt === "string";
  }, "natural_scheduler_backup_not_verified", 300_000);
  const inventory = scheduledBackup.inventoryScheduledBackups(runtimeConfigPath);
  if (!inventory.some((item) => item.valid)) throw new Error("scheduled_backup_inventory_invalid");

  setUserVersion(8);
  const restoreState = await api("GET", "/prototype/settings/restore/state");
  const candidate = restoreState.body?.state?.candidates?.[0];
  if (restoreState.status !== 200 || !candidate?.candidateId) throw new Error("restore_candidate_unavailable");
  const prepared = await api("POST", "/prototype/settings/restore/prepare", { candidateId: candidate.candidateId });
  if (prepared.status !== 200 || !prepared.body?.session?.planId) throw new Error("restore_prepare_failed");
  const session = prepared.body.session;
  const armed = await api("POST", "/prototype/settings/restore/arm", {
    action: "restore",
    sessionId: session.sessionId,
    planId: session.planId,
    confirmationText: `RESTORE ${session.selected.basename}`,
  });
  if (armed.status !== 202) throw new Error("restore_arm_failed");
  await waitFor(async () => {
    try {
      const state = await api("GET", "/prototype/settings/restore/state");
      return state.status === 200 && state.body?.state?.session?.phase === "awaiting-verification";
    } catch {
      return false;
    }
  }, "packaged_restore_restart_not_verified");
  if (userVersion() !== 0) throw new Error("packaged_restore_not_applied");

  const accepted = await api("POST", "/prototype/settings/restore/accept", { sessionId: session.sessionId });
  if (accepted.status !== 200 || !accepted.body?.session?.rollback?.planId) throw new Error("restore_accept_failed");
  const rollback = accepted.body.session.rollback;
  const rollbackArmed = await api("POST", "/prototype/settings/restore/arm", {
    action: "rollback",
    sessionId: session.sessionId,
    planId: rollback.planId,
    confirmationText: `ROLL BACK ${rollback.basename}`,
  });
  if (rollbackArmed.status !== 202) throw new Error("rollback_arm_failed");
  await waitFor(async () => {
    try {
      const state = await api("GET", "/prototype/settings/restore/state");
      return state.status === 200 && state.body?.state?.session?.phase === "rolled-back";
    } catch {
      return false;
    }
  }, "packaged_rollback_restart_not_verified");
  if (userVersion() !== 8) throw new Error("packaged_rollback_not_applied");

  console.log(JSON.stringify({
    naturalScheduledBackup: true,
    verifiedBackupInventory: true,
    guardedRestore: true,
    explicitRollback: true,
  }));
} finally {
  if (taskInstalled) {
    try { execFileSync("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* disposable cleanup only */ }
  }
  if (application?.pid && application.exitCode === null) {
    try { execFileSync("taskkill.exe", ["/PID", String(application.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already stopped */ }
  }
}

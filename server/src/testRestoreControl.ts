import Database from "better-sqlite3";
import Fastify from "fastify";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  acceptRestoredState,
  automaticRollbackAfterRuntimeFailure,
  armRestoreHandoff,
  markRestoreRuntimeHealthy,
  performArmedRestoreHandoff,
  prepareRestoreCandidate,
  readRestoreControlState,
  registerRestoreControlRoutes,
} from "./lib/restoreControl.js";
import {
  initializeBackupSettings,
  runScheduledSqliteBackup,
} from "./lib/scheduledSqliteBackup.js";
import { readSqliteLogicalVerificationAtPath } from "./lib/sqliteLogicalVerification.js";
import { serverRoot } from "./lib/paths.js";
import { registerLocalApiAuthentication } from "./lib/localApiAuthentication.js";

const assert: (value: unknown, message?: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message ?? "assertion_failed");
};

const expectFailure = async (
  action: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> => {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message === code, `expected_${code}`);
    return;
  }
  throw new Error(`expected_failure_${code}`);
};

const userVersion = (databasePath: string): number => {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return Number(db.pragma("user_version", { simple: true }));
  } finally {
    db.close();
  }
};

const main = async (): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "pf-restore-control-test-"));
  try {
    const runtimeDirectory = path.join(root, "runtime");
    const sqlitePath = path.join(runtimeDirectory, "personal-finance.sqlite");
    const tokenPath = path.join(root, "token");
    const runtimeConfigPath = path.join(runtimeDirectory, "runtime.json");
    const destination = path.join(root, "backups");
    const staging = path.join(root, "staging");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(tokenPath, "restore-control-test-token");
    const db = new Database(sqlitePath);
    try {
      db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
    } finally {
      db.close();
    }
    writeFileSync(runtimeConfigPath, JSON.stringify({
      version: 1,
      sqlitePath,
      tokenFilePath: tokenPath,
      apiHost: "127.0.0.1",
      apiPort: 3164,
      frontendHost: "localhost",
      frontendPort: 5184,
    }));
    initializeBackupSettings(runtimeConfigPath, {
      destinationDirectory: destination,
      stagingDirectory: staging,
      taskName: "PF restore control test",
    });
    const scheduled = await runScheduledSqliteBackup(runtimeConfigPath, "daily", {
      allowDisabledForManualRun: true,
    });
    const scheduledDatabasePath = path.join(destination, "Daily", scheduled.basename);
    const scheduledManifestPath = scheduledDatabasePath.replace(
      /\.sqlite$/,
      ".manifest.json",
    );
    const historicalDate = new Date("2026-08-14T12:00:00");
    const historicalVerification = readSqliteLogicalVerificationAtPath(
      scheduledDatabasePath,
      historicalDate,
    );
    const historicalManifest = JSON.parse(
      readFileSync(scheduledManifestPath, "utf8"),
    ) as Record<string, unknown>;
    historicalManifest.createdAt = "2026-08-14T01:30:00.000Z";
    historicalManifest.normalizedLocalDay = "2026-08-14";
    historicalManifest.schemaVersion = historicalVerification.schemaVersion;
    historicalManifest.backupDatabaseIdentityFingerprint =
      historicalVerification.databaseIdentityFingerprint;
    historicalManifest.logicalVerification = historicalVerification;
    writeFileSync(scheduledManifestPath, `${JSON.stringify(historicalManifest, null, 2)}\n`);

    const initial = readRestoreControlState(runtimeConfigPath);
    assert(initial.candidates.length === 1);
    assert(initial.session === undefined);
    await expectFailure(
      () => prepareRestoreCandidate(runtimeConfigPath, "not-a-candidate"),
      "restore_candidate_not_found",
    );

    const prepared = await prepareRestoreCandidate(
      runtimeConfigPath,
      initial.candidates[0].candidateId,
    );
    assert(prepared.phase === "prepared" && prepared.rehearsalStatus === "pass");
    await expectFailure(
      () => armRestoreHandoff(runtimeConfigPath, {
        action: "restore",
        sessionId: prepared.sessionId,
        planId: prepared.planId,
        confirmationText: "RESTORE wrong.sqlite",
      }),
      "restore_confirmation_invalid",
    );

    const changed = new Database(sqlitePath);
    try {
      changed.pragma("user_version = 8");
    } finally {
      changed.close();
    }
    assert(userVersion(sqlitePath) === 8);

    armRestoreHandoff(runtimeConfigPath, {
      action: "restore",
      sessionId: prepared.sessionId,
      planId: prepared.planId,
      confirmationText: `RESTORE ${prepared.selected.basename}`,
    });
    const restored = await performArmedRestoreHandoff(runtimeConfigPath);
    assert(userVersion(sqlitePath) === 0, "selected_backup_not_applied");
    markRestoreRuntimeHealthy(runtimeConfigPath, restored);
    const awaiting = readRestoreControlState(runtimeConfigPath).session;
    assert(awaiting?.phase === "awaiting-verification");
    assert(awaiting.rollback?.verificationStatus === "pass");
    assert(awaiting.rollback && existsSync(path.join(destination, "Restore Rollbacks", awaiting.rollback.basename)));

    const accepted = acceptRestoredState(runtimeConfigPath, awaiting.sessionId);
    assert(accepted.phase === "accepted");

    armRestoreHandoff(runtimeConfigPath, {
      action: "rollback",
      sessionId: accepted.sessionId,
      planId: accepted.rollback!.planId,
      confirmationText: `ROLL BACK ${accepted.rollback!.basename}`,
    });
    const rolledBack = await performArmedRestoreHandoff(runtimeConfigPath);
    assert(userVersion(sqlitePath) === 8, "pre_restore_state_not_recovered");
    markRestoreRuntimeHealthy(runtimeConfigPath, rolledBack);
    assert(readRestoreControlState(runtimeConfigPath).session?.phase === "rolled-back");

    const automaticPrepared = await prepareRestoreCandidate(
      runtimeConfigPath,
      initial.candidates[0].candidateId,
    );
    armRestoreHandoff(runtimeConfigPath, {
      action: "restore",
      sessionId: automaticPrepared.sessionId,
      planId: automaticPrepared.planId,
      confirmationText: `RESTORE ${automaticPrepared.selected.basename}`,
    });
    const startupFailure = await performArmedRestoreHandoff(runtimeConfigPath);
    assert(userVersion(sqlitePath) === 0, "automatic_rollback_fixture_not_applied");
    await automaticRollbackAfterRuntimeFailure(runtimeConfigPath, startupFailure);
    assert(userVersion(sqlitePath) === 8, "startup_failure_did_not_restore_previous_state");
    assert(readRestoreControlState(runtimeConfigPath).session?.phase === "rolled-back");

    const serializedStatus = JSON.stringify(readRestoreControlState(runtimeConfigPath).session);
    assert(!serializedStatus.includes(root));
    assert(!serializedStatus.includes("restore-control-test-token"));

    process.env.PERSONAL_FINANCE_RUNTIME_CONFIG_PATH = runtimeConfigPath;
    process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH = tokenPath;
    const app = Fastify();
    try {
      registerLocalApiAuthentication(app);
      registerRestoreControlRoutes(app);
      const unauthenticated = await app.inject({
        method: "GET",
        url: "/prototype/settings/restore/state",
      });
      assert(unauthenticated.statusCode === 401);
      const authenticated = await app.inject({
        method: "GET",
        url: "/prototype/settings/restore/state",
        headers: { "x-personal-finance-token": "restore-control-test-token" },
      });
      assert(authenticated.statusCode === 200);
      assert(!authenticated.body.includes(root));
      const invalidPrepare = await app.inject({
        method: "POST",
        url: "/prototype/settings/restore/prepare",
        headers: { "x-personal-finance-token": "restore-control-test-token" },
        payload: {},
      });
      assert(invalidPrepare.statusCode === 400);
    } finally {
      await app.close();
    }
    console.log("Restore control checks: PASS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

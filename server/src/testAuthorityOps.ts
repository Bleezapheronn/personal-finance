import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import {
  assertStartable,
  buildAuthorityOpsStartPlan,
  checkpointAuthorityOpsProfile,
  inspectAuthorityOpsProfile,
  rollbackAuthorityOpsProfile,
  startAuthorityOpsProcesses,
  verifyAuthorityOpsProfile,
} from "./lib/authorityOps.js";
import {
  AUTHORITY_OPS_CAPABILITIES,
  AUTHORITY_REQUIRED_CAPABILITY_NAMES,
  buildCapabilityEnvironment,
  validateCapabilitySelection,
} from "./lib/authorityOpsCapabilities.js";
import {
  acquireAuthorityOpsLock,
  readAuthorityOpsLockStatus,
} from "./lib/authorityOpsLock.js";
import {
  AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
  readAuthorityOpsProfile,
  validateAuthorityOpsProfile,
  writeAuthorityOpsProfileAtomic,
  type AuthorityOpsProfile,
} from "./lib/authorityOpsProfile.js";
import { prepareSqliteAuthorityCutover } from "./lib/sqliteAuthorityCutover.js";
import { repoRoot, serverRoot } from "./lib/paths.js";
import { parseAuthorityOpsArgs } from "./authorityOps.js";

interface CheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

const checks: CheckResult[] = [];

function assert(condition: unknown, message = "assertion_failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const check = async (name: string, action: () => unknown | Promise<unknown>) => {
  try {
    await action();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : "unknown_failure",
    });
  }
};

const expectFailure = async (
  action: () => unknown | Promise<unknown>,
  expectedCode?: string,
) => {
  try {
    await action();
  } catch (error) {
    if (
      expectedCode &&
      (!(error instanceof Error) || error.message !== expectedCode)
    ) {
      throw error;
    }
    return;
  }
  throw new Error("expected_failure");
};

const hashFile = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const createPrototype = (databasePath: string): void => {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.exec(
      readFileSync(
        path.join(serverRoot, "schema", "prototype-schema.sql"),
        "utf8",
      ),
    );
  } finally {
    database.close();
  }
};

const addRecipient = (databasePath: string): void => {
  const database = new Database(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO recipients (name, isActive, createdAt, updatedAt)
         VALUES (?, 1, ?, ?)`,
      )
      .run(
        "Authority operations fixture",
        "2026-07-23T00:00:00.000Z",
        "2026-07-23T00:00:00.000Z",
      );
  } finally {
    database.close();
  }
};

const reserveFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      assert(address && typeof address !== "string", "test_port_unavailable");
      server.close(() => resolve(address.port));
    });
  });

const listenOn = async (port: number): Promise<net.Server> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });

const closeServer = async (server: net.Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

const writeEmptyBackup = (outputPath: string): void => {
  const tables = Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((table) => [table, []]),
  );
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      tables,
      integrity: {
        counts: Object.fromEntries(
          FULL_BACKUP_TABLE_NAMES.map((table) => [table, 0]),
        ),
      },
    })}\n`,
    "utf8",
  );
};

const main = async (): Promise<void> => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pf-authority-ops-test-"));
  const runtimeDirectory = path.join(tempRoot, "runtime");
  const backupDirectory = path.join(tempRoot, "backups");
  const activeDatabasePath = path.join(runtimeDirectory, "active.sqlite");
  const rehearsalDatabasePath = path.join(runtimeDirectory, "rehearsal.sqlite");
  const sourceBackupPath = path.join(tempRoot, "source-full-backup.json");
  const tokenFilePath = path.join(tempRoot, "server-token");
  const cutoverBackupPath = path.join(backupDirectory, "cutover.sqlite");
  const cutoverManifestPath = path.join(
    backupDirectory,
    "cutover.manifest.json",
  );
  const rehearsalProfilePath = path.join(tempRoot, "rehearsal-profile.json");
  const authorityProfilePath = path.join(tempRoot, "authority-profile.json");
  const apiPort = await reserveFreePort();
  let vitePort = await reserveFreePort();
  while (vitePort === apiPort) vitePort = await reserveFreePort();

  mkdirSync(backupDirectory, { recursive: true });
  createPrototype(activeDatabasePath);
  createPrototype(rehearsalDatabasePath);
  writeEmptyBackup(sourceBackupPath);
  writeFileSync(tokenFilePath, "authority-ops-test-token\n", "utf8");
  await prepareSqliteAuthorityCutover({
    sourceBackupPath,
    candidatePath: activeDatabasePath,
    backupOutputPath: cutoverBackupPath,
    manifestPath: cutoverManifestPath,
    asOf: new Date(2026, 6, 23),
  });

  const rehearsalProfile: AuthorityOpsProfile = {
    schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
    mode: "rehearsal",
    activeDatabasePath: rehearsalDatabasePath,
    authorityManifestPath: null,
    sourceBackupPath: null,
    tokenFilePath,
    backupDirectory,
    apiHost: "127.0.0.1",
    apiPort,
    viteHost: "127.0.0.1",
    vitePort,
    enabledWriteCapabilities: [],
  };
  const authorityProfile: AuthorityOpsProfile = {
    ...rehearsalProfile,
    mode: "authoritative",
    activeDatabasePath,
    authorityManifestPath: cutoverManifestPath,
    sourceBackupPath,
    enabledWriteCapabilities: [...AUTHORITY_REQUIRED_CAPABILITY_NAMES],
  };

  try {
    await check("valid rehearsal and authoritative profiles", () => {
      assert(
        validateAuthorityOpsProfile(rehearsalProfile, rehearsalProfilePath)
          .mode === "rehearsal",
      );
      assert(
        validateAuthorityOpsProfile(authorityProfile, authorityProfilePath)
          .mode === "authoritative",
      );
    });

    await check("unknown fields, capabilities, and duplicates fail closed", async () => {
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, surprise: true },
          rehearsalProfilePath,
        ),
      );
      await expectFailure(() =>
        validateCapabilitySelection(["retiredCapability"], "rehearsal"),
        "authority_profile_capability_unknown",
      );
      await expectFailure(() =>
        validateCapabilitySelection(
          ["accountWrites", "accountWrites"],
          "rehearsal",
        ),
        "authority_profile_capability_duplicate",
      );
    });

    await check("relative and repository-local paths fail closed", async () => {
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, activeDatabasePath: "active.sqlite" },
          rehearsalProfilePath,
        ),
        "authority_profile_active_database_path_invalid",
      );
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          rehearsalProfile,
          path.join(repoRoot, "authority-profile.json"),
        ),
      );
    });

    await check("invalid ports, duplicate ports, and incomplete pairs fail closed", async () => {
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, apiPort: 0 },
          rehearsalProfilePath,
        ),
        "authority_profile_api_port_invalid",
      );
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, vitePort: apiPort },
          rehearsalProfilePath,
        ),
        "authority_profile_ports_must_differ",
      );
      await expectFailure(() =>
        validateCapabilitySelection(["recipientActiveStateWrites"], "rehearsal"),
        "authority_profile_capability_pair_incomplete",
      );
    });

    await check("missing dependencies and immutable runtime selection fail closed", async () => {
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, tokenFilePath: path.join(tempRoot, "missing-token") },
          rehearsalProfilePath,
        ),
        "authority_profile_token_file_missing",
      );
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...rehearsalProfile, activeDatabasePath: path.join(tempRoot, "missing.sqlite") },
          rehearsalProfilePath,
        ),
        "authority_profile_active_database_missing",
      );
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...authorityProfile, authorityManifestPath: path.join(tempRoot, "missing.json") },
          authorityProfilePath,
        ),
        "authority_profile_manifest_missing",
      );
      await expectFailure(() =>
        validateAuthorityOpsProfile(
          { ...authorityProfile, activeDatabasePath: cutoverBackupPath },
          authorityProfilePath,
        ),
      );
    });

    await check("CLI parsing is strict and rollback requires a named target", async () => {
      assert(parseAuthorityOpsArgs(["status", "--profile", authorityProfilePath]).command === "status");
      assert(
        parseAuthorityOpsArgs([authorityProfilePath, "status"]).profile ===
          authorityProfilePath,
      );
      await expectFailure(() => parseAuthorityOpsArgs(["status", "--unknown"]));
      await expectFailure(() => parseAuthorityOpsArgs(["rollback", "--to-manifest"]));
    });

    await check("npm dry-run forwarding remains non-spawning", () => {
      const previous = process.env.npm_config_dry_run;
      process.env.npm_config_dry_run = "true";
      try {
        assert(parseAuthorityOpsArgs([authorityProfilePath, "start"]).dryRun);
      } finally {
        if (previous === undefined) delete process.env.npm_config_dry_run;
        else process.env.npm_config_dry_run = previous;
      }
    });

    await check("profile writes are atomic and replacement preserves prior profile", async () => {
      writeAuthorityOpsProfileAtomic(rehearsalProfilePath, rehearsalProfile);
      const before = hashFile(rehearsalProfilePath);
      const replaced = writeAuthorityOpsProfileAtomic(
        rehearsalProfilePath,
        { ...rehearsalProfile, viteHost: "localhost" },
        { replace: true },
      );
      assert(replaced.previousProfilePath && existsSync(replaced.previousProfilePath));
      assert(hashFile(replaced.previousProfilePath) === before);
      const afterReplacement = hashFile(rehearsalProfilePath);
      await expectFailure(() =>
        writeAuthorityOpsProfileAtomic(
          rehearsalProfilePath,
          { ...rehearsalProfile, activeDatabasePath: "relative.sqlite" },
          { replace: true },
        ),
      );
      assert(hashFile(rehearsalProfilePath) === afterReplacement);
    });

    await check("rehearsal status and verification are ready", async () => {
      const status = await inspectAuthorityOpsProfile(rehearsalProfilePath);
      assert(status.readiness === "rehearsal ready");
      assert(status.databaseMatchesManifest === null);
      const verification = await verifyAuthorityOpsProfile(rehearsalProfilePath);
      assert(verification.status === "pass");
    });

    await check("authoritative initialization, status, and full verification pass", async () => {
      writeAuthorityOpsProfileAtomic(authorityProfilePath, authorityProfile);
      const status = await inspectAuthorityOpsProfile(authorityProfilePath);
      assert(status.readiness === "ready to start");
      assert(status.databaseMatchesManifest === true);
      const verification = await verifyAuthorityOpsProfile(authorityProfilePath);
      assert(verification.status === "pass");
      assert(verification.sourceComparisonRun);
    });

    await check("capability registry generates paired explicit flags", () => {
      const selected = [
        "recipientActiveStateWrites",
        "recipientCreateUpdateWrites",
        "accountWrites",
      ] as const;
      const generated = buildCapabilityEnvironment(selected);
      assert(
        generated.frontend.VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT ===
          "true",
      );
      assert(
        generated.frontend.VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT ===
          "true",
      );
      const disabled = AUTHORITY_OPS_CAPABILITIES.find(
        ({ name }) => name === "budgetDeleteWrites",
      );
      assert(disabled);
      assert(generated.backend[disabled.backendEnvironmentVariable] === "false");
    });

    await check("start plan is sanitized and never modifies env files", () => {
      const envPath = path.join(repoRoot, ".env.local");
      const before = existsSync(envPath) ? hashFile(envPath) : null;
      const plan = buildAuthorityOpsStartPlan(authorityProfile);
      assert(plan.apiEnvironment.PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED === "true");
      assert(plan.viteEnvironment.VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED === "true");
      assert(
        !JSON.stringify(plan.sanitizedEnvironment).includes(
          "authority-ops-test-token",
        ),
      );
      const after = existsSync(envPath) ? hashFile(envPath) : null;
      assert(before === after);
    });

    await check("occupied port refuses startup and checkpoint without profile update", async () => {
      const server = await listenOn(apiPort);
      const before = hashFile(authorityProfilePath);
      try {
        const status = await inspectAuthorityOpsProfile(authorityProfilePath);
        assert(status.readiness === "missing dependency");
        assert(status.code === "authority_ops_ports_occupied");
        await expectFailure(
          () => assertStartable(authorityProfilePath),
          "authority_ops_start_port_occupied",
        );
        await expectFailure(
          () => checkpointAuthorityOpsProfile(authorityProfilePath),
          "authority_ops_services_must_be_stopped",
        );
        assert(hashFile(authorityProfilePath) === before);
      } finally {
        await closeServer(server);
      }
    });

    await check("child startup failure stops its sibling", async () => {
      const plan = buildAuthorityOpsStartPlan(rehearsalProfile);
      plan.apiCommand = {
        executable: process.execPath,
        args: ["-e", "process.exit(7)"],
        cwd: tempRoot,
      };
      plan.viteCommand = {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: tempRoot,
      };
      const startedAt = Date.now();
      const exitCode = await startAuthorityOpsProcesses(plan);
      assert(exitCode !== 0);
      assert(Date.now() - startedAt < 10_000);
    });

    await check("authoritative mutation is reported as checkpoint required", async () => {
      addRecipient(activeDatabasePath);
      const status = await inspectAuthorityOpsProfile(authorityProfilePath);
      assert(status.readiness === "checkpoint required before authoritative restart");
      assert(status.checkpointRotationRequired);
      await expectFailure(
        () => verifyAuthorityOpsProfile(authorityProfilePath),
        "authority_checkpoint_required",
      );
      await expectFailure(
        () => assertStartable(authorityProfilePath),
        "authority_checkpoint_required",
      );
    });

    let checkpointManifestPath = "";
    await check("checkpoint creates safety artifacts and atomically advances profile", async () => {
      const cutoverBackupBefore = hashFile(cutoverBackupPath);
      const cutoverManifestBefore = hashFile(cutoverManifestPath);
      const profileBefore = hashFile(authorityProfilePath);
      const result = await checkpointAuthorityOpsProfile(authorityProfilePath, {
        label: "authority-ops-test",
      });
      checkpointManifestPath = result.checkpointManifestPath;
      assert(existsSync(result.safetyBackupPath));
      assert(existsSync(result.safetyManifestPath));
      assert(existsSync(result.checkpointBackupPath));
      assert(existsSync(result.checkpointManifestPath));
      assert(existsSync(result.previousProfilePath));
      assert(hashFile(result.previousProfilePath) === profileBefore);
      assert(hashFile(cutoverBackupPath) === cutoverBackupBefore);
      assert(hashFile(cutoverManifestPath) === cutoverManifestBefore);
      const advanced = readAuthorityOpsProfile(authorityProfilePath);
      assert(advanced.authorityManifestPath === checkpointManifestPath);
      assert((await inspectAuthorityOpsProfile(authorityProfilePath)).readiness === "ready to start");
    });

    await check("broken checkpoint chain fails verification", async () => {
      const hidden = `${cutoverManifestPath}.hidden`;
      copyFileSync(cutoverManifestPath, hidden);
      rmSync(cutoverManifestPath);
      try {
        await expectFailure(() => verifyAuthorityOpsProfile(authorityProfilePath));
      } finally {
        copyFileSync(hidden, cutoverManifestPath);
        rmSync(hidden);
      }
    });

    await check("rollback requires confirmation and a prior lineage member", async () => {
      await expectFailure(
        () =>
          rollbackAuthorityOpsProfile(authorityProfilePath, cutoverManifestPath, {
            confirmed: false,
          }),
        "authority_ops_rollback_confirmation_required",
      );
      await expectFailure(() =>
        rollbackAuthorityOpsProfile(authorityProfilePath, checkpointManifestPath, {
          confirmed: true,
        }),
      );
    });

    await check("rollback creates a new runtime and preserves immutable and former files", async () => {
      const immutableBefore = hashFile(cutoverBackupPath);
      const formerProfile = readAuthorityOpsProfile(authorityProfilePath);
      const formerRuntimeBefore = hashFile(formerProfile.activeDatabasePath);
      const result = await rollbackAuthorityOpsProfile(
        authorityProfilePath,
        cutoverManifestPath,
        { confirmed: true },
      );
      assert(existsSync(result.safetyBackupPath));
      assert(existsSync(result.restoredRuntimePath));
      assert(result.restoredRuntimePath !== formerProfile.activeDatabasePath);
      assert(existsSync(result.formerRuntimePath));
      assert(hashFile(result.formerRuntimePath) === formerRuntimeBefore);
      assert(hashFile(cutoverBackupPath) === immutableBefore);
      const rolledBack = readAuthorityOpsProfile(authorityProfilePath);
      assert(rolledBack.activeDatabasePath === result.restoredRuntimePath);
      assert(rolledBack.authorityManifestPath === cutoverManifestPath);
      assert((await inspectAuthorityOpsProfile(authorityProfilePath)).readiness === "ready to start");
      assert((await verifyAuthorityOpsProfile(authorityProfilePath)).status === "pass");
    });

    await check("lock acquisition, concurrent refusal, and release are conservative", async () => {
      const release = acquireAuthorityOpsLock(authorityProfilePath, "checkpoint");
      const status = readAuthorityOpsLockStatus(authorityProfilePath);
      assert(status.present && status.live === true && !status.stale);
      const contents = readFileSync(`${authorityProfilePath}.lock`, "utf8");
      assert(!contents.includes("authority-ops-test-token"));
      await expectFailure(
        () => acquireAuthorityOpsLock(authorityProfilePath, "rollback"),
        "authority_ops_lock_held",
      );
      release();
      assert(!readAuthorityOpsLockStatus(authorityProfilePath).present);
    });

    await check("obviously stale locks are reported and never broken automatically", async () => {
      const lockPath = `${authorityProfilePath}.lock`;
      writeFileSync(
        lockPath,
        `${JSON.stringify({
          processId: 2_147_483_647,
          hostname: os.hostname(),
          command: "checkpoint",
          startedAt: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      const status = readAuthorityOpsLockStatus(authorityProfilePath);
      assert(status.present && status.stale);
      await expectFailure(
        () => acquireAuthorityOpsLock(authorityProfilePath, "checkpoint"),
        "authority_ops_lock_stale",
      );
      assert(existsSync(lockPath));
      rmSync(lockPath);
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const failed = checks.filter(({ ok }) => !ok);
  for (const result of checks) {
    console.log(`${result.ok ? "PASS" : "FAIL"}: ${result.name}`);
    if (result.error) console.log(`  ${result.error}`);
  }
  console.log(
    `Authority operations tests: ${checks.length - failed.length} passed, ${failed.length} failed`,
  );
  if (failed.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "authority_ops_test_failed");
  process.exitCode = 1;
});

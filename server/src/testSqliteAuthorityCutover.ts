import Database from "better-sqlite3";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  evaluateSqliteAuthorityReadiness,
  prepareSqliteAuthorityCutover,
  verifySqliteAuthorityRollback,
} from "./lib/sqliteAuthorityCutover.js";
import { createSqliteNativeBackup } from "./lib/sqliteBackupRestore.js";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import { repoRoot, serverRoot } from "./lib/paths.js";
import {
  WRITE_CAPABILITY_KEYS,
  type WriteCapabilities,
} from "./lib/writeCapabilities.js";
import { parsePrepareSqliteAuthorityCutoverArgs } from "./prepareSqliteAuthorityCutover.js";

interface CheckResult { name: string; ok: boolean }
const checks: CheckResult[] = [];

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("assertion_failed");
}

const check = async (name: string, action: () => unknown | Promise<unknown>) => {
  try {
    await action();
    checks.push({ name, ok: true });
  } catch {
    checks.push({ name, ok: false });
  }
};

const expectFailure = async (action: () => unknown | Promise<unknown>) => {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("expected_failure");
};

const allCapabilities = (): WriteCapabilities =>
  Object.fromEntries(WRITE_CAPABILITY_KEYS.map((key) => [key, true])) as WriteCapabilities;

const createPrototype = (databasePath: string): void => {
  const db = new Database(databasePath);
  try {
    db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
  } finally {
    db.close();
  }
};

const main = async (): Promise<void> => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "pf-authority-cutover-test-"));
  const candidate = path.join(tempRoot, "candidate.sqlite");
  const sourceBackup = path.join(tempRoot, "matching-full-backup.json");
  const backup = path.join(tempRoot, "pre-cutover.sqlite");
  const manifest = path.join(tempRoot, "cutover-manifest.json");
  const asOf = new Date(2026, 6, 22);
  try {
    createPrototype(candidate);
    const emptyTables = Object.fromEntries(
      FULL_BACKUP_TABLE_NAMES.map((table) => [table, []]),
    );
    writeFileSync(
      sourceBackup,
      JSON.stringify({
        tables: emptyTables,
        integrity: {
          counts: Object.fromEntries(
            FULL_BACKUP_TABLE_NAMES.map((table) => [table, 0]),
          ),
        },
      }),
      "utf8",
    );

    await check("invalid and unknown CLI arguments fail closed", async () => {
      await expectFailure(() => parsePrepareSqliteAuthorityCutoverArgs(["--unknown"]));
      await expectFailure(() => parsePrepareSqliteAuthorityCutoverArgs(["--sqlite"]));
    });

    await check("missing candidate is rejected", async () => {
      await expectFailure(() => prepareSqliteAuthorityCutover({
        sourceBackupPath: sourceBackup,
        candidatePath: path.join(tempRoot, "missing.sqlite"),
        backupOutputPath: path.join(tempRoot, "missing-backup.sqlite"),
        manifestPath: path.join(tempRoot, "missing-manifest.json"),
        asOf,
      }));
    });

    await check("invalid SQLite candidate is rejected", async () => {
      const invalid = path.join(tempRoot, "invalid.sqlite");
      writeFileSync(invalid, "not sqlite", "utf8");
      await expectFailure(() => prepareSqliteAuthorityCutover({
        sourceBackupPath: sourceBackup,
        candidatePath: invalid,
        backupOutputPath: path.join(tempRoot, "invalid-backup.sqlite"),
        manifestPath: path.join(tempRoot, "invalid-manifest.json"),
        asOf,
      }));
    });

    await check("repository-local cutover manifest is rejected", async () => {
      const repoManifest = path.join(repoRoot, "cutover-manifest-test.json");
      const output = path.join(tempRoot, "repo-manifest-backup.sqlite");
      assert(!existsSync(repoManifest));
      await expectFailure(() => prepareSqliteAuthorityCutover({
        sourceBackupPath: sourceBackup,
        candidatePath: candidate,
        backupOutputPath: output,
        manifestPath: repoManifest,
        asOf,
      }));
      assert(!existsSync(repoManifest) && !existsSync(output));
    });

    await check("backup and cutover manifest must share a directory", async () => {
      const output = path.join(tempRoot, "separate-backup.sqlite");
      const separateManifest = path.join(tempRoot, "manifest-dir", "cutover.json");
      await expectFailure(() => prepareSqliteAuthorityCutover({
        sourceBackupPath: sourceBackup,
        candidatePath: candidate,
        backupOutputPath: output,
        manifestPath: separateManifest,
        asOf,
      }));
      assert(!existsSync(output) && !existsSync(separateManifest));
    });

    await check("stale source backup blocks cutover", async () => {
      const staleSourceBackup = path.join(tempRoot, "stale-full-backup.json");
      const staleTables = {
        ...emptyTables,
        recipients: [
          {
            id: 1,
            name: "synthetic",
            isActive: true,
            createdAt: "2026-07-22T00:00:00.000Z",
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
        ],
      };
      writeFileSync(staleSourceBackup, JSON.stringify({ tables: staleTables }), "utf8");
      const output = path.join(tempRoot, "stale-pre-cutover.sqlite");
      const staleManifest = path.join(tempRoot, "stale-cutover.json");
      await expectFailure(() => prepareSqliteAuthorityCutover({
        sourceBackupPath: staleSourceBackup,
        candidatePath: candidate,
        backupOutputPath: output,
        manifestPath: staleManifest,
        asOf,
      }));
      assert(!existsSync(output) && !existsSync(staleManifest));
    });

    await check("unexpected schema user version blocks preparation", async () => {
      const db = new Database(candidate);
      try { db.pragma("user_version = 7"); } finally { db.close(); }
      const output = path.join(tempRoot, "schema-pre-cutover.sqlite");
      const schemaManifest = path.join(tempRoot, "schema-cutover.json");
      try {
        await expectFailure(() => prepareSqliteAuthorityCutover({
          sourceBackupPath: sourceBackup,
          candidatePath: candidate,
          backupOutputPath: output,
          manifestPath: schemaManifest,
          asOf,
        }));
        assert(!existsSync(output) && !existsSync(schemaManifest));
      } finally {
        const restore = new Database(candidate);
        try { restore.pragma("user_version = 0"); } finally { restore.close(); }
      }
    });

    await check("cutover preparation creates verified backup and manifest", async () => {
      await prepareSqliteAuthorityCutover({
        sourceBackupPath: sourceBackup,
        candidatePath: candidate,
        backupOutputPath: backup,
        manifestPath: manifest,
        asOf,
      });
      assert(existsSync(backup) && existsSync(manifest));
      const manifestText = readFileSync(manifest, "utf8");
      assert(!manifestText.includes(tempRoot));
      assert(!manifestText.includes("matching-full-backup.json"));
      assert(!manifestText.includes("synthetic"));
      assert(!manifestText.includes(".server-token"));
    });

    await check("valid candidate is authority-ready", () => {
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: manifest,
        capabilities: allCapabilities(),
      });
      assert(readiness.ready && readiness.authoritative && readiness.rollbackAvailable);
    });

    await check("disabled capability blocks authority", () => {
      const capabilities = allCapabilities();
      capabilities.transactionBasicWrites = false;
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: manifest,
        capabilities,
      });
      assert(!readiness.ready && readiness.missingRequirements.includes("capability:transactionBasicWrites"));
    });

    await check("missing and invalid manifest block authority", () => {
      const missing = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: path.join(tempRoot, "absent.json"),
        capabilities: allCapabilities(),
      });
      const invalidManifest = path.join(tempRoot, "malformed.json");
      writeFileSync(invalidManifest, "{}", "utf8");
      const invalid = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: invalidManifest,
        capabilities: allCapabilities(),
      });
      assert(!missing.ready && !invalid.ready);
    });

    await check("missing native backup blocks authority", () => {
      const moved = `${backup}.moved`;
      renameSync(backup, moved);
      try {
        const readiness = evaluateSqliteAuthorityReadiness({
          authorityEnabled: true,
          sqlitePath: candidate,
          manifestPath: manifest,
          capabilities: allCapabilities(),
        });
        assert(!readiness.ready && !readiness.rollbackAvailable);
      } finally {
        renameSync(moved, backup);
      }
    });

    await check("wrong user version blocks authority", () => {
      const db = new Database(candidate);
      try { db.pragma("user_version = 7"); } finally { db.close(); }
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: manifest,
        capabilities: allCapabilities(),
      });
      assert(!readiness.ready && readiness.code === "active_sqlite_manifest_mismatch");
      const restore = new Database(candidate);
      try { restore.pragma("user_version = 0"); } finally { restore.close(); }
    });

    await check("altered table content blocks authority", () => {
      const db = new Database(candidate);
      try {
        db.prepare(`INSERT INTO recipients
          (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)`)
          .run("synthetic", "2026-07-22T00:00:00.000Z", "2026-07-22T00:00:00.000Z");
      } finally { db.close(); }
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: candidate,
        manifestPath: manifest,
        capabilities: allCapabilities(),
      });
      assert(!readiness.ready && readiness.code === "active_sqlite_manifest_mismatch");
    });

    await check("rollback requires current and pre-cutover backups", async () => {
      const currentBackup = path.join(tempRoot, "current.sqlite");
      const currentManifest = `${currentBackup}.manifest.json`;
      await createSqliteNativeBackup({
        sourcePath: candidate,
        outputPath: currentBackup,
        manifestPath: currentManifest,
        asOf,
      });
      const result = verifySqliteAuthorityRollback({
        currentSqlitePath: candidate,
        cutoverManifestPath: manifest,
        currentBackupPath: currentBackup,
        currentBackupManifestPath: currentManifest,
      });
      assert(result.cutoverBackupVerified && result.currentBackupVerified);
      await expectFailure(() => verifySqliteAuthorityRollback({
        currentSqlitePath: candidate,
        cutoverManifestPath: manifest,
        currentBackupPath: path.join(tempRoot, "missing-current.sqlite"),
        currentBackupManifestPath: currentManifest,
      }));
    });
  } finally {
    const resolved = path.resolve(tempRoot);
    const osTemp = path.resolve(tmpdir());
    assert(
      resolved.startsWith(`${osTemp}${path.sep}`) &&
      path.basename(resolved).startsWith("pf-authority-cutover-test-"),
    );
    rmSync(resolved, { recursive: true, force: true });
  }

  for (const result of checks) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  const failed = checks.filter((result) => !result.ok).length;
  console.log(`SQLite authority cutover checks: total=${checks.length} passed=${checks.length - failed} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FULL_BACKUP_TABLE_NAMES } from "./lib/backup.js";
import {
  deriveAuthorityCheckpointId,
  evaluateSqliteAuthorityReadiness,
  prepareSqliteAuthorityCutover,
  type SqliteAuthorityCheckpointManifest,
} from "./lib/sqliteAuthorityCutover.js";
import {
  createSqliteAuthorityCheckpoint,
  restoreSqliteAuthorityCheckpointBackup,
  verifySqliteAuthorityCheckpoint,
  verifySqliteAuthorityCheckpointChain,
} from "./lib/sqliteAuthorityCheckpoint.js";
import { repoRoot, serverRoot } from "./lib/paths.js";
import {
  WRITE_CAPABILITY_KEYS,
  type WriteCapabilities,
} from "./lib/writeCapabilities.js";
import { parseCreateSqliteAuthorityCheckpointArgs } from "./createSqliteAuthorityCheckpoint.js";
import { parseVerifySqliteAuthorityCheckpointArgs } from "./verifySqliteAuthorityCheckpoint.js";
import { parseVerifySqliteAuthorityCheckpointChainArgs } from "./verifySqliteAuthorityCheckpointChain.js";

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

const hashFile = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const allCapabilities = (): WriteCapabilities =>
  Object.fromEntries(
    WRITE_CAPABILITY_KEYS.map((key) => [key, true]),
  ) as WriteCapabilities;

const createPrototype = (databasePath: string): void => {
  const db = new Database(databasePath);
  try {
    db.exec(
      readFileSync(
        path.join(serverRoot, "schema", "prototype-schema.sql"),
        "utf8",
      ),
    );
  } finally {
    db.close();
  }
};

const addRecipient = (databasePath: string, name: string): void => {
  const db = new Database(databasePath);
  try {
    db.prepare(
      `INSERT INTO recipients (name, isActive, createdAt, updatedAt)
       VALUES (?, 1, ?, ?)`,
    ).run(name, "2026-07-22T00:00:00.000Z", "2026-07-22T00:00:00.000Z");
  } finally {
    db.close();
  }
};

const readCheckpoint = (manifestPath: string): SqliteAuthorityCheckpointManifest =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as SqliteAuthorityCheckpointManifest;

const writeCheckpointVariant = (
  sourcePath: string,
  outputPath: string,
  mutate: (manifest: SqliteAuthorityCheckpointManifest) => void,
): void => {
  const manifest = readCheckpoint(sourcePath);
  mutate(manifest);
  const { checkpointId: _checkpointId, ...withoutId } = manifest;
  manifest.checkpointId = deriveAuthorityCheckpointId(withoutId);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const main = async (): Promise<void> => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "pf-authority-checkpoint-test-"));
  const sqlite = path.join(tempRoot, "active.sqlite");
  const sourceBackup = path.join(tempRoot, "matching-full-backup.json");
  const checkpoint0Backup = path.join(tempRoot, "checkpoint-0.sqlite");
  const checkpoint0Manifest = path.join(tempRoot, "checkpoint-0.json");
  const checkpoint1Backup = path.join(tempRoot, "checkpoint-1.sqlite");
  const checkpoint1Manifest = path.join(tempRoot, "checkpoint-1.json");
  const checkpoint2Backup = path.join(tempRoot, "checkpoint-2.sqlite");
  const checkpoint2Manifest = path.join(tempRoot, "checkpoint-2.json");
  const asOf = new Date(2026, 6, 22);

  try {
    createPrototype(sqlite);
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
    await prepareSqliteAuthorityCutover({
      sourceBackupPath: sourceBackup,
      candidatePath: sqlite,
      backupOutputPath: checkpoint0Backup,
      manifestPath: checkpoint0Manifest,
      asOf,
    });
    const checkpoint0CreatedAt = new Date(
      (JSON.parse(readFileSync(checkpoint0Manifest, "utf8")) as { createdAt: string })
        .createdAt,
    );

    await check("unknown and missing CLI arguments fail closed", async () => {
      await expectFailure(() =>
        parseCreateSqliteAuthorityCheckpointArgs(["--unknown"]),
      );
      await expectFailure(() =>
        parseVerifySqliteAuthorityCheckpointArgs(["--manifest"]),
      );
      await expectFailure(() =>
        parseVerifySqliteAuthorityCheckpointChainArgs(["--sqlite"]),
      );
    });

    await check("missing SQLite and current manifest are rejected", async () => {
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: path.join(tempRoot, "missing.sqlite"),
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: path.join(tempRoot, "missing-db-backup.sqlite"),
          manifestOutputPath: path.join(tempRoot, "missing-db.json"),
        }),
      );
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: path.join(tempRoot, "missing.json"),
          backupOutputPath: path.join(tempRoot, "missing-manifest-backup.sqlite"),
          manifestOutputPath: path.join(tempRoot, "missing-manifest.json"),
        }),
      );
    });

    await check("malformed predecessor and existing outputs are rejected", async () => {
      const malformed = path.join(tempRoot, "malformed.json");
      writeFileSync(malformed, "{}", "utf8");
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: malformed,
          backupOutputPath: path.join(tempRoot, "malformed-backup.sqlite"),
          manifestOutputPath: path.join(tempRoot, "malformed-output.json"),
        }),
      );
      const existing = path.join(tempRoot, "existing.sqlite");
      writeFileSync(existing, "reserved", "utf8");
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: existing,
          manifestOutputPath: path.join(tempRoot, "existing-output.json"),
        }),
      );
    });

    await check("source aliases and repository-local output are rejected", async () => {
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: sqlite,
          manifestOutputPath: path.join(tempRoot, "same-source.json"),
        }),
      );
      const repoBackup = path.join(repoRoot, "checkpoint-test.sqlite");
      const repoManifest = path.join(repoRoot, "checkpoint-test.json");
      assert(!existsSync(repoBackup) && !existsSync(repoManifest));
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: repoBackup,
          manifestOutputPath: repoManifest,
        }),
      );
      assert(!existsSync(repoBackup) && !existsSync(repoManifest));
    });

    await check("unsupported schema and failed integrity are rejected", async () => {
      const wrongSchema = path.join(tempRoot, "wrong-schema.sqlite");
      copyFileSync(sqlite, wrongSchema);
      const db = new Database(wrongSchema);
      try { db.pragma("user_version = 7"); } finally { db.close(); }
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: wrongSchema,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: path.join(tempRoot, "wrong-schema-backup.sqlite"),
          manifestOutputPath: path.join(tempRoot, "wrong-schema.json"),
          asOf,
        }),
      );
      const corrupt = path.join(tempRoot, "corrupt.sqlite");
      writeFileSync(corrupt, "not sqlite", "utf8");
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: corrupt,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: path.join(tempRoot, "corrupt-backup.sqlite"),
          manifestOutputPath: path.join(tempRoot, "corrupt.json"),
          asOf,
        }),
      );
    });

    await check("incomplete checkpoint output is cleaned up", async () => {
      const backupOutput = path.join(tempRoot, "cleanup-backup.sqlite");
      const tooLongManifest = path.join(tempRoot, `${"x".repeat(300)}.json`);
      await expectFailure(() =>
        createSqliteAuthorityCheckpoint({
          sqlitePath: sqlite,
          currentManifestPath: checkpoint0Manifest,
          backupOutputPath: backupOutput,
          manifestOutputPath: tooLongManifest,
          asOf,
        }),
      );
      assert(!existsSync(backupOutput) && !existsSync(tooLongManifest));
    });

    addRecipient(sqlite, "checkpoint-one-synthetic");
    const sqliteBefore = hashFile(sqlite);
    const checkpoint0ManifestBefore = hashFile(checkpoint0Manifest);
    const checkpoint0BackupBefore = hashFile(checkpoint0Backup);

    await check("checkpoint 1 preserves source and checkpoint 0", async () => {
      const result = await createSqliteAuthorityCheckpoint({
        sqlitePath: sqlite,
        currentManifestPath: checkpoint0Manifest,
        backupOutputPath: checkpoint1Backup,
        manifestOutputPath: checkpoint1Manifest,
        asOf,
        createdAt: new Date(checkpoint0CreatedAt.getTime() + 1_000),
      });
      assert(result.checkpointSequence === 1);
      assert(hashFile(sqlite) === sqliteBefore);
      assert(hashFile(checkpoint0Manifest) === checkpoint0ManifestBefore);
      assert(hashFile(checkpoint0Backup) === checkpoint0BackupBefore);
      const manifestText = readFileSync(checkpoint1Manifest, "utf8");
      assert(!manifestText.includes(tempRoot));
      assert(!manifestText.includes("checkpoint-one-synthetic"));
      assert(!manifestText.includes(".server-token"));
    });

    await check("checkpoint 1 verifies and authorizes startup", () => {
      const verification = verifySqliteAuthorityCheckpoint({
        manifestPath: checkpoint1Manifest,
        sqlitePath: sqlite,
      });
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: sqlite,
        manifestPath: checkpoint1Manifest,
        capabilities: allCapabilities(),
      });
      assert(verification.backupVerified && verification.activeSqliteVerified);
      assert(readiness.ready && readiness.authoritative);
    });

    addRecipient(sqlite, "checkpoint-two-synthetic");
    await check("checkpoint 2 and complete chain verify", async () => {
      await createSqliteAuthorityCheckpoint({
        sqlitePath: sqlite,
        currentManifestPath: checkpoint1Manifest,
        backupOutputPath: checkpoint2Backup,
        manifestOutputPath: checkpoint2Manifest,
        label: "phase2-checkpoint-2",
        asOf,
        createdAt: new Date(checkpoint0CreatedAt.getTime() + 2_000),
      });
      const chain = verifySqliteAuthorityCheckpointChain({
        manifestPaths: [
          checkpoint0Manifest,
          checkpoint1Manifest,
          checkpoint2Manifest,
        ],
        sqlitePath: sqlite,
      });
      assert(chain.checkpointCount === 3 && chain.finalSequence === 2);
      assert(chain.backupsVerified === 3 && chain.activeSqliteVerified);
    });

    await check("invalid lineage and predecessor fail closed", async () => {
      const badLineage = path.join(tempRoot, "bad-lineage.json");
      writeCheckpointVariant(checkpoint2Manifest, badLineage, (manifest) => {
        manifest.authorityLineageId = "f".repeat(64);
      });
      await expectFailure(() =>
        verifySqliteAuthorityCheckpointChain({
          manifestPaths: [checkpoint0Manifest, checkpoint1Manifest, badLineage],
        }),
      );
      const badPredecessor = path.join(tempRoot, "bad-predecessor.json");
      writeCheckpointVariant(checkpoint2Manifest, badPredecessor, (manifest) => {
        manifest.predecessorCheckpointId = "0".repeat(64);
      });
      await expectFailure(() =>
        verifySqliteAuthorityCheckpointChain({
          manifestPaths: [
            checkpoint0Manifest,
            checkpoint1Manifest,
            badPredecessor,
          ],
        }),
      );
    });

    await check("repeated IDs and skipped sequences fail closed", async () => {
      await expectFailure(() =>
        verifySqliteAuthorityCheckpointChain({
          manifestPaths: [
            checkpoint0Manifest,
            checkpoint1Manifest,
            checkpoint1Manifest,
          ],
        }),
      );
      const skipped = path.join(tempRoot, "skipped-sequence.json");
      writeCheckpointVariant(checkpoint2Manifest, skipped, (manifest) => {
        manifest.checkpointSequence = 3;
      });
      await expectFailure(() =>
        verifySqliteAuthorityCheckpointChain({
          manifestPaths: [checkpoint0Manifest, checkpoint1Manifest, skipped],
        }),
      );
      const backwards = path.join(tempRoot, "backwards-timestamp.json");
      writeCheckpointVariant(checkpoint2Manifest, backwards, (manifest) => {
        manifest.createdAt = checkpoint0CreatedAt.toISOString();
      });
      await expectFailure(() =>
        verifySqliteAuthorityCheckpointChain({
          manifestPaths: [checkpoint0Manifest, checkpoint1Manifest, backwards],
        }),
      );
    });

    await check("altered backup and active database fail closed", async () => {
      const alteredBackup = path.join(tempRoot, "altered-backup.sqlite");
      copyFileSync(checkpoint1Backup, alteredBackup);
      const alteredManifest = path.join(tempRoot, "altered-backup.json");
      writeCheckpointVariant(checkpoint1Manifest, alteredManifest, (manifest) => {
        manifest.backupFileName = path.basename(alteredBackup);
      });
      addRecipient(alteredBackup, "altered-backup-synthetic");
      await expectFailure(() =>
        verifySqliteAuthorityCheckpoint({ manifestPath: alteredManifest }),
      );

      const alteredActive = path.join(tempRoot, "altered-active.sqlite");
      copyFileSync(checkpoint2Backup, alteredActive);
      addRecipient(alteredActive, "altered-active-synthetic");
      await expectFailure(() =>
        verifySqliteAuthorityCheckpoint({
          manifestPath: checkpoint2Manifest,
          sqlitePath: alteredActive,
        }),
      );
    });

    await check("checkpoint 1 restores to a fresh rollback path", async () => {
      const restored = path.join(tempRoot, "checkpoint-1-restored.sqlite");
      await restoreSqliteAuthorityCheckpointBackup({
        backupPath: checkpoint1Backup,
        outputPath: restored,
        manifestPath: checkpoint1Manifest,
      });
      const db = new Database(restored, { readonly: true, fileMustExist: true });
      try {
        const count = db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as {
          count: number;
        };
        assert(count.count === 1);
      } finally {
        db.close();
      }
      const readiness = evaluateSqliteAuthorityReadiness({
        authorityEnabled: true,
        sqlitePath: restored,
        manifestPath: checkpoint1Manifest,
        capabilities: allCapabilities(),
      });
      assert(readiness.ready);
    });
  } finally {
    const resolved = path.resolve(tempRoot);
    const osTemp = path.resolve(tmpdir());
    assert(
      resolved.startsWith(`${osTemp}${path.sep}`) &&
      path.basename(resolved).startsWith("pf-authority-checkpoint-test-"),
    );
    rmSync(resolved, { recursive: true, force: true });
  }

  for (const result of checks) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  }
  const failed = checks.filter((result) => !result.ok).length;
  console.log(
    `SQLite authority checkpoint checks: total=${checks.length} passed=${checks.length - failed} failed=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

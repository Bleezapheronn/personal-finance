import Database from "better-sqlite3";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseBackupSqliteArgs } from "./backupSqlite.js";
import {
  createSqliteNativeBackup,
  restoreSqliteNativeBackup,
} from "./lib/sqliteBackupRestore.js";
import {
  logicalVerificationsMatch,
  readSqliteLogicalVerification,
} from "./lib/sqliteLogicalVerification.js";
import { repoRoot, serverRoot } from "./lib/paths.js";
import { parseRestoreSqliteArgs } from "./restoreSqliteRehearsal.js";

interface CheckResult {
  name: string;
  ok: boolean;
}

const checks: CheckResult[] = [];

const check = async (name: string, action: () => unknown | Promise<unknown>) => {
  try {
    await action();
    checks.push({ name, ok: true });
  } catch {
    checks.push({ name, ok: false });
  }
};

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("assertion_failed");
}

const expectFailure = async (
  action: () => unknown | Promise<unknown>,
  expectedMessage?: string,
) => {
  try {
    await action();
  } catch (error) {
    if (expectedMessage) {
      assert(error instanceof Error && error.message.includes(expectedMessage));
    }
    return;
  }
  throw new Error("expected_failure");
};

const createEmptyPrototype = (databasePath: string): void => {
  const schema = readFileSync(
    path.join(serverRoot, "schema", "prototype-schema.sql"),
    "utf8",
  );
  const db = new Database(databasePath);
  try {
    db.exec(schema);
  } finally {
    db.close();
  }
};

const main = async (): Promise<void> => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "pf-sqlite-rehearsal-test-"));
  const source = path.join(tempRoot, "source.sqlite");
  const backup = path.join(tempRoot, "backup.sqlite");
  const manifest = `${backup}.manifest.json`;
  const restored = path.join(tempRoot, "restored.sqlite");
  const asOf = new Date(2026, 6, 22);

  try {
    createEmptyPrototype(source);

    await check("CLI argument parsing fails closed", async () => {
      await expectFailure(() => parseBackupSqliteArgs(["--unknown"]));
      await expectFailure(() => parseBackupSqliteArgs(["--source"]));
      await expectFailure(() => parseRestoreSqliteArgs(["--unknown"]));
      await expectFailure(() => parseRestoreSqliteArgs(["--manifest"]));
    });

    await check("missing source is rejected", async () => {
      const output = path.join(tempRoot, "missing-source-output.sqlite");
      await expectFailure(() =>
        createSqliteNativeBackup({
          sourcePath: path.join(tempRoot, "missing.sqlite"),
          outputPath: output,
          asOf,
        }),
      );
      assert(!existsSync(output));
    });

    await check("same source and output path is rejected", async () => {
      await expectFailure(
        () =>
          createSqliteNativeBackup({
            sourcePath: source,
            outputPath: source,
            asOf,
          }),
        "already exists",
      );
    });

    await check("existing output is never overwritten", async () => {
      const output = path.join(tempRoot, "existing.sqlite");
      writeFileSync(output, "sentinel", "utf8");
      await expectFailure(
        () =>
          createSqliteNativeBackup({
            sourcePath: source,
            outputPath: output,
            asOf,
          }),
        "already exists",
      );
      assert(readFileSync(output, "utf8") === "sentinel");
    });

    await check("repo-local output is rejected", async () => {
      const output = path.join(repoRoot, "sqlite-rehearsal-test-output.sqlite");
      assert(!existsSync(output));
      await expectFailure(
        () =>
          createSqliteNativeBackup({
            sourcePath: source,
            outputPath: output,
            asOf,
          }),
        "inside the repository",
      );
      assert(!existsSync(output));
    });

    await check("invalid SQLite input fails without partial output", async () => {
      const invalidSource = path.join(tempRoot, "invalid.sqlite");
      const output = path.join(tempRoot, "invalid-output.sqlite");
      writeFileSync(invalidSource, "not sqlite", "utf8");
      await expectFailure(() =>
        createSqliteNativeBackup({
          sourcePath: invalidSource,
          outputPath: output,
          asOf,
        }),
      );
      assert(!existsSync(output));
      assert(!existsSync(`${output}.manifest.json`));
    });

    await check("late manifest failure cleans partial backup output", async () => {
      const output = path.join(tempRoot, "partial-backup-output.sqlite");
      const blockedParent = path.join(tempRoot, "manifest-parent-is-a-file");
      writeFileSync(blockedParent, "sentinel", "utf8");
      await expectFailure(() =>
        createSqliteNativeBackup({
          sourcePath: source,
          outputPath: output,
          manifestPath: path.join(blockedParent, "manifest.json"),
          asOf,
        }),
      );
      assert(!existsSync(output));
      assert(readFileSync(blockedParent, "utf8") === "sentinel");
    });

    await check("native backup and restore preserve logical content", async () => {
      await createSqliteNativeBackup({
        sourcePath: source,
        outputPath: backup,
        manifestPath: manifest,
        asOf,
      });
      await restoreSqliteNativeBackup({
        backupPath: backup,
        outputPath: restored,
        manifestPath: manifest,
      });
      assert(existsSync(backup) && existsSync(manifest) && existsSync(restored));
    });

    await check("missing manifest is rejected without restore output", async () => {
      const output = path.join(tempRoot, "missing-manifest-output.sqlite");
      await expectFailure(() =>
        restoreSqliteNativeBackup({
          backupPath: backup,
          outputPath: output,
          manifestPath: path.join(tempRoot, "missing-manifest.json"),
        }),
      );
      assert(!existsSync(output));
    });

    await check("corrupt backup is rejected without restore output", async () => {
      const corruptBackup = path.join(tempRoot, "corrupt-backup.sqlite");
      const output = path.join(tempRoot, "corrupt-backup-output.sqlite");
      writeFileSync(corruptBackup, "not sqlite", "utf8");
      await expectFailure(() =>
        restoreSqliteNativeBackup({
          backupPath: corruptBackup,
          outputPath: output,
          manifestPath: manifest,
        }),
      );
      assert(!existsSync(output));
    });

    await check("manifest mismatch is rejected without restore output", async () => {
      const tamperedManifest = path.join(tempRoot, "tampered-manifest.json");
      const output = path.join(tempRoot, "tampered-manifest-output.sqlite");
      const value = JSON.parse(readFileSync(manifest, "utf8")) as {
        backupDatabaseIdentityFingerprint: string;
      };
      value.backupDatabaseIdentityFingerprint = "0".repeat(64);
      writeFileSync(tamperedManifest, JSON.stringify(value), "utf8");
      await expectFailure(() =>
        restoreSqliteNativeBackup({
          backupPath: backup,
          outputPath: output,
          manifestPath: tamperedManifest,
        }),
      );
      assert(!existsSync(output));
    });

    await check("altered restored content is detected", () => {
      const backupDb = new Database(backup, { readonly: true });
      const restoredDb = new Database(restored);
      try {
        restoredDb.pragma("user_version = 7");
        const expected = readSqliteLogicalVerification(backupDb, asOf);
        const actual = readSqliteLogicalVerification(restoredDb, asOf);
        assert(!logicalVerificationsMatch(expected, actual));
      } finally {
        backupDb.close();
        restoredDb.close();
      }
    });

    await check("altered backup is rejected by its manifest", async () => {
      const backupDb = new Database(backup);
      try {
        backupDb.pragma("user_version = 9");
      } finally {
        backupDb.close();
      }
      const output = path.join(tempRoot, "altered-backup-output.sqlite");
      await expectFailure(
        () =>
          restoreSqliteNativeBackup({
            backupPath: backup,
            outputPath: output,
            manifestPath: manifest,
          }),
        "sqlite_backup_manifest_mismatch",
      );
      assert(!existsSync(output));
    });
  } finally {
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedOsTemp = path.resolve(tmpdir());
    assert(
      resolvedTemp.startsWith(`${resolvedOsTemp}${path.sep}`) &&
        path.basename(resolvedTemp).startsWith("pf-sqlite-rehearsal-test-"),
    );
    rmSync(resolvedTemp, { recursive: true, force: true });
  }

  for (const result of checks) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  }
  const failed = checks.filter((result) => !result.ok).length;
  console.log(
    `SQLite backup/restore checks: total=${checks.length} passed=${checks.length - failed} failed=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

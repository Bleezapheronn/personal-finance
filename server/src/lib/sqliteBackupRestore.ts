import Database from "better-sqlite3";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isPlainObject } from "./backup.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  assertPathDoesNotExist,
  basename,
  pathsReferToSameLocation,
  resolvePathIdentity,
} from "./paths.js";
import { openReadOnlyDatabase } from "./sqlite.js";
import {
  logicalVerificationsMatch,
  readSqliteLogicalVerification,
  type SqliteLogicalVerification,
} from "./sqliteLogicalVerification.js";

export const SQLITE_BACKUP_MANIFEST_VERSION = 1 as const;

export interface SqliteBackupManifest {
  manifestVersion: 1;
  createdAt: string;
  normalizedAsOf: string;
  sourceDatabaseIdentityFingerprint: string;
  backupDatabaseIdentityFingerprint: string;
  backupVerification: SqliteLogicalVerification;
  overallStatus: "pass";
  recoveryNotes: string[];
}

export interface SqliteBackupResult {
  status: "pass";
  sourceFile: string;
  backupFile: string;
  manifestFile: string;
  databaseIdentityFingerprint: string;
  tableCount: number;
}

export interface SqliteRestoreResult {
  status: "pass";
  backupFile: string;
  restoredFile: string;
  manifestFile: string;
  databaseIdentityFingerprint: string;
  tableCount: number;
}

const strictLocalDay = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("manifest_as_of_invalid");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("manifest_as_of_invalid");
  }
  return date;
};

const assertOutsideRepo = (
  filePath: string,
  allowRepoOutputForTests: boolean,
  label: string,
): void =>
  assertOutsideRepoUnlessAllowed(
    resolvePathIdentity(filePath),
    allowRepoOutputForTests,
    label,
  );

const assertDistinct = (
  paths: Array<{ path: string; label: string }>,
): void => {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (pathsReferToSameLocation(paths[left].path, paths[right].path)) {
        throw new Error(
          `${paths[left].label} and ${paths[right].label} must be different paths.`,
        );
      }
    }
  }
};

const reserveSqliteOutput = (outputPath: string): void => {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    const descriptor = openSync(outputPath, "wx");
    closeSync(descriptor);
    const placeholder = new Database(outputPath, { fileMustExist: true });
    try {
      placeholder.exec("VACUUM");
    } finally {
      placeholder.close();
    }
  } catch (error) {
    cleanupSqliteOutput(outputPath);
    throw error;
  }
};

const cleanupSqliteOutput = (outputPath: string): void => {
  for (const candidate of [
    outputPath,
    `${outputPath}-journal`,
    `${outputPath}-wal`,
    `${outputPath}-shm`,
  ]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
};

const verifyManifestShape = (value: unknown): SqliteBackupManifest => {
  if (
    !isPlainObject(value) ||
    value.manifestVersion !== SQLITE_BACKUP_MANIFEST_VERSION ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(new Date(value.createdAt).getTime()) ||
    typeof value.normalizedAsOf !== "string" ||
    typeof value.sourceDatabaseIdentityFingerprint !== "string" ||
    typeof value.backupDatabaseIdentityFingerprint !== "string" ||
    value.overallStatus !== "pass" ||
    !Array.isArray(value.recoveryNotes) ||
    value.recoveryNotes.some((note) => typeof note !== "string") ||
    !isPlainObject(value.backupVerification)
  ) {
    throw new Error("backup_manifest_invalid");
  }
  strictLocalDay(value.normalizedAsOf);
  const verification = value.backupVerification as unknown as SqliteLogicalVerification;
  if (
    verification.verificationVersion !== 1 ||
    verification.integrityCheck !== "ok" ||
    verification.normalizedAsOf !== value.normalizedAsOf ||
    verification.databaseIdentityFingerprint !==
      value.backupDatabaseIdentityFingerprint ||
    value.sourceDatabaseIdentityFingerprint !==
      value.backupDatabaseIdentityFingerprint
  ) {
    throw new Error("backup_manifest_invalid");
  }
  return value as unknown as SqliteBackupManifest;
};

export const readSqliteBackupManifest = (
  manifestPath: string,
): SqliteBackupManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("backup_manifest_invalid");
  }
  return verifyManifestShape(parsed);
};

const verifyDatabaseAtPath = (
  databasePath: string,
  asOf: Date,
): SqliteLogicalVerification => {
  const db = openReadOnlyDatabase(databasePath);
  try {
    return readSqliteLogicalVerification(db, asOf);
  } finally {
    db.close();
  }
};

export const createSqliteNativeBackup = async (options: {
  sourcePath: string;
  outputPath: string;
  manifestPath?: string;
  asOf?: Date;
  allowRepoOutputForTests?: boolean;
}): Promise<SqliteBackupResult> => {
  const sourcePath = path.resolve(options.sourcePath);
  const outputPath = path.resolve(options.outputPath);
  const manifestPath = path.resolve(
    options.manifestPath ?? `${outputPath}.manifest.json`,
  );
  const allowRepoOutputForTests = options.allowRepoOutputForTests === true;
  assertFileExists(sourcePath, "SQLite source");
  assertPathDoesNotExist(outputPath, "SQLite backup output");
  assertPathDoesNotExist(manifestPath, "SQLite backup manifest");
  assertOutsideRepo(sourcePath, allowRepoOutputForTests, "SQLite source");
  assertOutsideRepo(outputPath, allowRepoOutputForTests, "SQLite backup output");
  assertOutsideRepo(manifestPath, allowRepoOutputForTests, "SQLite backup manifest");
  assertDistinct([
    { path: sourcePath, label: "SQLite source" },
    { path: outputPath, label: "SQLite backup output" },
    { path: manifestPath, label: "SQLite backup manifest" },
  ]);

  const asOf = options.asOf ?? new Date();
  let outputReserved = false;
  let manifestWritten = false;
  const sourceDb = openReadOnlyDatabase(sourcePath);
  try {
    const sourceBefore = readSqliteLogicalVerification(sourceDb, asOf);
    reserveSqliteOutput(outputPath);
    outputReserved = true;
    await sourceDb.backup(outputPath);
    const sourceAfter = readSqliteLogicalVerification(sourceDb, asOf);
    if (
      !logicalVerificationsMatch(sourceBefore, sourceAfter) ||
      sourceBefore.schemaVersion !== sourceAfter.schemaVersion
    ) {
      throw new Error("sqlite_source_changed_during_backup");
    }
    const backupVerification = verifyDatabaseAtPath(outputPath, asOf);
    if (!logicalVerificationsMatch(sourceBefore, backupVerification)) {
      throw new Error("sqlite_backup_logical_mismatch");
    }

    const manifest: SqliteBackupManifest = {
      manifestVersion: SQLITE_BACKUP_MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      normalizedAsOf: sourceBefore.normalizedAsOf,
      sourceDatabaseIdentityFingerprint:
        sourceBefore.databaseIdentityFingerprint,
      backupDatabaseIdentityFingerprint:
        backupVerification.databaseIdentityFingerprint,
      backupVerification,
      overallStatus: "pass",
      recoveryNotes: [
        "The manifest verifies logical content and is not a data backup by itself.",
        "Stop the API before replacing its configured disposable SQLite database.",
        "Dexie remains authoritative in the default application mode.",
      ],
    };
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    manifestWritten = true;
    return {
      status: "pass",
      sourceFile: basename(sourcePath),
      backupFile: basename(outputPath),
      manifestFile: basename(manifestPath),
      databaseIdentityFingerprint:
        backupVerification.databaseIdentityFingerprint,
      tableCount: backupVerification.tableNames.length,
    };
  } catch (error) {
    if (manifestWritten && existsSync(manifestPath)) unlinkSync(manifestPath);
    if (outputReserved) cleanupSqliteOutput(outputPath);
    throw error;
  } finally {
    sourceDb.close();
  }
};

export const restoreSqliteNativeBackup = async (options: {
  backupPath: string;
  outputPath: string;
  manifestPath: string;
  allowRepoOutputForTests?: boolean;
}): Promise<SqliteRestoreResult> => {
  const manifestPath = path.resolve(options.manifestPath);
  assertFileExists(manifestPath, "SQLite backup manifest");
  const manifest = readSqliteBackupManifest(manifestPath);
  return restoreSqliteVerifiedBackup({
    backupPath: options.backupPath,
    outputPath: options.outputPath,
    manifestPath,
    expectedVerification: manifest.backupVerification,
    allowRepoOutputForTests: options.allowRepoOutputForTests,
  });
};

export const restoreSqliteVerifiedBackup = async (options: {
  backupPath: string;
  outputPath: string;
  manifestPath: string;
  expectedVerification: SqliteLogicalVerification;
  allowRepoOutputForTests?: boolean;
}): Promise<SqliteRestoreResult> => {
  const backupPath = path.resolve(options.backupPath);
  const outputPath = path.resolve(options.outputPath);
  const manifestPath = path.resolve(options.manifestPath);
  const allowRepoOutputForTests = options.allowRepoOutputForTests === true;
  assertFileExists(backupPath, "SQLite backup");
  assertFileExists(manifestPath, "SQLite backup manifest");
  assertPathDoesNotExist(outputPath, "SQLite restore output");
  assertOutsideRepo(backupPath, allowRepoOutputForTests, "SQLite backup");
  assertOutsideRepo(manifestPath, allowRepoOutputForTests, "SQLite backup manifest");
  assertOutsideRepo(outputPath, allowRepoOutputForTests, "SQLite restore output");
  assertDistinct([
    { path: backupPath, label: "SQLite backup" },
    { path: outputPath, label: "SQLite restore output" },
    { path: manifestPath, label: "SQLite backup manifest" },
  ]);

  const asOf = strictLocalDay(options.expectedVerification.normalizedAsOf);
  const backupVerification = verifyDatabaseAtPath(backupPath, asOf);
  if (
    !logicalVerificationsMatch(
      backupVerification,
      options.expectedVerification,
    ) ||
    backupVerification.schemaVersion !==
      options.expectedVerification.schemaVersion
  ) {
    throw new Error("sqlite_backup_manifest_mismatch");
  }

  let outputReserved = false;
  const backupDb = openReadOnlyDatabase(backupPath);
  try {
    reserveSqliteOutput(outputPath);
    outputReserved = true;
    await backupDb.backup(outputPath);
    const backupAfter = readSqliteLogicalVerification(backupDb, asOf);
    if (
      !logicalVerificationsMatch(backupVerification, backupAfter) ||
      backupVerification.schemaVersion !== backupAfter.schemaVersion
    ) {
      throw new Error("sqlite_backup_changed_during_restore");
    }
    const restoredVerification = verifyDatabaseAtPath(outputPath, asOf);
    if (
      !logicalVerificationsMatch(backupVerification, restoredVerification) ||
      !logicalVerificationsMatch(
        options.expectedVerification,
        restoredVerification,
      )
    ) {
      throw new Error("sqlite_restored_logical_mismatch");
    }
    return {
      status: "pass",
      backupFile: basename(backupPath),
      restoredFile: basename(outputPath),
      manifestFile: basename(manifestPath),
      databaseIdentityFingerprint:
        restoredVerification.databaseIdentityFingerprint,
      tableCount: restoredVerification.tableNames.length,
    };
  } catch (error) {
    if (outputReserved) cleanupSqliteOutput(outputPath);
    throw error;
  } finally {
    backupDb.close();
  }
};

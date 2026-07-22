import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { runSqlitePrototypeVerification } from "../verifySqlitePrototype.js";
import { isPlainObject } from "./backup.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  assertPathDoesNotExist,
  basename,
  pathsReferToSameLocation,
  serverRoot,
  resolvePathIdentity,
} from "./paths.js";
import {
  createSqliteNativeBackup,
  readSqliteBackupManifest,
} from "./sqliteBackupRestore.js";
import {
  fingerprintLogicalValue,
  logicalVerificationsMatch,
  readSqliteLogicalVerification,
  readSqliteLogicalVerificationAtPath,
  type SqliteLogicalVerification,
} from "./sqliteLogicalVerification.js";
import {
  SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS,
  WRITE_CAPABILITY_KEYS,
  type WriteCapabilities,
  type WriteCapabilityKey,
} from "./writeCapabilities.js";

export const SQLITE_AUTHORITY_CUTOVER_MANIFEST_VERSION = 1 as const;
export const SQLITE_AUTHORITY_CHECKPOINT_MANIFEST_VERSION = 2 as const;
export const SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID =
  "sqlite-authority-phase1-rollback" as const;
export const SQLITE_AUTHORITY_CHECKPOINT_RECOVERY_NOTES_ID =
  "sqlite-authority-checkpoint-recovery" as const;

export interface SqliteAuthorityCutoverManifest {
  manifestVersion: 1;
  createdAt: string;
  normalizedAsOf: string;
  candidateDatabaseIdentityFingerprint: string;
  backupDatabaseIdentityFingerprint: string;
  candidateVerification: SqliteLogicalVerification;
  backupVerification: SqliteLogicalVerification;
  sourceBackupVerification: {
    overallStatus: "pass";
    comparedChecks: number;
    totalMismatchCount: 0;
  };
  backupFileName: string;
  requiredCapabilities: WriteCapabilityKey[];
  unsupportedOperations: string[];
  nativeBackupVerified: true;
  overallReadiness: "ready";
  rollbackInstructionsId: typeof SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID;
}

export interface SqliteAuthorityCheckpointManifest {
  manifestVersion: 2;
  manifestKind: "sqlite-authority-checkpoint";
  authorityLineageId: string;
  checkpointSequence: number;
  checkpointId: string;
  predecessorCheckpointId: string;
  createdAt: string;
  normalizedAsOf: string;
  databaseIdentityFingerprint: string;
  backupDatabaseIdentityFingerprint: string;
  databaseVerification: SqliteLogicalVerification;
  backupVerification: SqliteLogicalVerification;
  backupFileName: string;
  userVersion: number;
  schemaVersion: number;
  requiredCapabilities: WriteCapabilityKey[];
  unsupportedOperations: string[];
  nativeBackupVerified: true;
  backupVerificationResult: "pass";
  checkpointStatus: "ready";
  recoveryNotesId: typeof SQLITE_AUTHORITY_CHECKPOINT_RECOVERY_NOTES_ID;
  label?: string;
}

export type SqliteAuthorityManifest =
  | SqliteAuthorityCutoverManifest
  | SqliteAuthorityCheckpointManifest;

export interface SqliteAuthorityManifestDescriptor {
  manifest: SqliteAuthorityManifest;
  authorityLineageId: string;
  checkpointSequence: number;
  checkpointId: string;
  predecessorCheckpointId?: string;
  createdAt: string;
  normalizedAsOf: string;
  databaseVerification: SqliteLogicalVerification;
  backupVerification: SqliteLogicalVerification;
  backupFileName: string;
  requiredCapabilities: WriteCapabilityKey[];
  unsupportedOperations: string[];
}

export interface SqliteAuthorityReadiness {
  authorityEnabled: boolean;
  ready: boolean;
  cutoverVerified: boolean;
  backupVerified: boolean;
  rollbackAvailable: boolean;
  storageMode: "sqlite-disposable" | "sqlite-authoritative";
  authoritative: boolean;
  missingRequirements: string[];
  requiredCapabilities: WriteCapabilityKey[];
  unsupportedOperations: string[];
  code?: string;
}

export interface SqliteAuthorityCutoverResult {
  status: "ready";
  candidateFile: string;
  backupFile: string;
  manifestFile: string;
  verifiedTables: number;
}

export interface SqliteAuthorityRollbackResult {
  status: "ready";
  cutoverBackupVerified: true;
  currentBackupVerified: true;
  rollbackInstructionsId: typeof SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID;
}

export const strictSqliteAuthorityLocalDay = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("cutover_manifest_as_of_invalid");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("cutover_manifest_as_of_invalid");
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

const assertDistinctPaths = (
  entries: Array<{ path: string; label: string }>,
): void => {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (pathsReferToSameLocation(entries[left].path, entries[right].path)) {
        throw new Error(
          `${entries[left].label} and ${entries[right].label} must be different paths.`,
        );
      }
    }
  }
};

const removeSqliteArtifacts = (databasePath: string): void => {
  for (const candidate of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
};

export const assertSqliteAuthoritySchemaContract = (
  candidate: SqliteLogicalVerification,
  asOf: Date,
): void => {
  const expectedDb = new Database(":memory:");
  try {
    expectedDb.exec(
      readFileSync(
        path.join(serverRoot, "schema", "prototype-schema.sql"),
        "utf8",
      ),
    );
    const expected = readSqliteLogicalVerification(expectedDb, asOf);
    if (
      candidate.userVersion !== expected.userVersion ||
      candidate.schemaFingerprint !== expected.schemaFingerprint ||
      !sameStringArray(candidate.tableNames, expected.tableNames)
    ) {
      throw new Error("sqlite_authority_schema_contract_mismatch");
    }
  } finally {
    expectedDb.close();
  }
};

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const verificationShapeIsValid = (
  value: unknown,
): value is SqliteLogicalVerification =>
  isPlainObject(value) &&
  value.verificationVersion === 1 &&
  value.integrityCheck === "ok" &&
  typeof value.normalizedAsOf === "string" &&
  Number.isInteger(value.userVersion) &&
  Number.isInteger(value.schemaVersion) &&
  typeof value.schemaFingerprint === "string" &&
  isPlainObject(value.rowCounts) &&
  isPlainObject(value.tableContentFingerprints) &&
  typeof value.databaseIdentityFingerprint === "string";

const sameStringArray = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const SHA256_HEX = /^[a-f0-9]{64}$/;

export const derivePhaseOneAuthorityLineageId = (
  manifest: SqliteAuthorityCutoverManifest,
): string =>
  fingerprintLogicalValue({
    kind: "sqlite-authority-lineage",
    manifestVersion: manifest.manifestVersion,
    createdAt: manifest.createdAt,
    normalizedAsOf: manifest.normalizedAsOf,
    candidateDatabaseIdentityFingerprint:
      manifest.candidateDatabaseIdentityFingerprint,
    backupDatabaseIdentityFingerprint:
      manifest.backupDatabaseIdentityFingerprint,
    backupFileName: manifest.backupFileName,
  });

export const derivePhaseOneCheckpointId = (
  manifest: SqliteAuthorityCutoverManifest,
): string =>
  fingerprintLogicalValue({
    kind: "sqlite-authority-checkpoint",
    authorityLineageId: derivePhaseOneAuthorityLineageId(manifest),
    checkpointSequence: 0,
    createdAt: manifest.createdAt,
    normalizedAsOf: manifest.normalizedAsOf,
    databaseIdentityFingerprint:
      manifest.candidateDatabaseIdentityFingerprint,
    backupDatabaseIdentityFingerprint:
      manifest.backupDatabaseIdentityFingerprint,
  });

export const deriveAuthorityCheckpointId = (
  manifest: Omit<SqliteAuthorityCheckpointManifest, "checkpointId">,
): string =>
  fingerprintLogicalValue({
    kind: manifest.manifestKind,
    authorityLineageId: manifest.authorityLineageId,
    checkpointSequence: manifest.checkpointSequence,
    predecessorCheckpointId: manifest.predecessorCheckpointId,
    createdAt: manifest.createdAt,
    normalizedAsOf: manifest.normalizedAsOf,
    databaseIdentityFingerprint: manifest.databaseIdentityFingerprint,
    backupDatabaseIdentityFingerprint:
      manifest.backupDatabaseIdentityFingerprint,
    backupFileName: manifest.backupFileName,
    userVersion: manifest.userVersion,
    schemaVersion: manifest.schemaVersion,
    requiredCapabilities: manifest.requiredCapabilities,
    unsupportedOperations: manifest.unsupportedOperations,
    ...(manifest.label ? { label: manifest.label } : {}),
  });

export const readSqliteAuthorityCutoverManifest = (
  manifestPath: string,
): SqliteAuthorityCutoverManifest => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("cutover_manifest_invalid");
  }

  if (
    !isPlainObject(value) ||
    value.manifestVersion !== SQLITE_AUTHORITY_CUTOVER_MANIFEST_VERSION ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(new Date(value.createdAt).getTime()) ||
    typeof value.normalizedAsOf !== "string" ||
    typeof value.candidateDatabaseIdentityFingerprint !== "string" ||
    typeof value.backupDatabaseIdentityFingerprint !== "string" ||
    !verificationShapeIsValid(value.candidateVerification) ||
    !verificationShapeIsValid(value.backupVerification) ||
    !isPlainObject(value.sourceBackupVerification) ||
    value.sourceBackupVerification.overallStatus !== "pass" ||
    !Number.isInteger(value.sourceBackupVerification.comparedChecks) ||
    value.sourceBackupVerification.comparedChecks !== 6 ||
    value.sourceBackupVerification.totalMismatchCount !== 0 ||
    typeof value.backupFileName !== "string" ||
    value.backupFileName !== path.basename(value.backupFileName) ||
    value.backupFileName.length === 0 ||
    !stringArray(value.requiredCapabilities) ||
    !stringArray(value.unsupportedOperations) ||
    value.nativeBackupVerified !== true ||
    value.overallReadiness !== "ready" ||
    value.rollbackInstructionsId !== SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID
  ) {
    throw new Error("cutover_manifest_invalid");
  }

  strictSqliteAuthorityLocalDay(value.normalizedAsOf);
  if (
    value.candidateVerification.normalizedAsOf !== value.normalizedAsOf ||
    value.backupVerification.normalizedAsOf !== value.normalizedAsOf ||
    value.candidateVerification.databaseIdentityFingerprint !==
      value.candidateDatabaseIdentityFingerprint ||
    value.backupVerification.databaseIdentityFingerprint !==
      value.backupDatabaseIdentityFingerprint ||
    !sameStringArray(value.requiredCapabilities, WRITE_CAPABILITY_KEYS) ||
    !sameStringArray(
      value.unsupportedOperations,
      SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS,
    )
  ) {
    throw new Error("cutover_manifest_invalid");
  }

  return value as unknown as SqliteAuthorityCutoverManifest;
};

const checkpointLabelIsValid = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value));

const verifyCheckpointManifestShape = (
  value: unknown,
): SqliteAuthorityCheckpointManifest => {
  if (
    !isPlainObject(value) ||
    value.manifestVersion !== SQLITE_AUTHORITY_CHECKPOINT_MANIFEST_VERSION ||
    value.manifestKind !== "sqlite-authority-checkpoint" ||
    typeof value.authorityLineageId !== "string" ||
    !SHA256_HEX.test(value.authorityLineageId) ||
    !Number.isInteger(value.checkpointSequence) ||
    (value.checkpointSequence as number) < 1 ||
    typeof value.checkpointId !== "string" ||
    !SHA256_HEX.test(value.checkpointId) ||
    typeof value.predecessorCheckpointId !== "string" ||
    !SHA256_HEX.test(value.predecessorCheckpointId) ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(new Date(value.createdAt).getTime()) ||
    typeof value.normalizedAsOf !== "string" ||
    typeof value.databaseIdentityFingerprint !== "string" ||
    typeof value.backupDatabaseIdentityFingerprint !== "string" ||
    !verificationShapeIsValid(value.databaseVerification) ||
    !verificationShapeIsValid(value.backupVerification) ||
    typeof value.backupFileName !== "string" ||
    value.backupFileName !== path.basename(value.backupFileName) ||
    value.backupFileName.length === 0 ||
    !Number.isInteger(value.userVersion) ||
    !Number.isInteger(value.schemaVersion) ||
    !stringArray(value.requiredCapabilities) ||
    !stringArray(value.unsupportedOperations) ||
    value.nativeBackupVerified !== true ||
    value.backupVerificationResult !== "pass" ||
    value.checkpointStatus !== "ready" ||
    value.recoveryNotesId !== SQLITE_AUTHORITY_CHECKPOINT_RECOVERY_NOTES_ID ||
    !checkpointLabelIsValid(value.label)
  ) {
    throw new Error("authority_checkpoint_manifest_invalid");
  }

  strictSqliteAuthorityLocalDay(value.normalizedAsOf);
  const manifest = value as unknown as SqliteAuthorityCheckpointManifest;
  if (
    manifest.databaseVerification.normalizedAsOf !== manifest.normalizedAsOf ||
    manifest.backupVerification.normalizedAsOf !== manifest.normalizedAsOf ||
    manifest.databaseVerification.databaseIdentityFingerprint !==
      manifest.databaseIdentityFingerprint ||
    manifest.backupVerification.databaseIdentityFingerprint !==
      manifest.backupDatabaseIdentityFingerprint ||
    manifest.databaseVerification.userVersion !== manifest.userVersion ||
    manifest.databaseVerification.schemaVersion !== manifest.schemaVersion ||
    !sameStringArray(manifest.requiredCapabilities, WRITE_CAPABILITY_KEYS) ||
    !sameStringArray(
      manifest.unsupportedOperations,
      SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS,
    )
  ) {
    throw new Error("authority_checkpoint_manifest_invalid");
  }
  const { checkpointId: _checkpointId, ...checkpointWithoutId } = manifest;
  if (deriveAuthorityCheckpointId(checkpointWithoutId) !== manifest.checkpointId) {
    throw new Error("authority_checkpoint_manifest_invalid");
  }
  return manifest;
};

export const readSqliteAuthorityManifest = (
  manifestPath: string,
): SqliteAuthorityManifest => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("authority_manifest_invalid");
  }
  if (isPlainObject(value) && value.manifestVersion === 1) {
    return readSqliteAuthorityCutoverManifest(manifestPath);
  }
  return verifyCheckpointManifestShape(value);
};

export const describeSqliteAuthorityManifest = (
  manifest: SqliteAuthorityManifest,
): SqliteAuthorityManifestDescriptor => {
  if (manifest.manifestVersion === 1) {
    return {
      manifest,
      authorityLineageId: derivePhaseOneAuthorityLineageId(manifest),
      checkpointSequence: 0,
      checkpointId: derivePhaseOneCheckpointId(manifest),
      createdAt: manifest.createdAt,
      normalizedAsOf: manifest.normalizedAsOf,
      databaseVerification: manifest.candidateVerification,
      backupVerification: manifest.backupVerification,
      backupFileName: manifest.backupFileName,
      requiredCapabilities: [...manifest.requiredCapabilities],
      unsupportedOperations: [...manifest.unsupportedOperations],
    };
  }
  return {
    manifest,
    authorityLineageId: manifest.authorityLineageId,
    checkpointSequence: manifest.checkpointSequence,
    checkpointId: manifest.checkpointId,
    predecessorCheckpointId: manifest.predecessorCheckpointId,
    createdAt: manifest.createdAt,
    normalizedAsOf: manifest.normalizedAsOf,
    databaseVerification: manifest.databaseVerification,
    backupVerification: manifest.backupVerification,
    backupFileName: manifest.backupFileName,
    requiredCapabilities: [...manifest.requiredCapabilities],
    unsupportedOperations: [...manifest.unsupportedOperations],
  };
};

export const readSqliteAuthorityManifestDescriptor = (
  manifestPath: string,
): SqliteAuthorityManifestDescriptor =>
  describeSqliteAuthorityManifest(readSqliteAuthorityManifest(manifestPath));

export const prepareSqliteAuthorityCutover = async (options: {
  sourceBackupPath: string;
  candidatePath: string;
  backupOutputPath: string;
  manifestPath: string;
  asOf?: Date;
  allowRepoOutputForTests?: boolean;
}): Promise<SqliteAuthorityCutoverResult> => {
  const sourceBackupPath = path.resolve(options.sourceBackupPath);
  const candidatePath = path.resolve(options.candidatePath);
  const backupOutputPath = path.resolve(options.backupOutputPath);
  const manifestPath = path.resolve(options.manifestPath);
  const nativeManifestPath = `${manifestPath}.native-backup.tmp.json`;
  const allowRepoOutputForTests = options.allowRepoOutputForTests === true;

  assertFileExists(sourceBackupPath, "Matching full JSON backup");
  assertFileExists(candidatePath, "SQLite authority candidate");
  assertPathDoesNotExist(backupOutputPath, "SQLite authority backup output");
  assertPathDoesNotExist(manifestPath, "SQLite cutover manifest");
  assertPathDoesNotExist(nativeManifestPath, "Temporary native backup manifest");
  for (const [filePath, label] of [
    [sourceBackupPath, "Matching full JSON backup"],
    [candidatePath, "SQLite authority candidate"],
    [backupOutputPath, "SQLite authority backup output"],
    [manifestPath, "SQLite cutover manifest"],
    [nativeManifestPath, "Temporary native backup manifest"],
  ] as const) {
    assertOutsideRepo(filePath, allowRepoOutputForTests, label);
  }
  assertDistinctPaths([
    { path: sourceBackupPath, label: "Matching full JSON backup" },
    { path: candidatePath, label: "SQLite authority candidate" },
    { path: backupOutputPath, label: "SQLite authority backup output" },
    { path: manifestPath, label: "SQLite cutover manifest" },
  ]);
  if (
    !pathsReferToSameLocation(
      path.dirname(backupOutputPath),
      path.dirname(manifestPath),
    )
  ) {
    throw new Error(
      "SQLite authority backup output and cutover manifest must share a directory.",
    );
  }

  const asOf = options.asOf ?? new Date();
  const sourceBackupVerification = runSqlitePrototypeVerification(
    sourceBackupPath,
    candidatePath,
    undefined,
    undefined,
  );
  if (
    sourceBackupVerification.overallStatus !== "pass" ||
    sourceBackupVerification.failedChecks !== 0 ||
    sourceBackupVerification.totalMismatchCount !== 0
  ) {
    throw new Error("sqlite_authority_source_backup_verification_failed");
  }
  const candidateBefore = readSqliteLogicalVerificationAtPath(candidatePath, asOf);
  assertSqliteAuthoritySchemaContract(candidateBefore, asOf);
  if (
    Object.values(candidateBefore.integritySummary).some(
      (issueCount) => issueCount !== 0,
    )
  ) {
    throw new Error("sqlite_authority_structural_integrity_issues");
  }
  let backupCreated = false;
  let manifestWritten = false;
  try {
    await createSqliteNativeBackup({
      sourcePath: candidatePath,
      outputPath: backupOutputPath,
      manifestPath: nativeManifestPath,
      asOf,
      allowRepoOutputForTests,
    });
    backupCreated = true;
    const nativeManifest = readSqliteBackupManifest(nativeManifestPath);
    const candidateAfter = readSqliteLogicalVerificationAtPath(candidatePath, asOf);
    if (
      !logicalVerificationsMatch(candidateBefore, candidateAfter) ||
      candidateBefore.schemaVersion !== candidateAfter.schemaVersion
    ) {
      throw new Error("sqlite_authority_candidate_changed_during_preflight");
    }
    if (!logicalVerificationsMatch(candidateBefore, nativeManifest.backupVerification)) {
      throw new Error("sqlite_authority_backup_mismatch");
    }

    const manifest: SqliteAuthorityCutoverManifest = {
      manifestVersion: SQLITE_AUTHORITY_CUTOVER_MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      normalizedAsOf: candidateBefore.normalizedAsOf,
      candidateDatabaseIdentityFingerprint:
        candidateBefore.databaseIdentityFingerprint,
      backupDatabaseIdentityFingerprint:
        nativeManifest.backupVerification.databaseIdentityFingerprint,
      candidateVerification: candidateBefore,
      backupVerification: nativeManifest.backupVerification,
      sourceBackupVerification: {
        overallStatus: "pass",
        comparedChecks: sourceBackupVerification.comparedChecks,
        totalMismatchCount: 0,
      },
      backupFileName: basename(backupOutputPath),
      requiredCapabilities: [...WRITE_CAPABILITY_KEYS],
      unsupportedOperations: [...SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS],
      nativeBackupVerified: true,
      overallReadiness: "ready",
      rollbackInstructionsId: SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID,
    };
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    manifestWritten = true;
    return {
      status: "ready",
      candidateFile: basename(candidatePath),
      backupFile: basename(backupOutputPath),
      manifestFile: basename(manifestPath),
      verifiedTables: candidateBefore.tableNames.length,
    };
  } catch (error) {
    if (manifestWritten && existsSync(manifestPath)) unlinkSync(manifestPath);
    if (backupCreated) removeSqliteArtifacts(backupOutputPath);
    throw error;
  } finally {
    if (existsSync(nativeManifestPath)) unlinkSync(nativeManifestPath);
  }
};

const disabledReadiness = (): SqliteAuthorityReadiness => ({
  authorityEnabled: false,
  ready: false,
  cutoverVerified: false,
  backupVerified: false,
  rollbackAvailable: false,
  storageMode: "sqlite-disposable",
  authoritative: false,
  missingRequirements: [],
  requiredCapabilities: [...WRITE_CAPABILITY_KEYS],
  unsupportedOperations: [...SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS],
});

const blockedReadiness = (
  missingRequirements: string[],
  code: string,
  cutoverVerified = false,
  backupVerified = false,
): SqliteAuthorityReadiness => ({
  authorityEnabled: true,
  ready: false,
  cutoverVerified,
  backupVerified,
  rollbackAvailable: backupVerified,
  storageMode: "sqlite-authoritative",
  authoritative: false,
  missingRequirements,
  requiredCapabilities: [...WRITE_CAPABILITY_KEYS],
  unsupportedOperations: [...SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS],
  code,
});

export const evaluateSqliteAuthorityReadiness = (options: {
  authorityEnabled: boolean;
  sqlitePath?: string;
  manifestPath?: string;
  capabilities: WriteCapabilities;
  allowRepoPathsForTests?: boolean;
}): SqliteAuthorityReadiness => {
  if (!options.authorityEnabled) return disabledReadiness();

  const missingConfiguration = [
    !options.sqlitePath ? "sqlite_path" : undefined,
    !options.manifestPath ? "cutover_manifest_path" : undefined,
  ].filter((value): value is string => value !== undefined);
  const missingCapabilities = WRITE_CAPABILITY_KEYS.filter(
    (key) => options.capabilities[key] !== true,
  );
  if (missingConfiguration.length > 0 || missingCapabilities.length > 0) {
    return blockedReadiness(
      [
        ...missingConfiguration,
        ...missingCapabilities.map((key) => `capability:${key}`),
      ],
      missingCapabilities.length > 0
        ? "required_write_capabilities_missing"
        : "sqlite_authority_configuration_missing",
    );
  }

  const sqlitePath = path.resolve(options.sqlitePath!);
  const manifestPath = path.resolve(options.manifestPath!);
  try {
    assertFileExists(sqlitePath, "SQLite authority database");
    assertFileExists(manifestPath, "SQLite cutover manifest");
    assertOutsideRepo(
      sqlitePath,
      options.allowRepoPathsForTests === true,
      "SQLite authority database",
    );
    assertOutsideRepo(
      manifestPath,
      options.allowRepoPathsForTests === true,
      "SQLite cutover manifest",
    );
    const manifest = readSqliteAuthorityManifestDescriptor(manifestPath);
    const asOf = strictSqliteAuthorityLocalDay(manifest.normalizedAsOf);
    const candidate = readSqliteLogicalVerificationAtPath(sqlitePath, asOf);
    if (!logicalVerificationsMatch(candidate, manifest.databaseVerification)) {
      return blockedReadiness(
        ["active_sqlite_manifest_match"],
        "active_sqlite_manifest_mismatch",
      );
    }
    const backupPath = path.resolve(
      path.dirname(manifestPath),
      manifest.backupFileName,
    );
    assertFileExists(backupPath, "SQLite pre-cutover backup");
    assertOutsideRepo(
      backupPath,
      options.allowRepoPathsForTests === true,
      "SQLite pre-cutover backup",
    );
    const backup = readSqliteLogicalVerificationAtPath(backupPath, asOf);
    if (
      !logicalVerificationsMatch(backup, manifest.backupVerification) ||
      backup.schemaVersion !== manifest.backupVerification.schemaVersion
    ) {
      return blockedReadiness(
        ["pre_cutover_backup_manifest_match"],
        "pre_cutover_backup_manifest_mismatch",
        true,
      );
    }
    return {
      authorityEnabled: true,
      ready: true,
      cutoverVerified: true,
      backupVerified: true,
      rollbackAvailable: true,
      storageMode: "sqlite-authoritative",
      authoritative: true,
      missingRequirements: [],
      requiredCapabilities: [...WRITE_CAPABILITY_KEYS],
      unsupportedOperations: [...manifest.unsupportedOperations],
    };
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "sqlite_authority_verification_failed";
    return blockedReadiness(["valid_cutover_state"], code);
  }
};

export const verifySqliteAuthorityRollback = (options: {
  currentSqlitePath: string;
  cutoverManifestPath: string;
  currentBackupPath: string;
  currentBackupManifestPath: string;
  allowRepoPathsForTests?: boolean;
}): SqliteAuthorityRollbackResult => {
  const currentSqlitePath = path.resolve(options.currentSqlitePath);
  assertFileExists(currentSqlitePath, "Current authoritative SQLite database");
  assertOutsideRepo(
    currentSqlitePath,
    options.allowRepoPathsForTests === true,
    "Current authoritative SQLite database",
  );
  const cutoverManifestPath = path.resolve(options.cutoverManifestPath);
  assertFileExists(cutoverManifestPath, "SQLite cutover manifest");
  assertOutsideRepo(
    cutoverManifestPath,
    options.allowRepoPathsForTests === true,
    "SQLite cutover manifest",
  );
  const cutoverManifest = readSqliteAuthorityManifestDescriptor(
    cutoverManifestPath,
  );
  const cutoverBackupPath = path.resolve(
    path.dirname(cutoverManifestPath),
    cutoverManifest.backupFileName,
  );
  assertFileExists(cutoverBackupPath, "SQLite pre-cutover backup");
  assertOutsideRepo(
    cutoverBackupPath,
    options.allowRepoPathsForTests === true,
    "SQLite pre-cutover backup",
  );
  const cutoverAsOf = strictSqliteAuthorityLocalDay(
    cutoverManifest.normalizedAsOf,
  );
  const cutoverBackup = readSqliteLogicalVerificationAtPath(
    cutoverBackupPath,
    cutoverAsOf,
  );
  if (
    !logicalVerificationsMatch(
      cutoverBackup,
      cutoverManifest.backupVerification,
    ) ||
    cutoverBackup.schemaVersion !==
      cutoverManifest.backupVerification.schemaVersion
  ) {
    throw new Error("cutover_baseline_backup_mismatch");
  }

  const currentBackupPath = path.resolve(options.currentBackupPath);
  const currentBackupManifestPath = path.resolve(options.currentBackupManifestPath);
  assertFileExists(currentBackupPath, "Current SQLite rollback backup");
  assertFileExists(currentBackupManifestPath, "Current rollback backup manifest");
  assertOutsideRepo(
    currentBackupPath,
    options.allowRepoPathsForTests === true,
    "Current SQLite rollback backup",
  );
  assertOutsideRepo(
    currentBackupManifestPath,
    options.allowRepoPathsForTests === true,
    "Current rollback backup manifest",
  );
  const nativeManifest = readSqliteBackupManifest(currentBackupManifestPath);
  const asOf = strictSqliteAuthorityLocalDay(nativeManifest.normalizedAsOf);
  const current = readSqliteLogicalVerificationAtPath(currentSqlitePath, asOf);
  const currentBackup = readSqliteLogicalVerificationAtPath(currentBackupPath, asOf);
  if (
    !logicalVerificationsMatch(current, currentBackup) ||
    !logicalVerificationsMatch(currentBackup, nativeManifest.backupVerification) ||
    currentBackup.schemaVersion !== nativeManifest.backupVerification.schemaVersion
  ) {
    throw new Error("current_sqlite_rollback_backup_mismatch");
  }
  return {
    status: "ready",
    cutoverBackupVerified: true,
    currentBackupVerified: true,
    rollbackInstructionsId: SQLITE_AUTHORITY_ROLLBACK_INSTRUCTIONS_ID,
  };
};

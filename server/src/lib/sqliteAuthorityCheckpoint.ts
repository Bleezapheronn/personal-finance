import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readSqliteBudgetHistorySummary } from "../compareBudgetHistory.js";
import {
  assertSqliteAuthoritySchemaContract,
  deriveAuthorityCheckpointId,
  readSqliteAuthorityManifestDescriptor,
  SQLITE_AUTHORITY_CHECKPOINT_MANIFEST_VERSION,
  SQLITE_AUTHORITY_CHECKPOINT_RECOVERY_NOTES_ID,
  strictSqliteAuthorityLocalDay,
  type SqliteAuthorityCheckpointManifest,
  type SqliteAuthorityManifestDescriptor,
} from "./sqliteAuthorityCutover.js";
import {
  createSqliteNativeBackup,
  readSqliteBackupManifest,
  restoreSqliteVerifiedBackup,
} from "./sqliteBackupRestore.js";
import {
  logicalVerificationsMatch,
  readSqliteLogicalVerificationAtPath,
} from "./sqliteLogicalVerification.js";
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
  SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS,
  WRITE_CAPABILITY_KEYS,
} from "./writeCapabilities.js";

export interface SqliteAuthorityCheckpointResult {
  status: "ready";
  checkpointSequence: number;
  checkpointId: string;
  authorityLineageId: string;
  backupFile: string;
  manifestFile: string;
  verifiedTables: number;
}

export interface SqliteAuthorityCheckpointVerificationResult {
  status: "pass";
  checkpointSequence: number;
  checkpointId: string;
  backupVerified: true;
  activeSqliteVerified: boolean;
}

export interface SqliteAuthorityCheckpointChainResult {
  status: "pass";
  authorityLineageId: string;
  checkpointCount: number;
  firstSequence: 0;
  finalSequence: number;
  backupsVerified: number;
  activeSqliteVerified: boolean;
}

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

const labelIsValid = (label: string | undefined): boolean =>
  label === undefined || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label);

const verifyManifestBackup = (
  manifestPath: string,
  descriptor: SqliteAuthorityManifestDescriptor,
  allowRepoPathsForTests: boolean,
): void => {
  const backupPath = path.resolve(
    path.dirname(manifestPath),
    descriptor.backupFileName,
  );
  assertFileExists(backupPath, "SQLite authority checkpoint backup");
  assertOutsideRepo(
    backupPath,
    allowRepoPathsForTests,
    "SQLite authority checkpoint backup",
  );
  const asOf = strictSqliteAuthorityLocalDay(descriptor.normalizedAsOf);
  const backup = readSqliteLogicalVerificationAtPath(backupPath, asOf);
  if (
    !logicalVerificationsMatch(backup, descriptor.backupVerification) ||
    backup.schemaVersion !== descriptor.backupVerification.schemaVersion
  ) {
    throw new Error("authority_checkpoint_backup_mismatch");
  }
};

const assertCurrentStateEligible = (
  sqlitePath: string,
  asOf: Date,
): ReturnType<typeof readSqliteLogicalVerificationAtPath> => {
  const verification = readSqliteLogicalVerificationAtPath(sqlitePath, asOf);
  assertSqliteAuthoritySchemaContract(verification, asOf);
  if (Object.values(verification.integritySummary).some((count) => count !== 0)) {
    throw new Error("authority_checkpoint_integrity_issues");
  }
  const db = openReadOnlyDatabase(sqlitePath);
  try {
    const history = readSqliteBudgetHistorySummary(db, asOf);
    if (
      history.issues.missingLiveBudget !== 0 ||
      history.issues.duplicateOccurrenceCandidates !== 0
    ) {
      throw new Error("authority_checkpoint_conflict_state");
    }
  } finally {
    db.close();
  }
  return verification;
};

export const createSqliteAuthorityCheckpoint = async (options: {
  sqlitePath: string;
  currentManifestPath: string;
  backupOutputPath: string;
  manifestOutputPath: string;
  label?: string;
  asOf?: Date;
  createdAt?: Date;
  allowRepoOutputForTests?: boolean;
}): Promise<SqliteAuthorityCheckpointResult> => {
  const sqlitePath = path.resolve(options.sqlitePath);
  const currentManifestPath = path.resolve(options.currentManifestPath);
  const backupOutputPath = path.resolve(options.backupOutputPath);
  const manifestOutputPath = path.resolve(options.manifestOutputPath);
  const nativeManifestPath = `${manifestOutputPath}.native-backup.tmp.json`;
  const allowRepoOutputForTests = options.allowRepoOutputForTests === true;

  if (!labelIsValid(options.label)) {
    throw new Error("authority_checkpoint_label_invalid");
  }
  assertFileExists(sqlitePath, "Current authoritative SQLite database");
  assertFileExists(currentManifestPath, "Current authority manifest");
  assertPathDoesNotExist(backupOutputPath, "SQLite checkpoint backup output");
  assertPathDoesNotExist(manifestOutputPath, "Authority checkpoint manifest output");
  assertPathDoesNotExist(nativeManifestPath, "Temporary native backup manifest");
  for (const [filePath, label] of [
    [sqlitePath, "Current authoritative SQLite database"],
    [currentManifestPath, "Current authority manifest"],
    [backupOutputPath, "SQLite checkpoint backup output"],
    [manifestOutputPath, "Authority checkpoint manifest output"],
    [nativeManifestPath, "Temporary native backup manifest"],
  ] as const) {
    assertOutsideRepo(filePath, allowRepoOutputForTests, label);
  }
  assertDistinctPaths([
    { path: sqlitePath, label: "Current authoritative SQLite database" },
    { path: currentManifestPath, label: "Current authority manifest" },
    { path: backupOutputPath, label: "SQLite checkpoint backup output" },
    { path: manifestOutputPath, label: "Authority checkpoint manifest output" },
    { path: nativeManifestPath, label: "Temporary native backup manifest" },
  ]);
  if (
    !pathsReferToSameLocation(
      path.dirname(backupOutputPath),
      path.dirname(manifestOutputPath),
    )
  ) {
    throw new Error(
      "SQLite checkpoint backup and authority manifest must share a directory.",
    );
  }

  const predecessor = readSqliteAuthorityManifestDescriptor(currentManifestPath);
  verifyManifestBackup(
    currentManifestPath,
    predecessor,
    allowRepoOutputForTests,
  );
  const createdAt = options.createdAt ?? new Date();
  if (createdAt.getTime() < new Date(predecessor.createdAt).getTime()) {
    throw new Error("authority_checkpoint_timestamp_invalid");
  }
  const asOf = options.asOf ?? createdAt;
  const sourceBefore = assertCurrentStateEligible(sqlitePath, asOf);
  const currentManifestBefore = readFileSync(currentManifestPath);
  let backupCreated = false;
  let manifestWritten = false;

  try {
    await createSqliteNativeBackup({
      sourcePath: sqlitePath,
      outputPath: backupOutputPath,
      manifestPath: nativeManifestPath,
      asOf,
      allowRepoOutputForTests,
    });
    backupCreated = true;
    const nativeManifest = readSqliteBackupManifest(nativeManifestPath);
    const sourceAfter = assertCurrentStateEligible(sqlitePath, asOf);
    if (
      !logicalVerificationsMatch(sourceBefore, sourceAfter) ||
      sourceBefore.schemaVersion !== sourceAfter.schemaVersion ||
      !logicalVerificationsMatch(
        sourceBefore,
        nativeManifest.backupVerification,
      )
    ) {
      throw new Error("authority_checkpoint_source_changed");
    }
    if (!readFileSync(currentManifestPath).equals(currentManifestBefore)) {
      throw new Error("authority_checkpoint_predecessor_changed");
    }

    const checkpointWithoutId: Omit<
      SqliteAuthorityCheckpointManifest,
      "checkpointId"
    > = {
      manifestVersion: SQLITE_AUTHORITY_CHECKPOINT_MANIFEST_VERSION,
      manifestKind: "sqlite-authority-checkpoint",
      authorityLineageId: predecessor.authorityLineageId,
      checkpointSequence: predecessor.checkpointSequence + 1,
      predecessorCheckpointId: predecessor.checkpointId,
      createdAt: createdAt.toISOString(),
      normalizedAsOf: sourceBefore.normalizedAsOf,
      databaseIdentityFingerprint: sourceBefore.databaseIdentityFingerprint,
      backupDatabaseIdentityFingerprint:
        nativeManifest.backupVerification.databaseIdentityFingerprint,
      databaseVerification: sourceBefore,
      backupVerification: nativeManifest.backupVerification,
      backupFileName: basename(backupOutputPath),
      userVersion: sourceBefore.userVersion,
      schemaVersion: sourceBefore.schemaVersion,
      requiredCapabilities: [...WRITE_CAPABILITY_KEYS],
      unsupportedOperations: [...SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS],
      nativeBackupVerified: true,
      backupVerificationResult: "pass",
      checkpointStatus: "ready",
      recoveryNotesId: SQLITE_AUTHORITY_CHECKPOINT_RECOVERY_NOTES_ID,
      ...(options.label ? { label: options.label } : {}),
    };
    const manifest: SqliteAuthorityCheckpointManifest = {
      ...checkpointWithoutId,
      checkpointId: deriveAuthorityCheckpointId(checkpointWithoutId),
    };
    mkdirSync(path.dirname(manifestOutputPath), { recursive: true });
    writeFileSync(manifestOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    manifestWritten = true;
    readSqliteAuthorityManifestDescriptor(manifestOutputPath);
    return {
      status: "ready",
      checkpointSequence: manifest.checkpointSequence,
      checkpointId: manifest.checkpointId,
      authorityLineageId: manifest.authorityLineageId,
      backupFile: basename(backupOutputPath),
      manifestFile: basename(manifestOutputPath),
      verifiedTables: sourceBefore.tableNames.length,
    };
  } catch (error) {
    if (manifestWritten && existsSync(manifestOutputPath)) {
      unlinkSync(manifestOutputPath);
    }
    if (backupCreated) removeSqliteArtifacts(backupOutputPath);
    throw error;
  } finally {
    if (existsSync(nativeManifestPath)) unlinkSync(nativeManifestPath);
  }
};

export const verifySqliteAuthorityCheckpoint = (options: {
  manifestPath: string;
  sqlitePath?: string;
  allowRepoPathsForTests?: boolean;
}): SqliteAuthorityCheckpointVerificationResult => {
  const manifestPath = path.resolve(options.manifestPath);
  const allowRepoPathsForTests = options.allowRepoPathsForTests === true;
  assertFileExists(manifestPath, "SQLite authority manifest");
  assertOutsideRepo(
    manifestPath,
    allowRepoPathsForTests,
    "SQLite authority manifest",
  );
  const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
  verifyManifestBackup(manifestPath, descriptor, allowRepoPathsForTests);
  let activeSqliteVerified = false;
  if (options.sqlitePath) {
    const sqlitePath = path.resolve(options.sqlitePath);
    assertFileExists(sqlitePath, "Active authoritative SQLite database");
    assertOutsideRepo(
      sqlitePath,
      allowRepoPathsForTests,
      "Active authoritative SQLite database",
    );
    const active = readSqliteLogicalVerificationAtPath(
      sqlitePath,
      strictSqliteAuthorityLocalDay(descriptor.normalizedAsOf),
    );
    if (!logicalVerificationsMatch(active, descriptor.databaseVerification)) {
      throw new Error("authority_checkpoint_active_sqlite_mismatch");
    }
    activeSqliteVerified = true;
  }
  return {
    status: "pass",
    checkpointSequence: descriptor.checkpointSequence,
    checkpointId: descriptor.checkpointId,
    backupVerified: true,
    activeSqliteVerified,
  };
};

export const restoreSqliteAuthorityCheckpointBackup = async (options: {
  backupPath: string;
  outputPath: string;
  manifestPath: string;
  allowRepoOutputForTests?: boolean;
}) => {
  const manifestPath = path.resolve(options.manifestPath);
  const backupPath = path.resolve(options.backupPath);
  const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
  const referencedBackupPath = path.resolve(
    path.dirname(manifestPath),
    descriptor.backupFileName,
  );
  if (!pathsReferToSameLocation(backupPath, referencedBackupPath)) {
    throw new Error("authority_checkpoint_backup_path_mismatch");
  }
  return restoreSqliteVerifiedBackup({
    backupPath,
    outputPath: options.outputPath,
    manifestPath,
    expectedVerification: descriptor.backupVerification,
    allowRepoOutputForTests: options.allowRepoOutputForTests,
  });
};

export const verifySqliteAuthorityCheckpointChain = (options: {
  manifestPaths: string[];
  sqlitePath?: string;
  allowRepoPathsForTests?: boolean;
}): SqliteAuthorityCheckpointChainResult => {
  if (options.manifestPaths.length === 0) {
    throw new Error("authority_checkpoint_chain_empty");
  }
  const allowRepoPathsForTests = options.allowRepoPathsForTests === true;
  const descriptors = options.manifestPaths.map((manifestInput) => {
    const manifestPath = path.resolve(manifestInput);
    assertFileExists(manifestPath, "SQLite authority chain manifest");
    assertOutsideRepo(
      manifestPath,
      allowRepoPathsForTests,
      "SQLite authority chain manifest",
    );
    const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
    verifyManifestBackup(manifestPath, descriptor, allowRepoPathsForTests);
    return descriptor;
  });
  if (descriptors[0].checkpointSequence !== 0) {
    throw new Error("authority_checkpoint_chain_must_start_at_zero");
  }
  const lineageId = descriptors[0].authorityLineageId;
  const checkpointIds = new Set<string>();
  for (const [index, descriptor] of descriptors.entries()) {
    if (descriptor.authorityLineageId !== lineageId) {
      throw new Error("authority_checkpoint_lineage_mismatch");
    }
    if (checkpointIds.has(descriptor.checkpointId)) {
      throw new Error("authority_checkpoint_id_repeated");
    }
    checkpointIds.add(descriptor.checkpointId);
    if (descriptor.checkpointSequence !== index) {
      throw new Error("authority_checkpoint_sequence_invalid");
    }
    if (index > 0) {
      const predecessor = descriptors[index - 1];
      if (descriptor.predecessorCheckpointId !== predecessor.checkpointId) {
        throw new Error("authority_checkpoint_predecessor_mismatch");
      }
      if (
        new Date(descriptor.createdAt).getTime() <
        new Date(predecessor.createdAt).getTime()
      ) {
        throw new Error("authority_checkpoint_timestamp_regression");
      }
    }
  }

  let activeSqliteVerified = false;
  if (options.sqlitePath) {
    const sqlitePath = path.resolve(options.sqlitePath);
    assertFileExists(sqlitePath, "Active authoritative SQLite database");
    assertOutsideRepo(
      sqlitePath,
      allowRepoPathsForTests,
      "Active authoritative SQLite database",
    );
    const finalDescriptor = descriptors[descriptors.length - 1];
    const active = readSqliteLogicalVerificationAtPath(
      sqlitePath,
      strictSqliteAuthorityLocalDay(finalDescriptor.normalizedAsOf),
    );
    if (!logicalVerificationsMatch(active, finalDescriptor.databaseVerification)) {
      throw new Error("authority_checkpoint_chain_active_sqlite_mismatch");
    }
    activeSqliteVerified = true;
  }
  return {
    status: "pass",
    authorityLineageId: lineageId,
    checkpointCount: descriptors.length,
    firstSequence: 0,
    finalSequence: descriptors[descriptors.length - 1].checkpointSequence,
    backupsVerified: descriptors.length,
    activeSqliteVerified,
  };
};

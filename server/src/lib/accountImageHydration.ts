import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  FULL_BACKUP_TABLE_NAMES,
  isPlainObject,
  type BackupRecord,
  type FullBackupTableName,
} from "./backup.js";
import {
  AccountImageDecodeError,
  decodeBackupAccountImage,
  type DecodedAccountImage,
} from "./accountImageBackup.js";
import {
  fingerprintLogicalValue,
  readSqliteLogicalVerification,
} from "./sqliteLogicalVerification.js";

interface AccountImageCandidate extends DecodedAccountImage {
  id: number;
}

export interface AccountImageHydrationSummary {
  ok: boolean;
  dryRun: boolean;
  resultCode: string;
  backupAccountsInspected: number;
  imagesFound: number;
  targetAccountsMatched: number;
  imagesEligible: number;
  unchangedImages: number;
  missingTargetAccounts: number;
  validationFailures: number;
  rowsWouldChange: number;
  rowsChanged: number;
  invariantsVerified: boolean;
}

const sha256 = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const loadBackupAccounts = (backupPath: string): BackupRecord[] => {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;
  if (
    !isPlainObject(parsed) ||
    parsed.backupFormatVersion !== 1 ||
    parsed.appName !== "personal-finance" ||
    !isPlainObject(parsed.tables) ||
    !Array.isArray(parsed.tables.accounts)
  ) {
    throw new Error("full_backup_invalid");
  }

  return parsed.tables.accounts.map((record) => {
    if (!isPlainObject(record)) {
      throw new Error("backup_account_record_invalid");
    }
    return record;
  });
};

const accountId = (record: BackupRecord): number => {
  if (
    typeof record.id !== "number" ||
    !Number.isInteger(record.id) ||
    record.id <= 0
  ) {
    throw new Error("backup_account_id_invalid");
  }
  return record.id;
};

const nonImageAccountFingerprint = (db: Database.Database): string =>
  fingerprintLogicalValue(
    db
      .prepare(
        `SELECT id, name, description, currency, isActive, isCredit, creditLimit,
          createdAt, updatedAt FROM accounts ORDER BY id ASC`,
      )
      .all(),
  );

const imageRowsFingerprint = (db: Database.Database): string =>
  fingerprintLogicalValue(
    (
      db
        .prepare(
          `SELECT id, imageBlob, imageMimeType FROM accounts ORDER BY id ASC`,
        )
        .all() as Array<{
        id: number;
        imageBlob: Buffer | null;
        imageMimeType: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      imageMimeType: row.imageMimeType,
      imageBytes:
        row.imageBlob === null
          ? null
          : { length: row.imageBlob.length, sha256: sha256(row.imageBlob) },
    })),
  );

const assertOnlyAccountImagesChanged = (
  before: ReturnType<typeof readSqliteLogicalVerification>,
  after: ReturnType<typeof readSqliteLogicalVerification>,
  nonImageAccountsBefore: string,
  nonImageAccountsAfter: string,
): void => {
  if (
    fingerprintLogicalValue(before.rowCounts) !==
      fingerprintLogicalValue(after.rowCounts) ||
    before.financialAggregateFingerprint !== after.financialAggregateFingerprint ||
    before.reportTotalsFingerprint !== after.reportTotalsFingerprint ||
    before.budgetHistoryFingerprint !== after.budgetHistoryFingerprint ||
    before.transactionLinkageFingerprint !== after.transactionLinkageFingerprint ||
    fingerprintLogicalValue(before.integritySummary) !==
      fingerprintLogicalValue(after.integritySummary) ||
    nonImageAccountsBefore !== nonImageAccountsAfter
  ) {
    throw new Error("account_image_hydration_invariant_failed");
  }

  for (const table of FULL_BACKUP_TABLE_NAMES) {
    if (
      table !== "accounts" &&
      before.tableContentFingerprints[table] !==
        after.tableContentFingerprints[table]
    ) {
      throw new Error("account_image_hydration_unrelated_table_changed");
    }
  }
};

export const hydrateAccountImages = (
  db: Database.Database,
  backupPath: string,
  apply: boolean,
): AccountImageHydrationSummary => {
  const accounts = loadBackupAccounts(backupPath);
  const candidates: AccountImageCandidate[] = [];
  let imagesFound = 0;
  let validationFailures = 0;

  for (const record of accounts) {
    if (record.imageBlob === undefined || record.imageBlob === null) continue;
    imagesFound += 1;
    try {
      const image = decodeBackupAccountImage(record);
      if (image) candidates.push({ id: accountId(record), ...image });
    } catch (error) {
      if (
        error instanceof AccountImageDecodeError ||
        error instanceof Error
      ) {
        validationFailures += 1;
        continue;
      }
      throw error;
    }
  }

  const readTarget = db.prepare(
    `SELECT imageBlob, imageMimeType FROM accounts WHERE id = ?`,
  );
  const eligible: AccountImageCandidate[] = [];
  let targetAccountsMatched = 0;
  let unchangedImages = 0;
  let missingTargetAccounts = 0;

  for (const candidate of candidates) {
    const current = readTarget.get(candidate.id) as
      | { imageBlob: Buffer | null; imageMimeType: string | null }
      | undefined;
    if (!current) {
      missingTargetAccounts += 1;
      continue;
    }
    targetAccountsMatched += 1;
    if (
      current.imageMimeType?.toLowerCase() === candidate.mimeType &&
      current.imageBlob?.equals(candidate.bytes)
    ) {
      unchangedImages += 1;
      continue;
    }
    eligible.push(candidate);
  }

  const summary: AccountImageHydrationSummary = {
    ok: validationFailures === 0,
    dryRun: !apply,
    resultCode:
      validationFailures > 0
        ? "account_image_validation_failed"
        : apply
          ? "account_images_hydrated"
          : "account_image_hydration_dry_run",
    backupAccountsInspected: accounts.length,
    imagesFound,
    targetAccountsMatched,
    imagesEligible: eligible.length,
    unchangedImages,
    missingTargetAccounts,
    validationFailures,
    rowsWouldChange: eligible.length,
    rowsChanged: 0,
    invariantsVerified: false,
  };

  if (validationFailures > 0 || !apply) {
    return summary;
  }

  const before = readSqliteLogicalVerification(db);
  const nonImageAccountsBefore = nonImageAccountFingerprint(db);
  const imageRowsBefore = imageRowsFingerprint(db);
  const writeImage = db.prepare(
    `UPDATE accounts SET imageBlob = @imageBlob, imageMimeType = @imageMimeType
     WHERE id = @id`,
  );
  const applyImages = db.transaction(() => {
    let changed = 0;
    for (const candidate of eligible) {
      const result = writeImage.run({
        id: candidate.id,
        imageBlob: candidate.bytes,
        imageMimeType: candidate.mimeType,
      });
      if (result.changes !== 1) {
        throw new Error("account_image_hydration_update_failed");
      }
      changed += result.changes;
    }
    return changed;
  });

  const changed = applyImages();
  const after = readSqliteLogicalVerification(db);
  assertOnlyAccountImagesChanged(
    before,
    after,
    nonImageAccountsBefore,
    nonImageAccountFingerprint(db),
  );
  if (changed > 0 && imageRowsBefore === imageRowsFingerprint(db)) {
    throw new Error("account_image_hydration_no_effect");
  }

  return {
    ...summary,
    rowsChanged: changed,
    invariantsVerified: true,
  };
};

export const accountImageUnrelatedTableNames =
  FULL_BACKUP_TABLE_NAMES.filter(
    (table): table is Exclude<FullBackupTableName, "accounts"> =>
      table !== "accounts",
  );

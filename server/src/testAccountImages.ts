import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountImageDecodeError,
  decodeBackupAccountImage,
} from "./lib/accountImageBackup.js";
import { hydrateAccountImages } from "./lib/accountImageHydration.js";

const expect = (condition: unknown, code: string): void => {
  if (!condition) throw new Error(code);
};

const imageBytes = Buffer.from("account-image-test");
const imageRecord = {
  id: 1,
  imageBlob: {
    __type: "Blob",
    mimeType: "image/png",
    size: imageBytes.length,
    base64: imageBytes.toString("base64"),
  },
};

const testDecoder = (): void => {
  const decoded = decodeBackupAccountImage(imageRecord);
  expect(decoded?.mimeType === "image/png", "decoder_mime_mismatch");
  expect(decoded?.bytes.equals(imageBytes), "decoder_bytes_mismatch");

  try {
    decodeBackupAccountImage({
      ...imageRecord,
      imageBlob: { ...imageRecord.imageBlob, size: imageBytes.length + 1 },
    });
    throw new Error("decoder_size_validation_missing");
  } catch (error) {
    expect(
      error instanceof AccountImageDecodeError &&
        error.code === "account_image_size_mismatch",
      "decoder_size_error_mismatch",
    );
  }
};

const createFixtureDatabase = (databasePath: string): Database.Database => {
  const db = new Database(databasePath);
  const schemaPath = path.resolve("schema", "prototype-schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
  db.prepare(
    `INSERT INTO accounts (
      id, name, description, currency, imageBlob, imageMimeType, isActive,
      isCredit, creditLimit, createdAt, updatedAt
    ) VALUES (
      1, 'Fixture', NULL, 'KES', NULL, NULL, 1, 0, NULL,
      '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z'
    )`,
  ).run();
  return db;
};

const writeBackup = (
  backupPath: string,
  accounts: Record<string, unknown>[],
): void => {
  writeFileSync(
    backupPath,
    JSON.stringify({
      backupFormatVersion: 1,
      appName: "personal-finance",
      tables: { accounts },
    }),
    "utf8",
  );
};

const testHydration = (): void => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pf-account-images-"));
  const databasePath = path.join(tempRoot, "fixture.sqlite");
  const backupPath = path.join(tempRoot, "backup.json");
  const malformedBackupPath = path.join(tempRoot, "malformed.json");
  const db = createFixtureDatabase(databasePath);

  try {
    writeBackup(backupPath, [imageRecord, { ...imageRecord, id: 999 }]);
    const dryRun = hydrateAccountImages(db, backupPath, false);
    expect(dryRun.ok, "hydration_dry_run_failed");
    expect(dryRun.rowsWouldChange === 1, "hydration_dry_run_change_count");
    expect(dryRun.missingTargetAccounts === 1, "hydration_missing_account_count");
    const before = db
      .prepare("SELECT imageBlob FROM accounts WHERE id = 1")
      .get() as { imageBlob: Buffer | null };
    expect(before.imageBlob === null, "hydration_dry_run_mutated");

    const applied = hydrateAccountImages(db, backupPath, true);
    expect(applied.ok, "hydration_apply_failed");
    expect(applied.rowsChanged === 1, "hydration_apply_change_count");
    expect(applied.invariantsVerified, "hydration_invariants_not_verified");
    const after = db
      .prepare(
        `SELECT imageBlob, imageMimeType, name, updatedAt
         FROM accounts WHERE id = 1`,
      )
      .get() as {
      imageBlob: Buffer;
      imageMimeType: string;
      name: string;
      updatedAt: string;
    };
    expect(after.imageBlob.equals(imageBytes), "hydration_image_bytes_mismatch");
    expect(after.imageMimeType === "image/png", "hydration_image_mime_mismatch");
    expect(after.name === "Fixture", "hydration_non_image_field_changed");
    expect(
      after.updatedAt === "2026-07-23T00:00:00.000Z",
      "hydration_timestamp_changed",
    );

    writeBackup(malformedBackupPath, [
      {
        ...imageRecord,
        imageBlob: { ...imageRecord.imageBlob, base64: "not base64" },
      },
    ]);
    const malformed = hydrateAccountImages(db, malformedBackupPath, true);
    expect(!malformed.ok, "malformed_hydration_should_fail");
    expect(malformed.rowsChanged === 0, "malformed_hydration_mutated");
  } finally {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
};

testDecoder();
testHydration();
console.log("Account image tests: PASS");

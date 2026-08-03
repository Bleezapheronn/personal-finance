import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS,
  accountImageMutationDryRun,
  accountImageMutationWrite,
  AccountImageMutationRequestError,
} from "./lib/accountImageMutation.js";

const expect = (condition: unknown, code: string): void => {
  if (!condition) throw new Error(code);
};

const blob = (bytes: Buffer, mimeType = "image/png") => ({
  __type: "Blob",
  mimeType,
  size: bytes.length,
  base64: bytes.toString("base64"),
});

const planFingerprint = (response: { planFingerprint?: unknown }): string => {
  if (typeof response.planFingerprint !== "string") {
    throw new Error("account_image_plan_missing");
  }
  return response.planFingerprint;
};

const fixture = (): { root: string; db: Database.Database } => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-account-image-mutation-"));
  const db = new Database(path.join(root, "fixture.sqlite"));
  db.exec(readFileSync(path.resolve("schema", "prototype-schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO accounts (
      id, name, description, currency, imageBlob, imageMimeType, isActive,
      isCredit, creditLimit, createdAt, updatedAt
    ) VALUES (1, 'Image Fixture', 'unchanged', 'KES', NULL, NULL, 1, 0, NULL, ?, ?)`,
  ).run("2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  return { root, db };
};

const testSetReplaceAndRemove = (): void => {
  const { root, db } = fixture();
  const first = Buffer.from("first-account-image");
  const replacement = Buffer.from("replacement-account-image");
  try {
    const setPayload = { accountId: 1, imageBlob: blob(first) };
    const dry = accountImageMutationDryRun(db, setPayload, "set");
    expect(dry.ok && dry.wouldMutate && dry.sqliteMutated === false, "image_set_dry_run_invalid");
    expect(!JSON.stringify(dry).includes(first.toString("base64")), "image_set_dry_run_leaked_bytes");
    const before = db.prepare("SELECT * FROM accounts WHERE id = 1").get() as Record<string, unknown>;
    const set = accountImageMutationWrite(db, {
      ...setPayload,
      dryRunReviewed: true,
      confirmation: ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS.set,
      expectedPlanFingerprint: planFingerprint(dry),
    }, "set");
    expect(set.ok && set.sqliteMutated && set.rowsChanged === 1, "image_set_write_failed");
    const afterSet = db.prepare("SELECT * FROM accounts WHERE id = 1").get() as Record<string, unknown>;
    expect(Buffer.isBuffer(afterSet.imageBlob) && afterSet.imageBlob.equals(first), "image_set_bytes_missing");
    expect(afterSet.imageMimeType === "image/png", "image_set_mime_missing");
    expect(afterSet.name === before.name && afterSet.description === before.description && afterSet.currency === before.currency && afterSet.isActive === before.isActive && afterSet.isCredit === before.isCredit && afterSet.creditLimit === before.creditLimit && afterSet.createdAt === before.createdAt, "image_set_changed_non_image_fields");
    expect(afterSet.updatedAt !== before.updatedAt, "image_set_timestamp_not_updated");

    const replacementPayload = { accountId: 1, imageBlob: blob(replacement, "image/jpeg") };
    const replacementDry = accountImageMutationDryRun(db, replacementPayload, "set");
    const replacementWrite = accountImageMutationWrite(db, {
      ...replacementPayload,
      dryRunReviewed: true,
      confirmation: ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS.set,
      expectedPlanFingerprint: planFingerprint(replacementDry),
    }, "set");
    expect(replacementWrite.ok, "image_replace_write_failed");
    const afterReplace = db.prepare("SELECT imageBlob, imageMimeType FROM accounts WHERE id = 1").get() as { imageBlob: Buffer; imageMimeType: string };
    expect(afterReplace.imageBlob.equals(replacement) && afterReplace.imageMimeType === "image/jpeg", "image_replace_not_persisted");

    const removeDry = accountImageMutationDryRun(db, { accountId: 1 }, "remove");
    const stale = accountImageMutationWrite(db, {
      accountId: 1,
      dryRunReviewed: true,
      confirmation: ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS.remove,
      expectedPlanFingerprint: "0".repeat(64),
    }, "remove");
    expect(!stale.ok && stale.code === "account_image_plan_stale" && stale.sqliteMutated === false, "image_remove_stale_not_refused");
    const removed = accountImageMutationWrite(db, {
      accountId: 1,
      dryRunReviewed: true,
      confirmation: ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS.remove,
      expectedPlanFingerprint: planFingerprint(removeDry),
    }, "remove");
    expect(removed.ok && removed.rowsChanged === 1, "image_remove_write_failed");
    const afterRemove = db.prepare("SELECT imageBlob, imageMimeType FROM accounts WHERE id = 1").get() as { imageBlob: Buffer | null; imageMimeType: string | null };
    expect(afterRemove.imageBlob === null && afterRemove.imageMimeType === null, "image_remove_not_persisted");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
};

const testValidation = (): void => {
  const { root, db } = fixture();
  try {
    const emptyPayload = { accountId: 1, imageBlob: blob(Buffer.alloc(0)) };
    try {
      accountImageMutationDryRun(db, emptyPayload, "set");
      throw new Error("image_empty_dry_run_accepted");
    } catch (error) {
      expect(error instanceof AccountImageMutationRequestError && error.code === "account_image_empty", "image_empty_dry_run_error_invalid");
    }
    try {
      accountImageMutationWrite(db, {
        ...emptyPayload,
        dryRunReviewed: true,
        confirmation: ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS.set,
        expectedPlanFingerprint: "0".repeat(64),
      }, "set");
      throw new Error("image_empty_write_accepted");
    } catch (error) {
      expect(error instanceof AccountImageMutationRequestError && error.code === "account_image_empty", "image_empty_write_error_invalid");
    }
    const afterEmptyWrite = db.prepare("SELECT imageBlob, imageMimeType FROM accounts WHERE id = 1").get() as {
      imageBlob: Buffer | null;
      imageMimeType: string | null;
    };
    expect(afterEmptyWrite.imageBlob === null && afterEmptyWrite.imageMimeType === null, "image_empty_persisted");

    try {
      accountImageMutationDryRun(db, { accountId: 1, imageBlob: blob(Buffer.from("x"), "image/svg+xml") }, "set");
      throw new Error("image_invalid_mime_accepted");
    } catch (error) {
      expect(error instanceof AccountImageMutationRequestError && error.code === "account_image_mime_unsupported", "image_invalid_mime_error_invalid");
    }
    const missing = accountImageMutationDryRun(db, { accountId: 99 }, "remove");
    expect(!missing.ok && missing.code === "account_not_found" && missing.sqliteMutated === false, "image_missing_account_not_safe");
    const absent = accountImageMutationDryRun(db, { accountId: 1 }, "remove");
    expect(!absent.ok && absent.code === "account_image_not_found" && absent.sqliteMutated === false, "image_absent_remove_not_safe");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
};

testSetReplaceAndRemove();
testValidation();
console.log("Account image mutation tests: PASS");

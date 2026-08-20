import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  RECIPIENT_CREATE_WRITE_CONFIRMATION,
  RECIPIENT_UPDATE_WRITE_CONFIRMATION,
  createRecipientRealWrite,
  updateRecipientRealWrite,
} from "./lib/recipientWrite.js";
import {
  createRecipientDryRun,
  updateRecipientDryRun,
} from "./lib/recipientDryRun.js";
import { serverRoot } from "./lib/paths.js";

const timestamp = "2026-08-20T00:00:00.000Z";
const checks: Array<{ name: string; ok: boolean }> = [];
const check = (name: string, ok: boolean) => checks.push({ name, ok });

const createDb = () => {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"),
  );
  return db;
};

const createPayload = (name: string, aliases?: string) => ({
  name,
  aliases,
  dryRunReviewed: true as const,
  confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
});

const db = createDb();
const createDryRun = createRecipientDryRun(db, {
  name: "  EVANS\t  ONG'ENI  ",
  aliases: "Primary;  Alias",
});
const created = createRecipientRealWrite(
  db,
  createPayload("  EVANS\t  ONG'ENI  ", "Primary;  Alias"),
);
const createdRow = db
  .prepare("SELECT * FROM recipients WHERE id = @id")
  .get({ id: created.targetId }) as Record<string, unknown>;
check(
  "create dry-run and write canonicalize only the Recipient name",
  createDryRun.ok &&
    created.ok &&
    createdRow.name === "EVANS ONG'ENI" &&
    createdRow.aliases === "Primary;  Alias",
);

const duplicateDryRun = createRecipientDryRun(db, {
  name: "evans   ong'eni",
});
check(
  "canonical-equivalent create is detected as a duplicate",
  !duplicateDryRun.ok &&
    duplicateDryRun.duplicateSummary.duplicateNameCandidates === 1 &&
    duplicateDryRun.validationErrors.includes("duplicate_candidate_detected"),
);

const updateTargetId = Number(created.targetId);
db.prepare(
  `INSERT INTO transactions
    (id, categoryId, accountId, recipientId, date, amount, transactionCost,
     description, isTransfer)
   VALUES (1, 1, 1, @recipientId, @timestamp, -10, 0, 'fixture', 0)`,
).run({ recipientId: updateTargetId, timestamp });
db.prepare("UPDATE recipients SET email = @email WHERE id = @id").run({
  id: updateTargetId,
  email: "fixture@example.com",
});
const beforeUpdate = db
  .prepare("SELECT * FROM recipients WHERE id = @id")
  .get({ id: updateTargetId }) as Record<string, unknown>;
const updateInput = {
  id: updateTargetId,
  name: "  Mary-Jane\n O'Neil, Jr. ",
  aliases: String(beforeUpdate.aliases),
  email: String(beforeUpdate.email),
};
const updateDryRun = updateRecipientDryRun(db, updateInput);
const updated = updateRecipientRealWrite(db, {
  ...updateInput,
  dryRunReviewed: true,
  confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
});
const updatedRow = db
  .prepare("SELECT * FROM recipients WHERE id = @id")
  .get({ id: updateTargetId }) as Record<string, unknown>;
check(
  "update canonicalizes whitespace while preserving boundaries and punctuation",
  updateDryRun.ok &&
    updated.ok &&
    updatedRow.name === "Mary-Jane O'Neil, Jr." &&
    updatedRow.aliases === beforeUpdate.aliases &&
    updatedRow.email === beforeUpdate.email &&
    updatedRow.createdAt === beforeUpdate.createdAt &&
    updatedRow.isActive === beforeUpdate.isActive &&
    (
      db.prepare("SELECT recipientId FROM transactions WHERE id = 1").get() as {
        recipientId: number;
      }
    ).recipientId === updateTargetId,
);

const aliasDb = createDb();
createRecipientRealWrite(
  aliasDb,
  createPayload("First Recipient", "EVANS ONG'ENI"),
);
const aliasCollision = createRecipientDryRun(aliasDb, {
  name: "Second Recipient",
  aliases: "EVANS\t  ONG'ENI",
});
check(
  "alias collision matching uses canonical whitespace semantics",
  !aliasCollision.ok &&
    aliasCollision.duplicateSummary.aliasCollisions === 1 &&
    aliasCollision.validationErrors.includes("alias_collision_detected"),
);

db.close();
aliasDb.close();

const failed = checks.filter((candidate) => !candidate.ok);
if (failed.length > 0) {
  throw new Error(
    `Recipient name normalization checks failed: ${failed
      .map((candidate) => candidate.name)
      .join(", ")}`,
  );
}

console.log(`Recipient name normalization checks: PASS (${checks.length})`);

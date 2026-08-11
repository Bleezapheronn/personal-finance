import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  BUDGET_SNAPSHOT_OCCURRENCE_BATCH_CONFIRMATION,
  budgetSnapshotOccurrenceBatchDryRun,
  budgetSnapshotOccurrenceBatchWrite,
} from "./lib/budgetSnapshotOccurrenceBatch.js";

const db = new Database(":memory:");
db.exec(readFileSync(new URL("../schema/prototype-schema.sql", import.meta.url), "utf8"));
const now = "2026-08-10T00:00:00.000Z";
db.exec(`INSERT INTO buckets (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt) VALUES (1,'x',0,100,1,1,0,'${now}','${now}');
INSERT INTO categories (id,name,bucketId,isActive,createdAt,updatedAt) VALUES (1,'x',1,1,'${now}','${now}');
INSERT INTO accounts (id,name,isActive,isCredit,createdAt,updatedAt) VALUES (1,'x',1,0,'${now}','${now}');
INSERT INTO recipients (id,name,isActive,createdAt,updatedAt) VALUES (1,'x',1,'${now}','${now}');
INSERT INTO budgets (id,description,categoryId,accountId,recipientId,amount,frequency,isGoal,isFlexible,isActive,dueDate,createdAt,updatedAt) VALUES (1,'Inactive',1,1,1,-10,'once',0,0,0,'2026-08-01','${now}','${now}');`);
const insert = db.prepare(`INSERT INTO budgetSnapshots (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,recipientId,amount,frequency,isGoal,isFlexible,isActive,isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt)
VALUES (@id,1,@date,@date,1,'Occurrence',1,1,1,-10,'once',0,0,1,1,@now,@now,@now)`);
insert.run({ id: 1, date: "2026-08-01", now });
insert.run({ id: 2, date: "2026-08-02", now });
insert.run({ id: 3, date: "2026-08-03", now });
db.prepare("INSERT INTO transactions (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetSnapshotId) VALUES (1,1,1,1,@now,-10,0,3)").run({ now });

const blocked = budgetSnapshotOccurrenceBatchDryRun(db, { action: "delete", budgetId: 1, snapshotIds: [1, 3] });
assert.equal(blocked.ok, false);
assert.ok(blocked.validationErrors.includes("snapshot_linked"));
assert.equal((db.prepare("SELECT COUNT(*) count FROM budgetSnapshots").get() as { count: number }).count, 3);

const review = budgetSnapshotOccurrenceBatchDryRun(db, { action: "delete", budgetId: 1, snapshotIds: [1, 2] });
assert.equal(review.ok, true);
db.prepare("UPDATE budgetSnapshots SET isActive = 0 WHERE id = 1").run();
const stale = budgetSnapshotOccurrenceBatchWrite(db, { action: "delete", budgetId: 1, snapshotIds: [1, 2], dryRunReviewed: true, confirmation: BUDGET_SNAPSHOT_OCCURRENCE_BATCH_CONFIRMATION, expectedPlanFingerprint: review.planFingerprint });
assert.equal(stale.code, "batch_occurrence_plan_stale");
assert.equal((db.prepare("SELECT COUNT(*) count FROM budgetSnapshots WHERE id IN (1,2)").get() as { count: number }).count, 2);

const fresh = budgetSnapshotOccurrenceBatchDryRun(db, { action: "delete", budgetId: 1, snapshotIds: [1, 2] });
const deleted = budgetSnapshotOccurrenceBatchWrite(db, { action: "delete", budgetId: 1, snapshotIds: [1, 2], dryRunReviewed: true, confirmation: BUDGET_SNAPSHOT_OCCURRENCE_BATCH_CONFIRMATION, expectedPlanFingerprint: fresh.planFingerprint });
assert.equal(deleted.ok, true);
assert.equal(deleted.rowsChanged, 2);
assert.equal((db.prepare("SELECT COUNT(*) count FROM budgetSnapshots WHERE id IN (1,2)").get() as { count: number }).count, 0);
db.close();
console.log("Budget occurrence batch: PASS");

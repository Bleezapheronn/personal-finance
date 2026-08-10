import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { catchUpHistoricalOccurrences, syncMutableOccurrenceValues } from "./lib/budgetOccurrenceModel.js";
import { budgetScheduleSuccessorDryRun, budgetScheduleSuccessorWrite, BUDGET_SCHEDULE_SUCCESSOR_CONFIRMATION } from "./lib/budgetScheduleSuccessor.js";
import { BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS, budgetSnapshotOccurrenceDryRun, budgetSnapshotOccurrenceRealWrite } from "./lib/budgetSnapshotOccurrence.js";

const db = new Database(":memory:");
db.exec(readFileSync(new URL("../schema/prototype-schema.sql", import.meta.url), "utf8"));
const now = "2026-08-01T00:00:00.000Z";
db.exec(`INSERT INTO buckets (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt) VALUES (1,'x',0,100,1,1,0,'${now}','${now}');
INSERT INTO categories (id,name,bucketId,isActive,createdAt,updatedAt) VALUES (1,'x',1,1,'${now}','${now}');
INSERT INTO accounts (id,name,isActive,isCredit,createdAt,updatedAt) VALUES (1,'x',1,0,'${now}','${now}');
INSERT INTO recipients (id,name,isActive,createdAt,updatedAt) VALUES (1,'x',1,'${now}','${now}');`);
db.prepare(`INSERT INTO budgets (id,description,categoryId,accountId,recipientId,amount,transactionCost,frequency,frequencyDetails,isGoal,isFlexible,isActive,remainingCyclesTotal,projectionStartsOn,dueDate,createdAt,updatedAt)
VALUES (1,'Groceries',1,1,1,-100,0,'weekly',NULL,0,0,1,9,'2026-07-01','2026-07-01',@now,@now)`).run({ now });

assert.equal(catchUpHistoricalOccurrences(db, 1, new Date("2026-08-10")), 6);
assert.equal(catchUpHistoricalOccurrences(db, 1, new Date("2026-08-10")), 0, "catch-up is idempotent");
const snapshotCountBeforeInactiveCatchUp = (db.prepare("SELECT COUNT(*) count FROM budgetSnapshots").get() as { count: number }).count;
db.prepare("UPDATE budgets SET isActive=0 WHERE id=1").run();
assert.equal(catchUpHistoricalOccurrences(db, 1, new Date("2026-08-17")), 0, "inactive Budgets do not catch up");
assert.equal((db.prepare("SELECT COUNT(*) count FROM budgetSnapshots").get() as { count: number }).count, snapshotCountBeforeInactiveCatchUp);
db.prepare("UPDATE budgets SET isActive=1 WHERE id=1").run();
const frozen = db.prepare("SELECT * FROM budgetSnapshots WHERE cycleIndex=1").get() as Record<string, unknown>;
db.prepare("UPDATE budgets SET amount=-125, updatedAt='2026-08-10T00:00:00.000Z' WHERE id=1").run();
syncMutableOccurrenceValues(db, 1, new Date("2026-08-10"));
assert.equal((db.prepare("SELECT amount FROM budgetSnapshots WHERE id=?").get(frozen.id) as { amount: number }).amount, -100, "frozen value remains stable");

db.prepare(`INSERT INTO transactions (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetId,occurrenceDate,budgetSnapshotId)
VALUES (10,1,1,1,'2026-08-08',-40,0,NULL,NULL,NULL)`).run();
const linkInput = { budgetId: 1, occurrenceDate: "2026-08-12", transactionId: 10 };
const linkDry = budgetSnapshotOccurrenceDryRun(db, linkInput, "createAndLink");
assert.equal(linkDry.ok, true);
assert.ok(linkDry.planFingerprint);
assert.equal(budgetSnapshotOccurrenceRealWrite(db, { ...linkInput, dryRunReviewed: true, confirmation: BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS.createAndLink, expectedPlanFingerprint: linkDry.planFingerprint }, "createAndLink").ok, true);
const futureSnapshotId = (db.prepare("SELECT budgetSnapshotId FROM transactions WHERE id=10").get() as { budgetSnapshotId: number }).budgetSnapshotId;
const future = db.prepare("SELECT * FROM budgetSnapshots WHERE id=?").get(futureSnapshotId) as Record<string, unknown>;

const deactivateInput = { snapshotId: Number(frozen.id), isActive: false };
const deactivateDry = budgetSnapshotOccurrenceDryRun(db, deactivateInput, "setActive");
assert.equal(deactivateDry.ok, true);
assert.equal(budgetSnapshotOccurrenceRealWrite(db, { ...deactivateInput, dryRunReviewed: true, confirmation: BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS.setActive, expectedPlanFingerprint: deactivateDry.planFingerprint }, "setActive").ok, true);
db.prepare(`INSERT INTO transactions (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetSnapshotId) VALUES (11,1,1,1,'2026-08-09',-1,0,NULL)`).run();
assert.equal(budgetSnapshotOccurrenceDryRun(db, { snapshotId: Number(frozen.id), transactionId: 11 }, "link").code, "occurrence_inactive");

const successorInput = { budgetId: 1, asOf: "2026-08-10", definition: {
  description: "Groceries", categoryId: 1, accountId: 1, recipientId: 1, amount: -130, transactionCost: 0,
  frequency: "weekly", frequencyDetails: null, isGoal: false, isFlexible: false, goalPercentage: null,
  goalDirection: null, remainingCyclesTotal: 9, dueDate: "2026-08-13T00:00:00.000Z",
} };
const successorDry = budgetScheduleSuccessorDryRun(db, successorInput);
assert.equal(successorDry.ok, true);
assert.equal(successorDry.remainingCyclesTotal, 3);
const successorWrite = budgetScheduleSuccessorWrite(db, { ...successorInput, dryRunReviewed: true, confirmation: BUDGET_SCHEDULE_SUCCESSOR_CONFIRMATION, expectedPlanFingerprint: successorDry.planFingerprint });
assert.equal(successorWrite.ok, true);
const moved = db.prepare("SELECT * FROM budgetSnapshots WHERE id=?").get(future.id) as Record<string, unknown>;
assert.equal(moved.budgetId, successorWrite.successorId);
assert.equal(moved.cycleIndex, 1);
assert.equal((db.prepare("SELECT budgetSnapshotId FROM transactions WHERE id=10").get() as { budgetSnapshotId: number }).budgetSnapshotId, future.id);
assert.equal((db.prepare("SELECT isActive FROM budgets WHERE id=1").get() as { isActive: number }).isActive, 0);
console.log("Budget occurrence model: PASS");
db.close();

import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  BUDGET_LIFECYCLE_CONFIRMATIONS,
  budgetLifecycleDryRun,
  budgetLifecycleRealWrite,
} from "./lib/budgetLifecycle.js";
import { serverRoot } from "./lib/paths.js";

interface Check { name: string; ok: boolean }
const checks: Check[] = [];
const check = (name: string, ok: boolean) => checks.push({ name, ok });

const createDb = () => {
  const db = new Database(":memory:");
  db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
  const timestamp = "2026-01-01T00:00:00.000Z";
  db.prepare(`INSERT INTO buckets (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (1,'x',0,100,1,1,0,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO categories (id,name,bucketId,isActive,createdAt,updatedAt)
    VALUES (1,'x',1,1,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO accounts (id,name,isActive,isCredit,createdAt,updatedAt)
    VALUES (1,'x',1,0,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO recipients (id,name,isActive,createdAt,updatedAt)
    VALUES (1,'x',1,@timestamp,@timestamp)`).run({ timestamp });
  return db;
};

const definition = (overrides: Record<string, unknown> = {}) => ({
  description: "Synthetic lifecycle budget", categoryId: 1, accountId: 1,
  recipientId: 1, amount: -100, transactionCost: null, frequency: "monthly",
  frequencyDetails: { dayOfMonth: 15 }, isGoal: false, isFlexible: false,
  goalPercentage: null, goalDirection: null, remainingCyclesTotal: null,
  dueDate: "2026-01-15T00:00:00.000Z", isActive: true, asOf: "2026-03-10",
  ...overrides,
});

const write = (db: Database.Database, action: "create" | "update", payload: Record<string, unknown>) => {
  const dry = budgetLifecycleDryRun(db, payload, action);
  if (!dry.planFingerprint) throw new Error(`missing plan for ${action}: ${dry.validationErrors.join(",")}`);
  return budgetLifecycleRealWrite(db, {
    ...payload, dryRunReviewed: true, confirmation: BUDGET_LIFECYCLE_CONFIRMATIONS[action],
    expectedPlanFingerprint: dry.planFingerprint,
  }, action);
};

const db = createDb();
const createDry = budgetLifecycleDryRun(db, definition(), "create");
check("create dry-run is non-mutating", createDry.ok && createDry.sqliteMutated === false);
const create = write(db, "create", definition());
const budgetId = Number(create.targetId);
const rowsAfterCreate = db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY dueDate").all({ budgetId }) as Array<Record<string, unknown>>;
check("create materializes only already-frozen occurrences", create.ok && rowsAfterCreate.length === 2 &&
  rowsAfterCreate.every((row) => new Date(String(row.dueDate)) < new Date("2026-03-10T00:00:00.000Z")));

const update = write(db, "update", definition({ id: budgetId, amount: -250 }));
const rows = db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY dueDate").all({ budgetId }) as Array<Record<string, unknown>>;
check("update does not introduce prospective coverage", update.ok && rows.length === rowsAfterCreate.length &&
  rows.every((row) => new Date(String(row.dueDate)) < new Date("2026-03-10T00:00:00.000Z")));
check("catch-up uses the pre-mutation definition", rows.every((row) => Number(row.amount) === -100));
check("catch-up rows are active durable occurrences", rows.every((row) => Number(row.isActive) === 1 && Number(row.isHistorical) === 1));

const beforeRepeat = JSON.stringify(rows);
write(db, "update", definition({ id: budgetId, amount: -275 }));
check("repeated update does not duplicate frozen occurrences", beforeRepeat === JSON.stringify(
  db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY dueDate").all({ budgetId }),
));

const inactiveDb = createDb();
const inactiveCreate = write(inactiveDb, "create", definition({ isActive: false }));
const inactiveId = Number(inactiveCreate.targetId);
const inactiveDry = budgetLifecycleDryRun(inactiveDb, definition({ id: inactiveId, isActive: false, amount: -175 }), "update");
check("ordinary edits of inactive definitions are refused", !inactiveDry.ok &&
  inactiveDry.validationErrors.includes("inactive_budget_definition_edit_requires_reactivation"));
const missingMode = budgetLifecycleDryRun(inactiveDb, definition({ id: inactiveId, isActive: true }), "update");
check("reactivation requires an explicit Resume or Backfill choice", !missingMode.ok &&
  missingMode.validationErrors.includes("reactivation_mode_required"));
const resumed = write(inactiveDb, "update", definition({ id: inactiveId, isActive: true, reactivationMode: "resume" }));
check("Resume starts projection today without regenerating the inactive interval", resumed.ok &&
  (inactiveDb.prepare("SELECT COUNT(*) count FROM budgetSnapshots WHERE budgetId=@budgetId").get({ budgetId: inactiveId }) as { count: number }).count === 0);

const backfillDb = createDb();
const backfillCreate = write(backfillDb, "create", definition({ isActive: false }));
const backfillId = Number(backfillCreate.targetId);
const backfilled = write(backfillDb, "update", definition({ id: backfillId, isActive: true, reactivationMode: "backfill" }));
check("Backfill materializes the preserved inactive interval", backfilled.ok &&
  (backfillDb.prepare("SELECT COUNT(*) count FROM budgetSnapshots WHERE budgetId=@budgetId").get({ budgetId: backfillId }) as { count: number }).count === 2);

const staleDb = createDb();
const staleCreate = write(staleDb, "create", definition());
const staleId = Number(staleCreate.targetId);
const stalePayload = definition({ id: staleId, amount: -275 });
const staleDry = budgetLifecycleDryRun(staleDb, stalePayload, "update");
staleDb.prepare("UPDATE budgets SET amount=-101 WHERE id=@id").run({ id: staleId });
const beforeStaleWrite = JSON.stringify(staleDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: staleId }));
const staleWrite = budgetLifecycleRealWrite(staleDb, {
  ...stalePayload, dryRunReviewed: true, confirmation: BUDGET_LIFECYCLE_CONFIRMATIONS.update,
  expectedPlanFingerprint: staleDry.planFingerprint,
}, "update");
check("stale plan is refused without mutation", staleWrite.code === "budget_lifecycle_plan_stale" &&
  beforeStaleWrite === JSON.stringify(staleDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: staleId })));

const pixelDb = createDb();
const pixelCreate = write(pixelDb, "create", definition({
  description: "One-time goal", frequency: "once", isGoal: true,
  frequencyDetails: null, dueDate: "2026-08-31T00:00:00.000Z", asOf: "2026-08-10",
}));
const pixelId = Number(pixelCreate.targetId);
pixelDb.prepare(`INSERT INTO budgetSnapshots (
  id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,recipientId,
  amount,transactionCost,frequency,frequencyDetails,isGoal,isFlexible,goalPercentage,goalDirection,
  remainingCyclesTotal,isActive,isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt
) VALUES (100,@budgetId,'2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z',1,'One-time goal',1,1,1,
  -100,NULL,'once',NULL,1,0,NULL,NULL,NULL,1,0,@now,@now,@now)`).run({ budgetId: pixelId, now: "2026-08-10T00:00:00.000Z" });
pixelDb.prepare(`INSERT INTO transactions (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetSnapshotId)
  VALUES (100,1,1,1,'2026-08-10T00:00:00.000Z',-10,0,100)`).run();
const pixelUpdate = write(pixelDb, "update", definition({
  id: pixelId, description: "One-time goal", frequency: "once", isGoal: true,
  frequencyDetails: null, dueDate: "2026-09-30T00:00:00.000Z", asOf: "2026-08-10",
}));
const moved = pixelDb.prepare("SELECT id,budgetId,occurrenceDate,dueDate FROM budgetSnapshots WHERE id=100").get() as Record<string, unknown>;
const linked = pixelDb.prepare("SELECT budgetSnapshotId FROM transactions WHERE id=100").get() as { budgetSnapshotId: number };
check("one-time prospective date edit preserves Budget, snapshot, and Transaction linkage", pixelUpdate.ok &&
  Number(moved.id) === 100 && Number(moved.budgetId) === pixelId &&
  String(moved.occurrenceDate).startsWith("2026-09-30") && String(moved.dueDate).startsWith("2026-09-30") &&
  linked.budgetSnapshotId === 100 &&
  (pixelDb.prepare("SELECT COUNT(*) count FROM budgetSnapshots WHERE budgetId=?").get(pixelId) as { count: number }).count === 1);
pixelDb.prepare(`INSERT INTO budgetSnapshots (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,recipientId,amount,frequency,isGoal,isFlexible,isActive,isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt)
  VALUES (101,@budgetId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z',2,'One-time goal',1,1,1,-100,'once',1,0,1,0,@now,@now,@now)`).run({ budgetId: pixelId, now: "2026-08-10T00:00:00.000Z" });
const collision = budgetLifecycleDryRun(pixelDb, definition({ id: pixelId, description: "One-time goal", frequency: "once", isGoal: true, frequencyDetails: null, dueDate: "2026-10-31T00:00:00.000Z", asOf: "2026-08-10" }), "update");
check("one-time target-date collision is refused without mutation", !collision.ok && collision.validationErrors.includes("one_time_occurrence_target_date_ambiguous"));

db.close();
inactiveDb.close();
backfillDb.close();
staleDb.close();
pixelDb.close();
for (const result of checks) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
const failed = checks.filter((result) => !result.ok).length;
console.log(`Budget lifecycle checks: ${checks.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

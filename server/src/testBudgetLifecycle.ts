import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  BUDGET_LIFECYCLE_CONFIRMATIONS,
  budgetLifecycleDryRun,
  budgetLifecycleRealWrite,
} from "./lib/budgetLifecycle.js";
import { localDayKey } from "../shared/budgetSnapshotGeneration.js";
import { serverRoot } from "./lib/paths.js";

interface Check { name: string; ok: boolean }
const checks: Check[] = [];
const check = (name: string, ok: boolean) => checks.push({ name, ok });

const createDb = () => {
  const db = new Database(":memory:");
  db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
  const timestamp = "2026-01-01T00:00:00.000Z";
  db.prepare(`INSERT INTO buckets
    (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (1,'x',0,100,1,1,0,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,isActive,createdAt,updatedAt)
    VALUES (1,'x',1,1,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO accounts
    (id,name,isActive,isCredit,createdAt,updatedAt)
    VALUES (1,'x',1,0,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO recipients
    (id,name,isActive,createdAt,updatedAt)
    VALUES (1,'x',1,@timestamp,@timestamp)`).run({ timestamp });
  return db;
};

const definition = (overrides: Record<string, unknown> = {}) => ({
  description: "Synthetic lifecycle budget",
  categoryId: 1,
  accountId: 1,
  recipientId: 1,
  amount: -100,
  transactionCost: null,
  frequency: "monthly",
  frequencyDetails: { dayOfMonth: 15 },
  isGoal: false,
  isFlexible: false,
  goalPercentage: null,
  goalDirection: null,
  remainingCyclesTotal: null,
  dueDate: "2026-01-15T00:00:00.000Z",
  isActive: true,
  asOf: "2026-03-10",
  ...overrides,
});

const write = (db: Database.Database, action: "create" | "update", payload: Record<string, unknown>) => {
  const dry = budgetLifecycleDryRun(db, payload, action);
  if (!dry.planFingerprint) throw new Error(`missing plan for ${action}`);
  return budgetLifecycleRealWrite(db, {
    ...payload,
    dryRunReviewed: true,
    confirmation: BUDGET_LIFECYCLE_CONFIRMATIONS[action],
    expectedPlanFingerprint: dry.planFingerprint,
  }, action);
};

const activeDb = createDb();
const activeDry = budgetLifecycleDryRun(activeDb, definition(), "create");
check("active create dry-run is non-mutating", activeDry.ok && activeDry.sqliteMutated === false &&
  (activeDb.prepare("SELECT COUNT(*) count FROM budgets").get() as { count: number }).count === 0);
const activeWrite = write(activeDb, "create", definition());
const activeSnapshots = activeDb.prepare("SELECT * FROM budgetSnapshots ORDER BY id").all() as Record<string, unknown>[];
check("active create writes definition and coverage", activeWrite.ok && activeSnapshots.length > 0);
check("active coverage reaches the final occurrence within one local calendar year", activeSnapshots.some((row) => String(row.occurrenceDate).startsWith("2027-02")));

const inactiveDb = createDb();
const inactiveWrite = write(inactiveDb, "create", definition({ isActive: false }));
check("inactive create generates no snapshots", inactiveWrite.ok &&
  (inactiveDb.prepare("SELECT COUNT(*) count FROM budgetSnapshots").get() as { count: number }).count === 0);

const db = activeDb;
const budgetId = Number((db.prepare("SELECT id FROM budgets LIMIT 1").get() as { id: number }).id);
const snapshotsBefore = db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY id").all({ budgetId }) as Record<string, unknown>[];
const past = snapshotsBefore.find((row) => String(row.occurrenceDate).startsWith("2026-02"))!;
const linked = snapshotsBefore.find((row) => String(row.occurrenceDate).startsWith("2026-04"))!;
const future = snapshotsBefore.find((row) => String(row.occurrenceDate).startsWith("2026-05"))!;
db.prepare(`INSERT INTO transactions
  (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetId,occurrenceDate,budgetSnapshotId)
  VALUES (1,1,1,1,'2026-04-15T00:00:00.000Z',-100,0,@budgetId,'2026-04-15T00:00:00.000Z',@snapshotId)`)
  .run({ budgetId, snapshotId: linked.id });
const transactionBefore = db.prepare("SELECT * FROM transactions WHERE id=1").get();
const updatePayload = definition({
  id: budgetId,
  amount: -250,
  frequencyDetails: { dayOfMonth: 20 },
  dueDate: "2026-01-20T00:00:00.000Z",
});
const updateDry = budgetLifecycleDryRun(db, updatePayload, "update");
check("update reports cleanup and linked protection", updateDry.ok &&
  updateDry.unlinkedFutureSnapshotsProposedForCleanup > 0 && updateDry.linkedSnapshotsProtected === 1);
const updateWrite = write(db, "update", updatePayload);
check("update lifecycle succeeds", updateWrite.ok && updateWrite.sqliteMutated);
check("past snapshot remains byte-identical", JSON.stringify(db.prepare("SELECT * FROM budgetSnapshots WHERE id=@id").get({ id: past.id })) === JSON.stringify(past));
check("linked future snapshot remains byte-identical", JSON.stringify(db.prepare("SELECT * FROM budgetSnapshots WHERE id=@id").get({ id: linked.id })) === JSON.stringify(linked));
check("eligible unlinked future occurrence is removed", db.prepare(
  "SELECT id FROM budgetSnapshots WHERE budgetId=@budgetId AND occurrenceDate=@occurrenceDate",
).get({ budgetId, occurrenceDate: future.occurrenceDate }) === undefined);
check("transaction linkage remains unchanged", JSON.stringify(db.prepare("SELECT * FROM transactions WHERE id=1").get()) === JSON.stringify(transactionBefore));
const repeat = write(db, "update", updatePayload);
check("repeated update introduces no duplicate occurrence", repeat.ok &&
  (db.prepare(`SELECT COUNT(*) count FROM (
    SELECT occurrenceDate FROM budgetSnapshots WHERE budgetId=@budgetId
    GROUP BY occurrenceDate HAVING COUNT(*) > 1
  )`).get({ budgetId }) as { count: number }).count === 0);

const inactiveUpdate = write(db, "update", { ...updatePayload, isActive: false });
const inactiveSnapshots = db.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY id",
).all({ budgetId }) as Record<string, unknown>[];
check("inactive update retains linked snapshots", inactiveUpdate.ok &&
  inactiveSnapshots.some((row) => Number(row.id) === Number(linked.id)));
check("inactive update generates no replacement coverage", inactiveSnapshots.every((row) =>
  Number(row.id) === Number(linked.id) ||
  new Date(String(row.occurrenceDate)).setHours(0, 0, 0, 0) <
    new Date("2026-03-10").setHours(0, 0, 0, 0)));

const noSnapshotsDb = createDb();
const noSnapshotsCreate = write(noSnapshotsDb, "create", definition({ isActive: false }));
const noSnapshotsBudgetId = Number(noSnapshotsCreate.targetId);
const noSnapshotsUpdate = write(noSnapshotsDb, "update", definition({
  id: noSnapshotsBudgetId,
  isActive: true,
  amount: -175,
}));
check("update with no prior snapshots generates active coverage", noSnapshotsUpdate.ok &&
  (noSnapshotsDb.prepare(
    "SELECT COUNT(*) count FROM budgetSnapshots WHERE budgetId=@budgetId",
  ).get({ budgetId: noSnapshotsBudgetId }) as { count: number }).count > 0);

const cutoffDb = createDb();
const cutoffCreate = write(cutoffDb, "create", definition());
const cutoffBudgetId = Number(cutoffCreate.targetId);
const cutoffBefore = (cutoffDb.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId",
).all({ budgetId: cutoffBudgetId }) as Record<string, unknown>[]).find(
  (row) => localDayKey(String(row.occurrenceDate)) >= "2026-03-10",
)!;
const cutoffAsOf = localDayKey(String(cutoffBefore.occurrenceDate));
write(cutoffDb, "update", definition({
  id: cutoffBudgetId,
  asOf: cutoffAsOf,
  amount: -125,
}));
const cutoffAfter = (cutoffDb.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId",
).all({ budgetId: cutoffBudgetId }) as Record<string, unknown>[]).find(
  (row) => localDayKey(String(row.occurrenceDate)) === cutoffAsOf,
)!;
check("cleanup cutoff includes normalized local midnight",
  Number(cutoffBefore.amount) === -100 && Number(cutoffAfter.amount) === -125);

const suppressionDb = createDb();
const suppressionCreate = write(suppressionDb, "create", definition());
const suppressionBudgetId = Number(suppressionCreate.targetId);
const suppressionSnapshot = (suppressionDb.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY id",
).all({ budgetId: suppressionBudgetId }) as Record<string, unknown>[]).find(
  (row) => localDayKey(String(row.occurrenceDate)) === "2026-04-15",
)!;
suppressionDb.prepare(`INSERT INTO transactions
  (id,categoryId,accountId,recipientId,date,amount,isTransfer,budgetId,occurrenceDate,budgetSnapshotId)
  VALUES (1,1,1,1,'2026-04-15T00:00:00.000Z',-100,0,@budgetId,'2026-04-15T00:00:00.000Z',@snapshotId)`)
  .run({ budgetId: suppressionBudgetId, snapshotId: suppressionSnapshot.id });
write(suppressionDb, "update", definition({ id: suppressionBudgetId, amount: -225 }));
const suppressionRows = (suppressionDb.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY id",
).all({ budgetId: suppressionBudgetId }) as Record<string, unknown>[]).filter(
  (row) => localDayKey(String(row.occurrenceDate)) === "2026-04-15",
);
check("linked occurrence suppresses duplicate generation", suppressionRows.length === 1 &&
  JSON.stringify(suppressionRows[0]) === JSON.stringify(suppressionSnapshot));

const staleDb = createDb();
const staleCreate = write(staleDb, "create", definition());
const staleBudgetId = Number(staleCreate.targetId);
const stalePayload = definition({ id: staleBudgetId, amount: -275 });
const staleDry = budgetLifecycleDryRun(staleDb, stalePayload, "update");
staleDb.prepare("UPDATE budgets SET amount=-101 WHERE id=@id").run({ id: staleBudgetId });
const staleBeforeWrite = JSON.stringify({
  budget: staleDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: staleBudgetId }),
  snapshots: staleDb.prepare("SELECT * FROM budgetSnapshots ORDER BY id").all(),
});
const staleWrite = budgetLifecycleRealWrite(staleDb, {
  ...stalePayload,
  dryRunReviewed: true,
  confirmation: BUDGET_LIFECYCLE_CONFIRMATIONS.update,
  expectedPlanFingerprint: staleDry.planFingerprint,
}, "update");
check("stale dry-run state fails without lifecycle mutation",
  staleWrite.code === "budget_lifecycle_plan_stale" && staleBeforeWrite === JSON.stringify({
    budget: staleDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: staleBudgetId }),
    snapshots: staleDb.prepare("SELECT * FROM budgetSnapshots ORDER BY id").all(),
  }));

const unrelatedDb = createDb();
const targetCreate = write(unrelatedDb, "create", definition());
const unrelatedCreate = write(unrelatedDb, "create", definition({
  description: "Unrelated synthetic budget",
  dueDate: "2026-01-25T00:00:00.000Z",
}));
const unrelatedId = Number(unrelatedCreate.targetId);
const unrelatedBefore = JSON.stringify({
  budget: unrelatedDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: unrelatedId }),
  snapshots: unrelatedDb.prepare(
    "SELECT * FROM budgetSnapshots WHERE budgetId=@id ORDER BY id",
  ).all({ id: unrelatedId }),
});
write(unrelatedDb, "update", definition({ id: Number(targetCreate.targetId), amount: -325 }));
check("unrelated budget and snapshots remain byte-identical", unrelatedBefore === JSON.stringify({
  budget: unrelatedDb.prepare("SELECT * FROM budgets WHERE id=@id").get({ id: unrelatedId }),
  snapshots: unrelatedDb.prepare(
    "SELECT * FROM budgetSnapshots WHERE budgetId=@id ORDER BY id",
  ).all({ id: unrelatedId }),
}));

const conflictDb = createDb();
write(conflictDb, "create", definition());
const conflictBudgetId = Number((conflictDb.prepare("SELECT id FROM budgets LIMIT 1").get() as { id: number }).id);
const source = conflictDb.prepare("SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId LIMIT 1").get({ budgetId: conflictBudgetId }) as Record<string, unknown>;
const columns = Object.keys(source).filter((key) => key !== "id");
conflictDb.prepare(`INSERT INTO budgetSnapshots (${columns.join(",")}) VALUES (${columns.map((key) => `@${key}`).join(",")})`).run(source);
const beforeConflict = JSON.stringify({
  budgets: conflictDb.prepare("SELECT * FROM budgets ORDER BY id").all(),
  snapshots: conflictDb.prepare("SELECT * FROM budgetSnapshots ORDER BY id").all(),
});
const conflictDry = budgetLifecycleDryRun(conflictDb, definition({ id: conflictBudgetId, amount: -300 }), "update");
check("duplicate occurrence fails closed", !conflictDry.ok && conflictDry.conflictCount > 0);
check("conflict dry-run does not mutate", beforeConflict === JSON.stringify({
  budgets: conflictDb.prepare("SELECT * FROM budgets ORDER BY id").all(),
  snapshots: conflictDb.prepare("SELECT * FROM budgetSnapshots ORDER BY id").all(),
}));

const dueConflictDb = createDb();
const dueConflictCreate = write(dueConflictDb, "create", definition());
const dueConflictBudgetId = Number(dueConflictCreate.targetId);
const dueSource = dueConflictDb.prepare(
  "SELECT * FROM budgetSnapshots WHERE budgetId=@budgetId ORDER BY id LIMIT 1",
).get({ budgetId: dueConflictBudgetId }) as Record<string, unknown>;
const dueColumns = Object.keys(dueSource).filter((key) => key !== "id");
dueConflictDb.prepare(
  `INSERT INTO budgetSnapshots (${dueColumns.join(",")}) VALUES (${dueColumns.map((key) => `@${key}`).join(",")})`,
).run({ ...dueSource, occurrenceDate: "2026-01-16T00:00:00.000Z" });
const dueConflictDry = budgetLifecycleDryRun(
  dueConflictDb,
  definition({ id: dueConflictBudgetId, amount: -350 }),
  "update",
);
check("duplicate due-date identity fails closed", !dueConflictDry.ok &&
  dueConflictDry.validationErrors.includes("duplicate_due_date_snapshots"));

const rollbackDb = createDb();
const rollbackPayload = definition();
const rollbackDry = budgetLifecycleDryRun(rollbackDb, rollbackPayload, "create");
rollbackDb.exec(`CREATE TRIGGER reject_lifecycle_snapshot BEFORE INSERT ON budgetSnapshots
  BEGIN SELECT RAISE(ABORT, 'synthetic_snapshot_insert_failure'); END`);
let rollbackFailed = false;
try {
  budgetLifecycleRealWrite(rollbackDb, {
    ...rollbackPayload,
    dryRunReviewed: true,
    confirmation: BUDGET_LIFECYCLE_CONFIRMATIONS.create,
    expectedPlanFingerprint: rollbackDry.planFingerprint,
  }, "create");
} catch {
  rollbackFailed = true;
}
check("snapshot insertion failure rolls back definition atomically", rollbackFailed &&
  (rollbackDb.prepare("SELECT COUNT(*) count FROM budgets").get() as { count: number }).count === 0 &&
  (rollbackDb.prepare("SELECT COUNT(*) count FROM budgetSnapshots").get() as { count: number }).count === 0);

activeDb.close();
inactiveDb.close();
conflictDb.close();
noSnapshotsDb.close();
cutoffDb.close();
suppressionDb.close();
staleDb.close();
unrelatedDb.close();
dueConflictDb.close();
rollbackDb.close();

for (const result of checks) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
const failed = checks.filter((result) => !result.ok).length;
console.log(`Budget lifecycle checks: ${checks.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

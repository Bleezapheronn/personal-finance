import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  RECIPIENT_LIFECYCLE_CONFIRMATIONS,
  recipientLifecycleDryRun,
  recipientLifecycleRealWrite,
} from "./lib/recipientLifecycle.js";
import { serverRoot } from "./lib/paths.js";

interface Check { name: string; ok: boolean }
const checks: Check[] = [];
const check = (name: string, ok: boolean) => checks.push({ name, ok });
const timestamp = "2026-07-22T00:00:00.000Z";

const createDb = () => {
  const db = new Database(":memory:");
  db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
  db.prepare(`INSERT INTO buckets
    (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (1,'fixture',0,100,1,1,0,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,isActive,createdAt,updatedAt)
    VALUES (1,'fixture',1,1,@timestamp,@timestamp)`).run({ timestamp });
  db.prepare(`INSERT INTO accounts
    (id,name,isActive,isCredit,createdAt,updatedAt)
    VALUES (1,'fixture',1,0,@timestamp,@timestamp)`).run({ timestamp });
  return db;
};

const addRecipient = (db: Database.Database, id: number, isActive = true) => {
  db.prepare(`INSERT INTO recipients
    (id,name,aliases,email,phone,tillNumber,paybill,accountNumber,description,isActive,createdAt,updatedAt)
    VALUES (@id,@name,NULL,NULL,NULL,NULL,NULL,NULL,NULL,@isActive,@timestamp,@timestamp)`)
    .run({ id, name: `fixture-${id}`, isActive: isActive ? 1 : 0, timestamp });
};

const addTransactionReference = (db: Database.Database, id: number, recipientId: number) => {
  db.prepare(`INSERT INTO transactions
    (id,categoryId,accountId,recipientId,date,amount,transactionCost,description,isTransfer)
    VALUES (@id,1,1,@recipientId,'2026-07-22T00:00:00.000Z',-100,-2,'fixture',0)`)
    .run({ id, recipientId });
};

const addBudgetReference = (db: Database.Database, id: number, recipientId: number) => {
  db.prepare(`INSERT INTO budgets
    (id,description,categoryId,accountId,recipientId,amount,transactionCost,frequency,
     frequencyDetails,isGoal,isFlexible,goalPercentage,goalDirection,isActive,
     remainingCyclesTotal,dueDate,createdAt,updatedAt)
    VALUES (@id,'fixture',1,1,@recipientId,-100,-2,'once',NULL,0,0,NULL,NULL,1,NULL,
      '2026-07-22T00:00:00.000Z',@timestamp,@timestamp)`)
    .run({ id, recipientId, timestamp });
};

const addSnapshotReference = (
  db: Database.Database,
  id: number,
  budgetId: number,
  recipientId: number,
) => {
  db.prepare(`INSERT INTO budgetSnapshots
    (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,
     recipientId,amount,transactionCost,frequency,frequencyDetails,isGoal,isFlexible,
     goalPercentage,goalDirection,remainingCyclesTotal,isHistorical,sourceBudgetUpdatedAt,
     createdAt,updatedAt)
    VALUES (@id,@budgetId,'2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z',0,
      'fixture',1,1,@recipientId,-100,-2,'once',NULL,0,0,NULL,NULL,NULL,0,@timestamp,
      @timestamp,@timestamp)`)
    .run({ id, budgetId, recipientId, timestamp });
};

const write = (
  db: Database.Database,
  action: "delete" | "merge",
  payload: Record<string, unknown>,
) => {
  const dry = recipientLifecycleDryRun(db, payload, action);
  if (!dry.planFingerprint) throw new Error(`missing_${action}_plan`);
  return recipientLifecycleRealWrite(db, {
    ...payload,
    dryRunReviewed: true,
    confirmation: RECIPIENT_LIFECYCLE_CONFIRMATIONS[action],
    expectedPlanFingerprint: dry.planFingerprint,
  }, action);
};

for (const isActive of [true, false]) {
  const db = createDb();
  addRecipient(db, 1, isActive);
  const dry = recipientLifecycleDryRun(db, { recipientId: 1 }, "delete");
  const result = write(db, "delete", { recipientId: 1 });
  check(`${isActive ? "active" : "inactive"} unused recipient deletes safely`,
    dry.ok && dry.referenceCount === 0 && result.ok && result.rowsChanged === 1 &&
    db.prepare("SELECT 1 FROM recipients WHERE id=1").get() === undefined);
  db.close();
}

for (const entity of ["transactions", "budgets", "budgetSnapshots"] as const) {
  const db = createDb();
  addRecipient(db, 1);
  if (entity === "transactions") addTransactionReference(db, 1, 1);
  if (entity === "budgets") addBudgetReference(db, 1, 1);
  if (entity === "budgetSnapshots") {
    addBudgetReference(db, 1, null as unknown as number);
    addSnapshotReference(db, 1, 1, 1);
  }
  const before = JSON.stringify({
    recipients: db.prepare("SELECT * FROM recipients ORDER BY id").all(),
    rows: db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all(),
  });
  const dry = recipientLifecycleDryRun(db, { recipientId: 1 }, "delete");
  const refused = recipientLifecycleRealWrite(db, {
    recipientId: 1,
    dryRunReviewed: true,
    confirmation: RECIPIENT_LIFECYCLE_CONFIRMATIONS.delete,
    expectedPlanFingerprint: dry.planFingerprint,
  }, "delete");
  check(`referenced recipient deletion refuses ${entity}`, !dry.eligible &&
    dry.referenceCountsByEntity[entity] === 1 && !refused.sqliteMutated &&
    before === JSON.stringify({
      recipients: db.prepare("SELECT * FROM recipients ORDER BY id").all(),
      rows: db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all(),
    }));
  db.close();
}

const zeroDb = createDb();
addRecipient(zeroDb, 1);
addRecipient(zeroDb, 2, false);
const zeroTargetBefore = zeroDb.prepare("SELECT * FROM recipients WHERE id=2").get();
const zeroMerge = write(zeroDb, "merge", { sourceRecipientId: 1, targetRecipientId: 2 });
check("merge with zero references deletes source and preserves target", zeroMerge.ok &&
  zeroMerge.rowsChanged === 1 &&
  zeroDb.prepare("SELECT 1 FROM recipients WHERE id=1").get() === undefined &&
  JSON.stringify(zeroDb.prepare("SELECT * FROM recipients WHERE id=2").get()) ===
    JSON.stringify(zeroTargetBefore));
zeroDb.close();

const mergeDb = createDb();
addRecipient(mergeDb, 1);
addRecipient(mergeDb, 2, false);
addRecipient(mergeDb, 3);
addTransactionReference(mergeDb, 1, 1);
addBudgetReference(mergeDb, 1, 1);
addSnapshotReference(mergeDb, 1, 1, 1);
const targetBefore = mergeDb.prepare("SELECT * FROM recipients WHERE id=2").get();
const unrelatedBefore = mergeDb.prepare("SELECT * FROM recipients WHERE id=3").get();
const financialBefore = JSON.stringify({
  transaction: mergeDb.prepare(`SELECT id,categoryId,accountId,date,amount,transactionCost,
    transferPairId,isTransfer,budgetId,occurrenceDate,budgetSnapshotId FROM transactions`).all(),
  budget: mergeDb.prepare(`SELECT id,description,categoryId,accountId,amount,transactionCost,
    frequency,frequencyDetails,isGoal,isFlexible,goalPercentage,goalDirection,isActive,
    remainingCyclesTotal,dueDate,createdAt,updatedAt FROM budgets`).all(),
  snapshot: mergeDb.prepare(`SELECT id,budgetId,occurrenceDate,dueDate,cycleIndex,description,
    categoryId,accountId,amount,transactionCost,frequency,frequencyDetails,isGoal,isFlexible,
    goalPercentage,goalDirection,remainingCyclesTotal,isHistorical,sourceBudgetUpdatedAt,
    createdAt,updatedAt FROM budgetSnapshots`).all(),
});
const mergeDry = recipientLifecycleDryRun(
  mergeDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
const mergeResult = write(
  mergeDb,
  "merge",
  { sourceRecipientId: 1, targetRecipientId: 2 },
);
check("merge counts every supported reference", mergeDry.ok &&
  mergeDry.referenceCountsByEntity.transactions === 1 &&
  mergeDry.referenceCountsByEntity.budgets === 1 &&
  mergeDry.referenceCountsByEntity.budgetSnapshots === 1);
check("merge moves all exact references and deletes source", mergeResult.ok &&
  mergeResult.rowsChanged === 4 &&
  ["transactions", "budgets", "budgetSnapshots"].every((table) =>
    (mergeDb.prepare(`SELECT COUNT(*) count FROM ${table} WHERE recipientId=2`).get() as { count: number }).count === 1 &&
    (mergeDb.prepare(`SELECT COUNT(*) count FROM ${table} WHERE recipientId=1`).get() as { count: number }).count === 0) &&
  mergeDb.prepare("SELECT 1 FROM recipients WHERE id=1").get() === undefined);
check("merge preserves target and unrelated recipients", JSON.stringify(targetBefore) ===
  JSON.stringify(mergeDb.prepare("SELECT * FROM recipients WHERE id=2").get()) &&
  JSON.stringify(unrelatedBefore) ===
  JSON.stringify(mergeDb.prepare("SELECT * FROM recipients WHERE id=3").get()));
check("merge preserves financial report and Budget History inputs", financialBefore === JSON.stringify({
  transaction: mergeDb.prepare(`SELECT id,categoryId,accountId,date,amount,transactionCost,
    transferPairId,isTransfer,budgetId,occurrenceDate,budgetSnapshotId FROM transactions`).all(),
  budget: mergeDb.prepare(`SELECT id,description,categoryId,accountId,amount,transactionCost,
    frequency,frequencyDetails,isGoal,isFlexible,goalPercentage,goalDirection,isActive,
    remainingCyclesTotal,dueDate,createdAt,updatedAt FROM budgets`).all(),
  snapshot: mergeDb.prepare(`SELECT id,budgetId,occurrenceDate,dueDate,cycleIndex,description,
    categoryId,accountId,amount,transactionCost,frequency,frequencyDetails,isGoal,isFlexible,
    goalPercentage,goalDirection,remainingCyclesTotal,isHistorical,sourceBudgetUpdatedAt,
    createdAt,updatedAt FROM budgetSnapshots`).all(),
}));
const repeated = recipientLifecycleDryRun(
  mergeDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
check("repeated merge fails safely", !repeated.ok &&
  repeated.code === "source_recipient_not_found");
mergeDb.close();

const invalidDb = createDb();
addRecipient(invalidDb, 1);
addRecipient(invalidDb, 2);
check("source equals target fails safely", !recipientLifecycleDryRun(
  invalidDb,
  { sourceRecipientId: 1, targetRecipientId: 1 },
  "merge",
).ok);
check("missing source fails safely", !recipientLifecycleDryRun(
  invalidDb,
  { sourceRecipientId: 99, targetRecipientId: 2 },
  "merge",
).ok);
check("missing target fails safely", !recipientLifecycleDryRun(
  invalidDb,
  { sourceRecipientId: 1, targetRecipientId: 99 },
  "merge",
).ok);
invalidDb.close();

const staleDb = createDb();
addRecipient(staleDb, 1);
addRecipient(staleDb, 2);
const staleDry = recipientLifecycleDryRun(
  staleDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
addTransactionReference(staleDb, 1, 1);
const staleBefore = JSON.stringify({
  recipients: staleDb.prepare("SELECT * FROM recipients ORDER BY id").all(),
  transactions: staleDb.prepare("SELECT * FROM transactions ORDER BY id").all(),
});
const staleWrite = recipientLifecycleRealWrite(staleDb, {
  sourceRecipientId: 1,
  targetRecipientId: 2,
  dryRunReviewed: true,
  confirmation: RECIPIENT_LIFECYCLE_CONFIRMATIONS.merge,
  expectedPlanFingerprint: staleDry.planFingerprint,
}, "merge");
check("stale reference plan fails without mutation", staleWrite.code ===
  "recipient_lifecycle_plan_stale" && staleBefore === JSON.stringify({
    recipients: staleDb.prepare("SELECT * FROM recipients ORDER BY id").all(),
    transactions: staleDb.prepare("SELECT * FROM transactions ORDER BY id").all(),
  }));
staleDb.close();

const unsupportedDb = createDb();
addRecipient(unsupportedDb, 1);
addRecipient(unsupportedDb, 2);
unsupportedDb.exec("CREATE TABLE unsupportedLinks (id INTEGER PRIMARY KEY, recipientId INTEGER)");
unsupportedDb.prepare("INSERT INTO unsupportedLinks (id,recipientId) VALUES (1,1)").run();
const unsupported = recipientLifecycleDryRun(
  unsupportedDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
check("unsupported recipient reference location fails closed", !unsupported.ok &&
  unsupported.validationErrors.includes("unsupported_recipient_reference_location"));
unsupportedDb.close();

const malformedDb = createDb();
addRecipient(malformedDb, 1);
addRecipient(malformedDb, 2);
addBudgetReference(malformedDb, 1, 999);
const malformed = recipientLifecycleDryRun(
  malformedDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
check("malformed recipient reference fails closed", !malformed.ok &&
  malformed.validationErrors.includes("budgets_recipient_reference_malformed"));
malformedDb.close();

const rollbackDb = createDb();
addRecipient(rollbackDb, 1);
addRecipient(rollbackDb, 2);
addTransactionReference(rollbackDb, 1, 1);
const rollbackDry = recipientLifecycleDryRun(
  rollbackDb,
  { sourceRecipientId: 1, targetRecipientId: 2 },
  "merge",
);
rollbackDb.exec(`CREATE TRIGGER reject_source_delete BEFORE DELETE ON recipients
  WHEN OLD.id = 1 BEGIN SELECT RAISE(ABORT, 'synthetic_delete_failure'); END`);
let rollbackFailed = false;
try {
  recipientLifecycleRealWrite(rollbackDb, {
    sourceRecipientId: 1,
    targetRecipientId: 2,
    dryRunReviewed: true,
    confirmation: RECIPIENT_LIFECYCLE_CONFIRMATIONS.merge,
    expectedPlanFingerprint: rollbackDry.planFingerprint,
  }, "merge");
} catch {
  rollbackFailed = true;
}
check("source deletion failure rolls back reference updates atomically", rollbackFailed &&
  (rollbackDb.prepare("SELECT recipientId FROM transactions WHERE id=1").get() as { recipientId: number }).recipientId === 1 &&
  rollbackDb.prepare("SELECT 1 FROM recipients WHERE id=1").get() !== undefined);
rollbackDb.close();

for (const result of checks) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
const failed = checks.filter((result) => !result.ok).length;
console.log(`Recipient lifecycle checks: ${checks.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

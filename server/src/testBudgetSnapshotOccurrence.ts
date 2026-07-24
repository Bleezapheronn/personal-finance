import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS,
  budgetSnapshotOccurrenceDryRun,
  budgetSnapshotOccurrenceRealWrite,
  type BudgetSnapshotOccurrenceAction,
} from "./lib/budgetSnapshotOccurrence.js";
import {
  BUDGET_FROM_TRANSACTION_CONFIRMATION,
  budgetFromTransactionDryRun,
  budgetFromTransactionRealWrite,
} from "./lib/budgetFromTransaction.js";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY, description TEXT NOT NULL, categoryId INTEGER NOT NULL,
    paymentChannelId INTEGER,
    accountId INTEGER, recipientId INTEGER, amount REAL NOT NULL,
    transactionCost REAL, frequency TEXT NOT NULL, frequencyDetails TEXT,
    isGoal INTEGER NOT NULL, isFlexible INTEGER NOT NULL, goalPercentage REAL,
    goalDirection TEXT, isActive INTEGER NOT NULL, remainingCyclesTotal INTEGER,
    dueDate TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE budgetSnapshots (
    id INTEGER PRIMARY KEY, budgetId INTEGER NOT NULL, occurrenceDate TEXT NOT NULL,
    dueDate TEXT NOT NULL, cycleIndex INTEGER NOT NULL, description TEXT NOT NULL,
    categoryId INTEGER NOT NULL, accountId INTEGER, recipientId INTEGER,
    amount REAL NOT NULL, transactionCost REAL, frequency TEXT NOT NULL,
    frequencyDetails TEXT, isGoal INTEGER NOT NULL, isFlexible INTEGER NOT NULL,
    goalPercentage REAL, goalDirection TEXT, remainingCyclesTotal INTEGER,
    isHistorical INTEGER NOT NULL, sourceBudgetUpdatedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY, categoryId INTEGER NOT NULL, accountId INTEGER,
    recipientId INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL,
    description TEXT, transactionCost REAL, transferPairId INTEGER,
    isTransfer INTEGER, budgetId INTEGER, occurrenceDate TEXT,
    budgetSnapshotId INTEGER
  );
  CREATE TABLE buckets (id INTEGER PRIMARY KEY);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, bucketId INTEGER NOT NULL);
  CREATE TABLE accounts (id INTEGER PRIMARY KEY);
  CREATE TABLE recipients (id INTEGER PRIMARY KEY);
  CREATE TABLE paymentMethods (id INTEGER PRIMARY KEY);
  CREATE TABLE smsImportTemplates (id INTEGER PRIMARY KEY);
`);
db.exec(`
  INSERT INTO buckets (id) VALUES (1);
  INSERT INTO categories (id, bucketId) VALUES (10, 1);
  INSERT INTO accounts (id) VALUES (20);
  INSERT INTO recipients (id) VALUES (30);
`);

const now = "2026-07-24T00:00:00.000Z";
db.prepare(`INSERT INTO budgets (
  id, description, categoryId, accountId, recipientId, amount, transactionCost,
  frequency, frequencyDetails, isGoal, isFlexible, goalPercentage, goalDirection,
  isActive, remainingCyclesTotal, dueDate, createdAt, updatedAt
) VALUES (1, 'Monthly', 10, 20, 30, -100, -2, 'monthly',
  '{"dayOfMonth":15}', 0, 0, NULL, NULL, 1, NULL,
  '2026-07-15T00:00:00.000Z', @now, @now)`).run({ now });

const insertTransaction = db.prepare(`INSERT INTO transactions (
  id, categoryId, accountId, recipientId, date, amount, description,
  transactionCost, transferPairId, isTransfer, budgetId, occurrenceDate,
  budgetSnapshotId
) VALUES (
  @id, @categoryId, 20, 30, '2026-08-15T10:00:00.000Z', -100, @description,
  -2, NULL, 0, @budgetId, @occurrenceDate, @budgetSnapshotId
)`);
insertTransaction.run({
  id: 100,
  categoryId: 10,
  description: "Target",
  budgetId: null,
  occurrenceDate: null,
  budgetSnapshotId: null,
});
insertTransaction.run({
  id: 103,
  categoryId: 10,
  description: "Create Budget",
  budgetId: null,
  occurrenceDate: null,
  budgetSnapshotId: null,
});
insertTransaction.run({
  id: 101,
  categoryId: 99,
  description: "Mismatch",
  budgetId: null,
  occurrenceDate: null,
  budgetSnapshotId: null,
});

const reviewedWrite = (
  action: BudgetSnapshotOccurrenceAction,
  input: Record<string, unknown>,
) => {
  const dryRun = budgetSnapshotOccurrenceDryRun(db, input, action);
  assert.equal(dryRun.ok, true);
  assert.ok(dryRun.planFingerprint);
  return budgetSnapshotOccurrenceRealWrite(
    db,
    {
      ...input,
      dryRunReviewed: true,
      confirmation: BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS[action],
      expectedPlanFingerprint: dryRun.planFingerprint,
    },
    action,
  );
};

const createInput = {
  budgetId: 1,
  occurrenceDate: "2026-08-15",
};
const createResult = reviewedWrite("create", createInput);
assert.equal(createResult.sqliteMutated, true);
assert.equal(createResult.rowsChanged.budgetSnapshots, 1);
const snapshot = db
  .prepare("SELECT * FROM budgetSnapshots WHERE budgetId = 1")
  .get() as Record<string, unknown>;
assert.ok(snapshot);

const duplicateResult = reviewedWrite("create", createInput);
assert.equal(duplicateResult.sqliteMutated, false);
assert.equal(
  (
    db
      .prepare("SELECT COUNT(*) AS count FROM budgetSnapshots WHERE budgetId = 1")
      .get() as { count: number }
  ).count,
  1,
);

const beforeLink = db.prepare("SELECT * FROM transactions WHERE id = 100").get();
const linkResult = reviewedWrite("link", {
  snapshotId: Number(snapshot.id),
  transactionId: 100,
});
assert.equal(linkResult.rowsChanged.transactions, 1);
const afterLink = db.prepare("SELECT * FROM transactions WHERE id = 100").get() as
  Record<string, unknown>;
for (const [key, value] of Object.entries(beforeLink as Record<string, unknown>)) {
  if (!["budgetSnapshotId", "budgetId", "occurrenceDate"].includes(key)) {
    assert.deepEqual(afterLink[key], value);
  }
}
assert.equal(afterLink.budgetSnapshotId, snapshot.id);

const linkedDelete = budgetSnapshotOccurrenceDryRun(
  db,
  { snapshotId: Number(snapshot.id) },
  "delete",
);
assert.equal(linkedDelete.ok, false);
assert.ok(linkedDelete.validationErrors.includes("snapshot_linked"));

const unlinkResult = reviewedWrite("unlink", {
  transactionId: 100,
  snapshotId: Number(snapshot.id),
});
assert.equal(unlinkResult.rowsChanged.transactions, 1);
const afterUnlink = db.prepare("SELECT * FROM transactions WHERE id = 100").get() as
  Record<string, unknown>;
assert.equal(afterUnlink.budgetSnapshotId, null);
assert.equal(afterUnlink.budgetId, null);
assert.equal(afterUnlink.occurrenceDate, null);

insertTransaction.run({
  id: 102,
  categoryId: 10,
  description: "Legacy",
  budgetId: 1,
  occurrenceDate: "2026-08-15T00:00:00.000Z",
  budgetSnapshotId: null,
});
const ambiguousDelete = budgetSnapshotOccurrenceDryRun(
  db,
  { snapshotId: Number(snapshot.id) },
  "delete",
);
assert.equal(ambiguousDelete.ok, false);
assert.ok(
  ambiguousDelete.validationErrors.includes(
    "ambiguous_legacy_snapshot_reference",
  ),
);
db.prepare("DELETE FROM transactions WHERE id = 102").run();
const deleteResult = reviewedWrite("delete", {
  snapshotId: Number(snapshot.id),
});
assert.equal(deleteResult.rowsChanged.budgetSnapshots, 1);

const beforeRollbackCount = (
  db.prepare("SELECT COUNT(*) AS count FROM budgetSnapshots").get() as {
    count: number;
  }
).count;
const refusedAtomic = budgetSnapshotOccurrenceDryRun(
  db,
  {
    budgetId: 1,
    occurrenceDate: "2026-09-15",
    transactionId: 101,
  },
  "createAndLink",
);
assert.equal(refusedAtomic.ok, false);
assert.ok(
  refusedAtomic.validationErrors.includes("snapshot_category_mismatch"),
);
assert.equal(
  (
    db.prepare("SELECT COUNT(*) AS count FROM budgetSnapshots").get() as {
      count: number;
    }
  ).count,
  beforeRollbackCount,
);

const createAndLink = reviewedWrite("createAndLink", {
  budgetId: 1,
  occurrenceDate: "2026-09-15",
  transactionId: 100,
});
assert.equal(createAndLink.rowsChanged.budgetSnapshots, 1);
assert.equal(createAndLink.rowsChanged.transactions, 1);
reviewedWrite("create", {
  budgetId: 1,
  occurrenceDate: "2026-10-15",
});
const replacementSnapshot = db
  .prepare(
    "SELECT * FROM budgetSnapshots WHERE budgetId = 1 ORDER BY id DESC LIMIT 1",
  )
  .get() as Record<string, unknown>;
const currentSnapshotId = Number(
  (
    db.prepare("SELECT budgetSnapshotId FROM transactions WHERE id = 100").get() as {
      budgetSnapshotId: number;
    }
  ).budgetSnapshotId,
);
const changeResult = reviewedWrite("changeLink", {
  transactionId: 100,
  snapshotId: Number(replacementSnapshot.id),
  expectedCurrentSnapshotId: currentSnapshotId,
});
assert.equal(changeResult.rowsChanged.transactions, 1);
assert.equal(
  (
    db.prepare("SELECT budgetSnapshotId FROM transactions WHERE id = 100").get() as {
      budgetSnapshotId: number;
    }
  ).budgetSnapshotId,
  replacementSnapshot.id,
);

const fromTransactionInput = {
  definition: {
    description: "From transaction",
    categoryId: 10,
    accountId: 20,
    recipientId: 30,
    amount: -100,
    transactionCost: -2,
    frequency: "monthly",
    frequencyDetails: { dayOfMonth: 15 },
    isGoal: false,
    isFlexible: false,
    goalPercentage: null,
    goalDirection: null,
    remainingCyclesTotal: null,
    dueDate: "2026-10-15T00:00:00.000Z",
  },
  transactionId: 103,
  occurrenceDate: "2026-10-15",
};
const fromTransactionDryRun = budgetFromTransactionDryRun(
  db,
  fromTransactionInput,
);
assert.equal(fromTransactionDryRun.ok, true);
const fromTransactionWrite = budgetFromTransactionRealWrite(db, {
  ...fromTransactionInput,
  dryRunReviewed: true,
  confirmation: BUDGET_FROM_TRANSACTION_CONFIRMATION,
  expectedPlanFingerprint: fromTransactionDryRun.planFingerprint,
});
assert.equal(fromTransactionWrite.ok, true);
assert.deepEqual(fromTransactionWrite.rowsChanged, {
  budgets: 1,
  budgetSnapshots: 1,
  transactions: 1,
  total: 3,
});

db.close();
console.log("Budget snapshot occurrence lifecycle: PASS");
console.log("Checks: create, duplicate reuse, link, unlink, delete refusals, atomic link");

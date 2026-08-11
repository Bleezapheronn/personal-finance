import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { listBudgetSnapshots, listBudgets } from "./lib/budgets.js";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY, description TEXT NOT NULL, categoryId INTEGER NOT NULL,
    paymentChannelId INTEGER, accountId INTEGER, recipientId INTEGER, amount REAL NOT NULL,
    transactionCost REAL, frequency TEXT NOT NULL, frequencyDetails TEXT,
    isGoal INTEGER NOT NULL, isFlexible INTEGER NOT NULL, goalPercentage REAL,
    goalDirection TEXT, isActive INTEGER NOT NULL, remainingCyclesTotal INTEGER,
    dueDate TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE budgetSnapshots (
    id INTEGER PRIMARY KEY, budgetId INTEGER NOT NULL, occurrenceDate TEXT NOT NULL,
    dueDate TEXT NOT NULL, cycleIndex INTEGER NOT NULL, description TEXT NOT NULL,
    categoryId INTEGER NOT NULL, accountId INTEGER, recipientId INTEGER, amount REAL NOT NULL,
    transactionCost REAL, frequency TEXT NOT NULL, frequencyDetails TEXT,
    isGoal INTEGER NOT NULL, isFlexible INTEGER NOT NULL, goalPercentage REAL,
    goalDirection TEXT, remainingCyclesTotal INTEGER, isHistorical INTEGER NOT NULL,
    sourceBudgetUpdatedAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY, budgetId INTEGER, occurrenceDate TEXT, budgetSnapshotId INTEGER,
    amount REAL, transactionCost REAL
  );
`);
const now = "2026-08-11T00:00:00.000Z";
const insertBudget = db.prepare(`INSERT INTO budgets (
  id, description, categoryId, amount, frequency, isGoal, isFlexible, isActive,
  dueDate, createdAt, updatedAt
) VALUES (@id, @description, 1, -100, 'weekly', 0, 0, 0, @dueDate, @now, @now)`);
insertBudget.run({ id: 1, description: "Definition with history", dueDate: now, now });
insertBudget.run({ id: 2, description: "Empty definition", dueDate: "2026-08-12T00:00:00.000Z", now });
const insertSnapshot = db.prepare(`INSERT INTO budgetSnapshots (
  id, budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
  amount, frequency, isGoal, isFlexible, isHistorical, sourceBudgetUpdatedAt, createdAt, updatedAt
) VALUES (@id, 1, @date, @date, @id, 'Definition with history', 1, -100,
  'weekly', 0, 0, 1, @now, @now, @now)`);
for (let id = 1; id <= 501; id += 1) {
  insertSnapshot.run({ id, date: `2026-01-${String((id % 28) + 1).padStart(2, "0")}T00:00:00.000Z`, now });
}
db.prepare("INSERT INTO transactions (id, budgetId, occurrenceDate, budgetSnapshotId, amount, transactionCost) VALUES (1, 1, '2026-01-02T00:00:00.000Z', 1, -120, -5)").run();
db.prepare("INSERT INTO transactions (id, budgetId, occurrenceDate, budgetSnapshotId, amount, transactionCost) VALUES (2, 1, '2026-01-02T00:00:00.000Z', NULL, -50, NULL)").run();

const definitions = listBudgets(db, {
  limit: 10,
  offset: 0,
  filters: {},
  includeDefinitionDependencies: true,
});
const withHistory = definitions.rows.find((row) => Number(row.id) === 1)!;
assert.deepEqual(withHistory.definitionDependencySummary, {
  persistedOccurrenceCount: 501,
  transactionDependencyCount: 2,
});
const empty = definitions.rows.find((row) => Number(row.id) === 2)!;
assert.deepEqual(empty.definitionDependencySummary, {
  persistedOccurrenceCount: 0,
  transactionDependencyCount: 0,
});

const firstPage = listBudgetSnapshots(db, {
  limit: 500,
  offset: 0,
  filters: { budgetId: 1 },
  includeOccurrenceDependencies: true,
});
assert.equal(firstPage.count, 501);
assert.equal(firstPage.rows.length, 500);
const linkedOccurrence = firstPage.rows.find((row) => Number(row.id) === 1)!;
assert.deepEqual(linkedOccurrence.occurrenceDependencySummary, {
  linkedTransactionCount: 1,
  linkedTransactionTotal: -125,
  ambiguousLegacyReferenceCount: 1,
});
const secondPage = listBudgetSnapshots(db, {
  limit: 500,
  offset: 500,
  filters: { budgetId: 1 },
  includeOccurrenceDependencies: true,
});
assert.equal(secondPage.rows.length, 1);

db.close();
console.log("Budget definition read summaries passed.");

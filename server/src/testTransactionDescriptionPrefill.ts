import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getTransactionDescriptionPrefill } from "./lib/transactions.js";

const db = new Database(":memory:");
db.exec(`CREATE TABLE transactions (
  id INTEGER PRIMARY KEY, categoryId INTEGER, paymentChannelId INTEGER,
  accountId INTEGER, recipientId INTEGER, date TEXT, amount REAL,
  originalAmount REAL, originalCurrency TEXT, exchangeRate REAL,
  transactionReference TEXT, transactionCost REAL, description TEXT,
  transferPairId INTEGER, isTransfer INTEGER, budgetId INTEGER,
  occurrenceDate TEXT, budgetSnapshotId INTEGER
)`);

const insert = db.prepare(`INSERT INTO transactions
  (id, categoryId, accountId, recipientId, date, amount, description, transferPairId, isTransfer)
  VALUES (@id, @categoryId, @accountId, @recipientId, @date, @amount, @description, @transferPairId, @isTransfer)`);

insert.run({ id: 1, categoryId: 7, accountId: 10, recipientId: 20, date: "2026-07-01", amount: -50, description: " Ordinary ", transferPairId: null, isTransfer: 0 });
assert.deepEqual(getTransactionDescriptionPrefill(db, "Ordinary"), {
  transactionType: "expense", recipientId: 20, categoryId: 7, accountId: 10,
});

insert.run({ id: 2, categoryId: 8, accountId: 11, recipientId: 21, date: "2026-07-02", amount: -100, description: "Transfer", transferPairId: 3, isTransfer: 1 });
insert.run({ id: 3, categoryId: 8, accountId: 12, recipientId: 22, date: "2026-07-02", amount: 100, description: "Transfer", transferPairId: 2, isTransfer: 1 });
assert.deepEqual(getTransactionDescriptionPrefill(db, " Transfer "), {
  transactionType: "transfer", sourceRecipientId: 21, destinationRecipientId: 22,
  categoryId: 8, sourceAccountId: 11, destinationAccountId: 12,
});

insert.run({ id: 4, categoryId: 9, accountId: 13, recipientId: 23, date: "2026-07-03", amount: -100, description: "Transfer", transferPairId: 999, isTransfer: 1 });
assert.deepEqual(getTransactionDescriptionPrefill(db, "Transfer"), {
  transactionType: "transfer", sourceRecipientId: 21, destinationRecipientId: 22,
  categoryId: 8, sourceAccountId: 11, destinationAccountId: 12,
});

db.close();
console.log("transaction description prefill tests passed");

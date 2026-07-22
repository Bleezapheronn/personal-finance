import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  TRANSACTION_DELETE_WRITE_CONFIRMATION,
  transactionDeleteDisabledResponse,
  transactionDeleteDryRun,
  transactionDeleteRealWrite,
} from "./lib/transactionDelete.js";

interface TestCase {
  name: string;
  run: () => void;
}

const schema = readFileSync(
  new URL("../schema/prototype-schema.sql", import.meta.url),
  "utf8",
);
const now = "2026-07-22T00:00:00.000Z";

function expect(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

const database = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec(`
    INSERT INTO buckets VALUES (1, 'bucket', NULL, 0, 100, NULL, 1, 1, 0, '${now}', '${now}');
    INSERT INTO categories VALUES (1, 'category', 1, NULL, 1, '${now}', '${now}');
    INSERT INTO accounts (id, name, isActive, isCredit, createdAt, updatedAt)
      VALUES (1, 'a', 1, 0, '${now}', '${now}'), (2, 'b', 1, 0, '${now}', '${now}');
    INSERT INTO recipients (id, name, isActive, createdAt, updatedAt)
      VALUES (1, 'r', 1, '${now}', '${now}');
  `);
  return db;
};

const insertOrdinary = (
  db: Database.Database,
  overrides: Partial<Record<string, unknown>> = {},
): number => {
  const value = {
    id: 10,
    categoryId: 1,
    accountId: 1,
    recipientId: 1,
    date: now,
    amount: -25,
    transactionCost: null,
    description: "test",
    transferPairId: null,
    isTransfer: 0,
    budgetId: null,
    occurrenceDate: null,
    budgetSnapshotId: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO transactions
      (id, categoryId, accountId, recipientId, date, amount, transactionCost,
       description, transferPairId, isTransfer, budgetId, occurrenceDate,
       budgetSnapshotId)
     VALUES
      (@id, @categoryId, @accountId, @recipientId, @date, @amount,
       @transactionCost, @description, @transferPairId, @isTransfer, @budgetId,
       @occurrenceDate, @budgetSnapshotId)`,
  ).run(value);
  return Number(value.id);
};

const insertTransfer = (
  db: Database.Database,
  options: { cost?: number | null; sourceAccountId?: number; destinationAmount?: number } = {},
): [number, number] => {
  const sourceId = 20;
  const destinationId = 21;
  const statement = db.prepare(
    `INSERT INTO transactions
      (id, categoryId, accountId, recipientId, date, amount, transactionCost,
       description, transferPairId, isTransfer)
     VALUES
      (@id, 1, @accountId, 1, @date, @amount, @transactionCost, 'transfer',
       @transferPairId, 1)`,
  );
  statement.run({
    id: sourceId,
    accountId: options.sourceAccountId ?? 1,
    date: now,
    amount: -40,
    transactionCost: options.cost ?? null,
    transferPairId: destinationId,
  });
  statement.run({
    id: destinationId,
    accountId: 2,
    date: now,
    amount: options.destinationAmount ?? 40,
    transactionCost: null,
    transferPairId: sourceId,
  });
  return [sourceId, destinationId];
};

const writeFromPlan = (db: Database.Database, id: number) => {
  const plan = transactionDeleteDryRun(db, { id });
  expect(plan.planFingerprint, "plan_fingerprint_missing");
  return transactionDeleteRealWrite(db, {
    id,
    expectedPlanFingerprint: plan.planFingerprint,
    dryRunReviewed: true,
    confirmation: TRANSACTION_DELETE_WRITE_CONFIRMATION,
  });
};

const count = (db: Database.Database, table = "transactions"): number =>
  Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
      .count,
  );

const tests: TestCase[] = [
  {
    name: "ordinary transaction deletes one row",
    run: () => {
      const db = database();
      insertOrdinary(db);
      const result = writeFromPlan(db, 10);
      expect(result.rowsChanged === 1 && count(db) === 0, "ordinary_delete_failed");
      db.close();
    },
  },
  {
    name: "ordinary transaction cost is eligible",
    run: () => {
      const db = database();
      insertOrdinary(db, { transactionCost: -2 });
      const plan = transactionDeleteDryRun(db, { id: 10 });
      expect(plan.transactionCostPresent, "cost_not_reported");
      expect(writeFromPlan(db, 10).rowsChanged === 1, "cost_delete_failed");
      db.close();
    },
  },
  {
    name: "linked snapshot remains unchanged",
    run: () => {
      const db = database();
      db.exec(`
        INSERT INTO budgets VALUES (1, 'b', 1, NULL, 1, 1, -25, NULL, 'once', NULL, 0, 0, NULL, NULL, 1, NULL, '${now}', '${now}', '${now}');
        INSERT INTO budgetSnapshots VALUES (1, 1, '${now}', '${now}', 0, 's', 1, 1, 1, -25, NULL, 'once', NULL, 0, 0, NULL, NULL, NULL, 1, '${now}', '${now}', '${now}');
      `);
      insertOrdinary(db, { budgetId: 1, occurrenceDate: now, budgetSnapshotId: 1 });
      expect(writeFromPlan(db, 10).rowsChanged === 1, "linked_delete_failed");
      expect(count(db, "budgets") === 1 && count(db, "budgetSnapshots") === 1, "snapshot_changed");
      db.close();
    },
  },
  {
    name: "valid reciprocal transfer deletes two rows",
    run: () => {
      const db = database();
      insertTransfer(db);
      expect(writeFromPlan(db, 21).rowsChanged === 2 && count(db) === 0, "pair_delete_failed");
      db.close();
    },
  },
  {
    name: "source-side transfer cost is eligible",
    run: () => {
      const db = database();
      insertTransfer(db, { cost: -1 });
      const plan = transactionDeleteDryRun(db, { id: 20 });
      expect(plan.transactionCostPresent && plan.ok, "transfer_cost_rejected");
      db.close();
    },
  },
  {
    name: "missing target fails safely",
    run: () => {
      const db = database();
      const result = transactionDeleteDryRun(db, { id: 999 });
      expect(!result.ok && result.code === "transaction_not_found", "missing_target_accepted");
      db.close();
    },
  },
  {
    name: "missing pair partner fails safely",
    run: () => {
      const db = database();
      insertOrdinary(db, { isTransfer: 1, transferPairId: 11 });
      expect(!transactionDeleteDryRun(db, { id: 10 }).ok, "missing_pair_accepted");
      db.close();
    },
  },
  {
    name: "self-reference fails safely",
    run: () => {
      const db = database();
      insertOrdinary(db, { isTransfer: 1, transferPairId: 10 });
      expect(!transactionDeleteDryRun(db, { id: 10 }).ok, "self_pair_accepted");
      db.close();
    },
  },
  {
    name: "third inbound pair reference fails safely",
    run: () => {
      const db = database();
      insertTransfer(db);
      insertOrdinary(db, { id: 22, transferPairId: 20 });
      expect(!transactionDeleteDryRun(db, { id: 20 }).ok, "third_pair_accepted");
      db.close();
    },
  },
  {
    name: "same-account transfer fails safely",
    run: () => {
      const db = database();
      insertTransfer(db, { sourceAccountId: 2 });
      expect(!transactionDeleteDryRun(db, { id: 20 }).ok, "same_account_accepted");
      db.close();
    },
  },
  {
    name: "unbalanced transfer fails safely",
    run: () => {
      const db = database();
      insertTransfer(db, { destinationAmount: 39 });
      expect(!transactionDeleteDryRun(db, { id: 20 }).ok, "unbalanced_pair_accepted");
      db.close();
    },
  },
  {
    name: "disabled response is non-mutating",
    run: () => {
      const result = transactionDeleteDisabledResponse();
      expect(!result.ok && !result.sqliteMutated, "disabled_response_invalid");
    },
  },
  {
    name: "stale dry-run plan fails without mutation",
    run: () => {
      const db = database();
      insertOrdinary(db);
      const plan = transactionDeleteDryRun(db, { id: 10 });
      db.prepare("UPDATE transactions SET amount = -26 WHERE id = 10").run();
      const result = transactionDeleteRealWrite(db, {
        id: 10,
        expectedPlanFingerprint: plan.planFingerprint,
        dryRunReviewed: true,
        confirmation: TRANSACTION_DELETE_WRITE_CONFIRMATION,
      });
      expect(result.code === "transaction_delete_plan_stale" && count(db) === 1, "stale_plan_mutated");
      db.close();
    },
  },
  {
    name: "boundary verification failure rolls back atomically",
    run: () => {
      const db = database();
      insertOrdinary(db);
      db.exec(`CREATE TRIGGER mutate_account_after_transaction_delete
        AFTER DELETE ON transactions BEGIN
          UPDATE accounts SET isActive = 0 WHERE id = 1;
        END;`);
      let failed = false;
      try {
        writeFromPlan(db, 10);
      } catch {
        failed = true;
      }
      const account = db.prepare("SELECT isActive FROM accounts WHERE id = 1").get() as { isActive: number };
      expect(failed && count(db) === 1 && account.isActive === 1, "rollback_failed");
      db.close();
    },
  },
];

let failed = 0;
console.log("Transaction deletion focused tests:");
for (const test of tests) {
  try {
    test.run();
    console.log(`  PASS ${test.name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `  FAIL ${test.name} (${error instanceof Error ? error.message : "unknown_error"})`,
    );
  }
}
console.log(`Total: ${tests.length}`);
console.log(`Passed: ${tests.length - failed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;

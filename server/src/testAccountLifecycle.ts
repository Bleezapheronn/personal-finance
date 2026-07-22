import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  ACCOUNT_LIFECYCLE_CONFIRMATIONS,
  accountLifecycleDryRun,
  accountLifecycleRealWrite,
} from "./lib/accountLifecycle.js";

const schema = readFileSync(new URL("../schema/prototype-schema.sql", import.meta.url), "utf8");
let passed = 0;
let failed = 0;
const expect = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const test = (name: string, run: () => void): void => {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : "unknown"}`);
  }
};

const createDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO buckets
    (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (1,'b',0,100,1,1,0,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,isActive,createdAt,updatedAt)
    VALUES (1,'c',1,1,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO recipients
    (id,name,isActive,createdAt,updatedAt)
    VALUES (1,'r',1,'2026-01-01','2026-01-01')`).run();
  addAccount(db, 1, "KES", 0);
  addAccount(db, 2, "KES", 0);
  addAccount(db, 3, "KES", 0);
  return db;
};

const addAccount = (
  db: Database.Database,
  id: number,
  currency = "KES",
  isCredit = 0,
): void => {
  db.prepare(`INSERT INTO accounts
    (id,name,currency,isActive,isCredit,creditLimit,createdAt,updatedAt)
    VALUES (@id,@name,@currency,1,@isCredit,NULL,'2026-01-01','2026-01-01')`)
    .run({ id, name: `account-${id}`, currency, isCredit });
};

const addTransaction = (
  db: Database.Database,
  id: number,
  accountId: number,
  amount: number,
  options: { pairId?: number; isTransfer?: number; cost?: number | null } = {},
): void => {
  db.prepare(`INSERT INTO transactions
    (id,categoryId,accountId,recipientId,date,amount,transactionCost,description,
     transferPairId,isTransfer)
    VALUES (@id,1,@accountId,1,'2026-01-02T10:00:00.000Z',@amount,@cost,'transfer',
      @pairId,@isTransfer)`)
    .run({ id, accountId, amount, cost: options.cost ?? null,
      pairId: options.pairId ?? null, isTransfer: options.isTransfer ?? 0 });
};

const addTransfer = (
  db: Database.Database,
  sourceAccountId: number,
  targetAccountId: number,
  sourceId = 10,
  targetId = 11,
): void => {
  addTransaction(db, sourceId, sourceAccountId, -100, { pairId: targetId, isTransfer: 1, cost: -2 });
  addTransaction(db, targetId, targetAccountId, 100, { pairId: sourceId, isTransfer: 1 });
};

const writePayload = (
  action: "delete" | "merge",
  ids: Record<string, number>,
  planFingerprint: string,
) => ({
  ...ids,
  dryRunReviewed: true,
  confirmation: ACCOUNT_LIFECYCLE_CONFIRMATIONS[action],
  expectedPlanFingerprint: planFingerprint,
});

test("active unused account deletes safely", () => {
  const db = createDb();
  const dry = accountLifecycleDryRun(db, { accountId: 1 }, "delete");
  expect(dry.eligible && typeof dry.planFingerprint === "string", "delete_not_eligible");
  const result = accountLifecycleRealWrite(db,
    writePayload("delete", { accountId: 1 }, dry.planFingerprint!), "delete");
  expect(result.ok && result.rowsChanged === 1, "delete_failed");
  expect(!db.prepare("SELECT 1 FROM accounts WHERE id=1").get(), "account_remains");
  db.close();
});

test("inactive unused account deletes safely", () => {
  const db = createDb();
  db.prepare("UPDATE accounts SET isActive=0 WHERE id=1").run();
  const dry = accountLifecycleDryRun(db, { accountId: 1 }, "delete");
  expect(dry.eligible, "inactive_delete_not_eligible");
  db.close();
});

for (const [name, seed] of [
  ["transactions", (db: Database.Database) => addTransaction(db, 1, 1, -10)],
  ["budgets", (db: Database.Database) => db.prepare(`INSERT INTO budgets
    (id,description,categoryId,accountId,amount,frequency,isGoal,isFlexible,isActive,dueDate,createdAt,updatedAt)
    VALUES (1,'b',1,1,-1,'once',0,0,1,'2026-01-02','2026-01-01','2026-01-01')`).run()],
  ["budgetSnapshots", (db: Database.Database) => db.prepare(`INSERT INTO budgetSnapshots
    (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,amount,
     frequency,isGoal,isFlexible,isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt)
    VALUES (1,99,'2026-01-02','2026-01-02',0,'s',1,1,-1,'once',0,0,1,
      '2026-01-01','2026-01-01','2026-01-01')`).run()],
  ["smsImportTemplates", (db: Database.Database) => db.prepare(`INSERT INTO smsImportTemplates
    (id,name,accountId,isActive,createdAt,updatedAt)
    VALUES (1,'s',1,1,'2026-01-01','2026-01-01')`).run()],
  ["paymentMethods", (db: Database.Database) => db.prepare(`INSERT INTO paymentMethods
    (id,accountId,name,isActive,createdAt,updatedAt)
    VALUES (1,1,'p',1,'2026-01-01','2026-01-01')`).run()],
] as Array<[string, (db: Database.Database) => void]>) {
  test(`referenced account deletion refuses ${name}`, () => {
    const db = createDb();
    seed(db);
    const dry = accountLifecycleDryRun(db, { accountId: 1 }, "delete");
    expect(!dry.eligible && dry.referenceCountsByEntity[name as keyof typeof dry.referenceCountsByEntity] === 1,
      "reference_not_reported");
    expect(Boolean(db.prepare("SELECT 1 FROM accounts WHERE id=1").get()), "dry_run_mutated");
    db.close();
  });
}

test("compatible zero-reference merge preserves target", () => {
  const db = createDb();
  const targetBefore = db.prepare("SELECT * FROM accounts WHERE id=2").get();
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  const result = accountLifecycleRealWrite(db,
    writePayload("merge", { sourceAccountId: 1, targetAccountId: 2 }, dry.planFingerprint!), "merge");
  expect(result.ok && result.rowsChanged === 1, "merge_failed");
  expect(JSON.stringify(db.prepare("SELECT * FROM accounts WHERE id=2").get()) === JSON.stringify(targetBefore),
    "target_changed");
  db.close();
});

test("merge migrates all exact account references and preserves legacy IDs", () => {
  const db = createDb();
  addTransaction(db, 1, 1, -10);
  db.prepare(`INSERT INTO budgets
    (id,description,categoryId,paymentChannelId,accountId,amount,frequency,isGoal,isFlexible,isActive,dueDate,createdAt,updatedAt)
    VALUES (1,'b',1,7,1,-1,'once',0,0,1,'2026-01-02','2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO budgetSnapshots
    (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,amount,
     frequency,isGoal,isFlexible,isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt)
    VALUES (1,1,'2026-01-02','2026-01-02',0,'s',1,1,-1,'once',0,0,1,
      '2026-01-01','2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO paymentMethods
    (id,accountId,name,isActive,createdAt,updatedAt) VALUES (7,1,'p',1,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO smsImportTemplates
    (id,name,paymentMethodId,accountId,isActive,createdAt,updatedAt)
    VALUES (1,'s',7,1,1,'2026-01-01','2026-01-01')`).run();
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(dry.sourceReferenceCount === 5, "reference_count_invalid");
  const result = accountLifecycleRealWrite(db,
    writePayload("merge", { sourceAccountId: 1, targetAccountId: 2 }, dry.planFingerprint!), "merge");
  expect(result.ok && result.rowsChanged === 6, "merge_count_invalid");
  for (const table of ["transactions", "budgets", "budgetSnapshots", "smsImportTemplates", "paymentMethods"]) {
    expect((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE accountId=1`).get() as { count: number }).count === 0,
      `${table}_source_reference_remains`);
  }
  const legacy = db.prepare("SELECT paymentChannelId FROM budgets WHERE id=1").get() as Row;
  const template = db.prepare("SELECT paymentMethodId FROM smsImportTemplates WHERE id=1").get() as Row;
  expect(legacy.paymentChannelId === 7 && template.paymentMethodId === 7, "legacy_ids_changed");
  db.close();
});

test("compatible third-account transfer remains valid", () => {
  const db = createDb();
  addTransfer(db, 1, 3);
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(dry.eligible && dry.affectedTransferPairCount === 1, "transfer_merge_not_eligible");
  const result = accountLifecycleRealWrite(db,
    writePayload("merge", { sourceAccountId: 1, targetAccountId: 2 }, dry.planFingerprint!), "merge");
  expect(result.ok, "transfer_merge_failed");
  const accounts = db.prepare("SELECT accountId FROM transactions ORDER BY id").all() as Array<{ accountId: number }>;
  expect(accounts[0].accountId === 2 && accounts[1].accountId === 3, "transfer_accounts_invalid");
  db.close();
});

test("direct source-target transfer blocks merge", () => {
  const db = createDb();
  addTransfer(db, 1, 2);
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.transferConflicts.includes("transfer_accounts_must_differ"),
    "self_transfer_not_blocked");
  db.close();
});

test("malformed affected transfer blocks merge", () => {
  const db = createDb();
  addTransaction(db, 10, 1, -100, { pairId: 99, isTransfer: 1 });
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.transferConflicts.length > 0, "malformed_transfer_not_blocked");
  db.close();
});

test("currency mismatch blocks merge", () => {
  const db = createDb();
  db.prepare("UPDATE accounts SET currency='USD' WHERE id=2").run();
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.validationErrors.includes("account_currency_mismatch"), "currency_allowed");
  db.close();
});

test("credit classification mismatch blocks merge", () => {
  const db = createDb();
  db.prepare("UPDATE accounts SET isCredit=1 WHERE id=2").run();
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.validationErrors.includes("account_classification_mismatch"), "type_allowed");
  db.close();
});

test("same and missing accounts fail safely", () => {
  const db = createDb();
  expect(!accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 1 }, "merge").eligible,
    "same_allowed");
  expect(!accountLifecycleDryRun(db, { sourceAccountId: 99, targetAccountId: 2 }, "merge").sourcePresent,
    "missing_source_present");
  expect(!accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 99 }, "merge").targetPresent,
    "missing_target_present");
  db.close();
});

test("stale plan fails without mutation", () => {
  const db = createDb();
  const dry = accountLifecycleDryRun(db, { accountId: 1 }, "delete");
  addTransaction(db, 1, 1, -10);
  const result = accountLifecycleRealWrite(db,
    writePayload("delete", { accountId: 1 }, dry.planFingerprint!), "delete");
  expect(!result.ok && result.code === "account_lifecycle_plan_stale", "stale_plan_allowed");
  expect(Boolean(db.prepare("SELECT 1 FROM accounts WHERE id=1").get()), "stale_plan_mutated");
  db.close();
});

test("unsupported account reference location fails closed", () => {
  const db = createDb();
  db.exec("CREATE TABLE unsupportedLinks (id INTEGER PRIMARY KEY, accountId INTEGER)");
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.validationErrors.includes("unsupported_account_reference_location"),
    "unsupported_reference_allowed");
  db.close();
});

test("malformed account reference fails closed", () => {
  const db = createDb();
  addTransaction(db, 1, 99, -10);
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  expect(!dry.eligible && dry.validationErrors.includes("transactions_account_reference_malformed"),
    "malformed_reference_allowed");
  db.close();
});

test("financial totals remain global and balances consolidate", () => {
  const db = createDb();
  addTransaction(db, 1, 1, -100, { cost: -5 });
  addTransaction(db, 2, 2, 40);
  const total = () => (db.prepare("SELECT SUM(amount + COALESCE(transactionCost,0)) total FROM transactions")
    .get() as { total: number }).total;
  const balance = (id: number) => (db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(transactionCost,0)),0) total
    FROM transactions WHERE accountId=@id`).get({ id }) as { total: number }).total;
  const globalBefore = total();
  const expectedTarget = balance(1) + balance(2);
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  const result = accountLifecycleRealWrite(db,
    writePayload("merge", { sourceAccountId: 1, targetAccountId: 2 }, dry.planFingerprint!), "merge");
  expect(result.ok && total() === globalBefore && balance(2) === expectedTarget, "financial_invariance_failed");
  db.close();
});

test("boundary failure rolls back reference migration and deletion", () => {
  const db = createDb();
  addTransaction(db, 1, 1, -10);
  db.exec(`CREATE TRIGGER account_delete_side_effect AFTER DELETE ON accounts
    BEGIN UPDATE categories SET name='changed' WHERE id=1; END`);
  const dry = accountLifecycleDryRun(db, { sourceAccountId: 1, targetAccountId: 2 }, "merge");
  let threw = false;
  try {
    accountLifecycleRealWrite(db,
      writePayload("merge", { sourceAccountId: 1, targetAccountId: 2 }, dry.planFingerprint!), "merge");
  } catch {
    threw = true;
  }
  expect(threw, "boundary_failure_did_not_throw");
  expect(Boolean(db.prepare("SELECT 1 FROM accounts WHERE id=1").get()), "source_not_rolled_back");
  expect((db.prepare("SELECT accountId FROM transactions WHERE id=1").get() as { accountId: number }).accountId === 1,
    "reference_not_rolled_back");
  expect((db.prepare("SELECT name FROM categories WHERE id=1").get() as { name: string }).name === "c",
    "side_effect_not_rolled_back");
  db.close();
});

console.log(`Account lifecycle checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

type Row = Record<string, unknown>;

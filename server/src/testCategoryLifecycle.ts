import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  CATEGORY_LIFECYCLE_CONFIRMATIONS,
  categoryLifecycleDryRun,
  categoryLifecycleRealWrite,
} from "./lib/categoryLifecycle.js";

const schema = readFileSync(
  new URL("../schema/prototype-schema.sql", import.meta.url),
  "utf8",
);
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
    console.error(
      `FAIL ${name}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
};

const addCategory = (
  db: Database.Database,
  id: number,
  bucketId = 1,
  isActive = 1,
): void => {
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,description,isActive,createdAt,updatedAt)
    VALUES (@id,@name,@bucketId,@description,@isActive,'2026-01-01','2026-01-01')`)
    .run({ id, name: `category-${id}`, bucketId, description: `description-${id}`, isActive });
};

const createDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO buckets
    (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (1,'bucket-1',0,100,1,1,0,'2026-01-01','2026-01-01'),
           (2,'bucket-2',0,100,1,2,0,'2026-01-01','2026-01-01')`).run();
  addCategory(db, 1);
  addCategory(db, 2);
  addCategory(db, 3, 2);
  db.prepare(`INSERT INTO accounts
    (id,name,currency,isActive,isCredit,createdAt,updatedAt)
    VALUES (1,'account','KES',1,0,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO recipients
    (id,name,isActive,createdAt,updatedAt)
    VALUES (1,'recipient',1,'2026-01-01','2026-01-01')`).run();
  return db;
};

const addTransaction = (
  db: Database.Database,
  id: number,
  categoryId: number,
  amount = -100,
): void => {
  db.prepare(`INSERT INTO transactions
    (id,categoryId,accountId,recipientId,date,amount,transactionCost,description,isTransfer)
    VALUES (@id,@categoryId,1,1,'2026-01-02T10:00:00.000Z',@amount,-2,'transaction',0)`)
    .run({ id, categoryId, amount });
};

const addBudget = (
  db: Database.Database,
  id: number,
  categoryId: number,
): void => {
  db.prepare(`INSERT INTO budgets
    (id,description,categoryId,accountId,recipientId,amount,transactionCost,frequency,
     isGoal,isFlexible,isActive,dueDate,createdAt,updatedAt)
    VALUES (@id,'budget',@categoryId,1,1,-50,-1,'once',0,0,1,
      '2026-01-02','2026-01-01','2026-01-01')`).run({ id, categoryId });
};

const addSnapshot = (
  db: Database.Database,
  id: number,
  categoryId: number,
): void => {
  db.prepare(`INSERT INTO budgetSnapshots
    (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,accountId,
     recipientId,amount,transactionCost,frequency,isGoal,isFlexible,isHistorical,
     sourceBudgetUpdatedAt,createdAt,updatedAt)
    VALUES (@id,99,'2026-01-02','2026-01-02',0,'snapshot',@categoryId,1,1,-50,-1,
      'once',0,0,1,'2026-01-01','2026-01-01','2026-01-01')`).run({ id, categoryId });
};

const writePayload = (
  action: "delete" | "merge",
  ids: Record<string, number>,
  planFingerprint: string,
) => ({
  ...ids,
  dryRunReviewed: true,
  confirmation: CATEGORY_LIFECYCLE_CONFIRMATIONS[action],
  expectedPlanFingerprint: planFingerprint,
});

test("active unused category deletes safely", () => {
  const db = createDb();
  const dry = categoryLifecycleDryRun(db, { categoryId: 1 }, "delete");
  expect(dry.eligible && typeof dry.planFingerprint === "string", "delete_not_eligible");
  const result = categoryLifecycleRealWrite(
    db,
    writePayload("delete", { categoryId: 1 }, dry.planFingerprint!),
    "delete",
  );
  expect(result.ok && result.rowsChanged === 1, "delete_failed");
  expect(!db.prepare("SELECT 1 FROM categories WHERE id=1").get(), "category_remains");
  db.close();
});

test("inactive unused category deletes safely", () => {
  const db = createDb();
  db.prepare("UPDATE categories SET isActive=0 WHERE id=1").run();
  expect(categoryLifecycleDryRun(db, { categoryId: 1 }, "delete").eligible,
    "inactive_delete_not_eligible");
  db.close();
});

for (const [name, seed] of [
  ["transactions", (db: Database.Database) => addTransaction(db, 1, 1)],
  ["budgets", (db: Database.Database) => addBudget(db, 1, 1)],
  ["budgetSnapshots", (db: Database.Database) => addSnapshot(db, 1, 1)],
] as Array<[string, (db: Database.Database) => void]>) {
  test(`referenced category deletion refuses ${name}`, () => {
    const db = createDb();
    seed(db);
    const dry = categoryLifecycleDryRun(db, { categoryId: 1 }, "delete");
    expect(!dry.eligible, "referenced_delete_allowed");
    expect(
      dry.referenceCountsByEntity[
        name as keyof typeof dry.referenceCountsByEntity
      ] === 1,
      "reference_not_reported",
    );
    expect(Boolean(db.prepare("SELECT 1 FROM categories WHERE id=1").get()),
      "dry_run_mutated");
    db.close();
  });
}

test("same-bucket zero-reference merge preserves target", () => {
  const db = createDb();
  const targetBefore = db.prepare("SELECT * FROM categories WHERE id=2").get();
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  const result = categoryLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceCategoryId: 1, targetCategoryId: 2 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(result.ok && result.rowsChanged === 1, "merge_failed");
  expect(
    JSON.stringify(db.prepare("SELECT * FROM categories WHERE id=2").get()) ===
      JSON.stringify(targetBefore),
    "target_changed",
  );
  db.close();
});

test("merge migrates every exact category reference", () => {
  const db = createDb();
  addTransaction(db, 1, 1);
  addBudget(db, 1, 1);
  addSnapshot(db, 1, 1);
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  expect(dry.sourceReferenceCount === 3, "reference_count_invalid");
  const result = categoryLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceCategoryId: 1, targetCategoryId: 2 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(result.ok && result.rowsChanged === 4, "merge_count_invalid");
  for (const table of ["transactions", "budgets", "budgetSnapshots"]) {
    const count = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE categoryId=1`)
      .get() as { count: number };
    expect(count.count === 0, `${table}_source_reference_remains`);
  }
  db.close();
});

test("cross-bucket merge fails closed", () => {
  const db = createDb();
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 3 },
    "merge",
  );
  expect(!dry.eligible && dry.validationErrors.includes("category_bucket_mismatch"),
    "cross_bucket_merge_allowed");
  db.close();
});

test("same and missing categories fail safely", () => {
  const db = createDb();
  expect(
    !categoryLifecycleDryRun(
      db,
      { sourceCategoryId: 1, targetCategoryId: 1 },
      "merge",
    ).eligible,
    "same_category_allowed",
  );
  expect(
    !categoryLifecycleDryRun(
      db,
      { sourceCategoryId: 99, targetCategoryId: 2 },
      "merge",
    ).sourcePresent,
    "missing_source_present",
  );
  expect(
    !categoryLifecycleDryRun(
      db,
      { sourceCategoryId: 1, targetCategoryId: 99 },
      "merge",
    ).targetPresent,
    "missing_target_present",
  );
  db.close();
});

test("stale plan fails without mutation", () => {
  const db = createDb();
  const dry = categoryLifecycleDryRun(db, { categoryId: 1 }, "delete");
  addTransaction(db, 1, 1);
  const result = categoryLifecycleRealWrite(
    db,
    writePayload("delete", { categoryId: 1 }, dry.planFingerprint!),
    "delete",
  );
  expect(!result.ok && result.code === "category_lifecycle_plan_stale",
    "stale_plan_allowed");
  expect(Boolean(db.prepare("SELECT 1 FROM categories WHERE id=1").get()),
    "stale_plan_mutated");
  db.close();
});

test("unsupported category reference location fails closed", () => {
  const db = createDb();
  db.exec("CREATE TABLE unsupportedLinks (id INTEGER PRIMARY KEY, categoryId INTEGER)");
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("unsupported_category_reference_location"),
    "unsupported_reference_allowed",
  );
  db.close();
});

test("malformed category reference fails closed", () => {
  const db = createDb();
  addTransaction(db, 1, 99);
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("transactions_category_reference_malformed"),
    "malformed_reference_allowed",
  );
  db.close();
});

test("financial totals remain stable and category grouping consolidates", () => {
  const db = createDb();
  addTransaction(db, 1, 1, -100);
  addTransaction(db, 2, 2, -40);
  const globalTotal = () =>
    (db
      .prepare("SELECT SUM(amount + COALESCE(transactionCost,0)) AS total FROM transactions")
      .get() as { total: number }).total;
  const categoryTotal = (categoryId: number) =>
    (db
      .prepare(`SELECT COALESCE(SUM(amount + COALESCE(transactionCost,0)),0) AS total
        FROM transactions WHERE categoryId=@categoryId`)
      .get({ categoryId }) as { total: number }).total;
  const before = globalTotal();
  const expectedTarget = categoryTotal(1) + categoryTotal(2);
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  const result = categoryLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceCategoryId: 1, targetCategoryId: 2 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(result.ok && globalTotal() === before && categoryTotal(2) === expectedTarget,
    "report_invariance_failed");
  db.close();
});

test("boundary failure rolls back references and source deletion", () => {
  const db = createDb();
  addTransaction(db, 1, 1);
  db.exec(`CREATE TRIGGER category_delete_side_effect AFTER DELETE ON categories
    BEGIN UPDATE accounts SET name='changed' WHERE id=1; END`);
  const dry = categoryLifecycleDryRun(
    db,
    { sourceCategoryId: 1, targetCategoryId: 2 },
    "merge",
  );
  let threw = false;
  try {
    categoryLifecycleRealWrite(
      db,
      writePayload(
        "merge",
        { sourceCategoryId: 1, targetCategoryId: 2 },
        dry.planFingerprint!,
      ),
      "merge",
    );
  } catch {
    threw = true;
  }
  expect(threw, "boundary_failure_did_not_throw");
  expect(Boolean(db.prepare("SELECT 1 FROM categories WHERE id=1").get()),
    "source_not_rolled_back");
  expect(
    (db.prepare("SELECT categoryId FROM transactions WHERE id=1").get() as {
      categoryId: number;
    }).categoryId === 1,
    "reference_not_rolled_back",
  );
  expect(
    (db.prepare("SELECT name FROM accounts WHERE id=1").get() as { name: string })
      .name === "account",
    "side_effect_not_rolled_back",
  );
  db.close();
});

console.log(`Category lifecycle checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

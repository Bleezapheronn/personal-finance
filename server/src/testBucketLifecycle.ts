import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  BUCKET_LIFECYCLE_CONFIRMATIONS,
  bucketLifecycleDryRun,
  bucketLifecycleRealWrite,
} from "./lib/bucketLifecycle.js";

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

const addBucket = (
  db: Database.Database,
  id: number,
  options: { active?: number; excluded?: number } = {},
): void => {
  db.prepare(`INSERT INTO buckets
    (id,name,description,minPercentage,maxPercentage,minFixedAmount,isActive,
     displayOrder,excludeFromReports,createdAt,updatedAt)
    VALUES (@id,@name,@description,0,100,NULL,@active,@id,@excluded,
      '2026-01-01','2026-01-01')`).run({
    id,
    name: `bucket-${id}`,
    description: `bucket-description-${id}`,
    active: options.active ?? 1,
    excluded: options.excluded ?? 0,
  });
};

const addCategory = (
  db: Database.Database,
  id: number,
  bucketId: number,
  name = `category-${id}`,
): void => {
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,description,isActive,createdAt,updatedAt)
    VALUES (@id,@name,@bucketId,@description,1,'2026-01-01','2026-01-01')`)
    .run({ id, name, bucketId, description: `category-description-${id}` });
};

const createDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec(schema);
  addBucket(db, 1);
  addBucket(db, 2);
  addBucket(db, 3, { excluded: 1 });
  addBucket(db, 4, { active: 0 });
  addBucket(db, 5);
  addCategory(db, 1, 1);
  addCategory(db, 2, 2);
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
  confirmation: BUCKET_LIFECYCLE_CONFIRMATIONS[action],
  expectedPlanFingerprint: planFingerprint,
});

test("empty unused bucket deletes safely", () => {
  const db = createDb();
  const dry = bucketLifecycleDryRun(db, { bucketId: 5 }, "delete");
  expect(dry.eligible && dry.categoryCount === 0, "delete_not_eligible");
  const result = bucketLifecycleRealWrite(
    db,
    writePayload("delete", { bucketId: 5 }, dry.planFingerprint!),
    "delete",
  );
  expect(result.ok && result.rowsChanged === 1, "delete_failed");
  expect(!db.prepare("SELECT 1 FROM buckets WHERE id=5").get(), "bucket_remains");
  db.close();
});

test("bucket containing categories cannot be deleted", () => {
  const db = createDb();
  const dry = bucketLifecycleDryRun(db, { bucketId: 2 }, "delete");
  expect(!dry.eligible && dry.categoryCount === 2, "category_delete_allowed");
  expect(dry.code === "bucket_contains_categories", "category_conflict_missing");
  expect(Boolean(db.prepare("SELECT 1 FROM buckets WHERE id=2").get()), "dry_run_mutated");
  db.close();
});

test("merge with zero categories preserves target", () => {
  const db = createDb();
  const targetBefore = db.prepare("SELECT * FROM buckets WHERE id=1").get();
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 5, targetBucketId: 1 },
    "merge",
  );
  const result = bucketLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceBucketId: 5, targetBucketId: 1 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(result.ok && result.rowsChanged === 1, "zero_category_merge_failed");
  expect(
    JSON.stringify(db.prepare("SELECT * FROM buckets WHERE id=1").get()) ===
      JSON.stringify(targetBefore),
    "target_changed",
  );
  db.close();
});

test("merge moves categories and preserves all metadata except parent", () => {
  const db = createDb();
  const categoriesBefore = db
    .prepare("SELECT * FROM categories WHERE bucketId=2 ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  const unrelatedBefore = db.prepare("SELECT * FROM categories WHERE id=1").get();
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  expect(dry.categoriesProposedForMove === 2, "move_count_invalid");
  const result = bucketLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceBucketId: 2, targetBucketId: 1 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  const categoriesAfter = db
    .prepare("SELECT * FROM categories WHERE id IN (2,3) ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  expect(result.ok && result.rowsChanged === 3, "category_merge_failed");
  expect(
    JSON.stringify(categoriesAfter) ===
      JSON.stringify(categoriesBefore.map((row) => ({ ...row, bucketId: 1 }))),
    "category_metadata_changed",
  );
  expect(
    JSON.stringify(db.prepare("SELECT * FROM categories WHERE id=1").get()) ===
      JSON.stringify(unrelatedBefore),
    "unrelated_category_changed",
  );
  db.close();
});

test("derived transaction budget and snapshot rows remain byte-identical", () => {
  const db = createDb();
  addTransaction(db, 1, 2);
  addBudget(db, 1, 2);
  addSnapshot(db, 1, 2);
  const tables = ["transactions", "budgets", "budgetSnapshots"];
  const before = Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  );
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  const result = bucketLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceBucketId: 2, targetBucketId: 1 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(result.ok, "merge_failed");
  for (const table of tables) {
    expect(
      JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()) ===
        JSON.stringify(before[table]),
      `${table}_changed`,
    );
  }
  db.close();
});

test("duplicate category names are allowed by current semantics", () => {
  const db = createDb();
  db.prepare("UPDATE categories SET name='same' WHERE id IN (1,2)").run();
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  expect(dry.eligible && dry.categoryCollisionCount === 0, "invented_name_collision");
  db.close();
});

test("report classification and active-state mismatches fail closed", () => {
  const db = createDb();
  const excluded = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 3 },
    "merge",
  );
  const inactive = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 4 },
    "merge",
  );
  expect(!excluded.eligible && !inactive.eligible, "semantic_mismatch_allowed");
  expect(
    excluded.validationErrors.includes("bucket_semantic_flags_incompatible") &&
      inactive.validationErrors.includes("bucket_semantic_flags_incompatible"),
    "semantic_conflict_missing",
  );
  db.close();
});

test("two report-excluded buckets fail closed because income selection is singular", () => {
  const db = createDb();
  addBucket(db, 6, { excluded: 1 });
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 3, targetBucketId: 6 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("bucket_semantic_flags_incompatible"),
    "ambiguous_income_bucket_merge_allowed",
  );
  db.close();
});

test("same and missing buckets fail safely", () => {
  const db = createDb();
  expect(
    !bucketLifecycleDryRun(
      db,
      { sourceBucketId: 1, targetBucketId: 1 },
      "merge",
    ).eligible,
    "same_bucket_allowed",
  );
  expect(
    !bucketLifecycleDryRun(
      db,
      { sourceBucketId: 99, targetBucketId: 1 },
      "merge",
    ).sourcePresent,
    "missing_source_present",
  );
  expect(
    !bucketLifecycleDryRun(
      db,
      { sourceBucketId: 2, targetBucketId: 99 },
      "merge",
    ).targetPresent,
    "missing_target_present",
  );
  db.close();
});

test("stale plan fails without mutation", () => {
  const db = createDb();
  const dry = bucketLifecycleDryRun(db, { bucketId: 5 }, "delete");
  addCategory(db, 8, 5);
  const result = bucketLifecycleRealWrite(
    db,
    writePayload("delete", { bucketId: 5 }, dry.planFingerprint!),
    "delete",
  );
  expect(!result.ok && result.code === "bucket_lifecycle_plan_stale", "stale_allowed");
  expect(Boolean(db.prepare("SELECT 1 FROM buckets WHERE id=5").get()), "stale_mutated");
  db.close();
});

test("unsupported bucket reference location fails closed", () => {
  const db = createDb();
  db.exec("CREATE TABLE unsupportedLinks (id INTEGER PRIMARY KEY, bucketId INTEGER)");
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("unsupported_bucket_reference_location"),
    "unsupported_reference_allowed",
  );
  db.close();
});

test("malformed category parent fails closed", () => {
  const db = createDb();
  db.prepare("UPDATE categories SET bucketId=99 WHERE id=3").run();
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("category_bucket_reference_malformed"),
    "malformed_parent_allowed",
  );
  db.close();
});

test("malformed derived category reference fails closed", () => {
  const db = createDb();
  addTransaction(db, 1, 99);
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  expect(
    !dry.eligible &&
      dry.validationErrors.includes("transactions_category_reference_malformed"),
    "malformed_derived_reference_allowed",
  );
  db.close();
});

test("financial totals remain stable and bucket grouping consolidates", () => {
  const db = createDb();
  addTransaction(db, 1, 1, -40);
  addTransaction(db, 2, 2, -100);
  const globalTotal = () =>
    (db
      .prepare("SELECT SUM(amount + COALESCE(transactionCost,0)) AS total FROM transactions")
      .get() as { total: number }).total;
  const bucketTotal = (bucketId: number) =>
    (db
      .prepare(`SELECT COALESCE(SUM(t.amount + COALESCE(t.transactionCost,0)),0) AS total
        FROM transactions t JOIN categories c ON c.id=t.categoryId
        WHERE c.bucketId=@bucketId`)
      .get({ bucketId }) as { total: number }).total;
  const before = globalTotal();
  const expectedTarget = bucketTotal(1) + bucketTotal(2);
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  const result = bucketLifecycleRealWrite(
    db,
    writePayload(
      "merge",
      { sourceBucketId: 2, targetBucketId: 1 },
      dry.planFingerprint!,
    ),
    "merge",
  );
  expect(
    result.ok && globalTotal() === before && bucketTotal(1) === expectedTarget,
    "report_invariance_failed",
  );
  db.close();
});

test("boundary failure rolls back category moves and source deletion", () => {
  const db = createDb();
  db.exec(`CREATE TRIGGER bucket_delete_side_effect AFTER DELETE ON buckets
    BEGIN UPDATE accounts SET name='changed' WHERE id=1; END`);
  const dry = bucketLifecycleDryRun(
    db,
    { sourceBucketId: 2, targetBucketId: 1 },
    "merge",
  );
  let threw = false;
  try {
    bucketLifecycleRealWrite(
      db,
      writePayload(
        "merge",
        { sourceBucketId: 2, targetBucketId: 1 },
        dry.planFingerprint!,
      ),
      "merge",
    );
  } catch {
    threw = true;
  }
  expect(threw, "boundary_failure_did_not_throw");
  expect(Boolean(db.prepare("SELECT 1 FROM buckets WHERE id=2").get()), "source_not_rolled_back");
  expect(
    (db.prepare("SELECT COUNT(*) AS count FROM categories WHERE bucketId=2").get() as {
      count: number;
    }).count === 2,
    "category_moves_not_rolled_back",
  );
  expect(
    (db.prepare("SELECT name FROM accounts WHERE id=1").get() as { name: string })
      .name === "account",
    "side_effect_not_rolled_back",
  );
  db.close();
});

console.log(`Bucket lifecycle checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

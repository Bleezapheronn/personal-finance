import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  BUDGET_DELETE_WRITE_CONFIRMATION,
  BudgetDeleteRequestError,
  budgetDeleteDryRun,
  budgetDeleteRealWrite,
} from "./lib/budgetDelete.js";

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

const rows = (db: Database.Database, table: string): unknown[] =>
  db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
const serialized = (value: unknown): string => JSON.stringify(value);

const createDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO buckets
    (id,name,minPercentage,maxPercentage,isActive,displayOrder,excludeFromReports,
     createdAt,updatedAt)
    VALUES (1,'bucket',0,100,1,1,0,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO categories
    (id,name,bucketId,isActive,createdAt,updatedAt)
    VALUES (1,'category',1,1,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO accounts
    (id,name,currency,isActive,isCredit,createdAt,updatedAt)
    VALUES (1,'account','KES',1,0,'2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO recipients
    (id,name,isActive,createdAt,updatedAt)
    VALUES (1,'recipient',1,'2026-01-01','2026-01-01')`).run();
  return db;
};

const addBudget = (
  db: Database.Database,
  id: number,
  active = 1,
): void => {
  db.prepare(`INSERT INTO budgets
    (id,description,categoryId,accountId,recipientId,amount,transactionCost,
     frequency,isGoal,isFlexible,isActive,dueDate,createdAt,updatedAt)
    VALUES (@id,@description,1,1,1,-100,-2,'monthly',0,0,@active,
      '2026-01-15','2026-01-01','2026-01-01')`).run({
    id,
    active,
    description: `budget-${id}`,
  });
};

const addSnapshot = (
  db: Database.Database,
  id: number,
  budgetId: number,
  dueDate = `2026-${String(id).padStart(2, "0")}-15`,
): void => {
  db.prepare(`INSERT INTO budgetSnapshots
    (id,budgetId,occurrenceDate,dueDate,cycleIndex,description,categoryId,
     accountId,recipientId,amount,transactionCost,frequency,isGoal,isFlexible,
     isHistorical,sourceBudgetUpdatedAt,createdAt,updatedAt)
    VALUES (@id,@budgetId,@dueDate,@dueDate,@id,@description,1,1,1,-100,-2,
      'monthly',0,0,1,'2026-01-01','2026-01-01','2026-01-01')`).run({
    id,
    budgetId,
    dueDate,
    description: `snapshot-${id}`,
  });
};

const addTransaction = (
  db: Database.Database,
  id: number,
  options: { budgetId?: number | null; budgetSnapshotId?: number | null } = {},
): void => {
  db.prepare(`INSERT INTO transactions
    (id,categoryId,accountId,recipientId,date,amount,transactionCost,
     description,isTransfer,budgetId,occurrenceDate,budgetSnapshotId)
    VALUES (@id,1,1,1,'2026-01-15',-50,-1,@description,0,@budgetId,
      @occurrenceDate,@budgetSnapshotId)`).run({
    id,
    description: `transaction-${id}`,
    budgetId: options.budgetId ?? null,
    occurrenceDate:
      options.budgetId != null || options.budgetSnapshotId != null
        ? "2026-01-15"
        : null,
    budgetSnapshotId: options.budgetSnapshotId ?? null,
  });
};

const writePayload = (budgetId: number, planFingerprint: string) => ({
  budgetId,
  dryRunReviewed: true,
  confirmation: BUDGET_DELETE_WRITE_CONFIRMATION,
  expectedPlanFingerprint: planFingerprint,
});

test("active unused Budget with zero snapshots deletes", () => {
  const db = createDb();
  addBudget(db, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.eligible && dry.snapshotCount === 0, "active_not_eligible");
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.ok && result.rowsChanged === 1, "active_delete_failed");
  expect(rows(db, "budgets").length === 0, "budget_remains");
  db.close();
});

test("inactive unused Budget uses the same deletion policy", () => {
  const db = createDb();
  addBudget(db, 1, 0);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.eligible && dry.budgetActive === false, "inactive_not_eligible");
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.ok, "inactive_delete_failed");
  db.close();
});

test("multiple unlinked snapshots delete atomically with the Budget", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  addSnapshot(db, 2, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.snapshotCount === 2 && dry.unlinkedSnapshotCount === 2, "snapshot_inventory_wrong");
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.rowsChanged === 3, "deleted_row_count_wrong");
  expect(rows(db, "budgetSnapshots").length === 0, "snapshots_remain");
  db.close();
});

test("canonical snapshot linkage blocks deletion", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  addTransaction(db, 1, { budgetId: 1, budgetSnapshotId: 1 });
  const before = serialized(rows(db, "budgetSnapshots"));
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(!dry.eligible && dry.linkedSnapshotCount === 1, "canonical_link_not_blocked");
  expect(dry.code === "budget_transaction_dependency_exists", "canonical_code_wrong");
  expect(serialized(rows(db, "budgetSnapshots")) === before, "dry_run_mutated");
  db.close();
});

test("legacy direct Budget linkage alone blocks deletion", () => {
  const db = createDb();
  addBudget(db, 1);
  addTransaction(db, 1, { budgetId: 1 });
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(!dry.eligible, "legacy_link_allowed");
  expect(dry.legacyDirectTransactionReferenceCount === 1, "legacy_count_wrong");
  db.close();
});

test("both linkage types count one dependent transaction", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  addTransaction(db, 1, { budgetId: 1, budgetSnapshotId: 1 });
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.transactionDependencyCount === 1, "dependency_not_deduplicated");
  expect(dry.canonicalTransactionReferenceCount === 1, "canonical_count_wrong");
  expect(dry.legacyDirectTransactionReferenceCount === 1, "legacy_count_wrong");
  db.close();
});

test("duplicate unlinked snapshots owned by target are deleted without repair", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1, "2026-01-15");
  addSnapshot(db, 2, 1, "2026-01-15");
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.eligible && dry.snapshotCount === 2, "duplicates_not_included");
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.ok && rows(db, "budgetSnapshots").length === 0, "duplicates_remain");
  db.close();
});

test("missing Budget fails safely", () => {
  const db = createDb();
  const result = budgetDeleteDryRun(db, { budgetId: 999 });
  expect(!result.ok && result.code === "budget_not_found", "missing_budget_not_rejected");
  db.close();
});

test("invalid Budget ID fails request validation", () => {
  const db = createDb();
  let code = "";
  try {
    budgetDeleteDryRun(db, { budgetId: -1 });
  } catch (error) {
    code = error instanceof BudgetDeleteRequestError ? error.code : "wrong_error";
  }
  expect(code === "budget_id_invalid", "invalid_id_not_rejected");
  db.close();
});

test("unexpected payload field fails request validation", () => {
  const db = createDb();
  let code = "";
  try {
    budgetDeleteDryRun(db, { budgetId: 1, snapshotIds: [1] });
  } catch (error) {
    code = error instanceof BudgetDeleteRequestError ? error.code : "wrong_error";
  }
  expect(code === "unexpected_payload_field", "unexpected_field_not_rejected");
  db.close();
});

test("snapshot state change makes the reviewed plan stale", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  addSnapshot(db, 2, 1);
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(!result.ok && result.code === "budget_delete_plan_stale", "snapshot_stale_not_rejected");
  expect(rows(db, "budgets").length === 1 && rows(db, "budgetSnapshots").length === 2, "stale_write_mutated");
  db.close();
});

test("new transaction linkage makes the reviewed plan stale", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  addTransaction(db, 1, { budgetId: 1, budgetSnapshotId: 1 });
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(!result.ok && result.code === "budget_delete_plan_stale", "link_stale_not_rejected");
  expect(rows(db, "budgets").length === 1 && rows(db, "budgetSnapshots").length === 1, "stale_link_write_mutated");
  db.close();
});

test("unsupported Budget reference location fails closed", () => {
  const db = createDb();
  addBudget(db, 1);
  db.exec("CREATE TABLE unsupportedLinks (id INTEGER PRIMARY KEY, budgetId INTEGER)");
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.code === "unsupported_budget_reference_location", "unsupported_reference_allowed");
  expect(rows(db, "budgets").length === 1, "unsupported_reference_mutated");
  db.close();
});

test("malformed snapshot ownership fails closed", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  db.prepare("UPDATE budgetSnapshots SET budgetId = 1.5 WHERE id = 1").run();
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.code === "snapshot_budget_relationship_malformed", "malformed_owner_allowed");
  db.close();
});

test("orphan canonical snapshot linkage fails closed", () => {
  const db = createDb();
  addBudget(db, 1);
  addTransaction(db, 1);
  db.prepare("UPDATE transactions SET budgetSnapshotId = 999 WHERE id = 1").run();
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.code === "transaction_snapshot_relationship_malformed", "orphan_link_allowed");
  db.close();
});

test("Budget or snapshot delete trigger fails closed", () => {
  const db = createDb();
  addBudget(db, 1);
  db.exec("CREATE TRIGGER budget_side_effect AFTER DELETE ON budgets BEGIN UPDATE accounts SET isActive=0; END");
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(dry.code === "unsupported_budget_delete_trigger", "trigger_allowed");
  expect((db.prepare("SELECT isActive FROM accounts WHERE id=1").get() as { isActive: number }).isActive === 1, "trigger_ran");
  db.close();
});

test("unrelated rows and financial totals remain byte-identical", () => {
  const db = createDb();
  addBudget(db, 1);
  addBudget(db, 2);
  addSnapshot(db, 1, 1);
  addSnapshot(db, 2, 2);
  addTransaction(db, 1);
  const protectedBefore = Object.fromEntries(
    ["transactions", "accounts", "buckets", "categories", "recipients", "smsImportTemplates"].map(
      (table) => [table, serialized(rows(db, table))],
    ),
  );
  const unrelatedBudget = serialized(db.prepare("SELECT * FROM budgets WHERE id=2").get());
  const unrelatedSnapshot = serialized(db.prepare("SELECT * FROM budgetSnapshots WHERE id=2").get());
  const financialBefore = db.prepare("SELECT SUM(amount + COALESCE(transactionCost, 0)) total FROM transactions").get();
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.ok, "protected_write_failed");
  for (const [table, before] of Object.entries(protectedBefore)) {
    expect(serialized(rows(db, table)) === before, `${table}_changed`);
  }
  expect(serialized(db.prepare("SELECT * FROM budgets WHERE id=2").get()) === unrelatedBudget, "unrelated_budget_changed");
  expect(serialized(db.prepare("SELECT * FROM budgetSnapshots WHERE id=2").get()) === unrelatedSnapshot, "unrelated_snapshot_changed");
  expect(serialized(db.prepare("SELECT SUM(amount + COALESCE(transactionCost, 0)) total FROM transactions").get()) === serialized(financialBefore), "financial_total_changed");
  db.close();
});

test("dry-run is redacted and non-mutating", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1);
  const before = serialized({ budgets: rows(db, "budgets"), snapshots: rows(db, "budgetSnapshots") });
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  const encoded = JSON.stringify(dry);
  expect(!encoded.includes("budget-1") && !encoded.includes("snapshot-1"), "response_not_redacted");
  expect(serialized({ budgets: rows(db, "budgets"), snapshots: rows(db, "budgetSnapshots") }) === before, "dry_run_mutated");
  db.close();
});

test("write requires matching reviewed plan confirmation", () => {
  const db = createDb();
  addBudget(db, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  let code = "";
  try {
    budgetDeleteRealWrite(db, {
      ...writePayload(1, dry.planFingerprint!),
      confirmation: "wrong",
    });
  } catch (error) {
    code = error instanceof BudgetDeleteRequestError ? error.code : "wrong_error";
  }
  expect(code === "matching_dry_run_required", "confirmation_not_enforced");
  expect(rows(db, "budgets").length === 1, "invalid_write_mutated");
  db.close();
});

test("successful deletion removes target Budget History source rows", () => {
  const db = createDb();
  addBudget(db, 1);
  addSnapshot(db, 1, 1, "2025-12-15");
  addSnapshot(db, 2, 1, "2026-01-15");
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  const result = budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  expect(result.budgetHistoryEffectSummary.snapshotRowsRemoved === 2, "history_effect_wrong");
  expect(rows(db, "budgets").length === 0 && rows(db, "budgetSnapshots").length === 0, "history_sources_remain");
  db.close();
});

test("repeat deletion returns safe not-found without mutation", () => {
  const db = createDb();
  addBudget(db, 1);
  const dry = budgetDeleteDryRun(db, { budgetId: 1 });
  budgetDeleteRealWrite(db, writePayload(1, dry.planFingerprint!));
  const repeated = budgetDeleteDryRun(db, { budgetId: 1 });
  expect(!repeated.ok && repeated.code === "budget_not_found", "repeat_not_safe");
  db.close();
});

console.log(`Budget deletion tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

import Database from "better-sqlite3";
import {
  lookupActiveStateDryRun,
  lookupActiveStateWrite,
  lookupActiveStateConfirmation,
} from "./lib/lookupActiveStateLifecycle.js";
import {
  bucketReorderDryRun,
  bucketReorderWrite,
} from "./lib/bucketReorderLifecycle.js";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE accounts (id INTEGER PRIMARY KEY, isActive INTEGER NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE buckets (id INTEGER PRIMARY KEY, displayOrder INTEGER NOT NULL, isActive INTEGER NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, isActive INTEGER NOT NULL, updatedAt TEXT NOT NULL);
`);
db.exec("INSERT INTO accounts VALUES (1, 1, 'before'); INSERT INTO categories VALUES (1, 1, 'before'); INSERT INTO buckets VALUES (1, 0, 1, 'before'), (2, 1, 1, 'before'), (3, 2, 1, 'before');");

const accountDry = lookupActiveStateDryRun(db, { id: 1 }, "account", "deactivate");
if (!accountDry.ok || !accountDry.planFingerprint) throw new Error("account_active_dry_run_failed");
const accountStale = lookupActiveStateWrite(db, { id: 1, dryRunReviewed: true, confirmation: lookupActiveStateConfirmation("account", "deactivate"), expectedPlanFingerprint: "0".repeat(64) }, "account", "deactivate");
if (accountStale.code !== "active_state_plan_stale" || (db.prepare("SELECT isActive FROM accounts WHERE id = 1").get() as { isActive: number }).isActive !== 1) throw new Error("account_active_stale_mutated");
const accountWrite = lookupActiveStateWrite(db, { id: 1, dryRunReviewed: true, confirmation: lookupActiveStateConfirmation("account", "deactivate"), expectedPlanFingerprint: accountDry.planFingerprint }, "account", "deactivate");
if (!accountWrite.ok || accountWrite.rowsChanged !== 1 || (db.prepare("SELECT isActive FROM accounts WHERE id = 1").get() as { isActive: number }).isActive !== 0) throw new Error("account_active_write_failed");
if ((db.prepare("SELECT isActive FROM categories WHERE id = 1").get() as { isActive: number }).isActive !== 1) throw new Error("account_active_touched_unrelated_table");
for (const entity of ["bucket", "category"] as const) {
  const dry = lookupActiveStateDryRun(db, { id: 1 }, entity, "deactivate");
  if (!dry.ok || !dry.planFingerprint) throw new Error(`${entity}_active_dry_run_failed`);
  const write = lookupActiveStateWrite(db, { id: 1, dryRunReviewed: true, confirmation: lookupActiveStateConfirmation(entity, "deactivate"), expectedPlanFingerprint: dry.planFingerprint }, entity, "deactivate");
  if (!write.ok || write.rowsChanged !== 1) throw new Error(`${entity}_active_write_failed`);
}

const reorderDry = bucketReorderDryRun(db, { orderedBucketIds: [3, 1, 2] });
if (!reorderDry.ok || !reorderDry.planFingerprint) throw new Error("bucket_reorder_dry_run_failed");
const invalidReorder = bucketReorderDryRun(db, { orderedBucketIds: [3, 1] });
if (invalidReorder.ok || invalidReorder.code !== "ordered_bucket_ids_must_match_current_buckets") throw new Error("bucket_reorder_exact_membership_failed");
const reorderStale = bucketReorderWrite(db, { orderedBucketIds: [3, 1, 2], dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: "0".repeat(64) });
if (reorderStale.code !== "bucket_reorder_plan_stale" || (db.prepare("SELECT id FROM buckets ORDER BY displayOrder").all() as Array<{ id: number }>).map((row) => row.id).join(",") !== "1,2,3") throw new Error("bucket_reorder_stale_mutated");
const reorderWrite = bucketReorderWrite(db, { orderedBucketIds: [3, 1, 2], dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: reorderDry.planFingerprint });
if (!reorderWrite.ok || reorderWrite.rowsChanged !== 3 || (db.prepare("SELECT id FROM buckets ORDER BY displayOrder").all() as Array<{ id: number }>).map((row) => row.id).join(",") !== "3,1,2") throw new Error("bucket_reorder_atomic_write_failed");
const rollbackDry = bucketReorderDryRun(db, { orderedBucketIds: [2, 1, 3] });
if (!rollbackDry.planFingerprint) throw new Error("bucket_reorder_rollback_dry_run_failed");
db.exec("CREATE TRIGGER reject_bucket_reorder BEFORE UPDATE OF displayOrder ON buckets WHEN OLD.id = 1 BEGIN SELECT RAISE(ABORT, 'synthetic_reorder_failure'); END");
let rollbackFailed = false;
try {
  bucketReorderWrite(db, { orderedBucketIds: [2, 1, 3], dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: rollbackDry.planFingerprint });
} catch { rollbackFailed = true; }
if (!rollbackFailed || (db.prepare("SELECT id FROM buckets ORDER BY displayOrder").all() as Array<{ id: number }>).map((row) => row.id).join(",") !== "3,1,2") throw new Error("bucket_reorder_rollback_failed");

db.close();
console.log("Management lifecycle write checks: PASS");

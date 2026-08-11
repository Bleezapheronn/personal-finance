import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { localDayKey } from "../../shared/budgetSnapshotGeneration.js";

type Row = Record<string, unknown>;
type BatchAction = "setActive" | "delete";

interface Input {
  action: BatchAction;
  budgetId: number;
  snapshotIds: number[];
  isActive?: boolean;
  expectedPlanFingerprint?: string;
}

interface Plan {
  input: Input;
  snapshots: Row[];
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  validationErrors: string[];
  planFingerprint?: string;
}

export const BUDGET_SNAPSHOT_OCCURRENCE_BATCH_CONFIRMATION =
  "apply selected budget occurrence changes in sqlite" as const;

export interface BudgetSnapshotOccurrenceBatchResponse {
  ok: boolean;
  dryRun: boolean;
  action: BatchAction;
  selectedCount: number;
  matchedCount: number;
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  validationErrors: string[];
  rowsChanged: number;
  sqliteMutated: boolean;
  planFingerprint?: string;
  code?: string;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const positiveId = (value: unknown, code: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
};

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const parse = (payload: unknown, write: boolean): Input => {
  if (!plain(payload) || (payload.action !== "setActive" && payload.action !== "delete")) {
    throw new Error("batch_occurrence_action_invalid");
  }
  const allowed = new Set([
    "action", "budgetId", "snapshotIds", "isActive",
    ...(write ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"] : []),
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Error("unexpected_payload_field");
  }
  const budgetId = positiveId(payload.budgetId, "budget_id_invalid");
  if (!Array.isArray(payload.snapshotIds) || payload.snapshotIds.length === 0) {
    throw new Error("snapshot_ids_required");
  }
  const snapshotIds = payload.snapshotIds.map((value) => positiveId(value, "snapshot_id_invalid"));
  if (new Set(snapshotIds).size !== snapshotIds.length) throw new Error("snapshot_ids_duplicate");
  if (payload.action === "setActive" && typeof payload.isActive !== "boolean") {
    throw new Error("occurrence_active_invalid");
  }
  if (write && (
    payload.dryRunReviewed !== true ||
    payload.confirmation !== BUDGET_SNAPSHOT_OCCURRENCE_BATCH_CONFIRMATION ||
    typeof payload.expectedPlanFingerprint !== "string" ||
    payload.expectedPlanFingerprint.length !== 64
  )) throw new Error("matching_dry_run_required");
  return {
    action: payload.action,
    budgetId,
    snapshotIds,
    ...(payload.action === "setActive" ? { isActive: Boolean(payload.isActive) } : {}),
    ...(write ? { expectedPlanFingerprint: String(payload.expectedPlanFingerprint) } : {}),
  };
};

const buildPlan = (db: Database.Database, input: Input): Plan => {
  const placeholders = input.snapshotIds.map(() => "?").join(",");
  const budget = db.prepare("SELECT id, isActive FROM budgets WHERE id = ?").get(input.budgetId) as Row | undefined;
  const snapshots = db.prepare(`SELECT * FROM budgetSnapshots WHERE id IN (${placeholders}) ORDER BY id ASC`)
    .all(...input.snapshotIds) as Row[];
  const errors = new Set<string>();
  if (!budget) errors.add("budget_not_found");
  if (snapshots.length !== input.snapshotIds.length) errors.add("snapshot_not_found");
  if (snapshots.some((row) => Number(row.budgetId) !== input.budgetId)) errors.add("snapshot_parent_budget_mismatch");

  let linkedTransactionCount = 0;
  let ambiguousLegacyReferenceCount = 0;
  for (const snapshot of snapshots) {
    const linked = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE budgetSnapshotId = ?")
      .get(Number(snapshot.id)) as { count: number };
    linkedTransactionCount += Number(linked.count);
    const day = localDayKey(String(snapshot.occurrenceDate));
    const ambiguous = (db.prepare(`SELECT occurrenceDate FROM transactions
      WHERE budgetSnapshotId IS NULL AND budgetId = @budgetId AND occurrenceDate IS NOT NULL`)
      .all({ budgetId: input.budgetId }) as Array<{ occurrenceDate: string }>)
      .filter((row) => localDayKey(row.occurrenceDate) === day).length;
    ambiguousLegacyReferenceCount += ambiguous;
  }
  if (input.action === "delete") {
    if (!budget || Number(budget.isActive) !== 0) errors.add("occurrence_delete_requires_inactive_budget_definition");
    if (linkedTransactionCount > 0) errors.add("snapshot_linked");
    if (ambiguousLegacyReferenceCount > 0) errors.add("ambiguous_legacy_snapshot_reference");
  }
  const validationErrors = [...errors].sort();
  const state = { input: { action: input.action, budgetId: input.budgetId, snapshotIds: input.snapshotIds, isActive: input.isActive ?? null }, budget: budget ?? null, snapshots, linkedTransactionCount, ambiguousLegacyReferenceCount, validationErrors };
  return { input, snapshots, linkedTransactionCount, ambiguousLegacyReferenceCount, validationErrors,
    ...(validationErrors.length === 0 ? { planFingerprint: fingerprint(state) } : {}) };
};

const response = (plan: Plan, dryRun: boolean, options: { rowsChanged?: number; code?: string } = {}): BudgetSnapshotOccurrenceBatchResponse => {
  const rowsChanged = options.rowsChanged ?? 0;
  const errors = [...plan.validationErrors, ...(options.code ? [options.code] : [])];
  return {
    ok: errors.length === 0,
    dryRun,
    action: plan.input.action,
    selectedCount: plan.input.snapshotIds.length,
    matchedCount: plan.snapshots.length,
    linkedTransactionCount: plan.linkedTransactionCount,
    ambiguousLegacyReferenceCount: plan.ambiguousLegacyReferenceCount,
    validationErrors: errors,
    rowsChanged,
    sqliteMutated: rowsChanged > 0,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    ...(errors[0] ? { code: errors[0] } : {}),
  };
};

export const budgetSnapshotOccurrenceBatchDryRun = (db: Database.Database, payload: unknown) =>
  response(buildPlan(db, parse(payload, false)), true);

export const budgetSnapshotOccurrenceBatchWrite = (db: Database.Database, payload: unknown) => {
  const input = parse(payload, true);
  return db.transaction(() => {
    const plan = buildPlan(db, input);
    if (!plan.planFingerprint || plan.planFingerprint !== input.expectedPlanFingerprint) {
      return response(plan, false, { code: plan.planFingerprint ? "batch_occurrence_plan_stale" : plan.validationErrors[0] });
    }
    const statement = input.action === "delete"
      ? db.prepare("DELETE FROM budgetSnapshots WHERE id = @id AND budgetId = @budgetId")
      : db.prepare("UPDATE budgetSnapshots SET isActive = @isActive, updatedAt = @updatedAt WHERE id = @id AND budgetId = @budgetId");
    let rowsChanged = 0;
    for (const id of input.snapshotIds) {
      rowsChanged += statement.run({ id, budgetId: input.budgetId, isActive: input.isActive ? 1 : 0, updatedAt: new Date().toISOString() }).changes;
    }
    if (rowsChanged !== input.snapshotIds.length) throw new Error("batch_occurrence_change_count_mismatch");
    return response(plan, false, { rowsChanged });
  }).immediate();
};

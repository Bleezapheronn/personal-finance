import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  buildBudgetSnapshotValues,
  calculateBudgetOccurrenceSchedule,
  localDayKey,
  normalizeToLocalDay,
  type BudgetGenerationDefinition,
  type BudgetSnapshotGenerationValues,
} from "../../shared/budgetSnapshotGeneration.js";
import { occurrenceFrozen } from "./budgetOccurrenceModel.js";

export type BudgetSnapshotOccurrenceAction =
  | "delete"
  | "create"
  | "link"
  | "changeLink"
  | "unlink"
  | "createAndLink"
  | "setActive"
  | "correct";

type Row = Record<string, unknown>;

interface NormalizedInput {
  action: BudgetSnapshotOccurrenceAction;
  snapshotId?: number;
  budgetId?: number;
  transactionId?: number;
  occurrenceDate?: Date;
  expectedPlanFingerprint?: string;
  expectedCurrentSnapshotId?: number;
  isActive?: boolean;
  amount?: number;
  transactionCost?: number | null;
  isFlexible?: boolean;
}

interface Plan {
  input: NormalizedInput;
  snapshot?: Row;
  budget?: Row;
  transaction?: Row;
  existingOccurrence?: Row;
  candidate?: BudgetSnapshotGenerationValues;
  cycleIndex?: number;
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  validationErrors: string[];
  warnings: string[];
  planFingerprint?: string;
}

export interface BudgetSnapshotOccurrenceResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetSnapshotOccurrence";
  action: BudgetSnapshotOccurrenceAction;
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  dexieMutated: false;
  target: {
    snapshotId: number | null;
    budgetId: number | null;
    transactionId: number | null;
    occurrenceDate: string | null;
  };
  targetExists: boolean;
  parentBudgetExists: boolean;
  transactionExists: boolean;
  historical: boolean | null;
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  occurrenceReused: boolean;
  rowsChanged: {
    budgetSnapshots: number;
    transactions: number;
    total: number;
  };
  validationErrors: string[];
  warnings: string[];
  resultCodes: string[];
  planFingerprint?: string;
  code?: string;
  safety: {
    exactTargetOnly: true;
    atomic: true;
    filesWritten: false;
    rawRowsIncluded: false;
    unrelatedSnapshotsMutated: false;
    unrelatedTransactionsMutated: false;
    budgetDefinitionsMutated: false;
  };
}

export class BudgetSnapshotOccurrenceRequestError extends Error {
  statusCode = 400 as const;
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS = {
  delete: "delete one unlinked budget occurrence from sqlite",
  create: "create one budget occurrence in sqlite",
  link: "link one transaction to one budget occurrence in sqlite",
  changeLink: "change one transaction budget occurrence link in sqlite",
  unlink: "unlink one transaction from its budget occurrence in sqlite",
  createAndLink:
    "create one budget occurrence and link one transaction in sqlite",
  setActive: "change one historical budget occurrence active state in sqlite",
  correct: "correct one historical budget occurrence in sqlite",
} as const;

const ACTION_FIELDS: Record<BudgetSnapshotOccurrenceAction, Set<string>> = {
  delete: new Set(["snapshotId"]),
  create: new Set(["budgetId", "occurrenceDate"]),
  link: new Set(["snapshotId", "transactionId"]),
  changeLink: new Set([
    "snapshotId",
    "transactionId",
    "expectedCurrentSnapshotId",
  ]),
  unlink: new Set(["transactionId", "snapshotId"]),
  createAndLink: new Set(["budgetId", "occurrenceDate", "transactionId"]),
  setActive: new Set(["snapshotId", "isActive"]),
  correct: new Set(["snapshotId", "amount", "transactionCost", "isFlexible"]),
};

const CONTROL_FIELDS = new Set([
  "dryRunReviewed",
  "confirmation",
  "expectedPlanFingerprint",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const positiveId = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BudgetSnapshotOccurrenceRequestError(`${field}_invalid`);
  }
  return value;
};

const occurrenceDate = (value: unknown): Date => {
  if (typeof value !== "string") {
    throw new BudgetSnapshotOccurrenceRequestError("occurrence_date_invalid");
  }
  try {
    return normalizeToLocalDay(value);
  } catch {
    throw new BudgetSnapshotOccurrenceRequestError("occurrence_date_invalid");
  }
};

const normalizePayload = (
  payload: unknown,
  action: BudgetSnapshotOccurrenceAction,
  write: boolean,
): NormalizedInput => {
  if (!isPlainObject(payload)) {
    throw new BudgetSnapshotOccurrenceRequestError("payload_must_be_object");
  }
  const allowed = ACTION_FIELDS[action];
  for (const field of Object.keys(payload)) {
    if (!allowed.has(field) && !(write && CONTROL_FIELDS.has(field))) {
      throw new BudgetSnapshotOccurrenceRequestError("unexpected_payload_field");
    }
  }
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new BudgetSnapshotOccurrenceRequestError(
        "dry_run_reviewed_required",
      );
    }
    if (payload.confirmation !== BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS[action]) {
      throw new BudgetSnapshotOccurrenceRequestError(
        "matching_dry_run_required",
      );
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      payload.expectedPlanFingerprint.length !== 64
    ) {
      throw new BudgetSnapshotOccurrenceRequestError(
        "expected_plan_fingerprint_invalid",
      );
    }
  }
  const normalized: NormalizedInput = {
    action,
    ...(write
      ? { expectedPlanFingerprint: String(payload.expectedPlanFingerprint) }
      : {}),
  };
  if (allowed.has("snapshotId") && payload.snapshotId !== undefined) {
    normalized.snapshotId = positiveId(payload.snapshotId, "snapshot_id");
  }
  if (
    (action === "delete" || action === "link") &&
    normalized.snapshotId === undefined
  ) {
    throw new BudgetSnapshotOccurrenceRequestError("snapshot_id_required");
  }
  if (allowed.has("budgetId")) {
    normalized.budgetId = positiveId(payload.budgetId, "budget_id");
  }
  if (allowed.has("transactionId")) {
    normalized.transactionId = positiveId(
      payload.transactionId,
      "transaction_id",
    );
  }
  if (allowed.has("expectedCurrentSnapshotId")) {
    normalized.expectedCurrentSnapshotId = positiveId(
      payload.expectedCurrentSnapshotId,
      "expected_current_snapshot_id",
    );
  }
  if (allowed.has("occurrenceDate")) {
    normalized.occurrenceDate = occurrenceDate(payload.occurrenceDate);
  }
  if (allowed.has("isActive")) {
    if (typeof payload.isActive !== "boolean") {
      throw new BudgetSnapshotOccurrenceRequestError("occurrence_active_invalid");
    }
    normalized.isActive = payload.isActive;
  }
  if (allowed.has("amount")) {
    if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount === 0) {
      throw new BudgetSnapshotOccurrenceRequestError("occurrence_amount_invalid");
    }
    normalized.amount = payload.amount;
    if (payload.transactionCost !== null && payload.transactionCost !== undefined &&
      (typeof payload.transactionCost !== "number" || !Number.isFinite(payload.transactionCost))) {
      throw new BudgetSnapshotOccurrenceRequestError("occurrence_transaction_cost_invalid");
    }
    normalized.transactionCost = payload.transactionCost == null ? null : Number(payload.transactionCost);
    if (typeof payload.isFlexible !== "boolean") {
      throw new BudgetSnapshotOccurrenceRequestError("occurrence_flexible_invalid");
    }
    normalized.isFlexible = payload.isFlexible;
  }
  return normalized;
};

const rowById = (
  db: Database.Database,
  table: "budgetSnapshots" | "budgets" | "transactions",
  id: number | undefined,
): Row | undefined =>
  id === undefined
    ? undefined
    : (db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
        | Row
        | undefined);

const parseFrequencyDetails = (
  value: unknown,
): BudgetGenerationDefinition["frequencyDetails"] => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("frequency_details_invalid");
  const parsed = JSON.parse(value) as unknown;
  if (!isPlainObject(parsed)) throw new Error("frequency_details_invalid");
  return parsed;
};

const storedBudget = (row: Row): BudgetGenerationDefinition => ({
  id: Number(row.id),
  description: String(row.description),
  categoryId: Number(row.categoryId),
  accountId: row.accountId == null ? null : Number(row.accountId),
  recipientId: row.recipientId == null ? null : Number(row.recipientId),
  amount: Number(row.amount),
  transactionCost:
    row.transactionCost == null ? null : Number(row.transactionCost),
  frequency: row.frequency as BudgetGenerationDefinition["frequency"],
  frequencyDetails: parseFrequencyDetails(row.frequencyDetails),
  isGoal: Number(row.isGoal),
  isFlexible: Number(row.isFlexible),
  goalPercentage:
    row.goalPercentage == null ? null : Number(row.goalPercentage),
  goalDirection:
    row.goalDirection == null
      ? null
      : (row.goalDirection as BudgetGenerationDefinition["goalDirection"]),
  isActive: Number(row.isActive),
  remainingCyclesTotal:
    row.remainingCyclesTotal == null
      ? null
      : Number(row.remainingCyclesTotal),
  dueDate: String(row.dueDate),
  updatedAt: String(row.updatedAt),
});

const sameNullableId = (left: unknown, right: unknown): boolean =>
  left == null || Number(left) === Number(right);

const compatibilityWarnings = (transaction: Row, snapshot: Row): string[] => {
  const warnings: string[] = [];
  if (Number(transaction.isTransfer ?? 0) === 1) {
    warnings.push("transfer_transaction_not_supported");
  }
  if (Number(transaction.categoryId) !== Number(snapshot.categoryId)) {
    warnings.push("snapshot_category_differs");
  }
  if (!sameNullableId(snapshot.accountId, transaction.accountId)) {
    warnings.push("snapshot_account_differs");
  }
  if (!sameNullableId(snapshot.recipientId, transaction.recipientId)) {
    warnings.push("snapshot_recipient_differs");
  }
  return warnings;
};

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const buildPlan = (
  db: Database.Database,
  input: NormalizedInput,
): Plan => {
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  let snapshot = rowById(db, "budgetSnapshots", input.snapshotId);
  let budgetId = input.budgetId;
  if (snapshot) budgetId = Number(snapshot.budgetId);
  const budget = rowById(db, "budgets", budgetId);
  const transaction = rowById(db, "transactions", input.transactionId);
  let linkedTransactionCount = 0;
  let ambiguousLegacyReferenceCount = 0;
  let existingOccurrence: Row | undefined;
  let candidate: BudgetSnapshotGenerationValues | undefined;
  let cycleIndex: number | undefined;

  if ((input.action === "delete" || input.action === "link") && !snapshot) {
    validationErrors.push("snapshot_not_found");
  }
  if (
    (input.action === "create" || input.action === "createAndLink") &&
    !budget
  ) {
    validationErrors.push("budget_not_found");
  }
  if (
    (input.action === "link" ||
      input.action === "changeLink" ||
      input.action === "unlink" ||
      input.action === "createAndLink") &&
    !transaction
  ) {
    validationErrors.push("transaction_not_found");
  }
  if (snapshot && !budget) validationErrors.push("snapshot_parent_budget_missing");

  if (snapshot) {
    linkedTransactionCount = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM transactions WHERE budgetSnapshotId = ?",
          )
          .get(Number(snapshot.id)) as { count: number }
      ).count,
    );
    const snapshotDay = localDayKey(String(snapshot.occurrenceDate));
    ambiguousLegacyReferenceCount = (
      db
        .prepare(
          `SELECT occurrenceDate
           FROM transactions
           WHERE budgetSnapshotId IS NULL
             AND budgetId = @budgetId
             AND occurrenceDate IS NOT NULL`,
        )
        .all({ budgetId: Number(snapshot.budgetId) }) as {
        occurrenceDate: string;
      }[]
    ).filter((row) => localDayKey(row.occurrenceDate) === snapshotDay).length;
  }

  if (snapshot && (input.action === "link" || input.action === "changeLink") &&
      Number(snapshot.isActive ?? 1) !== 1) {
    validationErrors.push("occurrence_inactive");
  }

  if (input.action === "delete") {
    validationErrors.push("occurrence_delete_retired");
  }
  if (input.action === "setActive") {
    if (!snapshot) validationErrors.push("snapshot_not_found");
    else if (!occurrenceFrozen(String(snapshot.dueDate))) {
      validationErrors.push("occurrence_not_frozen");
    }
  }
  if (input.action === "correct") {
    if (!snapshot) validationErrors.push("snapshot_not_found");
    else if (!occurrenceFrozen(String(snapshot.dueDate))) validationErrors.push("occurrence_not_frozen");
  }

  if (input.action === "unlink" && transaction) {
    if (input.snapshotId !== undefined &&
        Number(transaction.budgetSnapshotId) !== input.snapshotId) {
      validationErrors.push("transaction_snapshot_link_stale");
    }
    if (
      transaction.budgetSnapshotId == null &&
      transaction.budgetId == null &&
      transaction.occurrenceDate == null
    ) {
      warnings.push("transaction_already_unlinked");
    }
  }

  if (
    (input.action === "link" || input.action === "changeLink") &&
    transaction &&
    snapshot
  ) {
    const compatibility = compatibilityWarnings(transaction, snapshot);
    if (compatibility.includes("transfer_transaction_not_supported")) {
      validationErrors.push("transfer_transaction_not_supported");
    }
    warnings.push(...compatibility.filter((code) => code !== "transfer_transaction_not_supported"));
    if (input.action === "changeLink") {
      if (
        input.expectedCurrentSnapshotId === undefined ||
        Number(transaction.budgetSnapshotId) !==
          input.expectedCurrentSnapshotId
      ) {
        validationErrors.push("transaction_snapshot_link_stale");
      }
      if (Number(transaction.budgetSnapshotId) === Number(snapshot.id)) {
        warnings.push("transaction_already_linked");
      }
    } else if (
      transaction.budgetSnapshotId != null &&
      Number(transaction.budgetSnapshotId) !== Number(snapshot.id)
    ) {
      validationErrors.push("transaction_linked_to_other_snapshot");
    }
    if (
      input.action === "link" &&
      transaction.budgetSnapshotId == null &&
      ((transaction.budgetId != null &&
        Number(transaction.budgetId) !== Number(snapshot.budgetId)) ||
        (transaction.occurrenceDate != null &&
          localDayKey(String(transaction.occurrenceDate)) !==
            localDayKey(String(snapshot.occurrenceDate))))
    ) {
      validationErrors.push("unsafe_legacy_linkage_conflict");
    }
    if (Number(transaction.budgetSnapshotId) === Number(snapshot.id)) {
      warnings.push("transaction_already_linked");
    }
  }

  if (
    (input.action === "create" || input.action === "createAndLink") &&
    budget &&
    input.occurrenceDate
  ) {
    const day = localDayKey(input.occurrenceDate);
    const budgetSnapshots = db
      .prepare(
        "SELECT * FROM budgetSnapshots WHERE budgetId = @budgetId ORDER BY id ASC",
      )
      .all({ budgetId: input.budgetId }) as Row[];
    const occurrenceRows = budgetSnapshots.filter(
      (row) => localDayKey(String(row.occurrenceDate)) === day,
    );
    const dueRows = budgetSnapshots.filter(
      (row) => localDayKey(String(row.dueDate)) === day,
    );
    if (occurrenceRows.length > 1 || dueRows.length > 1) {
      validationErrors.push("duplicate_occurrence_snapshots");
    } else if (occurrenceRows.length === 1) {
      existingOccurrence = occurrenceRows[0];
      snapshot = existingOccurrence;
      if (localDayKey(String(existingOccurrence.dueDate)) !== day) {
        validationErrors.push("snapshot_identity_disagreement");
      } else {
        warnings.push("occurrence_already_exists");
      }
    } else if (dueRows.length === 1) {
      validationErrors.push("snapshot_identity_disagreement");
    } else {
      try {
        const schedule = calculateBudgetOccurrenceSchedule(
          storedBudget(budget),
          input.occurrenceDate,
        );
        const occurrence = schedule.find(
          (item) => localDayKey(item.occurrenceDate) === day,
        );
        if (!occurrence) {
          validationErrors.push("occurrence_not_in_budget_schedule");
        } else {
          cycleIndex = occurrence.cycleIndex;
          candidate = buildBudgetSnapshotValues(
            storedBudget(budget),
            occurrence.occurrenceDate,
            occurrence.cycleIndex,
            occurrence.occurrenceDate < normalizeToLocalDay(new Date()),
          );
        }
      } catch (error) {
        validationErrors.push(
          error instanceof Error ? error.message : "recurrence_invalid",
        );
      }
    }
    if (input.action === "createAndLink" && transaction) {
      const comparable = existingOccurrence ?? candidate;
      if (comparable) {
        const compatibility = compatibilityWarnings(transaction, comparable as Row);
        if (compatibility.includes("transfer_transaction_not_supported")) {
          validationErrors.push("transfer_transaction_not_supported");
        }
        warnings.push(...compatibility.filter((code) => code !== "transfer_transaction_not_supported"));
      }
      if (existingOccurrence && Number(existingOccurrence.isActive ?? 1) !== 1) {
        validationErrors.push("occurrence_inactive");
      }
      if (transaction.budgetSnapshotId != null) {
        validationErrors.push("transaction_already_linked");
      } else if (
        (transaction.budgetId != null &&
          Number(transaction.budgetId) !== input.budgetId) ||
        (transaction.occurrenceDate != null &&
          localDayKey(String(transaction.occurrenceDate)) !== day)
      ) {
        validationErrors.push("unsafe_legacy_linkage_conflict");
      }
    }
  }

  const uniqueErrors = [...new Set(validationErrors)];
  const state = {
    action: input.action,
    snapshotId: snapshot ? Number(snapshot.id) : input.snapshotId ?? null,
    budgetId: budgetId ?? null,
    transactionId: input.transactionId ?? null,
    expectedCurrentSnapshotId: input.expectedCurrentSnapshotId ?? null,
    occurrenceDate: input.occurrenceDate
      ? localDayKey(input.occurrenceDate)
      : snapshot
        ? localDayKey(String(snapshot.occurrenceDate))
        : null,
    snapshot: snapshot ?? null,
    budget: budget ?? null,
    transaction: transaction ?? null,
    linkedTransactionCount,
    ambiguousLegacyReferenceCount,
    candidate: candidate ?? null,
    errors: uniqueErrors,
  };
  return {
    input,
    snapshot,
    budget,
    transaction,
    existingOccurrence,
    candidate,
    cycleIndex,
    linkedTransactionCount,
    ambiguousLegacyReferenceCount,
    validationErrors: uniqueErrors,
    warnings: [...new Set(warnings)],
    ...(uniqueErrors.length === 0 ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const response = (
  plan: Plan,
  options: {
    dryRun: boolean;
    sqliteMutated?: boolean;
    snapshotRows?: number;
    transactionRows?: number;
    code?: string;
  },
): BudgetSnapshotOccurrenceResponse => {
  const errors = [...plan.validationErrors];
  if (options.code && !errors.includes(options.code)) errors.push(options.code);
  const snapshotRows = options.snapshotRows ?? 0;
  const transactionRows = options.transactionRows ?? 0;
  const ok = errors.length === 0;
  return {
    ok,
    mode: "prototype",
    entity: "budgetSnapshotOccurrence",
    action: plan.input.action,
    dryRun: options.dryRun,
    wouldMutate:
      options.dryRun &&
      ok &&
      !(plan.input.action === "unlink" &&
        plan.warnings.includes("transaction_already_unlinked")) &&
      !(plan.input.action === "create" && Boolean(plan.existingOccurrence)),
    sqliteMutated: options.sqliteMutated ?? false,
    dexieMutated: false,
    target: {
      snapshotId: plan.snapshot ? Number(plan.snapshot.id) : plan.input.snapshotId ?? null,
      budgetId: plan.budget ? Number(plan.budget.id) : plan.input.budgetId ?? null,
      transactionId: plan.input.transactionId ?? null,
      occurrenceDate: plan.input.occurrenceDate
        ? localDayKey(plan.input.occurrenceDate)
        : plan.snapshot
          ? localDayKey(String(plan.snapshot.occurrenceDate))
          : null,
    },
    targetExists: Boolean(plan.snapshot || plan.existingOccurrence),
    parentBudgetExists: Boolean(plan.budget),
    transactionExists: Boolean(plan.transaction),
    historical:
      plan.snapshot?.isHistorical == null
        ? plan.candidate?.isHistorical ?? null
        : Number(plan.snapshot.isHistorical) === 1,
    linkedTransactionCount: plan.linkedTransactionCount,
    ambiguousLegacyReferenceCount: plan.ambiguousLegacyReferenceCount,
    occurrenceReused: Boolean(plan.existingOccurrence),
    rowsChanged: {
      budgetSnapshots: snapshotRows,
      transactions: transactionRows,
      total: snapshotRows + transactionRows,
    },
    validationErrors: errors,
    warnings: plan.warnings,
    resultCodes: ok
      ? [
          options.dryRun ? "dry_run_passed" : "write_passed",
          options.sqliteMutated ? "sqlite_mutated" : "no_mutation_performed",
        ]
      : ["operation_refused", "no_mutation_performed"],
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    ...(errors[0] ? { code: errors[0] } : {}),
    safety: {
      exactTargetOnly: true,
      atomic: true,
      filesWritten: false,
      rawRowsIncluded: false,
      unrelatedSnapshotsMutated: false,
      unrelatedTransactionsMutated: false,
      budgetDefinitionsMutated: false,
    },
  };
};

const insertSnapshot = (
  db: Database.Database,
  value: BudgetSnapshotGenerationValues,
): number => {
  const timestamp = new Date().toISOString();
  const result = db.prepare(`INSERT INTO budgetSnapshots (
    budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
    accountId, recipientId, amount, transactionCost, frequency, frequencyDetails,
    isGoal, isFlexible, goalPercentage, goalDirection, remainingCyclesTotal,
    isHistorical, sourceBudgetUpdatedAt, createdAt, updatedAt
  ) VALUES (
    @budgetId, @occurrenceDate, @dueDate, @cycleIndex, @description, @categoryId,
    @accountId, @recipientId, @amount, @transactionCost, @frequency, @frequencyDetails,
    @isGoal, @isFlexible, @goalPercentage, @goalDirection, @remainingCyclesTotal,
    @isHistorical, @sourceBudgetUpdatedAt, @createdAt, @updatedAt
  )`).run({
    ...value,
    occurrenceDate: value.occurrenceDate.toISOString(),
    dueDate: value.dueDate.toISOString(),
    accountId: value.accountId ?? null,
    recipientId: value.recipientId ?? null,
    transactionCost: value.transactionCost ?? null,
    frequencyDetails: value.frequencyDetails
      ? JSON.stringify(value.frequencyDetails)
      : null,
    isGoal: value.isGoal ? 1 : 0,
    isFlexible: value.isFlexible ? 1 : 0,
    goalPercentage: value.goalPercentage ?? null,
    goalDirection: value.goalDirection ?? null,
    remainingCyclesTotal: value.remainingCyclesTotal ?? null,
    isHistorical: value.isHistorical ? 1 : 0,
    sourceBudgetUpdatedAt:
      value.sourceBudgetUpdatedAt instanceof Date
        ? value.sourceBudgetUpdatedAt.toISOString()
        : value.sourceBudgetUpdatedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (result.changes !== 1) throw new Error("snapshot_insert_failed");
  return Number(result.lastInsertRowid);
};

export const budgetSnapshotOccurrenceDryRun = (
  db: Database.Database,
  payload: unknown,
  action: BudgetSnapshotOccurrenceAction,
): BudgetSnapshotOccurrenceResponse =>
  response(buildPlan(db, normalizePayload(payload, action, false)), {
    dryRun: true,
  });

export const budgetSnapshotOccurrenceDisabledResponse = (
  action: BudgetSnapshotOccurrenceAction,
): BudgetSnapshotOccurrenceResponse =>
  response(
    {
      input: { action },
      linkedTransactionCount: 0,
      ambiguousLegacyReferenceCount: 0,
      validationErrors: ["budget_snapshot_occurrence_writes_disabled"],
      warnings: [],
    },
    { dryRun: false },
  );

export const budgetSnapshotOccurrenceRequestErrorResponse = (
  action: BudgetSnapshotOccurrenceAction,
  code: string,
): BudgetSnapshotOccurrenceResponse =>
  response(
    {
      input: { action },
      linkedTransactionCount: 0,
      ambiguousLegacyReferenceCount: 0,
      validationErrors: [code],
      warnings: [],
    },
    { dryRun: false },
  );

export const budgetSnapshotOccurrenceRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: BudgetSnapshotOccurrenceAction,
): BudgetSnapshotOccurrenceResponse => {
  const input = normalizePayload(payload, action, true);
  return db.transaction(() => {
    const plan = buildPlan(db, input);
    if (!plan.planFingerprint ||
        plan.planFingerprint !== input.expectedPlanFingerprint) {
      return response(plan, {
        dryRun: false,
        code: plan.planFingerprint
          ? "budget_snapshot_occurrence_plan_stale"
          : plan.validationErrors[0],
      });
    }
    let snapshotRows = 0;
    let transactionRows = 0;
    const snapshotExistedBefore = Boolean(plan.snapshot);
    let snapshotId = plan.snapshot ? Number(plan.snapshot.id) : undefined;
    if (action === "delete") {
      snapshotRows = db
        .prepare("DELETE FROM budgetSnapshots WHERE id = ?")
        .run(snapshotId).changes;
    } else if (action === "setActive") {
      snapshotRows = db.prepare("UPDATE budgetSnapshots SET isActive = @isActive, updatedAt = @updatedAt WHERE id = @id")
        .run({ id: snapshotId, isActive: plan.input.isActive ? 1 : 0, updatedAt: new Date().toISOString() }).changes;
    } else if (action === "correct") {
      snapshotRows = db.prepare(`UPDATE budgetSnapshots SET amount=@amount, transactionCost=@transactionCost,
        isFlexible=@isFlexible, updatedAt=@updatedAt WHERE id=@id`).run({
        id: snapshotId, amount: plan.input.amount, transactionCost: plan.input.transactionCost,
        isFlexible: plan.input.isFlexible ? 1 : 0, updatedAt: new Date().toISOString(),
      }).changes;
    } else if (action === "create" || action === "createAndLink") {
      if (!snapshotId && plan.candidate) {
        snapshotId = insertSnapshot(db, plan.candidate);
        snapshotRows = 1;
        plan.snapshot = rowById(db, "budgetSnapshots", snapshotId);
      }
      if (action === "createAndLink") {
        transactionRows = db
          .prepare(
            `UPDATE transactions
             SET budgetSnapshotId = @snapshotId
             WHERE id = @transactionId`,
          )
          .run({
            snapshotId,
            transactionId: plan.input.transactionId,
          }).changes;
      }
    } else if (action === "link" || action === "changeLink") {
      transactionRows = plan.warnings.includes("transaction_already_linked")
        ? 0
        : db
            .prepare(
              `UPDATE transactions
               SET budgetSnapshotId = @snapshotId
               WHERE id = @transactionId`,
            )
            .run({
              snapshotId,
              transactionId: plan.input.transactionId,
            }).changes;
    } else {
      transactionRows = plan.warnings.includes("transaction_already_unlinked")
        ? 0
        : db
            .prepare(
              `UPDATE transactions
               SET budgetSnapshotId = NULL
               WHERE id = @transactionId`,
            )
            .run({ transactionId: plan.input.transactionId }).changes;
    }
    const expectedSnapshotRows =
      action === "delete" || action === "setActive" || action === "correct"
        ? 1
        : (action === "create" || action === "createAndLink") &&
            !snapshotExistedBefore
          ? 1
          : 0;
    const expectedTransactionRows =
      action === "link" || action === "changeLink"
        ? plan.warnings.includes("transaction_already_linked") ? 0 : 1
        : action === "unlink"
          ? plan.warnings.includes("transaction_already_unlinked") ? 0 : 1
          : action === "createAndLink" ? 1 : 0;
    if (
      snapshotRows !== expectedSnapshotRows ||
      transactionRows !== expectedTransactionRows
    ) {
      throw new Error("budget_snapshot_occurrence_change_count_mismatch");
    }
    return response(plan, {
      dryRun: false,
      sqliteMutated: snapshotRows + transactionRows > 0,
      snapshotRows,
      transactionRows,
    });
  }).immediate();
};

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  calculateBudgetOccurrenceSchedule,
  localDayKey,
  normalizeToLocalDay,
  type BudgetGenerationDefinition,
} from "../../shared/budgetSnapshotGeneration.js";
import {
  budgetDefinitionDryRun,
  normalizeBudgetDefinitionPayload,
  type BudgetDefinitionDryRunResponse,
  type NormalizedBudgetDefinitionInput,
} from "./budgetDefinitionDryRun.js";
import {
  BUDGET_DEFINITION_CREATE_CONFIRMATION,
  budgetDefinitionRealWrite,
} from "./budgetDefinitionWrite.js";
import {
  BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS,
  budgetSnapshotOccurrenceDryRun,
  budgetSnapshotOccurrenceRealWrite,
} from "./budgetSnapshotOccurrence.js";

export const BUDGET_FROM_TRANSACTION_CONFIRMATION =
  "create one budget and occurrence from one transaction in sqlite" as const;

type Row = Record<string, unknown>;

interface Plan {
  definition: NormalizedBudgetDefinitionInput;
  definitionDryRun: BudgetDefinitionDryRunResponse;
  transactionId: number;
  occurrenceDate: Date;
  targetBudgetId: number;
  validationErrors: string[];
  planFingerprint?: string;
}

export interface BudgetFromTransactionResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetFromTransaction";
  action: "createBudgetOccurrenceAndLink";
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  dexieMutated: false;
  targetBudgetId: number | null;
  targetTransactionId: number | null;
  occurrenceDate: string | null;
  rowsChanged: {
    budgets: number;
    budgetSnapshots: number;
    transactions: number;
    total: number;
  };
  validationErrors: string[];
  warnings: string[];
  planFingerprint?: string;
  code?: string;
  safety: {
    atomic: true;
    oneOccurrenceOnly: true;
    unrelatedSnapshotsMutated: false;
    unrelatedTransactionsMutated: false;
    filesWritten: false;
    rawRowsIncluded: false;
  };
}

export class BudgetFromTransactionRequestError extends Error {
  statusCode = 400 as const;
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const parsePayload = (
  payload: unknown,
  write: boolean,
): {
  definition: Record<string, unknown>;
  transactionId: number;
  occurrenceDate: Date;
  expectedPlanFingerprint?: string;
} => {
  if (!isPlainObject(payload)) {
    throw new BudgetFromTransactionRequestError("payload_must_be_object");
  }
  const allowed = new Set([
    "definition",
    "transactionId",
    "occurrenceDate",
    ...(write
      ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"]
      : []),
  ]);
  if (Object.keys(payload).some((field) => !allowed.has(field))) {
    throw new BudgetFromTransactionRequestError("unexpected_payload_field");
  }
  if (!isPlainObject(payload.definition)) {
    throw new BudgetFromTransactionRequestError("definition_invalid");
  }
  if (
    typeof payload.transactionId !== "number" ||
    !Number.isInteger(payload.transactionId) ||
    payload.transactionId <= 0
  ) {
    throw new BudgetFromTransactionRequestError("transaction_id_invalid");
  }
  if (typeof payload.occurrenceDate !== "string") {
    throw new BudgetFromTransactionRequestError("occurrence_date_invalid");
  }
  let occurrenceDate: Date;
  try {
    occurrenceDate = normalizeToLocalDay(payload.occurrenceDate);
  } catch {
    throw new BudgetFromTransactionRequestError("occurrence_date_invalid");
  }
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new BudgetFromTransactionRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== BUDGET_FROM_TRANSACTION_CONFIRMATION) {
      throw new BudgetFromTransactionRequestError("matching_dry_run_required");
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      payload.expectedPlanFingerprint.length !== 64
    ) {
      throw new BudgetFromTransactionRequestError(
        "expected_plan_fingerprint_invalid",
      );
    }
  }
  return {
    definition: payload.definition,
    transactionId: payload.transactionId,
    occurrenceDate,
    ...(write
      ? { expectedPlanFingerprint: String(payload.expectedPlanFingerprint) }
      : {}),
  };
};

const generationDefinition = (
  id: number,
  definition: NormalizedBudgetDefinitionInput,
): BudgetGenerationDefinition => ({
  id,
  ...definition,
  isActive: true,
  updatedAt: new Date().toISOString(),
});

const buildPlan = (
  db: Database.Database,
  payload: ReturnType<typeof parsePayload>,
): Plan => {
  const definition = normalizeBudgetDefinitionPayload(
    payload.definition,
    "create",
  );
  const definitionDryRun = budgetDefinitionDryRun(
    db,
    payload.definition,
    "create",
  );
  const validationErrors = [...definitionDryRun.validationErrors];
  const transaction = db
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(payload.transactionId) as Row | undefined;
  if (!transaction) validationErrors.push("transaction_not_found");
  if (transaction) {
    if (Number(transaction.isTransfer ?? 0) === 1) {
      validationErrors.push("transfer_transaction_not_supported");
    }
    if (Number(transaction.categoryId) !== definition.categoryId) {
      validationErrors.push("snapshot_category_mismatch");
    }
    if (
      transaction.accountId == null ||
      Number(transaction.accountId) !== definition.accountId
    ) {
      validationErrors.push("snapshot_account_mismatch");
    }
    if (
      definition.recipientId != null &&
      Number(transaction.recipientId) !== definition.recipientId
    ) {
      validationErrors.push("snapshot_recipient_mismatch");
    }
    if (
      transaction.budgetSnapshotId != null ||
      transaction.budgetId != null ||
      transaction.occurrenceDate != null
    ) {
      validationErrors.push("transaction_already_has_budget_linkage");
    }
  }
  const targetBudgetId = Number(
    (
      db
        .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM budgets")
        .get() as { id: number }
    ).id,
  );
  try {
    const day = localDayKey(payload.occurrenceDate);
    const schedule = calculateBudgetOccurrenceSchedule(
      generationDefinition(targetBudgetId, definition),
      payload.occurrenceDate,
    );
    if (!schedule.some((item) => localDayKey(item.occurrenceDate) === day)) {
      validationErrors.push("occurrence_not_in_budget_schedule");
    }
  } catch (error) {
    validationErrors.push(
      error instanceof Error ? error.message : "recurrence_invalid",
    );
  }
  const uniqueErrors = [...new Set(validationErrors)];
  const state = {
    definition,
    transaction,
    targetBudgetId,
    transactionId: payload.transactionId,
    occurrenceDate: localDayKey(payload.occurrenceDate),
    budgetCount: (
      db.prepare("SELECT COUNT(*) AS count FROM budgets").get() as {
        count: number;
      }
    ).count,
    snapshotCount: (
      db.prepare("SELECT COUNT(*) AS count FROM budgetSnapshots").get() as {
        count: number;
      }
    ).count,
    errors: uniqueErrors,
  };
  return {
    definition,
    definitionDryRun,
    transactionId: payload.transactionId,
    occurrenceDate: payload.occurrenceDate,
    targetBudgetId,
    validationErrors: uniqueErrors,
    ...(uniqueErrors.length === 0
      ? {
          planFingerprint: createHash("sha256")
            .update(JSON.stringify(state))
            .digest("hex"),
        }
      : {}),
  };
};

const response = (
  plan: Plan | undefined,
  options: {
    dryRun: boolean;
    sqliteMutated?: boolean;
    code?: string;
    budgets?: number;
    snapshots?: number;
    transactions?: number;
  },
): BudgetFromTransactionResponse => {
  const errors = [...(plan?.validationErrors ?? [])];
  if (options.code && !errors.includes(options.code)) errors.push(options.code);
  const budgets = options.budgets ?? 0;
  const snapshots = options.snapshots ?? 0;
  const transactions = options.transactions ?? 0;
  return {
    ok: errors.length === 0,
    mode: "prototype",
    entity: "budgetFromTransaction",
    action: "createBudgetOccurrenceAndLink",
    dryRun: options.dryRun,
    wouldMutate: options.dryRun && errors.length === 0,
    sqliteMutated: options.sqliteMutated ?? false,
    dexieMutated: false,
    targetBudgetId: plan?.targetBudgetId ?? null,
    targetTransactionId: plan?.transactionId ?? null,
    occurrenceDate: plan ? localDayKey(plan.occurrenceDate) : null,
    rowsChanged: {
      budgets,
      budgetSnapshots: snapshots,
      transactions,
      total: budgets + snapshots + transactions,
    },
    validationErrors: errors,
    warnings: [],
    ...(plan?.planFingerprint
      ? { planFingerprint: plan.planFingerprint }
      : {}),
    ...(errors[0] ? { code: errors[0] } : {}),
    safety: {
      atomic: true,
      oneOccurrenceOnly: true,
      unrelatedSnapshotsMutated: false,
      unrelatedTransactionsMutated: false,
      filesWritten: false,
      rawRowsIncluded: false,
    },
  };
};

export const budgetFromTransactionDryRun = (
  db: Database.Database,
  raw: unknown,
): BudgetFromTransactionResponse =>
  response(buildPlan(db, parsePayload(raw, false)), { dryRun: true });

export const budgetFromTransactionRequestErrorResponse = (
  code: string,
): BudgetFromTransactionResponse =>
  response(undefined, { dryRun: false, code });

export const budgetFromTransactionRealWrite = (
  db: Database.Database,
  raw: unknown,
): BudgetFromTransactionResponse => {
  const payload = parsePayload(raw, true);
  return db.transaction(() => {
    const plan = buildPlan(db, payload);
    if (!plan.planFingerprint ||
        plan.planFingerprint !== payload.expectedPlanFingerprint) {
      return response(plan, {
        dryRun: false,
        code: plan.planFingerprint
          ? "budget_from_transaction_plan_stale"
          : plan.validationErrors[0],
      });
    }
    const definitionWrite = budgetDefinitionRealWrite(
      db,
      {
        ...payload.definition,
        dryRunReviewed: true,
        confirmation: BUDGET_DEFINITION_CREATE_CONFIRMATION,
      },
      "create",
    );
    if (
      !definitionWrite.ok ||
      Number(definitionWrite.targetId) !== plan.targetBudgetId
    ) {
      throw new Error("budget_from_transaction_definition_failed");
    }
    const occurrenceInput = {
      budgetId: plan.targetBudgetId,
      transactionId: plan.transactionId,
      occurrenceDate: plan.occurrenceDate.toISOString(),
    };
    const occurrenceDryRun = budgetSnapshotOccurrenceDryRun(
      db,
      occurrenceInput,
      "createAndLink",
    );
    if (!occurrenceDryRun.ok || !occurrenceDryRun.planFingerprint) {
      throw new Error("budget_from_transaction_occurrence_review_failed");
    }
    const occurrenceWrite = budgetSnapshotOccurrenceRealWrite(
      db,
      {
        ...occurrenceInput,
        dryRunReviewed: true,
        confirmation:
          BUDGET_SNAPSHOT_OCCURRENCE_CONFIRMATIONS.createAndLink,
        expectedPlanFingerprint: occurrenceDryRun.planFingerprint,
      },
      "createAndLink",
    );
    if (
      !occurrenceWrite.ok ||
      occurrenceWrite.rowsChanged.budgetSnapshots !== 1 ||
      occurrenceWrite.rowsChanged.transactions !== 1
    ) {
      throw new Error("budget_from_transaction_occurrence_failed");
    }
    return response(plan, {
      dryRun: false,
      sqliteMutated: true,
      budgets: 1,
      snapshots: 1,
      transactions: 1,
    });
  }).immediate();
};

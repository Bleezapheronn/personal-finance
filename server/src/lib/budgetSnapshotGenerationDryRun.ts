import Database from "better-sqlite3";
import {
  addLocalCalendarYear,
  calculateMissingBudgetSnapshotPlan,
  localDayKey,
  normalizeToLocalDay,
  type BudgetGenerationDefinition,
  type BudgetSnapshotGenerationPlan,
  type ExistingSnapshotIdentity,
} from "../../shared/budgetSnapshotGeneration.js";

const DRY_RUN_FIELDS = new Set(["asOf"]);
const ISO_DATE_OR_DATETIME =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export interface BudgetSnapshotGenerationDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetSnapshotLifecycle";
  action: "generateMissingSnapshots";
  dryRun: true;
  wouldMutate: false;
  normalizedAsOf: string;
  activeCoverageThrough: string;
  eligibleBudgetCount: number;
  existingSnapshotCount: number;
  proposedSnapshotCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  recurrenceSummary: Record<string, number>;
  goalDirectionSummary: {
    expense: number;
    income: number;
    amountSignFallback: number;
  };
  validationErrors: string[];
  warnings: string[];
  historicalMutation: false;
  transactionLinkMutation: false;
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    budgetsMutated: false;
    transactionsMutated: false;
    existingSnapshotsMutated: false;
    rawRowsIncluded: false;
    generatedIdsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export interface BudgetSnapshotGenerationPlanResult {
  plan: BudgetSnapshotGenerationPlan;
  response: BudgetSnapshotGenerationDryRunResponse;
}

export class BudgetSnapshotGenerationRequestError extends Error {
  statusCode: 400;
  code: string;

  constructor(code: string) {
    super(code);
    this.statusCode = 400;
    this.code = code;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const parseDateOnly = (value: string): Date => {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new BudgetSnapshotGenerationRequestError("asOf_invalid");
  }
  return normalizeToLocalDay(date);
};

export const normalizeBudgetSnapshotGenerationAsOf = (
  value: unknown,
): Date => {
  if (value === undefined) return normalizeToLocalDay(new Date());
  if (typeof value !== "string" || !ISO_DATE_OR_DATETIME.test(value)) {
    throw new BudgetSnapshotGenerationRequestError("asOf_invalid");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateOnly(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BudgetSnapshotGenerationRequestError("asOf_invalid");
  }
  return normalizeToLocalDay(date);
};

export const validateBudgetSnapshotGenerationDryRunPayload = (
  payload: unknown,
): Date => {
  if (!isPlainObject(payload)) {
    throw new BudgetSnapshotGenerationRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (!DRY_RUN_FIELDS.has(field)) {
      throw new BudgetSnapshotGenerationRequestError(
        "unexpected_payload_field",
      );
    }
  }
  return normalizeBudgetSnapshotGenerationAsOf(payload.asOf);
};

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("frequency_details_invalid");
  const parsed = JSON.parse(value) as unknown;
  if (!isPlainObject(parsed)) throw new Error("frequency_details_invalid");
  return parsed;
};

const readBudgets = (
  db: Database.Database,
): BudgetGenerationDefinition[] =>
  (
    db.prepare("SELECT * FROM budgets ORDER BY id ASC").all() as Record<
      string,
      unknown
    >[]
  ).map((row) => ({
    id: Number(row.id),
    description: String(row.description),
    categoryId: Number(row.categoryId),
    accountId: row.accountId === null ? null : Number(row.accountId),
    recipientId: row.recipientId === null ? null : Number(row.recipientId),
    amount: Number(row.amount),
    transactionCost:
      row.transactionCost === null ? null : Number(row.transactionCost),
    frequency: row.frequency as BudgetGenerationDefinition["frequency"],
    frequencyDetails: parseJsonObject(
      row.frequencyDetails,
    ) as BudgetGenerationDefinition["frequencyDetails"],
    isGoal: Number(row.isGoal),
    isFlexible: Number(row.isFlexible),
    goalPercentage:
      row.goalPercentage === null ? null : Number(row.goalPercentage),
    goalDirection:
      row.goalDirection === null
        ? null
        : (row.goalDirection as BudgetGenerationDefinition["goalDirection"]),
    isActive: Number(row.isActive),
    remainingCyclesTotal:
      row.remainingCyclesTotal === null
        ? null
        : Number(row.remainingCyclesTotal),
    dueDate: String(row.dueDate),
    updatedAt: String(row.updatedAt),
  }));

const readSnapshotIdentities = (
  db: Database.Database,
): ExistingSnapshotIdentity[] =>
  db
    .prepare(
      "SELECT id, budgetId, occurrenceDate, dueDate FROM budgetSnapshots ORDER BY id ASC",
    )
    .all() as ExistingSnapshotIdentity[];

const referenceValidationErrors = (
  db: Database.Database,
  budgets: BudgetGenerationDefinition[],
): string[] => {
  const errors = new Set<string>();
  const ids = (table: string): Set<number> =>
    new Set(
      (db.prepare(`SELECT id FROM ${table}`).all() as { id: number }[]).map(
        (row) => Number(row.id),
      ),
    );
  const categories = db
    .prepare("SELECT id, bucketId FROM categories")
    .all() as { id: number; bucketId: number }[];
  const categoryIds = new Set(categories.map((row) => Number(row.id)));
  const bucketIds = ids("buckets");
  const accountIds = ids("accounts");
  const recipientIds = ids("recipients");

  if (categories.some((row) => !bucketIds.has(Number(row.bucketId)))) {
    errors.add("category_bucket_reference_invalid");
  }
  for (const budget of budgets) {
    if (!categoryIds.has(Number(budget.categoryId))) {
      errors.add("budget_category_reference_invalid");
    }
    if (budget.accountId != null && !accountIds.has(Number(budget.accountId))) {
      errors.add("budget_account_reference_invalid");
    }
    if (
      budget.recipientId != null &&
      !recipientIds.has(Number(budget.recipientId))
    ) {
      errors.add("budget_recipient_reference_invalid");
    }
  }
  return [...errors].sort();
};

const storedBudgetValidationErrors = (
  budgets: BudgetGenerationDefinition[],
): string[] => {
  const errors = new Set<string>();
  const finite = (value: unknown): boolean =>
    typeof value === "number" && Number.isFinite(value);
  for (const budget of budgets) {
    if (typeof budget.description !== "string" || !budget.description.trim()) {
      errors.add("budget_description_invalid");
    }
    if (!Number.isInteger(budget.categoryId) || budget.categoryId <= 0) {
      errors.add("budget_category_id_invalid");
    }
    if (!finite(budget.amount)) errors.add("budget_amount_invalid");
    if (budget.transactionCost != null && !finite(budget.transactionCost)) {
      errors.add("budget_transaction_cost_invalid");
    }
    if (![0, 1, false, true].includes(budget.isGoal)) {
      errors.add("budget_is_goal_invalid");
    }
    if (![0, 1, false, true, null, undefined].includes(budget.isFlexible)) {
      errors.add("budget_is_flexible_invalid");
    }
    if (![0, 1, false, true].includes(budget.isActive)) {
      errors.add("budget_is_active_invalid");
    }
    if (
      budget.goalDirection != null &&
      budget.goalDirection !== "income" &&
      budget.goalDirection !== "expense"
    ) {
      errors.add("budget_goal_direction_invalid");
    }
    if (budget.goalPercentage != null && !finite(budget.goalPercentage)) {
      errors.add("budget_goal_percentage_invalid");
    }
    if (Number.isNaN(new Date(budget.updatedAt).getTime())) {
      errors.add("budget_updated_at_invalid");
    }
  }
  return [...errors].sort();
};

const buildResponse = (
  plan: BudgetSnapshotGenerationPlan,
  additionalValidationErrors: string[] = [],
): BudgetSnapshotGenerationDryRunResponse => {
  const validationErrors = [
    ...new Set([...plan.validationErrors, ...additionalValidationErrors]),
  ].sort();
  const warnings = [...plan.conflictCodes];
  if (plan.proposedSnapshotCount === 0 && plan.conflictCount === 0) {
    warnings.push("no_missing_snapshots");
  }
  const ok = validationErrors.length === 0 && plan.conflictCount === 0;
  return {
    ok,
    mode: "prototype",
    entity: "budgetSnapshotLifecycle",
    action: "generateMissingSnapshots",
    dryRun: true,
    wouldMutate: false,
    normalizedAsOf: plan.normalizedAsOf,
    activeCoverageThrough: plan.activeHorizon,
    eligibleBudgetCount: plan.eligibleBudgetCount,
    existingSnapshotCount: plan.existingSnapshotCount,
    proposedSnapshotCount: plan.proposedSnapshotCount,
    skippedExistingCount: plan.skippedExistingCount,
    conflictCount: plan.conflictCount,
    recurrenceSummary: plan.recurrenceSummary,
    goalDirectionSummary: {
      expense: plan.goalDirectionSummary.expense,
      income: plan.goalDirectionSummary.income,
      amountSignFallback: plan.goalDirectionSummary.fallback,
    },
    validationErrors,
    warnings,
    historicalMutation: false,
    transactionLinkMutation: false,
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      budgetsMutated: false,
      transactionsMutated: false,
      existingSnapshotsMutated: false,
      rawRowsIncluded: false,
      generatedIdsIncluded: false,
    },
    resultCodes: ok
      ? [
          plan.proposedSnapshotCount > 0
            ? "missing_snapshots_proposed"
            : "generation_noop",
          "no_mutation_performed",
        ]
      : ["generation_blocked", "no_mutation_performed"],
    ...(!ok
      ? { code: validationErrors[0] ?? plan.conflictCodes[0] }
      : {}),
  };
};

export const buildBudgetSnapshotGenerationPlan = (
  db: Database.Database,
  asOf: Date,
): BudgetSnapshotGenerationPlanResult => {
  let budgets: BudgetGenerationDefinition[] = [];
  let existingSnapshots: ExistingSnapshotIdentity[] = [];
  const adapterErrors: string[] = [];
  try {
    budgets = readBudgets(db);
    existingSnapshots = readSnapshotIdentities(db);
  } catch (error) {
    adapterErrors.push(
      error instanceof Error &&
        ["frequency_details_invalid"].includes(error.message)
        ? error.message
        : "stored_budget_data_invalid",
    );
  }
  const plan = calculateMissingBudgetSnapshotPlan({
    budgets,
    existingSnapshots,
    asOf,
  });
  const referenceErrors = budgets.length
    ? referenceValidationErrors(db, budgets)
    : [];
  return {
    plan,
    response: buildResponse(plan, [
      ...adapterErrors,
      ...referenceErrors,
      ...storedBudgetValidationErrors(budgets),
    ]),
  };
};

export const budgetSnapshotGenerationDryRun = (
  db: Database.Database,
  payload: unknown,
): BudgetSnapshotGenerationDryRunResponse => {
  const asOf = validateBudgetSnapshotGenerationDryRunPayload(payload);
  return buildBudgetSnapshotGenerationPlan(db, asOf).response;
};

export const budgetSnapshotGenerationRequestErrorResponse = (
  code: string,
  normalizedAsOf: Date = normalizeToLocalDay(new Date()),
): BudgetSnapshotGenerationDryRunResponse => {
  return buildResponse(
    {
      normalizedAsOf: localDayKey(normalizedAsOf),
      normalizedAsOfDate: normalizedAsOf,
      activeHorizon: localDayKey(addLocalCalendarYear(normalizedAsOf)),
      eligibleBudgetCount: 0,
      existingSnapshotCount: 0,
      proposedSnapshotCount: 0,
      skippedExistingCount: 0,
      conflictCount: 0,
      conflictCodes: [],
      validationErrors: [code],
      recurrenceSummary: {},
      goalDirectionSummary: { expense: 0, income: 0, fallback: 0 },
      candidates: [],
    },
    [code],
  );
};

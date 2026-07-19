import Database from "better-sqlite3";

export type BudgetDefinitionAction = "create" | "update";
export type BudgetDefinitionFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";
export type BudgetGoalDirection = "income" | "expense";

const FREQUENCIES = new Set<BudgetDefinitionFrequency>([
  "once",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
]);
const CREATE_FIELDS = new Set([
  "description",
  "categoryId",
  "accountId",
  "recipientId",
  "amount",
  "transactionCost",
  "frequency",
  "frequencyDetails",
  "isGoal",
  "isFlexible",
  "goalPercentage",
  "goalDirection",
  "remainingCyclesTotal",
  "dueDate",
]);
const UPDATE_FIELDS = new Set([...CREATE_FIELDS, "id"]);
const FORBIDDEN_FIELDS = new Set([
  "paymentChannelId",
  "isActive",
  "createdAt",
  "updatedAt",
  "budgetSnapshotId",
  "snapshotId",
  "occurrenceDate",
]);

export interface NormalizedBudgetDefinitionInput {
  id?: number;
  description: string;
  categoryId: number;
  accountId: number;
  recipientId: number | null;
  amount: number;
  transactionCost: number | null;
  frequency: BudgetDefinitionFrequency;
  frequencyDetails: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalDays?: number;
  } | null;
  isGoal: boolean;
  isFlexible: boolean;
  goalPercentage: number | null;
  goalDirection: BudgetGoalDirection | null;
  remainingCyclesTotal: number | null;
  dueDate: string;
}

export interface BudgetDefinitionDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetDefinition";
  action: BudgetDefinitionAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  targetId: number | null;
  goalDirectionSummary: {
    explicit: boolean;
    effectiveDirection: BudgetGoalDirection | null;
    amountSignFallbackUsed: boolean;
  };
  recurrenceSummary: {
    frequency: BudgetDefinitionFrequency | null;
    hasFrequencyDetails: boolean;
    remainingCyclesLimited: boolean;
    definitionWouldChange: boolean;
  };
  referenceSummary: {
    categoryExists: boolean | null;
    bucketExists: boolean | null;
    accountExists: boolean | null;
    recipientProvided: boolean;
    recipientExists: boolean | null;
    categoryWouldChange: boolean;
  };
  duplicateSummary: {
    duplicateDefinitionCandidates: number;
  };
  futureSnapshotImpactSummary: {
    definitionFieldsAffectingFutureGenerationWouldChange: boolean;
    existingSnapshotsWouldChange: false;
    snapshotGenerationWouldRun: false;
  };
  historicalSnapshotMutation: false;
  transactionLinkMutation: false;
  timestampBehavior: {
    createdAtWouldChange: boolean;
    updatedAtWouldChange: boolean;
    createdAtPreserved: boolean;
  };
  validationErrors: string[];
  warnings: string[];
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    snapshotsMutated: false;
    transactionsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BudgetDefinitionDryRunRequestError extends Error {
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

const validateFields = (
  payload: unknown,
  action: BudgetDefinitionAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new BudgetDefinitionDryRunRequestError("payload_must_be_object");
  }
  const allowed = action === "create" ? CREATE_FIELDS : UPDATE_FIELDS;
  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_FIELDS.has(field)) {
      throw new BudgetDefinitionDryRunRequestError("unsupported_write_field");
    }
    if (!allowed.has(field)) {
      throw new BudgetDefinitionDryRunRequestError(
        "unexpected_payload_field",
      );
    }
  }
  return payload;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BudgetDefinitionDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const nullablePositiveInteger = (
  value: unknown,
  field: string,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return positiveInteger(value, field);
};

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new BudgetDefinitionDryRunRequestError(`${field}_invalid`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new BudgetDefinitionDryRunRequestError(`${field}_required`);
  }
  if (normalized.length < 3 || normalized.length > 100) {
    throw new BudgetDefinitionDryRunRequestError(`${field}_length_invalid`);
  }
  return normalized;
};

const requiredBoolean = (
  value: unknown,
  field: string,
  defaultValue?: boolean,
): boolean => {
  if ((value === undefined || value === null) && defaultValue !== undefined) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new BudgetDefinitionDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const finiteNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BudgetDefinitionDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const nullableNumber = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return finiteNumber(value, field);
};

const normalizeFrequency = (value: unknown): BudgetDefinitionFrequency => {
  if (typeof value !== "string" || !FREQUENCIES.has(value as BudgetDefinitionFrequency)) {
    throw new BudgetDefinitionDryRunRequestError("frequency_invalid");
  }
  return value as BudgetDefinitionFrequency;
};

const normalizeFrequencyDetails = (
  value: unknown,
  frequency: BudgetDefinitionFrequency,
): NormalizedBudgetDefinitionInput["frequencyDetails"] => {
  if (value === undefined || value === null) {
    if (frequency === "monthly") {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_dayOfMonth_required",
      );
    }
    if (frequency === "custom") {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_intervalDays_required",
      );
    }
    return null;
  }
  if (!isPlainObject(value)) {
    throw new BudgetDefinitionDryRunRequestError("frequencyDetails_invalid");
  }
  const allowed = new Set(["dayOfMonth", "dayOfWeek", "intervalDays"]);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new BudgetDefinitionDryRunRequestError(
      "frequencyDetails_unexpected_field",
    );
  }

  if (frequency === "monthly") {
    const dayOfMonth = positiveInteger(
      value.dayOfMonth,
      "frequencyDetails_dayOfMonth",
    );
    if (dayOfMonth > 31) {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_dayOfMonth_invalid",
      );
    }
    if (value.dayOfWeek !== undefined || value.intervalDays !== undefined) {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_not_applicable",
      );
    }
    return { dayOfMonth };
  }

  if (frequency === "custom") {
    const intervalDays = positiveInteger(
      value.intervalDays,
      "frequencyDetails_intervalDays",
    );
    if (value.dayOfMonth !== undefined || value.dayOfWeek !== undefined) {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_not_applicable",
      );
    }
    return { intervalDays };
  }

  if (frequency === "weekly" && value.dayOfWeek !== undefined) {
    const dayOfWeek = value.dayOfWeek;
    if (
      typeof dayOfWeek !== "number" ||
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6
    ) {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_dayOfWeek_invalid",
      );
    }
    if (value.dayOfMonth !== undefined || value.intervalDays !== undefined) {
      throw new BudgetDefinitionDryRunRequestError(
        "frequencyDetails_not_applicable",
      );
    }
    return { dayOfWeek };
  }

  if (Object.keys(value).length > 0) {
    throw new BudgetDefinitionDryRunRequestError(
      "frequencyDetails_not_applicable",
    );
  }
  return null;
};

const normalizeDueDate = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new BudgetDefinitionDryRunRequestError("dueDate_required");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BudgetDefinitionDryRunRequestError("dueDate_invalid");
  }
  return parsed.toISOString();
};

const normalizeGoalDirection = (
  value: unknown,
): BudgetGoalDirection | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value !== "income" && value !== "expense") {
    throw new BudgetDefinitionDryRunRequestError("goalDirection_invalid");
  }
  return value;
};

export const effectiveBudgetGoalDirection = (
  goalDirection: BudgetGoalDirection | null | undefined,
  amount: number,
): BudgetGoalDirection => {
  if (goalDirection === "expense") {
    return "expense";
  }
  if (goalDirection === "income") {
    return "income";
  }
  return amount < 0 ? "expense" : "income";
};

export const budgetGoalDirectionNormalizationSanityCheck = (): boolean =>
  effectiveBudgetGoalDirection("expense", 100) === "expense" &&
  effectiveBudgetGoalDirection("income", -100) === "income" &&
  effectiveBudgetGoalDirection(null, -100) === "expense" &&
  effectiveBudgetGoalDirection(undefined, 100) === "income";

export const normalizeBudgetDefinitionPayload = (
  payload: unknown,
  action: BudgetDefinitionAction,
): NormalizedBudgetDefinitionInput => {
  const input = validateFields(payload, action);
  const goalPercentage = nullableNumber(
    input.goalPercentage,
    "goalPercentage",
  );
  if (
    goalPercentage !== null &&
    (goalPercentage <= 0 || goalPercentage > 100)
  ) {
    throw new BudgetDefinitionDryRunRequestError("goalPercentage_invalid");
  }
  const amount = finiteNumber(input.amount, "amount");
  if (amount === 0 && goalPercentage === null) {
    throw new BudgetDefinitionDryRunRequestError("amount_must_be_nonzero");
  }
  const transactionCost = nullableNumber(
    input.transactionCost,
    "transactionCost",
  );
  if (transactionCost !== null && transactionCost > 0) {
    throw new BudgetDefinitionDryRunRequestError(
      "transactionCost_sign_invalid",
    );
  }
  const frequency = normalizeFrequency(input.frequency);

  return {
    ...(action === "update"
      ? { id: positiveInteger(input.id, "id") }
      : {}),
    description: requiredText(input.description, "description"),
    categoryId: positiveInteger(input.categoryId, "categoryId"),
    accountId: positiveInteger(input.accountId, "accountId"),
    recipientId: nullablePositiveInteger(input.recipientId, "recipientId"),
    amount,
    transactionCost,
    frequency,
    frequencyDetails: normalizeFrequencyDetails(
      input.frequencyDetails,
      frequency,
    ),
    isGoal: requiredBoolean(
      input.isGoal,
      "isGoal",
      action === "create" ? false : undefined,
    ),
    isFlexible: requiredBoolean(
      input.isFlexible,
      "isFlexible",
      action === "create" ? false : undefined,
    ),
    goalPercentage,
    goalDirection: normalizeGoalDirection(input.goalDirection),
    remainingCyclesTotal: nullablePositiveInteger(
      input.remainingCyclesTotal,
      "remainingCyclesTotal",
    ),
    dueDate: normalizeDueDate(input.dueDate),
  };
};

const budgetRow = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM budgets WHERE id = @id").get({ id }) as
    | Record<string, unknown>
    | undefined;

const exists = (
  db: Database.Database,
  table: "accounts" | "buckets" | "categories" | "recipients",
  id: number,
): boolean =>
  Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = @id`).get({ id }));

const categoryBucketId = (
  db: Database.Database,
  categoryId: number,
): number | null => {
  const row = db
    .prepare("SELECT bucketId FROM categories WHERE id = @id")
    .get({ id: categoryId }) as { bucketId: number } | undefined;
  return row ? Number(row.bucketId) : null;
};

const duplicateCount = (
  db: Database.Database,
  input: NormalizedBudgetDefinitionInput,
): number => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM budgets
       WHERE LOWER(TRIM(description)) = LOWER(@description)
         AND categoryId = @categoryId
         AND accountId = @accountId
         AND dueDate = @dueDate
         AND frequency = @frequency
         AND (@excludedId IS NULL OR id <> @excludedId)`,
    )
    .get({ ...input, excludedId: input.id ?? null }) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
};

const serialized = (value: unknown): string => JSON.stringify(value ?? null);
const changed = (
  previous: Record<string, unknown> | undefined,
  input: NormalizedBudgetDefinitionInput,
  fields: (keyof NormalizedBudgetDefinitionInput)[],
): boolean =>
  !previous ||
  fields.some((field) => {
    if (field === "isFlexible") {
      return (Number(previous[field]) === 1) !== input.isFlexible;
    }
    const nextValue =
      field === "frequencyDetails" && input.frequencyDetails
        ? JSON.stringify(input.frequencyDetails)
        : input[field];
    return serialized(previous[field]) !== serialized(nextValue);
  });

const emptyResponse = (
  action: BudgetDefinitionAction,
  code: string,
): BudgetDefinitionDryRunResponse => ({
  ok: false,
  mode: "prototype",
  entity: "budgetDefinition",
  action,
  dryRun: true,
  wouldMutate: false,
  targetIdPresent: false,
  targetId: null,
  goalDirectionSummary: {
    explicit: false,
    effectiveDirection: null,
    amountSignFallbackUsed: false,
  },
  recurrenceSummary: {
    frequency: null,
    hasFrequencyDetails: false,
    remainingCyclesLimited: false,
    definitionWouldChange: false,
  },
  referenceSummary: {
    categoryExists: null,
    bucketExists: null,
    accountExists: null,
    recipientProvided: false,
    recipientExists: null,
    categoryWouldChange: false,
  },
  duplicateSummary: { duplicateDefinitionCandidates: 0 },
  futureSnapshotImpactSummary: {
    definitionFieldsAffectingFutureGenerationWouldChange: false,
    existingSnapshotsWouldChange: false,
    snapshotGenerationWouldRun: false,
  },
  historicalSnapshotMutation: false,
  transactionLinkMutation: false,
  timestampBehavior: {
    createdAtWouldChange: action === "create",
    updatedAtWouldChange: true,
    createdAtPreserved: action === "update",
  },
  validationErrors: [code],
  warnings: [],
  safety: {
    sqliteMutated: false,
    dexieMutated: false,
    filesWritten: false,
    snapshotsMutated: false,
    transactionsMutated: false,
    rawRowsIncluded: false,
  },
  resultCodes: ["dry_run_has_validation_errors", "no_mutation_performed"],
  code,
});

export const budgetDefinitionDryRun = (
  db: Database.Database,
  payload: unknown,
  action: BudgetDefinitionAction,
): BudgetDefinitionDryRunResponse => {
  const input = normalizeBudgetDefinitionPayload(payload, action);
  const previous = input.id ? budgetRow(db, input.id) : undefined;
  const validationErrors: string[] = [];
  const warnings: string[] = [
    "definition_only_existing_snapshots_unchanged",
    "historical_transaction_links_unchanged",
  ];
  if (action === "update" && !previous) {
    validationErrors.push("budget_definition_not_found");
  }

  const categoryExists = exists(db, "categories", input.categoryId);
  const bucketId = categoryExists
    ? categoryBucketId(db, input.categoryId)
    : null;
  const bucketExists =
    bucketId === null ? false : exists(db, "buckets", bucketId);
  const accountExists = exists(db, "accounts", input.accountId);
  const recipientExists =
    input.recipientId === null
      ? null
      : exists(db, "recipients", input.recipientId);
  if (!categoryExists) validationErrors.push("category_not_found");
  if (categoryExists && !bucketExists) {
    validationErrors.push("category_bucket_not_found");
  }
  if (!accountExists) validationErrors.push("account_not_found");
  if (input.recipientId !== null && !recipientExists) {
    validationErrors.push("recipient_not_found");
  }

  const duplicates = duplicateCount(db, input);
  if (duplicates > 0) warnings.push("duplicate_definition_candidates_present");

  const amountOrDirectionChanged = changed(previous, input, [
    "amount",
    "transactionCost",
    "goalPercentage",
    "goalDirection",
  ]);
  const recurrenceChanged = changed(previous, input, [
    "frequency",
    "frequencyDetails",
    "remainingCyclesTotal",
  ]);
  const dueDateChanged = changed(previous, input, ["dueDate"]);
  const categoryChanged = changed(previous, input, ["categoryId"]);
  const flexibilityChanged = changed(previous, input, ["isFlexible"]);
  const futureGenerationFieldsChanged =
    amountOrDirectionChanged ||
    recurrenceChanged ||
    dueDateChanged ||
    categoryChanged ||
    flexibilityChanged;
  if (amountOrDirectionChanged) warnings.push("amount_or_goal_direction_would_change");
  if (recurrenceChanged) warnings.push("recurrence_definition_would_change");
  if (dueDateChanged) warnings.push("due_date_anchor_would_change");
  if (categoryChanged) warnings.push("category_and_bucket_assignment_would_change");
  if (flexibilityChanged) warnings.push("flexibility_would_change");
  if (futureGenerationFieldsChanged) {
    warnings.push("future_snapshot_generation_may_use_updated_definition");
  }

  const effectiveDirection = effectiveBudgetGoalDirection(
    input.goalDirection,
    input.amount,
  );
  const targetId = input.id ?? null;
  return {
    ok: validationErrors.length === 0,
    mode: "prototype",
    entity: "budgetDefinition",
    action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: targetId !== null,
    targetId,
    goalDirectionSummary: {
      explicit: input.goalDirection !== null,
      effectiveDirection,
      amountSignFallbackUsed: input.goalDirection === null,
    },
    recurrenceSummary: {
      frequency: input.frequency,
      hasFrequencyDetails: input.frequencyDetails !== null,
      remainingCyclesLimited: input.remainingCyclesTotal !== null,
      definitionWouldChange: recurrenceChanged,
    },
    referenceSummary: {
      categoryExists,
      bucketExists,
      accountExists,
      recipientProvided: input.recipientId !== null,
      recipientExists,
      categoryWouldChange: categoryChanged,
    },
    duplicateSummary: { duplicateDefinitionCandidates: duplicates },
    futureSnapshotImpactSummary: {
      definitionFieldsAffectingFutureGenerationWouldChange:
        futureGenerationFieldsChanged,
      existingSnapshotsWouldChange: false,
      snapshotGenerationWouldRun: false,
    },
    historicalSnapshotMutation: false,
    transactionLinkMutation: false,
    timestampBehavior: {
      createdAtWouldChange: action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: action === "update",
    },
    validationErrors,
    warnings,
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      snapshotsMutated: false,
      transactionsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      validationErrors.length
        ? "dry_run_has_validation_errors"
        : "dry_run_valid",
      ...(warnings.length ? ["dry_run_has_warnings"] : []),
      "no_mutation_performed",
    ],
    ...(validationErrors[0] ? { code: validationErrors[0] } : {}),
  };
};

export const budgetDefinitionDryRunRequestErrorResponse = (
  action: BudgetDefinitionAction,
  code: string,
): BudgetDefinitionDryRunResponse => emptyResponse(action, code);

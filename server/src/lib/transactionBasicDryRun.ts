import Database from "better-sqlite3";

export type TransactionBasicAction = "create" | "update";
export type TransactionClassification = "income" | "expense";

const EDITABLE_FIELDS = new Set([
  "classification",
  "date",
  "amount",
  "originalAmount",
  "originalCurrency",
  "exchangeRate",
  "transactionReference",
  "categoryId",
  "accountId",
  "recipientId",
  "description",
]);
const ELIGIBILITY_FIELDS = new Set([
  "paymentChannelId",
  "transactionCost",
  "transferPairId",
  "isTransfer",
  "budgetId",
  "occurrenceDate",
  "budgetSnapshotId",
]);
const MAX_AMOUNT = 999_999_999.99;
const MAX_TRANSACTION_COST = 999_999.99;

export interface TransactionWriteCapabilities {
  costBudget: boolean;
}

export interface NormalizedBasicTransactionInput {
  id?: number;
  classification: TransactionClassification;
  date: string;
  amount: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  exchangeRate: number | null;
  transactionReference: string | null;
  categoryId: number;
  accountId: number;
  recipientId: number;
  description: string;
  transactionCost: number | null;
  budgetId: number | null;
  occurrenceDate: string | null;
  budgetSnapshotId: number | null;
}

export type TransactionCostClassification = "none" | "zero" | "negative";
export type BudgetLinkageAction =
  | "none"
  | "preserve"
  | "link"
  | "change"
  | "unlink";

export interface TransactionBasicDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "transaction";
  action: TransactionBasicAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  targetId: number | null;
  classification: TransactionClassification | null;
  foreignKeyPresence: {
    account: boolean;
    category: boolean;
    recipient: boolean;
    bucketViaCategory: boolean;
    budget: boolean;
    budgetSnapshot: boolean;
  };
  transactionCostPresence: boolean;
  transactionCostClassification: TransactionCostClassification;
  budgetSnapshotLinkagePresence: boolean;
  budgetLinkageAction: BudgetLinkageAction;
  validationErrors: string[];
  warnings: string[];
  unsupportedReasons: string[];
  financialEffectSummary: {
    accountBalanceWouldChange: boolean;
    reportTotalsWouldChange: boolean;
    amountDelta: number;
    transactionCostDelta: number;
    combinedDelta: number;
  };
  reportEffectSummary: {
    combinedTotalDelta: number;
  };
  budgetHistoryEffectSummary: {
    membershipWouldChange: boolean;
    linkedBudgetIdPresent: boolean;
    linkedBudgetSnapshotIdPresent: boolean;
    combinedTotalDelta: number;
  };
  timestampBehavior: {
    timestampsPresent: false;
    createdAtWouldChange: false;
    updatedAtWouldChange: false;
  };
  affectedSummary: {
    transactionRowsWouldChange: 0;
    relatedTransactionRowsWouldChange: 0;
    accountRowsWouldChange: 0;
    lookupRowsWouldChange: 0;
    budgetRowsWouldChange: 0;
    budgetSnapshotRowsWouldChange: 0;
  };
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class TransactionBasicDryRunRequestError extends Error {
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
  action: TransactionBasicAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new TransactionBasicDryRunRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    const allowed =
      EDITABLE_FIELDS.has(field) ||
      ELIGIBILITY_FIELDS.has(field) ||
      (action === "update" && field === "id");
    if (!allowed || (action === "create" && field === "id")) {
      throw new TransactionBasicDryRunRequestError(
        "unexpected_payload_field",
      );
    }
  }
  return payload;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const requiredText = (
  value: unknown,
  field: string,
  minLength = 1,
  maxLength?: number,
): string => {
  if (typeof value !== "string") {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength) {
    throw new TransactionBasicDryRunRequestError(`${field}_required`);
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new TransactionBasicDryRunRequestError(`${field}_too_long`);
  }
  return normalized;
};

const optionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  const normalized = value.trim();
  return normalized || null;
};

const finiteOptionalNumber = (
  value: unknown,
  field: string,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const classification = (value: unknown): TransactionClassification => {
  if (value !== "income" && value !== "expense") {
    throw new TransactionBasicDryRunRequestError("classification_invalid");
  }
  return value;
};

const signedAmount = (
  value: unknown,
  kind: TransactionClassification,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value === 0 ||
    Math.abs(value) > MAX_AMOUNT
  ) {
    throw new TransactionBasicDryRunRequestError("amount_invalid");
  }
  if ((kind === "income" && value < 0) || (kind === "expense" && value > 0)) {
    throw new TransactionBasicDryRunRequestError(
      "amount_sign_does_not_match_classification",
    );
  }
  return value;
};

const normalizedDate = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TransactionBasicDryRunRequestError("date_invalid");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TransactionBasicDryRunRequestError("date_invalid");
  }
  return parsed.toISOString();
};

const normalizedOriginalAmount = (
  value: unknown,
  kind: TransactionClassification,
): number | null => {
  const parsed = finiteOptionalNumber(value, "originalAmount");
  if (parsed === null) {
    return null;
  }
  return kind === "expense" ? -Math.abs(parsed) : Math.abs(parsed);
};

const normalizedTransactionCost = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TransactionBasicDryRunRequestError("transactionCost_invalid");
  }
  if (value > 0) {
    throw new TransactionBasicDryRunRequestError(
      "transactionCost_must_be_non_positive",
    );
  }
  if (Math.abs(value) > MAX_TRANSACTION_COST) {
    throw new TransactionBasicDryRunRequestError(
      "transactionCost_too_large",
    );
  }
  return Object.is(value, -0) || value === 0 ? 0 : value;
};

const optionalPositiveInteger = (
  value: unknown,
  field: string,
): number | null => {
  if (value === undefined || value === null) {
    return null;
  }
  return positiveInteger(value, field);
};

const optionalDate = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TransactionBasicDryRunRequestError(`${field}_invalid`);
  }
  return parsed.toISOString();
};

export const normalizeBasicTransactionPayload = (
  payload: unknown,
  action: TransactionBasicAction,
): NormalizedBasicTransactionInput => {
  const input = validateFields(payload, action);
  const kind = classification(input.classification);

  return {
    ...(action === "update" ? { id: positiveInteger(input.id, "id") } : {}),
    classification: kind,
    date: normalizedDate(input.date),
    amount: signedAmount(input.amount, kind),
    originalAmount: normalizedOriginalAmount(input.originalAmount, kind),
    originalCurrency: optionalText(input.originalCurrency, "originalCurrency"),
    exchangeRate: finiteOptionalNumber(input.exchangeRate, "exchangeRate"),
    transactionReference: optionalText(
      input.transactionReference,
      "transactionReference",
    ),
    categoryId: positiveInteger(input.categoryId, "categoryId"),
    accountId: positiveInteger(input.accountId, "accountId"),
    recipientId: positiveInteger(input.recipientId, "recipientId"),
    description: requiredText(input.description, "description", 2, 500),
    transactionCost: normalizedTransactionCost(input.transactionCost),
    budgetId: optionalPositiveInteger(input.budgetId, "budgetId"),
    occurrenceDate: optionalDate(input.occurrenceDate, "occurrenceDate"),
    budgetSnapshotId: optionalPositiveInteger(
      input.budgetSnapshotId,
      "budgetSnapshotId",
    ),
  };
};

const present = (
  db: Database.Database,
  table: "accounts" | "budgets" | "buckets" | "categories" | "recipients",
  id: number,
): boolean =>
  db.prepare(`SELECT 1 FROM ${table} WHERE id = @id`).get({ id }) !== undefined;

const transactionRow = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM transactions WHERE id = @id").get({ id }) as
    | Record<string, unknown>
    | undefined;

const hasOwn = (record: Record<string, unknown>, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, field);

export const transactionPayloadRequestsCostBudgetWrite = (
  payload: unknown,
): boolean => {
  if (!isPlainObject(payload)) {
    return false;
  }
  const cost = payload.transactionCost;
  return (
    (cost !== undefined && cost !== null && cost !== 0) ||
    hasOwn(payload, "budgetId") ||
    hasOwn(payload, "occurrenceDate") ||
    hasOwn(payload, "budgetSnapshotId")
  );
};

const unsupportedPayloadReasons = (
  payload: Record<string, unknown>,
  capabilities: TransactionWriteCapabilities,
): string[] => {
  const reasons: string[] = [];
  if (payload.isTransfer !== undefined && payload.isTransfer !== null && payload.isTransfer !== false) {
    reasons.push("transfers_not_supported");
  }
  if (payload.transferPairId !== undefined && payload.transferPairId !== null) {
    reasons.push("transfer_pair_not_supported");
  }
  if (
    !capabilities.costBudget &&
    payload.transactionCost !== undefined &&
    payload.transactionCost !== null &&
    payload.transactionCost !== 0
  ) {
    reasons.push("nonzero_transaction_cost_not_supported");
  }
  if (payload.paymentChannelId !== undefined && payload.paymentChannelId !== null) {
    reasons.push("legacy_payment_channel_not_supported");
  }
  if (
    !capabilities.costBudget &&
    payload.budgetId !== undefined &&
    payload.budgetId !== null
  ) {
    reasons.push("legacy_budget_link_not_supported");
  }
  if (
    !capabilities.costBudget &&
    payload.occurrenceDate !== undefined &&
    payload.occurrenceDate !== null
  ) {
    reasons.push("budget_occurrence_link_not_supported");
  }
  if (
    !capabilities.costBudget &&
    payload.budgetSnapshotId !== undefined &&
    payload.budgetSnapshotId !== null
  ) {
    reasons.push("budget_snapshot_link_not_supported");
  }
  return reasons;
};

interface SnapshotLinkRow {
  id: number;
  budgetId: number;
  dueDate: string;
  goalDirection: string | null;
}

interface ResolvedBudgetLinkage {
  budgetId: number | null;
  occurrenceDate: string | null;
  budgetSnapshotId: number | null;
  budgetPresent: boolean;
  budgetSnapshotPresent: boolean;
  action: BudgetLinkageAction;
  validationErrors: string[];
}

const snapshotLinkRow = (
  db: Database.Database,
  id: number,
): SnapshotLinkRow | undefined =>
  db
    .prepare(
      `SELECT id, budgetId, dueDate, goalDirection
       FROM budgetSnapshots
       WHERE id = @id`,
    )
    .get({ id }) as SnapshotLinkRow | undefined;

const normalizedStoredDate = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const targetBudgetLinkageReasons = (
  db: Database.Database,
  row: Record<string, unknown>,
): string[] => {
  const snapshotId =
    typeof row.budgetSnapshotId === "number" ? row.budgetSnapshotId : null;
  const budgetId = typeof row.budgetId === "number" ? row.budgetId : null;
  const occurrenceDate = normalizedStoredDate(row.occurrenceDate);

  if (snapshotId === null) {
    return budgetId !== null || row.occurrenceDate != null
      ? ["target_has_legacy_only_budget_link"]
      : [];
  }

  const snapshot = snapshotLinkRow(db, snapshotId);
  if (!snapshot) {
    return ["target_budget_snapshot_not_found"];
  }
  if (!present(db, "budgets", snapshot.budgetId)) {
    return ["target_snapshot_parent_budget_not_found"];
  }
  if (budgetId !== snapshot.budgetId) {
    return ["target_budget_snapshot_budget_mismatch"];
  }
  const snapshotDueDate = normalizedStoredDate(snapshot.dueDate);
  if (!occurrenceDate || !snapshotDueDate || occurrenceDate !== snapshotDueDate) {
    return ["target_budget_occurrence_mismatch"];
  }
  return [];
};

const targetEligibilityReasons = (
  db: Database.Database,
  row: Record<string, unknown>,
  payload: Record<string, unknown>,
  capabilities: TransactionWriteCapabilities,
): string[] => {
  const reasons: string[] = [];
  if (row.isTransfer === 1 || row.isTransfer === true) {
    reasons.push("target_is_transfer");
  }
  if (row.transferPairId !== null && row.transferPairId !== undefined) {
    reasons.push("target_has_transfer_pair");
  }
  const incomingPair = db
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE transferPairId = @id",
    )
    .get({ id: row.id }) as { count: number };
  if (incomingPair.count > 0) {
    reasons.push("target_is_referenced_as_transfer_pair");
  }
  const hasCost =
    row.transactionCost !== null &&
    row.transactionCost !== undefined &&
    row.transactionCost !== 0;
  const hasBudgetLink =
    row.budgetId != null ||
    row.occurrenceDate != null ||
    row.budgetSnapshotId != null;

  if (!capabilities.costBudget) {
    if (hasCost) reasons.push("target_has_nonzero_transaction_cost");
    if (row.budgetId != null) reasons.push("target_has_legacy_budget_link");
    if (row.occurrenceDate != null) {
      reasons.push("target_has_budget_occurrence_link");
    }
    if (row.budgetSnapshotId != null) {
      reasons.push("target_has_budget_snapshot_link");
    }
    return reasons;
  }

  if (hasCost) {
    if (typeof row.transactionCost !== "number" || row.transactionCost > 0) {
      reasons.push("target_has_invalid_transaction_cost");
    }
    if (!hasOwn(payload, "transactionCost")) {
      reasons.push("transaction_cost_explicit_value_required");
    }
  }
  if (hasBudgetLink) {
    reasons.push(...targetBudgetLinkageReasons(db, row));
    if (!hasOwn(payload, "budgetSnapshotId")) {
      reasons.push("budget_snapshot_explicit_value_required");
    }
  }
  return reasons;
};

const resolveBudgetLinkage = (
  db: Database.Database,
  raw: Record<string, unknown>,
  normalized: NormalizedBasicTransactionInput,
  target: Record<string, unknown> | undefined,
): ResolvedBudgetLinkage => {
  const explicitSnapshot = hasOwn(raw, "budgetSnapshotId");
  const previousSnapshotId =
    typeof target?.budgetSnapshotId === "number"
      ? target.budgetSnapshotId
      : null;

  if (!explicitSnapshot) {
    return {
      budgetId: null,
      occurrenceDate: null,
      budgetSnapshotId: null,
      budgetPresent: false,
      budgetSnapshotPresent: false,
      action: "none",
      validationErrors: [],
    };
  }

  if (normalized.budgetSnapshotId === null) {
    const validationErrors: string[] = [];
    if (normalized.budgetId !== null) {
      validationErrors.push("budgetId_requires_budgetSnapshotId");
    }
    if (normalized.occurrenceDate !== null) {
      validationErrors.push("occurrenceDate_requires_budgetSnapshotId");
    }
    return {
      budgetId: null,
      occurrenceDate: null,
      budgetSnapshotId: null,
      budgetPresent: false,
      budgetSnapshotPresent: false,
      action: previousSnapshotId === null ? "none" : "unlink",
      validationErrors,
    };
  }

  const snapshot = snapshotLinkRow(db, normalized.budgetSnapshotId);
  if (!snapshot) {
    return {
      budgetId: null,
      occurrenceDate: null,
      budgetSnapshotId: normalized.budgetSnapshotId,
      budgetPresent: false,
      budgetSnapshotPresent: false,
      action: previousSnapshotId === null ? "link" : "change",
      validationErrors: ["budget_snapshot_not_found"],
    };
  }

  const budgetPresent = present(db, "budgets", snapshot.budgetId);
  const dueDate = normalizedStoredDate(snapshot.dueDate);
  const validationErrors: string[] = [];
  if (!budgetPresent) {
    validationErrors.push("snapshot_parent_budget_not_found");
  }
  if (
    normalized.budgetId !== null &&
    normalized.budgetId !== snapshot.budgetId
  ) {
    validationErrors.push("budget_snapshot_budget_mismatch");
  }
  if (!dueDate) {
    validationErrors.push("snapshot_due_date_invalid");
  } else if (
    normalized.occurrenceDate !== null &&
    normalized.occurrenceDate !== dueDate
  ) {
    validationErrors.push("budget_snapshot_occurrence_mismatch");
  }

  return {
    budgetId: snapshot.budgetId,
    occurrenceDate: dueDate,
    budgetSnapshotId: snapshot.id,
    budgetPresent,
    budgetSnapshotPresent: true,
    action:
      previousSnapshotId === null
        ? "link"
        : previousSnapshotId === snapshot.id
          ? "preserve"
          : "change",
    validationErrors,
  };
};

const categoryBucketPresence = (
  db: Database.Database,
  categoryId: number,
): boolean => {
  const row = db
    .prepare("SELECT bucketId FROM categories WHERE id = @id")
    .get({ id: categoryId }) as { bucketId: number } | undefined;
  return row !== undefined && present(db, "buckets", row.bucketId);
};

const response = (input: {
  action: TransactionBasicAction;
  targetId: number | null;
  classification?: TransactionClassification;
  accountPresent?: boolean;
  categoryPresent?: boolean;
  recipientPresent?: boolean;
  bucketPresent?: boolean;
  budgetPresent?: boolean;
  budgetSnapshotPresent?: boolean;
  transactionCost?: number | null;
  budgetId?: number | null;
  budgetSnapshotId?: number | null;
  budgetLinkageAction?: BudgetLinkageAction;
  validationErrors?: string[];
  unsupportedReasons?: string[];
  amountDelta?: number;
  transactionCostDelta?: number;
  budgetHistoryMembershipWouldChange?: boolean;
  code?: string;
}): TransactionBasicDryRunResponse => {
  const validationErrors = input.validationErrors ?? [];
  const unsupportedReasons = input.unsupportedReasons ?? [];
  const amountDelta = input.amountDelta ?? 0;
  const transactionCostDelta = input.transactionCostDelta ?? 0;
  const combinedDelta = amountDelta + transactionCostDelta;
  const transactionCost = input.transactionCost ?? null;
  const budgetSnapshotId = input.budgetSnapshotId ?? null;

  return {
    ok: validationErrors.length === 0 && unsupportedReasons.length === 0,
    mode: "prototype",
    entity: "transaction",
    action: input.action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    classification: input.classification ?? null,
    foreignKeyPresence: {
      account: input.accountPresent ?? false,
      category: input.categoryPresent ?? false,
      recipient: input.recipientPresent ?? false,
      bucketViaCategory: input.bucketPresent ?? false,
      budget: input.budgetPresent ?? false,
      budgetSnapshot: input.budgetSnapshotPresent ?? false,
    },
    transactionCostPresence:
      transactionCost !== null && transactionCost !== 0,
    transactionCostClassification:
      transactionCost === null
        ? "none"
        : transactionCost === 0
          ? "zero"
          : "negative",
    budgetSnapshotLinkagePresence: budgetSnapshotId !== null,
    budgetLinkageAction: input.budgetLinkageAction ?? "none",
    validationErrors,
    warnings:
      validationErrors.length === 0 && unsupportedReasons.length === 0
        ? ["derived_account_balance_and_report_totals_would_change"]
        : [],
    unsupportedReasons,
    financialEffectSummary: {
      accountBalanceWouldChange: combinedDelta !== 0,
      reportTotalsWouldChange: combinedDelta !== 0,
      amountDelta,
      transactionCostDelta,
      combinedDelta,
    },
    reportEffectSummary: {
      combinedTotalDelta: combinedDelta,
    },
    budgetHistoryEffectSummary: {
      membershipWouldChange:
        input.budgetHistoryMembershipWouldChange ?? false,
      linkedBudgetIdPresent: input.budgetId != null,
      linkedBudgetSnapshotIdPresent: budgetSnapshotId !== null,
      combinedTotalDelta: combinedDelta,
    },
    timestampBehavior: {
      timestampsPresent: false,
      createdAtWouldChange: false,
      updatedAtWouldChange: false,
    },
    affectedSummary: {
      transactionRowsWouldChange: 0,
      relatedTransactionRowsWouldChange: 0,
      accountRowsWouldChange: 0,
      lookupRowsWouldChange: 0,
      budgetRowsWouldChange: 0,
      budgetSnapshotRowsWouldChange: 0,
    },
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      validationErrors.length > 0 || unsupportedReasons.length > 0
        ? "dry_run_has_validation_errors"
        : "dry_run_valid",
      ...(unsupportedReasons.length > 0 ? ["unsupported_phase_1_feature"] : []),
      "no_mutation_performed",
    ],
    ...(input.code ? { code: input.code } : {}),
  };
};

export const transactionBasicDryRun = (
  db: Database.Database,
  payload: unknown,
  action: TransactionBasicAction,
  capabilities: TransactionWriteCapabilities = { costBudget: false },
): TransactionBasicDryRunResponse => {
  const raw = validateFields(payload, action);
  const normalized = normalizeBasicTransactionPayload(raw, action);
  const validationErrors: string[] = [];
  const unsupportedReasons = unsupportedPayloadReasons(raw, capabilities);
  const targetId = action === "update" ? normalized.id ?? null : null;
  const target =
    action === "update" && normalized.id !== undefined
      ? transactionRow(db, normalized.id)
      : undefined;

  if (action === "update" && !target) {
    validationErrors.push("transaction_not_found");
  }
  if (target) {
    unsupportedReasons.push(
      ...targetEligibilityReasons(db, target, raw, capabilities),
    );
  }

  const accountPresent = present(db, "accounts", normalized.accountId);
  const categoryPresent = present(db, "categories", normalized.categoryId);
  const recipientPresent = present(db, "recipients", normalized.recipientId);
  const bucketPresent =
    categoryPresent && categoryBucketPresence(db, normalized.categoryId);

  if (!accountPresent) validationErrors.push("account_not_found");
  if (!categoryPresent) validationErrors.push("category_not_found");
  if (!recipientPresent) validationErrors.push("recipient_not_found");
  if (categoryPresent && !bucketPresent) {
    validationErrors.push("category_bucket_not_found");
  }

  const linkage = capabilities.costBudget
    ? resolveBudgetLinkage(db, raw, normalized, target)
    : {
        budgetId: null,
        occurrenceDate: null,
        budgetSnapshotId: null,
        budgetPresent: false,
        budgetSnapshotPresent: false,
        action: "none" as const,
        validationErrors: [],
      };
  validationErrors.push(...linkage.validationErrors);

  const previousAmount =
    target && typeof target.amount === "number" ? target.amount : 0;
  const previousCost =
    target && typeof target.transactionCost === "number"
      ? target.transactionCost
      : 0;
  const amountDelta =
    action === "create" ? normalized.amount : normalized.amount - previousAmount;
  const transactionCostDelta =
    action === "create"
      ? normalized.transactionCost ?? 0
      : (normalized.transactionCost ?? 0) - previousCost;
  const previousSnapshotId =
    target && typeof target.budgetSnapshotId === "number"
      ? target.budgetSnapshotId
      : null;
  const budgetHistoryMembershipWouldChange =
    hasOwn(raw, "budgetSnapshotId") &&
    previousSnapshotId !== linkage.budgetSnapshotId;
  const code = validationErrors[0] ?? unsupportedReasons[0];

  return response({
    action,
    targetId,
    classification: normalized.classification,
    accountPresent,
    categoryPresent,
    recipientPresent,
    bucketPresent,
    budgetPresent: linkage.budgetPresent,
    budgetSnapshotPresent: linkage.budgetSnapshotPresent,
    transactionCost: normalized.transactionCost,
    budgetId: linkage.budgetId,
    budgetSnapshotId: linkage.budgetSnapshotId,
    budgetLinkageAction: linkage.action,
    validationErrors,
    unsupportedReasons: [...new Set(unsupportedReasons)],
    amountDelta,
    transactionCostDelta,
    budgetHistoryMembershipWouldChange,
    code,
  });
};

export const normalizeTransactionPayloadForWrite = (
  db: Database.Database,
  payload: unknown,
  action: TransactionBasicAction,
  capabilities: TransactionWriteCapabilities,
): NormalizedBasicTransactionInput => {
  const raw = validateFields(payload, action);
  const normalized = normalizeBasicTransactionPayload(raw, action);
  const target =
    action === "update" && normalized.id !== undefined
      ? transactionRow(db, normalized.id)
      : undefined;
  const linkage = capabilities.costBudget
    ? resolveBudgetLinkage(db, raw, normalized, target)
    : {
        budgetId: null,
        occurrenceDate: null,
        budgetSnapshotId: null,
      };

  return {
    ...normalized,
    budgetId: linkage.budgetId,
    occurrenceDate: linkage.occurrenceDate,
    budgetSnapshotId: linkage.budgetSnapshotId,
  };
};

export const transactionBasicDryRunRequestErrorResponse = (
  action: TransactionBasicAction,
  code: string,
): TransactionBasicDryRunResponse =>
  response({
    action,
    targetId: null,
    validationErrors: [code],
    code,
  });

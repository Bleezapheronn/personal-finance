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
}

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
    budget: false;
    budgetSnapshot: false;
  };
  validationErrors: string[];
  warnings: string[];
  unsupportedReasons: string[];
  financialEffectSummary: {
    accountBalanceWouldChange: boolean;
    reportTotalsWouldChange: boolean;
    amountDelta: number;
    transactionCostDelta: 0;
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

const normalizedZeroCost = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TransactionBasicDryRunRequestError("transactionCost_invalid");
  }
  return Object.is(value, -0) || value === 0 ? 0 : value;
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
    transactionCost: normalizedZeroCost(input.transactionCost),
  };
};

const present = (
  db: Database.Database,
  table: "accounts" | "buckets" | "categories" | "recipients",
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

const unsupportedPayloadReasons = (
  payload: Record<string, unknown>,
): string[] => {
  const reasons: string[] = [];
  if (payload.isTransfer !== undefined && payload.isTransfer !== null && payload.isTransfer !== false) {
    reasons.push("transfers_not_supported");
  }
  if (payload.transferPairId !== undefined && payload.transferPairId !== null) {
    reasons.push("transfer_pair_not_supported");
  }
  if (payload.transactionCost !== undefined && payload.transactionCost !== null && payload.transactionCost !== 0) {
    reasons.push("nonzero_transaction_cost_not_supported");
  }
  if (payload.paymentChannelId !== undefined && payload.paymentChannelId !== null) {
    reasons.push("legacy_payment_channel_not_supported");
  }
  if (payload.budgetId !== undefined && payload.budgetId !== null) {
    reasons.push("legacy_budget_link_not_supported");
  }
  if (payload.occurrenceDate !== undefined && payload.occurrenceDate !== null) {
    reasons.push("budget_occurrence_link_not_supported");
  }
  if (payload.budgetSnapshotId !== undefined && payload.budgetSnapshotId !== null) {
    reasons.push("budget_snapshot_link_not_supported");
  }
  return reasons;
};

const targetEligibilityReasons = (
  db: Database.Database,
  row: Record<string, unknown>,
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
  if (
    row.transactionCost !== null &&
    row.transactionCost !== undefined &&
    row.transactionCost !== 0
  ) {
    reasons.push("target_has_nonzero_transaction_cost");
  }
  if (row.budgetId !== null && row.budgetId !== undefined) {
    reasons.push("target_has_legacy_budget_link");
  }
  if (row.occurrenceDate !== null && row.occurrenceDate !== undefined) {
    reasons.push("target_has_budget_occurrence_link");
  }
  if (row.budgetSnapshotId !== null && row.budgetSnapshotId !== undefined) {
    reasons.push("target_has_budget_snapshot_link");
  }
  return reasons;
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
  validationErrors?: string[];
  unsupportedReasons?: string[];
  amountDelta?: number;
  code?: string;
}): TransactionBasicDryRunResponse => {
  const validationErrors = input.validationErrors ?? [];
  const unsupportedReasons = input.unsupportedReasons ?? [];
  const amountDelta = input.amountDelta ?? 0;

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
      budget: false,
      budgetSnapshot: false,
    },
    validationErrors,
    warnings:
      validationErrors.length === 0 && unsupportedReasons.length === 0
        ? ["derived_account_balance_and_report_totals_would_change"]
        : [],
    unsupportedReasons,
    financialEffectSummary: {
      accountBalanceWouldChange: amountDelta !== 0,
      reportTotalsWouldChange: amountDelta !== 0,
      amountDelta,
      transactionCostDelta: 0,
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
): TransactionBasicDryRunResponse => {
  const raw = validateFields(payload, action);
  const normalized = normalizeBasicTransactionPayload(raw, action);
  const validationErrors: string[] = [];
  const unsupportedReasons = unsupportedPayloadReasons(raw);
  const targetId = action === "update" ? normalized.id ?? null : null;
  const target =
    action === "update" && normalized.id !== undefined
      ? transactionRow(db, normalized.id)
      : undefined;

  if (action === "update" && !target) {
    validationErrors.push("transaction_not_found");
  }
  if (target) {
    unsupportedReasons.push(...targetEligibilityReasons(db, target));
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

  const previousNet =
    target && typeof target.amount === "number"
      ? target.amount +
        (typeof target.transactionCost === "number"
          ? target.transactionCost
          : 0)
      : 0;
  const amountDelta =
    action === "create" ? normalized.amount : normalized.amount - previousNet;
  const code = validationErrors[0] ?? unsupportedReasons[0];

  return response({
    action,
    targetId,
    classification: normalized.classification,
    accountPresent,
    categoryPresent,
    recipientPresent,
    bucketPresent,
    validationErrors,
    unsupportedReasons: [...new Set(unsupportedReasons)],
    amountDelta,
    code,
  });
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

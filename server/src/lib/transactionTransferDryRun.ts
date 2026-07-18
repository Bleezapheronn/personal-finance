import Database from "better-sqlite3";

export type TransactionTransferAction = "create" | "update";

const DATA_FIELDS = new Set([
  "id",
  "sourceAccountId",
  "destinationAccountId",
  "sourceRecipientId",
  "destinationRecipientId",
  "date",
  "amount",
  "transactionCost",
  "originalAmount",
  "originalCurrency",
  "exchangeRate",
  "transactionReference",
  "categoryId",
  "description",
]);
const MAX_AMOUNT = 999_999_999.99;
const MAX_TRANSACTION_COST = 999_999.99;

export interface NormalizedTransferInput {
  id?: number;
  sourceAccountId: number;
  destinationAccountId: number;
  sourceRecipientId: number;
  destinationRecipientId: number;
  date: string;
  amount: number;
  transactionCost: number | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  exchangeRate: number | null;
  transactionReference: string | null;
  categoryId: number;
  description: string;
}

export interface TransferPairRows {
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
}

export interface TransactionTransferDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "transfer";
  action: TransactionTransferAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  pairValidated: boolean;
  sourceAccountPresent: boolean;
  destinationAccountPresent: boolean;
  accountsDistinct: boolean;
  amountSignsValid: boolean;
  amountsBalanced: boolean;
  transactionCostPresence: boolean;
  pairIntegritySummary: {
    exactlyTwoRows: boolean;
    reciprocal: boolean;
    selfReference: boolean;
    thirdPartyReferences: boolean;
  };
  financialEffectSummary: {
    sourceWouldDecrease: boolean;
    destinationWouldIncrease: boolean;
    overallNetAffectedByCostOnly: boolean;
  };
  validationErrors: string[];
  warnings: string[];
  unsupportedReasons: string[];
  timestampBehavior: {
    timestampsPresent: false;
    createdAtWouldChange: false;
    updatedAtWouldChange: false;
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

export class TransactionTransferDryRunRequestError extends Error {
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
  action: TransactionTransferAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new TransactionTransferDryRunRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (!DATA_FIELDS.has(field) || (action === "create" && field === "id")) {
      throw new TransactionTransferDryRunRequestError(
        "unexpected_payload_field",
      );
    }
  }
  return payload;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TransactionTransferDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const optionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TransactionTransferDryRunRequestError(`${field}_invalid`);
  }
  return value.trim() || null;
};

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new TransactionTransferDryRunRequestError(`${field}_invalid`);
  }
  const normalized = value.trim();
  if (normalized.length < 2) {
    throw new TransactionTransferDryRunRequestError(`${field}_required`);
  }
  if (normalized.length > 500) {
    throw new TransactionTransferDryRunRequestError(`${field}_too_long`);
  }
  return normalized;
};

const optionalNumber = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TransactionTransferDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const normalizedDate = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TransactionTransferDryRunRequestError("date_invalid");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TransactionTransferDryRunRequestError("date_invalid");
  }
  return parsed.toISOString();
};

export const normalizeTransferPayload = (
  payload: unknown,
  action: TransactionTransferAction,
): NormalizedTransferInput => {
  const input = validateFields(payload, action);
  if (
    typeof input.amount !== "number" ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_AMOUNT
  ) {
    throw new TransactionTransferDryRunRequestError("amount_invalid");
  }
  const transactionCost = optionalNumber(
    input.transactionCost,
    "transactionCost",
  );
  if (
    transactionCost !== null &&
    (transactionCost > 0 || Math.abs(transactionCost) > MAX_TRANSACTION_COST)
  ) {
    throw new TransactionTransferDryRunRequestError(
      transactionCost > 0
        ? "transactionCost_must_be_non_positive"
        : "transactionCost_too_large",
    );
  }
  const originalAmount = optionalNumber(input.originalAmount, "originalAmount");
  if (originalAmount !== null && originalAmount <= 0) {
    throw new TransactionTransferDryRunRequestError(
      "originalAmount_must_be_positive",
    );
  }

  return {
    ...(action === "update" ? { id: positiveInteger(input.id, "id") } : {}),
    sourceAccountId: positiveInteger(
      input.sourceAccountId,
      "sourceAccountId",
    ),
    destinationAccountId: positiveInteger(
      input.destinationAccountId,
      "destinationAccountId",
    ),
    sourceRecipientId: positiveInteger(
      input.sourceRecipientId,
      "sourceRecipientId",
    ),
    destinationRecipientId: positiveInteger(
      input.destinationRecipientId,
      "destinationRecipientId",
    ),
    date: normalizedDate(input.date),
    amount: input.amount,
    transactionCost:
      transactionCost === null || transactionCost === 0
        ? transactionCost
        : -Math.abs(transactionCost),
    originalAmount,
    originalCurrency: optionalText(input.originalCurrency, "originalCurrency"),
    exchangeRate: optionalNumber(input.exchangeRate, "exchangeRate"),
    transactionReference: optionalText(
      input.transactionReference,
      "transactionReference",
    ),
    categoryId: positiveInteger(input.categoryId, "categoryId"),
    description: requiredText(input.description, "description"),
  };
};

const rowById = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM transactions WHERE id = @id").get({ id }) as
    | Record<string, unknown>
    | undefined;

const rowId = (row: Record<string, unknown>): number | null =>
  typeof row.id === "number" && Number.isInteger(row.id) ? row.id : null;

const pairId = (row: Record<string, unknown>): number | null =>
  typeof row.transferPairId === "number" &&
  Number.isInteger(row.transferPairId)
    ? row.transferPairId
    : null;

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const sameInstant = (left: unknown, right: unknown): boolean => {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
};

export const validateTransferPair = (
  db: Database.Database,
  targetId: number,
): { rows?: TransferPairRows; errors: string[] } => {
  const errors: string[] = [];
  const target = rowById(db, targetId);
  if (!target) {
    return { errors: ["transaction_not_found"] };
  }
  const targetPairId = pairId(target);
  if (targetPairId === null) {
    return { errors: ["transfer_pair_missing"] };
  }
  if (targetPairId === targetId) {
    return { errors: ["transfer_pair_self_reference"] };
  }
  const paired = rowById(db, targetPairId);
  if (!paired) {
    return { errors: ["transfer_pair_not_found"] };
  }
  if (pairId(paired) !== targetId) {
    errors.push("transfer_pair_not_reciprocal");
  }
  if (
    (target.isTransfer !== 1 && target.isTransfer !== true) ||
    (paired.isTransfer !== 1 && paired.isTransfer !== true)
  ) {
    errors.push("transfer_pair_flag_invalid");
  }
  const targetAmount = target.amount;
  const pairedAmount = paired.amount;
  if (
    typeof targetAmount !== "number" ||
    typeof pairedAmount !== "number" ||
    !(
      (targetAmount < 0 && pairedAmount > 0) ||
      (targetAmount > 0 && pairedAmount < 0)
    )
  ) {
    errors.push("transfer_pair_signs_invalid");
  }
  if (
    typeof targetAmount === "number" &&
    typeof pairedAmount === "number" &&
    Math.abs(targetAmount) !== Math.abs(pairedAmount)
  ) {
    errors.push("transfer_pair_amounts_unbalanced");
  }

  const targetIsSource =
    typeof targetAmount === "number" && targetAmount < 0;
  const source = targetIsSource ? target : paired;
  const destination = targetIsSource ? paired : target;
  const sourceId = rowId(source);
  const destinationId = rowId(destination);
  if (sourceId === null || destinationId === null) {
    errors.push("transfer_pair_ids_invalid");
  } else {
    const inbound = db
      .prepare(
        `SELECT id, transferPairId
         FROM transactions
         WHERE transferPairId IN (@sourceId, @destinationId)
         ORDER BY id ASC`,
      )
      .all({ sourceId, destinationId }) as Array<{
      id: number;
      transferPairId: number;
    }>;
    if (
      inbound.length !== 2 ||
      !inbound.some(
        (row) =>
          row.id === sourceId && row.transferPairId === destinationId,
      ) ||
      !inbound.some(
        (row) =>
          row.id === destinationId && row.transferPairId === sourceId,
      )
    ) {
      errors.push("transfer_pair_has_ambiguous_inbound_reference");
    }
  }

  if (source.accountId === destination.accountId) {
    errors.push("transfer_accounts_must_differ");
  }
  for (const field of [
    "categoryId",
    "description",
    "originalCurrency",
    "exchangeRate",
    "transactionReference",
  ]) {
    if (!same(source[field], destination[field])) {
      errors.push(`transfer_pair_${field}_mismatch`);
    }
  }
  if (!sameInstant(source.date, destination.date)) {
    errors.push("transfer_pair_date_mismatch");
  }
  const sourceOriginal = source.originalAmount;
  const destinationOriginal = destination.originalAmount;
  if (
    !(
      (sourceOriginal == null && destinationOriginal == null) ||
      (typeof sourceOriginal === "number" &&
        typeof destinationOriginal === "number" &&
        sourceOriginal < 0 &&
        destinationOriginal > 0 &&
        Math.abs(sourceOriginal) === Math.abs(destinationOriginal))
    )
  ) {
    errors.push("transfer_pair_original_amount_mismatch");
  }
  if (
    (source.transactionCost != null &&
      (typeof source.transactionCost !== "number" ||
        source.transactionCost > 0)) ||
    (destination.transactionCost != null && destination.transactionCost !== 0)
  ) {
    errors.push("transfer_pair_transaction_cost_invalid");
  }
  for (const row of [source, destination]) {
    if (
      row.budgetId != null ||
      row.occurrenceDate != null ||
      row.budgetSnapshotId != null
    ) {
      errors.push("transfer_pair_budget_linkage_not_supported");
      break;
    }
  }

  return errors.length === 0
    ? { rows: { source, destination }, errors }
    : { errors };
};

const present = (
  db: Database.Database,
  table: "accounts" | "buckets" | "categories" | "recipients",
  id: number,
): boolean =>
  db.prepare(`SELECT 1 FROM ${table} WHERE id = @id`).get({ id }) !== undefined;

const response = (input: {
  action: TransactionTransferAction;
  targetIdPresent?: boolean;
  sourceAccountPresent?: boolean;
  destinationAccountPresent?: boolean;
  accountsDistinct?: boolean;
  pairValidated?: boolean;
  pairReciprocal?: boolean;
  validationErrors?: string[];
  transactionCostPresence?: boolean;
  code?: string;
}): TransactionTransferDryRunResponse => {
  const validationErrors = input.validationErrors ?? [];
  return {
    ok: validationErrors.length === 0,
    mode: "prototype",
    entity: "transfer",
    action: input.action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: input.targetIdPresent ?? false,
    pairValidated: input.pairValidated ?? input.action === "create",
    sourceAccountPresent: input.sourceAccountPresent ?? false,
    destinationAccountPresent: input.destinationAccountPresent ?? false,
    accountsDistinct: input.accountsDistinct ?? false,
    amountSignsValid: validationErrors.includes("transfer_pair_signs_invalid")
      ? false
      : true,
    amountsBalanced: validationErrors.includes(
      "transfer_pair_amounts_unbalanced",
    )
      ? false
      : true,
    transactionCostPresence: input.transactionCostPresence ?? false,
    pairIntegritySummary: {
      exactlyTwoRows:
        input.action === "create" ||
        ![
          "transaction_not_found",
          "transfer_pair_missing",
          "transfer_pair_not_found",
          "transfer_pair_has_ambiguous_inbound_reference",
        ].some((code) => validationErrors.includes(code)),
      reciprocal: input.action === "create" || (input.pairReciprocal ?? false),
      selfReference: validationErrors.includes(
        "transfer_pair_self_reference",
      ),
      thirdPartyReferences: validationErrors.includes(
        "transfer_pair_has_ambiguous_inbound_reference",
      ),
    },
    financialEffectSummary: {
      sourceWouldDecrease: validationErrors.length === 0,
      destinationWouldIncrease: validationErrors.length === 0,
      overallNetAffectedByCostOnly: true,
    },
    validationErrors,
    warnings: [],
    unsupportedReasons: [],
    timestampBehavior: {
      timestampsPresent: false,
      createdAtWouldChange: false,
      updatedAtWouldChange: false,
    },
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      validationErrors.length === 0
        ? "transfer_dry_run_valid"
        : "transfer_dry_run_has_validation_errors",
      "no_mutation_performed",
    ],
    ...(input.code ? { code: input.code } : {}),
  };
};

export const transactionTransferDryRun = (
  db: Database.Database,
  payload: unknown,
  action: TransactionTransferAction,
): TransactionTransferDryRunResponse => {
  const normalized = normalizeTransferPayload(payload, action);
  const validationErrors: string[] = [];
  const sourceAccountPresent = present(
    db,
    "accounts",
    normalized.sourceAccountId,
  );
  const destinationAccountPresent = present(
    db,
    "accounts",
    normalized.destinationAccountId,
  );
  const accountsDistinct =
    normalized.sourceAccountId !== normalized.destinationAccountId;
  if (!sourceAccountPresent) validationErrors.push("source_account_not_found");
  if (!destinationAccountPresent) {
    validationErrors.push("destination_account_not_found");
  }
  if (!accountsDistinct) {
    validationErrors.push("transfer_accounts_must_differ");
  }
  if (!present(db, "categories", normalized.categoryId)) {
    validationErrors.push("category_not_found");
  } else {
    const category = db
      .prepare("SELECT bucketId FROM categories WHERE id = @id")
      .get({ id: normalized.categoryId }) as { bucketId: number };
    if (!present(db, "buckets", category.bucketId)) {
      validationErrors.push("category_bucket_not_found");
    }
  }
  if (!present(db, "recipients", normalized.sourceRecipientId)) {
    validationErrors.push("source_recipient_not_found");
  }
  if (!present(db, "recipients", normalized.destinationRecipientId)) {
    validationErrors.push("destination_recipient_not_found");
  }

  let pairValidated = action === "create";
  let pairReciprocal = action === "create";
  if (action === "update") {
    const pair = validateTransferPair(db, normalized.id!);
    validationErrors.push(...pair.errors);
    pairValidated = pair.errors.length === 0;
    pairReciprocal =
      pair.errors.length === 0 ||
      !pair.errors.includes("transfer_pair_not_reciprocal");
  }

  const uniqueErrors = [...new Set(validationErrors)];
  return response({
    action,
    targetIdPresent: normalized.id !== undefined,
    sourceAccountPresent,
    destinationAccountPresent,
    accountsDistinct,
    pairValidated,
    pairReciprocal,
    transactionCostPresence:
      normalized.transactionCost !== null &&
      normalized.transactionCost !== 0,
    validationErrors: uniqueErrors,
    code: uniqueErrors[0],
  });
};

export const transactionTransferDryRunRequestErrorResponse = (
  action: TransactionTransferAction,
  code: string,
): TransactionTransferDryRunResponse =>
  response({
    action,
    validationErrors: [code],
    code,
  });

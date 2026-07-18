import Database from "better-sqlite3";
import {
  normalizeTransferPayload,
  transactionTransferDryRun,
  validateTransferPair,
  type NormalizedTransferInput,
  type TransactionTransferAction,
  type TransactionTransferDryRunResponse,
} from "./transactionTransferDryRun.js";

export const TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION =
  "create paired transfer in disposable sqlite" as const;
export const TRANSACTION_TRANSFER_UPDATE_WRITE_CONFIRMATION =
  "update paired transfer in disposable sqlite" as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
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
const RELATED_TABLES = [
  "accounts",
  "paymentMethods",
  "budgets",
  "budgetSnapshots",
  "buckets",
  "categories",
  "recipients",
  "smsImportTemplates",
] as const;

export interface TransactionTransferWriteResponse {
  ok: boolean;
  mode: "prototype";
  entity: "transfer";
  action: TransactionTransferAction;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  pairCreated: boolean;
  pairUpdated: boolean;
  pairIntegrityVerified: boolean;
  transactionCountDelta: number;
  sourceTransactionId?: number;
  destinationTransactionId?: number;
  financialEffectSummary: TransactionTransferDryRunResponse["financialEffectSummary"];
  timestampBehavior: TransactionTransferDryRunResponse["timestampBehavior"];
  validationErrors: string[];
  warnings: string[];
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class TransactionTransferWriteRequestError extends Error {
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

export const validateTransactionTransferWritePayload = (
  payload: unknown,
  action: TransactionTransferAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new TransactionTransferWriteRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (
      (!DATA_FIELDS.has(field) && !CONTROL_FIELDS.has(field)) ||
      (action === "create" && field === "id")
    ) {
      throw new TransactionTransferWriteRequestError(
        "unexpected_payload_field",
      );
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new TransactionTransferWriteRequestError(
      "dry_run_reviewed_required",
    );
  }
  const confirmation =
    action === "create"
      ? TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION
      : TRANSACTION_TRANSFER_UPDATE_WRITE_CONFIRMATION;
  if (payload.confirmation !== confirmation) {
    throw new TransactionTransferWriteRequestError(
      "matching_dry_run_required",
    );
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => DATA_FIELDS.has(field)),
  );
};

const tableRows = (
  db: Database.Database,
  table: "transactions" | (typeof RELATED_TABLES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const serialized = (value: unknown): string => JSON.stringify(value);

const relatedFingerprints = (
  db: Database.Database,
): Record<(typeof RELATED_TABLES)[number], string> =>
  Object.fromEntries(
    RELATED_TABLES.map((table) => [table, serialized(tableRows(db, table))]),
  ) as Record<(typeof RELATED_TABLES)[number], string>;

const assertRelatedTablesUnchanged = (
  db: Database.Database,
  before: Record<(typeof RELATED_TABLES)[number], string>,
): void => {
  for (const table of RELATED_TABLES) {
    if (serialized(tableRows(db, table)) !== before[table]) {
      throw new Error("transaction_transfer_related_table_boundary_failed");
    }
  }
};

const response = (input: {
  action: TransactionTransferAction;
  dryRun?: TransactionTransferDryRunResponse;
  sqliteMutated: boolean;
  rowsChanged: number;
  transactionCountDelta: number;
  sourceTransactionId?: number;
  destinationTransactionId?: number;
  validationErrors?: string[];
  resultCodes: string[];
  code?: string;
}): TransactionTransferWriteResponse => {
  const validationErrors = input.validationErrors ?? [];
  const success =
    input.sqliteMutated &&
    validationErrors.length === 0 &&
    input.rowsChanged === 2;
  return {
    ok: success,
    mode: "prototype",
    entity: "transfer",
    action: input.action,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    pairCreated: success && input.action === "create",
    pairUpdated: success && input.action === "update",
    pairIntegrityVerified: success,
    transactionCountDelta: input.transactionCountDelta,
    ...(input.sourceTransactionId !== undefined
      ? { sourceTransactionId: input.sourceTransactionId }
      : {}),
    ...(input.destinationTransactionId !== undefined
      ? { destinationTransactionId: input.destinationTransactionId }
      : {}),
    financialEffectSummary: input.dryRun?.financialEffectSummary ?? {
      sourceWouldDecrease: false,
      destinationWouldIncrease: false,
      overallNetAffectedByCostOnly: true,
    },
    timestampBehavior: input.dryRun?.timestampBehavior ?? {
      timestampsPresent: false,
      createdAtWouldChange: false,
      updatedAtWouldChange: false,
    },
    validationErrors,
    warnings: input.dryRun?.warnings ?? [],
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: input.resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const transactionTransferWriteDisabledResponse = (
  action: TransactionTransferAction,
  code = "transaction_transfer_writes_disabled",
): TransactionTransferWriteResponse =>
  response({
    action,
    sqliteMutated: false,
    rowsChanged: 0,
    transactionCountDelta: 0,
    validationErrors: [code],
    resultCodes: [code, "no_mutation_performed"],
    code,
  });

export const transactionTransferWriteRequestErrorResponse = (
  action: TransactionTransferAction,
  code: string,
): TransactionTransferWriteResponse =>
  response({
    action,
    sqliteMutated: false,
    rowsChanged: 0,
    transactionCountDelta: 0,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

const insertHalf = (
  db: Database.Database,
  input: NormalizedTransferInput,
  source: boolean,
): number => {
  const result = db
    .prepare(
      `INSERT INTO transactions (
        categoryId, paymentChannelId, accountId, recipientId, date, amount,
        originalAmount, originalCurrency, exchangeRate, transactionReference,
        transactionCost, description, transferPairId, isTransfer, budgetId,
        occurrenceDate, budgetSnapshotId
      ) VALUES (
        @categoryId, NULL, @accountId, @recipientId, @date, @amount,
        @originalAmount, @originalCurrency, @exchangeRate, @transactionReference,
        @transactionCost, @description, NULL, 1, NULL, NULL, NULL
      )`,
    )
    .run({
      categoryId: input.categoryId,
      accountId: source
        ? input.sourceAccountId
        : input.destinationAccountId,
      recipientId: source
        ? input.sourceRecipientId
        : input.destinationRecipientId,
      date: input.date,
      amount: source ? -input.amount : input.amount,
      originalAmount:
        input.originalAmount === null
          ? null
          : source
            ? -input.originalAmount
            : input.originalAmount,
      originalCurrency: input.originalCurrency,
      exchangeRate: input.exchangeRate,
      transactionReference: input.transactionReference,
      transactionCost: source ? input.transactionCost : null,
      description: input.description,
    });
  if (result.changes !== 1) {
    throw new Error("transaction_transfer_insert_failed");
  }
  return Number(result.lastInsertRowid);
};

const createTransfer = (
  db: Database.Database,
  normalized: NormalizedTransferInput,
  dryRun: TransactionTransferDryRunResponse,
): TransactionTransferWriteResponse => {
  const transactionsBefore = tableRows(db, "transactions");
  const relatedBefore = relatedFingerprints(db);
  const sourceId = insertHalf(db, normalized, true);
  const destinationId = insertHalf(db, normalized, false);
  if (sourceId === destinationId) {
    throw new Error("transaction_transfer_ids_not_unique");
  }
  const sourceLink = db
    .prepare(
      "UPDATE transactions SET transferPairId = @pairId WHERE id = @id",
    )
    .run({ id: sourceId, pairId: destinationId });
  const destinationLink = db
    .prepare(
      "UPDATE transactions SET transferPairId = @pairId WHERE id = @id",
    )
    .run({ id: destinationId, pairId: sourceId });
  const pair = validateTransferPair(db, sourceId);
  const transactionsAfter = tableRows(db, "transactions");
  const unchangedExisting = transactionsAfter.filter(
    (row) => row.id !== sourceId && row.id !== destinationId,
  );
  if (
    sourceLink.changes !== 1 ||
    destinationLink.changes !== 1 ||
    pair.errors.length > 0 ||
    !pair.rows ||
    transactionsAfter.length !== transactionsBefore.length + 2 ||
    serialized(unchangedExisting) !== serialized(transactionsBefore)
  ) {
    throw new Error("transaction_transfer_create_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);
  return response({
    action: "create",
    dryRun,
    sqliteMutated: true,
    rowsChanged: 2,
    transactionCountDelta: 2,
    sourceTransactionId: sourceId,
    destinationTransactionId: destinationId,
    resultCodes: ["transfer_pair_created", "sqlite_mutated"],
  });
};

const updateTransfer = (
  db: Database.Database,
  normalized: NormalizedTransferInput,
  dryRun: TransactionTransferDryRunResponse,
): TransactionTransferWriteResponse => {
  const pairBefore = validateTransferPair(db, normalized.id!);
  if (!pairBefore.rows || pairBefore.errors.length > 0) {
    throw new Error("transaction_transfer_pair_became_invalid");
  }
  const sourceId = pairBefore.rows.source.id as number;
  const destinationId = pairBefore.rows.destination.id as number;
  const transactionsBefore = tableRows(db, "transactions");
  const relatedBefore = relatedFingerprints(db);
  const statement = db.prepare(
    `UPDATE transactions
     SET categoryId = @categoryId,
         accountId = @accountId,
         recipientId = @recipientId,
         date = @date,
         amount = @amount,
         originalAmount = @originalAmount,
         originalCurrency = @originalCurrency,
         exchangeRate = @exchangeRate,
         transactionReference = @transactionReference,
         transactionCost = @transactionCost,
         description = @description
     WHERE id = @id`,
  );
  const sourceResult = statement.run({
    id: sourceId,
    categoryId: normalized.categoryId,
    accountId: normalized.sourceAccountId,
    recipientId: normalized.sourceRecipientId,
    date: normalized.date,
    amount: -normalized.amount,
    originalAmount:
      normalized.originalAmount === null ? null : -normalized.originalAmount,
    originalCurrency: normalized.originalCurrency,
    exchangeRate: normalized.exchangeRate,
    transactionReference: normalized.transactionReference,
    transactionCost: normalized.transactionCost,
    description: normalized.description,
  });
  const destinationResult = statement.run({
    id: destinationId,
    categoryId: normalized.categoryId,
    accountId: normalized.destinationAccountId,
    recipientId: normalized.destinationRecipientId,
    date: normalized.date,
    amount: normalized.amount,
    originalAmount: normalized.originalAmount,
    originalCurrency: normalized.originalCurrency,
    exchangeRate: normalized.exchangeRate,
    transactionReference: normalized.transactionReference,
    transactionCost: null,
    description: normalized.description,
  });
  const pairAfter = validateTransferPair(db, sourceId);
  const transactionsAfter = tableRows(db, "transactions");
  const otherRows = (rows: Record<string, unknown>[]) =>
    rows.filter((row) => row.id !== sourceId && row.id !== destinationId);
  for (const field of [
    "id",
    "paymentChannelId",
    "transferPairId",
    "isTransfer",
    "budgetId",
    "occurrenceDate",
    "budgetSnapshotId",
  ]) {
    if (
      serialized(pairBefore.rows.source[field]) !==
        serialized(pairAfter.rows?.source[field]) ||
      serialized(pairBefore.rows.destination[field]) !==
        serialized(pairAfter.rows?.destination[field])
    ) {
      throw new Error(`transaction_transfer_update_changed_${field}`);
    }
  }
  if (
    sourceResult.changes !== 1 ||
    destinationResult.changes !== 1 ||
    pairAfter.errors.length > 0 ||
    !pairAfter.rows ||
    transactionsAfter.length !== transactionsBefore.length ||
    serialized(otherRows(transactionsAfter)) !==
      serialized(otherRows(transactionsBefore))
  ) {
    throw new Error("transaction_transfer_update_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);
  return response({
    action: "update",
    dryRun,
    sqliteMutated: true,
    rowsChanged: 2,
    transactionCountDelta: 0,
    sourceTransactionId: sourceId,
    destinationTransactionId: destinationId,
    resultCodes: ["transfer_pair_updated", "sqlite_mutated"],
  });
};

export const transactionTransferRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: TransactionTransferAction,
): TransactionTransferWriteResponse => {
  const dataPayload = validateTransactionTransferWritePayload(payload, action);
  const dryRun = transactionTransferDryRun(db, dataPayload, action);
  if (!dryRun.ok) {
    return response({
      action,
      dryRun,
      sqliteMutated: false,
      rowsChanged: 0,
      transactionCountDelta: 0,
      validationErrors: dryRun.validationErrors,
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: dryRun.code ?? dryRun.validationErrors[0],
    });
  }
  return db.transaction(() => {
    const normalized = normalizeTransferPayload(dataPayload, action);
    return action === "create"
      ? createTransfer(db, normalized, dryRun)
      : updateTransfer(db, normalized, dryRun);
  })();
};

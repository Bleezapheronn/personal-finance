import Database from "better-sqlite3";
import {
  normalizeTransactionPayloadForWrite,
  transactionBasicDryRun,
  type NormalizedBasicTransactionInput,
  type TransactionBasicAction,
  type TransactionBasicDryRunResponse,
  type TransactionClassification,
  type TransactionWriteCapabilities,
} from "./transactionBasicDryRun.js";

export const TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION =
  "create basic transaction in disposable sqlite" as const;
export const TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION =
  "update basic transaction in disposable sqlite" as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
const DATA_FIELDS = new Set([
  "id",
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
  "paymentChannelId",
  "transactionCost",
  "transferPairId",
  "isTransfer",
  "budgetId",
  "occurrenceDate",
  "budgetSnapshotId",
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

export interface TransactionBasicWriteResponse {
  ok: boolean;
  mode: "prototype";
  entity: "transaction";
  action: TransactionBasicAction;
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  targetIdPresent: boolean;
  targetId: number | null;
  classification: TransactionClassification | null;
  foreignKeyPresence: TransactionBasicDryRunResponse["foreignKeyPresence"];
  transactionCostPresence: boolean;
  transactionCostClassification: TransactionBasicDryRunResponse["transactionCostClassification"];
  budgetSnapshotLinkagePresence: boolean;
  budgetLinkageAction: TransactionBasicDryRunResponse["budgetLinkageAction"];
  validationErrors: string[];
  warnings: string[];
  unsupportedReasons: string[];
  financialEffectSummary: TransactionBasicDryRunResponse["financialEffectSummary"];
  reportEffectSummary: TransactionBasicDryRunResponse["reportEffectSummary"];
  budgetHistoryEffectSummary: TransactionBasicDryRunResponse["budgetHistoryEffectSummary"];
  timestampBehavior: TransactionBasicDryRunResponse["timestampBehavior"];
  affectedSummary: {
    transactionRowsChanged: number;
    relatedTransactionRowsChanged: 0;
    accountRowsChanged: 0;
    lookupRowsChanged: 0;
    budgetRowsChanged: 0;
    budgetSnapshotRowsChanged: 0;
  };
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

export class TransactionBasicWriteRequestError extends Error {
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

export const validateTransactionBasicWritePayload = (
  payload: unknown,
  action: TransactionBasicAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new TransactionBasicWriteRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (!DATA_FIELDS.has(field) && !CONTROL_FIELDS.has(field)) {
      throw new TransactionBasicWriteRequestError(
        "unexpected_payload_field",
      );
    }
    if (action === "create" && field === "id") {
      throw new TransactionBasicWriteRequestError(
        "unexpected_payload_field",
      );
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new TransactionBasicWriteRequestError("dry_run_reviewed_required");
  }
  const confirmation =
    action === "create"
      ? TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION
      : TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION;
  if (payload.confirmation !== confirmation) {
    throw new TransactionBasicWriteRequestError("matching_dry_run_required");
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

const withoutId = (
  rows: Record<string, unknown>[],
  id: number,
): Record<string, unknown>[] => rows.filter((row) => row.id !== id);

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
      throw new Error("transaction_related_table_boundary_failed");
    }
  }
};

const response = (input: {
  action: TransactionBasicAction;
  dryRun?: TransactionBasicDryRunResponse;
  targetId: number | null;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  resultCodes: string[];
  code?: string;
}): TransactionBasicWriteResponse => {
  const dryRun = input.dryRun;
  const validationErrors = input.validationErrors ?? [];

  return {
    ok:
      validationErrors.length === 0 &&
      input.resultCodes.includes("sqlite_mutated"),
    mode: "prototype",
    entity: "transaction",
    action: input.action,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    classification: dryRun?.classification ?? null,
    foreignKeyPresence: dryRun?.foreignKeyPresence ?? {
      account: false,
      category: false,
      recipient: false,
      bucketViaCategory: false,
      budget: false,
      budgetSnapshot: false,
    },
    transactionCostPresence: dryRun?.transactionCostPresence ?? false,
    transactionCostClassification:
      dryRun?.transactionCostClassification ?? "none",
    budgetSnapshotLinkagePresence:
      dryRun?.budgetSnapshotLinkagePresence ?? false,
    budgetLinkageAction: dryRun?.budgetLinkageAction ?? "none",
    validationErrors,
    warnings: dryRun?.warnings ?? [],
    unsupportedReasons: dryRun?.unsupportedReasons ?? [],
    financialEffectSummary: dryRun?.financialEffectSummary ?? {
      accountBalanceWouldChange: false,
      reportTotalsWouldChange: false,
      amountDelta: 0,
      transactionCostDelta: 0,
      combinedDelta: 0,
    },
    reportEffectSummary: dryRun?.reportEffectSummary ?? {
      combinedTotalDelta: 0,
    },
    budgetHistoryEffectSummary: dryRun?.budgetHistoryEffectSummary ?? {
      membershipWouldChange: false,
      linkedBudgetIdPresent: false,
      linkedBudgetSnapshotIdPresent: false,
      combinedTotalDelta: 0,
    },
    timestampBehavior: dryRun?.timestampBehavior ?? {
      timestampsPresent: false,
      createdAtWouldChange: false,
      updatedAtWouldChange: false,
    },
    affectedSummary: {
      transactionRowsChanged: input.rowsChanged,
      relatedTransactionRowsChanged: 0,
      accountRowsChanged: 0,
      lookupRowsChanged: 0,
      budgetRowsChanged: 0,
      budgetSnapshotRowsChanged: 0,
    },
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

export const transactionBasicWriteDisabledResponse = (
  action: TransactionBasicAction,
): TransactionBasicWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: ["transaction_basic_writes_disabled"],
    resultCodes: ["transaction_basic_writes_disabled", "no_mutation_performed"],
    code: "transaction_basic_writes_disabled",
  });

export const transactionCostBudgetWriteDisabledResponse = (
  action: TransactionBasicAction,
): TransactionBasicWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: ["transaction_cost_budget_writes_disabled"],
    resultCodes: [
      "transaction_cost_budget_writes_disabled",
      "no_mutation_performed",
    ],
    code: "transaction_cost_budget_writes_disabled",
  });

export const transactionBasicWriteRequestErrorResponse = (
  action: TransactionBasicAction,
  code: string,
): TransactionBasicWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

const createTransaction = (
  db: Database.Database,
  normalized: NormalizedBasicTransactionInput,
  dryRun: TransactionBasicDryRunResponse,
): TransactionBasicWriteResponse => {
  const transactionsBefore = tableRows(db, "transactions");
  const relatedBefore = relatedFingerprints(db);
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
        @transactionCost, @description, NULL, 0, @budgetId, @occurrenceDate,
        @budgetSnapshotId
      )`,
    )
    .run(normalized);
  const targetId = Number(result.lastInsertRowid);
  const transactionsAfter = tableRows(db, "transactions");

  if (
    result.changes !== 1 ||
    transactionsAfter.length !== transactionsBefore.length + 1 ||
    serialized(withoutId(transactionsAfter, targetId)) !==
      serialized(transactionsBefore)
  ) {
    throw new Error("transaction_create_write_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return response({
    action: "create",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["transaction_created", "sqlite_mutated"],
  });
};

const updateTransaction = (
  db: Database.Database,
  normalized: NormalizedBasicTransactionInput,
  dryRun: TransactionBasicDryRunResponse,
  capabilities: TransactionWriteCapabilities,
): TransactionBasicWriteResponse => {
  const targetId = normalized.id!;
  const transactionsBefore = tableRows(db, "transactions");
  const previous = transactionsBefore.find((row) => row.id === targetId);
  if (!previous) {
    return response({
      action: "update",
      dryRun,
      targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: ["transaction_not_found"],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: "transaction_not_found",
    });
  }
  const relatedBefore = relatedFingerprints(db);
  const updateSql = capabilities.costBudget
    ? `UPDATE transactions
       SET categoryId = @categoryId,
           accountId = @accountId,
           recipientId = @recipientId,
           date = @date,
           amount = @amount,
           originalAmount = @originalAmount,
           originalCurrency = @originalCurrency,
           exchangeRate = @exchangeRate,
           transactionReference = @transactionReference,
           description = @description,
           transactionCost = @transactionCost,
           budgetId = @budgetId,
           occurrenceDate = @occurrenceDate,
           budgetSnapshotId = @budgetSnapshotId
       WHERE id = @id`
    : `UPDATE transactions
       SET categoryId = @categoryId,
           accountId = @accountId,
           recipientId = @recipientId,
           date = @date,
           amount = @amount,
           originalAmount = @originalAmount,
           originalCurrency = @originalCurrency,
           exchangeRate = @exchangeRate,
           transactionReference = @transactionReference,
           description = @description
       WHERE id = @id`;
  const result = db.prepare(updateSql).run(normalized);
  const transactionsAfter = tableRows(db, "transactions");
  const next = transactionsAfter.find((row) => row.id === targetId);

  for (const field of [
    "id",
    "paymentChannelId",
    "transferPairId",
    "isTransfer",
    ...(!capabilities.costBudget
      ? [
          "transactionCost",
          "budgetId",
          "occurrenceDate",
          "budgetSnapshotId",
        ]
      : []),
  ]) {
    if (serialized(previous[field]) !== serialized(next?.[field])) {
      throw new Error(`transaction_update_changed_preserved_${field}`);
    }
  }
  if (
    result.changes !== 1 ||
    transactionsAfter.length !== transactionsBefore.length ||
    !next ||
    serialized(withoutId(transactionsAfter, targetId)) !==
      serialized(withoutId(transactionsBefore, targetId))
  ) {
    throw new Error("transaction_update_write_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return response({
    action: "update",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["transaction_updated", "sqlite_mutated"],
  });
};

export const transactionBasicRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: TransactionBasicAction,
  capabilities: TransactionWriteCapabilities = { costBudget: false },
): TransactionBasicWriteResponse => {
  const dataPayload = validateTransactionBasicWritePayload(payload, action);
  const dryRun = transactionBasicDryRun(
    db,
    dataPayload,
    action,
    capabilities,
  );

  if (!dryRun.ok) {
    return response({
      action,
      dryRun,
      targetId: dryRun.targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: [
        ...dryRun.validationErrors,
        ...dryRun.unsupportedReasons,
      ],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code:
        dryRun.code ??
        dryRun.validationErrors[0] ??
        dryRun.unsupportedReasons[0],
    });
  }

  const transaction = db.transaction(() => {
    const normalized = normalizeTransactionPayloadForWrite(
      db,
      dataPayload,
      action,
      capabilities,
    );
    return action === "create"
      ? createTransaction(db, normalized, dryRun)
      : updateTransaction(db, normalized, dryRun, capabilities);
  });
  return transaction();
};

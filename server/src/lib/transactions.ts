import Database from "better-sqlite3";

export interface TransactionFilters {
  accountId?: number;
  categoryId?: number;
  recipientId?: number;
  budgetSnapshotId?: number;
  isTransfer?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface ListTransactionsOptions {
  limit: number;
  offset: number;
  filters: TransactionFilters;
}

export interface TransactionListResult {
  limit: number;
  offset: number;
  count: number;
  rows: Record<string, unknown>[];
}

export interface TransactionDescriptionSuggestion {
  text: string;
  count: number;
  latest?: string;
}

export type TransactionDescriptionPrefill =
  | {
      transactionType: "expense" | "income";
      recipientId: number;
      categoryId: number;
      accountId: number;
    }
  | {
      transactionType: "transfer";
      sourceRecipientId: number;
      destinationRecipientId: number;
      categoryId: number;
      sourceAccountId: number;
      destinationAccountId: number;
    };

const TRANSACTION_SELECT_SQL = `SELECT id, categoryId, paymentChannelId, accountId,
  recipientId, date, amount, originalAmount, originalCurrency, exchangeRate,
  transactionReference, transactionCost, description, transferPairId, isTransfer,
  budgetId, occurrenceDate, budgetSnapshotId
FROM transactions`;

const TRANSACTION_ORDER_SQL = `ORDER BY date DESC,
  CASE WHEN amount + COALESCE(transactionCost, 0) >= 0 THEN 0 ELSE 1 END ASC,
  amount + COALESCE(transactionCost, 0) ASC,
  id ASC`;

const addNumberFilter = (
  clauses: string[],
  params: Record<string, string | number>,
  field: keyof Pick<
    TransactionFilters,
    "accountId" | "categoryId" | "recipientId" | "budgetSnapshotId"
  >,
  value: number | undefined,
): void => {
  if (value === undefined) {
    return;
  }

  clauses.push(`${field} = @${field}`);
  params[field] = value;
};

const buildWhere = (
  filters: TransactionFilters,
): { whereSql: string; params: Record<string, string | number> } => {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  addNumberFilter(clauses, params, "accountId", filters.accountId);
  addNumberFilter(clauses, params, "categoryId", filters.categoryId);
  addNumberFilter(clauses, params, "recipientId", filters.recipientId);
  addNumberFilter(clauses, params, "budgetSnapshotId", filters.budgetSnapshotId);

  if (filters.isTransfer !== undefined) {
    clauses.push("isTransfer = @isTransfer");
    params.isTransfer = filters.isTransfer ? 1 : 0;
  }

  if (filters.dateFrom !== undefined) {
    clauses.push("date >= @dateFrom");
    params.dateFrom = filters.dateFrom;
  }

  if (filters.dateTo !== undefined) {
    clauses.push("date <= @dateTo");
    params.dateTo = filters.dateTo;
  }

  return {
    whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};

export const listTransactions = (
  db: Database.Database,
  options: ListTransactionsOptions,
): TransactionListResult => {
  const { whereSql, params } = buildWhere(options.filters);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions${whereSql}`)
    .get(params) as { count: number } | undefined;

  if (!countRow || typeof countRow.count !== "number") {
    throw new Error("Could not read transaction count.");
  }

  const rows = db
    .prepare(
      `${TRANSACTION_SELECT_SQL}${whereSql} ${TRANSACTION_ORDER_SQL} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: options.limit, offset: options.offset }) as Record<string, unknown>[];

  return {
    limit: options.limit,
    offset: options.offset,
    count: countRow.count,
    rows,
  };
};

export const countTransactions = (
  db: Database.Database,
  filters: TransactionFilters = {},
): number => {
  const { whereSql, params } = buildWhere(filters);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions${whereSql}`)
    .get(params) as { count: number } | undefined;

  if (!countRow || typeof countRow.count !== "number") {
    throw new Error("Could not read transaction count.");
  }

  return countRow.count;
};

export const getTransactionById = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare(`${TRANSACTION_SELECT_SQL} WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;

export const listTransactionDescriptionSuggestions = (
  db: Database.Database,
  limit: number,
): TransactionDescriptionSuggestion[] =>
  db
    .prepare(
      `SELECT description AS text, COUNT(*) AS count, MAX(date) AS latest
       FROM transactions
       WHERE description IS NOT NULL AND TRIM(description) <> ''
       GROUP BY description
       ORDER BY count DESC, MAX(date) DESC, description ASC
       LIMIT @limit`,
    )
    .all({ limit }) as TransactionDescriptionSuggestion[];

export const getMostRecentTransactionByDescription = (
  db: Database.Database,
  description: string,
): Record<string, unknown> | undefined =>
  db
    .prepare(
      `${TRANSACTION_SELECT_SQL}
       WHERE description = @description
       ORDER BY date DESC, id DESC
       LIMIT 1`,
    )
    .get({ description }) as Record<string, unknown> | undefined;

const isTransferRow = (row: Record<string, unknown>): boolean =>
  row.isTransfer === true || row.isTransfer === 1;

const integer = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

export const getTransactionDescriptionPrefill = (
  db: Database.Database,
  description: string,
): TransactionDescriptionPrefill | undefined => {
  const rows = db
    .prepare(
      `${TRANSACTION_SELECT_SQL}
       WHERE description IS NOT NULL AND TRIM(description) = TRIM(@description)
       ORDER BY date DESC, id DESC`,
    )
    .all({ description }) as Record<string, unknown>[];

  for (const row of rows) {
    const categoryId = integer(row.categoryId);
    const recipientId = integer(row.recipientId);
    const accountId = integer(row.accountId);
    if (categoryId === undefined || recipientId === undefined || accountId === undefined) {
      continue;
    }

    if (!isTransferRow(row)) {
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      if (amount === 0 || !Number.isFinite(amount)) continue;
      return {
        transactionType: amount < 0 ? "expense" : "income",
        recipientId,
        categoryId,
        accountId,
      };
    }

    const id = integer(row.id);
    const pairId = integer(row.transferPairId);
    if (id === undefined || pairId === undefined || id === pairId) continue;
    const pairRows = db
      .prepare(`${TRANSACTION_SELECT_SQL} WHERE transferPairId = @pairId OR id = @pairId`)
      .all({ pairId }) as Record<string, unknown>[];
    if (pairRows.length !== 2) continue;
    const paired = pairRows.find((candidate) => candidate.id === pairId);
    if (!paired || !isTransferRow(paired) || integer(paired.transferPairId) !== id) continue;
    const pairedAmount = typeof paired.amount === "number" ? paired.amount : Number(paired.amount);
    const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
    if (!Number.isFinite(amount) || !Number.isFinite(pairedAmount)) continue;
    if (!((amount < 0 && pairedAmount > 0) || (amount > 0 && pairedAmount < 0))) continue;
    if (Math.abs(amount) !== Math.abs(pairedAmount)) continue;

    const outgoing = amount < 0 ? row : paired;
    const incoming = amount < 0 ? paired : row;
    const sourceAccountId = integer(outgoing.accountId);
    const destinationAccountId = integer(incoming.accountId);
    const sourceRecipientId = integer(outgoing.recipientId);
    const destinationRecipientId = integer(incoming.recipientId);
    const outgoingCategoryId = integer(outgoing.categoryId);
    if (
      sourceAccountId === undefined || destinationAccountId === undefined ||
      sourceRecipientId === undefined || destinationRecipientId === undefined ||
      outgoingCategoryId === undefined
    ) continue;
    return {
      transactionType: "transfer",
      sourceRecipientId,
      destinationRecipientId,
      categoryId: outgoingCategoryId,
      sourceAccountId,
      destinationAccountId,
    };
  }
  return undefined;
};

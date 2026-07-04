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

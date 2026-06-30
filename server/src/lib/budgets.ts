import Database from "better-sqlite3";

export interface BudgetFilters {
  activeOnly?: boolean;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  frequency?: BudgetFrequency;
  isGoal?: boolean;
}

export interface BudgetSnapshotFilters {
  budgetId?: number;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  isHistorical?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface ListBudgetsOptions {
  limit: number;
  offset: number;
  filters: BudgetFilters;
}

export interface ListBudgetSnapshotsOptions {
  limit: number;
  offset: number;
  filters: BudgetSnapshotFilters;
}

export interface BudgetListResult {
  resource: "budgets";
  limit: number;
  offset: number;
  count: number;
  rows: Record<string, unknown>[];
}

export interface BudgetSnapshotListResult {
  resource: "budgetSnapshots";
  limit: number;
  offset: number;
  count: number;
  rows: Record<string, unknown>[];
}

export type BudgetFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

const BUDGET_FREQUENCIES = new Set<string>([
  "once",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
]);

const BUDGET_SELECT_SQL = `SELECT id, description, categoryId, paymentChannelId,
  accountId, recipientId, amount, transactionCost, frequency, frequencyDetails,
  isGoal, isFlexible, goalPercentage, goalDirection, isActive,
  remainingCyclesTotal, dueDate, createdAt, updatedAt
FROM budgets`;

const BUDGET_SNAPSHOT_SELECT_SQL = `SELECT id, budgetId, occurrenceDate,
  dueDate, cycleIndex, description, categoryId, accountId, recipientId, amount,
  transactionCost, frequency, frequencyDetails, isGoal, isFlexible,
  goalPercentage, goalDirection, remainingCyclesTotal, isHistorical,
  sourceBudgetUpdatedAt, createdAt, updatedAt
FROM budgetSnapshots`;

export const isBudgetFrequency = (value: string): value is BudgetFrequency =>
  BUDGET_FREQUENCIES.has(value);

const addNumberFilter = (
  clauses: string[],
  params: Record<string, string | number>,
  field: keyof Pick<
    BudgetFilters & BudgetSnapshotFilters,
    "categoryId" | "accountId" | "recipientId" | "budgetId"
  >,
  value: number | undefined,
): void => {
  if (value === undefined) {
    return;
  }

  clauses.push(`${field} = @${field}`);
  params[field] = value;
};

const buildBudgetWhere = (
  filters: BudgetFilters,
): { whereSql: string; params: Record<string, string | number> } => {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (filters.activeOnly === true) {
    clauses.push("isActive = 1");
  }

  addNumberFilter(clauses, params, "categoryId", filters.categoryId);
  addNumberFilter(clauses, params, "accountId", filters.accountId);
  addNumberFilter(clauses, params, "recipientId", filters.recipientId);

  if (filters.frequency !== undefined) {
    clauses.push("frequency = @frequency");
    params.frequency = filters.frequency;
  }

  if (filters.isGoal !== undefined) {
    clauses.push("isGoal = @isGoal");
    params.isGoal = filters.isGoal ? 1 : 0;
  }

  return {
    whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};

const buildBudgetSnapshotWhere = (
  filters: BudgetSnapshotFilters,
): { whereSql: string; params: Record<string, string | number> } => {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  addNumberFilter(clauses, params, "budgetId", filters.budgetId);
  addNumberFilter(clauses, params, "categoryId", filters.categoryId);
  addNumberFilter(clauses, params, "accountId", filters.accountId);
  addNumberFilter(clauses, params, "recipientId", filters.recipientId);

  if (filters.isHistorical !== undefined) {
    clauses.push("isHistorical = @isHistorical");
    params.isHistorical = filters.isHistorical ? 1 : 0;
  }

  if (filters.dateFrom !== undefined) {
    clauses.push("dueDate >= @dateFrom");
    params.dateFrom = filters.dateFrom;
  }

  if (filters.dateTo !== undefined) {
    clauses.push("dueDate <= @dateTo");
    params.dateTo = filters.dateTo;
  }

  return {
    whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};

export const listBudgets = (
  db: Database.Database,
  options: ListBudgetsOptions,
): BudgetListResult => {
  const { whereSql, params } = buildBudgetWhere(options.filters);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM budgets${whereSql}`)
    .get(params) as { count: number } | undefined;

  if (!countRow || typeof countRow.count !== "number") {
    throw new Error("Could not read budget count.");
  }

  const rows = db
    .prepare(`${BUDGET_SELECT_SQL}${whereSql} ORDER BY dueDate ASC, id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: options.limit, offset: options.offset }) as Record<
    string,
    unknown
  >[];

  return {
    resource: "budgets",
    limit: options.limit,
    offset: options.offset,
    count: countRow.count,
    rows,
  };
};

export const getBudgetById = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare(`${BUDGET_SELECT_SQL} WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;

export const listBudgetSnapshots = (
  db: Database.Database,
  options: ListBudgetSnapshotsOptions,
): BudgetSnapshotListResult => {
  const { whereSql, params } = buildBudgetSnapshotWhere(options.filters);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM budgetSnapshots${whereSql}`)
    .get(params) as { count: number } | undefined;

  if (!countRow || typeof countRow.count !== "number") {
    throw new Error("Could not read budget snapshot count.");
  }

  const rows = db
    .prepare(
      `${BUDGET_SNAPSHOT_SELECT_SQL}${whereSql} ORDER BY dueDate DESC, id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: options.limit, offset: options.offset }) as Record<
    string,
    unknown
  >[];

  return {
    resource: "budgetSnapshots",
    limit: options.limit,
    offset: options.offset,
    count: countRow.count,
    rows,
  };
};

export const getBudgetSnapshotById = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare(`${BUDGET_SNAPSHOT_SELECT_SQL} WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;

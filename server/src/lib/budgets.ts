import Database from "better-sqlite3";
import { localDayKey } from "../../shared/budgetSnapshotGeneration.js";

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
  includeDefinitionDependencies?: boolean;
}

export interface ListBudgetSnapshotsOptions {
  limit: number;
  offset: number;
  filters: BudgetSnapshotFilters;
  includeOccurrenceDependencies?: boolean;
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

const hasSnapshotColumn = (db: Database.Database, column: string): boolean =>
  (db.prepare("PRAGMA table_info(budgetSnapshots)").all() as Array<{ name: string }>)
    .some((row) => row.name === column);

const hasTransactionColumn = (db: Database.Database, column: string): boolean =>
  (db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>)
    .some((row) => row.name === column);

const budgetSnapshotSelectSql = (db: Database.Database): string =>
  BUDGET_SNAPSHOT_SELECT_SQL.replace(
    "remainingCyclesTotal, isHistorical,",
    `remainingCyclesTotal, isHistorical, ${hasSnapshotColumn(db, "isActive") ? "isActive" : "1 AS isActive"}, ${hasSnapshotColumn(db, "resolvedTarget") ? "resolvedTarget" : "NULL AS resolvedTarget"},`,
  );

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

  if (options.includeDefinitionDependencies && rows.length > 0) {
    const ids = rows.map((row) => Number(row.id));
    const placeholders = ids.map(() => "?").join(",");
    const summaries = db.prepare(
      `SELECT b.id,
         COUNT(DISTINCT s.id) AS persistedOccurrenceCount,
         COUNT(DISTINCT t.id) AS transactionDependencyCount
       FROM budgets b
       LEFT JOIN budgetSnapshots s ON s.budgetId = b.id
       LEFT JOIN transactions t ON t.budgetId = b.id OR t.budgetSnapshotId = s.id
       WHERE b.id IN (${placeholders})
       GROUP BY b.id`,
    ).all(...ids) as Array<{
      id: number;
      persistedOccurrenceCount: number;
      transactionDependencyCount: number;
    }>;
    const byId = new Map(summaries.map((summary) => [Number(summary.id), summary]));
    for (const row of rows) {
      const summary = byId.get(Number(row.id));
      row.definitionDependencySummary = {
        persistedOccurrenceCount: Number(summary?.persistedOccurrenceCount ?? 0),
        transactionDependencyCount: Number(summary?.transactionDependencyCount ?? 0),
      };
    }
  }

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
      `${budgetSnapshotSelectSql(db)}${whereSql} ORDER BY dueDate DESC, id ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: options.limit, offset: options.offset }) as Record<
    string,
    unknown
  >[];

  if (options.includeOccurrenceDependencies && rows.length > 0) {
    const snapshotIds = rows.map((row) => Number(row.id));
    const snapshotPlaceholders = snapshotIds.map(() => "?").join(",");
    const linkedTotalSql = hasTransactionColumn(db, "amount")
      ? `COALESCE(SUM(amount${hasTransactionColumn(db, "transactionCost") ? " + COALESCE(transactionCost, 0)" : ""}), 0)`
      : "0";
    const linked = db.prepare(
      `SELECT budgetSnapshotId, COUNT(*) AS linkedTransactionCount,
        ${linkedTotalSql} AS linkedTransactionTotal
       FROM transactions
       WHERE budgetSnapshotId IN (${snapshotPlaceholders})
       GROUP BY budgetSnapshotId`,
    ).all(...snapshotIds) as Array<{ budgetSnapshotId: number; linkedTransactionCount: number; linkedTransactionTotal: number }>;
    const linkedBySnapshotId = new Map(linked.map((row) => [Number(row.budgetSnapshotId), row]));
    const budgetId = options.filters.budgetId;
    const legacyByDay = new Map<string, number>();
    if (budgetId !== undefined) {
      const legacyRows = db.prepare(
        `SELECT occurrenceDate FROM transactions
         WHERE budgetSnapshotId IS NULL AND budgetId = @budgetId AND occurrenceDate IS NOT NULL`,
      ).all({ budgetId }) as Array<{ occurrenceDate: string }>;
      for (const legacy of legacyRows) {
        const day = localDayKey(legacy.occurrenceDate);
        legacyByDay.set(day, (legacyByDay.get(day) ?? 0) + 1);
      }
    }
    for (const row of rows) {
      row.occurrenceDependencySummary = {
        linkedTransactionCount: Number(linkedBySnapshotId.get(Number(row.id))?.linkedTransactionCount ?? 0),
        linkedTransactionTotal: Number(linkedBySnapshotId.get(Number(row.id))?.linkedTransactionTotal ?? 0),
        ambiguousLegacyReferenceCount: budgetId === undefined
          ? 0
          : legacyByDay.get(localDayKey(String(row.occurrenceDate))) ?? 0,
      };
    }
  }

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
  db.prepare(`${budgetSnapshotSelectSql(db)} WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;

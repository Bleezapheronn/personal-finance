import Database from "better-sqlite3";
import {
  buildBudgetSnapshotValues,
  calculateBudgetOccurrenceSchedule,
  localDayKey,
  normalizeToLocalDay,
  type BudgetGenerationDefinition,
} from "../../shared/budgetSnapshotGeneration.js";

type Row = Record<string, unknown>;

const hasColumn = (db: Database.Database, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((row) => row.name === column);

const percentageGoal = (row: Row): boolean =>
  Number(row.goalPercentage ?? 0) > 0;

const targetFloor = (row: Row): number =>
  Math.abs(Number(row.amount) + Number(row.transactionCost ?? 0));

/**
 * The financial-report income period is the occurrence's calendar year, not
 * "YTD today".  That distinction preserves a frozen 2026 target when a 2027
 * successor is being displayed.
 */
export const incomeForOccurrenceYear = (
  db: Database.Database,
  occurrenceDueDate: string | Date,
  asOf: Date,
): number => {
  const due = normalizeToLocalDay(occurrenceDueDate);
  const asOfDay = normalizeToLocalDay(asOf);
  const year = due.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const through = asOfDay < start ? new Date(start.getTime() - 1) : asOfDay > end ? end : asOfDay;
  if (through < start) return 0;
  const row = db.prepare(`SELECT COALESCE(SUM(t.amount + COALESCE(t.transactionCost, 0)), 0) AS total
    FROM transactions t
    JOIN categories c ON c.id = t.categoryId
    JOIN buckets b ON b.id = c.bucketId
    WHERE b.excludeFromReports = 1
      AND date(t.date) >= date(@start)
      AND date(t.date) <= date(@through)`).get({ start: localDayKey(start), through: localDayKey(through) }) as { total: number };
  return Number(row.total ?? 0);
};

export const resolvedPercentageTarget = (
  db: Database.Database,
  row: Row,
  asOf: Date,
): number => Math.max(
  targetFloor(row),
  (Number(row.goalPercentage) / 100) * incomeForOccurrenceYear(db, String(row.dueDate), asOf),
);

export const occurrenceFrozen = (dueDate: string | Date, asOf = new Date()): boolean =>
  normalizeToLocalDay(dueDate).getTime() < normalizeToLocalDay(asOf).getTime();

export const storedBudgetDefinition = (row: Row): BudgetGenerationDefinition => ({
  id: Number(row.id),
  description: String(row.description),
  categoryId: Number(row.categoryId),
  accountId: row.accountId == null ? null : Number(row.accountId),
  recipientId: row.recipientId == null ? null : Number(row.recipientId),
  amount: Number(row.amount),
  transactionCost: row.transactionCost == null ? null : Number(row.transactionCost),
  frequency: row.frequency as BudgetGenerationDefinition["frequency"],
  frequencyDetails: row.frequencyDetails ? JSON.parse(String(row.frequencyDetails)) : null,
  isGoal: Number(row.isGoal),
  isFlexible: Number(row.isFlexible),
  goalPercentage: row.goalPercentage == null ? null : Number(row.goalPercentage),
  goalDirection: row.goalDirection == null ? null : row.goalDirection as BudgetGenerationDefinition["goalDirection"],
  isActive: Number(row.isActive),
  remainingCyclesTotal: row.remainingCyclesTotal == null ? null : Number(row.remainingCyclesTotal),
  dueDate: String(row.dueDate),
  updatedAt: String(row.updatedAt),
});

const projectionStartsOn = (row: Row): Date =>
  normalizeToLocalDay(String(row.projectionStartsOn ?? row.dueDate));

const snapshotForDate = (db: Database.Database, budgetId: number, dueDate: Date): Row | undefined =>
  db.prepare(`SELECT * FROM budgetSnapshots WHERE budgetId = @budgetId
    AND date(dueDate) = date(@dueDate) ORDER BY id ASC LIMIT 1`)
    .get({ budgetId, dueDate: dueDate.toISOString() }) as Row | undefined;

const insertSnapshot = (
  db: Database.Database,
  budget: BudgetGenerationDefinition,
  dueDate: Date,
  cycleIndex: number,
  timestamp: string,
): number => {
  const value = buildBudgetSnapshotValues(budget, dueDate, cycleIndex, true);
  const supportsResolvedTarget = hasColumn(db, "budgetSnapshots", "resolvedTarget");
  const resolvedTarget = Number(value.goalPercentage ?? 0) > 0
    ? resolvedPercentageTarget(db, { ...value, dueDate }, dueDate)
    : null;
  const result = db.prepare(`INSERT INTO budgetSnapshots (
    budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
    accountId, recipientId, amount, transactionCost, frequency, frequencyDetails,
    isGoal, isFlexible, goalPercentage, goalDirection, remainingCyclesTotal,
    isActive, isHistorical${supportsResolvedTarget ? ", resolvedTarget" : ""}, sourceBudgetUpdatedAt, createdAt, updatedAt
  ) VALUES (
    @budgetId, @occurrenceDate, @dueDate, @cycleIndex, @description, @categoryId,
    @accountId, @recipientId, @amount, @transactionCost, @frequency, @frequencyDetails,
    @isGoal, @isFlexible, @goalPercentage, @goalDirection, @remainingCyclesTotal,
    1, 1${supportsResolvedTarget ? ", @resolvedTarget" : ""}, @sourceBudgetUpdatedAt, @createdAt, @updatedAt
  )`).run({
    ...value,
    occurrenceDate: dueDate.toISOString(),
    dueDate: dueDate.toISOString(),
    accountId: value.accountId ?? null,
    recipientId: value.recipientId ?? null,
    transactionCost: value.transactionCost ?? null,
    frequencyDetails: value.frequencyDetails ? JSON.stringify(value.frequencyDetails) : null,
    isGoal: value.isGoal ? 1 : 0,
    isFlexible: value.isFlexible ? 1 : 0,
    goalPercentage: value.goalPercentage ?? null,
    goalDirection: value.goalDirection ?? null,
    remainingCyclesTotal: value.remainingCyclesTotal ?? null,
    resolvedTarget,
    sourceBudgetUpdatedAt: String(value.sourceBudgetUpdatedAt),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return Number(result.lastInsertRowid);
};

/** Finalizes percentage targets only after their local due day has passed. */
export const finalizeFrozenPercentageTargets = (
  db: Database.Database,
  asOf = new Date(),
  budgetId?: number,
): number => {
  if (!hasColumn(db, "budgetSnapshots", "resolvedTarget")) return 0;
  const rows = db.prepare(`SELECT * FROM budgetSnapshots
    WHERE goalPercentage > 0 AND resolvedTarget IS NULL${budgetId === undefined ? "" : " AND budgetId = @budgetId"}`)
    .all(budgetId === undefined ? {} : { budgetId }) as Row[];
  const update = db.prepare(`UPDATE budgetSnapshots
    SET resolvedTarget = @resolvedTarget, updatedAt = @updatedAt
    WHERE id = @id AND resolvedTarget IS NULL`);
  let changed = 0;
  for (const row of rows) {
    if (!occurrenceFrozen(String(row.dueDate), asOf)) continue;
    changed += update.run({ id: row.id, resolvedTarget: resolvedPercentageTarget(db, row, normalizeToLocalDay(String(row.dueDate))), updatedAt: new Date().toISOString() }).changes;
  }
  return changed;
};

/** Materializes only occurrences that are already frozen. Safe to call repeatedly. */
export const catchUpHistoricalOccurrences = (
  db: Database.Database,
  budgetId: number,
  asOf = new Date(),
): number => {
  const row = db.prepare("SELECT * FROM budgets WHERE id = ?").get(budgetId) as Row | undefined;
  if (!row || Number(row.isActive) !== 1) return 0;
  const today = normalizeToLocalDay(asOf);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const definition = storedBudgetDefinition(row);
  const start = projectionStartsOn(row);
  const schedule = calculateBudgetOccurrenceSchedule(definition, yesterday)
    .filter((item) => item.occurrenceDate >= start);
  const timestamp = new Date().toISOString();
  let inserted = 0;
  for (const occurrence of schedule) {
    if (!snapshotForDate(db, budgetId, occurrence.occurrenceDate)) {
      insertSnapshot(db, definition, occurrence.occurrenceDate, occurrence.cycleIndex, timestamp);
      inserted += 1;
    }
  }
  return inserted;
};

/** Synchronizes only durable occurrences still mutable through their local due day. */
export const syncMutableOccurrenceValues = (
  db: Database.Database,
  budgetId: number,
  asOf = new Date(),
): number => {
  const row = db.prepare("SELECT * FROM budgets WHERE id = ?").get(budgetId) as Row | undefined;
  if (!row) return 0;
  const budget = storedBudgetDefinition(row);
  const timestamp = new Date().toISOString();
  const snapshots = db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId = ? ORDER BY id").all(budgetId) as Row[];
  let changed = 0;
  for (const snapshot of snapshots) {
    if (occurrenceFrozen(String(snapshot.dueDate), asOf)) continue;
    const moveOneTimeOccurrence = budget.frequency === "once";
    changed += db.prepare(`UPDATE budgetSnapshots SET
      description=@description, categoryId=@categoryId, accountId=@accountId,
      recipientId=@recipientId, amount=@amount, transactionCost=@transactionCost,
      frequency=@frequency, frequencyDetails=@frequencyDetails, isGoal=@isGoal,
      isFlexible=@isFlexible, goalPercentage=@goalPercentage, goalDirection=@goalDirection,
      remainingCyclesTotal=@remainingCyclesTotal, sourceBudgetUpdatedAt=@sourceBudgetUpdatedAt,
      occurrenceDate=CASE WHEN @moveOneTimeOccurrence = 1 THEN @dueDate ELSE occurrenceDate END,
      dueDate=CASE WHEN @moveOneTimeOccurrence = 1 THEN @dueDate ELSE dueDate END,
      updatedAt=@updatedAt WHERE id=@id`).run({
      id: snapshot.id,
      description: budget.description,
      categoryId: budget.categoryId,
      accountId: budget.accountId,
      recipientId: budget.recipientId,
      amount: budget.amount,
      transactionCost: budget.transactionCost,
      frequency: budget.frequency,
      frequencyDetails: budget.frequencyDetails ? JSON.stringify(budget.frequencyDetails) : null,
      isGoal: budget.isGoal ? 1 : 0,
      isFlexible: budget.isFlexible ? 1 : 0,
      goalPercentage: budget.goalPercentage,
      goalDirection: budget.goalDirection,
      remainingCyclesTotal: budget.remainingCyclesTotal,
      moveOneTimeOccurrence: moveOneTimeOccurrence ? 1 : 0,
      dueDate: budget.dueDate,
      sourceBudgetUpdatedAt: budget.updatedAt,
      updatedAt: timestamp,
    }).changes;
  }
  return changed;
};

export const occurrenceIsActive = (db: Database.Database, snapshotId: number): boolean => {
  if (!hasColumn(db, "budgetSnapshots", "isActive")) return true;
  const row = db.prepare("SELECT isActive FROM budgetSnapshots WHERE id = ?").get(snapshotId) as { isActive?: number } | undefined;
  return Boolean(row && Number(row.isActive) === 1);
};

export const projectedOccurrenceDays = (
  row: Row,
  through: Date,
): Array<{ dueDate: Date; cycleIndex: number }> => {
  if (Number(row.isActive) !== 1) return [];
  const start = projectionStartsOn(row);
  return calculateBudgetOccurrenceSchedule(storedBudgetDefinition(row), through)
    .filter((item) => item.occurrenceDate >= start)
    .map((item) => ({ dueDate: item.occurrenceDate, cycleIndex: item.cycleIndex }));
};

export const localDueDateKey = (value: string | Date): string => localDayKey(value);

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
  const result = db.prepare(`INSERT INTO budgetSnapshots (
    budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
    accountId, recipientId, amount, transactionCost, frequency, frequencyDetails,
    isGoal, isFlexible, goalPercentage, goalDirection, remainingCyclesTotal,
    isActive, isHistorical, sourceBudgetUpdatedAt, createdAt, updatedAt
  ) VALUES (
    @budgetId, @occurrenceDate, @dueDate, @cycleIndex, @description, @categoryId,
    @accountId, @recipientId, @amount, @transactionCost, @frequency, @frequencyDetails,
    @isGoal, @isFlexible, @goalPercentage, @goalDirection, @remainingCyclesTotal,
    1, 1, @sourceBudgetUpdatedAt, @createdAt, @updatedAt
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
    sourceBudgetUpdatedAt: String(value.sourceBudgetUpdatedAt),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return Number(result.lastInsertRowid);
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
    changed += db.prepare(`UPDATE budgetSnapshots SET
      description=@description, categoryId=@categoryId, accountId=@accountId,
      recipientId=@recipientId, amount=@amount, transactionCost=@transactionCost,
      frequency=@frequency, frequencyDetails=@frequencyDetails, isGoal=@isGoal,
      isFlexible=@isFlexible, goalPercentage=@goalPercentage, goalDirection=@goalDirection,
      remainingCyclesTotal=@remainingCyclesTotal, sourceBudgetUpdatedAt=@sourceBudgetUpdatedAt,
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

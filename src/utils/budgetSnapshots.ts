import {
  Budget,
  BudgetSnapshot,
  db,
  ensureBudgetSnapshotForOccurrence,
} from "../db";
import {
  calculateBudgetOccurrenceSchedule,
  getNextBudgetOccurrence,
  normalizeToLocalDay,
} from "../../server/shared/budgetSnapshotGeneration.js";

const normalizeToDay = normalizeToLocalDay;

export const getNextOccurrenceDate = (
  currentDate: Date,
  budget: Budget,
): Date => getNextBudgetOccurrence(currentDate, budget);

export const ensureBudgetSnapshotCoverage = async (
  budget: Budget,
  horizonDateInput: Date,
): Promise<BudgetSnapshot[]> => {
  if (!budget.id || !budget.isActive) {
    return [];
  }

  const horizonDate = normalizeToDay(horizonDateInput);
  const today = normalizeToDay(new Date());
  const schedule = calculateBudgetOccurrenceSchedule(budget, horizonDate);

  for (const occurrence of schedule) {
    await ensureBudgetSnapshotForOccurrence(budget, occurrence.occurrenceDate, {
      cycleIndex: occurrence.cycleIndex,
      isHistorical: occurrence.occurrenceDate < today,
    });
  }

  return db.budgetSnapshots.where("budgetId").equals(budget.id).toArray();
};

export const deleteFutureUnlinkedSnapshotsForBudget = async (
  budgetId: number,
  fromDateInput: Date,
): Promise<number> => {
  const fromDate = normalizeToDay(fromDateInput);
  const snapshots = await db.budgetSnapshots
    .where("budgetId")
    .equals(budgetId)
    .toArray();

  let deleted = 0;

  for (const snapshot of snapshots) {
    const snapshotDate = normalizeToDay(snapshot.occurrenceDate);
    if (snapshotDate < fromDate || !snapshot.id) {
      continue;
    }

    const linkedCount = await db.transactions
      .where("budgetSnapshotId")
      .equals(snapshot.id)
      .count();

    if (linkedCount === 0) {
      await db.budgetSnapshots.delete(snapshot.id);
      deleted += 1;
    }
  }

  return deleted;
};

export const updateUnlockedSnapshotsForBudget = async (
  budget: Budget,
  fromDateInput: Date,
): Promise<number> => {
  if (!budget.id) {
    return 0;
  }

  const fromDate = normalizeToDay(fromDateInput);
  // Use a defensive scan to avoid missing rows if budgetId type drift exists.
  const snapshots = await db.budgetSnapshots
    .filter((snapshot) => Number(snapshot.budgetId) === Number(budget.id))
    .toArray();

  const budgetDueDate = normalizeToDay(budget.dueDate);

  let updated = 0;

  for (const snapshot of snapshots) {
    if (!snapshot.id) {
      continue;
    }

    const snapshotDueDate = normalizeToDay(
      snapshot.dueDate || snapshot.occurrenceDate,
    );

    // For once budgets, lock semantics should follow the budget due date.
    // This avoids UTC/local timestamp drift prematurely locking the only snapshot.
    const lockDate =
      budget.frequency === "once" ? budgetDueDate : snapshotDueDate;

    if (lockDate < fromDate) {
      continue;
    }

    await db.budgetSnapshots.update(snapshot.id, {
      description: budget.description,
      categoryId: budget.categoryId,
      accountId: budget.accountId,
      recipientId: budget.recipientId,
      amount: budget.amount,
      transactionCost: budget.transactionCost,
      frequency: budget.frequency,
      frequencyDetails: budget.frequencyDetails,
      isGoal: budget.isGoal,
      isFlexible: budget.isFlexible,
      goalPercentage: budget.goalPercentage,
      goalDirection: budget.goalDirection,
      remainingCyclesTotal: budget.remainingCyclesTotal ?? null,
      sourceBudgetUpdatedAt: budget.updatedAt,
      updatedAt: new Date(),
    });
    updated += 1;
  }

  return updated;
};

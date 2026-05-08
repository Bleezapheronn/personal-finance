import {
  Budget,
  BudgetSnapshot,
  db,
  ensureBudgetSnapshotForOccurrence,
} from "../db";

const normalizeToDay = (value: Date): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const getNextOccurrenceDate = (
  currentDate: Date,
  budget: Budget,
): Date => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const day = currentDate.getDate();

  let nextYear = year;
  let nextMonth = month;
  let nextDay = day;

  switch (budget.frequency) {
    case "daily":
      nextDay += 1;
      break;
    case "weekly":
      nextDay += 7;
      break;
    case "monthly":
      if (budget.frequencyDetails?.dayOfMonth) {
        const requestedDay = budget.frequencyDetails.dayOfMonth;
        nextMonth += 1;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear += 1;
        }
        const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
        nextDay = Math.min(requestedDay, lastDayOfMonth);
      }
      break;
    case "yearly":
      nextYear += 1;
      break;
    case "custom":
      if (budget.frequencyDetails?.intervalDays) {
        nextDay += budget.frequencyDetails.intervalDays;
      }
      break;
    default:
      break;
  }

  return new Date(nextYear, nextMonth, nextDay);
};

const getMaxCycles = (budget: Budget): number => {
  if (
    budget.remainingCyclesTotal === null ||
    budget.remainingCyclesTotal === undefined
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (budget.remainingCyclesTotal < 1) {
    return 0;
  }

  return budget.remainingCyclesTotal;
};

export const ensureBudgetSnapshotCoverage = async (
  budget: Budget,
  horizonDateInput: Date,
): Promise<BudgetSnapshot[]> => {
  if (!budget.id || !budget.isActive) {
    return [];
  }

  const horizonDate = normalizeToDay(horizonDateInput);
  const today = normalizeToDay(new Date());
  const maxCycles = getMaxCycles(budget);

  if (maxCycles === 0) {
    return [];
  }

  let occurrenceDate = normalizeToDay(budget.dueDate);
  let cycleIndex = 1;
  let guard = 0;

  while (occurrenceDate <= horizonDate && cycleIndex <= maxCycles) {
    await ensureBudgetSnapshotForOccurrence(budget, occurrenceDate, {
      cycleIndex,
      isHistorical: occurrenceDate < today,
    });

    if (budget.frequency === "once") {
      break;
    }

    occurrenceDate = normalizeToDay(
      getNextOccurrenceDate(occurrenceDate, budget),
    );
    cycleIndex += 1;

    guard += 1;
    if (guard > 5000) {
      break;
    }
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

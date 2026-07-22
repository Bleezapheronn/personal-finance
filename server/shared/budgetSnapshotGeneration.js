const FREQUENCIES = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
]);

const positiveInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const normalizeToLocalDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("date_invalid");
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

export const localDayKey = (value) => {
  const date = normalizeToLocalDay(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const addLocalCalendarYear = (value) => {
  const date = normalizeToLocalDay(value);
  date.setFullYear(date.getFullYear() + 1);
  return normalizeToLocalDay(date);
};

export const getBudgetMaxCycles = (budget) => {
  if (
    budget.remainingCyclesTotal === null ||
    budget.remainingCyclesTotal === undefined
  ) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (
    typeof budget.remainingCyclesTotal !== "number" ||
    !Number.isInteger(budget.remainingCyclesTotal)
  ) {
    throw new Error("remaining_cycles_invalid");
  }
  return Math.max(0, budget.remainingCyclesTotal);
};

export const getNextBudgetOccurrence = (currentDateInput, budget) => {
  const currentDate = normalizeToLocalDay(currentDateInput);
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
    case "monthly": {
      const requestedDay = budget.frequencyDetails?.dayOfMonth;
      if (!positiveInteger(requestedDay) || requestedDay > 31) {
        throw new Error("monthly_day_of_month_invalid");
      }
      nextMonth += 1;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
      const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
      nextDay = Math.min(requestedDay, lastDayOfMonth);
      break;
    }
    case "yearly":
      nextYear += 1;
      break;
    case "custom": {
      const intervalDays = budget.frequencyDetails?.intervalDays;
      if (!positiveInteger(intervalDays)) {
        throw new Error("custom_interval_days_invalid");
      }
      nextDay += intervalDays;
      break;
    }
    case "once":
      break;
    default:
      throw new Error("frequency_invalid");
  }

  return normalizeToLocalDay(new Date(nextYear, nextMonth, nextDay));
};

export const calculateBudgetOccurrenceSchedule = (
  budget,
  horizonDateInput,
  guardLimit = 5000,
) => {
  if (!FREQUENCIES.has(budget.frequency)) {
    throw new Error("frequency_invalid");
  }
  const horizonDate = normalizeToLocalDay(horizonDateInput);
  const maxCycles = getBudgetMaxCycles(budget);
  if (maxCycles === 0) {
    return [];
  }

  let occurrenceDate = normalizeToLocalDay(budget.dueDate);
  let cycleIndex = 1;
  let advances = 0;
  const occurrences = [];

  while (occurrenceDate <= horizonDate && cycleIndex <= maxCycles) {
    occurrences.push({ occurrenceDate: new Date(occurrenceDate), cycleIndex });
    if (budget.frequency === "once") {
      break;
    }
    if (advances >= guardLimit) {
      throw new Error("recurrence_guard_exceeded");
    }
    const nextOccurrence = getNextBudgetOccurrence(occurrenceDate, budget);
    if (nextOccurrence.getTime() <= occurrenceDate.getTime()) {
      throw new Error("recurrence_does_not_advance");
    }
    occurrenceDate = nextOccurrence;
    cycleIndex += 1;
    advances += 1;
  }

  return occurrences;
};

export const effectiveGoalDirection = (goalDirection, amount) => {
  if (goalDirection === "expense") return "expense";
  if (goalDirection === "income") return "income";
  return Number(amount) < 0 ? "expense" : "income";
};

export const buildBudgetSnapshotValues = (
  budget,
  occurrenceDateInput,
  cycleIndex,
  isHistorical,
) => {
  const occurrenceDate = normalizeToLocalDay(occurrenceDateInput);
  return {
    budgetId: Number(budget.id),
    occurrenceDate,
    dueDate: new Date(occurrenceDate),
    cycleIndex,
    description: budget.description,
    categoryId: Number(budget.categoryId),
    accountId: budget.accountId,
    recipientId: budget.recipientId,
    amount: Number(budget.amount),
    transactionCost: budget.transactionCost,
    frequency: budget.frequency,
    frequencyDetails: budget.frequencyDetails
      ? { ...budget.frequencyDetails }
      : undefined,
    isGoal: budget.isGoal === true || Number(budget.isGoal) === 1,
    isFlexible:
      budget.isFlexible === true || Number(budget.isFlexible ?? 0) === 1,
    goalPercentage: budget.goalPercentage,
    goalDirection: budget.goalDirection,
    remainingCyclesTotal: budget.remainingCyclesTotal ?? null,
    isHistorical,
    sourceBudgetUpdatedAt: budget.updatedAt,
  };
};

const addToGroup = (groups, key, value) => {
  const current = groups.get(key);
  if (current) current.push(value);
  else groups.set(key, [value]);
};

export const calculateMissingBudgetSnapshotPlan = ({
  budgets,
  existingSnapshots,
  asOf,
}) => {
  const normalizedAsOfDate = normalizeToLocalDay(asOf);
  const activeHorizon = addLocalCalendarYear(normalizedAsOfDate);
  const budgetById = new Map();
  const validationErrors = new Set();
  const conflicts = new Map();
  const occurrenceGroups = new Map();
  const dueDateGroups = new Map();

  for (const budget of budgets) {
    const id = Number(budget.id);
    if (!positiveInteger(id)) {
      validationErrors.add("budget_id_invalid");
      continue;
    }
    budgetById.set(id, budget);
  }

  for (const snapshot of existingSnapshots) {
    const budgetId = Number(snapshot.budgetId);
    if (!positiveInteger(budgetId) || !budgetById.has(budgetId)) {
      validationErrors.add("snapshot_parent_budget_missing");
      continue;
    }
    try {
      const occurrenceKey = `${budgetId}:${localDayKey(snapshot.occurrenceDate)}`;
      const dueDateKey = `${budgetId}:${localDayKey(snapshot.dueDate)}`;
      addToGroup(occurrenceGroups, occurrenceKey, snapshot);
      addToGroup(dueDateGroups, dueDateKey, snapshot);
    } catch {
      validationErrors.add("snapshot_date_invalid");
    }
  }

  for (const [key, rows] of occurrenceGroups) {
    if (rows.length > 1) {
      conflicts.set(`occurrence:${key}`, "duplicate_occurrence_snapshots");
    }
  }
  for (const [key, rows] of dueDateGroups) {
    if (rows.length > 1) {
      conflicts.set(`due:${key}`, "duplicate_due_date_snapshots");
    }
  }

  const candidates = [];
  let eligibleBudgetCount = 0;
  let skippedExistingCount = 0;

  for (const budget of budgets) {
    const budgetId = Number(budget.id);
    if (!positiveInteger(budgetId)) continue;
    const horizon =
      budget.isActive === true || Number(budget.isActive) === 1
        ? activeHorizon
        : normalizedAsOfDate;
    let schedule;
    try {
      schedule = calculateBudgetOccurrenceSchedule(budget, horizon);
    } catch (error) {
      validationErrors.add(
        error instanceof Error ? error.message : "recurrence_invalid",
      );
      continue;
    }
    if (schedule.length > 0) eligibleBudgetCount += 1;

    for (const occurrence of schedule) {
      const day = localDayKey(occurrence.occurrenceDate);
      const key = `${budgetId}:${day}`;
      const occurrenceRows = occurrenceGroups.get(key) ?? [];
      const dueRows = dueDateGroups.get(key) ?? [];
      if (occurrenceRows.length > 1 || dueRows.length > 1) continue;
      if (occurrenceRows.length === 1) {
        const row = occurrenceRows[0];
        if (localDayKey(row.dueDate) !== day) {
          conflicts.set(`identity:${key}`, "snapshot_identity_disagreement");
        } else {
          skippedExistingCount += 1;
        }
        continue;
      }
      if (dueRows.length === 1) {
        conflicts.set(`identity:${key}`, "snapshot_identity_disagreement");
        continue;
      }
      candidates.push({
        identityKey: key,
        values: buildBudgetSnapshotValues(
          budget,
          occurrence.occurrenceDate,
          occurrence.cycleIndex,
          occurrence.occurrenceDate < normalizedAsOfDate,
        ),
      });
    }
  }

  const recurrenceSummary = {};
  const goalDirectionSummary = { expense: 0, income: 0, fallback: 0 };
  for (const candidate of candidates) {
    const values = candidate.values;
    recurrenceSummary[values.frequency] =
      (recurrenceSummary[values.frequency] ?? 0) + 1;
    const effective = effectiveGoalDirection(
      values.goalDirection,
      values.amount,
    );
    goalDirectionSummary[effective] += 1;
    if (values.goalDirection == null) goalDirectionSummary.fallback += 1;
  }

  return {
    normalizedAsOf: localDayKey(normalizedAsOfDate),
    normalizedAsOfDate,
    activeHorizon: localDayKey(activeHorizon),
    eligibleBudgetCount,
    existingSnapshotCount: existingSnapshots.length,
    proposedSnapshotCount: candidates.length,
    skippedExistingCount,
    conflictCount: conflicts.size,
    conflictCodes: [...new Set(conflicts.values())].sort(),
    validationErrors: [...validationErrors].sort(),
    recurrenceSummary,
    goalDirectionSummary,
    candidates,
  };
};

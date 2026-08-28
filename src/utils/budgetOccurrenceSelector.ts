import { Budget, BudgetSnapshot } from "../db";
import {
  calculateBudgetOccurrenceSchedule,
  normalizeToLocalDay,
} from "../../server/shared/budgetSnapshotGeneration.js";

export type BudgetOccurrenceSource = "snapshot" | "projected";

export interface BudgetOccurrenceSelection {
  source: BudgetOccurrenceSource;
  budgetSnapshotId?: number;
  budgetId: number;
  budget: Budget & { resolvedTarget?: number | null };
  dueDate: Date;
  isActive: boolean;
  occurrenceStateSupported: boolean;
}

interface SelectBudgetOccurrencesInput {
  budgets: Budget[];
  snapshots: BudgetSnapshot[];
  through: Date;
  historicalOnly?: boolean;
}

const day = (value: Date): Date => normalizeToLocalDay(value);

const occurrenceKey = (budgetId: number, dueDate: Date): string =>
  `${budgetId}:${day(dueDate).getTime()}`;

const snapshotBudget = (
  budget: Budget,
  snapshot: BudgetSnapshot,
  dueDate: Date,
): Budget & { resolvedTarget?: number | null } => ({
  ...budget,
  description: snapshot.description,
  categoryId: snapshot.categoryId,
  accountId: snapshot.accountId,
  recipientId: snapshot.recipientId,
  amount: snapshot.amount,
  transactionCost: snapshot.transactionCost,
  frequency: snapshot.frequency,
  frequencyDetails: snapshot.frequencyDetails,
  isGoal: snapshot.isGoal,
  isFlexible: snapshot.isFlexible,
  goalPercentage: snapshot.goalPercentage,
  goalDirection: snapshot.goalDirection,
  remainingCyclesTotal: snapshot.remainingCyclesTotal,
  resolvedTarget: snapshot.resolvedTarget,
  dueDate,
  updatedAt: snapshot.sourceBudgetUpdatedAt,
});

/**
 * Merges durable snapshots with read-only recurrence projections. A snapshot
 * always wins for its Budget/date identity; projections exist only for active
 * definitions and never create or alter persisted data.
 */
export const selectBudgetOccurrences = ({
  budgets,
  snapshots,
  through,
  historicalOnly = false,
}: SelectBudgetOccurrencesInput): BudgetOccurrenceSelection[] => {
  const horizon = day(through);
  const budgetById = new Map(
    budgets
      .filter((budget): budget is Budget & { id: number } => budget.id !== undefined)
      .map((budget) => [budget.id, budget]),
  );
  const selectedSnapshots = new Map<string, BudgetSnapshot>();

  snapshots.forEach((snapshot) => {
    const dueDate = day(snapshot.dueDate);
    if (dueDate > horizon || (historicalOnly && dueDate >= horizon)) return;
    if (!budgetById.has(snapshot.budgetId)) return;
    const key = occurrenceKey(snapshot.budgetId, dueDate);
    const existing = selectedSnapshots.get(key);
    if (
      !existing ||
      new Date(snapshot.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()
    ) {
      selectedSnapshots.set(key, snapshot);
    }
  });

  const selections: BudgetOccurrenceSelection[] = Array.from(
    selectedSnapshots.values(),
  ).map((snapshot) => {
    const dueDate = day(snapshot.dueDate);
    const budget = budgetById.get(snapshot.budgetId)!;
    return {
      source: "snapshot",
      budgetSnapshotId: snapshot.id,
      budgetId: snapshot.budgetId,
      budget: snapshotBudget(budget, snapshot, dueDate),
      dueDate,
      isActive: snapshot.isActive !== false,
      occurrenceStateSupported: snapshot.isActive !== undefined,
    };
  });

  budgets.forEach((budget) => {
    if (!budget.isActive || budget.id === undefined) return;
    const projectionStart = day(budget.projectionStartsOn ?? budget.dueDate);
    let schedule;
    try {
      schedule = calculateBudgetOccurrenceSchedule(budget, horizon);
    } catch {
      return;
    }
    schedule.forEach(({ occurrenceDate }) => {
      const dueDate = day(occurrenceDate);
      if (dueDate < projectionStart || (historicalOnly && dueDate >= horizon)) {
        return;
      }
      if (selectedSnapshots.has(occurrenceKey(budget.id!, dueDate))) return;
      selections.push({
        source: "projected",
        budgetId: budget.id!,
        budget: { ...budget, dueDate },
        dueDate,
        isActive: true,
        occurrenceStateSupported: false,
      });
    });
  });

  return selections.sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime());
};

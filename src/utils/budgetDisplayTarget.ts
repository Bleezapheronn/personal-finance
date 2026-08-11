import type { Budget, BudgetSnapshot } from "../db";

type PercentageSource = Pick<Budget | BudgetSnapshot, "amount" | "transactionCost" | "goalPercentage" | "dueDate"> & {
  resolvedTarget?: number | null;
};

const localDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

export const occurrenceIsFrozen = (dueDate: Date, asOf = new Date()): boolean =>
  localDay(dueDate).getTime() < localDay(asOf).getTime();

export const fixedBudgetTarget = (value: Pick<PercentageSource, "amount" | "transactionCost">): number =>
  Math.abs(value.amount + (value.transactionCost ?? 0));

export const percentageBudgetTarget = (
  value: Pick<PercentageSource, "amount" | "transactionCost" | "goalPercentage">,
  calendarYearIncome: number,
): number => Math.max(fixedBudgetTarget(value), (Number(value.goalPercentage ?? 0) / 100) * calendarYearIncome);

/**
 * A frozen percentage occurrence must carry its final target.  Returning null
 * for legacy rows without it prevents a silent recomputation from today's
 * income.
 */
export const occurrenceDisplayTarget = (
  occurrence: PercentageSource,
  calendarYearIncome: number,
  asOf = new Date(),
): number | null => {
  if (Number(occurrence.goalPercentage ?? 0) <= 0) return fixedBudgetTarget(occurrence);
  if (occurrenceIsFrozen(occurrence.dueDate, asOf)) {
    return occurrence.resolvedTarget == null ? null : Number(occurrence.resolvedTarget);
  }
  return percentageBudgetTarget(occurrence, calendarYearIncome);
};

export const definitionDisplayTarget = (
  budget: Pick<PercentageSource, "amount" | "transactionCost" | "goalPercentage">,
  calendarYearIncome: number,
): number => Number(budget.goalPercentage ?? 0) > 0
  ? percentageBudgetTarget(budget, calendarYearIncome)
  : fixedBudgetTarget(budget);

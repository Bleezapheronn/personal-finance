type BudgetAmountDirection = "income" | "expense" | null | undefined;

/**
 * Explicit goal direction is the authoritative presentation semantic. Older
 * records without it retain the Budget Definitions net-amount fallback.
 */
export const isExpenseBudgetAmount = (value: {
  goalDirection?: BudgetAmountDirection;
  amount: number;
  transactionCost?: number | null;
}): boolean => value.goalDirection === "expense" || (
  value.goalDirection !== "income" &&
  value.amount + (value.transactionCost ?? 0) < 0
);

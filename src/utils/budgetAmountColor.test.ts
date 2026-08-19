import { describe, expect, it } from "vitest";
import { isExpenseBudgetAmount } from "./budgetAmountColor";

describe("Budget Definition amount color", () => {
  it("uses an explicit expense direction even when the stored base amount is non-negative", () => {
    expect(isExpenseBudgetAmount({ goalDirection: "expense", amount: 0 })).toBe(true);
  });

  it("preserves explicit income and the legacy net-amount fallback", () => {
    expect(isExpenseBudgetAmount({ goalDirection: "income", amount: -100 })).toBe(false);
    expect(isExpenseBudgetAmount({ amount: 10, transactionCost: -20 })).toBe(true);
    expect(isExpenseBudgetAmount({ amount: 10, transactionCost: -5 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { budgetDefinitionIncomeForYear, normalizeBudgetDefinitionTransaction } from "./budgetDefinitionIncome";

describe("Budget Definitions HTTP transactions", () => {
  it("normalizes authoritative ISO transaction dates before calculating income", () => {
    const transaction = normalizeBudgetDefinitionTransaction({
      id: 8, categoryId: 4, recipientId: 3, accountId: 2,
      date: "2026-08-11T08:30:00.000Z", amount: 1_000, transactionCost: -5,
    });
    expect(transaction?.date).toBeInstanceOf(Date);
    expect(budgetDefinitionIncomeForYear(
      [transaction!],
      [{ id: 4, bucketId: 9 } as never],
      [{ id: 9, excludeFromReports: true } as never],
      2026,
    )).toBe(995);
  });
});

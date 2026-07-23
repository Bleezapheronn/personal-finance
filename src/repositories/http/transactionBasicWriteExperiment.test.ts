import {
  transactionCostBudgetBaseEligibilityReason,
  transactionCostBudgetEligibilityReason,
} from "./transactionBasicWriteExperiment";

const transaction = {
  id: 1,
  amount: -25,
  accountId: 2,
  categoryId: 3,
  recipientId: 4,
  transactionCost: -1,
  isTransfer: false,
  transferPairId: null,
};

describe("transaction cost and Budget edit eligibility", () => {
  test("accepts a valid unlinked transaction and valid unlink state", () => {
    expect(
      transactionCostBudgetEligibilityReason(transaction, [], []),
    ).toBeUndefined();
  });

  test("accepts a valid linked transaction after date normalization", () => {
    expect(
      transactionCostBudgetEligibilityReason(
        {
          ...transaction,
          budgetId: 20,
          budgetSnapshotId: 10,
          occurrenceDate: new Date("2026-07-23T00:00:00.000Z"),
        },
        [
          {
            id: 10,
            budgetId: 20,
            dueDate: "2026-07-23T00:00:00.000Z",
          },
        ],
        [{ id: 20 }],
      ),
    ).toBeUndefined();
  });

  test("rejects a missing snapshot", () => {
    expect(
      transactionCostBudgetEligibilityReason(
        {
          ...transaction,
          budgetId: 20,
          budgetSnapshotId: 10,
          occurrenceDate: "2026-07-23T00:00:00.000Z",
        },
        [],
        [{ id: 20 }],
      ),
    ).toBe("budget_snapshot_not_found");
  });

  test("rejects a Budget mismatch", () => {
    expect(
      transactionCostBudgetEligibilityReason(
        {
          ...transaction,
          budgetId: 21,
          budgetSnapshotId: 10,
          occurrenceDate: "2026-07-23T00:00:00.000Z",
        },
        [
          {
            id: 10,
            budgetId: 20,
            dueDate: "2026-07-23T00:00:00.000Z",
          },
        ],
        [{ id: 20 }],
      ),
    ).toBe("budget_snapshot_budget_mismatch");
  });

  test("rejects an occurrence mismatch", () => {
    expect(
      transactionCostBudgetEligibilityReason(
        {
          ...transaction,
          budgetId: 20,
          budgetSnapshotId: 10,
          occurrenceDate: "2026-07-24T00:00:00.000Z",
        },
        [
          {
            id: 10,
            budgetId: 20,
            dueDate: "2026-07-23T00:00:00.000Z",
          },
        ],
        [{ id: 20 }],
      ),
    ).toBe("budget_snapshot_occurrence_mismatch");
  });

  test("rejects legacy-only linkage", () => {
    expect(
      transactionCostBudgetEligibilityReason(
        { ...transaction, budgetId: 20 },
        [],
        [{ id: 20 }],
      ),
    ).toBe("legacy_only_budget_link_not_supported");
  });

  test("keeps transfers under transfer eligibility", () => {
    expect(
      transactionCostBudgetBaseEligibilityReason({
        ...transaction,
        isTransfer: true,
        transferPairId: 2,
      }),
    ).toBe("transfers_not_supported");
  });
});

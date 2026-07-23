import type { BudgetDeleteWriteResponse } from "./budgetDeleteWriteExperiment";
import {
  budgetDeleteBlockedMessage,
  budgetDeleteConfirmationMessage,
  budgetDeleteRefreshFailureMessage,
  shouldShowBudgetDeleteControl,
} from "./budgetDeleteControl";

const plan = (
  overrides: Partial<BudgetDeleteWriteResponse> = {},
): BudgetDeleteWriteResponse => ({
  ok: true,
  entity: "budgetLifecycle",
  action: "deleteBudget",
  targetPresent: true,
  eligible: true,
  budgetActive: true,
  snapshotCount: 3,
  unlinkedSnapshotCount: 3,
  linkedSnapshotCount: 0,
  legacyDirectTransactionReferenceCount: 0,
  canonicalTransactionReferenceCount: 0,
  transactionDependencyCount: 0,
  conflictCount: 0,
  expectedRowsDeleted: 4,
  planFingerprint: "present",
  validationErrors: [],
  warnings: [],
  wouldMutate: false,
  sqliteMutated: false,
  rowsChanged: 0,
  transactionLinkMutation: false,
  resultCodes: [],
  ...overrides,
});

describe("Budget delete control presentation", () => {
  test("shows for a ready SQLite capability and valid target", () => {
    expect(shouldShowBudgetDeleteControl(7, true, true)).toBe(true);
  });

  test("remains unavailable when capability is absent or readiness is blocked", () => {
    expect(shouldShowBudgetDeleteControl(7, true, false)).toBe(false);
    expect(shouldShowBudgetDeleteControl(undefined, true, true)).toBe(false);
  });

  test("keeps the eligible dry-run confirmation redacted and count-only", () => {
    expect(budgetDeleteConfirmationMessage(plan())).toContain(
      "3 unlinked snapshot(s)",
    );
    expect(budgetDeleteConfirmationMessage(plan())).toContain(
      "No transactions will be unlinked or deleted.",
    );
  });

  test("reports canonical and legacy transaction dependencies without shortcuts", () => {
    const blocked = plan({
      eligible: false,
      linkedSnapshotCount: 1,
      canonicalTransactionReferenceCount: 1,
      legacyDirectTransactionReferenceCount: 1,
      transactionDependencyCount: 2,
      conflictCount: 0,
      planFingerprint: undefined,
    });
    expect(budgetDeleteBlockedMessage(blocked)).toContain(
      "2 protected transaction dependency/dependencies",
    );
    expect(budgetDeleteBlockedMessage(blocked)).toContain("No rows changed.");
  });

  test("distinguishes refresh failure after a successful write", () => {
    expect(budgetDeleteRefreshFailureMessage(true)).toBe(
      "budget_delete_refresh_failed_sqlite_may_have_changed",
    );
    expect(budgetDeleteRefreshFailureMessage(false)).toBe(
      "budget_delete_write_failed",
    );
  });
});

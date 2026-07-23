import type { BudgetDeleteWriteResponse } from "./budgetDeleteWriteExperiment";

export const shouldShowBudgetDeleteControl = (
  budgetId: unknown,
  httpReadonly: boolean,
  sqliteDeleteEnabled: boolean,
): boolean =>
  typeof budgetId === "number" &&
  Number.isInteger(budgetId) &&
  budgetId > 0 &&
  (!httpReadonly || sqliteDeleteEnabled);

export const budgetDeleteBlockedMessage = (
  plan: BudgetDeleteWriteResponse,
): string =>
  `Budget deletion blocked: ${plan.transactionDependencyCount} protected transaction dependency/dependencies and ${plan.conflictCount} conflict(s). No rows changed.`;

export const budgetDeleteConfirmationMessage = (
  plan: BudgetDeleteWriteResponse,
): string =>
  `This permanently removes the Budget and ${plan.snapshotCount} unlinked snapshot(s) from SQLite. Transaction dependencies: ${plan.transactionDependencyCount}. No transactions will be unlinked or deleted. Rotate the authority checkpoint before restart.`;

export const budgetDeleteRefreshFailureMessage = (
  sqliteMutated: boolean,
): string =>
  sqliteMutated
    ? "budget_delete_refresh_failed_sqlite_may_have_changed"
    : "budget_delete_write_failed";

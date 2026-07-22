import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const BUDGET_DELETE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUDGET_DELETE_WRITE_EXPERIMENT";

const CONFIRMATION =
  "delete budget and unlinked snapshots from disposable sqlite" as const;

export interface BudgetDeleteWriteResponse {
  ok: boolean;
  code?: string;
  entity: "budgetLifecycle";
  action: "deleteBudget";
  targetPresent: boolean;
  eligible: boolean;
  budgetActive: boolean | null;
  snapshotCount: number;
  unlinkedSnapshotCount: number;
  linkedSnapshotCount: number;
  legacyDirectTransactionReferenceCount: number;
  canonicalTransactionReferenceCount: number;
  transactionDependencyCount: number;
  conflictCount: number;
  expectedRowsDeleted: number;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  transactionLinkMutation: false;
  resultCodes: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() || undefined;
};

export const isBudgetDeleteWriteExperimentEnabled = (): boolean =>
  envValue(BUDGET_DELETE_WRITE_EXPERIMENT_FLAG) === "true";

export const budgetDeleteWriteErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "budget_delete_write_failed";

export const dryRunBudgetDelete = async (
  budgetId: number,
): Promise<BudgetDeleteWriteResponse> => {
  const response = await localApiPost<BudgetDeleteWriteResponse>(
    "/prototype/repositories/budgets/delete/dry-run",
    { budgetId },
  );
  if (
    response.entity !== "budgetLifecycle" ||
    response.action !== "deleteBudget" ||
    response.wouldMutate !== false ||
    response.sqliteMutated !== false
  ) {
    throw new LocalApiError(
      response.code ?? "budget_delete_dry_run_invalid",
      "Budget deletion dry-run failed.",
    );
  }
  return response;
};

export const writeBudgetDelete = async (
  budgetId: number,
  expectedPlanFingerprint: string,
): Promise<BudgetDeleteWriteResponse> => {
  const response = await localApiPost<BudgetDeleteWriteResponse>(
    "/prototype/repositories/budgets/delete/write",
    {
      budgetId,
      dryRunReviewed: true,
      confirmation: CONFIRMATION,
      expectedPlanFingerprint,
    },
  );
  if (
    response.ok !== true ||
    response.entity !== "budgetLifecycle" ||
    response.action !== "deleteBudget" ||
    response.sqliteMutated !== true ||
    response.transactionLinkMutation !== false
  ) {
    throw new LocalApiError(
      response.code ?? "budget_delete_write_failed",
      "Budget deletion write failed.",
    );
  }
  return response;
};

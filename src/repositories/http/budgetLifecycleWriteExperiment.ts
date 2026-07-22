import { LocalApiError, localApiPost } from "../../api/localApiClient";
import type { BudgetDefinitionWriteInput } from "./budgetDefinitionWriteExperiment";

export const BUDGET_LIFECYCLE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUDGET_LIFECYCLE_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  create: "create budget and lifecycle coverage in disposable sqlite",
  update: "update budget and lifecycle coverage in disposable sqlite",
} as const;

export type BudgetLifecycleAction = keyof typeof CONFIRMATIONS;
export interface BudgetLifecycleInput extends BudgetDefinitionWriteInput {
  isActive: boolean;
  asOf: string;
}
export interface BudgetLifecycleResponse {
  ok: boolean;
  code?: string;
  entity: "budgetLifecycle";
  action: "createBudgetLifecycle" | "updateBudgetLifecycle";
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  targetId?: number;
  planFingerprint?: string;
  unlinkedFutureSnapshotsProposedForCleanup: number;
  linkedSnapshotsProtected: number;
  outOfScheduleLinkedSnapshotsRetained: number;
  snapshotsProposedForGeneration: number;
  validationErrors: string[];
  warnings: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() || undefined;
};

export const isBudgetLifecycleWriteExperimentEnabled = (): boolean =>
  envValue(BUDGET_LIFECYCLE_WRITE_EXPERIMENT_FLAG) === "true";

export const budgetLifecycleWriteErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "budget_lifecycle_write_failed";

const path = (action: BudgetLifecycleAction, operation: "dry-run" | "write") =>
  `/prototype/repositories/budgets/lifecycle/${operation}/${action}`;

export const dryRunBudgetLifecycle = async (
  action: BudgetLifecycleAction,
  input: BudgetLifecycleInput & { id?: number },
): Promise<BudgetLifecycleResponse> => {
  const response = await localApiPost<BudgetLifecycleResponse>(
    path(action, "dry-run"), input,
  );
  if (response.ok !== true || response.dryRun !== true ||
      response.wouldMutate !== false || !response.planFingerprint) {
    throw new LocalApiError(
      response.code ?? `budget_lifecycle_${action}_dry_run_failed`,
      "Budget lifecycle dry-run failed.",
    );
  }
  return response;
};

export const writeBudgetLifecycle = async (
  action: BudgetLifecycleAction,
  input: BudgetLifecycleInput & { id?: number },
  planFingerprint: string,
): Promise<BudgetLifecycleResponse> => {
  const response = await localApiPost<BudgetLifecycleResponse>(
    path(action, "write"),
    {
      ...input,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS[action],
      expectedPlanFingerprint: planFingerprint,
    },
  );
  if (response.ok !== true || response.sqliteMutated !== true) {
    throw new LocalApiError(
      response.code ?? `budget_lifecycle_${action}_write_failed`,
      "Budget lifecycle write failed.",
    );
  }
  return response;
};

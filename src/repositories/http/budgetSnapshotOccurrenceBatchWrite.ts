import { LocalApiError, localApiPost } from "../../api/localApiClient";

export type BudgetOccurrenceBatchAction = "setActive" | "delete";

export interface BudgetOccurrenceBatchInput {
  action: BudgetOccurrenceBatchAction;
  budgetId: number;
  snapshotIds: number[];
  isActive?: boolean;
}

export interface BudgetOccurrenceBatchResponse {
  ok: boolean;
  dryRun: boolean;
  action: BudgetOccurrenceBatchAction;
  selectedCount: number;
  matchedCount: number;
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  validationErrors: string[];
  rowsChanged: number;
  sqliteMutated: boolean;
  planFingerprint?: string;
  code?: string;
}

const BATCH_CONFIRMATION = "apply selected budget occurrence changes in sqlite";

export const dryRunBudgetOccurrenceBatch = async (
  input: BudgetOccurrenceBatchInput,
): Promise<BudgetOccurrenceBatchResponse> => {
  const result = await localApiPost<BudgetOccurrenceBatchResponse>(
    "/prototype/repositories/budget-snapshot-occurrences/batch/dry-run",
    input,
  );
  if (!result.ok || !result.planFingerprint) {
    throw new LocalApiError(result.code ?? "batch_occurrence_dry_run_failed", "Selected occurrence review failed.");
  }
  return result;
};

export const writeBudgetOccurrenceBatch = async (
  input: BudgetOccurrenceBatchInput,
  expectedPlanFingerprint: string,
): Promise<BudgetOccurrenceBatchResponse> => {
  const result = await localApiPost<BudgetOccurrenceBatchResponse>(
    "/prototype/repositories/budget-snapshot-occurrences/batch/write",
    { ...input, dryRunReviewed: true, confirmation: BATCH_CONFIRMATION, expectedPlanFingerprint },
  );
  if (!result.ok) {
    throw new LocalApiError(result.code ?? "batch_occurrence_write_failed", "Selected occurrence change failed.");
  }
  return result;
};

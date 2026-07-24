import { LocalApiError, localApiPost } from "../../api/localApiClient";
import type { BudgetDefinitionWriteInput } from "./budgetDefinitionWriteExperiment";

const CONFIRMATION =
  "create one budget and occurrence from one transaction in sqlite";

export interface BudgetFromTransactionInput {
  definition: BudgetDefinitionWriteInput;
  transactionId: number;
  occurrenceDate: Date | string;
}

export interface BudgetFromTransactionResponse {
  ok: boolean;
  code?: string;
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  targetBudgetId: number | null;
  targetTransactionId: number | null;
  occurrenceDate: string | null;
  rowsChanged: {
    budgets: number;
    budgetSnapshots: number;
    transactions: number;
    total: number;
  };
  validationErrors: string[];
  planFingerprint?: string;
}

const payload = (input: BudgetFromTransactionInput) => ({
  ...input,
  occurrenceDate:
    input.occurrenceDate instanceof Date
      ? input.occurrenceDate.toISOString()
      : input.occurrenceDate,
});

export const createBudgetFromTransactionInSqlite = async (
  input: BudgetFromTransactionInput,
): Promise<BudgetFromTransactionResponse> => {
  const base = "/prototype/repositories/budgets/from-transaction";
  const dryRun = await localApiPost<BudgetFromTransactionResponse>(
    `${base}/dry-run`,
    payload(input),
  );
  if (!dryRun.ok || !dryRun.dryRun || !dryRun.planFingerprint) {
    throw new LocalApiError(
      dryRun.code ?? "budget_from_transaction_dry_run_failed",
      "Create Budget review failed.",
    );
  }
  const confirmed = window.confirm(
    "Create this Budget and link the originating Transaction?\n\n" +
      "One Budget definition and one occurrence will be created. Only the originating Transaction's Budget linkage fields will change.",
  );
  if (!confirmed) {
    throw new LocalApiError(
      "budget_from_transaction_cancelled",
      "Create Budget was cancelled.",
    );
  }
  const write = await localApiPost<BudgetFromTransactionResponse>(
    `${base}/write`,
    {
      ...payload(input),
      dryRunReviewed: true,
      confirmation: CONFIRMATION,
      expectedPlanFingerprint: dryRun.planFingerprint,
    },
  );
  if (
    !write.ok ||
    !write.sqliteMutated ||
    write.rowsChanged.budgets !== 1 ||
    write.rowsChanged.budgetSnapshots !== 1 ||
    write.rowsChanged.transactions !== 1
  ) {
    throw new LocalApiError(
      write.code ?? "budget_from_transaction_write_failed",
      "Create Budget failed.",
    );
  }
  return write;
};

import { LocalApiError, localApiPost } from "../../api/localApiClient";

export type BudgetSnapshotOccurrenceAction =
  | "delete"
  | "create"
  | "link"
  | "changeLink"
  | "unlink"
  | "createAndLink";

export interface BudgetSnapshotOccurrenceInput {
  snapshotId?: number;
  budgetId?: number;
  transactionId?: number;
  expectedCurrentSnapshotId?: number;
  occurrenceDate?: Date | string;
}

export interface BudgetSnapshotOccurrenceResponse {
  ok: boolean;
  code?: string;
  action: BudgetSnapshotOccurrenceAction;
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  dexieMutated: false;
  target: {
    snapshotId: number | null;
    budgetId: number | null;
    transactionId: number | null;
    occurrenceDate: string | null;
  };
  linkedTransactionCount: number;
  ambiguousLegacyReferenceCount: number;
  occurrenceReused: boolean;
  rowsChanged: {
    budgetSnapshots: number;
    transactions: number;
    total: number;
  };
  validationErrors: string[];
  warnings: string[];
  planFingerprint?: string;
}

const CONFIRMATIONS: Record<BudgetSnapshotOccurrenceAction, string> = {
  delete: "delete one unlinked budget occurrence from sqlite",
  create: "create one budget occurrence in sqlite",
  link: "link one transaction to one budget occurrence in sqlite",
  changeLink: "change one transaction budget occurrence link in sqlite",
  unlink: "unlink one transaction from its budget occurrence in sqlite",
  createAndLink:
    "create one budget occurrence and link one transaction in sqlite",
};

const payload = (input: BudgetSnapshotOccurrenceInput) => ({
  ...input,
  ...(input.occurrenceDate instanceof Date
    ? { occurrenceDate: input.occurrenceDate.toISOString() }
    : {}),
});

const path = (
  action: BudgetSnapshotOccurrenceAction,
  operation: "dry-run" | "write",
) =>
  `/prototype/repositories/budget-snapshot-occurrences/${operation}/${action}`;

export const dryRunBudgetSnapshotOccurrence = async (
  action: BudgetSnapshotOccurrenceAction,
  input: BudgetSnapshotOccurrenceInput,
): Promise<BudgetSnapshotOccurrenceResponse> => {
  const result = await localApiPost<BudgetSnapshotOccurrenceResponse>(
    path(action, "dry-run"),
    payload(input),
  );
  if (!result.ok || !result.dryRun || !result.planFingerprint) {
    throw new LocalApiError(
      result.code ?? "budget_snapshot_occurrence_dry_run_failed",
      "Budget occurrence review failed.",
    );
  }
  return result;
};

export const writeBudgetSnapshotOccurrence = async (
  action: BudgetSnapshotOccurrenceAction,
  input: BudgetSnapshotOccurrenceInput,
  expectedPlanFingerprint: string,
): Promise<BudgetSnapshotOccurrenceResponse> => {
  const result = await localApiPost<BudgetSnapshotOccurrenceResponse>(
    path(action, "write"),
    {
      ...payload(input),
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS[action],
      expectedPlanFingerprint,
    },
  );
  if (!result.ok) {
    throw new LocalApiError(
      result.code ?? "budget_snapshot_occurrence_write_failed",
      "Budget occurrence change failed.",
    );
  }
  return result;
};

export const executeReviewedBudgetSnapshotOccurrence = async (
  action: BudgetSnapshotOccurrenceAction,
  input: BudgetSnapshotOccurrenceInput,
): Promise<{
  dryRun: BudgetSnapshotOccurrenceResponse;
  write: BudgetSnapshotOccurrenceResponse;
}> => {
  const dryRun = await dryRunBudgetSnapshotOccurrence(action, input);
  const write = await writeBudgetSnapshotOccurrence(
    action,
    input,
    dryRun.planFingerprint!,
  );
  return { dryRun, write };
};

import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const RECIPIENT_DELETE_MERGE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_RECIPIENT_DELETE_MERGE_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  delete: "delete unused recipient from disposable sqlite",
  merge: "merge recipient references in disposable sqlite",
} as const;

export interface RecipientReferenceCounts {
  transactions: number;
  budgets: number;
  budgetSnapshots: number;
}

export interface RecipientLifecycleResponse {
  ok: boolean;
  action: "delete" | "merge";
  eligible: boolean;
  targetPresent: boolean;
  sourcePresent: boolean;
  distinctRecipients: boolean;
  referenceCount: number;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: RecipientReferenceCounts;
  rowsProposedForUpdate: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  sqliteMutated: boolean;
  rowsChanged: number;
  code?: string;
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const isRecipientDeleteMergeWriteExperimentEnabled = (): boolean =>
  envValue(RECIPIENT_DELETE_MERGE_WRITE_EXPERIMENT_FLAG) === "true";

const requirePlan = (
  response: RecipientLifecycleResponse,
  action: "delete" | "merge",
): RecipientLifecycleResponse => {
  if (
    response.action !== action ||
    typeof response.planFingerprint !== "string"
  ) {
    throw new LocalApiError(
      response.code ?? `recipient_${action}_dry_run_failed`,
      "Recipient lifecycle dry-run failed.",
    );
  }
  return response;
};

export const dryRunRecipientDelete = async (
  recipientId: number,
): Promise<RecipientLifecycleResponse> =>
  requirePlan(
    await localApiPost<RecipientLifecycleResponse>(
      "/prototype/repositories/recipients/delete/dry-run",
      { recipientId },
    ),
    "delete",
  );

export const writeRecipientDelete = async (
  recipientId: number,
  expectedPlanFingerprint: string,
): Promise<RecipientLifecycleResponse> =>
  localApiPost<RecipientLifecycleResponse>(
    "/prototype/repositories/recipients/delete/write",
    {
      recipientId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.delete,
      expectedPlanFingerprint,
    },
  );

export const dryRunRecipientMerge = async (
  sourceRecipientId: number,
  targetRecipientId: number,
): Promise<RecipientLifecycleResponse> =>
  requirePlan(
    await localApiPost<RecipientLifecycleResponse>(
      "/prototype/repositories/recipients/merge/dry-run",
      { sourceRecipientId, targetRecipientId },
    ),
    "merge",
  );

export const writeRecipientMerge = async (
  sourceRecipientId: number,
  targetRecipientId: number,
  expectedPlanFingerprint: string,
): Promise<RecipientLifecycleResponse> =>
  localApiPost<RecipientLifecycleResponse>(
    "/prototype/repositories/recipients/merge/write",
    {
      sourceRecipientId,
      targetRecipientId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.merge,
      expectedPlanFingerprint,
    },
  );

export const recipientLifecycleErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "recipient_lifecycle_failed";

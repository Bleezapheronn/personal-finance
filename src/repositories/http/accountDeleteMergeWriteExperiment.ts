import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const ACCOUNT_DELETE_MERGE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_ACCOUNT_DELETE_MERGE_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  delete: "delete unused account from disposable sqlite",
  merge: "merge account references in disposable sqlite",
} as const;

export interface AccountReferenceCounts {
  transactions: number;
  budgets: number;
  budgetSnapshots: number;
  smsImportTemplates: number;
  paymentMethods: number;
}

export interface AccountLifecycleResponse {
  ok: boolean;
  action: "delete" | "merge";
  eligible: boolean;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctAccounts: boolean;
  compatible: boolean;
  currencyCompatible: boolean;
  accountTypeCompatible: boolean;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: AccountReferenceCounts;
  transferReferenceCount: number;
  affectedTransferPairCount: number;
  transferConflicts: string[];
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

export const isAccountDeleteMergeWriteExperimentEnabled = (): boolean =>
  envValue(ACCOUNT_DELETE_MERGE_WRITE_EXPERIMENT_FLAG) === "true";

const requirePlan = (
  response: AccountLifecycleResponse,
  action: "delete" | "merge",
): AccountLifecycleResponse => {
  if (response.action !== action || typeof response.planFingerprint !== "string") {
    throw new LocalApiError(
      response.code ?? `account_${action}_dry_run_failed`,
      "Account lifecycle dry-run failed.",
    );
  }
  return response;
};

export const dryRunAccountDelete = async (
  accountId: number,
): Promise<AccountLifecycleResponse> => requirePlan(
  await localApiPost<AccountLifecycleResponse>(
    "/prototype/repositories/accounts/delete/dry-run",
    { accountId },
  ),
  "delete",
);

export const writeAccountDelete = async (
  accountId: number,
  expectedPlanFingerprint: string,
): Promise<AccountLifecycleResponse> => localApiPost<AccountLifecycleResponse>(
  "/prototype/repositories/accounts/delete/write",
  {
    accountId,
    dryRunReviewed: true,
    confirmation: CONFIRMATIONS.delete,
    expectedPlanFingerprint,
  },
);

export const dryRunAccountMerge = async (
  sourceAccountId: number,
  targetAccountId: number,
): Promise<AccountLifecycleResponse> => requirePlan(
  await localApiPost<AccountLifecycleResponse>(
    "/prototype/repositories/accounts/merge/dry-run",
    { sourceAccountId, targetAccountId },
  ),
  "merge",
);

export const writeAccountMerge = async (
  sourceAccountId: number,
  targetAccountId: number,
  expectedPlanFingerprint: string,
): Promise<AccountLifecycleResponse> => localApiPost<AccountLifecycleResponse>(
  "/prototype/repositories/accounts/merge/write",
  {
    sourceAccountId,
    targetAccountId,
    dryRunReviewed: true,
    confirmation: CONFIRMATIONS.merge,
    expectedPlanFingerprint,
  },
);

export const accountLifecycleErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "account_lifecycle_failed";

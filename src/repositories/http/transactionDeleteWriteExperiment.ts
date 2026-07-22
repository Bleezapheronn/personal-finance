import { LocalApiError, localApiGet, localApiPost } from "../../api/localApiClient";

export const TRANSACTIONS_DELETE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_DELETE_WRITE_EXPERIMENT";

const DELETE_CONFIRMATION =
  "delete transaction or transfer pair from disposable sqlite";

export type TransactionDeleteClassification =
  | "ordinary"
  | "transferPair"
  | "conflict";

export interface TransactionDeleteResponse {
  ok: boolean;
  code?: string;
  entity?: "transaction";
  action?: "delete";
  classification?: TransactionDeleteClassification;
  targetPresent?: boolean;
  rowsProposedForDeletion?: number;
  transferPairValidated?: boolean;
  planFingerprint?: string;
  validationErrors?: string[];
  warnings?: string[];
  wouldMutate?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
}

interface WriteCapabilitiesResponse {
  capabilities?: Record<string, unknown>;
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isTransactionsDeleteWriteExperimentEnabled = (): boolean =>
  envValue(TRANSACTIONS_DELETE_WRITE_EXPERIMENT_FLAG) === "true";

export const loadTransactionDeleteWriteCapability = async (): Promise<boolean> => {
  const response = await localApiGet<WriteCapabilitiesResponse>(
    "/prototype/write-capabilities",
  );
  return response.capabilities?.transactionDeleteWrites === true;
};

export const transactionDeleteWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) return error.code;
  if (error instanceof TypeError) return "local_api_unavailable";
  return "transaction_delete_write_failed";
};

export const dryRunTransactionDelete = async (
  id: number,
): Promise<TransactionDeleteResponse> => {
  const response = await localApiPost<TransactionDeleteResponse>(
    "/prototype/repositories/transactions/delete/dry-run",
    { id },
  );
  if (
    response.ok !== true ||
    response.entity !== "transaction" ||
    response.action !== "delete" ||
    response.wouldMutate !== false ||
    (response.classification !== "ordinary" &&
      response.classification !== "transferPair") ||
    typeof response.rowsProposedForDeletion !== "number" ||
    typeof response.planFingerprint !== "string"
  ) {
    throw new LocalApiError(
      response.code ?? "transaction_delete_dry_run_failed",
      "Transaction delete dry-run failed.",
    );
  }
  return response;
};

export const writeReviewedTransactionDelete = async (
  id: number,
  planFingerprint: string,
): Promise<TransactionDeleteResponse> => {
  const response = await localApiPost<TransactionDeleteResponse>(
    "/prototype/repositories/transactions/delete/write",
    {
      id,
      expectedPlanFingerprint: planFingerprint,
      dryRunReviewed: true,
      confirmation: DELETE_CONFIRMATION,
    },
  );
  if (
    response.ok !== true ||
    response.sqliteMutated !== true ||
    (response.rowsChanged !== 1 && response.rowsChanged !== 2)
  ) {
    throw new LocalApiError(
      response.code ?? "transaction_delete_write_failed",
      "Transaction delete failed.",
    );
  }
  return response;
};

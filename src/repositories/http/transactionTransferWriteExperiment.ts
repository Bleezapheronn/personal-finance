import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT";

const CREATE_CONFIRMATION = "create paired transfer in disposable sqlite";
const UPDATE_CONFIRMATION = "update paired transfer in disposable sqlite";

export interface TransferWriteInput {
  sourceAccountId: number;
  destinationAccountId: number;
  sourceRecipientId: number;
  destinationRecipientId: number;
  date: string;
  amount: number;
  transactionCost?: number | null;
  originalAmount?: number | null;
  originalCurrency?: string;
  exchangeRate?: number;
  transactionReference?: string;
  categoryId: number;
  description: string;
}

export interface TransferWriteResponse {
  ok: boolean;
  code?: string;
  entity: "transfer";
  action: "create" | "update";
  dryRun?: boolean;
  wouldMutate?: boolean;
  realWrite?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  pairCreated?: boolean;
  pairUpdated?: boolean;
  pairIntegrityVerified?: boolean;
  transactionCountDelta?: number;
  sourceTransactionId?: number;
  destinationTransactionId?: number;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isTransactionsTransferWriteExperimentEnabled = (): boolean =>
  envValue(TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT_FLAG) === "true";

export const transactionTransferWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }
  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }
  return "transaction_transfer_write_failed";
};

const assertDryRunPassed = (
  response: TransferWriteResponse,
  action: TransferWriteResponse["action"],
): void => {
  if (
    response.ok !== true ||
    response.entity !== "transfer" ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `transaction_transfer_${action}_dry_run_failed`,
      "Transfer dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: TransferWriteResponse,
  action: TransferWriteResponse["action"],
): TransferWriteResponse => {
  if (
    response.ok !== true ||
    response.entity !== "transfer" ||
    response.action !== action ||
    response.sqliteMutated !== true ||
    response.rowsChanged !== 2 ||
    response.pairIntegrityVerified !== true ||
    typeof response.sourceTransactionId !== "number" ||
    typeof response.destinationTransactionId !== "number"
  ) {
    throw new LocalApiError(
      response.code ?? `transaction_transfer_${action}_write_failed`,
      "Transfer write failed.",
    );
  }
  return response;
};

const dataPayload = (input: TransferWriteInput) => ({
  sourceAccountId: input.sourceAccountId,
  destinationAccountId: input.destinationAccountId,
  sourceRecipientId: input.sourceRecipientId,
  destinationRecipientId: input.destinationRecipientId,
  date: input.date,
  amount: input.amount,
  transactionCost: input.transactionCost,
  originalAmount: input.originalAmount,
  originalCurrency: input.originalCurrency,
  exchangeRate: input.exchangeRate,
  transactionReference: input.transactionReference,
  categoryId: input.categoryId,
  description: input.description,
});

export const createTransferInDisposableSqlite = async (
  input: TransferWriteInput,
): Promise<TransferWriteResponse> => {
  const data = dataPayload(input);
  const dryRun = await localApiPost<TransferWriteResponse>(
    "/prototype/repositories/transactions/transfers/dry-run/create",
    data,
  );
  assertDryRunPassed(dryRun, "create");
  return assertWritePassed(
    await localApiPost<TransferWriteResponse>(
      "/prototype/repositories/transactions/transfers/write/create",
      {
        ...data,
        dryRunReviewed: true,
        confirmation: CREATE_CONFIRMATION,
      },
    ),
    "create",
  );
};

export const updateTransferInDisposableSqlite = async (
  id: number,
  input: TransferWriteInput,
): Promise<TransferWriteResponse> => {
  const data = { id, ...dataPayload(input) };
  const dryRun = await localApiPost<TransferWriteResponse>(
    "/prototype/repositories/transactions/transfers/dry-run/update",
    data,
  );
  assertDryRunPassed(dryRun, "update");
  return assertWritePassed(
    await localApiPost<TransferWriteResponse>(
      "/prototype/repositories/transactions/transfers/write/update",
      {
        ...data,
        dryRunReviewed: true,
        confirmation: UPDATE_CONFIRMATION,
      },
    ),
    "update",
  );
};

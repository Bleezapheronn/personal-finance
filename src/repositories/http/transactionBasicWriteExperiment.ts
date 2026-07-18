import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const TRANSACTIONS_BASIC_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT";

const CREATE_CONFIRMATION = "create basic transaction in disposable sqlite";
const UPDATE_CONFIRMATION = "update basic transaction in disposable sqlite";

export type BasicTransactionClassification = "income" | "expense";

export interface BasicTransactionWriteInput {
  classification: BasicTransactionClassification;
  date: string;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  transactionReference?: string;
  categoryId: number;
  accountId: number;
  recipientId: number;
  description: string;
  transactionCost?: null | 0;
}

export interface BasicTransactionEligibilityInput {
  id?: number;
  amount?: number;
  accountId?: number;
  categoryId?: number;
  recipientId?: number;
  transactionCost?: number | null;
  transferPairId?: number | null;
  isTransfer?: boolean | number | null;
  budgetId?: number | null;
  occurrenceDate?: Date | string | null;
  budgetSnapshotId?: number | null;
}

export interface TransactionBasicWriteResponse {
  ok: boolean;
  code?: string;
  entity: "transaction";
  action: "create" | "update";
  dryRun?: boolean;
  wouldMutate?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  targetIdPresent?: boolean;
  targetId?: number | null;
  classification?: BasicTransactionClassification | null;
  validationErrors?: string[];
  warnings?: string[];
  unsupportedReasons?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isTransactionsBasicWriteExperimentEnabled = (): boolean =>
  envValue(TRANSACTIONS_BASIC_WRITE_EXPERIMENT_FLAG) === "true";

export const isBasicTransactionWriteEligible = (
  transaction: BasicTransactionEligibilityInput,
): boolean =>
  typeof transaction.id === "number" &&
  typeof transaction.amount === "number" &&
  Number.isFinite(transaction.amount) &&
  transaction.amount !== 0 &&
  typeof transaction.accountId === "number" &&
  transaction.accountId > 0 &&
  typeof transaction.categoryId === "number" &&
  transaction.categoryId > 0 &&
  typeof transaction.recipientId === "number" &&
  transaction.recipientId > 0 &&
  transaction.isTransfer !== true &&
  transaction.isTransfer !== 1 &&
  transaction.transferPairId == null &&
  (transaction.transactionCost == null ||
    transaction.transactionCost === 0) &&
  transaction.budgetId == null &&
  transaction.occurrenceDate == null &&
  transaction.budgetSnapshotId == null;

export const transactionBasicWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }
  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }
  return "transaction_basic_write_failed";
};

const assertDryRunPassed = (
  response: TransactionBasicWriteResponse,
  action: TransactionBasicWriteResponse["action"],
): void => {
  if (
    response.ok !== true ||
    response.entity !== "transaction" ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `transaction_${action}_dry_run_failed`,
      "Transaction dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: TransactionBasicWriteResponse,
  action: TransactionBasicWriteResponse["action"],
): TransactionBasicWriteResponse => {
  if (
    response.ok !== true ||
    response.entity !== "transaction" ||
    response.action !== action ||
    response.sqliteMutated !== true ||
    response.rowsChanged !== 1 ||
    typeof response.targetId !== "number"
  ) {
    throw new LocalApiError(
      response.code ?? `transaction_${action}_write_failed`,
      "Transaction write failed.",
    );
  }
  return response;
};

const payload = (input: BasicTransactionWriteInput) => ({
  classification: input.classification,
  date: input.date,
  amount: input.amount,
  originalAmount: input.originalAmount,
  originalCurrency: input.originalCurrency,
  exchangeRate: input.exchangeRate,
  transactionReference: input.transactionReference,
  categoryId: input.categoryId,
  accountId: input.accountId,
  recipientId: input.recipientId,
  description: input.description,
  transactionCost: input.transactionCost,
});

export const createBasicTransactionInDisposableSqlite = async (
  input: BasicTransactionWriteInput,
): Promise<TransactionBasicWriteResponse> => {
  const data = payload(input);
  const dryRun = await localApiPost<TransactionBasicWriteResponse>(
    "/prototype/repositories/transactions/dry-run/create",
    data,
  );
  assertDryRunPassed(dryRun, "create");

  const response = await localApiPost<TransactionBasicWriteResponse>(
    "/prototype/repositories/transactions/write/create",
    {
      ...data,
      dryRunReviewed: true,
      confirmation: CREATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "create");
};

export const updateBasicTransactionInDisposableSqlite = async (
  id: number,
  input: BasicTransactionWriteInput,
): Promise<TransactionBasicWriteResponse> => {
  const data = { id, ...payload(input) };
  const dryRun = await localApiPost<TransactionBasicWriteResponse>(
    "/prototype/repositories/transactions/dry-run/update",
    data,
  );
  assertDryRunPassed(dryRun, "update");

  const response = await localApiPost<TransactionBasicWriteResponse>(
    "/prototype/repositories/transactions/write/update",
    {
      ...data,
      dryRunReviewed: true,
      confirmation: UPDATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "update");
};

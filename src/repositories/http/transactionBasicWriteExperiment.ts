import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const TRANSACTIONS_BASIC_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT";
export const TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT";

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
  transactionCost?: number | null;
  budgetId?: number | null;
  occurrenceDate?: string | null;
  budgetSnapshotId?: number | null;
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
  transactionCostPresence?: boolean;
  transactionCostClassification?: "none" | "zero" | "negative";
  budgetSnapshotLinkagePresence?: boolean;
  budgetLinkageAction?: "none" | "preserve" | "link" | "change" | "unlink";
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isTransactionsBasicWriteExperimentEnabled = (): boolean =>
  envValue(TRANSACTIONS_BASIC_WRITE_EXPERIMENT_FLAG) === "true";

export const isTransactionsCostBudgetWriteExperimentEnabled = (): boolean =>
  envValue(TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT_FLAG) === "true";

export interface TransactionBudgetSnapshotReference {
  id?: number;
  budgetId?: number;
  dueDate?: Date | string;
}

export interface TransactionBudgetReference {
  id?: number;
}

const sameInstant = (
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
): boolean => {
  if (left == null || right == null) {
    return false;
  }
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime
  );
};

export const transactionCostBudgetEligibilityReason = (
  transaction: BasicTransactionEligibilityInput,
  snapshots: TransactionBudgetSnapshotReference[],
  budgets: TransactionBudgetReference[],
): string | undefined => {
  if (
    typeof transaction.id !== "number" ||
    typeof transaction.amount !== "number" ||
    !Number.isFinite(transaction.amount) ||
    transaction.amount === 0 ||
    typeof transaction.accountId !== "number" ||
    transaction.accountId <= 0 ||
    typeof transaction.categoryId !== "number" ||
    transaction.categoryId <= 0 ||
    typeof transaction.recipientId !== "number" ||
    transaction.recipientId <= 0
  ) {
    return "transaction_basic_fields_invalid";
  }
  if (
    transaction.isTransfer === true ||
    transaction.isTransfer === 1 ||
    transaction.transferPairId != null
  ) {
    return "transfers_not_supported";
  }
  if (
    transaction.transactionCost != null &&
    (!Number.isFinite(transaction.transactionCost) ||
      transaction.transactionCost > 0)
  ) {
    return "transaction_cost_invalid";
  }

  const hasSnapshot = transaction.budgetSnapshotId != null;
  const hasLegacyBudget = transaction.budgetId != null;
  const hasOccurrence = transaction.occurrenceDate != null;
  if (!hasSnapshot) {
    return hasLegacyBudget || hasOccurrence
      ? "legacy_only_budget_link_not_supported"
      : undefined;
  }
  if (!hasLegacyBudget || !hasOccurrence) {
    return "budget_linkage_incomplete";
  }

  const snapshot = snapshots.find(
    (candidate) => candidate.id === transaction.budgetSnapshotId,
  );
  if (!snapshot) {
    return "budget_snapshot_not_found";
  }
  if (
    typeof snapshot.budgetId !== "number" ||
    snapshot.budgetId !== transaction.budgetId ||
    !budgets.some((budget) => budget.id === snapshot.budgetId)
  ) {
    return "budget_snapshot_budget_mismatch";
  }
  if (!sameInstant(transaction.occurrenceDate, snapshot.dueDate)) {
    return "budget_snapshot_occurrence_mismatch";
  }
  return undefined;
};

export const isCostBudgetTransactionWriteEligible = (
  transaction: BasicTransactionEligibilityInput,
  snapshots: TransactionBudgetSnapshotReference[],
  budgets: TransactionBudgetReference[],
): boolean =>
  transactionCostBudgetEligibilityReason(transaction, snapshots, budgets) ===
  undefined;

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
  ...(input.budgetId !== undefined ? { budgetId: input.budgetId } : {}),
  ...(input.occurrenceDate !== undefined
    ? { occurrenceDate: input.occurrenceDate }
    : {}),
  ...(input.budgetSnapshotId !== undefined
    ? { budgetSnapshotId: input.budgetSnapshotId }
    : {}),
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

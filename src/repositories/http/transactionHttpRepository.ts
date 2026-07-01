import {
  localApiGet,
  type LocalApiQueryParams,
} from "../../api/localApiClient";
import {
  ApiCountResponse,
  ApiListResponse,
  TransactionDto,
} from "./types";

export interface TransactionListOptions {
  limit?: number;
  offset?: number;
  accountId?: number;
  categoryId?: number;
  recipientId?: number;
  budgetSnapshotId?: number;
  isTransfer?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export type TransactionCountOptions = Omit<
  TransactionListOptions,
  "limit" | "offset"
>;

export const listTransactions = async (
  options: TransactionListOptions = {},
): Promise<ApiListResponse<TransactionDto>> => {
  return localApiGet<ApiListResponse<TransactionDto>>(
    "/prototype/repositories/transactions",
    { query: options as LocalApiQueryParams },
  );
};

export const getTransactionById = async (
  id: number,
): Promise<TransactionDto | undefined> => {
  try {
    const response = await localApiGet<{
      ok: true;
      mode: "prototype";
      readonly: true;
      transaction: TransactionDto;
    }>(`/prototype/repositories/transactions/${id}`);
    return response.transaction;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      return undefined;
    }
    throw error;
  }
};

export const countTransactions = async (
  options: TransactionCountOptions = {},
): Promise<number> => {
  const response = await localApiGet<ApiCountResponse>(
    "/prototype/repositories/transactions/count",
    { query: options as LocalApiQueryParams },
  );
  return response.count;
};

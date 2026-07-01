import {
  localApiGet,
  type LocalApiQueryParams,
} from "../../api/localApiClient";
import {
  ApiBudgetFrequency,
  ApiListResponse,
  BudgetDto,
  BudgetSnapshotDto,
} from "./types";

export interface BudgetListOptions {
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  frequency?: ApiBudgetFrequency;
  isGoal?: boolean;
}

export interface BudgetSnapshotListOptions {
  limit?: number;
  offset?: number;
  budgetId?: number;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  isHistorical?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export const listBudgets = async (
  options: BudgetListOptions = {},
): Promise<ApiListResponse<BudgetDto>> => {
  return localApiGet<ApiListResponse<BudgetDto>>(
    "/prototype/repositories/budgets",
    { query: options as LocalApiQueryParams },
  );
};

export const getBudgetById = async (
  id: number,
): Promise<BudgetDto | undefined> => {
  try {
    const response = await localApiGet<{
      ok: true;
      mode: "prototype";
      readonly: true;
      budget: BudgetDto;
    }>(`/prototype/repositories/budgets/${id}`);
    return response.budget;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      return undefined;
    }
    throw error;
  }
};

export const listBudgetSnapshots = async (
  options: BudgetSnapshotListOptions = {},
): Promise<ApiListResponse<BudgetSnapshotDto>> => {
  return localApiGet<ApiListResponse<BudgetSnapshotDto>>(
    "/prototype/repositories/budget-snapshots",
    { query: options as LocalApiQueryParams },
  );
};

export const getBudgetSnapshotById = async (
  id: number,
): Promise<BudgetSnapshotDto | undefined> => {
  try {
    const response = await localApiGet<{
      ok: true;
      mode: "prototype";
      readonly: true;
      budgetSnapshot: BudgetSnapshotDto;
    }>(`/prototype/repositories/budget-snapshots/${id}`);
    return response.budgetSnapshot;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      return undefined;
    }
    throw error;
  }
};

export const listSnapshotsForBudget = async (
  budgetId: number,
  options: Omit<BudgetSnapshotListOptions, "budgetId"> = {},
): Promise<ApiListResponse<BudgetSnapshotDto>> => {
  return localApiGet<ApiListResponse<BudgetSnapshotDto>>(
    `/prototype/repositories/budgets/${budgetId}/snapshots`,
    { query: options as LocalApiQueryParams },
  );
};

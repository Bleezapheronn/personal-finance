import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const BUDGETS_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUDGETS_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  create: "create budget definition in disposable sqlite",
  update: "update budget definition in disposable sqlite",
} as const;

export type BudgetDefinitionWriteAction = keyof typeof CONFIRMATIONS;
export type BudgetDefinitionFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export interface BudgetDefinitionWriteInput {
  description: string;
  categoryId: number;
  accountId: number;
  recipientId?: number | null;
  amount: number;
  transactionCost?: number | null;
  frequency: BudgetDefinitionFrequency;
  frequencyDetails?: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalDays?: number;
  } | null;
  isGoal: boolean;
  isFlexible: boolean;
  goalPercentage?: number | null;
  goalDirection?: "income" | "expense" | null;
  remainingCyclesTotal?: number | null;
  dueDate: string;
}

export interface BudgetDefinitionWriteResponse {
  ok: boolean;
  code?: string;
  entity: "budgetDefinition";
  action: BudgetDefinitionWriteAction;
  dryRun?: boolean;
  wouldMutate?: boolean;
  dryRunRequired?: boolean;
  realWrite?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  targetId?: number | null;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() || undefined;
};

export const isBudgetsWriteExperimentEnabled = (): boolean =>
  envValue(BUDGETS_WRITE_EXPERIMENT_FLAG) === "true";

export const budgetDefinitionWriteErrorCode = (error: unknown): string =>
  error instanceof LocalApiError
    ? error.code
    : "budget_definition_write_failed";

const assertDryRunPassed = (
  response: BudgetDefinitionWriteResponse,
  action: BudgetDefinitionWriteAction,
): void => {
  if (
    response.ok !== true ||
    response.entity !== "budgetDefinition" ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `budget_definition_${action}_dry_run_failed`,
      "Budget definition dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: BudgetDefinitionWriteResponse,
  action: BudgetDefinitionWriteAction,
): BudgetDefinitionWriteResponse => {
  if (
    response.ok !== true ||
    response.entity !== "budgetDefinition" ||
    response.action !== action ||
    response.realWrite !== true ||
    response.sqliteMutated !== true ||
    response.rowsChanged !== 1
  ) {
    throw new LocalApiError(
      response.code ?? `budget_definition_${action}_write_failed`,
      "Budget definition write failed.",
    );
  }
  return response;
};

const runWrite = async (
  action: BudgetDefinitionWriteAction,
  payload: Record<string, unknown>,
): Promise<BudgetDefinitionWriteResponse> => {
  const path = "/prototype/repositories/budgets";
  const dryRun = await localApiPost<BudgetDefinitionWriteResponse>(
    `${path}/dry-run/${action}`,
    payload,
  );
  assertDryRunPassed(dryRun, action);
  const write = await localApiPost<BudgetDefinitionWriteResponse>(
    `${path}/write/${action}`,
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS[action],
    },
  );
  return assertWritePassed(write, action);
};

export const createBudgetDefinitionInDisposableSqlite = (
  input: BudgetDefinitionWriteInput,
): Promise<BudgetDefinitionWriteResponse> =>
  runWrite("create", { ...input });

export const updateBudgetDefinitionInDisposableSqlite = (
  id: number,
  input: BudgetDefinitionWriteInput,
): Promise<BudgetDefinitionWriteResponse> =>
  runWrite("update", { id, ...input });

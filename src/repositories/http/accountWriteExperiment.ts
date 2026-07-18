import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const ACCOUNTS_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT";

const CREATE_CONFIRMATION = "create account in disposable sqlite";
const UPDATE_CONFIRMATION = "update account in disposable sqlite";

export interface AccountWriteInput {
  name: string;
  currency: string;
  isCredit: boolean;
  creditLimit?: number;
}

interface AccountWriteResponse {
  ok: boolean;
  code?: string;
  entity: "account";
  action: "create" | "update";
  dryRun?: boolean;
  wouldMutate?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isAccountsWriteExperimentEnabled = (): boolean =>
  envValue(ACCOUNTS_WRITE_EXPERIMENT_FLAG) === "true";

export const accountWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }
  return "account_write_failed";
};

const assertDryRunPassed = (
  response: AccountWriteResponse,
  action: AccountWriteResponse["action"],
): void => {
  if (
    response.ok !== true ||
    response.entity !== "account" ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `account_${action}_dry_run_failed`,
      "Account dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: AccountWriteResponse,
  action: AccountWriteResponse["action"],
): AccountWriteResponse => {
  if (
    response.ok !== true ||
    response.entity !== "account" ||
    response.action !== action ||
    response.sqliteMutated !== true ||
    response.rowsChanged !== 1
  ) {
    throw new LocalApiError(
      response.code ?? `account_${action}_write_failed`,
      "Account write failed.",
    );
  }
  return response;
};

const accountPayload = (input: AccountWriteInput) => ({
  name: input.name,
  currency: input.currency,
  isCredit: input.isCredit,
  creditLimit: input.creditLimit,
});

export const createAccountInDisposableSqlite = async (
  input: AccountWriteInput,
): Promise<AccountWriteResponse> => {
  const payload = accountPayload(input);
  const dryRun = await localApiPost<AccountWriteResponse>(
    "/prototype/repositories/accounts/dry-run/create",
    payload,
  );
  assertDryRunPassed(dryRun, "create");

  const response = await localApiPost<AccountWriteResponse>(
    "/prototype/repositories/accounts/write/create",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CREATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "create");
};

export const updateAccountInDisposableSqlite = async (
  id: number,
  input: AccountWriteInput,
): Promise<AccountWriteResponse> => {
  const payload = { id, ...accountPayload(input) };
  const dryRun = await localApiPost<AccountWriteResponse>(
    "/prototype/repositories/accounts/dry-run/update",
    payload,
  );
  assertDryRunPassed(dryRun, "update");

  const response = await localApiPost<AccountWriteResponse>(
    "/prototype/repositories/accounts/write/update",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: UPDATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "update");
};

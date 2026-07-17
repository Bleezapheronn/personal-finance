import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const RECIPIENTS_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT";

const CREATE_CONFIRMATION = "create recipient in disposable sqlite";
const UPDATE_CONFIRMATION = "update recipient in disposable sqlite";
const ACTIVATE_CONFIRMATION = "activate recipient in disposable sqlite";
const DEACTIVATE_CONFIRMATION = "deactivate recipient in disposable sqlite";

export interface RecipientWriteInput {
  name: string;
  aliases?: string;
  email?: string;
  phone?: string;
  tillNumber?: string;
  paybill?: string;
  accountNumber?: string;
  description?: string;
}

interface RecipientWriteResponse {
  ok: boolean;
  code?: string;
  action: "create" | "update" | "activate" | "deactivate";
  sqliteMutated?: boolean;
  rowsChanged?: number;
  targetIdPresent?: boolean;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const isRecipientsWriteExperimentEnabled = (): boolean =>
  envValue(RECIPIENTS_WRITE_EXPERIMENT_FLAG) === "true";

const safeWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }

  if (error instanceof Error && error.message) {
    return "recipient_write_failed";
  }

  return "recipient_write_failed";
};

const assertDryRunPassed = (
  response: RecipientWriteResponse,
  action: RecipientWriteResponse["action"],
): void => {
  if (response.action !== action || response.ok !== true) {
    throw new LocalApiError(
      response.code ?? `${action}_recipient_dry_run_failed`,
      "Recipient dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: RecipientWriteResponse,
  action: RecipientWriteResponse["action"],
): RecipientWriteResponse => {
  if (response.action !== action || response.ok !== true) {
    throw new LocalApiError(
      response.code ?? `${action}_recipient_write_failed`,
      "Recipient write failed.",
    );
  }

  return response;
};

const createPayload = (input: RecipientWriteInput) => ({
  name: input.name,
  aliases: input.aliases,
  email: input.email,
  phone: input.phone,
  tillNumber: input.tillNumber,
  paybill: input.paybill,
  accountNumber: input.accountNumber,
  description: input.description,
});

export const createRecipientInDisposableSqlite = async (
  input: RecipientWriteInput,
): Promise<RecipientWriteResponse> => {
  const payload = createPayload(input);
  const dryRun = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/dry-run/create",
    payload,
  );
  assertDryRunPassed(dryRun, "create");

  const response = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/write/create",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CREATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "create");
};

export const updateRecipientInDisposableSqlite = async (
  id: number,
  input: RecipientWriteInput,
): Promise<RecipientWriteResponse> => {
  const payload = { id, ...createPayload(input) };
  const dryRun = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/dry-run/update",
    payload,
  );
  assertDryRunPassed(dryRun, "update");

  const response = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/write/update",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: UPDATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "update");
};

export const activateRecipientInDisposableSqlite = async (
  id: number,
): Promise<RecipientWriteResponse> => {
  const dryRun = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/dry-run/activate",
    { id },
  );
  assertDryRunPassed(dryRun, "activate");

  const response = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/write/activate",
    {
      id,
      expectedIsActive: false,
      dryRunReviewed: true,
      confirmation: ACTIVATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "activate");
};

export const deactivateRecipientInDisposableSqlite = async (
  id: number,
): Promise<RecipientWriteResponse> => {
  const dryRun = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/dry-run/deactivate",
    { id },
  );
  assertDryRunPassed(dryRun, "deactivate");

  const response = await localApiPost<RecipientWriteResponse>(
    "/prototype/repositories/recipients/write/deactivate",
    {
      id,
      expectedIsActive: true,
      dryRunReviewed: true,
      confirmation: DEACTIVATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "deactivate");
};

export const recipientWriteErrorCode = safeWriteErrorCode;

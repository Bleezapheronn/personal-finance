import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const SMS_TEMPLATES_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_SMS_TEMPLATES_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  create: "create sms import template in disposable sqlite",
  update: "update sms import template in disposable sqlite",
  activate: "activate sms import template in disposable sqlite",
  deactivate: "deactivate sms import template in disposable sqlite",
  delete: "delete sms import template from disposable sqlite",
} as const;

export type SmsTemplateWriteAction = keyof typeof CONFIRMATIONS;

export interface SmsTemplateWriteInput {
  name: string;
  description?: string;
  accountId?: number;
  referencePattern?: string;
  amountPattern?: string;
  recipientNamePattern?: string;
  recipientPhonePattern?: string;
  dateTimePattern?: string;
  costPattern?: string;
  incomePattern?: string;
  expensePattern?: string;
}

interface SmsTemplateWriteResponse {
  ok: boolean;
  code?: string;
  entity: "smsImportTemplate";
  action: SmsTemplateWriteAction;
  dryRun?: boolean;
  wouldMutate?: boolean;
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

export const isSmsTemplatesWriteExperimentEnabled = (): boolean =>
  envValue(SMS_TEMPLATES_WRITE_EXPERIMENT_FLAG) === "true";

export const smsTemplateWriteErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "sms_template_write_failed";

const assertDryRunPassed = (
  response: SmsTemplateWriteResponse,
  action: SmsTemplateWriteAction,
): void => {
  if (
    response.ok !== true ||
    response.entity !== "smsImportTemplate" ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `sms_template_${action}_dry_run_failed`,
      "SMS template dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: SmsTemplateWriteResponse,
  action: SmsTemplateWriteAction,
): SmsTemplateWriteResponse => {
  const safeNoOp =
    response.resultCodes?.includes("active_state_already_matches") === true;
  if (
    response.entity !== "smsImportTemplate" ||
    response.action !== action ||
    (response.ok !== true && !safeNoOp) ||
    (response.sqliteMutated !== true && !safeNoOp)
  ) {
    throw new LocalApiError(
      response.code ?? `sms_template_${action}_write_failed`,
      "SMS template write failed.",
    );
  }
  return response;
};

const templatePayload = (input: SmsTemplateWriteInput) => ({ ...input });

const runWrite = async (
  action: SmsTemplateWriteAction,
  payload: Record<string, unknown>,
): Promise<SmsTemplateWriteResponse> => {
  const basePath = `/prototype/repositories/sms-import-templates`;
  const dryRun = await localApiPost<SmsTemplateWriteResponse>(
    `${basePath}/dry-run/${action}`,
    payload,
  );
  assertDryRunPassed(dryRun, action);
  const write = await localApiPost<SmsTemplateWriteResponse>(
    `${basePath}/write/${action}`,
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS[action],
    },
  );
  return assertWritePassed(write, action);
};

export const createSmsTemplateInDisposableSqlite = (
  input: SmsTemplateWriteInput,
): Promise<SmsTemplateWriteResponse> =>
  runWrite("create", templatePayload(input));

export const updateSmsTemplateInDisposableSqlite = (
  id: number,
  input: SmsTemplateWriteInput,
): Promise<SmsTemplateWriteResponse> =>
  runWrite("update", { id, ...templatePayload(input) });

export const activateSmsTemplateInDisposableSqlite = (
  id: number,
): Promise<SmsTemplateWriteResponse> => runWrite("activate", { id });

export const deactivateSmsTemplateInDisposableSqlite = (
  id: number,
): Promise<SmsTemplateWriteResponse> => runWrite("deactivate", { id });

export const deleteSmsTemplateFromDisposableSqlite = (
  id: number,
): Promise<SmsTemplateWriteResponse> => runWrite("delete", { id });

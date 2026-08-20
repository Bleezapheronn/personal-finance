import type { Account, SmsImportTemplate } from "../../db";
import {
  createSmsTemplateInDisposableSqlite,
  smsTemplateWriteErrorCode,
  type SmsTemplateWriteInput,
  updateSmsTemplateInDisposableSqlite,
} from "./smsTemplateWriteExperiment";
export type { SmsTemplateWriteInput } from "./smsTemplateWriteExperiment";
import { getRepositoryBackend } from "../adapterSelection";
import { getSelectedReadRepositories } from "../selectedReadRepositories";
import {
  booleanValue,
  numberValue,
  previewRows,
  stringValue,
  type DevPreviewListResult,
} from "../../utils/devPreview";

const templateFromRow = (row: Record<string, unknown>): SmsImportTemplate => ({
  id: numberValue(row.id),
  name: stringValue(row.name) ?? "",
  description: stringValue(row.description),
  paymentMethodId: numberValue(row.paymentMethodId),
  accountId: numberValue(row.accountId),
  referencePattern: stringValue(row.referencePattern),
  amountPattern: stringValue(row.amountPattern),
  recipientNamePattern: stringValue(row.recipientNamePattern),
  recipientPhonePattern: stringValue(row.recipientPhonePattern),
  dateTimePattern: stringValue(row.dateTimePattern),
  costPattern: stringValue(row.costPattern),
  incomePattern: stringValue(row.incomePattern),
  expensePattern: stringValue(row.expensePattern),
  isActive: booleanValue(row.isActive) !== false,
  createdAt: new Date(String(row.createdAt ?? 0)),
  updatedAt: new Date(String(row.updatedAt ?? 0)),
});

const accountFromRow = (row: Record<string, unknown>): Account => ({
  ...row,
  id: numberValue(row.id),
  name: stringValue(row.name) ?? "",
  isActive: booleanValue(row.isActive) !== false,
} as Account);

export interface SmsTemplateEditorData {
  accounts: Account[];
  template?: SmsImportTemplate;
}

export const loadSmsTemplateEditorData = async (
  editId?: number,
): Promise<SmsTemplateEditorData> => {
  const repositories = getSelectedReadRepositories(getRepositoryBackend());
  const accountResult = await repositories.accounts.list({
    limit: 500,
    offset: 0,
  });
  const accountRows = previewRows(accountResult as DevPreviewListResult);
  if (!accountRows) throw new Error("invalid_sms_template_accounts_response");

  const templateRow = editId
    ? await repositories.smsImportTemplates.getById(editId)
    : undefined;
  if (editId && !templateRow) throw new Error("sms_template_not_found");

  return {
    accounts: accountRows.map((row) =>
      accountFromRow(row as Record<string, unknown>),
    ),
    template: templateRow
      ? templateFromRow(templateRow as unknown as Record<string, unknown>)
      : undefined,
  };
};

export const saveSmsTemplateDraft = async (
  editId: number | undefined,
  input: SmsTemplateWriteInput,
): Promise<void> => {
  if (editId) {
    await updateSmsTemplateInDisposableSqlite(editId, input);
  } else {
    await createSmsTemplateInDisposableSqlite(input);
  }
};

export const smsTemplateManagementErrorCode = (error: unknown): string =>
  smsTemplateWriteErrorCode(error);

import { db, SmsImportTemplate } from "../db";

export const listTemplates = async (): Promise<SmsImportTemplate[]> => {
  return db.smsImportTemplates.toArray();
};

export const listActiveTemplates = async (): Promise<SmsImportTemplate[]> => {
  const templates = await listTemplates();
  return templates.filter((template) => template.isActive !== false);
};

export const getTemplateById = async (
  id: number,
): Promise<SmsImportTemplate | undefined> => {
  return db.smsImportTemplates.get(id);
};

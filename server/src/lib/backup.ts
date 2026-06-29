export const FULL_BACKUP_TABLE_NAMES = [
  "transactions",
  "budgets",
  "budgetSnapshots",
  "buckets",
  "categories",
  "accounts",
  "paymentMethods",
  "recipients",
  "smsImportTemplates",
] as const;

export type FullBackupTableName = (typeof FULL_BACKUP_TABLE_NAMES)[number];
export type BackupRecord = Record<string, unknown>;
export type BackupTables = Record<FullBackupTableName, BackupRecord[]>;

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

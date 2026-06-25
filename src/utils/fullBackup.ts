import { db } from "../db";

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

type SerializedValue =
  | null
  | string
  | number
  | boolean
  | SerializedValue[]
  | { [key: string]: SerializedValue };

export interface FullBackup {
  backupFormatVersion: 1;
  appName: "personal-finance";
  dbName: "FinanceDB";
  exportedAt: string;
  tables: Record<FullBackupTableName, SerializedValue[]>;
  integrity: {
    counts: Record<FullBackupTableName, number>;
  };
}

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
};

const serializeValue = async (value: unknown): Promise<SerializedValue> => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return {
      __type: "Date",
      value: value.toISOString(),
    };
  }

  if (value instanceof Blob) {
    return {
      __type: "Blob",
      mimeType: value.type || "application/octet-stream",
      size: value.size,
      base64: await blobToBase64(value),
    };
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => serializeValue(item)));
  }

  if (typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([key, entryValue]) => [key, await serializeValue(entryValue)] as const,
      ),
    );

    return Object.fromEntries(entries);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
};

const buildTimestampForFilename = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}-${pad(date.getMinutes())}`;
};

export const createFullBackup = async (): Promise<FullBackup> => {
  const tableEntries = await Promise.all(
    FULL_BACKUP_TABLE_NAMES.map(async (tableName) => {
      const records = await db[tableName].toArray();
      const serializedRecords = await serializeValue(records);

      return [
        tableName,
        serializedRecords as SerializedValue[],
        records.length,
      ] as const;
    }),
  );

  const tables = Object.fromEntries(
    tableEntries.map(([tableName, records]) => [tableName, records]),
  ) as Record<FullBackupTableName, SerializedValue[]>;

  const counts = Object.fromEntries(
    tableEntries.map(([tableName, , count]) => [tableName, count]),
  ) as Record<FullBackupTableName, number>;

  return {
    backupFormatVersion: 1,
    appName: "personal-finance",
    dbName: "FinanceDB",
    exportedAt: new Date().toISOString(),
    tables,
    integrity: {
      counts,
    },
  };
};

export const getFullBackupFilename = (date = new Date()): string =>
  `personal-finance-full-backup-${buildTimestampForFilename(date)}.json`;

export const downloadFullBackup = (backup: FullBackup): string => {
  const filename = getFullBackupFilename();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return filename;
};

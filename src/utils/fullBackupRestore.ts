import type { Table } from "dexie";
import { db } from "../db";
import {
  FULL_BACKUP_TABLE_NAMES,
  FullBackupTableName,
} from "./fullBackup";

export type RestoreValidationSeverity = "error" | "warning" | "info";

export interface RestoreValidationMessage {
  severity: RestoreValidationSeverity;
  code: string;
  message: string;
  path?: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface FullBackupRestoreValidationReport {
  valid: boolean;
  checkedAt: string;
  backupExportedAt?: string;
  backupFormatVersion?: number;
  rowCounts: Partial<Record<FullBackupTableName, number>>;
  errors: RestoreValidationMessage[];
  warnings: RestoreValidationMessage[];
  info: RestoreValidationMessage[];
}

export interface FullBackupRestoreSummary {
  restoredAt: string;
  backupExportedAt?: string;
  restoredRowCounts: Record<FullBackupTableName, number>;
  validationErrorCount: number;
  validationWarningCount: number;
  success: boolean;
  errorMessage?: string;
}

type DeserializedValue =
  | null
  | string
  | number
  | boolean
  | Date
  | Blob
  | DeserializedValue[]
  | { [key: string]: DeserializedValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isParseableDate = (value: string): boolean =>
  !Number.isNaN(Date.parse(value));

const addMessage = (
  report: FullBackupRestoreValidationReport,
  severity: RestoreValidationSeverity,
  code: string,
  message: string,
  path?: string,
  details?: RestoreValidationMessage["details"],
): void => {
  const target =
    severity === "error"
      ? report.errors
      : severity === "warning"
        ? report.warnings
        : report.info;

  target.push({
    severity,
    code,
    message,
    path,
    details,
  });
};

const getOptionalNumber = (
  record: Record<string, unknown>,
  field: string,
): number | undefined => {
  const value = record[field];
  return typeof value === "number" ? value : undefined;
};

const getOptionalString = (
  record: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
};

const getTableRows = (
  tables: Record<string, unknown>,
  tableName: FullBackupTableName,
): Record<string, unknown>[] =>
  Array.isArray(tables[tableName])
    ? (tables[tableName] as unknown[]).filter(isRecord)
    : [];

const getIdSet = (records: Record<string, unknown>[]): Set<number> =>
  new Set(
    records
      .map((record) => getOptionalNumber(record, "id"))
      .filter((id): id is number => id !== undefined),
  );

const getIdMap = (
  records: Record<string, unknown>[],
): Map<number, Record<string, unknown>> =>
  new Map(
    records
      .map((record) => [getOptionalNumber(record, "id"), record] as const)
      .filter(
        (entry): entry is readonly [number, Record<string, unknown>] =>
          entry[0] !== undefined,
      ),
  );

const valueIsPresent = (value: unknown): boolean =>
  value !== null && value !== undefined;

const isLikelyBase64 = (value: string): boolean =>
  value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);

const validateTypedValues = (
  value: unknown,
  report: FullBackupRestoreValidationReport,
  path: string,
): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateTypedValues(item, report, `${path}[${index}]`),
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const type = value.__type;

  if (type === "Date") {
    if (typeof value.value !== "string" || !isParseableDate(value.value)) {
      addMessage(
        report,
        "error",
        "invalid_typed_date",
        "Typed Date value is missing or not parseable.",
        path,
      );
    }
    return;
  }

  if (type === "Blob") {
    const base64 = value.base64;
    const mimeType = value.mimeType;
    const size = value.size;

    if (
      typeof base64 !== "string" ||
      typeof mimeType !== "string" ||
      typeof size !== "number"
    ) {
      addMessage(
        report,
        "error",
        "invalid_typed_blob",
        "Typed Blob value is missing base64, MIME type, or size metadata.",
        path,
      );
      return;
    }

    if (size > 0 && base64.length === 0) {
      addMessage(
        report,
        "error",
        "empty_blob_base64",
        "Typed Blob has a positive size but no base64 data.",
        path,
      );
    } else if (base64.length > 0 && !isLikelyBase64(base64)) {
      addMessage(
        report,
        "warning",
        "blob_base64_unusual",
        "Typed Blob base64 data does not look like standard base64.",
        path,
      );
    }
    return;
  }

  if (typeof type === "string") {
    addMessage(
      report,
      "warning",
      "unknown_typed_value",
      `Unknown typed value marker "${type}".`,
      path,
    );
    return;
  }

  Object.entries(value).forEach(([key, entryValue]) =>
    validateTypedValues(entryValue, report, `${path}.${key}`),
  );
};

const validateReference = (
  report: FullBackupRestoreValidationReport,
  record: Record<string, unknown>,
  options: {
    tableName: FullBackupTableName;
    rowIndex: number;
    field: string;
    targetTableName: FullBackupTableName;
    targetIds: Set<number>;
    code: string;
  },
): void => {
  const rawId = record[options.field];

  if (!valueIsPresent(rawId)) {
    return;
  }

  if (typeof rawId !== "number") {
    addMessage(
      report,
      "error",
      `${options.code}_invalid_type`,
      `${options.tableName}.${options.field} must be a number when present.`,
      `tables.${options.tableName}[${options.rowIndex}].${options.field}`,
    );
    return;
  }

  if (!options.targetIds.has(rawId)) {
    addMessage(
      report,
      "error",
      options.code,
      `${options.tableName} row references missing ${options.targetTableName} row via ${options.field}.`,
      `tables.${options.tableName}[${options.rowIndex}].${options.field}`,
      {
        referencedId: rawId,
      },
    );
  }
};

const validateMetadata = (
  backup: Record<string, unknown>,
  report: FullBackupRestoreValidationReport,
): Record<string, unknown> | null => {
  if (backup.backupFormatVersion !== 1) {
    addMessage(
      report,
      "error",
      "invalid_backup_format_version",
      "backupFormatVersion must exist and equal 1.",
      "backupFormatVersion",
    );
  } else {
    report.backupFormatVersion = 1;
  }

  if (backup.appName !== "personal-finance") {
    addMessage(
      report,
      "error",
      "invalid_app_name",
      'appName must equal "personal-finance".',
      "appName",
    );
  }

  if (typeof backup.dbName !== "string" || backup.dbName.length === 0) {
    addMessage(
      report,
      "error",
      "missing_db_name",
      "dbName must exist.",
      "dbName",
    );
  }

  if (
    typeof backup.exportedAt !== "string" ||
    !isParseableDate(backup.exportedAt)
  ) {
    addMessage(
      report,
      "error",
      "invalid_exported_at",
      "exportedAt must be present and parseable.",
      "exportedAt",
    );
  } else {
    report.backupExportedAt = backup.exportedAt;
  }

  if (!isRecord(backup.tables)) {
    addMessage(
      report,
      "error",
      "missing_tables",
      "tables object must exist.",
      "tables",
    );
    return null;
  }

  return backup.tables;
};

const validateTablesAndCounts = (
  backup: Record<string, unknown>,
  tables: Record<string, unknown>,
  report: FullBackupRestoreValidationReport,
): void => {
  const integrity = isRecord(backup.integrity) ? backup.integrity : null;
  const counts = integrity && isRecord(integrity.counts) ? integrity.counts : null;

  if (!counts) {
    addMessage(
      report,
      "error",
      "missing_integrity_counts",
      "integrity.counts must exist for backup format version 1.",
      "integrity.counts",
    );
  }

  FULL_BACKUP_TABLE_NAMES.forEach((tableName) => {
    const table = tables[tableName];

    if (!Array.isArray(table)) {
      addMessage(
        report,
        "error",
        "missing_or_invalid_table",
        `${tableName} table must exist and be an array.`,
        `tables.${tableName}`,
      );
      return;
    }

    report.rowCounts[tableName] = table.length;

    table.forEach((row, index) => {
      if (!isRecord(row)) {
        addMessage(
          report,
          "error",
          "invalid_table_row",
          `${tableName} row must be an object.`,
          `tables.${tableName}[${index}]`,
        );
      }
    });

    if (counts) {
      const expectedCount = counts[tableName];
      if (typeof expectedCount !== "number") {
        addMessage(
          report,
          "error",
          "missing_table_count",
          `integrity.counts.${tableName} must be a number.`,
          `integrity.counts.${tableName}`,
        );
      } else if (expectedCount !== table.length) {
        addMessage(
          report,
          "error",
          "table_count_mismatch",
          `${tableName} row count does not match integrity count.`,
          `integrity.counts.${tableName}`,
          {
            expectedCount,
            actualCount: table.length,
          },
        );
      }
    }
  });
};

const validateReferences = (
  tables: Record<string, unknown>,
  report: FullBackupRestoreValidationReport,
): void => {
  const transactions = getTableRows(tables, "transactions");
  const budgets = getTableRows(tables, "budgets");
  const budgetSnapshots = getTableRows(tables, "budgetSnapshots");
  const buckets = getTableRows(tables, "buckets");
  const categories = getTableRows(tables, "categories");
  const accounts = getTableRows(tables, "accounts");
  const recipients = getTableRows(tables, "recipients");
  const smsImportTemplates = getTableRows(tables, "smsImportTemplates");

  const budgetIds = getIdSet(budgets);
  const budgetSnapshotIds = getIdSet(budgetSnapshots);
  const bucketIds = getIdSet(buckets);
  const categoryIds = getIdSet(categories);
  const accountIds = getIdSet(accounts);
  const recipientIds = getIdSet(recipients);

  transactions.forEach((transaction, rowIndex) => {
    validateReference(report, transaction, {
      tableName: "transactions",
      rowIndex,
      field: "categoryId",
      targetTableName: "categories",
      targetIds: categoryIds,
      code: "transaction_missing_category",
    });
    validateReference(report, transaction, {
      tableName: "transactions",
      rowIndex,
      field: "accountId",
      targetTableName: "accounts",
      targetIds: accountIds,
      code: "transaction_missing_account",
    });
    validateReference(report, transaction, {
      tableName: "transactions",
      rowIndex,
      field: "recipientId",
      targetTableName: "recipients",
      targetIds: recipientIds,
      code: "transaction_missing_recipient",
    });
    validateReference(report, transaction, {
      tableName: "transactions",
      rowIndex,
      field: "budgetSnapshotId",
      targetTableName: "budgetSnapshots",
      targetIds: budgetSnapshotIds,
      code: "transaction_missing_budget_snapshot",
    });
    validateReference(report, transaction, {
      tableName: "transactions",
      rowIndex,
      field: "budgetId",
      targetTableName: "budgets",
      targetIds: budgetIds,
      code: "transaction_missing_budget",
    });
  });

  budgetSnapshots.forEach((snapshot, rowIndex) => {
    validateReference(report, snapshot, {
      tableName: "budgetSnapshots",
      rowIndex,
      field: "budgetId",
      targetTableName: "budgets",
      targetIds: budgetIds,
      code: "budget_snapshot_missing_budget",
    });
  });

  categories.forEach((category, rowIndex) => {
    validateReference(report, category, {
      tableName: "categories",
      rowIndex,
      field: "bucketId",
      targetTableName: "buckets",
      targetIds: bucketIds,
      code: "category_missing_bucket",
    });
  });

  budgets.forEach((budget, rowIndex) => {
    validateReference(report, budget, {
      tableName: "budgets",
      rowIndex,
      field: "categoryId",
      targetTableName: "categories",
      targetIds: categoryIds,
      code: "budget_missing_category",
    });
    validateReference(report, budget, {
      tableName: "budgets",
      rowIndex,
      field: "accountId",
      targetTableName: "accounts",
      targetIds: accountIds,
      code: "budget_missing_account",
    });
    validateReference(report, budget, {
      tableName: "budgets",
      rowIndex,
      field: "recipientId",
      targetTableName: "recipients",
      targetIds: recipientIds,
      code: "budget_missing_recipient",
    });
  });

  smsImportTemplates.forEach((template, rowIndex) => {
    validateReference(report, template, {
      tableName: "smsImportTemplates",
      rowIndex,
      field: "accountId",
      targetTableName: "accounts",
      targetIds: accountIds,
      code: "sms_import_template_missing_account",
    });
  });
};

const validateTransferPairs = (
  tables: Record<string, unknown>,
  report: FullBackupRestoreValidationReport,
): void => {
  const transactions = getTableRows(tables, "transactions");
  const transactionsById = getIdMap(transactions);

  transactions.forEach((transaction, rowIndex) => {
    if (transaction.isTransfer !== true) {
      return;
    }

    const id = getOptionalNumber(transaction, "id");
    const transferPairId = getOptionalNumber(transaction, "transferPairId");
    const path = `tables.transactions[${rowIndex}]`;

    if (transferPairId === undefined) {
      addMessage(
        report,
        "error",
        "transfer_missing_pair_id",
        "Transfer transaction must have transferPairId.",
        `${path}.transferPairId`,
      );
      return;
    }

    if (id !== undefined && transferPairId === id) {
      addMessage(
        report,
        "error",
        "transfer_pair_self_reference",
        "Transfer transaction points to itself as its transfer pair.",
        `${path}.transferPairId`,
        { transactionId: id },
      );
      return;
    }

    const pair = transactionsById.get(transferPairId);
    if (!pair) {
      addMessage(
        report,
        "error",
        "transfer_pair_missing",
        "transferPairId references a missing transaction.",
        `${path}.transferPairId`,
        { transferPairId },
      );
      return;
    }

    const pairTransferPairId = getOptionalNumber(pair, "transferPairId");
    if (id !== undefined && pairTransferPairId !== id) {
      addMessage(
        report,
        "error",
        "transfer_pair_not_reciprocal",
        "Transfer pair does not point back to the original transaction.",
        `${path}.transferPairId`,
        {
          transactionId: id,
          transferPairId,
          pairedTransactionTransferPairId: pairTransferPairId,
        },
      );
    }

    const amount = getOptionalNumber(transaction, "amount");
    const pairAmount = getOptionalNumber(pair, "amount");
    if (amount === undefined || pairAmount === undefined) {
      addMessage(
        report,
        "warning",
        "transfer_pair_amount_missing",
        "Transfer pair amount signs could not be validated.",
        `${path}.amount`,
      );
      return;
    }

    const hasOnePositiveAndOneNegative =
      (amount < 0 && pairAmount > 0) || (amount > 0 && pairAmount < 0);

    if (!hasOnePositiveAndOneNegative) {
      addMessage(
        report,
        "error",
        "transfer_pair_invalid_amount_signs",
        "Transfer pair should have one positive and one negative amount.",
        `${path}.amount`,
        {
          amount,
          pairAmount,
        },
      );
    }
  });
};

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
};

const deserializeBackupValue = (value: unknown): DeserializedValue => {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deserializeBackupValue(item));
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (value.__type === "Date" && typeof value.value === "string") {
    return new Date(value.value);
  }

  if (
    value.__type === "Blob" &&
    typeof value.base64 === "string" &&
    typeof value.mimeType === "string"
  ) {
    return base64ToBlob(value.base64, value.mimeType);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      deserializeBackupValue(entryValue),
    ]),
  );
};

const getRequiredBackupTables = (
  parsedBackup: unknown,
): Record<FullBackupTableName, Record<string, DeserializedValue>[]> => {
  if (!isRecord(parsedBackup)) {
    throw new Error("Backup is missing tables.");
  }

  const tables = parsedBackup.tables;
  if (!isRecord(tables)) {
    throw new Error("Backup is missing tables.");
  }

  return Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((tableName) => {
      const tableRows = tables[tableName];
      if (!Array.isArray(tableRows)) {
        throw new Error(`Backup table ${tableName} is missing or invalid.`);
      }

      const deserializedRows = tableRows.map((row) => {
        const deserialized = deserializeBackupValue(row);
        if (!isRecord(deserialized)) {
          throw new Error(`Backup table ${tableName} contains a non-object row.`);
        }

        return deserialized as Record<string, DeserializedValue>;
      });

      return [tableName, deserializedRows];
    }),
  ) as Record<FullBackupTableName, Record<string, DeserializedValue>[]>;
};

const getRestoreTable = (
  tableName: FullBackupTableName,
): Table<Record<string, DeserializedValue>, number> =>
  db[tableName] as unknown as Table<Record<string, DeserializedValue>, number>;

const buildTimestampForFilename = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}-${pad(date.getMinutes())}`;
};

export const validateFullBackupRestoreDryRun = (
  parsedBackup: unknown,
): FullBackupRestoreValidationReport => {
  const report: FullBackupRestoreValidationReport = {
    valid: false,
    checkedAt: new Date().toISOString(),
    rowCounts: {},
    errors: [],
    warnings: [],
    info: [],
  };

  if (!isRecord(parsedBackup)) {
    addMessage(
      report,
      "error",
      "invalid_backup_root",
      "Backup JSON root must be an object.",
    );
    return report;
  }

  const tables = validateMetadata(parsedBackup, report);
  if (tables) {
    validateTablesAndCounts(parsedBackup, tables, report);
    validateTypedValues(tables, report, "tables");
    validateReferences(tables, report);
    validateTransferPairs(tables, report);
  }

  if (report.errors.length === 0) {
    addMessage(
      report,
      "info",
      "restore_dry_run_valid",
      "Backup passed dry-run validation. No database data was changed.",
    );
  }

  report.valid = report.errors.length === 0;
  return report;
};

export const restoreFullBackupToIndexedDb = async (
  parsedBackup: unknown,
): Promise<FullBackupRestoreSummary> => {
  const validationReport = validateFullBackupRestoreDryRun(parsedBackup);
  const summary: FullBackupRestoreSummary = {
    restoredAt: new Date().toISOString(),
    backupExportedAt: validationReport.backupExportedAt,
    restoredRowCounts: Object.fromEntries(
      FULL_BACKUP_TABLE_NAMES.map((tableName) => [tableName, 0]),
    ) as Record<FullBackupTableName, number>,
    validationErrorCount: validationReport.errors.length,
    validationWarningCount: validationReport.warnings.length,
    success: false,
  };

  if (validationReport.errors.length > 0) {
    return {
      ...summary,
      errorMessage:
        "Restore blocked because the backup dry-run validation has errors.",
    };
  }

  try {
    const deserializedTables = getRequiredBackupTables(parsedBackup);
    await db.transaction("rw", [
      db.transactions,
      db.budgets,
      db.budgetSnapshots,
      db.buckets,
      db.categories,
      db.accounts,
      db.paymentMethods,
      db.recipients,
      db.smsImportTemplates,
    ], async () => {
      for (const tableName of FULL_BACKUP_TABLE_NAMES) {
        await getRestoreTable(tableName).clear();
      }

      for (const tableName of FULL_BACKUP_TABLE_NAMES) {
        const rows = deserializedTables[tableName];
        if (rows.length > 0) {
          await getRestoreTable(tableName).bulkPut(rows);
        }
        summary.restoredRowCounts[tableName] = rows.length;
      }
    });

    return {
      ...summary,
      restoredAt: new Date().toISOString(),
      success: true,
    };
  } catch (err) {
    return {
      ...summary,
      restoredAt: new Date().toISOString(),
      success: false,
      errorMessage: err instanceof Error ? err.message : "Unknown restore error",
    };
  }
};

export const getFullBackupValidationReportFilename = (
  date = new Date(),
): string =>
  `personal-finance-backup-validation-${buildTimestampForFilename(date)}.json`;

export const downloadFullBackupValidationReport = (
  report: FullBackupRestoreValidationReport,
): string => {
  const filename = getFullBackupValidationReportFilename();
  const json = JSON.stringify(report, null, 2);
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

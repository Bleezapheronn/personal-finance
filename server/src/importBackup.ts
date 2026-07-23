import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BackupRecord,
  BackupTables,
  FULL_BACKUP_TABLE_NAMES,
  FullBackupTableName,
  isPlainObject,
} from "./lib/backup.js";
import { isInsidePath } from "./lib/paths.js";
import { decodeBackupAccountImage } from "./lib/accountImageBackup.js";

type SqlValue = string | number | Buffer | null;
type SqlParams = Record<string, SqlValue>;

interface ImportArgs {
  input?: string;
  output?: string;
  overwriteDisposable: boolean;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface ImportWarning {
  table?: FullBackupTableName;
  recordId?: number;
  field?: string;
  defaultValue?: boolean | number | string | null;
  count?: number;
  code: string;
  message: string;
}

interface ImportSummary {
  success: boolean;
  startedAt: string;
  finishedAt: string;
  backupExportedAt: string;
  backupFormatVersion: number;
  outputDatabasePath: string;
  summaryPath: string;
  importedRowCounts: Record<FullBackupTableName, number>;
  warnings: ImportWarning[];
}

interface FullBackup {
  backupFormatVersion: number;
  appName: string;
  dbName: string;
  exportedAt: string;
  tables: BackupTables;
  integrity: {
    counts: Record<FullBackupTableName, number>;
  };
}

const usage = `Usage:
  npm run import:backup -- -- --input <path-to-full-backup.json> --output <path-to-disposable.sqlite>

Options:
  --input <path>                       Full JSON backup file outside the repo.
  --output <path>                      Disposable SQLite database path outside the repo.
  --overwrite-disposable               Replace an existing disposable output database.
  --allow-repo-output-for-tests        Allow repo-local output only for explicit tests.
  --help                               Show this help text.
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverRoot, "..");
const schemaPath = path.join(serverRoot, "schema", "prototype-schema.sql");

const parseArgs = (argv: string[]): ImportArgs => {
  const args: ImportArgs = {
    overwriteDisposable: false,
    allowRepoOutputForTests: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--overwrite-disposable") {
      args.overwriteDisposable = true;
      continue;
    }

    if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
      continue;
    }

    if (arg === "--input") {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output") {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
};

const parseBackup = (inputPath: string): FullBackup => {
  const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;

  if (!isPlainObject(parsed)) {
    throw new Error("Backup root must be an object.");
  }

  if (parsed.backupFormatVersion !== 1) {
    throw new Error("backupFormatVersion must equal 1.");
  }

  if (parsed.appName !== "personal-finance") {
    throw new Error('appName must equal "personal-finance".');
  }

  if (typeof parsed.dbName !== "string" || parsed.dbName.length === 0) {
    throw new Error("dbName must be present.");
  }

  if (typeof parsed.exportedAt !== "string" || Number.isNaN(Date.parse(parsed.exportedAt))) {
    throw new Error("exportedAt must be present and parseable.");
  }

  if (!isPlainObject(parsed.tables)) {
    throw new Error("tables must be present.");
  }

  if (!isPlainObject(parsed.integrity) || !isPlainObject(parsed.integrity.counts)) {
    throw new Error("integrity.counts must be present.");
  }

  const tables: Partial<BackupTables> = {};
  const counts: Partial<Record<FullBackupTableName, number>> = {};

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    const table = parsed.tables[tableName];
    const count = parsed.integrity.counts[tableName];

    if (!Array.isArray(table)) {
      throw new Error(`tables.${tableName} must be an array.`);
    }

    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`integrity.counts.${tableName} must be a non-negative integer.`);
    }

    if (table.length !== count) {
      throw new Error(
        `Count mismatch for ${tableName}: table has ${table.length}, integrity count has ${count}.`,
      );
    }

    tables[tableName] = table.map((record, index) => {
      if (!isPlainObject(record)) {
        throw new Error(`tables.${tableName}[${index}] must be an object.`);
      }
      return record;
    });
    counts[tableName] = count;
  }

  return {
    backupFormatVersion: parsed.backupFormatVersion,
    appName: parsed.appName,
    dbName: parsed.dbName,
    exportedAt: parsed.exportedAt,
    tables: tables as BackupTables,
    integrity: {
      counts: counts as Record<FullBackupTableName, number>,
    },
  };
};

const asNumber = (
  record: BackupRecord,
  field: string,
  options: { required: boolean; integer?: boolean } = { required: false },
): number | null => {
  const value = record[field];

  if (value === undefined || value === null) {
    if (options.required) {
      throw new Error(`Required numeric field ${field} is missing.`);
    }
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field ${field} must be a finite number.`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`Field ${field} must be an integer.`);
  }

  return value;
};

const asString = (
  record: BackupRecord,
  field: string,
  options: { required: boolean } = { required: false },
): string | null => {
  const value = record[field];

  if (value === undefined || value === null) {
    if (options.required) {
      throw new Error(`Required text field ${field} is missing.`);
    }
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Field ${field} must be text.`);
  }

  return value;
};

const asBooleanInt = (
  record: BackupRecord,
  field: string,
  options: { required: boolean } = { required: false },
): number | null => {
  const value = record[field];

  if (value === undefined || value === null) {
    if (options.required) {
      throw new Error(`Required boolean field ${field} is missing.`);
    }
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value === 0 || value === 1) {
    return value;
  }

  throw new Error(`Field ${field} must be boolean.`);
};

const asBooleanIntWithLegacyDefault = (
  record: BackupRecord,
  field: string,
  defaultValue: boolean,
  options: {
    table: FullBackupTableName;
    warnings: ImportWarning[];
  },
): number => {
  const value = record[field];

  if (value === undefined || value === null) {
    const existingWarning = options.warnings.find(
      (warning) =>
        warning.code === "legacy_defaulted_boolean" &&
        warning.table === options.table &&
        warning.field === field,
    );

    if (existingWarning) {
      existingWarning.count = (existingWarning.count ?? 0) + 1;
    } else {
      options.warnings.push({
        table: options.table,
        field,
        defaultValue,
        count: 1,
        code: "legacy_defaulted_boolean",
        message: "Missing legacy boolean field defaulted during disposable SQLite import.",
      });
    }

    return defaultValue ? 1 : 0;
  }

  return asBooleanInt(record, field, { required: true }) ?? (defaultValue ? 1 : 0);
};

const asIsoText = (
  record: BackupRecord,
  field: string,
  options: { required: boolean } = { required: false },
): string | null => {
  const value = record[field];

  if (value === undefined || value === null) {
    if (options.required) {
      throw new Error(`Required date field ${field} is missing.`);
    }
    return null;
  }

  if (isPlainObject(value) && value.__type === "Date" && typeof value.value === "string") {
    if (Number.isNaN(Date.parse(value.value))) {
      throw new Error(`Typed Date field ${field} is not parseable.`);
    }
    return value.value;
  }

  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  throw new Error(`Field ${field} must be a typed Date or parseable date string.`);
};

const normalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (isPlainObject(value)) {
    if (value.__type === "Date" && typeof value.value === "string") {
      return value.value;
    }

    if (value.__type === "Blob") {
      return null;
    }

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeJsonValue(entryValue),
      ]),
    );
  }

  return value;
};

const asJsonText = (record: BackupRecord, field: string): string | null => {
  const value = record[field];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(normalizeJsonValue(value));
};

const requireId = (record: BackupRecord): number => {
  const id = asNumber(record, "id", { required: true, integer: true });

  if (id === null) {
    throw new Error("Required id is missing.");
  }

  return id;
};

const insertRows = (
  db: Database.Database,
  tableName: FullBackupTableName,
  columns: string[],
  rows: BackupRecord[],
  mapRow: (record: BackupRecord) => SqlParams,
): number => {
  const placeholders = columns.map((column) => `@${column}`).join(", ");
  const statement = db.prepare(
    `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
  );

  for (const row of rows) {
    try {
      statement.run(mapRow(row));
    } catch (error) {
      const id = asNumber(row, "id", { required: false, integer: true });
      const idSuffix = id === null ? "" : ` id ${id}`;
      throw new Error(
        `Failed to import ${tableName}${idSuffix}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return rows.length;
};

const mapTransaction = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  categoryId: asNumber(record, "categoryId", { required: true, integer: true }),
  paymentChannelId: asNumber(record, "paymentChannelId", { required: false, integer: true }),
  accountId: asNumber(record, "accountId", { required: false, integer: true }),
  recipientId: asNumber(record, "recipientId", { required: true, integer: true }),
  date: asIsoText(record, "date", { required: true }),
  amount: asNumber(record, "amount", { required: true }),
  originalAmount: asNumber(record, "originalAmount"),
  originalCurrency: asString(record, "originalCurrency"),
  exchangeRate: asNumber(record, "exchangeRate"),
  transactionReference: asString(record, "transactionReference"),
  transactionCost: asNumber(record, "transactionCost"),
  description: asString(record, "description"),
  transferPairId: asNumber(record, "transferPairId", { required: false, integer: true }),
  isTransfer: asBooleanInt(record, "isTransfer"),
  budgetId: asNumber(record, "budgetId", { required: false, integer: true }),
  occurrenceDate: asIsoText(record, "occurrenceDate"),
  budgetSnapshotId: asNumber(record, "budgetSnapshotId", { required: false, integer: true }),
});

const mapBudget =
  (warnings: ImportWarning[]) =>
  (record: BackupRecord): SqlParams => ({
    id: requireId(record),
    description: asString(record, "description", { required: true }),
    categoryId: asNumber(record, "categoryId", { required: true, integer: true }),
    paymentChannelId: asNumber(record, "paymentChannelId", { required: false, integer: true }),
    accountId: asNumber(record, "accountId", { required: false, integer: true }),
    recipientId: asNumber(record, "recipientId", { required: false, integer: true }),
    amount: asNumber(record, "amount", { required: true }),
    transactionCost: asNumber(record, "transactionCost"),
    frequency: asString(record, "frequency", { required: true }),
    frequencyDetails: asJsonText(record, "frequencyDetails"),
    isGoal: asBooleanInt(record, "isGoal", { required: true }),
    isFlexible: asBooleanIntWithLegacyDefault(record, "isFlexible", false, {
      table: "budgets",
      warnings,
    }),
    goalPercentage: asNumber(record, "goalPercentage"),
    goalDirection: asString(record, "goalDirection"),
    isActive: asBooleanInt(record, "isActive", { required: true }),
    remainingCyclesTotal: asNumber(record, "remainingCyclesTotal", {
      required: false,
      integer: true,
    }),
    dueDate: asIsoText(record, "dueDate", { required: true }),
    createdAt: asIsoText(record, "createdAt", { required: true }),
    updatedAt: asIsoText(record, "updatedAt", { required: true }),
  });

const mapBudgetSnapshot =
  (warnings: ImportWarning[]) =>
  (record: BackupRecord): SqlParams => ({
    id: requireId(record),
    budgetId: asNumber(record, "budgetId", { required: true, integer: true }),
    occurrenceDate: asIsoText(record, "occurrenceDate", { required: true }),
    dueDate: asIsoText(record, "dueDate", { required: true }),
    cycleIndex: asNumber(record, "cycleIndex", { required: true, integer: true }),
    description: asString(record, "description", { required: true }),
    categoryId: asNumber(record, "categoryId", { required: true, integer: true }),
    accountId: asNumber(record, "accountId", { required: false, integer: true }),
    recipientId: asNumber(record, "recipientId", { required: false, integer: true }),
    amount: asNumber(record, "amount", { required: true }),
    transactionCost: asNumber(record, "transactionCost"),
    frequency: asString(record, "frequency", { required: true }),
    frequencyDetails: asJsonText(record, "frequencyDetails"),
    isGoal: asBooleanInt(record, "isGoal", { required: true }),
    isFlexible: asBooleanIntWithLegacyDefault(record, "isFlexible", false, {
      table: "budgetSnapshots",
      warnings,
    }),
    goalPercentage: asNumber(record, "goalPercentage"),
    goalDirection: asString(record, "goalDirection"),
    remainingCyclesTotal: asNumber(record, "remainingCyclesTotal", {
      required: false,
      integer: true,
    }),
    isHistorical: asBooleanInt(record, "isHistorical", { required: true }),
    sourceBudgetUpdatedAt: asIsoText(record, "sourceBudgetUpdatedAt", { required: true }),
    createdAt: asIsoText(record, "createdAt", { required: true }),
    updatedAt: asIsoText(record, "updatedAt", { required: true }),
  });

const mapBucket = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  name: asString(record, "name"),
  description: asString(record, "description"),
  minPercentage: asNumber(record, "minPercentage", { required: true }),
  maxPercentage: asNumber(record, "maxPercentage", { required: true }),
  minFixedAmount: asNumber(record, "minFixedAmount"),
  isActive: asBooleanInt(record, "isActive", { required: true }),
  displayOrder: asNumber(record, "displayOrder", { required: true, integer: true }),
  excludeFromReports: asBooleanInt(record, "excludeFromReports", { required: true }),
  createdAt: asIsoText(record, "createdAt", { required: true }),
  updatedAt: asIsoText(record, "updatedAt", { required: true }),
});

const mapCategory = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  name: asString(record, "name"),
  bucketId: asNumber(record, "bucketId", { required: true, integer: true }),
  description: asString(record, "description"),
  isActive: asBooleanInt(record, "isActive", { required: true }),
  createdAt: asIsoText(record, "createdAt", { required: true }),
  updatedAt: asIsoText(record, "updatedAt", { required: true }),
});

const mapAccount =
  (warnings: ImportWarning[]) =>
  (record: BackupRecord): SqlParams => {
    const image = decodeBackupAccountImage(record);
    return {
      id: requireId(record),
      name: asString(record, "name", { required: true }),
      description: asString(record, "description"),
      currency: asString(record, "currency"),
      imageBlob: image?.bytes ?? null,
      imageMimeType: image?.mimeType ?? null,
      isActive: asBooleanInt(record, "isActive", { required: true }),
      isCredit: asBooleanIntWithLegacyDefault(record, "isCredit", false, {
        table: "accounts",
        warnings,
      }),
      creditLimit: asNumber(record, "creditLimit"),
      createdAt: asIsoText(record, "createdAt", { required: true }),
      updatedAt: asIsoText(record, "updatedAt", { required: true }),
    };
  };

const mapPaymentMethod = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  accountId: asNumber(record, "accountId", { required: true, integer: true }),
  name: asString(record, "name", { required: true }),
  description: asString(record, "description"),
  isActive: asBooleanInt(record, "isActive", { required: true }),
  createdAt: asIsoText(record, "createdAt", { required: true }),
  updatedAt: asIsoText(record, "updatedAt", { required: true }),
});

const mapRecipient = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  name: asString(record, "name", { required: true }),
  aliases: asString(record, "aliases"),
  email: asString(record, "email"),
  phone: asString(record, "phone"),
  tillNumber: asString(record, "tillNumber"),
  paybill: asString(record, "paybill"),
  accountNumber: asString(record, "accountNumber"),
  description: asString(record, "description"),
  isActive: asBooleanInt(record, "isActive", { required: true }),
  createdAt: asIsoText(record, "createdAt", { required: true }),
  updatedAt: asIsoText(record, "updatedAt", { required: true }),
});

const mapSmsImportTemplate = (record: BackupRecord): SqlParams => ({
  id: requireId(record),
  name: asString(record, "name", { required: true }),
  description: asString(record, "description"),
  paymentMethodId: asNumber(record, "paymentMethodId", { required: false, integer: true }),
  accountId: asNumber(record, "accountId", { required: false, integer: true }),
  referencePattern: asString(record, "referencePattern"),
  amountPattern: asString(record, "amountPattern"),
  recipientNamePattern: asString(record, "recipientNamePattern"),
  recipientPhonePattern: asString(record, "recipientPhonePattern"),
  dateTimePattern: asString(record, "dateTimePattern"),
  costPattern: asString(record, "costPattern"),
  incomePattern: asString(record, "incomePattern"),
  expensePattern: asString(record, "expensePattern"),
  isActive: asBooleanInt(record, "isActive", { required: true }),
  createdAt: asIsoText(record, "createdAt", { required: true }),
  updatedAt: asIsoText(record, "updatedAt", { required: true }),
});

const cleanupFailedOutput = (outputPath: string, summaryPath: string): void => {
  for (const candidate of [outputPath, `${outputPath}-wal`, `${outputPath}-shm`, summaryPath]) {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};

const importBackup = (backup: FullBackup, outputPath: string): ImportSummary => {
  const startedAt = new Date().toISOString();
  const warnings: ImportWarning[] = [];
  const schema = readFileSync(schemaPath, "utf8");
  const db = new Database(outputPath);
  const importedRowCounts = Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((tableName) => [tableName, 0]),
  ) as Record<FullBackupTableName, number>;

  try {
    db.exec(schema);

    const runImport = db.transaction(() => {
      importedRowCounts.accounts = insertRows(
        db,
        "accounts",
        [
          "id",
          "name",
          "description",
          "currency",
          "imageBlob",
          "imageMimeType",
          "isActive",
          "isCredit",
          "creditLimit",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.accounts,
        mapAccount(warnings),
      );
      importedRowCounts.buckets = insertRows(
        db,
        "buckets",
        [
          "id",
          "name",
          "description",
          "minPercentage",
          "maxPercentage",
          "minFixedAmount",
          "isActive",
          "displayOrder",
          "excludeFromReports",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.buckets,
        mapBucket,
      );
      importedRowCounts.categories = insertRows(
        db,
        "categories",
        ["id", "name", "bucketId", "description", "isActive", "createdAt", "updatedAt"],
        backup.tables.categories,
        mapCategory,
      );
      importedRowCounts.recipients = insertRows(
        db,
        "recipients",
        [
          "id",
          "name",
          "aliases",
          "email",
          "phone",
          "tillNumber",
          "paybill",
          "accountNumber",
          "description",
          "isActive",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.recipients,
        mapRecipient,
      );
      importedRowCounts.paymentMethods = insertRows(
        db,
        "paymentMethods",
        ["id", "accountId", "name", "description", "isActive", "createdAt", "updatedAt"],
        backup.tables.paymentMethods,
        mapPaymentMethod,
      );
      importedRowCounts.budgets = insertRows(
        db,
        "budgets",
        [
          "id",
          "description",
          "categoryId",
          "paymentChannelId",
          "accountId",
          "recipientId",
          "amount",
          "transactionCost",
          "frequency",
          "frequencyDetails",
          "isGoal",
          "isFlexible",
          "goalPercentage",
          "goalDirection",
          "isActive",
          "remainingCyclesTotal",
          "dueDate",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.budgets,
        mapBudget(warnings),
      );
      importedRowCounts.budgetSnapshots = insertRows(
        db,
        "budgetSnapshots",
        [
          "id",
          "budgetId",
          "occurrenceDate",
          "dueDate",
          "cycleIndex",
          "description",
          "categoryId",
          "accountId",
          "recipientId",
          "amount",
          "transactionCost",
          "frequency",
          "frequencyDetails",
          "isGoal",
          "isFlexible",
          "goalPercentage",
          "goalDirection",
          "remainingCyclesTotal",
          "isHistorical",
          "sourceBudgetUpdatedAt",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.budgetSnapshots,
        mapBudgetSnapshot(warnings),
      );
      importedRowCounts.smsImportTemplates = insertRows(
        db,
        "smsImportTemplates",
        [
          "id",
          "name",
          "description",
          "paymentMethodId",
          "accountId",
          "referencePattern",
          "amountPattern",
          "recipientNamePattern",
          "recipientPhonePattern",
          "dateTimePattern",
          "costPattern",
          "incomePattern",
          "expensePattern",
          "isActive",
          "createdAt",
          "updatedAt",
        ],
        backup.tables.smsImportTemplates,
        mapSmsImportTemplate,
      );
      importedRowCounts.transactions = insertRows(
        db,
        "transactions",
        [
          "id",
          "categoryId",
          "paymentChannelId",
          "accountId",
          "recipientId",
          "date",
          "amount",
          "originalAmount",
          "originalCurrency",
          "exchangeRate",
          "transactionReference",
          "transactionCost",
          "description",
          "transferPairId",
          "isTransfer",
          "budgetId",
          "occurrenceDate",
          "budgetSnapshotId",
        ],
        backup.tables.transactions,
        mapTransaction,
      );
    });

    runImport();
  } finally {
    db.close();
  }

  return {
    success: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    backupExportedAt: backup.exportedAt,
    backupFormatVersion: backup.backupFormatVersion,
    outputDatabasePath: outputPath,
    summaryPath: `${outputPath}.import-summary.json`,
    importedRowCounts,
    warnings,
  };
};

const printSummary = (summary: ImportSummary): void => {
  console.log("Import complete.");
  console.log(`Output database: ${summary.outputDatabasePath}`);
  console.log("Imported row counts:");

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    console.log(`  ${tableName}: ${summary.importedRowCounts[tableName]}`);
  }

  if (summary.warnings.length > 0) {
    console.log(`Warnings: ${summary.warnings.length}`);
    const warningCounts = new Map<string, number>();
    for (const warning of summary.warnings) {
      warningCounts.set(
        warning.code,
        (warningCounts.get(warning.code) ?? 0) + (warning.count ?? 1),
      );
    }
    for (const [code, count] of warningCounts.entries()) {
      console.log(`  ${code}: ${count}`);
    }
  } else {
    console.log("Warnings: 0");
  }

  console.log(`Summary JSON: ${summary.summaryPath}`);
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage);
    return;
  }

  if (!args.input || !args.output) {
    console.error(usage);
    throw new Error("--input and --output are required.");
  }

  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const summaryPath = `${outputPath}.import-summary.json`;

  if (!existsSync(inputPath)) {
    throw new Error(`Input backup file does not exist: ${inputPath}`);
  }

  if (isInsidePath(repoRoot, outputPath) && !args.allowRepoOutputForTests) {
    throw new Error(
      "Refusing to write SQLite output inside the repository. Use an outside path or --allow-repo-output-for-tests.",
    );
  }

  if (isInsidePath(repoRoot, summaryPath) && !args.allowRepoOutputForTests) {
    throw new Error(
      "Refusing to write import summary inside the repository. Use an outside path or --allow-repo-output-for-tests.",
    );
  }

  if (existsSync(outputPath) && !args.overwriteDisposable) {
    throw new Error("Output database already exists. Pass --overwrite-disposable to replace it.");
  }

  if (existsSync(summaryPath) && !args.overwriteDisposable) {
    throw new Error("Import summary already exists. Pass --overwrite-disposable to replace it.");
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });

  if (args.overwriteDisposable) {
    cleanupFailedOutput(outputPath, summaryPath);
  }

  const backup = parseBackup(inputPath);

  try {
    const summary = importBackup(backup, outputPath);
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    printSummary(summary);
  } catch (error) {
    cleanupFailedOutput(outputPath, summaryPath);
    throw error;
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

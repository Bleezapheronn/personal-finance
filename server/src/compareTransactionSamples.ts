import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FULL_BACKUP_TABLE_NAMES = [
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

const TRANSACTION_FIELDS = [
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
] as const;

const SENSITIVE_STRING_FIELDS = ["description", "transactionReference"] as const;
const DEFAULT_SAMPLE_SIZE = 12;

type FullBackupTableName = (typeof FULL_BACKUP_TABLE_NAMES)[number];
type TransactionField = (typeof TRANSACTION_FIELDS)[number];
type SensitiveStringField = (typeof SENSITIVE_STRING_FIELDS)[number];
type BackupRecord = Record<string, unknown>;
type NormalizedValue = string | number | boolean | null;

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  ids?: number[];
  sampleSize: number;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

type NormalizedTransaction = Record<TransactionField, NormalizedValue>;

interface SampledTransaction {
  id: number;
  reasons: string[];
}

interface SafeMismatch {
  transactionId: number;
  field: Exclude<TransactionField, SensitiveStringField>;
  expectedValue: NormalizedValue;
  actualValue: NormalizedValue;
}

interface SensitiveStringMismatch {
  transactionId: number;
  field: SensitiveStringField;
  expectedPresent: boolean;
  actualPresent: boolean;
  matches: boolean;
}

interface MissingTransactionMismatch {
  transactionId: number;
  issue: "missing_in_sqlite";
}

type TransactionMismatch = SafeMismatch | SensitiveStringMismatch | MissingTransactionMismatch;

interface TransactionComparison {
  transactionId: number;
  sampleReasons: string[];
  status: "pass" | "fail";
  mismatchCount: number;
}

interface TransactionSampleReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  samplingMode: "explicit_ids" | "deterministic";
  requestedSampleSize: number;
  sampledTransactionCount: number;
  comparedFieldCount: number;
  mismatchCount: number;
  dateNormalization: {
    note: string;
  };
  sensitiveOutput: {
    note: string;
    sensitiveStringFields: SensitiveStringField[];
  };
  samples: TransactionComparison[];
  mismatches: TransactionMismatch[];
}

const usage = `Usage:
  npm run compare:transactions -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--ids <id,id>] [--sample-size <number>] [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --ids <id,id>                       Optional comma-separated transaction IDs to compare exactly.
  --sample-size <number>              Optional deterministic sample size. Defaults to ${DEFAULT_SAMPLE_SIZE}.
  --output <path>                     Optional transaction sample comparison report JSON.
  --allow-repo-output-for-tests       Allow repo-local report output only for explicit tests.
  --help                             Show this help text.
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverRoot, "..");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInsidePath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const parseIds = (rawValue: string | undefined): number[] => {
  if (!rawValue) {
    throw new Error("--ids requires a comma-separated value.");
  }

  const ids = rawValue.split(",").map((value) => {
    const id = Number(value.trim());
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("--ids must contain positive integer transaction IDs.");
    }
    return id;
  });

  return [...new Set(ids)];
};

const parseSampleSize = (rawValue: string | undefined): number => {
  if (!rawValue) {
    throw new Error("--sample-size requires a value.");
  }

  const sampleSize = Number(rawValue);
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer.");
  }
  return sampleSize;
};

const parseArgs = (argv: string[]): CompareArgs => {
  const args: CompareArgs = {
    sampleSize: DEFAULT_SAMPLE_SIZE,
    allowRepoOutputForTests: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
      continue;
    }

    if (arg === "--backup") {
      args.backup = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sqlite") {
      args.sqlite = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--ids") {
      args.ids = parseIds(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--sample-size") {
      args.sampleSize = parseSampleSize(argv[index + 1]);
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

const normalizeOptionalNumber = (record: BackupRecord, field: string): number | null => {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const normalizeRequiredNumber = (record: BackupRecord, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Transaction field ${field} must be numeric.`);
  }
  return value;
};

const normalizeOptionalString = (record: BackupRecord, field: string): string | null => {
  const value = record[field];
  return typeof value === "string" ? value : null;
};

const normalizeOptionalBoolean = (record: BackupRecord, field: string): boolean | null => {
  const value = record[field];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  return null;
};

const normalizeRequiredDateText = (record: BackupRecord, field: string): string => {
  const value = record[field];
  if (isPlainObject(value) && value.__type === "Date" && typeof value.value === "string") {
    if (Number.isNaN(Date.parse(value.value))) {
      throw new Error(`Typed Date field ${field} is not parseable.`);
    }
    return value.value;
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  throw new Error(`Transaction field ${field} must be a typed Date or parseable date string.`);
};

const normalizeOptionalDateText = (record: BackupRecord, field: string): string | null => {
  const value = record[field];
  if (value === undefined || value === null) {
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
  throw new Error(`Transaction field ${field} must be a typed Date or parseable date string.`);
};

const normalizeTransaction = (record: BackupRecord): NormalizedTransaction => ({
  id: normalizeRequiredNumber(record, "id"),
  categoryId: normalizeRequiredNumber(record, "categoryId"),
  paymentChannelId: normalizeOptionalNumber(record, "paymentChannelId"),
  accountId: normalizeOptionalNumber(record, "accountId"),
  recipientId: normalizeRequiredNumber(record, "recipientId"),
  date: normalizeRequiredDateText(record, "date"),
  amount: normalizeRequiredNumber(record, "amount"),
  originalAmount: normalizeOptionalNumber(record, "originalAmount"),
  originalCurrency: normalizeOptionalString(record, "originalCurrency"),
  exchangeRate: normalizeOptionalNumber(record, "exchangeRate"),
  transactionReference: normalizeOptionalString(record, "transactionReference"),
  transactionCost: normalizeOptionalNumber(record, "transactionCost"),
  description: normalizeOptionalString(record, "description"),
  transferPairId: normalizeOptionalNumber(record, "transferPairId"),
  isTransfer: normalizeOptionalBoolean(record, "isTransfer"),
  budgetId: normalizeOptionalNumber(record, "budgetId"),
  occurrenceDate: normalizeOptionalDateText(record, "occurrenceDate"),
  budgetSnapshotId: normalizeOptionalNumber(record, "budgetSnapshotId"),
});

const parseBackupTransactions = (backupPath: string): NormalizedTransaction[] => {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;

  if (!isPlainObject(parsed) || !isPlainObject(parsed.tables)) {
    throw new Error("Backup tables must be present.");
  }

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!Array.isArray(parsed.tables[tableName])) {
      throw new Error(`Backup table ${tableName} must be present as an array.`);
    }
  }

  return (parsed.tables.transactions as unknown[]).map((value, index) => {
    if (!isPlainObject(value)) {
      throw new Error(`Backup table transactions row ${index} must be an object.`);
    }
    return normalizeTransaction(value);
  });
};

const tableExists = (db: Database.Database, tableName: FullBackupTableName): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return row !== undefined;
};

const readSqliteTransactions = (db: Database.Database): Map<number, NormalizedTransaction> => {
  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!tableExists(db, tableName)) {
      throw new Error(`SQLite table ${tableName} is missing.`);
    }
  }

  const transactions = db
    .prepare(
      `SELECT id, categoryId, paymentChannelId, accountId, recipientId, date, amount,
        originalAmount, originalCurrency, exchangeRate, transactionReference,
        transactionCost, description, transferPairId, isTransfer, budgetId,
        occurrenceDate, budgetSnapshotId
      FROM transactions`,
    )
    .all()
    .map((row) => normalizeTransaction(row as BackupRecord));

  return new Map(transactions.map((transaction) => [transaction.id as number, transaction]));
};

const sortById = (transactions: NormalizedTransaction[]): NormalizedTransaction[] =>
  [...transactions].sort((left, right) => (left.id as number) - (right.id as number));

const sortByDateThenId = (transactions: NormalizedTransaction[]): NormalizedTransaction[] =>
  [...transactions].sort((left, right) => {
    const leftTime = Date.parse(left.date as string);
    const rightTime = Date.parse(right.date as string);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return (left.id as number) - (right.id as number);
  });

const numberValue = (transaction: NormalizedTransaction, field: TransactionField): number | null => {
  const value = transaction[field];
  return typeof value === "number" ? value : null;
};

const addSample = (
  samplesById: Map<number, SampledTransaction>,
  transaction: NormalizedTransaction | undefined,
  reason: string,
): void => {
  if (!transaction) {
    return;
  }

  const id = transaction.id as number;
  const existingSample = samplesById.get(id);
  if (existingSample) {
    if (!existingSample.reasons.includes(reason)) {
      existingSample.reasons.push(reason);
    }
    return;
  }

  samplesById.set(id, { id, reasons: [reason] });
};

const buildExplicitSamples = (
  backupById: Map<number, NormalizedTransaction>,
  ids: number[],
): SampledTransaction[] => {
  for (const id of ids) {
    if (!backupById.has(id)) {
      throw new Error(`Requested transaction id ${id} is not present in the backup.`);
    }
  }
  return ids.map((id) => ({ id, reasons: ["explicit_id"] }));
};

const buildDeterministicSamples = (
  transactions: NormalizedTransaction[],
  sampleSize: number,
): SampledTransaction[] => {
  const sortedById = sortById(transactions);
  const sortedByDate = sortByDateThenId(transactions);
  const samplesById = new Map<number, SampledTransaction>();

  addSample(
    samplesById,
    sortedById.find((transaction) => {
      const amount = numberValue(transaction, "amount");
      return amount !== null && amount < 0 && transaction.isTransfer !== true;
    }),
    "normal_expense",
  );
  addSample(
    samplesById,
    sortedById.find((transaction) => {
      const amount = numberValue(transaction, "amount");
      return amount !== null && amount > 0 && transaction.isTransfer !== true;
    }),
    "income",
  );
  addSample(
    samplesById,
    sortedById.find((transaction) => transaction.isTransfer === true || transaction.transferPairId !== null),
    "transfer_transaction",
  );
  addSample(
    samplesById,
    sortedById.find((transaction) => transaction.transactionCost !== null),
    "transaction_cost",
  );
  addSample(
    samplesById,
    sortedById.find(
      (transaction) =>
        transaction.originalAmount !== null ||
        transaction.originalCurrency !== null ||
        transaction.exchangeRate !== null,
    ),
    "original_currency_fields",
  );
  addSample(
    samplesById,
    sortedById.find((transaction) => transaction.budgetSnapshotId !== null),
    "budget_snapshot_link",
  );
  addSample(samplesById, sortedByDate.at(-1), "recent_transaction");
  addSample(samplesById, sortedByDate[0], "oldest_transaction");

  for (const transaction of sortedById) {
    if (samplesById.size >= sampleSize) {
      break;
    }
    addSample(samplesById, transaction, "deterministic_fill");
  }

  return [...samplesById.values()].slice(0, sampleSize);
};

const isSensitiveStringField = (field: TransactionField): field is SensitiveStringField =>
  (SENSITIVE_STRING_FIELDS as readonly string[]).includes(field);

const compareTransaction = (
  sampledTransaction: SampledTransaction,
  backup: NormalizedTransaction,
  sqlite: NormalizedTransaction | undefined,
): TransactionMismatch[] => {
  if (!sqlite) {
    return [{ transactionId: sampledTransaction.id, issue: "missing_in_sqlite" }];
  }

  return TRANSACTION_FIELDS.reduce<TransactionMismatch[]>((fieldMismatches, field) => {
    const expectedValue = backup[field];
    const actualValue = sqlite[field];
    const matches = expectedValue === actualValue;

    if (matches) {
      return fieldMismatches;
    }

    if (isSensitiveStringField(field)) {
      fieldMismatches.push({
        transactionId: sampledTransaction.id,
        field,
        expectedPresent: expectedValue !== null,
        actualPresent: actualValue !== null,
        matches,
      });
      return fieldMismatches;
    }

    fieldMismatches.push({
      transactionId: sampledTransaction.id,
      field,
      expectedValue,
      actualValue,
    });
    return fieldMismatches;
  }, []);
};

const buildReport = (
  backupTransactions: NormalizedTransaction[],
  sqliteTransactionsById: Map<number, NormalizedTransaction>,
  samples: SampledTransaction[],
  backupPath: string,
  sqlitePath: string,
  samplingMode: "explicit_ids" | "deterministic",
  requestedSampleSize: number,
): TransactionSampleReport => {
  const backupById = new Map(backupTransactions.map((transaction) => [transaction.id as number, transaction]));
  const mismatches: TransactionMismatch[] = [];

  const sampleComparisons = samples.map((sample) => {
    const backup = backupById.get(sample.id);
    if (!backup) {
      throw new Error(`Sampled transaction id ${sample.id} is not present in the backup.`);
    }

    const sampleMismatches = compareTransaction(sample, backup, sqliteTransactionsById.get(sample.id));
    mismatches.push(...sampleMismatches);

    return {
      transactionId: sample.id,
      sampleReasons: sample.reasons,
      status: sampleMismatches.length === 0 ? "pass" : "fail",
      mismatchCount: sampleMismatches.length,
    } satisfies TransactionComparison;
  });

  return {
    generatedAt: new Date().toISOString(),
    backupFile: path.basename(backupPath),
    sqliteFile: path.basename(sqlitePath),
    overallStatus: mismatches.length === 0 ? "pass" : "fail",
    samplingMode,
    requestedSampleSize,
    sampledTransactionCount: samples.length,
    comparedFieldCount: TRANSACTION_FIELDS.length,
    mismatchCount: mismatches.length,
    dateNormalization: {
      note: "Backup typed Date values are normalized to their value text and compared to SQLite date text, matching importer storage.",
    },
    sensitiveOutput: {
      note: "description and transactionReference are compared internally, but raw values are omitted from the report.",
      sensitiveStringFields: [...SENSITIVE_STRING_FIELDS],
    },
    samples: sampleComparisons,
    mismatches,
  };
};

const printSummary = (report: TransactionSampleReport, outputPath?: string): void => {
  console.log(`Transaction sample comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Sampling mode: ${report.samplingMode}`);
  console.log(`Sampled transactions: ${report.sampledTransactionCount}`);
  console.log(`Compared fields per transaction: ${report.comparedFieldCount}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  if (outputPath) {
    console.log(`Report JSON: ${path.basename(outputPath)}`);
  }
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage);
    return;
  }

  if (!args.backup || !args.sqlite) {
    console.error(usage);
    throw new Error("--backup and --sqlite are required.");
  }

  const backupPath = path.resolve(args.backup);
  const sqlitePath = path.resolve(args.sqlite);
  const outputPath = args.output ? path.resolve(args.output) : undefined;

  if (!existsSync(backupPath)) {
    throw new Error(`Backup file does not exist: ${path.basename(backupPath)}`);
  }

  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite file does not exist: ${path.basename(sqlitePath)}`);
  }

  if (outputPath && isInsidePath(repoRoot, outputPath) && !args.allowRepoOutputForTests) {
    throw new Error(
      "Refusing to write comparison report inside the repository. Use an outside path or --allow-repo-output-for-tests.",
    );
  }

  const backupTransactions = parseBackupTransactions(backupPath);
  const backupById = new Map(backupTransactions.map((transaction) => [transaction.id as number, transaction]));
  const samples = args.ids
    ? buildExplicitSamples(backupById, args.ids)
    : buildDeterministicSamples(backupTransactions, args.sampleSize);
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  try {
    const sqliteTransactionsById = readSqliteTransactions(db);
    const report = buildReport(
      backupTransactions,
      sqliteTransactionsById,
      samples,
      backupPath,
      sqlitePath,
      args.ids ? "explicit_ids" : "deterministic",
      args.ids ? args.ids.length : args.sampleSize,
    );

    if (outputPath) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    printSummary(report, outputPath);
    if (report.overallStatus === "fail") {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

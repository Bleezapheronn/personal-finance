import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BackupRecord,
  FULL_BACKUP_TABLE_NAMES,
  isPlainObject,
} from "./lib/backup.js";
import { isDirectRun } from "./lib/cli.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";
import { roundCurrency } from "./lib/number.js";
import { assertRequiredTablesExist, openReadOnlyDatabase } from "./lib/sqlite.js";
type AggregateSection = "monthly_transaction_totals" | "account_balances";
type AggregateField = "amountTotal" | "transactionCostTotal" | "combinedTotal" | "transactionCount";

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface TransactionForAggregates {
  accountId?: number;
  date: string;
  amount: number;
  transactionCost: number;
}

interface AggregateTotals {
  amountTotal: number;
  transactionCostTotal: number;
  combinedTotal: number;
  transactionCount: number;
}

interface MonthlyComparison {
  month: string;
  backup: AggregateTotals;
  sqlite: AggregateTotals;
  status: "pass" | "fail";
}

interface AccountBalanceComparison {
  accountId: number;
  backup: AggregateTotals;
  sqlite: AggregateTotals;
  status: "pass" | "fail";
}

interface AggregateMismatch {
  section: AggregateSection;
  key: string;
  field: AggregateField;
  backupValue: number;
  sqliteValue: number;
}

export interface FinancialAggregateReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  rounding: {
    scale: "cents";
    decimalPlaces: 2;
    tolerance: 0;
    note: string;
  };
  transferHandling: {
    included: true;
    note: string;
  };
  comparedMonthCount: number;
  comparedAccountCount: number;
  mismatchCount: number;
  monthlyTransactionTotals: MonthlyComparison[];
  accountBalances: AccountBalanceComparison[];
  mismatches: AggregateMismatch[];
}

const usage = `Usage:
  npm run compare:financial -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --output <path>                     Optional aggregate financial comparison report JSON.
  --allow-repo-output-for-tests       Allow repo-local report output only for explicit tests.
  --help                             Show this help text.
`;

const parseArgs = (argv: string[]): CompareArgs => {
  const args: CompareArgs = {
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

    if (arg === "--output") {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
};

const asRequiredNumber = (record: BackupRecord, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Transaction field ${field} must be numeric.`);
  }
  return value;
};

const asOptionalNumber = (record: BackupRecord, field: string): number | undefined => {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const asDateText = (record: BackupRecord, field: string): string => {
  const value = record[field];
  if (isPlainObject(value) && value.__type === "Date" && typeof value.value === "string") {
    return value.value;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Transaction field ${field} must be a date string or typed Date.`);
};

const parseBackupTransactions = (backupPath: string): TransactionForAggregates[] => {
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
    return {
      accountId: asOptionalNumber(value, "accountId"),
      date: asDateText(value, "date"),
      amount: asRequiredNumber(value, "amount"),
      transactionCost: asOptionalNumber(value, "transactionCost") ?? 0,
    };
  });
};

const readSqliteTransactions = (db: Database.Database): TransactionForAggregates[] => {
  assertRequiredTablesExist(db);

  return db
    .prepare("SELECT accountId, date, amount, transactionCost FROM transactions")
    .all()
    .map((row) => {
      const record = row as BackupRecord;
      return {
        accountId: asOptionalNumber(record, "accountId"),
        date: typeof record.date === "string" ? record.date : String(record.date ?? ""),
        amount: asRequiredNumber(record, "amount"),
        transactionCost: asOptionalNumber(record, "transactionCost") ?? 0,
      };
    });
};

const emptyTotals = (): AggregateTotals => ({
  amountTotal: 0,
  transactionCostTotal: 0,
  combinedTotal: 0,
  transactionCount: 0,
});

const addTransaction = (totals: AggregateTotals, transaction: TransactionForAggregates): void => {
  totals.amountTotal += transaction.amount;
  totals.transactionCostTotal += transaction.transactionCost;
  totals.combinedTotal += transaction.amount + transaction.transactionCost;
  totals.transactionCount += 1;
};

const normalizeTotals = (totals: AggregateTotals): AggregateTotals => ({
  amountTotal: roundCurrency(totals.amountTotal),
  transactionCostTotal: roundCurrency(totals.transactionCostTotal),
  combinedTotal: roundCurrency(totals.combinedTotal),
  transactionCount: totals.transactionCount,
});

const monthKey = (dateText: string): string => {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Transaction date must be parseable.");
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};

const aggregateByMonth = (transactions: TransactionForAggregates[]): Map<string, AggregateTotals> => {
  const map = new Map<string, AggregateTotals>();
  for (const transaction of transactions) {
    const key = monthKey(transaction.date);
    const totals = map.get(key) ?? emptyTotals();
    addTransaction(totals, transaction);
    map.set(key, totals);
  }
  return new Map([...map.entries()].map(([key, totals]) => [key, normalizeTotals(totals)]));
};

const aggregateByAccount = (
  transactions: TransactionForAggregates[],
): Map<number, AggregateTotals> => {
  const map = new Map<number, AggregateTotals>();
  for (const transaction of transactions) {
    if (transaction.accountId === undefined) {
      continue;
    }
    const totals = map.get(transaction.accountId) ?? emptyTotals();
    addTransaction(totals, transaction);
    map.set(transaction.accountId, totals);
  }
  return new Map([...map.entries()].map(([key, totals]) => [key, normalizeTotals(totals)]));
};

const compareTotals = (
  section: AggregateSection,
  key: string,
  backup: AggregateTotals,
  sqlite: AggregateTotals,
): AggregateMismatch[] => {
  const fields: AggregateField[] = [
    "amountTotal",
    "transactionCostTotal",
    "combinedTotal",
    "transactionCount",
  ];

  return fields.flatMap((field) =>
    backup[field] === sqlite[field]
      ? []
      : [
          {
            section,
            key,
            field,
            backupValue: backup[field],
            sqliteValue: sqlite[field],
          },
        ],
  );
};

const allStringKeys = (left: Map<string, AggregateTotals>, right: Map<string, AggregateTotals>): string[] =>
  [...new Set([...left.keys(), ...right.keys()])].sort();

const allNumberKeys = (left: Map<number, AggregateTotals>, right: Map<number, AggregateTotals>): number[] =>
  [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b);

const buildReport = (
  backupTransactions: TransactionForAggregates[],
  sqliteTransactions: TransactionForAggregates[],
  backupPath: string,
  sqlitePath: string,
): FinancialAggregateReport => {
  const backupMonths = aggregateByMonth(backupTransactions);
  const sqliteMonths = aggregateByMonth(sqliteTransactions);
  const backupAccounts = aggregateByAccount(backupTransactions);
  const sqliteAccounts = aggregateByAccount(sqliteTransactions);
  const mismatches: AggregateMismatch[] = [];

  const monthlyTransactionTotals = allStringKeys(backupMonths, sqliteMonths).map((key) => {
    const backup = backupMonths.get(key) ?? emptyTotals();
    const sqlite = sqliteMonths.get(key) ?? emptyTotals();
    const sectionMismatches = compareTotals("monthly_transaction_totals", key, backup, sqlite);
    mismatches.push(...sectionMismatches);
    return {
      month: key,
      backup,
      sqlite,
      status: sectionMismatches.length === 0 ? "pass" : "fail",
    } satisfies MonthlyComparison;
  });

  const accountBalances = allNumberKeys(backupAccounts, sqliteAccounts).map((accountId) => {
    const backup = backupAccounts.get(accountId) ?? emptyTotals();
    const sqlite = sqliteAccounts.get(accountId) ?? emptyTotals();
    const sectionMismatches = compareTotals("account_balances", String(accountId), backup, sqlite);
    mismatches.push(...sectionMismatches);
    return {
      accountId,
      backup,
      sqlite,
      status: sectionMismatches.length === 0 ? "pass" : "fail",
    } satisfies AccountBalanceComparison;
  });

  return {
    generatedAt: new Date().toISOString(),
    backupFile: basename(backupPath),
    sqliteFile: basename(sqlitePath),
    overallStatus: mismatches.length === 0 ? "pass" : "fail",
    rounding: {
      scale: "cents",
      decimalPlaces: 2,
      tolerance: 0,
      note: "Aggregate values are rounded to 2 decimals before exact comparison.",
    },
    transferHandling: {
      included: true,
      note: "Transfers are included because current transaction/report aggregation includes normal transaction rows.",
    },
    comparedMonthCount: monthlyTransactionTotals.length,
    comparedAccountCount: accountBalances.length,
    mismatchCount: mismatches.length,
    monthlyTransactionTotals,
    accountBalances,
    mismatches,
  };
};

const printSummary = (report: FinancialAggregateReport, outputPath?: string): void => {
  console.log(`Financial aggregate comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared months: ${report.comparedMonthCount}`);
  console.log(`Compared accounts: ${report.comparedAccountCount}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  if (outputPath) {
    console.log(`Report JSON: ${basename(outputPath)}`);
  }
};

export const runFinancialAggregateComparison = (options: {
  backupPath: string;
  sqlitePath: string;
  outputPath?: string;
}): FinancialAggregateReport => {
  const backupTransactions = parseBackupTransactions(options.backupPath);
  const db = openReadOnlyDatabase(options.sqlitePath);

  try {
    const sqliteTransactions = readSqliteTransactions(db);
    const report = buildReport(
      backupTransactions,
      sqliteTransactions,
      options.backupPath,
      options.sqlitePath,
    );

    if (options.outputPath) {
      writeJsonReport(options.outputPath, report);
    }

    return report;
  } finally {
    db.close();
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

  assertFileExists(backupPath, "Backup file");
  assertFileExists(sqlitePath, "SQLite file");
  assertOutsideRepoUnlessAllowed(outputPath, args.allowRepoOutputForTests, "comparison report");

  const report = runFinancialAggregateComparison({ backupPath, sqlitePath, outputPath });

  printSummary(report, outputPath);
  if (report.overallStatus === "fail") {
    process.exitCode = 1;
  }
};

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

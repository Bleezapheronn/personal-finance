import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BackupRecord,
  FULL_BACKUP_TABLE_NAMES,
  isPlainObject,
} from "./lib/backup.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";
import { roundCurrency } from "./lib/number.js";
import { assertRequiredTablesExist, openReadOnlyDatabase } from "./lib/sqlite.js";
type PeriodType = "month" | "quarter" | "year";
type ReportTotalsField = "totalIncome" | "totalExpense" | "netTotal" | "transactionCount";

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface TransactionForReports {
  date: string;
  amount: number;
  transactionCost: number;
  categoryId: number;
}

interface CategoryForReports {
  id: number;
  bucketId: number;
}

interface BucketForReports {
  id: number;
  excludeFromReports: boolean;
}

interface ReportTotals {
  totalIncome: number;
  totalExpense: number;
  netTotal: number;
  transactionCount: number;
}

interface ReportTotalsComparison {
  periodKey: string;
  backup: ReportTotals;
  sqlite: ReportTotals;
  status: "pass" | "fail";
}

interface ReportTotalsMismatch {
  periodType: PeriodType;
  periodKey: string;
  field: ReportTotalsField;
  backupValue: number;
  sqliteValue: number;
}

interface ReportTotalsSection {
  comparedPeriodCount: number;
  periods: ReportTotalsComparison[];
}

interface ReportTotalsComparisonReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  scope: {
    note: string;
    excluded: string[];
  };
  rounding: {
    scale: "cents";
    decimalPlaces: 2;
    tolerance: 0;
    note: string;
  };
  dateGrouping: {
    interpretation: string;
    monthKey: "YYYY-MM";
    quarterKey: "YYYY-Qn";
    yearKey: "YYYY";
  };
  transferHandling: {
    included: true;
    note: string;
  };
  comparedMonthlyPeriodCount: number;
  comparedQuarterlyPeriodCount: number;
  comparedYearlyPeriodCount: number;
  mismatchCount: number;
  monthlyReportTotals: ReportTotalsSection;
  quarterlyReportTotals: ReportTotalsSection;
  yearlyReportTotals: ReportTotalsSection;
  mismatches: ReportTotalsMismatch[];
}

interface ReportData {
  transactions: TransactionForReports[];
  categories: CategoryForReports[];
  buckets: BucketForReports[];
}

const usage = `Usage:
  npm run compare:reports -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --output <path>                     Optional report totals comparison JSON.
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
    throw new Error(`Field ${field} must be numeric.`);
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
  throw new Error(`Field ${field} must be a date string or typed Date.`);
};

const asRequiredBoolean = (record: BackupRecord, field: string): boolean => {
  const value = record[field];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  throw new Error(`Field ${field} must be boolean.`);
};

const parseBackupData = (backupPath: string): ReportData => {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;

  if (!isPlainObject(parsed) || !isPlainObject(parsed.tables)) {
    throw new Error("Backup tables must be present.");
  }

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!Array.isArray(parsed.tables[tableName])) {
      throw new Error(`Backup table ${tableName} must be present as an array.`);
    }
  }

  const transactions = (parsed.tables.transactions as unknown[]).map((value, index) => {
    if (!isPlainObject(value)) {
      throw new Error(`Backup table transactions row ${index} must be an object.`);
    }
    return {
      date: asDateText(value, "date"),
      amount: asRequiredNumber(value, "amount"),
      transactionCost: asOptionalNumber(value, "transactionCost") ?? 0,
      categoryId: asRequiredNumber(value, "categoryId"),
    };
  });

  const categories = (parsed.tables.categories as unknown[]).map((value, index) => {
    if (!isPlainObject(value)) {
      throw new Error(`Backup table categories row ${index} must be an object.`);
    }
    return {
      id: asRequiredNumber(value, "id"),
      bucketId: asRequiredNumber(value, "bucketId"),
    };
  });

  const buckets = (parsed.tables.buckets as unknown[]).map((value, index) => {
    if (!isPlainObject(value)) {
      throw new Error(`Backup table buckets row ${index} must be an object.`);
    }
    return {
      id: asRequiredNumber(value, "id"),
      excludeFromReports: asRequiredBoolean(value, "excludeFromReports"),
    };
  });

  return { transactions, categories, buckets };
};

const readSqliteData = (db: Database.Database): ReportData => {
  assertRequiredTablesExist(db);

  const transactions = db
    .prepare("SELECT date, amount, transactionCost, categoryId FROM transactions")
    .all()
    .map((row) => {
      const record = row as BackupRecord;
      return {
        date: typeof record.date === "string" ? record.date : String(record.date ?? ""),
        amount: asRequiredNumber(record, "amount"),
        transactionCost: asOptionalNumber(record, "transactionCost") ?? 0,
        categoryId: asRequiredNumber(record, "categoryId"),
      };
    });

  const categories = db
    .prepare("SELECT id, bucketId FROM categories")
    .all()
    .map((row) => {
      const record = row as BackupRecord;
      return {
        id: asRequiredNumber(record, "id"),
        bucketId: asRequiredNumber(record, "bucketId"),
      };
    });

  const buckets = db
    .prepare("SELECT id, excludeFromReports FROM buckets")
    .all()
    .map((row) => {
      const record = row as BackupRecord;
      return {
        id: asRequiredNumber(record, "id"),
        excludeFromReports: asRequiredBoolean(record, "excludeFromReports"),
      };
    });

  return { transactions, categories, buckets };
};

const emptyTotals = (): ReportTotals => ({
  totalIncome: 0,
  totalExpense: 0,
  netTotal: 0,
  transactionCount: 0,
});

const normalizeTotals = (totals: ReportTotals): ReportTotals => ({
  totalIncome: roundCurrency(totals.totalIncome),
  totalExpense: roundCurrency(totals.totalExpense),
  netTotal: roundCurrency(totals.netTotal),
  transactionCount: totals.transactionCount,
});

const parseDate = (dateText: string): Date => {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Transaction date must be parseable.");
  }
  return date;
};

const periodKey = (periodType: PeriodType, dateText: string): string => {
  const date = parseDate(dateText);
  const year = date.getFullYear();
  const month = date.getMonth();

  if (periodType === "year") {
    return String(year);
  }

  if (periodType === "quarter") {
    return `${year}-Q${Math.floor(month / 3) + 1}`;
  }

  return `${year}-${String(month + 1).padStart(2, "0")}`;
};

const aggregateReportTotals = (data: ReportData, periodType: PeriodType): Map<string, ReportTotals> => {
  const categoryById = new Map(data.categories.map((category) => [category.id, category]));
  const incomeBucket = data.buckets.find((bucket) => bucket.excludeFromReports);
  const totalsByPeriod = new Map<string, ReportTotals>();

  for (const transaction of data.transactions) {
    const category = categoryById.get(transaction.categoryId);
    if (!category || !category.bucketId) {
      continue;
    }

    const key = periodKey(periodType, transaction.date);
    const totals = totalsByPeriod.get(key) ?? emptyTotals();
    const netAmount = transaction.amount + transaction.transactionCost;

    if (category.bucketId === incomeBucket?.id) {
      totals.totalIncome += netAmount;
    } else {
      totals.totalExpense += netAmount;
    }
    totals.netTotal = totals.totalIncome + totals.totalExpense;
    totals.transactionCount += 1;
    totalsByPeriod.set(key, totals);
  }

  return new Map([...totalsByPeriod.entries()].map(([key, totals]) => [key, normalizeTotals(totals)]));
};

const compareTotals = (
  periodType: PeriodType,
  periodKeyValue: string,
  backup: ReportTotals,
  sqlite: ReportTotals,
): ReportTotalsMismatch[] => {
  const fields: ReportTotalsField[] = ["totalIncome", "totalExpense", "netTotal", "transactionCount"];

  return fields.flatMap((field) =>
    backup[field] === sqlite[field]
      ? []
      : [
          {
            periodType,
            periodKey: periodKeyValue,
            field,
            backupValue: backup[field],
            sqliteValue: sqlite[field],
          },
        ],
  );
};

const allKeys = (left: Map<string, ReportTotals>, right: Map<string, ReportTotals>): string[] =>
  [...new Set([...left.keys(), ...right.keys()])].sort();

const buildSection = (
  periodType: PeriodType,
  backupData: ReportData,
  sqliteData: ReportData,
  mismatches: ReportTotalsMismatch[],
): ReportTotalsSection => {
  const backupTotals = aggregateReportTotals(backupData, periodType);
  const sqliteTotals = aggregateReportTotals(sqliteData, periodType);

  const periods = allKeys(backupTotals, sqliteTotals).map((key) => {
    const backup = backupTotals.get(key) ?? emptyTotals();
    const sqlite = sqliteTotals.get(key) ?? emptyTotals();
    const sectionMismatches = compareTotals(periodType, key, backup, sqlite);
    mismatches.push(...sectionMismatches);
    return {
      periodKey: key,
      backup,
      sqlite,
      status: sectionMismatches.length === 0 ? "pass" : "fail",
    } satisfies ReportTotalsComparison;
  });

  return {
    comparedPeriodCount: periods.length,
    periods,
  };
};

const buildReport = (
  backupData: ReportData,
  sqliteData: ReportData,
  backupPath: string,
  sqlitePath: string,
): ReportTotalsComparisonReport => {
  const mismatches: ReportTotalsMismatch[] = [];
  const monthlyReportTotals = buildSection("month", backupData, sqliteData, mismatches);
  const quarterlyReportTotals = buildSection("quarter", backupData, sqliteData, mismatches);
  const yearlyReportTotals = buildSection("year", backupData, sqliteData, mismatches);

  return {
    generatedAt: new Date().toISOString(),
    backupFile: basename(backupPath),
    sqliteFile: basename(sqlitePath),
    overallStatus: mismatches.length === 0 ? "pass" : "fail",
    scope: {
      note: "Compares top-level report totals only, matching the current report formula.",
      excluded: ["bucket totals", "category breakdowns", "report labels", "chart layout", "raw rows"],
    },
    rounding: {
      scale: "cents",
      decimalPlaces: 2,
      tolerance: 0,
      note: "Report totals are rounded to 2 decimals before exact comparison.",
    },
    dateGrouping: {
      interpretation: "Uses JavaScript Date local year/month/quarter grouping, matching reportService.",
      monthKey: "YYYY-MM",
      quarterKey: "YYYY-Qn",
      yearKey: "YYYY",
    },
    transferHandling: {
      included: true,
      note: "Transfers are included because current report totals aggregate normal transaction rows.",
    },
    comparedMonthlyPeriodCount: monthlyReportTotals.comparedPeriodCount,
    comparedQuarterlyPeriodCount: quarterlyReportTotals.comparedPeriodCount,
    comparedYearlyPeriodCount: yearlyReportTotals.comparedPeriodCount,
    mismatchCount: mismatches.length,
    monthlyReportTotals,
    quarterlyReportTotals,
    yearlyReportTotals,
    mismatches,
  };
};

const printSummary = (report: ReportTotalsComparisonReport, outputPath?: string): void => {
  console.log(`Report totals comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared monthly periods: ${report.comparedMonthlyPeriodCount}`);
  console.log(`Compared quarterly periods: ${report.comparedQuarterlyPeriodCount}`);
  console.log(`Compared yearly periods: ${report.comparedYearlyPeriodCount}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  if (outputPath) {
    console.log(`Report JSON: ${basename(outputPath)}`);
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

  const backupData = parseBackupData(backupPath);
  const db = openReadOnlyDatabase(sqlitePath);

  try {
    const sqliteData = readSqliteData(db);
    const report = buildReport(backupData, sqliteData, backupPath, sqlitePath);

    if (outputPath) {
      writeJsonReport(outputPath, report);
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

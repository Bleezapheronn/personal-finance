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
import { localDayKey, normalizeToLocalDay, parseLocalDay } from "./lib/dates.js";
import { roundCurrency } from "./lib/number.js";
import { writeJsonReport } from "./lib/reports.js";
import { assertRequiredTablesExist, openReadOnlyDatabase } from "./lib/sqlite.js";

const OCCURRENCE_FIELDS = [
  "budgetId",
  "budgetSnapshotId",
  "dueDateKey",
  "amountPaid",
  "effectiveTarget",
  "isExpense",
  "isCompleted",
  "linkedTransactionCount",
  "categoryId",
  "accountId",
  "recipientId",
  "frequency",
  "isGoal",
  "isFlexible",
] as const;

const DEFAULT_SAMPLE_SIZE = 20;

type Frequency = "once" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
type GoalDirection = "income" | "expense" | null;
type OccurrenceField = (typeof OCCURRENCE_FIELDS)[number];
type ComparableValue = string | number | boolean | null;

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  output?: string;
  sampleSize: number;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface BudgetRow {
  id: number;
  isActive: boolean;
}

interface BudgetSnapshotRow {
  id: number;
  budgetId: number;
  occurrenceDate: string;
  dueDate: string;
  categoryId: number;
  accountId: number | null;
  recipientId: number | null;
  amount: number;
  transactionCost: number;
  frequency: Frequency;
  isGoal: boolean;
  isFlexible: boolean;
  goalDirection: GoalDirection;
  updatedAt: string;
  sourceBudgetUpdatedAt: string;
}

interface TransactionRow {
  amount: number;
  transactionCost: number;
  occurrenceDate: string | null;
  budgetSnapshotId: number | null;
}

interface BudgetHistoryData {
  budgets: BudgetRow[];
  budgetSnapshots: BudgetSnapshotRow[];
  transactions: TransactionRow[];
}

interface SnapshotCandidate {
  snapshot: BudgetSnapshotRow;
  dueDate: Date;
  dueDateKey: string;
  amountPaid: number;
  linkedTransactionCount: number;
}

type OccurrenceSummary = Record<OccurrenceField, ComparableValue> & {
  occurrenceKey: string;
};

interface IssueSummary {
  missingLiveBudget: number;
  duplicateOccurrenceCandidates: number;
}

export interface BudgetHistorySummary {
  occurrences: OccurrenceSummary[];
  issues: IssueSummary;
}

interface OccurrenceComparison {
  occurrenceKey: string;
  backup: OccurrenceSummary;
  sqlite: OccurrenceSummary;
  status: "pass" | "fail";
}

interface BudgetHistoryMismatch {
  occurrenceKey: string;
  field: OccurrenceField | "occurrence";
  backupValue: ComparableValue | "missing";
  sqliteValue: ComparableValue | "missing";
}

export interface BudgetHistoryComparisonReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  occurrenceCountComparison: {
    backup: number;
    sqlite: number;
    status: "pass" | "fail";
  };
  comparedOccurrenceCount: number;
  mismatchCount: number;
  sourceIssueCount: number;
  sqliteIssueCount: number;
  sourceDataHasIssues: boolean;
  sqliteDataHasIssues: boolean;
  issueSummary: {
    backup: IssueSummary;
    sqlite: IssueSummary;
  };
  sampleSize: number;
  occurrenceSamples: OccurrenceComparison[];
  mismatches: BudgetHistoryMismatch[];
  scope: {
    note: string;
    excluded: string[];
  };
  dateHandling: {
    note: string;
  };
  rounding: {
    scale: "cents";
    decimalPlaces: 2;
    tolerance: 0;
    note: string;
  };
  goalDirectionHandling: {
    note: string;
  };
}

const usage = `Usage:
  npm run compare:budget-history -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--sample-size <number>] [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --sample-size <number>              Optional number of passing occurrence samples to include. Defaults to ${DEFAULT_SAMPLE_SIZE}.
  --output <path>                     Optional Budget History comparison report JSON.
  --allow-repo-output-for-tests       Allow repo-local report output only for explicit tests.
  --help                             Show this help text.
`;

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

const asRequiredNumber = (record: BackupRecord, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field ${field} must be numeric.`);
  }
  return value;
};

const asOptionalNumber = (record: BackupRecord, field: string): number | null => {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const asRequiredString = (record: BackupRecord, field: string): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Field ${field} must be a string.`);
  }
  return value;
};

const asOptionalString = (record: BackupRecord, field: string): string | null => {
  const value = record[field];
  return typeof value === "string" ? value : null;
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

const asLegacyDefaultFalseBoolean = (record: BackupRecord, field: string): boolean => {
  const value = record[field];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  throw new Error(`Field ${field} must be boolean.`);
};

const asGoalDirection = (record: BackupRecord): GoalDirection => {
  const value = record.goalDirection;
  if (value === "income" || value === "expense") {
    return value;
  }
  return null;
};

const asFrequency = (record: BackupRecord): Frequency => {
  const value = record.frequency;
  if (
    value === "once" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly" ||
    value === "custom"
  ) {
    return value;
  }
  throw new Error("Field frequency must be a known budget frequency.");
};

const asDateText = (record: BackupRecord, field: string, required = false): string | null => {
  const value = record[field];
  if (value === undefined || value === null) {
    if (required) {
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

const parseBudget = (record: BackupRecord): BudgetRow => ({
  id: asRequiredNumber(record, "id"),
  isActive: asRequiredBoolean(record, "isActive"),
});

const parseBudgetSnapshot = (record: BackupRecord): BudgetSnapshotRow => ({
  id: asRequiredNumber(record, "id"),
  budgetId: asRequiredNumber(record, "budgetId"),
  occurrenceDate: asDateText(record, "occurrenceDate", true) as string,
  dueDate: asDateText(record, "dueDate", true) as string,
  categoryId: asRequiredNumber(record, "categoryId"),
  accountId: asOptionalNumber(record, "accountId"),
  recipientId: asOptionalNumber(record, "recipientId"),
  amount: asRequiredNumber(record, "amount"),
  transactionCost: asOptionalNumber(record, "transactionCost") ?? 0,
  frequency: asFrequency(record),
  isGoal: asRequiredBoolean(record, "isGoal"),
  isFlexible: asLegacyDefaultFalseBoolean(record, "isFlexible"),
  goalDirection: asGoalDirection(record),
  updatedAt: asDateText(record, "updatedAt", true) as string,
  sourceBudgetUpdatedAt: asDateText(record, "sourceBudgetUpdatedAt", true) as string,
});

const parseTransaction = (record: BackupRecord): TransactionRow => ({
  amount: asRequiredNumber(record, "amount"),
  transactionCost: asOptionalNumber(record, "transactionCost") ?? 0,
  occurrenceDate: asDateText(record, "occurrenceDate"),
  budgetSnapshotId: asOptionalNumber(record, "budgetSnapshotId"),
});

const parseBackupData = (backupPath: string): BudgetHistoryData => {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;

  if (!isPlainObject(parsed) || !isPlainObject(parsed.tables)) {
    throw new Error("Backup tables must be present.");
  }

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!Array.isArray(parsed.tables[tableName])) {
      throw new Error(`Backup table ${tableName} must be present as an array.`);
    }
  }

  return {
    budgets: (parsed.tables.budgets as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table budgets row ${index} must be an object.`);
      }
      return parseBudget(value);
    }),
    budgetSnapshots: (parsed.tables.budgetSnapshots as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table budgetSnapshots row ${index} must be an object.`);
      }
      return parseBudgetSnapshot(value);
    }),
    transactions: (parsed.tables.transactions as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table transactions row ${index} must be an object.`);
      }
      return parseTransaction(value);
    }),
  };
};

const readSqliteData = (db: Database.Database): BudgetHistoryData => {
  assertRequiredTablesExist(db);

  return {
    budgets: db
      .prepare("SELECT id, isActive FROM budgets")
      .all()
      .map((row) => parseBudget(row as BackupRecord)),
    budgetSnapshots: db
      .prepare(
        `SELECT id, budgetId, occurrenceDate, dueDate, categoryId, accountId,
          recipientId, amount, transactionCost, frequency, isGoal, isFlexible,
          goalDirection, updatedAt, sourceBudgetUpdatedAt
        FROM budgetSnapshots`,
      )
      .all()
      .map((row) => parseBudgetSnapshot(row as BackupRecord)),
    transactions: db
      .prepare("SELECT amount, transactionCost, occurrenceDate, budgetSnapshotId FROM transactions")
      .all()
      .map((row) => parseTransaction(row as BackupRecord)),
  };
};

const linkedTransactionsForSnapshot = (
  transactions: TransactionRow[],
  snapshotId: number,
): TransactionRow[] =>
  transactions.filter((transaction) => Number(transaction.budgetSnapshotId) === snapshotId);

const linkedTransactionsForLegacyOccurrence = (
  transactions: TransactionRow[],
  occurrenceDate: Date,
): TransactionRow[] => {
  const targetTime = occurrenceDate.getTime();
  return transactions.filter(
    (transaction) =>
      transaction.budgetSnapshotId === null &&
      transaction.occurrenceDate !== null &&
      parseLocalDay(transaction.occurrenceDate).getTime() === targetTime,
  );
};

const amountPaidForTransactions = (transactions: TransactionRow[]): number =>
  transactions.reduce((sum, transaction) => sum + transaction.amount + transaction.transactionCost, 0);

const isExpenseSnapshot = (snapshot: BudgetSnapshotRow): boolean => {
  if (snapshot.goalDirection === "expense") {
    return true;
  }
  if (snapshot.goalDirection === "income") {
    return false;
  }
  return snapshot.amount < 0;
};

const effectiveTargetForSnapshot = (snapshot: BudgetSnapshotRow): number =>
  Math.abs(snapshot.amount + snapshot.transactionCost);

const createEmptyIssues = (): IssueSummary => ({
  missingLiveBudget: 0,
  duplicateOccurrenceCandidates: 0,
});

const summarizeBudgetHistory = (
  data: BudgetHistoryData,
  asOf: Date = new Date(),
): BudgetHistorySummary => {
  const budgetsById = new Map(data.budgets.map((budget) => [budget.id, budget]));
  const today = normalizeToLocalDay(asOf);
  const dedupedByDueDate = new Map<string, SnapshotCandidate>();
  const issues = createEmptyIssues();

  for (const snapshot of data.budgetSnapshots) {
    const dueDate = parseLocalDay(snapshot.dueDate);
    if (dueDate >= today) {
      continue;
    }

    const linkedTransactions = linkedTransactionsForSnapshot(data.transactions, snapshot.id);
    const fallbackTransactions =
      linkedTransactions.length === 0
        ? linkedTransactionsForLegacyOccurrence(data.transactions, parseLocalDay(snapshot.occurrenceDate))
        : [];
    const effectiveLinkedTransactions =
      linkedTransactions.length > 0 ? linkedTransactions : fallbackTransactions;
    const amountPaid = amountPaidForTransactions(effectiveLinkedTransactions);
    const key = `${snapshot.budgetId}:${dueDate.getTime()}`;
    const candidate: SnapshotCandidate = {
      snapshot,
      dueDate,
      dueDateKey: localDayKey(dueDate),
      amountPaid,
      linkedTransactionCount: effectiveLinkedTransactions.length,
    };
    const existing = dedupedByDueDate.get(key);

    if (!existing) {
      dedupedByDueDate.set(key, candidate);
      continue;
    }

    issues.duplicateOccurrenceCandidates += 1;
    const existingScore = Math.abs(existing.amountPaid);
    const candidateScore = Math.abs(candidate.amountPaid);

    if (
      candidateScore > existingScore ||
      (candidateScore === existingScore &&
        candidate.linkedTransactionCount > existing.linkedTransactionCount) ||
      (candidateScore === existingScore &&
        candidate.linkedTransactionCount === existing.linkedTransactionCount &&
        new Date(snapshot.updatedAt).getTime() >= new Date(existing.snapshot.updatedAt).getTime())
    ) {
      dedupedByDueDate.set(key, candidate);
    }
  }

  const occurrences = [...dedupedByDueDate.values()]
    .flatMap((candidate): OccurrenceSummary[] => {
      const liveBudget = budgetsById.get(candidate.snapshot.budgetId);
      if (!liveBudget) {
        issues.missingLiveBudget += 1;
        return [];
      }

      const effectiveTarget = effectiveTargetForSnapshot(candidate.snapshot);
      const isExpense = isExpenseSnapshot(candidate.snapshot);
      const isCompleted = isExpense
        ? candidate.amountPaid <= -effectiveTarget
        : candidate.amountPaid >= effectiveTarget;

      if (!liveBudget.isActive && candidate.amountPaid === 0) {
        return [];
      }

      return [
        {
          occurrenceKey:
            candidate.snapshot.id !== null
              ? `snapshot:${candidate.snapshot.id}`
              : `budget:${candidate.snapshot.budgetId}:${candidate.dueDateKey}`,
          budgetId: candidate.snapshot.budgetId,
          budgetSnapshotId: candidate.snapshot.id,
          dueDateKey: candidate.dueDateKey,
          amountPaid: roundCurrency(candidate.amountPaid),
          effectiveTarget: roundCurrency(effectiveTarget),
          isExpense,
          isCompleted,
          linkedTransactionCount: candidate.linkedTransactionCount,
          categoryId: candidate.snapshot.categoryId,
          accountId: candidate.snapshot.accountId,
          recipientId: candidate.snapshot.recipientId,
          frequency: candidate.snapshot.frequency,
          isGoal: candidate.snapshot.isGoal,
          isFlexible: candidate.snapshot.isFlexible,
        },
      ];
    })
    .sort((left, right) => {
      const dateCompare = String(right.dueDateKey).localeCompare(String(left.dueDateKey));
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return String(left.occurrenceKey).localeCompare(String(right.occurrenceKey));
    });

  return { occurrences, issues };
};

export const readSqliteBudgetHistorySummary = (
  db: Database.Database,
  asOf: Date,
): BudgetHistorySummary => summarizeBudgetHistory(readSqliteData(db), asOf);

const sumIssues = (issues: IssueSummary): number =>
  issues.missingLiveBudget + issues.duplicateOccurrenceCandidates;

const compareOccurrence = (
  occurrenceKey: string,
  backup: OccurrenceSummary | undefined,
  sqlite: OccurrenceSummary | undefined,
): BudgetHistoryMismatch[] => {
  if (!backup) {
    return [
      {
        occurrenceKey,
        field: "occurrence",
        backupValue: "missing",
        sqliteValue: sqlite?.budgetSnapshotId ?? "missing",
      },
    ];
  }

  if (!sqlite) {
    return [
      {
        occurrenceKey,
        field: "occurrence",
        backupValue: backup.budgetSnapshotId,
        sqliteValue: "missing",
      },
    ];
  }

  return OCCURRENCE_FIELDS.reduce<BudgetHistoryMismatch[]>((mismatches, field) => {
    if (backup[field] !== sqlite[field]) {
      mismatches.push({
        occurrenceKey,
        field,
        backupValue: backup[field],
        sqliteValue: sqlite[field],
      });
    }
    return mismatches;
  }, []);
};

const allOccurrenceKeys = (
  backupByKey: Map<string, OccurrenceSummary>,
  sqliteByKey: Map<string, OccurrenceSummary>,
): string[] => [...new Set([...backupByKey.keys(), ...sqliteByKey.keys()])].sort();

const buildReport = (
  backupSummary: BudgetHistorySummary,
  sqliteSummary: BudgetHistorySummary,
  backupPath: string,
  sqlitePath: string,
  sampleSize: number,
): BudgetHistoryComparisonReport => {
  const backupByKey = new Map(
    backupSummary.occurrences.map((occurrence) => [occurrence.occurrenceKey, occurrence]),
  );
  const sqliteByKey = new Map(
    sqliteSummary.occurrences.map((occurrence) => [occurrence.occurrenceKey, occurrence]),
  );
  const mismatches: BudgetHistoryMismatch[] = [];
  const occurrenceComparisons = allOccurrenceKeys(backupByKey, sqliteByKey).map((occurrenceKey) => {
    const backup = backupByKey.get(occurrenceKey);
    const sqlite = sqliteByKey.get(occurrenceKey);
    const occurrenceMismatches = compareOccurrence(occurrenceKey, backup, sqlite);
    mismatches.push(...occurrenceMismatches);
    return {
      occurrenceKey,
      backup,
      sqlite,
      status: occurrenceMismatches.length === 0 ? "pass" : "fail",
    };
  });

  const failedComparisons = occurrenceComparisons.filter(
    (comparison): comparison is OccurrenceComparison =>
      comparison.status === "fail" &&
      comparison.backup !== undefined &&
      comparison.sqlite !== undefined,
  );
  const passingComparisons = occurrenceComparisons.filter(
    (comparison): comparison is OccurrenceComparison =>
      comparison.status === "pass" &&
      comparison.backup !== undefined &&
      comparison.sqlite !== undefined,
  );
  const occurrenceSamples = [...failedComparisons, ...passingComparisons.slice(0, sampleSize)];
  const occurrenceCountsMatch =
    backupSummary.occurrences.length === sqliteSummary.occurrences.length;
  const sourceIssueCount = sumIssues(backupSummary.issues);
  const sqliteIssueCount = sumIssues(sqliteSummary.issues);

  return {
    generatedAt: new Date().toISOString(),
    backupFile: basename(backupPath),
    sqliteFile: basename(sqlitePath),
    overallStatus: mismatches.length === 0 && occurrenceCountsMatch ? "pass" : "fail",
    occurrenceCountComparison: {
      backup: backupSummary.occurrences.length,
      sqlite: sqliteSummary.occurrences.length,
      status: occurrenceCountsMatch ? "pass" : "fail",
    },
    comparedOccurrenceCount: allOccurrenceKeys(backupByKey, sqliteByKey).length,
    mismatchCount: mismatches.length + (occurrenceCountsMatch ? 0 : 1),
    sourceIssueCount,
    sqliteIssueCount,
    sourceDataHasIssues: sourceIssueCount > 0,
    sqliteDataHasIssues: sqliteIssueCount > 0,
    issueSummary: {
      backup: backupSummary.issues,
      sqlite: sqliteSummary.issues,
    },
    sampleSize,
    occurrenceSamples,
    mismatches,
    scope: {
      note: "Compares read-only Budget History occurrence summaries only.",
      excluded: ["UI grouping labels", "visual styling", "raw rows", "names", "descriptions"],
    },
    dateHandling: {
      note: "Due dates are normalized to JavaScript local-day keys before comparison, matching Budget History.",
    },
    rounding: {
      scale: "cents",
      decimalPlaces: 2,
      tolerance: 0,
      note: "amountPaid and effectiveTarget are rounded to 2 decimals before exact comparison.",
    },
    goalDirectionHandling: {
      note: 'goalDirection "expense" is expense, "income" is income, and null or missing falls back to amount sign.',
    },
  };
};

const printSummary = (report: BudgetHistoryComparisonReport, outputPath?: string): void => {
  console.log(`Budget History comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared occurrences: ${report.comparedOccurrenceCount}`);
  console.log(`Backup occurrences: ${report.occurrenceCountComparison.backup}`);
  console.log(`SQLite occurrences: ${report.occurrenceCountComparison.sqlite}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  console.log(`Source issues: ${report.sourceIssueCount}`);
  console.log(`SQLite issues: ${report.sqliteIssueCount}`);
  if (outputPath) {
    console.log(`Report JSON: ${basename(outputPath)}`);
  }
};

export const runBudgetHistoryComparison = (options: {
  backupPath: string;
  sqlitePath: string;
  outputPath?: string;
  sampleSize?: number;
}): BudgetHistoryComparisonReport => {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const backupData = parseBackupData(options.backupPath);
  const db = openReadOnlyDatabase(options.sqlitePath);

  try {
    const sqliteData = readSqliteData(db);
    const report = buildReport(
      summarizeBudgetHistory(backupData),
      summarizeBudgetHistory(sqliteData),
      options.backupPath,
      options.sqlitePath,
      sampleSize,
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
  assertOutsideRepoUnlessAllowed(
    outputPath,
    args.allowRepoOutputForTests,
    "comparison report",
  );

  const report = runBudgetHistoryComparison({
    backupPath,
    sqlitePath,
    outputPath,
    sampleSize: args.sampleSize,
  });

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

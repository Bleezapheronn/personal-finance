import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BackupRecord,
  FULL_BACKUP_TABLE_NAMES,
  FullBackupTableName,
  isPlainObject,
} from "./lib/backup.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";
import { assertRequiredTablesExist, openReadOnlyDatabase } from "./lib/sqlite.js";
type IntegrityCategory =
  | "transfer_marked_missing_pair_id"
  | "transfer_pair_missing"
  | "transfer_pair_self_reference"
  | "transfer_pair_not_reciprocal"
  | "transfer_flag_mismatch"
  | "transaction_missing_budget_snapshot"
  | "transaction_budget_snapshot_budget_mismatch"
  | "budget_snapshot_missing_budget";

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface TransactionForIntegrity {
  id?: number;
  transferPairId?: number;
  isTransfer?: boolean;
  budgetId?: number;
  budgetSnapshotId?: number;
}

interface BudgetSnapshotForIntegrity {
  id?: number;
  budgetId?: number;
}

interface IntegrityData {
  transactions: TransactionForIntegrity[];
  budgets: Array<{ id?: number }>;
  budgetSnapshots: BudgetSnapshotForIntegrity[];
}

type IntegritySummary = Record<IntegrityCategory, number>;

interface IntegrityMismatch {
  category: IntegrityCategory;
  backupCount: number;
  sqliteCount: number;
}

interface IntegrityReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  comparedCategories: number;
  mismatchCount: number;
  backupIssueCount: number;
  sqliteIssueCount: number;
  sourceDataHasIssues: boolean;
  sqliteDataHasIssues: boolean;
  transferIntegrity: {
    backup: Pick<
      IntegritySummary,
      | "transfer_marked_missing_pair_id"
      | "transfer_pair_missing"
      | "transfer_pair_self_reference"
      | "transfer_pair_not_reciprocal"
      | "transfer_flag_mismatch"
    >;
    sqlite: Pick<
      IntegritySummary,
      | "transfer_marked_missing_pair_id"
      | "transfer_pair_missing"
      | "transfer_pair_self_reference"
      | "transfer_pair_not_reciprocal"
      | "transfer_flag_mismatch"
    >;
  };
  budgetSnapshotLinkIntegrity: {
    backup: Pick<
      IntegritySummary,
      | "transaction_missing_budget_snapshot"
      | "transaction_budget_snapshot_budget_mismatch"
      | "budget_snapshot_missing_budget"
    >;
    sqlite: Pick<
      IntegritySummary,
      | "transaction_missing_budget_snapshot"
      | "transaction_budget_snapshot_budget_mismatch"
      | "budget_snapshot_missing_budget"
    >;
  };
  mismatches: IntegrityMismatch[];
}

const INTEGRITY_CATEGORIES: IntegrityCategory[] = [
  "transfer_marked_missing_pair_id",
  "transfer_pair_missing",
  "transfer_pair_self_reference",
  "transfer_pair_not_reciprocal",
  "transfer_flag_mismatch",
  "transaction_missing_budget_snapshot",
  "transaction_budget_snapshot_budget_mismatch",
  "budget_snapshot_missing_budget",
];

const TRANSFER_CATEGORIES = [
  "transfer_marked_missing_pair_id",
  "transfer_pair_missing",
  "transfer_pair_self_reference",
  "transfer_pair_not_reciprocal",
  "transfer_flag_mismatch",
] as const satisfies readonly IntegrityCategory[];

const BUDGET_SNAPSHOT_LINK_CATEGORIES = [
  "transaction_missing_budget_snapshot",
  "transaction_budget_snapshot_budget_mismatch",
  "budget_snapshot_missing_budget",
] as const satisfies readonly IntegrityCategory[];

const usage = `Usage:
  npm run compare:integrity -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --output <path>                     Optional structural integrity comparison report JSON.
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

const asOptionalNumber = (record: BackupRecord, field: string): number | undefined => {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const asOptionalBoolean = (record: BackupRecord, field: string): boolean | undefined => {
  const value = record[field];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  return undefined;
};

const parseBackup = (backupPath: string): IntegrityData => {
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
    transactions: (parsed.tables.transactions as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table transactions row ${index} must be an object.`);
      }
      return {
        id: asOptionalNumber(value, "id"),
        transferPairId: asOptionalNumber(value, "transferPairId"),
        isTransfer: asOptionalBoolean(value, "isTransfer"),
        budgetId: asOptionalNumber(value, "budgetId"),
        budgetSnapshotId: asOptionalNumber(value, "budgetSnapshotId"),
      };
    }),
    budgets: (parsed.tables.budgets as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table budgets row ${index} must be an object.`);
      }
      return { id: asOptionalNumber(value, "id") };
    }),
    budgetSnapshots: (parsed.tables.budgetSnapshots as unknown[]).map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`Backup table budgetSnapshots row ${index} must be an object.`);
      }
      return {
        id: asOptionalNumber(value, "id"),
        budgetId: asOptionalNumber(value, "budgetId"),
      };
    }),
  };
};

const readSqliteData = (db: Database.Database): IntegrityData => {
  assertRequiredTablesExist(db);

  return {
    transactions: db
      .prepare(
        "SELECT id, transferPairId, isTransfer, budgetId, budgetSnapshotId FROM transactions",
      )
      .all()
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: asOptionalNumber(record, "id"),
          transferPairId: asOptionalNumber(record, "transferPairId"),
          isTransfer: asOptionalBoolean(record, "isTransfer"),
          budgetId: asOptionalNumber(record, "budgetId"),
          budgetSnapshotId: asOptionalNumber(record, "budgetSnapshotId"),
        };
      }),
    budgets: db
      .prepare("SELECT id FROM budgets")
      .all()
      .map((row) => ({ id: asOptionalNumber(row as Record<string, unknown>, "id") })),
    budgetSnapshots: db
      .prepare("SELECT id, budgetId FROM budgetSnapshots")
      .all()
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: asOptionalNumber(record, "id"),
          budgetId: asOptionalNumber(record, "budgetId"),
        };
      }),
  };
};

const createEmptySummary = (): IntegritySummary =>
  Object.fromEntries(INTEGRITY_CATEGORIES.map((category) => [category, 0])) as IntegritySummary;

const increment = (summary: IntegritySummary, category: IntegrityCategory): void => {
  summary[category] += 1;
};

const idMap = <T extends { id?: number }>(records: T[]): Map<number, T> =>
  new Map(
    records
      .filter((record): record is T & { id: number } => record.id !== undefined)
      .map((record) => [record.id, record]),
  );

const idSet = (records: Array<{ id?: number }>): Set<number> =>
  new Set(records.map((record) => record.id).filter((id): id is number => id !== undefined));

const summarizeIntegrity = (data: IntegrityData): IntegritySummary => {
  const summary = createEmptySummary();
  const transactionsById = idMap(data.transactions);
  const budgetSnapshotById = idMap(data.budgetSnapshots);
  const budgetIds = idSet(data.budgets);

  for (const transaction of data.transactions) {
    if (transaction.isTransfer && transaction.transferPairId === undefined) {
      increment(summary, "transfer_marked_missing_pair_id");
    }

    if (transaction.transferPairId !== undefined) {
      if (transaction.id !== undefined && transaction.transferPairId === transaction.id) {
        increment(summary, "transfer_pair_self_reference");
        continue;
      }

      const pair = transactionsById.get(transaction.transferPairId);
      if (!pair) {
        increment(summary, "transfer_pair_missing");
        continue;
      }

      if (pair.transferPairId !== transaction.id) {
        increment(summary, "transfer_pair_not_reciprocal");
      }

      if (Boolean(pair.isTransfer) !== Boolean(transaction.isTransfer)) {
        increment(summary, "transfer_flag_mismatch");
      }
    }

    if (transaction.budgetSnapshotId !== undefined) {
      const snapshot = budgetSnapshotById.get(transaction.budgetSnapshotId);
      if (!snapshot) {
        increment(summary, "transaction_missing_budget_snapshot");
      } else if (
        transaction.budgetId !== undefined &&
        snapshot.budgetId !== undefined &&
        snapshot.budgetId !== transaction.budgetId
      ) {
        increment(summary, "transaction_budget_snapshot_budget_mismatch");
      }
    }
  }

  for (const snapshot of data.budgetSnapshots) {
    if (snapshot.budgetId === undefined || !budgetIds.has(snapshot.budgetId)) {
      increment(summary, "budget_snapshot_missing_budget");
    }
  }

  return summary;
};

const pickSummary = <T extends readonly IntegrityCategory[]>(
  summary: IntegritySummary,
  categories: T,
): Pick<IntegritySummary, T[number]> =>
  Object.fromEntries(categories.map((category) => [category, summary[category]])) as Pick<
    IntegritySummary,
    T[number]
  >;

const sumSummary = (summary: IntegritySummary): number =>
  INTEGRITY_CATEGORIES.reduce((total, category) => total + summary[category], 0);

const compareSummaries = (
  backupSummary: IntegritySummary,
  sqliteSummary: IntegritySummary,
): IntegrityMismatch[] =>
  INTEGRITY_CATEGORIES.flatMap((category) =>
    backupSummary[category] === sqliteSummary[category]
      ? []
      : [
          {
            category,
            backupCount: backupSummary[category],
            sqliteCount: sqliteSummary[category],
          },
        ],
  );

const buildReport = (
  backupData: IntegrityData,
  sqliteData: IntegrityData,
  backupPath: string,
  sqlitePath: string,
): IntegrityReport => {
  const backupSummary = summarizeIntegrity(backupData);
  const sqliteSummary = summarizeIntegrity(sqliteData);
  const mismatches = compareSummaries(backupSummary, sqliteSummary);
  const backupIssueCount = sumSummary(backupSummary);
  const sqliteIssueCount = sumSummary(sqliteSummary);

  return {
    generatedAt: new Date().toISOString(),
    backupFile: basename(backupPath),
    sqliteFile: basename(sqlitePath),
    overallStatus: mismatches.length === 0 ? "pass" : "fail",
    comparedCategories: INTEGRITY_CATEGORIES.length,
    mismatchCount: mismatches.length,
    backupIssueCount,
    sqliteIssueCount,
    sourceDataHasIssues: backupIssueCount > 0,
    sqliteDataHasIssues: sqliteIssueCount > 0,
    transferIntegrity: {
      backup: pickSummary(backupSummary, TRANSFER_CATEGORIES),
      sqlite: pickSummary(sqliteSummary, TRANSFER_CATEGORIES),
    },
    budgetSnapshotLinkIntegrity: {
      backup: pickSummary(backupSummary, BUDGET_SNAPSHOT_LINK_CATEGORIES),
      sqlite: pickSummary(sqliteSummary, BUDGET_SNAPSHOT_LINK_CATEGORIES),
    },
    mismatches,
  };
};

const printSummary = (report: IntegrityReport, outputPath?: string): void => {
  console.log(`Structural integrity comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared categories: ${report.comparedCategories}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  console.log(`Source issues: ${report.backupIssueCount}`);
  console.log(`SQLite issues: ${report.sqliteIssueCount}`);
  if (report.sourceDataHasIssues && report.mismatchCount === 0) {
    console.log("Note: matching source issues are still source data issues, not proof of health.");
  }
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

  const backupData = parseBackup(backupPath);
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

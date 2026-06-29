import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BackupRecord,
  BackupTables,
  FULL_BACKUP_TABLE_NAMES,
  FullBackupTableName,
  isPlainObject,
} from "./lib/backup.js";
import { isDirectRun } from "./lib/cli.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";
import { openReadOnlyDatabase, tableExists } from "./lib/sqlite.js";

interface CompareArgs {
  backup?: string;
  sqlite?: string;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface ParsedBackup {
  exportedAt?: string;
  tables: BackupTables;
  integrityCounts?: Partial<Record<FullBackupTableName, number>>;
}

interface TableCountComparison {
  table: FullBackupTableName;
  backupCount: number;
  integrityCount?: number;
  sqliteCount: number;
  status: "pass" | "fail";
}

interface CountMismatch {
  table: FullBackupTableName;
  backupCount: number;
  integrityCount?: number;
  sqliteCount: number;
}

export interface ComparisonReport {
  generatedAt: string;
  backupExportedAt?: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: "pass" | "fail";
  comparedTables: number;
  mismatchCount: number;
  tables: TableCountComparison[];
  mismatches: CountMismatch[];
}

const usage = `Usage:
  npm run compare:counts -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--output <path-to-report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --output <path>                     Optional row-count comparison report JSON.
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

const parseBackup = (backupPath: string): ParsedBackup => {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;

  if (!isPlainObject(parsed)) {
    throw new Error("Backup root must be an object.");
  }

  if (!isPlainObject(parsed.tables)) {
    throw new Error("Backup tables must be present.");
  }

  const tables: Partial<BackupTables> = {};
  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    const table = parsed.tables[tableName];
    if (!Array.isArray(table)) {
      throw new Error(`Backup table ${tableName} must be present as an array.`);
    }
    tables[tableName] = table.map((record, index) => {
      if (!isPlainObject(record)) {
        throw new Error(`Backup table ${tableName} row ${index} must be an object.`);
      }
      return record;
    });
  }

  let integrityCounts: Partial<Record<FullBackupTableName, number>> | undefined;
  if (isPlainObject(parsed.integrity) && isPlainObject(parsed.integrity.counts)) {
    integrityCounts = {};
    for (const tableName of FULL_BACKUP_TABLE_NAMES) {
      const count = parsed.integrity.counts[tableName];
      if (count !== undefined) {
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
          throw new Error(`integrity.counts.${tableName} must be a non-negative integer.`);
        }
        integrityCounts[tableName] = count;
      }
    }
  }

  return {
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : undefined,
    tables: tables as BackupTables,
    integrityCounts,
  };
};

const getSqliteCount = (db: Database.Database, tableName: FullBackupTableName): number => {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    | { count: number }
    | undefined;

  if (!row || typeof row.count !== "number") {
    throw new Error(`Could not read SQLite count for ${tableName}.`);
  }

  return row.count;
};

const compareCounts = (
  backup: ParsedBackup,
  db: Database.Database,
  backupFile: string,
  sqliteFile: string,
): ComparisonReport => {
  const tables: TableCountComparison[] = [];
  const mismatches: CountMismatch[] = [];

  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!tableExists(db, tableName)) {
      throw new Error(`SQLite table ${tableName} is missing.`);
    }

    const backupCount = backup.tables[tableName].length;
    const integrityCount = backup.integrityCounts?.[tableName];
    const sqliteCount = getSqliteCount(db, tableName);
    const status =
      backupCount === sqliteCount && (integrityCount === undefined || integrityCount === backupCount)
        ? "pass"
        : "fail";

    const comparison: TableCountComparison = {
      table: tableName,
      backupCount,
      sqliteCount,
      status,
    };

    if (integrityCount !== undefined) {
      comparison.integrityCount = integrityCount;
    }

    tables.push(comparison);

    if (status === "fail") {
      const mismatch: CountMismatch = {
        table: tableName,
        backupCount,
        sqliteCount,
      };
      if (integrityCount !== undefined) {
        mismatch.integrityCount = integrityCount;
      }
      mismatches.push(mismatch);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    backupExportedAt: backup.exportedAt,
    backupFile: basename(backupFile),
    sqliteFile: basename(sqliteFile),
    overallStatus: mismatches.length === 0 ? "pass" : "fail",
    comparedTables: FULL_BACKUP_TABLE_NAMES.length,
    mismatchCount: mismatches.length,
    tables,
    mismatches,
  };
};

const printSummary = (report: ComparisonReport, outputPath?: string): void => {
  console.log(`Row-count comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared tables: ${report.comparedTables}`);
  console.log(`Mismatches: ${report.mismatchCount}`);

  if (outputPath) {
    console.log(`Report JSON: ${basename(outputPath)}`);
  }
};

export const runRowCountComparison = (options: {
  backupPath: string;
  sqlitePath: string;
  outputPath?: string;
}): ComparisonReport => {
  const backup = parseBackup(options.backupPath);
  const db = openReadOnlyDatabase(options.sqlitePath);

  try {
    const report = compareCounts(backup, db, options.backupPath, options.sqlitePath);

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

  const report = runRowCountComparison({ backupPath, sqlitePath, outputPath });

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

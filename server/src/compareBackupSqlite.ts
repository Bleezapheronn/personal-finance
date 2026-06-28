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

type FullBackupTableName = (typeof FULL_BACKUP_TABLE_NAMES)[number];
type BackupRecord = Record<string, unknown>;
type BackupTables = Record<FullBackupTableName, BackupRecord[]>;

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

interface ComparisonReport {
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

const tableExists = (db: Database.Database, tableName: FullBackupTableName): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return row !== undefined;
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
    backupFile: path.basename(backupFile),
    sqliteFile: path.basename(sqliteFile),
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

  const backup = parseBackup(backupPath);
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  try {
    const report = compareCounts(backup, db, backupPath, sqlitePath);

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

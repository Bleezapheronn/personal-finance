import path from "node:path";
import {
  runRowCountComparison,
  type ComparisonReport as RowCountComparisonReport,
} from "./compareBackupSqlite.js";
import { runIntegrityComparison, type IntegrityReport } from "./compareIntegrity.js";
import {
  runFinancialAggregateComparison,
  type FinancialAggregateReport,
} from "./compareFinancialAggregates.js";
import {
  runReportTotalsComparison,
  type ReportTotalsComparisonReport,
} from "./compareReportTotals.js";
import {
  runTransactionSampleComparison,
  type TransactionSampleReport,
} from "./compareTransactionSamples.js";
import {
  runBudgetHistoryComparison,
  type BudgetHistoryComparisonReport,
} from "./compareBudgetHistory.js";
import { isDirectRun } from "./lib/cli.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";

type VerificationStatus = "pass" | "fail";
type ComparisonName =
  | "row_counts"
  | "structural_integrity"
  | "financial_aggregates"
  | "report_totals"
  | "transaction_samples"
  | "budget_history";

type ComparisonReport =
  | RowCountComparisonReport
  | IntegrityReport
  | FinancialAggregateReport
  | ReportTotalsComparisonReport
  | TransactionSampleReport
  | BudgetHistoryComparisonReport;

interface VerifyArgs {
  backup?: string;
  sqlite?: string;
  outputDir?: string;
  sampleSize?: number;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface VerificationResult {
  name: ComparisonName;
  label: string;
  status: VerificationStatus;
  mismatchCount: number;
  reportFile?: string;
  error?: string;
}

interface VerificationSummary {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  overallStatus: VerificationStatus;
  comparedChecks: number;
  passedChecks: number;
  failedChecks: number;
  totalMismatchCount: number;
  outputDirectory?: string;
  sampleSize?: number;
  comparisons: VerificationResult[];
  note: string;
}

interface VerificationCheck {
  name: ComparisonName;
  label: string;
  reportFileName: string;
  run: (outputPath?: string) => ComparisonReport;
}

const usage = `Usage:
  npm run verify:sqlite -- -- --backup <path-to-full-backup.json> --sqlite <path-to-disposable.sqlite> [--output-dir <path-to-report-directory>] [--sample-size <number>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database to inspect read-only.
  --output-dir <path>                 Optional directory for verification and comparison report JSON.
  --sample-size <number>              Optional sample size for transaction and Budget History comparisons.
  --allow-repo-output-for-tests       Allow repo-local output only for explicit tests.
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

const parseArgs = (argv: string[]): VerifyArgs => {
  const args: VerifyArgs = {
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

    if (arg === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sample-size") {
      args.sampleSize = parseSampleSize(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
};

const reportPath = (outputDir: string | undefined, fileName: string): string | undefined =>
  outputDir ? path.join(outputDir, fileName) : undefined;

const mismatchCount = (report: ComparisonReport): number => report.mismatchCount;

const sanitizeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const buildChecks = (
  backupPath: string,
  sqlitePath: string,
  sampleSize: number | undefined,
): VerificationCheck[] => [
  {
    name: "row_counts",
    label: "Row counts",
    reportFileName: "row-count-comparison.json",
    run: (outputPath) => runRowCountComparison({ backupPath, sqlitePath, outputPath }),
  },
  {
    name: "structural_integrity",
    label: "Structural integrity",
    reportFileName: "structural-integrity-comparison.json",
    run: (outputPath) => runIntegrityComparison({ backupPath, sqlitePath, outputPath }),
  },
  {
    name: "financial_aggregates",
    label: "Financial aggregates",
    reportFileName: "financial-aggregate-comparison.json",
    run: (outputPath) => runFinancialAggregateComparison({ backupPath, sqlitePath, outputPath }),
  },
  {
    name: "report_totals",
    label: "Report totals",
    reportFileName: "report-totals-comparison.json",
    run: (outputPath) => runReportTotalsComparison({ backupPath, sqlitePath, outputPath }),
  },
  {
    name: "transaction_samples",
    label: "Transaction samples",
    reportFileName: "transaction-sample-comparison.json",
    run: (outputPath) =>
      runTransactionSampleComparison({ backupPath, sqlitePath, outputPath, sampleSize }),
  },
  {
    name: "budget_history",
    label: "Budget History",
    reportFileName: "budget-history-comparison.json",
    run: (outputPath) =>
      runBudgetHistoryComparison({ backupPath, sqlitePath, outputPath, sampleSize }),
  },
];

const runVerification = (
  backupPath: string,
  sqlitePath: string,
  outputDir: string | undefined,
  sampleSize: number | undefined,
): VerificationSummary => {
  const results: VerificationResult[] = [];

  for (const check of buildChecks(backupPath, sqlitePath, sampleSize)) {
    const outputPath = reportPath(outputDir, check.reportFileName);
    try {
      const report = check.run(outputPath);
      results.push({
        name: check.name,
        label: check.label,
        status: report.overallStatus,
        mismatchCount: mismatchCount(report),
        reportFile: outputPath ? basename(outputPath) : undefined,
      });
    } catch (error) {
      results.push({
        name: check.name,
        label: check.label,
        status: "fail",
        mismatchCount: 1,
        reportFile: outputPath ? basename(outputPath) : undefined,
        error: sanitizeError(error),
      });
    }
  }

  const failedChecks = results.filter((result) => result.status === "fail").length;
  const totalMismatchCount = results.reduce((total, result) => total + result.mismatchCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    backupFile: basename(backupPath),
    sqliteFile: basename(sqlitePath),
    overallStatus: failedChecks === 0 ? "pass" : "fail",
    comparedChecks: results.length,
    passedChecks: results.length - failedChecks,
    failedChecks,
    totalMismatchCount,
    outputDirectory: outputDir ? basename(outputDir) : undefined,
    sampleSize,
    comparisons: results,
    note: "Verification compares disposable SQLite output to a full JSON backup. It is not migration approval, and SQLite remains disposable.",
  };
};

const printSummary = (summary: VerificationSummary): void => {
  console.log(`SQLite prototype verification: ${summary.overallStatus.toUpperCase()}`);
  for (const result of summary.comparisons) {
    const errorSuffix = result.error ? " (error)" : "";
    console.log(`  ${result.label}: ${result.status.toUpperCase()}${errorSuffix}`);
  }
  console.log(`Compared checks: ${summary.comparedChecks}`);
  console.log(`Failed checks: ${summary.failedChecks}`);
  console.log(`Total mismatches/failures: ${summary.totalMismatchCount}`);
  if (summary.outputDirectory) {
    console.log(`Report directory: ${summary.outputDirectory}`);
    console.log("Summary JSON: sqlite-verification-summary.json");
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
  const outputDir = args.outputDir ? path.resolve(args.outputDir) : undefined;

  assertFileExists(backupPath, "Backup file");
  assertFileExists(sqlitePath, "SQLite file");
  assertOutsideRepoUnlessAllowed(outputDir, args.allowRepoOutputForTests, "verification output directory");

  const summary = runVerification(backupPath, sqlitePath, outputDir, args.sampleSize);

  if (outputDir) {
    writeJsonReport(path.join(outputDir, "sqlite-verification-summary.json"), summary);
  }

  printSummary(summary);
  if (summary.overallStatus === "fail") {
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

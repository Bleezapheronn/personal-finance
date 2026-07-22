import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calculateMissingBudgetSnapshotPlan,
  localDayKey,
  type BudgetGenerationDefinition,
  type BudgetSnapshotGenerationCandidate,
  type ExistingSnapshotIdentity,
} from "../shared/budgetSnapshotGeneration.js";
import { isPlainObject } from "./lib/backup.js";
import {
  buildBudgetSnapshotGenerationPlan,
  normalizeBudgetSnapshotGenerationAsOf,
} from "./lib/budgetSnapshotGenerationDryRun.js";
import { isDirectRun } from "./lib/cli.js";
import {
  assertFileExists,
  assertOutsideRepoUnlessAllowed,
  basename,
} from "./lib/paths.js";
import { writeJsonReport } from "./lib/reports.js";
import { assertRequiredTablesExist, openReadOnlyDatabase } from "./lib/sqlite.js";

interface Args {
  backup?: string;
  sqlite?: string;
  asOf?: string;
  output?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

interface SafeMismatch {
  category: "missing_in_backup_plan" | "missing_in_sqlite_plan" | "field_mismatch";
  budgetId: number;
  occurrenceDate: string;
  fields?: string[];
}

export interface BudgetSnapshotGenerationComparisonReport {
  generatedAt: string;
  backupFile: string;
  sqliteFile: string;
  normalizedAsOf: string;
  overallStatus: "pass" | "fail";
  backupProposedCount: number;
  sqliteProposedCount: number;
  comparedOccurrenceCount: number;
  mismatchCount: number;
  backupValidationErrors: string[];
  sqliteValidationErrors: string[];
  backupConflictCount: number;
  sqliteConflictCount: number;
  mismatches: SafeMismatch[];
  tolerance: {
    generatedIdsExcluded: true;
    runtimeTimestampsExcluded: true;
    note: string;
  };
  safety: {
    readonly: true;
    rawRowsIncluded: false;
    sensitiveValuesIncluded: false;
  };
}

const usage = `Usage:
  npm run compare:budget-snapshot-generation -- -- --backup <full-backup.json> --sqlite <disposable.sqlite> --as-of <ISO date or datetime> [--output <report.json>]

Options:
  --backup <path>                     Full JSON backup file.
  --sqlite <path>                     Disposable SQLite database inspected read-only.
  --as-of <value>                     Fixed ISO date or datetime.
  --output <path>                     Optional redacted JSON report.
  --allow-repo-output-for-tests       Allow repo-local report output only for explicit tests.
  --help                              Show this help text.
`;

const parseArgs = (argv: string[]): Args => {
  const args: Args = { allowRepoOutputForTests: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
    } else if (["--backup", "--sqlite", "--as-of", "--output"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--backup") args.backup = value;
      if (arg === "--sqlite") args.sqlite = value;
      if (arg === "--as-of") args.asOf = value;
      if (arg === "--output") args.output = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const dateValue = (value: unknown, field: string): string => {
  const normalized =
    isPlainObject(value) && value.__type === "Date" ? value.value : value;
  if (typeof normalized !== "string" || Number.isNaN(new Date(normalized).getTime())) {
    throw new Error(`Backup field ${field} must be a valid date.`);
  }
  return normalized;
};

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const parseBackupPlan = (backupPath: string, asOf: Date) => {
  const root = JSON.parse(readFileSync(backupPath, "utf8")) as unknown;
  if (!isPlainObject(root) || !isPlainObject(root.tables)) {
    throw new Error("Backup tables must be present.");
  }
  if (!Array.isArray(root.tables.budgets) || !Array.isArray(root.tables.budgetSnapshots)) {
    throw new Error("Backup budgets and budgetSnapshots must be arrays.");
  }
  const budgets = root.tables.budgets.map((value, index) => {
    if (!isPlainObject(value)) throw new Error(`Backup budget ${index} must be an object.`);
    return {
      id: Number(value.id),
      description: String(value.description),
      categoryId: Number(value.categoryId),
      accountId: nullableNumber(value.accountId),
      recipientId: nullableNumber(value.recipientId),
      amount: Number(value.amount),
      transactionCost: nullableNumber(value.transactionCost),
      frequency: value.frequency,
      frequencyDetails: isPlainObject(value.frequencyDetails)
        ? value.frequencyDetails
        : null,
      isGoal: value.isGoal as boolean | number,
      isFlexible: value.isFlexible as boolean | number | null | undefined,
      goalPercentage: nullableNumber(value.goalPercentage),
      goalDirection: value.goalDirection as "income" | "expense" | null | undefined,
      isActive: value.isActive as boolean | number,
      remainingCyclesTotal: nullableNumber(value.remainingCyclesTotal),
      dueDate: dateValue(value.dueDate, "budgets.dueDate"),
      updatedAt: dateValue(value.updatedAt, "budgets.updatedAt"),
    } as BudgetGenerationDefinition;
  });
  const snapshots = root.tables.budgetSnapshots.map((value, index) => {
    if (!isPlainObject(value)) {
      throw new Error(`Backup budgetSnapshot ${index} must be an object.`);
    }
    return {
      id: Number(value.id),
      budgetId: Number(value.budgetId),
      occurrenceDate: dateValue(
        value.occurrenceDate,
        "budgetSnapshots.occurrenceDate",
      ),
      dueDate: dateValue(value.dueDate, "budgetSnapshots.dueDate"),
    } as ExistingSnapshotIdentity;
  });
  return calculateMissingBudgetSnapshotPlan({ budgets, existingSnapshots: snapshots, asOf });
};

const comparableValues = (candidate: BudgetSnapshotGenerationCandidate) => {
  const values = candidate.values;
  return {
    budgetId: values.budgetId,
    occurrenceDate: localDayKey(values.occurrenceDate),
    dueDate: localDayKey(values.dueDate),
    cycleIndex: values.cycleIndex,
    description: values.description,
    categoryId: values.categoryId,
    accountId: values.accountId ?? null,
    recipientId: values.recipientId ?? null,
    amount: values.amount,
    transactionCost: values.transactionCost ?? null,
    frequency: values.frequency,
    frequencyDetails: values.frequencyDetails ?? null,
    isGoal: values.isGoal,
    isFlexible: values.isFlexible,
    goalPercentage: values.goalPercentage ?? null,
    goalDirection: values.goalDirection ?? null,
    remainingCyclesTotal: values.remainingCyclesTotal,
    isHistorical: values.isHistorical,
    sourceBudgetUpdatedAt:
      values.sourceBudgetUpdatedAt instanceof Date
        ? values.sourceBudgetUpdatedAt.toISOString()
        : values.sourceBudgetUpdatedAt,
  };
};

const compareCandidates = (
  backupCandidates: BudgetSnapshotGenerationCandidate[],
  sqliteCandidates: BudgetSnapshotGenerationCandidate[],
): SafeMismatch[] => {
  const backup = new Map(backupCandidates.map((row) => [row.identityKey, row]));
  const sqlite = new Map(sqliteCandidates.map((row) => [row.identityKey, row]));
  const mismatches: SafeMismatch[] = [];
  const keys = [...new Set([...backup.keys(), ...sqlite.keys()])].sort();
  for (const key of keys) {
    const expected = backup.get(key);
    const actual = sqlite.get(key);
    const [budgetIdText, occurrenceDate] = key.split(":");
    const identity = { budgetId: Number(budgetIdText), occurrenceDate };
    if (!expected) {
      mismatches.push({ category: "missing_in_backup_plan", ...identity });
      continue;
    }
    if (!actual) {
      mismatches.push({ category: "missing_in_sqlite_plan", ...identity });
      continue;
    }
    const left = comparableValues(expected);
    const right = comparableValues(actual);
    const fields = Object.keys(left).filter(
      (field) =>
        JSON.stringify(left[field as keyof typeof left]) !==
        JSON.stringify(right[field as keyof typeof right]),
    );
    if (fields.length > 0) {
      mismatches.push({ category: "field_mismatch", ...identity, fields });
    }
  }
  return mismatches;
};

export const runBudgetSnapshotGenerationComparison = (options: {
  backupPath: string;
  sqlitePath: string;
  asOf: string;
  outputPath?: string;
}): BudgetSnapshotGenerationComparisonReport => {
  let asOf: Date;
  try {
    asOf = normalizeBudgetSnapshotGenerationAsOf(options.asOf);
  } catch {
    throw new Error("--as-of must be a valid ISO date or datetime.");
  }
  const backupPlan = parseBackupPlan(options.backupPath, asOf);
  const db = openReadOnlyDatabase(options.sqlitePath);
  try {
    assertRequiredTablesExist(db);
    const sqlitePlan = buildBudgetSnapshotGenerationPlan(db, asOf);
    const mismatches = compareCandidates(backupPlan.candidates, sqlitePlan.plan.candidates);
    const blocked =
      backupPlan.validationErrors.length > 0 ||
      sqlitePlan.response.validationErrors.length > 0 ||
      backupPlan.conflictCount > 0 ||
      sqlitePlan.response.conflictCount > 0;
    const report: BudgetSnapshotGenerationComparisonReport = {
      generatedAt: new Date().toISOString(),
      backupFile: basename(options.backupPath),
      sqliteFile: basename(options.sqlitePath),
      normalizedAsOf: backupPlan.normalizedAsOf,
      overallStatus: !blocked && mismatches.length === 0 ? "pass" : "fail",
      backupProposedCount: backupPlan.proposedSnapshotCount,
      sqliteProposedCount: sqlitePlan.response.proposedSnapshotCount,
      comparedOccurrenceCount: Math.max(
        backupPlan.proposedSnapshotCount,
        sqlitePlan.response.proposedSnapshotCount,
      ),
      mismatchCount: mismatches.length,
      backupValidationErrors: backupPlan.validationErrors,
      sqliteValidationErrors: sqlitePlan.response.validationErrors,
      backupConflictCount: backupPlan.conflictCount,
      sqliteConflictCount: sqlitePlan.response.conflictCount,
      mismatches,
      tolerance: {
        generatedIdsExcluded: true,
        runtimeTimestampsExcluded: true,
        note: "Generated IDs and runtime createdAt/updatedAt timestamps are intentionally excluded; every other persisted generated field is compared exactly.",
      },
      safety: {
        readonly: true,
        rawRowsIncluded: false,
        sensitiveValuesIncluded: false,
      },
    };
    if (options.outputPath) writeJsonReport(options.outputPath, report);
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
  if (!args.backup || !args.sqlite || !args.asOf) {
    console.error(usage);
    throw new Error("--backup, --sqlite, and --as-of are required.");
  }
  const backupPath = path.resolve(args.backup);
  const sqlitePath = path.resolve(args.sqlite);
  const outputPath = args.output ? path.resolve(args.output) : undefined;
  assertFileExists(backupPath, "Backup file");
  assertFileExists(sqlitePath, "SQLite file");
  assertOutsideRepoUnlessAllowed(
    outputPath,
    args.allowRepoOutputForTests,
    "snapshot generation comparison report",
  );
  const report = runBudgetSnapshotGenerationComparison({
    backupPath,
    sqlitePath,
    asOf: args.asOf,
    outputPath,
  });
  console.log(`Budget snapshot generation comparison: ${report.overallStatus.toUpperCase()}`);
  console.log(`Compared occurrences: ${report.comparedOccurrenceCount}`);
  console.log(`Mismatches: ${report.mismatchCount}`);
  if (outputPath) console.log(`Report JSON: ${basename(outputPath)}`);
  if (report.overallStatus === "fail") process.exitCode = 1;
};

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

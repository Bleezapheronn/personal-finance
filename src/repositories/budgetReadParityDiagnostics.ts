import { LocalApiError } from "../api/localApiClient";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface BudgetReadParityDiagnosticOptions {
  limit?: number;
  pageSize?: number;
  logSummary?: boolean;
}

export interface BudgetReadParityDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface BudgetReadParityDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  limit: number;
  pageSize: number;
  comparedChecks: number;
  failedChecks: number;
  dexieLoadedCount: number;
  dexiePagesLoaded: number;
  dexieTruncated: boolean;
  httpLoadedCount: number;
  httpReportedCount?: number;
  httpPagesLoaded: number;
  httpTruncated: boolean;
  baselineCountsMatch: boolean;
  parityLimitedByBaselineMismatch: boolean;
  budgetRowsParityOk: boolean;
  snapshotLinkageParityOk: boolean;
  allDexieBudgetsNormalized: boolean;
  allHttpBudgetsNormalized: boolean;
  loadedIdsMatch: boolean;
  displayOrderMatches: boolean;
  fieldMismatchCounts: Record<string, number>;
  distributionMatches: Record<BudgetDistributionField, boolean>;
  distributionMismatchCounts: Record<BudgetDistributionField, number>;
  snapshotLinkageIncluded: boolean;
  snapshotLinkageTruncated: boolean;
  snapshotCountsMatch: boolean;
  dexieSnapshotDerivedCount: number;
  dexieSnapshotLoadedCount: number;
  dexieSnapshotReportedCount?: number;
  dexieSnapshotPagesLoaded: number;
  dexieSnapshotTruncated: boolean;
  httpSnapshotLoadedCount: number;
  httpSnapshotReportedCount?: number;
  httpSnapshotPagesLoaded: number;
  httpSnapshotTruncated: boolean;
  snapshotBudgetIdDistributionMatches: boolean;
  snapshotBudgetIdDistributionDiff: SnapshotBudgetIdDistributionDiff;
  sampledDexieIds: string[];
  sampledHttpIds: string[];
  baselineNote: string;
  lifecycleNote: string;
  checks: BudgetReadParityDiagnosticCheck[];
}

type RowWithId = {
  id?: unknown;
};

type ReadListResult =
  | RowWithId[]
  | {
      count?: unknown;
      rows?: unknown;
    };

type ListReader = (options: {
  limit: number;
  offset: number;
}) => Promise<unknown>;

type Sign = "negative" | "positive" | "zero" | "missing";
type BudgetDistributionField =
  | "activeState"
  | "frequency"
  | "goalDirection"
  | "isGoal"
  | "isFlexible"
  | "categoryId"
  | "accountId"
  | "recipientId"
  | "amountSign"
  | "dueDateDayKey"
  | "targetPresence"
  | "occurrenceKind";

interface PagedLoadResult {
  rows?: RowWithId[];
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
  code?: string;
}

interface DiagnosticBudget {
  id: number;
  categoryIdKey: string;
  accountIdKey: string;
  recipientIdKey: string;
  amountSign: Sign;
  transactionCostPresence: boolean;
  frequencyKey: string;
  frequencyDetailsPresence: boolean;
  isGoal: boolean;
  isFlexible: boolean;
  goalPercentagePresence: boolean;
  goalDirectionKey: string;
  isActive: boolean;
  remainingCyclesTotalPresence: boolean;
  dueDateDayKey: string;
  targetPresence: boolean;
  occurrenceKind: "once" | "recurring";
}

interface DiagnosticSnapshotLink {
  id: number;
  budgetIdKey: string;
}

export interface SnapshotBudgetIdDistributionDiff {
  differingKeyCount: number;
  missingOnlyOnDexieKeyCount: number;
  missingOnlyOnHttpKeyCount: number;
  countDifferentKeyCount: number;
  sampledDifferingBudgetIds: string[];
}

const DEFAULT_LIMIT = 500;
const DEFAULT_SNAPSHOT_LINKAGE_LIMIT = 5000;
const DEFAULT_PAGE_SIZE = 200;
const SAMPLE_ID_LIMIT = 12;
const MISSING_KEY = "__missing__";
const BASELINE_NOTE =
  "Trust this result only when SQLite was imported from a fresh backup matching current Dexie data. Stale SQLite can produce false Budget read parity mismatches.";
const LIFECYCLE_NOTE =
  "This diagnostic uses read-only selected-read list calls only. It does not call budget snapshot generation, pruning, dedupe, repair, coverage, creation, or update helpers.";
const DISTRIBUTION_FIELDS: BudgetDistributionField[] = [
  "activeState",
  "frequency",
  "goalDirection",
  "isGoal",
  "isFlexible",
  "categoryId",
  "accountId",
  "recipientId",
  "amountSign",
  "dueDateDayKey",
  "targetPresence",
  "occurrenceKind",
];

const safeLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.trunc(limit)));
};

const safeSnapshotLinkageLimit = (limit: number): number =>
  Math.max(limit, DEFAULT_SNAPSHOT_LINKAGE_LIMIT);

const safePageSize = (pageSize: number | undefined): number => {
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.max(1, Math.min(DEFAULT_PAGE_SIZE, Math.trunc(pageSize)));
};

const rowsFromListResult = (result: ReadListResult): RowWithId[] | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.rows)) {
    return result.rows as RowWithId[];
  }

  return undefined;
};

const countFromListResult = (result: ReadListResult): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const loadPages = async (
  list: ListReader,
  maxRows: number,
  pageSize: number,
  invalidResponseCode: string,
): Promise<PagedLoadResult> => {
  const rows: RowWithId[] = [];
  let reportedCount: number | undefined;
  let pagesLoaded = 0;
  let lastPageFilled = false;

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const result = await list({ limit, offset: rows.length });
    const pageRows = rowsFromListResult(result as ReadListResult);

    if (!pageRows) {
      return {
        rows,
        reportedCount,
        pagesLoaded,
        truncated:
          reportedCount !== undefined ? rows.length < reportedCount : false,
        code: invalidResponseCode,
      };
    }

    reportedCount ??= countFromListResult(result as ReadListResult);
    pagesLoaded += 1;
    rows.push(...pageRows);
    lastPageFilled = pageRows.length === limit;

    if (pageRows.length === 0) {
      lastPageFilled = false;
      break;
    }

    if (reportedCount !== undefined && rows.length >= reportedCount) {
      break;
    }

    if (pageRows.length < limit) {
      break;
    }
  }

  return {
    rows,
    reportedCount,
    pagesLoaded,
    truncated:
      reportedCount !== undefined
        ? rows.length < reportedCount
        : rows.length >= maxRows && lastPageFilled,
  };
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const legacyDefaultFalseBoolean = (value: unknown): boolean =>
  booleanValue(value) ?? false;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const nullableNumberKey = (value: unknown): string => {
  const number = numberValue(value);
  return number === undefined ? MISSING_KEY : String(number);
};

const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

const signOf = (value: number | undefined): Sign => {
  if (value === undefined) {
    return "missing";
  }

  if (value < 0) {
    return "negative";
  }

  if (value > 0) {
    return "positive";
  }

  return "zero";
};

const dayKey = (value: unknown): string => {
  if (value === undefined || value === null) {
    return MISSING_KEY;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return MISSING_KEY;
  }

  return date.toISOString().slice(0, 10);
};

const normalizeBudget = (row: RowWithId): DiagnosticBudget | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const categoryId = numberValue(source.categoryId);
  const amount = numberValue(source.amount);
  const frequency = stringValue(source.frequency);
  const dueDateDayKey = dayKey(source.dueDate);
  const isGoal = booleanValue(source.isGoal);
  const isActive = booleanValue(source.isActive);

  if (
    id === undefined ||
    categoryId === undefined ||
    amount === undefined ||
    frequency === undefined ||
    dueDateDayKey === MISSING_KEY ||
    isGoal === undefined ||
    isActive === undefined
  ) {
    return undefined;
  }

  return {
    id,
    categoryIdKey: String(categoryId),
    accountIdKey: nullableNumberKey(source.accountId),
    recipientIdKey: nullableNumberKey(source.recipientId),
    amountSign: signOf(amount),
    transactionCostPresence: hasValue(source.transactionCost),
    frequencyKey: frequency,
    frequencyDetailsPresence: hasValue(source.frequencyDetails),
    isGoal,
    isFlexible: legacyDefaultFalseBoolean(source.isFlexible),
    goalPercentagePresence: hasValue(source.goalPercentage),
    goalDirectionKey: stringValue(source.goalDirection) ?? MISSING_KEY,
    isActive,
    remainingCyclesTotalPresence: hasValue(source.remainingCyclesTotal),
    dueDateDayKey,
    targetPresence: hasValue(source.amount) || hasValue(source.goalPercentage),
    occurrenceKind: frequency === "once" ? "once" : "recurring",
  };
};

const normalizeSnapshotLink = (
  row: RowWithId,
): DiagnosticSnapshotLink | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const budgetId = numberValue(source.budgetId);

  if (id === undefined || budgetId === undefined) {
    return undefined;
  }

  return {
    id,
    budgetIdKey: String(budgetId),
  };
};

const allIds = (rows: Array<{ id: number }>): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const sampledIds = (rows: Array<{ id: number }>): string[] =>
  allIds(rows).slice(0, SAMPLE_ID_LIMIT);

const normalizedIdSetsMatch = (
  left: Array<{ id: number }>,
  right: Array<{ id: number }>,
): boolean => {
  const leftIds = allIds(left).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );
  const rightIds = allIds(right).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );

  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const byId = (rows: DiagnosticBudget[]): Map<number, DiagnosticBudget> =>
  new Map(rows.map((row) => [row.id, row]));

const comparablePairs = (
  left: DiagnosticBudget[],
  right: DiagnosticBudget[],
): Array<[DiagnosticBudget, DiagnosticBudget]> => {
  const rightById = byId(right);
  return left.flatMap((leftRow) => {
    const rightRow = rightById.get(leftRow.id);
    return rightRow
      ? [[leftRow, rightRow] as [DiagnosticBudget, DiagnosticBudget]]
      : [];
  });
};

const increment = (counts: Record<string, number>, field: string): void => {
  counts[field] = (counts[field] ?? 0) + 1;
};

const fieldMismatchCountsForPairs = (
  pairs: Array<[DiagnosticBudget, DiagnosticBudget]>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  const fields: Array<keyof DiagnosticBudget> = [
    "categoryIdKey",
    "accountIdKey",
    "recipientIdKey",
    "amountSign",
    "transactionCostPresence",
    "frequencyKey",
    "frequencyDetailsPresence",
    "isGoal",
    "isFlexible",
    "goalPercentagePresence",
    "goalDirectionKey",
    "isActive",
    "remainingCyclesTotalPresence",
    "dueDateDayKey",
    "targetPresence",
    "occurrenceKind",
  ];

  for (const [left, right] of pairs) {
    for (const field of fields) {
      if (left[field] !== right[field]) {
        increment(counts, String(field));
      }
    }
  }

  return counts;
};

const distributionKeyForField = (
  row: DiagnosticBudget,
  field: BudgetDistributionField,
): string => {
  switch (field) {
    case "activeState":
      return String(row.isActive);
    case "frequency":
      return row.frequencyKey;
    case "goalDirection":
      return row.goalDirectionKey;
    case "isGoal":
      return String(row.isGoal);
    case "isFlexible":
      return String(row.isFlexible);
    case "categoryId":
      return row.categoryIdKey;
    case "accountId":
      return row.accountIdKey;
    case "recipientId":
      return row.recipientIdKey;
    case "amountSign":
      return row.amountSign;
    case "dueDateDayKey":
      return row.dueDateDayKey;
    case "targetPresence":
      return String(row.targetPresence);
    case "occurrenceKind":
      return row.occurrenceKind;
  }
};

const distribution = <Row>(
  rows: Row[],
  keyForRow: (row: Row) => string,
): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyForRow(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};

const distributionMismatchCount = (
  left: Map<string, number>,
  right: Map<string, number>,
): number => {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let mismatches = 0;

  for (const key of keys) {
    if ((left.get(key) ?? 0) !== (right.get(key) ?? 0)) {
      mismatches += 1;
    }
  }

  return mismatches;
};

const budgetDistribution = (
  rows: DiagnosticBudget[],
  field: BudgetDistributionField,
): Map<string, number> =>
  distribution(rows, (row) => distributionKeyForField(row, field));

const emptyDistributionBooleans = (
  value: boolean,
): Record<BudgetDistributionField, boolean> =>
  Object.fromEntries(DISTRIBUTION_FIELDS.map((field) => [field, value])) as Record<
    BudgetDistributionField,
    boolean
  >;

const emptyDistributionCounts = (): Record<BudgetDistributionField, number> =>
  Object.fromEntries(DISTRIBUTION_FIELDS.map((field) => [field, 0])) as Record<
    BudgetDistributionField,
    number
  >;

const compareBudgetDistributions = (
  left: DiagnosticBudget[],
  right: DiagnosticBudget[],
): {
  matches: Record<BudgetDistributionField, boolean>;
  mismatchCounts: Record<BudgetDistributionField, number>;
} => {
  const matches = emptyDistributionBooleans(false);
  const mismatchCounts = emptyDistributionCounts();

  for (const field of DISTRIBUTION_FIELDS) {
    const leftDistribution = budgetDistribution(left, field);
    const rightDistribution = budgetDistribution(right, field);
    const mismatchCount = distributionMismatchCount(
      leftDistribution,
      rightDistribution,
    );
    matches[field] = mismatchCount === 0;
    mismatchCounts[field] = mismatchCount;
  }

  return { matches, mismatchCounts };
};

const snapshotBudgetIdDistribution = (
  rows: DiagnosticSnapshotLink[],
): Map<string, number> => distribution(rows, (row) => row.budgetIdKey);

const EMPTY_SNAPSHOT_DISTRIBUTION_DIFF: SnapshotBudgetIdDistributionDiff = {
  differingKeyCount: 0,
  missingOnlyOnDexieKeyCount: 0,
  missingOnlyOnHttpKeyCount: 0,
  countDifferentKeyCount: 0,
  sampledDifferingBudgetIds: [],
};

const snapshotBudgetIdDistributionDiff = (
  dexie: Map<string, number>,
  http: Map<string, number>,
): SnapshotBudgetIdDistributionDiff => {
  const keys = [...new Set([...dexie.keys(), ...http.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );
  const sampledDifferingBudgetIds: string[] = [];
  let missingOnlyOnDexieKeyCount = 0;
  let missingOnlyOnHttpKeyCount = 0;
  let countDifferentKeyCount = 0;

  for (const key of keys) {
    const dexieHasKey = dexie.has(key);
    const httpHasKey = http.has(key);
    const dexieCount = dexie.get(key) ?? 0;
    const httpCount = http.get(key) ?? 0;

    if (dexieHasKey && !httpHasKey) {
      missingOnlyOnHttpKeyCount += 1;
    } else if (!dexieHasKey && httpHasKey) {
      missingOnlyOnDexieKeyCount += 1;
    } else if (dexieCount !== httpCount) {
      countDifferentKeyCount += 1;
    } else {
      continue;
    }

    if (sampledDifferingBudgetIds.length < SAMPLE_ID_LIMIT) {
      sampledDifferingBudgetIds.push(key);
    }
  }

  return {
    differingKeyCount:
      missingOnlyOnDexieKeyCount +
      missingOnlyOnHttpKeyCount +
      countDifferentKeyCount,
    missingOnlyOnDexieKeyCount,
    missingOnlyOnHttpKeyCount,
    countDifferentKeyCount,
    sampledDifferingBudgetIds,
  };
};

const pass = (name: string): BudgetReadParityDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): BudgetReadParityDiagnosticCheck => ({
  name,
  status: "fail",
  code,
});

const sanitizeErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  return "budget_read_parity_diagnostic_failed";
};

const printSummary = (result: BudgetReadParityDiagnosticResult): void => {
  console.log("Budget read parity diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Page size: ${result.pageSize}`);
  console.log(`Dexie budgets loaded: ${result.dexieLoadedCount}`);
  console.log(`HTTP budgets loaded: ${result.httpLoadedCount}`);
  console.log(`HTTP budgets truncated: ${String(result.httpTruncated)}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

const failedResult = (
  limit: number,
  pageSize: number,
  dexieLoad: PagedLoadResult,
  httpLoad: PagedLoadResult,
  dexieSnapshotLoad: PagedLoadResult,
  httpSnapshotLoad: PagedLoadResult,
  checks: BudgetReadParityDiagnosticCheck[],
): BudgetReadParityDiagnosticResult => ({
  ok: false,
  generatedAt: new Date().toISOString(),
  limit,
  pageSize,
  comparedChecks: checks.length,
  failedChecks: checks.filter((check) => check.status === "fail").length,
  dexieLoadedCount: dexieLoad.rows?.length ?? 0,
  dexiePagesLoaded: dexieLoad.pagesLoaded,
  dexieTruncated: dexieLoad.truncated,
  httpLoadedCount: httpLoad.rows?.length ?? 0,
  httpReportedCount: httpLoad.reportedCount,
  httpPagesLoaded: httpLoad.pagesLoaded,
  httpTruncated: httpLoad.truncated,
  baselineCountsMatch: false,
  parityLimitedByBaselineMismatch: true,
  budgetRowsParityOk: false,
  snapshotLinkageParityOk: false,
  allDexieBudgetsNormalized: false,
  allHttpBudgetsNormalized: false,
  loadedIdsMatch: false,
  displayOrderMatches: false,
  fieldMismatchCounts: {},
  distributionMatches: emptyDistributionBooleans(false),
  distributionMismatchCounts: emptyDistributionCounts(),
  snapshotLinkageIncluded: true,
  snapshotLinkageTruncated:
    dexieSnapshotLoad.truncated || httpSnapshotLoad.truncated,
  snapshotCountsMatch: false,
  dexieSnapshotDerivedCount: dexieSnapshotLoad.rows?.length ?? 0,
  dexieSnapshotLoadedCount: dexieSnapshotLoad.rows?.length ?? 0,
  dexieSnapshotReportedCount: dexieSnapshotLoad.reportedCount,
  dexieSnapshotPagesLoaded: dexieSnapshotLoad.pagesLoaded,
  dexieSnapshotTruncated: dexieSnapshotLoad.truncated,
  httpSnapshotLoadedCount: httpSnapshotLoad.rows?.length ?? 0,
  httpSnapshotReportedCount: httpSnapshotLoad.reportedCount,
  httpSnapshotPagesLoaded: httpSnapshotLoad.pagesLoaded,
  httpSnapshotTruncated: httpSnapshotLoad.truncated,
  snapshotBudgetIdDistributionMatches: false,
  snapshotBudgetIdDistributionDiff: EMPTY_SNAPSHOT_DISTRIBUTION_DIFF,
  sampledDexieIds: [],
  sampledHttpIds: [],
  baselineNote: BASELINE_NOTE,
  lifecycleNote: LIFECYCLE_NOTE,
  checks,
});

export const runBudgetReadParityDiagnostics = async (
  options: BudgetReadParityDiagnosticOptions = {},
): Promise<BudgetReadParityDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const snapshotLinkageLimit = safeSnapshotLinkageLimit(limit);
  const pageSize = safePageSize(options.pageSize);
  const dexieRepositories = getSelectedReadRepositoriesForBackend("dexie");
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieLoad, httpLoad, dexieSnapshotLoad, httpSnapshotLoad] =
      await Promise.all([
        loadPages(
          dexieRepositories.budgets.list,
          limit,
          pageSize,
          "invalid_dexie_budget_list_response",
        ),
        loadPages(
          httpRepositories.budgets.list,
          limit,
          pageSize,
          "invalid_http_budget_list_response",
        ),
        loadPages(
          dexieRepositories.budgetSnapshots.list,
          snapshotLinkageLimit,
          pageSize,
          "invalid_dexie_budget_snapshot_list_response",
        ),
        loadPages(
          httpRepositories.budgetSnapshots.list,
          snapshotLinkageLimit,
          pageSize,
          "invalid_http_budget_snapshot_list_response",
        ),
      ]);
    const dexieRows = dexieLoad.rows;
    const httpRows = httpLoad.rows;
    const dexieSnapshotRows = dexieSnapshotLoad.rows;
    const httpSnapshotRows = httpSnapshotLoad.rows;

    if (!dexieRows || !httpRows || !dexieSnapshotRows || !httpSnapshotRows) {
      const checks = [
        dexieRows && !dexieLoad.code
          ? pass("dexie budgets loaded")
          : fail(
              "dexie budgets loaded",
              dexieLoad.code ?? "invalid_dexie_budget_list_response",
            ),
        httpRows && !httpLoad.code
          ? pass("http budgets loaded")
          : fail(
              "http budgets loaded",
              httpLoad.code ?? "invalid_http_budget_list_response",
            ),
        dexieSnapshotRows && !dexieSnapshotLoad.code
          ? pass("dexie budget snapshots loaded")
          : fail(
              "dexie budget snapshots loaded",
              dexieSnapshotLoad.code ??
                "invalid_dexie_budget_snapshot_list_response",
            ),
        httpSnapshotRows && !httpSnapshotLoad.code
          ? pass("http budget snapshots loaded")
          : fail(
              "http budget snapshots loaded",
              httpSnapshotLoad.code ??
                "invalid_http_budget_snapshot_list_response",
            ),
      ];
      const result = failedResult(
        limit,
        pageSize,
        dexieLoad,
        httpLoad,
        dexieSnapshotLoad,
        httpSnapshotLoad,
        checks,
      );

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const dexieBudgets = dexieRows
      .map(normalizeBudget)
      .filter((row): row is DiagnosticBudget => row !== undefined);
    const httpBudgets = httpRows
      .map(normalizeBudget)
      .filter((row): row is DiagnosticBudget => row !== undefined);
    const dexieSnapshotLinks = dexieSnapshotRows
      .map(normalizeSnapshotLink)
      .filter((row): row is DiagnosticSnapshotLink => row !== undefined);
    const httpSnapshotLinks = httpSnapshotRows
      .map(normalizeSnapshotLink)
      .filter((row): row is DiagnosticSnapshotLink => row !== undefined);
    const allDexieBudgetsNormalized = dexieBudgets.length === dexieRows.length;
    const allHttpBudgetsNormalized = httpBudgets.length === httpRows.length;
    const allDexieSnapshotsNormalized =
      dexieSnapshotLinks.length === dexieSnapshotRows.length;
    const allHttpSnapshotsNormalized =
      httpSnapshotLinks.length === httpSnapshotRows.length;
    const baselineCountsMatch =
      httpLoad.reportedCount !== undefined &&
      httpLoad.reportedCount === dexieBudgets.length &&
      !dexieLoad.truncated;
    const budgetRowsComparable =
      baselineCountsMatch &&
      allDexieBudgetsNormalized &&
      allHttpBudgetsNormalized &&
      !dexieLoad.truncated &&
      !httpLoad.truncated &&
      dexieBudgets.length === httpBudgets.length;
    const comparableLoadedSets =
      budgetRowsComparable;
    const loadedIdsMatch =
      comparableLoadedSets && normalizedIdSetsMatch(dexieBudgets, httpBudgets);
    const displayOrderMatches =
      comparableLoadedSets &&
      normalizedOrderingIdsMatch(allIds(dexieBudgets), allIds(httpBudgets));
    const pairs = comparablePairs(dexieBudgets, httpBudgets);
    const fieldMismatchCounts = fieldMismatchCountsForPairs(pairs);
    const distributionComparison = compareBudgetDistributions(
      dexieBudgets,
      httpBudgets,
    );
    const dexieSnapshotDerivedCount =
      dexieSnapshotLoad.reportedCount ?? dexieSnapshotLinks.length;
    const httpSnapshotDerivedCount =
      httpSnapshotLoad.reportedCount ?? httpSnapshotLinks.length;
    const snapshotCountsMatch =
      dexieSnapshotDerivedCount === httpSnapshotDerivedCount &&
      dexieSnapshotLinks.length === dexieSnapshotDerivedCount &&
      httpSnapshotLinks.length === httpSnapshotDerivedCount;
    const snapshotLinkageTruncated =
      dexieSnapshotLoad.truncated || httpSnapshotLoad.truncated;
    const dexieSnapshotBudgetIdDistribution =
      snapshotBudgetIdDistribution(dexieSnapshotLinks);
    const httpSnapshotBudgetIdDistribution =
      snapshotBudgetIdDistribution(httpSnapshotLinks);
    const snapshotBudgetIdDiff = snapshotBudgetIdDistributionDiff(
      dexieSnapshotBudgetIdDistribution,
      httpSnapshotBudgetIdDistribution,
    );
    const snapshotBudgetIdDistributionMatches =
      !snapshotLinkageTruncated &&
      snapshotCountsMatch &&
      allDexieSnapshotsNormalized &&
      allHttpSnapshotsNormalized &&
      snapshotBudgetIdDiff.differingKeyCount === 0;
    const allDistributionMatches = DISTRIBUTION_FIELDS.every(
      (field) => distributionComparison.matches[field],
    );
    const budgetRowsParityOk =
      budgetRowsComparable &&
      loadedIdsMatch &&
      displayOrderMatches &&
      Object.keys(fieldMismatchCounts).length === 0 &&
      allDistributionMatches;
    const snapshotLinkageParityOk =
      snapshotCountsMatch &&
      !snapshotLinkageTruncated &&
      allDexieSnapshotsNormalized &&
      allHttpSnapshotsNormalized &&
      snapshotBudgetIdDistributionMatches;
    const parityLimitedByBaselineMismatch =
      !baselineCountsMatch || !snapshotCountsMatch;

    const checks: BudgetReadParityDiagnosticCheck[] = [
      allDexieBudgetsNormalized
        ? pass("dexie budgets normalized")
        : fail("dexie budgets normalized", "dexie_budget_normalization_failed"),
      allHttpBudgetsNormalized
        ? pass("http budgets normalized")
        : fail("http budgets normalized", "http_budget_normalization_failed"),
      baselineCountsMatch
        ? pass("budget counts match")
        : fail("budget counts match", "budget_baseline_count_mismatch"),
      dexieLoad.truncated
        ? fail("dexie budget list is uncapped", "dexie_budget_list_truncated")
        : pass("dexie budget list is uncapped"),
      httpLoad.truncated
        ? fail("http budget list is uncapped", "http_budget_list_truncated")
        : pass("http budget list is uncapped"),
      loadedIdsMatch
        ? pass("loaded budget ids match")
        : fail(
            "loaded budget ids match",
            comparableLoadedSets
              ? "budget_loaded_ids_mismatch"
              : "budget_loaded_ids_limited_by_baseline",
          ),
      displayOrderMatches
        ? pass("budget display order matches")
        : fail(
            "budget display order matches",
            comparableLoadedSets
              ? "budget_display_order_mismatch"
              : "budget_display_order_limited_by_baseline",
          ),
      Object.keys(fieldMismatchCounts).length === 0
        ? pass("budget safe fields match")
        : fail("budget safe fields match", "budget_safe_field_mismatch"),
      allDistributionMatches
        ? pass("budget distributions match")
        : fail("budget distributions match", "budget_distribution_mismatch"),
      budgetRowsParityOk
        ? pass("budget row parity passes")
        : fail("budget row parity passes", "budget_row_parity_failed"),
      allDexieSnapshotsNormalized
        ? pass("dexie snapshot links normalized")
        : fail(
            "dexie snapshot links normalized",
            "dexie_budget_snapshot_link_normalization_failed",
          ),
      allHttpSnapshotsNormalized
        ? pass("http snapshot links normalized")
        : fail(
            "http snapshot links normalized",
            "http_budget_snapshot_link_normalization_failed",
          ),
      snapshotCountsMatch
        ? pass("budget snapshot counts match")
        : fail(
            "budget snapshot counts match",
            "budget_snapshot_baseline_count_mismatch",
          ),
      snapshotLinkageTruncated
        ? fail("snapshot linkage fully loaded", "budget_snapshot_linkage_truncated")
        : pass("snapshot linkage fully loaded"),
      snapshotBudgetIdDistributionMatches
        ? pass("snapshot budget-id linkage distribution matches")
        : fail(
            "snapshot budget-id linkage distribution matches",
            "budget_snapshot_linkage_distribution_mismatch",
          ),
      snapshotLinkageParityOk
        ? pass("snapshot linkage parity passes")
        : fail("snapshot linkage parity passes", "budget_snapshot_linkage_failed"),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: BudgetReadParityDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      pageSize,
      comparedChecks: checks.length,
      failedChecks,
      dexieLoadedCount: dexieBudgets.length,
      dexiePagesLoaded: dexieLoad.pagesLoaded,
      dexieTruncated: dexieLoad.truncated,
      httpLoadedCount: httpBudgets.length,
      httpReportedCount: httpLoad.reportedCount,
      httpPagesLoaded: httpLoad.pagesLoaded,
      httpTruncated: httpLoad.truncated,
      baselineCountsMatch,
      parityLimitedByBaselineMismatch,
      budgetRowsParityOk,
      snapshotLinkageParityOk,
      allDexieBudgetsNormalized,
      allHttpBudgetsNormalized,
      loadedIdsMatch,
      displayOrderMatches,
      fieldMismatchCounts,
      distributionMatches: distributionComparison.matches,
      distributionMismatchCounts: distributionComparison.mismatchCounts,
      snapshotLinkageIncluded: true,
      snapshotLinkageTruncated,
      snapshotCountsMatch,
      dexieSnapshotDerivedCount,
      dexieSnapshotLoadedCount: dexieSnapshotLinks.length,
      dexieSnapshotReportedCount: dexieSnapshotLoad.reportedCount,
      dexieSnapshotPagesLoaded: dexieSnapshotLoad.pagesLoaded,
      dexieSnapshotTruncated: dexieSnapshotLoad.truncated,
      httpSnapshotLoadedCount: httpSnapshotLinks.length,
      httpSnapshotReportedCount: httpSnapshotLoad.reportedCount,
      httpSnapshotPagesLoaded: httpSnapshotLoad.pagesLoaded,
      httpSnapshotTruncated: httpSnapshotLoad.truncated,
      snapshotBudgetIdDistributionMatches,
      snapshotBudgetIdDistributionDiff: snapshotBudgetIdDiff,
      sampledDexieIds: sampledIds(dexieBudgets),
      sampledHttpIds: sampledIds(httpBudgets),
      baselineNote: BASELINE_NOTE,
      lifecycleNote: LIFECYCLE_NOTE,
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [fail("budget read parity diagnostic", sanitizeErrorCode(error))];
    const result = failedResult(
      limit,
      pageSize,
      { pagesLoaded: 0, truncated: false, rows: [] },
      { pagesLoaded: 0, truncated: false, rows: [] },
      { pagesLoaded: 0, truncated: false, rows: [] },
      { pagesLoaded: 0, truncated: false, rows: [] },
      checks,
    );

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  }
};

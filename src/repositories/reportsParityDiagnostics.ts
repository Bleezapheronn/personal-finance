import { LocalApiError } from "../api/localApiClient";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";

export interface ReportsParityDiagnosticOptions {
  limit?: number;
  pageSize?: number;
  logSummary?: boolean;
}

export interface ReportsParityDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface ReportPeriodMismatchSample {
  periodType: ReportPeriodType;
  periodKey: string;
  fields: ReportAggregateField[];
}

export interface ReportsParityDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  limit: number;
  pageSize: number;
  comparedChecks: number;
  failedChecks: number;
  dexieLoadedCount: number;
  dexieReportedCount?: number;
  dexiePagesLoaded: number;
  dexieTruncated: boolean;
  httpLoadedCount: number;
  httpReportedCount?: number;
  httpPagesLoaded: number;
  httpTruncated: boolean;
  baselineCountsMatch: boolean;
  parityLimitedByBaselineMismatch: boolean;
  periodTypesCompared: ReportPeriodType[];
  periodsCompared: Record<ReportPeriodType, number>;
  periodCountMatches: Record<ReportPeriodType, boolean>;
  periodKeyOrderMatches: Record<ReportPeriodType, boolean>;
  aggregateMismatchCounts: Record<ReportPeriodType, Record<ReportAggregateField, number>>;
  sampledMismatchingPeriodKeys: Record<ReportPeriodType, string[]>;
  mismatchSamples: ReportPeriodMismatchSample[];
  baselineNote: string;
  checks: ReportsParityDiagnosticCheck[];
}

type ReportPeriodType = "monthly" | "quarterly" | "yearly";
type ReportAggregateField =
  | "totalIncome"
  | "totalExpense"
  | "netTotal"
  | "transactionCount";

type RowWithId = {
  id?: unknown;
};

type ReadListResult =
  | RowWithId[]
  | {
      count?: unknown;
      rows?: unknown;
    };

type TransactionListReader = (options: {
  limit: number;
  offset: number;
}) => Promise<unknown>;

interface PagedLoadResult {
  rows?: RowWithId[];
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
  code?: string;
}

interface DiagnosticTransaction {
  id: number;
  categoryId: number;
  date: Date;
  netAmount: number;
}

interface DiagnosticCategory {
  id: number;
  bucketId: number;
}

interface DiagnosticBucket {
  id: number;
  excludeFromReports: boolean;
}

interface PeriodAggregate {
  periodKey: string;
  totalIncome: number;
  totalExpense: number;
  netTotal: number;
  transactionCount: number;
}

const DEFAULT_LIMIT = 5000;
const DEFAULT_PAGE_SIZE = 200;
const PERIOD_TYPES: ReportPeriodType[] = ["monthly", "quarterly", "yearly"];
const AGGREGATE_FIELDS: ReportAggregateField[] = [
  "totalIncome",
  "totalExpense",
  "netTotal",
  "transactionCount",
];
const SAMPLE_MISMATCH_LIMIT = 8;
const BASELINE_NOTE =
  "Trust this result only when SQLite was imported from a fresh backup matching current Dexie data. Stale SQLite can produce false report parity mismatches.";

const safeLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.trunc(limit)));
};

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

const loadTransactionPages = async (
  list: TransactionListReader,
  maxRows: number,
  pageSize: number,
): Promise<PagedLoadResult> => {
  const rows: RowWithId[] = [];
  let reportedCount: number | undefined;
  let pagesLoaded = 0;

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
        code: "invalid_reports_transaction_page_response",
      };
    }

    reportedCount ??= countFromListResult(result as ReadListResult);
    pagesLoaded += 1;
    rows.push(...pageRows);

    if (pageRows.length === 0) {
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
    truncated: reportedCount !== undefined ? rows.length < reportedCount : false,
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

const normalizeDate = (value: unknown): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const normalizeTransaction = (
  row: RowWithId,
): DiagnosticTransaction | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const categoryId = numberValue(source.categoryId);
  const amount = numberValue(source.amount);
  const transactionCost = numberValue(source.transactionCost) ?? 0;
  const date = normalizeDate(source.date);

  if (
    id === undefined ||
    categoryId === undefined ||
    amount === undefined ||
    date === undefined
  ) {
    return undefined;
  }

  return {
    id,
    categoryId,
    date,
    netAmount: amount + transactionCost,
  };
};

const normalizeCategory = (row: RowWithId): DiagnosticCategory | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const bucketId = numberValue(source.bucketId);

  return id === undefined || bucketId === undefined
    ? undefined
    : { id, bucketId };
};

const normalizeBucket = (row: RowWithId): DiagnosticBucket | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const excludeFromReports = booleanValue(source.excludeFromReports);

  return id === undefined || excludeFromReports === undefined
    ? undefined
    : { id, excludeFromReports };
};

const roundCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const quarterKey = (date: Date): string =>
  `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;

const yearKey = (date: Date): string => String(date.getFullYear());

const periodKeyForDate = (periodType: ReportPeriodType, date: Date): string => {
  if (periodType === "monthly") {
    return monthKey(date);
  }

  if (periodType === "quarterly") {
    return quarterKey(date);
  }

  return yearKey(date);
};

const buildPeriodAggregates = (
  rows: DiagnosticTransaction[],
  categories: DiagnosticCategory[],
  buckets: DiagnosticBucket[],
  periodType: ReportPeriodType,
): PeriodAggregate[] => {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const incomeBucketId = buckets.find((bucket) => bucket.excludeFromReports)?.id;
  const aggregates = new Map<string, PeriodAggregate>();

  for (const row of rows) {
    const category = categoryById.get(row.categoryId);
    const bucket = category ? bucketById.get(category.bucketId) : undefined;

    if (!category || !bucket) {
      continue;
    }

    const key = periodKeyForDate(periodType, row.date);
    const current =
      aggregates.get(key) ??
      {
        periodKey: key,
        totalIncome: 0,
        totalExpense: 0,
        netTotal: 0,
        transactionCount: 0,
      };

    if (bucket.id === incomeBucketId) {
      current.totalIncome += row.netAmount;
    } else {
      current.totalExpense += row.netAmount;
    }

    current.netTotal = current.totalIncome + current.totalExpense;
    current.transactionCount += 1;
    aggregates.set(key, current);
  }

  return [...aggregates.values()]
    .map((aggregate) => ({
      ...aggregate,
      totalIncome: roundCents(aggregate.totalIncome),
      totalExpense: roundCents(aggregate.totalExpense),
      netTotal: roundCents(aggregate.netTotal),
    }))
    .sort((left, right) => left.periodKey.localeCompare(right.periodKey));
};

const summarizeReports = (
  rows: DiagnosticTransaction[],
  categories: DiagnosticCategory[],
  buckets: DiagnosticBucket[],
): Record<ReportPeriodType, PeriodAggregate[]> => ({
  monthly: buildPeriodAggregates(rows, categories, buckets, "monthly"),
  quarterly: buildPeriodAggregates(rows, categories, buckets, "quarterly"),
  yearly: buildPeriodAggregates(rows, categories, buckets, "yearly"),
});

const aggregateByPeriodKey = (
  aggregates: PeriodAggregate[],
): Map<string, PeriodAggregate> =>
  new Map(aggregates.map((aggregate) => [aggregate.periodKey, aggregate]));

const emptyMismatchCounts = (): Record<ReportAggregateField, number> => ({
  totalIncome: 0,
  totalExpense: 0,
  netTotal: 0,
  transactionCount: 0,
});

const comparePeriodAggregateFields = (
  dexie: PeriodAggregate[],
  http: PeriodAggregate[],
): {
  mismatchCounts: Record<ReportAggregateField, number>;
  sampledKeys: string[];
  samples: Array<Omit<ReportPeriodMismatchSample, "periodType">>;
} => {
  const counts = emptyMismatchCounts();
  const sampledKeys = new Set<string>();
  const samples: Array<Omit<ReportPeriodMismatchSample, "periodType">> = [];
  const httpByKey = aggregateByPeriodKey(http);

  for (const dexieAggregate of dexie) {
    const httpAggregate = httpByKey.get(dexieAggregate.periodKey);
    if (!httpAggregate) {
      continue;
    }

    const fields = AGGREGATE_FIELDS.filter(
      (field) => dexieAggregate[field] !== httpAggregate[field],
    );

    if (fields.length === 0) {
      continue;
    }

    fields.forEach((field) => {
      counts[field] += 1;
    });
    sampledKeys.add(dexieAggregate.periodKey);
    samples.push({
      periodKey: dexieAggregate.periodKey,
      fields,
    });
  }

  return {
    mismatchCounts: counts,
    sampledKeys: [...sampledKeys].slice(0, SAMPLE_MISMATCH_LIMIT),
    samples: samples.slice(0, SAMPLE_MISMATCH_LIMIT),
  };
};

const keys = (aggregates: PeriodAggregate[]): string[] =>
  aggregates.map((aggregate) => aggregate.periodKey);

const arraysMatch = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((leftValue, index) => leftValue === right[index]);

const sampledPeriodKeyDifferences = (left: string[], right: string[]): string[] => {
  const differences = new Set<string>();
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }

    if (left[index] !== undefined) {
      differences.add(left[index]);
    }

    if (right[index] !== undefined) {
      differences.add(right[index]);
    }

    if (differences.size >= SAMPLE_MISMATCH_LIMIT) {
      break;
    }
  }

  return [...differences].slice(0, SAMPLE_MISMATCH_LIMIT);
};

const pass = (name: string): ReportsParityDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): ReportsParityDiagnosticCheck => ({
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

  return "reports_parity_diagnostic_failed";
};

const printSummary = (result: ReportsParityDiagnosticResult): void => {
  console.log("Reports parity diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Page size: ${result.pageSize}`);
  console.log(`Dexie loaded count: ${result.dexieLoadedCount}`);
  console.log(`HTTP loaded count: ${result.httpLoadedCount}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

const failedResult = (
  limit: number,
  pageSize: number,
  dexieLoad: PagedLoadResult,
  httpLoad: PagedLoadResult,
  checks: ReportsParityDiagnosticCheck[],
): ReportsParityDiagnosticResult => ({
  ok: false,
  generatedAt: new Date().toISOString(),
  limit,
  pageSize,
  comparedChecks: checks.length,
  failedChecks: checks.filter((check) => check.status === "fail").length,
  dexieLoadedCount: dexieLoad.rows?.length ?? 0,
  dexieReportedCount: dexieLoad.reportedCount,
  dexiePagesLoaded: dexieLoad.pagesLoaded,
  dexieTruncated: dexieLoad.truncated,
  httpLoadedCount: httpLoad.rows?.length ?? 0,
  httpReportedCount: httpLoad.reportedCount,
  httpPagesLoaded: httpLoad.pagesLoaded,
  httpTruncated: httpLoad.truncated,
  baselineCountsMatch: false,
  parityLimitedByBaselineMismatch: true,
  periodTypesCompared: PERIOD_TYPES,
  periodsCompared: { monthly: 0, quarterly: 0, yearly: 0 },
  periodCountMatches: { monthly: false, quarterly: false, yearly: false },
  periodKeyOrderMatches: { monthly: false, quarterly: false, yearly: false },
  aggregateMismatchCounts: {
    monthly: emptyMismatchCounts(),
    quarterly: emptyMismatchCounts(),
    yearly: emptyMismatchCounts(),
  },
  sampledMismatchingPeriodKeys: { monthly: [], quarterly: [], yearly: [] },
  mismatchSamples: [],
  baselineNote: BASELINE_NOTE,
  checks,
});

export const runReportsParityDiagnostics = async (
  options: ReportsParityDiagnosticOptions = {},
): Promise<ReportsParityDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const pageSize = safePageSize(options.pageSize);
  const dexieRepositories = getSelectedReadRepositoriesForBackend("dexie");
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [
      dexieCount,
      dexieLoad,
      httpLoad,
      dexieCategoriesResult,
      httpCategoriesResult,
      dexieBucketsResult,
      httpBucketsResult,
    ] = await Promise.all([
      dexieRepositories.transactions.count(),
      loadTransactionPages(dexieRepositories.transactions.list, limit, pageSize),
      loadTransactionPages(httpRepositories.transactions.list, limit, pageSize),
      dexieRepositories.categories.list(),
      httpRepositories.categories.list({ limit: DEFAULT_LIMIT, offset: 0 }),
      dexieRepositories.buckets.list(),
      httpRepositories.buckets.list({ limit: DEFAULT_LIMIT, offset: 0 }),
    ]);

    const dexieRows = dexieLoad.rows;
    const httpRows = httpLoad.rows;
    const dexieCategoriesRows = rowsFromListResult(
      dexieCategoriesResult as ReadListResult,
    );
    const httpCategoriesRows = rowsFromListResult(
      httpCategoriesResult as ReadListResult,
    );
    const dexieBucketsRows = rowsFromListResult(dexieBucketsResult as ReadListResult);
    const httpBucketsRows = rowsFromListResult(httpBucketsResult as ReadListResult);
    const dexieReportedCount = dexieLoad.reportedCount ?? dexieCount;
    const httpReportedCount = httpLoad.reportedCount;

    if (
      !dexieRows ||
      !httpRows ||
      !dexieCategoriesRows ||
      !httpCategoriesRows ||
      !dexieBucketsRows ||
      !httpBucketsRows
    ) {
      const checks = [
        dexieRows && !dexieLoad.code
          ? pass("dexie transactions loaded")
          : fail(
              "dexie transactions loaded",
              dexieLoad.code ?? "invalid_dexie_reports_transaction_response",
            ),
        httpRows && !httpLoad.code
          ? pass("http transactions loaded")
          : fail(
              "http transactions loaded",
              httpLoad.code ?? "invalid_http_reports_transaction_response",
            ),
        dexieCategoriesRows
          ? pass("dexie categories loaded")
          : fail("dexie categories loaded", "invalid_dexie_reports_category_response"),
        httpCategoriesRows
          ? pass("http categories loaded")
          : fail("http categories loaded", "invalid_http_reports_category_response"),
        dexieBucketsRows
          ? pass("dexie buckets loaded")
          : fail("dexie buckets loaded", "invalid_dexie_reports_bucket_response"),
        httpBucketsRows
          ? pass("http buckets loaded")
          : fail("http buckets loaded", "invalid_http_reports_bucket_response"),
      ];
      const result = failedResult(limit, pageSize, dexieLoad, httpLoad, checks);

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const dexieTransactions = dexieRows
      .map(normalizeTransaction)
      .filter((row): row is DiagnosticTransaction => row !== undefined);
    const httpTransactions = httpRows
      .map(normalizeTransaction)
      .filter((row): row is DiagnosticTransaction => row !== undefined);
    const dexieCategories = dexieCategoriesRows
      .map(normalizeCategory)
      .filter((row): row is DiagnosticCategory => row !== undefined);
    const httpCategories = httpCategoriesRows
      .map(normalizeCategory)
      .filter((row): row is DiagnosticCategory => row !== undefined);
    const dexieBuckets = dexieBucketsRows
      .map(normalizeBucket)
      .filter((row): row is DiagnosticBucket => row !== undefined);
    const httpBuckets = httpBucketsRows
      .map(normalizeBucket)
      .filter((row): row is DiagnosticBucket => row !== undefined);

    const allDexieRowsNormalized =
      dexieTransactions.length === dexieRows.length &&
      dexieCategories.length === dexieCategoriesRows.length &&
      dexieBuckets.length === dexieBucketsRows.length;
    const allHttpRowsNormalized =
      httpTransactions.length === httpRows.length &&
      httpCategories.length === httpCategoriesRows.length &&
      httpBuckets.length === httpBucketsRows.length;
    const baselineCountsMatch =
      httpReportedCount !== undefined && httpReportedCount === dexieReportedCount;
    const parityLimitedByBaselineMismatch = !baselineCountsMatch;
    const dexieSummary = summarizeReports(
      dexieTransactions,
      dexieCategories,
      dexieBuckets,
    );
    const httpSummary = summarizeReports(
      httpTransactions,
      httpCategories,
      httpBuckets,
    );
    const periodsCompared = {} as Record<ReportPeriodType, number>;
    const periodCountMatches = {} as Record<ReportPeriodType, boolean>;
    const periodKeyOrderMatches = {} as Record<ReportPeriodType, boolean>;
    const aggregateMismatchCounts = {} as Record<
      ReportPeriodType,
      Record<ReportAggregateField, number>
    >;
    const sampledMismatchingPeriodKeys = {} as Record<ReportPeriodType, string[]>;
    const mismatchSamples: ReportPeriodMismatchSample[] = [];

    for (const periodType of PERIOD_TYPES) {
      const dexieAggregates = dexieSummary[periodType];
      const httpAggregates = httpSummary[periodType];
      const dexieKeys = keys(dexieAggregates);
      const httpKeys = keys(httpAggregates);
      const fieldComparison = comparePeriodAggregateFields(
        dexieAggregates,
        httpAggregates,
      );
      const keyDifferenceSample = sampledPeriodKeyDifferences(
        dexieKeys,
        httpKeys,
      );

      periodsCompared[periodType] = dexieAggregates.length;
      periodCountMatches[periodType] =
        dexieAggregates.length === httpAggregates.length;
      periodKeyOrderMatches[periodType] = arraysMatch(dexieKeys, httpKeys);
      aggregateMismatchCounts[periodType] = fieldComparison.mismatchCounts;
      sampledMismatchingPeriodKeys[periodType] = [
        ...new Set([...keyDifferenceSample, ...fieldComparison.sampledKeys]),
      ].slice(0, SAMPLE_MISMATCH_LIMIT);
      mismatchSamples.push(
        ...fieldComparison.samples.map((sample) => ({
          ...sample,
          periodType,
        })),
      );
    }

    const aggregateMismatchTotal = PERIOD_TYPES.reduce(
      (total, periodType) =>
        total +
        AGGREGATE_FIELDS.reduce(
          (fieldTotal, field) =>
            fieldTotal + aggregateMismatchCounts[periodType][field],
          0,
        ),
      0,
    );
    const allPeriodCountsMatch = PERIOD_TYPES.every(
      (periodType) => periodCountMatches[periodType],
    );
    const allPeriodKeyOrdersMatch = PERIOD_TYPES.every(
      (periodType) => periodKeyOrderMatches[periodType],
    );

    const checks: ReportsParityDiagnosticCheck[] = [
      allDexieRowsNormalized
        ? pass("dexie report inputs normalized")
        : fail("dexie report inputs normalized", "dexie_reports_input_normalization_failed"),
      allHttpRowsNormalized
        ? pass("http report inputs normalized")
        : fail("http report inputs normalized", "http_reports_input_normalization_failed"),
      baselineCountsMatch
        ? pass("transaction counts match")
        : fail("transaction counts match", "reports_transaction_count_mismatch"),
      dexieLoad.truncated
        ? fail("dexie transaction list is uncapped", "dexie_reports_transaction_list_truncated")
        : pass("dexie transaction list is uncapped"),
      httpLoad.truncated
        ? fail("http transaction list is uncapped", "http_reports_transaction_list_truncated")
        : pass("http transaction list is uncapped"),
      parityLimitedByBaselineMismatch
        ? fail("baseline is fresh enough for report parity", "reports_baseline_count_mismatch")
        : pass("baseline is fresh enough for report parity"),
      allPeriodCountsMatch
        ? pass("period counts match")
        : fail("period counts match", "reports_period_count_mismatch"),
      allPeriodKeyOrdersMatch
        ? pass("period key order matches")
        : fail("period key order matches", "reports_period_key_order_mismatch"),
      aggregateMismatchTotal === 0
        ? pass("period aggregate totals match")
        : fail("period aggregate totals match", "reports_aggregate_mismatch"),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: ReportsParityDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      pageSize,
      comparedChecks: checks.length,
      failedChecks,
      dexieLoadedCount: dexieRows.length,
      dexieReportedCount,
      dexiePagesLoaded: dexieLoad.pagesLoaded,
      dexieTruncated: dexieLoad.truncated,
      httpLoadedCount: httpRows.length,
      httpReportedCount,
      httpPagesLoaded: httpLoad.pagesLoaded,
      httpTruncated: httpLoad.truncated,
      baselineCountsMatch,
      parityLimitedByBaselineMismatch,
      periodTypesCompared: PERIOD_TYPES,
      periodsCompared,
      periodCountMatches,
      periodKeyOrderMatches,
      aggregateMismatchCounts,
      sampledMismatchingPeriodKeys,
      mismatchSamples: mismatchSamples.slice(0, SAMPLE_MISMATCH_LIMIT),
      baselineNote: BASELINE_NOTE,
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [
      fail("reports parity diagnostic completed", sanitizeErrorCode(error)),
    ];
    const result = failedResult(
      limit,
      pageSize,
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

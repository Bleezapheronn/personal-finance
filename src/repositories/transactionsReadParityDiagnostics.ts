import { LocalApiError } from "../api/localApiClient";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface TransactionsReadParityDiagnosticOptions {
  limit?: number;
  pageSize?: number;
  logSummary?: boolean;
}

export interface TransactionsReadParityDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface TransactionsReadParityDiagnosticResult {
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
  allDexieRowsNormalized: boolean;
  allHttpRowsNormalized: boolean;
  loadedIdsMatch: boolean;
  displayOrderMatches: boolean;
  amountSignMismatchCount: number;
  transactionCostPresenceMismatchCount: number;
  transactionCostSignMismatchCount: number;
  transferLinkageMismatchCount: number;
  budgetSnapshotIdMismatchCount: number;
  fieldMismatchCounts: Record<string, number>;
  sampledDexieIds: string[];
  sampledHttpIds: string[];
  baselineNote: string;
  checks: TransactionsReadParityDiagnosticCheck[];
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

type Sign = "negative" | "positive" | "zero" | "missing";

interface DiagnosticTransaction {
  id: number;
  categoryId?: number;
  paymentChannelId?: number;
  accountId?: number;
  recipientId?: number;
  dateKey: string;
  amount?: number;
  amountSign: Sign;
  originalAmount?: number;
  originalCurrencyKey: string;
  exchangeRate?: number;
  transactionCost?: number;
  transactionCostPresence: boolean;
  transactionCostSign: Sign;
  transferPairId?: number;
  transferPairIdPresence: boolean;
  isTransfer: boolean;
  budgetId?: number;
  occurrenceDateKey: string;
  budgetSnapshotId?: number;
}

const DEFAULT_LIMIT = 5000;
const DEFAULT_PAGE_SIZE = 200;
const SAMPLE_ID_LIMIT = 12;
const MISSING_KEY = "__missing__";
const BASELINE_NOTE =
  "Trust this result only when SQLite was imported from a fresh backup matching current Dexie data. Count mismatch usually means SQLite was not imported from a matching fresh backup.";

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
        reportedCount,
        pagesLoaded,
        rows,
        truncated:
          reportedCount !== undefined ? rows.length < reportedCount : false,
        code: "invalid_transaction_page_response",
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

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const normalizedDateKey = (value: unknown): string => {
  if (value === undefined || value === null) {
    return MISSING_KEY;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return MISSING_KEY;
  }

  return date.toISOString();
};

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

const normalizeTransaction = (
  row: RowWithId,
): DiagnosticTransaction | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const amount = numberValue(source.amount);
  const transactionCost = numberValue(source.transactionCost);

  if (id === undefined || amount === undefined) {
    return undefined;
  }

  return {
    id,
    categoryId: numberValue(source.categoryId),
    paymentChannelId: numberValue(source.paymentChannelId),
    accountId: numberValue(source.accountId),
    recipientId: numberValue(source.recipientId),
    dateKey: normalizedDateKey(source.date),
    amount,
    amountSign: signOf(amount),
    originalAmount: numberValue(source.originalAmount),
    originalCurrencyKey: stringValue(source.originalCurrency) ?? MISSING_KEY,
    exchangeRate: numberValue(source.exchangeRate),
    transactionCost,
    transactionCostPresence: transactionCost !== undefined && transactionCost !== 0,
    transactionCostSign: signOf(transactionCost),
    transferPairId: numberValue(source.transferPairId),
    transferPairIdPresence: numberValue(source.transferPairId) !== undefined,
    isTransfer: booleanValue(source.isTransfer) === true,
    budgetId: numberValue(source.budgetId),
    occurrenceDateKey: normalizedDateKey(source.occurrenceDate),
    budgetSnapshotId: numberValue(source.budgetSnapshotId),
  };
};

const allIds = (rows: DiagnosticTransaction[]): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const sampledIds = (rows: DiagnosticTransaction[]): string[] =>
  allIds(rows).slice(0, SAMPLE_ID_LIMIT);

const normalizedIdSetsMatch = (
  left: DiagnosticTransaction[],
  right: DiagnosticTransaction[],
): boolean => {
  const leftIds = allIds(left).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );
  const rightIds = allIds(right).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );

  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const byId = (rows: DiagnosticTransaction[]): Map<number, DiagnosticTransaction> =>
  new Map(rows.map((row) => [row.id, row]));

const comparablePairs = (
  left: DiagnosticTransaction[],
  right: DiagnosticTransaction[],
): Array<[DiagnosticTransaction, DiagnosticTransaction]> => {
  const rightById = byId(right);
  return left.flatMap((leftRow) => {
    const rightRow = rightById.get(leftRow.id);
    return rightRow ? [[leftRow, rightRow] as [DiagnosticTransaction, DiagnosticTransaction]] : [];
  });
};

const increment = (counts: Record<string, number>, field: string): void => {
  counts[field] = (counts[field] ?? 0) + 1;
};

const compareField = <Key extends keyof DiagnosticTransaction>(
  counts: Record<string, number>,
  field: Key,
  left: DiagnosticTransaction,
  right: DiagnosticTransaction,
): void => {
  if (left[field] !== right[field]) {
    increment(counts, String(field));
  }
};

const fieldMismatchCountsForPairs = (
  pairs: Array<[DiagnosticTransaction, DiagnosticTransaction]>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  const fields: Array<keyof DiagnosticTransaction> = [
    "categoryId",
    "paymentChannelId",
    "accountId",
    "recipientId",
    "dateKey",
    "amount",
    "amountSign",
    "originalAmount",
    "originalCurrencyKey",
    "exchangeRate",
    "transactionCost",
    "transactionCostPresence",
    "transactionCostSign",
    "transferPairId",
    "transferPairIdPresence",
    "isTransfer",
    "budgetId",
    "occurrenceDateKey",
    "budgetSnapshotId",
  ];

  for (const [left, right] of pairs) {
    for (const field of fields) {
      compareField(counts, field, left, right);
    }
  }

  return counts;
};

const fieldMismatchCount = (
  pairs: Array<[DiagnosticTransaction, DiagnosticTransaction]>,
  field: keyof DiagnosticTransaction,
): number => pairs.filter(([left, right]) => left[field] !== right[field]).length;

const transferLinkageIssueCount = (rows: DiagnosticTransaction[]): number => {
  const rowById = byId(rows);
  let issues = 0;

  for (const row of rows) {
    if (!row.transferPairIdPresence && !row.isTransfer) {
      continue;
    }

    if (!row.transferPairId || row.transferPairId === row.id) {
      issues += 1;
      continue;
    }

    const paired = rowById.get(row.transferPairId);
    if (!paired) {
      issues += 1;
      continue;
    }

    if (paired.transferPairId !== row.id || paired.isTransfer !== row.isTransfer) {
      issues += 1;
    }
  }

  return issues;
};

const pass = (name: string): TransactionsReadParityDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): TransactionsReadParityDiagnosticCheck => ({
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

  return "transactions_read_parity_diagnostic_failed";
};

const printSummary = (result: TransactionsReadParityDiagnosticResult): void => {
  console.log("Transactions read parity diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Page size: ${result.pageSize}`);
  console.log(`Dexie loaded count: ${result.dexieLoadedCount}`);
  console.log(`Dexie pages loaded: ${result.dexiePagesLoaded}`);
  console.log(`HTTP loaded count: ${result.httpLoadedCount}`);
  console.log(`HTTP pages loaded: ${result.httpPagesLoaded}`);
  console.log(`HTTP truncated: ${String(result.httpTruncated)}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runTransactionsReadParityDiagnostics = async (
  options: TransactionsReadParityDiagnosticOptions = {},
): Promise<TransactionsReadParityDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const pageSize = safePageSize(options.pageSize);
  const dexieRepositories = getSelectedReadRepositoriesForBackend("dexie");
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieCount, dexieLoad, httpLoad] = await Promise.all([
      dexieRepositories.transactions.count(),
      loadTransactionPages(dexieRepositories.transactions.list, limit, pageSize),
      loadTransactionPages(httpRepositories.transactions.list, limit, pageSize),
    ]);
    const dexieRows = dexieLoad.rows;
    const httpRows = httpLoad.rows;
    const dexieReportedCount = dexieLoad.reportedCount ?? dexieCount;
    const httpReportedCount = httpLoad.reportedCount;

    if (!dexieRows || !httpRows) {
      const checks = [
        dexieRows && !dexieLoad.code
          ? pass("dexie transactions loaded")
          : fail(
              "dexie transactions loaded",
              dexieLoad.code ?? "invalid_dexie_transaction_list_response",
            ),
        httpRows && !httpLoad.code
          ? pass("http transactions loaded")
          : fail(
              "http transactions loaded",
              httpLoad.code ?? "invalid_http_transaction_list_response",
            ),
      ];
      const failedChecks = checks.filter((check) => check.status === "fail").length;
      const result: TransactionsReadParityDiagnosticResult = {
        ok: false,
        generatedAt: new Date().toISOString(),
        limit,
        pageSize,
        comparedChecks: checks.length,
        failedChecks,
        dexieLoadedCount: dexieRows?.length ?? 0,
        dexieReportedCount,
        dexiePagesLoaded: dexieLoad.pagesLoaded,
        dexieTruncated: dexieLoad.truncated,
        httpLoadedCount: httpRows?.length ?? 0,
        httpReportedCount,
        httpPagesLoaded: httpLoad.pagesLoaded,
        httpTruncated: httpLoad.truncated,
        baselineCountsMatch: false,
        parityLimitedByBaselineMismatch: true,
        allDexieRowsNormalized: false,
        allHttpRowsNormalized: false,
        loadedIdsMatch: false,
        displayOrderMatches: false,
        amountSignMismatchCount: 0,
        transactionCostPresenceMismatchCount: 0,
        transactionCostSignMismatchCount: 0,
        transferLinkageMismatchCount: 0,
        budgetSnapshotIdMismatchCount: 0,
        fieldMismatchCounts: {},
        sampledDexieIds: [],
        sampledHttpIds: [],
        baselineNote: BASELINE_NOTE,
        checks,
      };

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
    const allDexieRowsNormalized = dexieTransactions.length === dexieRows.length;
    const allHttpRowsNormalized = httpTransactions.length === httpRows.length;
    const baselineCountsMatch =
      httpReportedCount !== undefined && httpReportedCount === dexieReportedCount;
    const parityLimitedByBaselineMismatch = !baselineCountsMatch;
    const httpTruncated = httpLoad.truncated;
    const pairs = comparablePairs(dexieTransactions, httpTransactions);
    const fieldMismatchCounts = fieldMismatchCountsForPairs(pairs);
    const comparableLoadedSets =
      baselineCountsMatch &&
      !dexieLoad.truncated &&
      !httpLoad.truncated &&
      dexieTransactions.length === httpTransactions.length;
    const loadedIdsMatch =
      comparableLoadedSets && normalizedIdSetsMatch(dexieTransactions, httpTransactions);
    const displayOrderMatches =
      comparableLoadedSets &&
      normalizedOrderingIdsMatch(allIds(dexieTransactions), allIds(httpTransactions));
    const dexieTransferLinkageIssues = transferLinkageIssueCount(dexieTransactions);
    const httpTransferLinkageIssues = transferLinkageIssueCount(httpTransactions);
    const transferLinkageMismatchCount = Math.abs(
      dexieTransferLinkageIssues - httpTransferLinkageIssues,
    );
    const amountSignMismatchCount = fieldMismatchCount(pairs, "amountSign");
    const transactionCostPresenceMismatchCount = fieldMismatchCount(
      pairs,
      "transactionCostPresence",
    );
    const transactionCostSignMismatchCount = fieldMismatchCount(
      pairs,
      "transactionCostSign",
    );
    const budgetSnapshotIdMismatchCount = fieldMismatchCount(
      pairs,
      "budgetSnapshotId",
    );
    const comparableRowCountMatches = pairs.length === dexieTransactions.length;

    const checks: TransactionsReadParityDiagnosticCheck[] = [
      allDexieRowsNormalized
        ? pass("dexie transactions normalized")
        : fail("dexie transactions normalized", "dexie_transaction_normalization_failed"),
      pass("http transactions loaded"),
      allHttpRowsNormalized
        ? pass("http transactions normalized")
        : fail("http transactions normalized", "http_transaction_normalization_failed"),
      baselineCountsMatch
        ? pass("transaction counts match")
        : fail("transaction counts match", "transaction_baseline_count_mismatch"),
      dexieLoad.truncated
        ? fail("dexie transaction list is uncapped", "dexie_transaction_list_truncated")
        : pass("dexie transaction list is uncapped"),
      httpTruncated
        ? fail("http transaction list is uncapped", "http_transaction_list_truncated")
        : pass("http transaction list is uncapped"),
      parityLimitedByBaselineMismatch
        ? fail(
            "baseline is fresh enough for row parity",
            "transaction_baseline_count_mismatch",
          )
        : pass("baseline is fresh enough for row parity"),
      loadedIdsMatch
        ? pass("loaded transaction ids match")
        : fail(
            "loaded transaction ids match",
            comparableLoadedSets
              ? "transaction_loaded_ids_mismatch"
              : "transaction_loaded_ids_limited_by_baseline",
          ),
      displayOrderMatches
        ? pass("transaction display order matches")
        : fail(
            "transaction display order matches",
            comparableLoadedSets
              ? "transaction_display_order_mismatch"
              : "transaction_display_order_limited_by_baseline",
          ),
      comparableRowCountMatches
        ? pass("matched transaction rows comparable")
        : fail(
            "matched transaction rows comparable",
            parityLimitedByBaselineMismatch
              ? "transaction_comparable_rows_limited_by_baseline"
              : "transaction_comparable_rows_mismatch",
          ),
      Object.keys(fieldMismatchCounts).length === 0
        ? pass("transaction fields match")
        : fail("transaction fields match", "transaction_field_mismatch"),
      amountSignMismatchCount === 0
        ? pass("amount signs match")
        : fail("amount signs match", "transaction_amount_sign_mismatch"),
      transactionCostPresenceMismatchCount === 0
        ? pass("transaction cost presence matches")
        : fail(
            "transaction cost presence matches",
            "transaction_cost_presence_mismatch",
          ),
      transactionCostSignMismatchCount === 0
        ? pass("transaction cost signs match")
        : fail("transaction cost signs match", "transaction_cost_sign_mismatch"),
      transferLinkageMismatchCount === 0
        ? pass("transfer linkage issue counts match")
        : fail("transfer linkage issue counts match", "transfer_linkage_mismatch"),
      budgetSnapshotIdMismatchCount === 0
        ? pass("budget snapshot links match")
        : fail(
            "budget snapshot links match",
            "transaction_budget_snapshot_id_mismatch",
          ),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: TransactionsReadParityDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      pageSize,
      comparedChecks: checks.length,
      failedChecks,
      dexieLoadedCount: dexieTransactions.length,
      dexieReportedCount,
      dexiePagesLoaded: dexieLoad.pagesLoaded,
      dexieTruncated: dexieLoad.truncated,
      httpLoadedCount: httpTransactions.length,
      httpReportedCount,
      httpPagesLoaded: httpLoad.pagesLoaded,
      httpTruncated,
      baselineCountsMatch,
      parityLimitedByBaselineMismatch,
      allDexieRowsNormalized,
      allHttpRowsNormalized,
      loadedIdsMatch,
      displayOrderMatches,
      amountSignMismatchCount,
      transactionCostPresenceMismatchCount,
      transactionCostSignMismatchCount,
      transferLinkageMismatchCount,
      budgetSnapshotIdMismatchCount,
      fieldMismatchCounts,
      sampledDexieIds: sampledIds(dexieTransactions),
      sampledHttpIds: sampledIds(httpTransactions),
      baselineNote: BASELINE_NOTE,
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [
      fail("transactions read parity diagnostic", sanitizeErrorCode(error)),
    ];
    const result: TransactionsReadParityDiagnosticResult = {
      ok: false,
      generatedAt: new Date().toISOString(),
      limit,
      pageSize,
      comparedChecks: checks.length,
      failedChecks: checks.length,
      dexieLoadedCount: 0,
      dexiePagesLoaded: 0,
      dexieTruncated: false,
      httpLoadedCount: 0,
      httpPagesLoaded: 0,
      httpTruncated: false,
      baselineCountsMatch: false,
      parityLimitedByBaselineMismatch: true,
      allDexieRowsNormalized: false,
      allHttpRowsNormalized: false,
      loadedIdsMatch: false,
      displayOrderMatches: false,
      amountSignMismatchCount: 0,
      transactionCostPresenceMismatchCount: 0,
      transactionCostSignMismatchCount: 0,
      transferLinkageMismatchCount: 0,
      budgetSnapshotIdMismatchCount: 0,
      fieldMismatchCounts: {},
      sampledDexieIds: [],
      sampledHttpIds: [],
      baselineNote: BASELINE_NOTE,
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  }
};

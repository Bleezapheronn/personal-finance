import { LocalApiError } from "../api/localApiClient";
import type { Account } from "../db";
import * as accountRepository from "./accountRepository";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface AccountsReadExperimentDiagnosticOptions {
  limit?: number;
  logSummary?: boolean;
}

export interface AccountsReadExperimentDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface AccountsReadExperimentDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  limit: number;
  comparedChecks: number;
  failedChecks: number;
  dexieDerivedCount: number;
  dexieLoadedCount: number;
  httpReportedCount?: number;
  httpLoadedCount: number;
  httpTruncated: boolean;
  allHttpRowsNormalized: boolean;
  loadedIdsMatch: boolean;
  displayOrderMatches: boolean;
  activeStateCountsMatch: boolean;
  creditStateCountsMatch: boolean;
  currencyDistributionMatches: boolean;
  imagePresenceCountsMatch: boolean;
  imagePresenceLimitation: boolean;
  creditLimitPresenceCountsMatch: boolean;
  warningCodes: string[];
  dexieActiveCount: number;
  httpActiveCount: number;
  dexieCreditCount: number;
  httpCreditCount: number;
  dexieCurrencyKeyCount: number;
  httpCurrencyKeyCount: number;
  dexieImagePresenceCount: number;
  httpImagePresenceCount: number;
  dexieCreditLimitPresenceCount: number;
  httpCreditLimitPresenceCount: number;
  sampledDexieIds: string[];
  sampledHttpIds: string[];
  checks: AccountsReadExperimentDiagnosticCheck[];
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

interface DiagnosticAccount {
  id: number;
  isActive: boolean;
  isCredit: boolean;
  currencyKey: string;
  hasImage: boolean;
  hasCreditLimit: boolean;
}

const DEFAULT_LIMIT = 500;
const SAMPLE_ID_LIMIT = 12;

const safeLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.trunc(limit)));
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

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

const normalizeCurrencyKey = (value: unknown): string =>
  stringValue(value)?.trim() || "__missing__";

const normalizeAccount = (row: RowWithId): DiagnosticAccount | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const isActive = booleanValue(source.isActive);

  if (id === undefined || typeof source.name !== "string" || isActive === undefined) {
    return undefined;
  }

  return {
    id,
    isActive,
    isCredit: booleanValue(source.isCredit) === true,
    currencyKey: normalizeCurrencyKey(source.currency),
    hasImage: hasValue(source.imageBlob) || hasValue(source.imageMimeType),
    hasCreditLimit: hasValue(source.creditLimit),
  };
};

const dexieAccountForDiagnostic = (
  account: Account,
): DiagnosticAccount | undefined => {
  if (typeof account.id !== "number" || !Number.isFinite(account.id)) {
    return undefined;
  }

  return {
    id: account.id,
    isActive: account.isActive !== false,
    isCredit: account.isCredit === true,
    currencyKey: normalizeCurrencyKey(account.currency),
    hasImage: hasValue(account.imageBlob),
    hasCreditLimit: hasValue(account.creditLimit),
  };
};

const allIds = (rows: DiagnosticAccount[]): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const sampledIds = (rows: DiagnosticAccount[]): string[] =>
  allIds(rows).slice(0, SAMPLE_ID_LIMIT);

const normalizedIdSetsMatch = (
  left: DiagnosticAccount[],
  right: DiagnosticAccount[],
): boolean => {
  const leftIds = allIds(left).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );
  const rightIds = allIds(right).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );

  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const pageDisplayOrder = (rows: DiagnosticAccount[]): DiagnosticAccount[] =>
  [...rows].sort((left, right) => left.id - right.id);

const activeCount = (rows: DiagnosticAccount[]): number =>
  rows.filter((row) => row.isActive !== false).length;

const creditCount = (rows: DiagnosticAccount[]): number =>
  rows.filter((row) => row.isCredit === true).length;

const imagePresenceCount = (rows: DiagnosticAccount[]): number =>
  rows.filter((row) => row.hasImage).length;

const creditLimitPresenceCount = (rows: DiagnosticAccount[]): number =>
  rows.filter((row) => row.hasCreditLimit).length;

const currencyDistribution = (rows: DiagnosticAccount[]): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.currencyKey, (counts.get(row.currencyKey) ?? 0) + 1);
  }

  return counts;
};

const mapsMatch = (left: Map<string, number>, right: Map<string, number>) =>
  left.size === right.size &&
  Array.from(left.entries()).every(([key, value]) => right.get(key) === value);

const pass = (name: string): AccountsReadExperimentDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): AccountsReadExperimentDiagnosticCheck => ({
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

  return "accounts_read_experiment_diagnostic_failed";
};

const printSummary = (
  result: AccountsReadExperimentDiagnosticResult,
): void => {
  console.log("Accounts read experiment diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Dexie loaded count: ${result.dexieLoadedCount}`);
  console.log(`HTTP loaded count: ${result.httpLoadedCount}`);
  console.log(`HTTP truncated: ${String(result.httpTruncated)}`);
  if (result.warningCodes.length > 0) {
    console.log(`Warnings: ${result.warningCodes.join(", ")}`);
  }
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runAccountsReadExperimentDiagnostics = async (
  options: AccountsReadExperimentDiagnosticOptions = {},
): Promise<AccountsReadExperimentDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieRows, httpResult] = await Promise.all([
      accountRepository.listAccounts(),
      httpRepositories.accounts.list({ limit, offset: 0 }),
    ]);
    const dexieAccounts = dexieRows
      .map(dexieAccountForDiagnostic)
      .filter((row): row is DiagnosticAccount => row !== undefined);
    const httpRows = rowsFromListResult(httpResult as ReadListResult);
    const httpReportedCount = countFromListResult(httpResult as ReadListResult);

    if (!httpRows) {
      const checks = [
        pass("dexie accounts loaded"),
        fail("http accounts loaded", "invalid_http_account_list_response"),
      ];
      const dexieDisplayRows = pageDisplayOrder(dexieAccounts);
      const result: AccountsReadExperimentDiagnosticResult = {
        ok: false,
        generatedAt: new Date().toISOString(),
        limit,
        comparedChecks: checks.length,
        failedChecks: 1,
        dexieDerivedCount: dexieRows.length,
        dexieLoadedCount: dexieAccounts.length,
        httpReportedCount,
        httpLoadedCount: 0,
        httpTruncated: false,
        allHttpRowsNormalized: false,
        loadedIdsMatch: false,
        displayOrderMatches: false,
        activeStateCountsMatch: false,
        creditStateCountsMatch: false,
        currencyDistributionMatches: false,
        imagePresenceCountsMatch: false,
        imagePresenceLimitation: false,
        creditLimitPresenceCountsMatch: false,
        warningCodes: [],
        dexieActiveCount: activeCount(dexieAccounts),
        httpActiveCount: 0,
        dexieCreditCount: creditCount(dexieAccounts),
        httpCreditCount: 0,
        dexieCurrencyKeyCount: currencyDistribution(dexieAccounts).size,
        httpCurrencyKeyCount: 0,
        dexieImagePresenceCount: imagePresenceCount(dexieAccounts),
        httpImagePresenceCount: 0,
        dexieCreditLimitPresenceCount: creditLimitPresenceCount(dexieAccounts),
        httpCreditLimitPresenceCount: 0,
        sampledDexieIds: sampledIds(dexieDisplayRows),
        sampledHttpIds: [],
        checks,
      };

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const normalizedHttpRows = httpRows
      .map(normalizeAccount)
      .filter((row): row is DiagnosticAccount => row !== undefined);
    const allHttpRowsNormalized = normalizedHttpRows.length === httpRows.length;
    const httpTruncated =
      httpReportedCount !== undefined &&
      httpReportedCount > normalizedHttpRows.length;
    const comparableDexieRows = httpTruncated
      ? dexieAccounts.slice(0, normalizedHttpRows.length)
      : dexieAccounts;
    const dexieDisplayRows = pageDisplayOrder(comparableDexieRows);
    const httpDisplayRows = pageDisplayOrder(normalizedHttpRows);
    const loadedIdsMatch = normalizedIdSetsMatch(
      comparableDexieRows,
      normalizedHttpRows,
    );
    const displayOrderMatches = normalizedOrderingIdsMatch(
      allIds(dexieDisplayRows),
      allIds(httpDisplayRows),
    );
    const dexieActiveCount = activeCount(comparableDexieRows);
    const httpActiveCount = activeCount(normalizedHttpRows);
    const dexieCreditCount = creditCount(comparableDexieRows);
    const httpCreditCount = creditCount(normalizedHttpRows);
    const dexieCurrencyDistribution = currencyDistribution(comparableDexieRows);
    const httpCurrencyDistribution = currencyDistribution(normalizedHttpRows);
    const dexieImagePresenceCount = imagePresenceCount(comparableDexieRows);
    const httpImages = await Promise.all(
      normalizedHttpRows.map((account) =>
        httpRepositories.accounts.getImage(account.id),
      ),
    );
    const httpImagePresenceCount = httpImages.filter(
      (image): image is Blob => image !== undefined,
    ).length;
    const dexieCreditLimitPresenceCount =
      creditLimitPresenceCount(comparableDexieRows);
    const httpCreditLimitPresenceCount =
      creditLimitPresenceCount(normalizedHttpRows);
    const activeStateCountsMatch = dexieActiveCount === httpActiveCount;
    const creditStateCountsMatch = dexieCreditCount === httpCreditCount;
    const currencyDistributionMatches = mapsMatch(
      dexieCurrencyDistribution,
      httpCurrencyDistribution,
    );
    const imagePresenceCountsMatch =
      dexieImagePresenceCount === httpImagePresenceCount;
    const imagePresenceLimitation = false;
    const warningCodes: string[] = [];
    const creditLimitPresenceCountsMatch =
      dexieCreditLimitPresenceCount === httpCreditLimitPresenceCount;
    const countsMatch =
      httpReportedCount !== undefined && httpReportedCount === dexieRows.length;

    const checks: AccountsReadExperimentDiagnosticCheck[] = [
      dexieAccounts.length === dexieRows.length
        ? pass("dexie accounts normalized")
        : fail("dexie accounts normalized", "dexie_account_id_missing"),
      pass("http accounts loaded"),
      allHttpRowsNormalized
        ? pass("http accounts normalized")
        : fail("http accounts normalized", "http_account_normalization_failed"),
      countsMatch
        ? pass("account counts match")
        : fail("account counts match", "account_count_mismatch"),
      httpTruncated
        ? fail("http account list is uncapped", "http_account_list_truncated")
        : pass("http account list is uncapped"),
      loadedIdsMatch
        ? pass("loaded account ids match")
        : fail("loaded account ids match", "account_loaded_ids_mismatch"),
      displayOrderMatches
        ? pass("account display order matches")
        : fail("account display order matches", "account_display_order_mismatch"),
      activeStateCountsMatch
        ? pass("active state counts match")
        : fail("active state counts match", "account_active_state_count_mismatch"),
      creditStateCountsMatch
        ? pass("credit state counts match")
        : fail("credit state counts match", "account_credit_state_count_mismatch"),
      currencyDistributionMatches
        ? pass("currency distribution matches")
        : fail("currency distribution matches", "account_currency_distribution_mismatch"),
      imagePresenceCountsMatch
        ? pass("image presence counts match")
        : fail(
            "image presence counts match",
            "account_image_presence_count_mismatch",
          ),
      creditLimitPresenceCountsMatch
        ? pass("credit-limit presence counts match")
        : fail(
            "credit-limit presence counts match",
            "account_credit_limit_presence_count_mismatch",
          ),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: AccountsReadExperimentDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks,
      dexieDerivedCount: dexieRows.length,
      dexieLoadedCount: dexieAccounts.length,
      httpReportedCount,
      httpLoadedCount: normalizedHttpRows.length,
      httpTruncated,
      allHttpRowsNormalized,
      loadedIdsMatch,
      displayOrderMatches,
      activeStateCountsMatch,
      creditStateCountsMatch,
      currencyDistributionMatches,
      imagePresenceCountsMatch,
      imagePresenceLimitation,
      creditLimitPresenceCountsMatch,
      warningCodes,
      dexieActiveCount,
      httpActiveCount,
      dexieCreditCount,
      httpCreditCount,
      dexieCurrencyKeyCount: dexieCurrencyDistribution.size,
      httpCurrencyKeyCount: httpCurrencyDistribution.size,
      dexieImagePresenceCount,
      httpImagePresenceCount,
      dexieCreditLimitPresenceCount,
      httpCreditLimitPresenceCount,
      sampledDexieIds: sampledIds(dexieDisplayRows),
      sampledHttpIds: sampledIds(httpDisplayRows),
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [
      fail("accounts read experiment diagnostic", sanitizeErrorCode(error)),
    ];
    const result: AccountsReadExperimentDiagnosticResult = {
      ok: false,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks: checks.length,
      dexieDerivedCount: 0,
      dexieLoadedCount: 0,
      httpLoadedCount: 0,
      httpTruncated: false,
      allHttpRowsNormalized: false,
      loadedIdsMatch: false,
      displayOrderMatches: false,
      activeStateCountsMatch: false,
      creditStateCountsMatch: false,
      currencyDistributionMatches: false,
      imagePresenceCountsMatch: false,
      imagePresenceLimitation: false,
      creditLimitPresenceCountsMatch: false,
      warningCodes: [],
      dexieActiveCount: 0,
      httpActiveCount: 0,
      dexieCreditCount: 0,
      httpCreditCount: 0,
      dexieCurrencyKeyCount: 0,
      httpCurrencyKeyCount: 0,
      dexieImagePresenceCount: 0,
      httpImagePresenceCount: 0,
      dexieCreditLimitPresenceCount: 0,
      httpCreditLimitPresenceCount: 0,
      sampledDexieIds: [],
      sampledHttpIds: [],
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  }
};

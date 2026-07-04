import { LocalApiError } from "../api/localApiClient";
import type { Recipient } from "../db";
import * as recipientRepository from "./recipientRepository";
import * as transactionRepository from "./transactionRepository";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface RecipientsReadExperimentDiagnosticOptions {
  limit?: number;
  logSummary?: boolean;
}

export interface RecipientsReadExperimentDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface RecipientsReadExperimentDiagnosticResult {
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
  sampledDexieIds: string[];
  sampledHttpIds: string[];
  checks: RecipientsReadExperimentDiagnosticCheck[];
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

interface DiagnosticRecipient {
  id: number;
  name: string;
  isActive: boolean;
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

const normalizeRecipient = (row: RowWithId): DiagnosticRecipient | undefined => {
  const source = row as Record<string, unknown>;
  if (typeof source.id !== "number" || !Number.isFinite(source.id)) {
    return undefined;
  }

  if (typeof source.name !== "string") {
    return undefined;
  }

  const isActive = booleanValue(source.isActive);
  if (isActive === undefined) {
    return undefined;
  }

  return {
    id: source.id,
    name: source.name,
    isActive,
  };
};

const dexieRecipientForDiagnostic = (
  recipient: Recipient,
): DiagnosticRecipient | undefined => {
  if (typeof recipient.id !== "number" || !Number.isFinite(recipient.id)) {
    return undefined;
  }

  return {
    id: recipient.id,
    name: recipient.name,
    isActive: recipient.isActive !== false,
  };
};

const sampledIds = (rows: DiagnosticRecipient[]): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined)
    .slice(0, SAMPLE_ID_LIMIT);

const allIds = (rows: DiagnosticRecipient[]): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const normalizedIdSetsMatch = (
  left: DiagnosticRecipient[],
  right: DiagnosticRecipient[],
): boolean => {
  const leftIds = allIds(left).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );
  const rightIds = allIds(right).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );

  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const activeCount = (rows: DiagnosticRecipient[]): number =>
  rows.filter((row) => row.isActive !== false).length;

const usageCounts = async (): Promise<Map<number, number>> => {
  const transactions = await transactionRepository.listTransactions();
  const counts = new Map<number, number>();

  for (const transaction of transactions) {
    const currentCount = counts.get(transaction.recipientId) ?? 0;
    counts.set(transaction.recipientId, currentCount + 1);
  }

  return counts;
};

const pageDefaultOrder = (
  rows: DiagnosticRecipient[],
  counts: Map<number, number>,
): DiagnosticRecipient[] =>
  [...rows].sort((left, right) => {
    const countDifference =
      (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
    if (countDifference !== 0) {
      return countDifference;
    }

    return left.name.localeCompare(right.name) || left.id - right.id;
  });

const pass = (name: string): RecipientsReadExperimentDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): RecipientsReadExperimentDiagnosticCheck => ({
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

  return "recipients_read_experiment_diagnostic_failed";
};

const printSummary = (
  result: RecipientsReadExperimentDiagnosticResult,
): void => {
  console.log("Recipients read experiment diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Dexie loaded count: ${result.dexieLoadedCount}`);
  console.log(`HTTP loaded count: ${result.httpLoadedCount}`);
  console.log(`HTTP truncated: ${String(result.httpTruncated)}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runRecipientsReadExperimentDiagnostics = async (
  options: RecipientsReadExperimentDiagnosticOptions = {},
): Promise<RecipientsReadExperimentDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieRows, httpResult, counts] = await Promise.all([
      recipientRepository.listRecipients(),
      httpRepositories.recipients.list({ limit, offset: 0 }),
      usageCounts(),
    ]);
    const dexieRecipients = dexieRows
      .map(dexieRecipientForDiagnostic)
      .filter((row): row is DiagnosticRecipient => row !== undefined);
    const httpRows = rowsFromListResult(httpResult as ReadListResult);
    const httpReportedCount = countFromListResult(httpResult as ReadListResult);

    if (!httpRows) {
      const checks = [
        pass("dexie recipients loaded"),
        fail("http recipients loaded", "invalid_http_recipient_list_response"),
      ];
      const result: RecipientsReadExperimentDiagnosticResult = {
        ok: false,
        generatedAt: new Date().toISOString(),
        limit,
        comparedChecks: checks.length,
        failedChecks: 1,
        dexieDerivedCount: dexieRows.length,
        dexieLoadedCount: dexieRecipients.length,
        httpReportedCount,
        httpLoadedCount: 0,
        httpTruncated: false,
        allHttpRowsNormalized: false,
        loadedIdsMatch: false,
        displayOrderMatches: false,
        activeStateCountsMatch: false,
        sampledDexieIds: sampledIds(pageDefaultOrder(dexieRecipients, counts)),
        sampledHttpIds: [],
        checks,
      };

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const normalizedHttpRows = httpRows
      .map(normalizeRecipient)
      .filter((row): row is DiagnosticRecipient => row !== undefined);
    const allHttpRowsNormalized = normalizedHttpRows.length === httpRows.length;
    const httpTruncated =
      httpReportedCount !== undefined && httpReportedCount > normalizedHttpRows.length;
    const comparableDexieRows = httpTruncated
      ? dexieRecipients.slice(0, normalizedHttpRows.length)
      : dexieRecipients;
    const dexieDisplayRows = pageDefaultOrder(comparableDexieRows, counts);
    const httpDisplayRows = pageDefaultOrder(normalizedHttpRows, counts);
    const loadedIdsMatch = normalizedIdSetsMatch(
      comparableDexieRows,
      normalizedHttpRows,
    );
    const displayOrderMatches = normalizedOrderingIdsMatch(
      allIds(dexieDisplayRows),
      allIds(httpDisplayRows),
    );
    const activeStateCountsMatch =
      activeCount(comparableDexieRows) === activeCount(normalizedHttpRows);
    const countsMatch =
      httpReportedCount !== undefined && httpReportedCount === dexieRows.length;

    const checks: RecipientsReadExperimentDiagnosticCheck[] = [
      dexieRecipients.length === dexieRows.length
        ? pass("dexie recipients normalized")
        : fail("dexie recipients normalized", "dexie_recipient_id_missing"),
      pass("http recipients loaded"),
      allHttpRowsNormalized
        ? pass("http recipients normalized")
        : fail("http recipients normalized", "http_recipient_normalization_failed"),
      countsMatch
        ? pass("recipient counts match")
        : fail("recipient counts match", "recipient_count_mismatch"),
      httpTruncated
        ? fail("http list is uncapped", "http_recipient_list_truncated")
        : pass("http list is uncapped"),
      loadedIdsMatch
        ? pass("loaded recipient ids match")
        : fail("loaded recipient ids match", "recipient_loaded_ids_mismatch"),
      displayOrderMatches
        ? pass("default display order matches")
        : fail("default display order matches", "recipient_display_order_mismatch"),
      activeStateCountsMatch
        ? pass("active state counts match")
        : fail("active state counts match", "recipient_active_state_count_mismatch"),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: RecipientsReadExperimentDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks,
      dexieDerivedCount: dexieRows.length,
      dexieLoadedCount: dexieRecipients.length,
      httpReportedCount,
      httpLoadedCount: normalizedHttpRows.length,
      httpTruncated,
      allHttpRowsNormalized,
      loadedIdsMatch,
      displayOrderMatches,
      activeStateCountsMatch,
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
      fail("recipients read experiment diagnostic", sanitizeErrorCode(error)),
    ];
    const result: RecipientsReadExperimentDiagnosticResult = {
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

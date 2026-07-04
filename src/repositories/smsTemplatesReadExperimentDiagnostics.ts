import { LocalApiError } from "../api/localApiClient";
import type { SmsImportTemplate } from "../db";
import * as smsImportTemplateRepository from "./smsImportTemplateRepository";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface SmsTemplatesReadExperimentDiagnosticOptions {
  limit?: number;
  logSummary?: boolean;
}

export interface SmsTemplatesReadExperimentDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface SmsTemplatesReadExperimentDiagnosticResult {
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
  accountIdDistributionMatches: boolean;
  patternPresenceDistributionMatches: boolean;
  dexieActiveCount: number;
  httpActiveCount: number;
  dexieAccountIdKeyCount: number;
  httpAccountIdKeyCount: number;
  dexiePatternPresenceKeyCount: number;
  httpPatternPresenceKeyCount: number;
  sampledDexieIds: string[];
  sampledHttpIds: string[];
  checks: SmsTemplatesReadExperimentDiagnosticCheck[];
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

interface DiagnosticSmsTemplate {
  id: number;
  isActive: boolean;
  accountIdKey: string;
  patternPresenceSignature: string;
}

const DEFAULT_LIMIT = 500;
const SAMPLE_ID_LIMIT = 12;
const NO_ACCOUNT_KEY = "__all_accounts__";
const PATTERN_FIELDS = [
  "referencePattern",
  "amountPattern",
  "recipientNamePattern",
  "recipientPhonePattern",
  "dateTimePattern",
  "costPattern",
  "incomePattern",
  "expensePattern",
] as const;

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

const accountIdKey = (value: unknown): string => {
  const id = numberValue(value);
  return id === undefined ? NO_ACCOUNT_KEY : String(id);
};

const patternPresenceSignature = (source: Record<string, unknown>): string =>
  PATTERN_FIELDS.map((field) => `${field}:${hasValue(source[field]) ? "1" : "0"}`).join("|");

const normalizeSmsTemplate = (
  row: RowWithId,
): DiagnosticSmsTemplate | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const isActive = booleanValue(source.isActive);

  if (id === undefined || typeof source.name !== "string" || isActive === undefined) {
    return undefined;
  }

  return {
    id,
    isActive,
    accountIdKey: accountIdKey(source.accountId),
    patternPresenceSignature: patternPresenceSignature(source),
  };
};

const dexieSmsTemplateForDiagnostic = (
  template: SmsImportTemplate,
): DiagnosticSmsTemplate | undefined => {
  if (typeof template.id !== "number" || !Number.isFinite(template.id)) {
    return undefined;
  }

  return {
    id: template.id,
    isActive: template.isActive !== false,
    accountIdKey: accountIdKey(template.accountId),
    patternPresenceSignature: patternPresenceSignature(
      template as unknown as Record<string, unknown>,
    ),
  };
};

const allIds = (rows: DiagnosticSmsTemplate[]): string[] =>
  rows
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const sampledIds = (rows: DiagnosticSmsTemplate[]): string[] =>
  allIds(rows).slice(0, SAMPLE_ID_LIMIT);

const normalizedIdSetsMatch = (
  left: DiagnosticSmsTemplate[],
  right: DiagnosticSmsTemplate[],
): boolean => {
  const leftIds = allIds(left).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );
  const rightIds = allIds(right).sort((leftId, rightId) =>
    leftId.localeCompare(rightId),
  );

  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const pageDisplayOrder = (
  rows: DiagnosticSmsTemplate[],
): DiagnosticSmsTemplate[] => [...rows].sort((left, right) => left.id - right.id);

const activeCount = (rows: DiagnosticSmsTemplate[]): number =>
  rows.filter((row) => row.isActive !== false).length;

const distribution = (
  rows: DiagnosticSmsTemplate[],
  keyForRow: (row: DiagnosticSmsTemplate) => string,
): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyForRow(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};

const mapsMatch = (left: Map<string, number>, right: Map<string, number>) =>
  left.size === right.size &&
  Array.from(left.entries()).every(([key, value]) => right.get(key) === value);

const pass = (name: string): SmsTemplatesReadExperimentDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): SmsTemplatesReadExperimentDiagnosticCheck => ({
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

  return "sms_templates_read_experiment_diagnostic_failed";
};

const printSummary = (
  result: SmsTemplatesReadExperimentDiagnosticResult,
): void => {
  console.log("SMS Templates read experiment diagnostic:");
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

export const runSmsTemplatesReadExperimentDiagnostics = async (
  options: SmsTemplatesReadExperimentDiagnosticOptions = {},
): Promise<SmsTemplatesReadExperimentDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieRows, httpResult] = await Promise.all([
      smsImportTemplateRepository.listTemplates(),
      httpRepositories.smsImportTemplates.list({ limit, offset: 0 }),
    ]);
    const dexieTemplates = dexieRows
      .map(dexieSmsTemplateForDiagnostic)
      .filter((row): row is DiagnosticSmsTemplate => row !== undefined);
    const httpRows = rowsFromListResult(httpResult as ReadListResult);
    const httpReportedCount = countFromListResult(httpResult as ReadListResult);

    if (!httpRows) {
      const checks = [
        pass("dexie sms templates loaded"),
        fail(
          "http sms templates loaded",
          "invalid_http_sms_template_list_response",
        ),
      ];
      const dexieDisplayRows = pageDisplayOrder(dexieTemplates);
      const result: SmsTemplatesReadExperimentDiagnosticResult = {
        ok: false,
        generatedAt: new Date().toISOString(),
        limit,
        comparedChecks: checks.length,
        failedChecks: 1,
        dexieDerivedCount: dexieRows.length,
        dexieLoadedCount: dexieTemplates.length,
        httpReportedCount,
        httpLoadedCount: 0,
        httpTruncated: false,
        allHttpRowsNormalized: false,
        loadedIdsMatch: false,
        displayOrderMatches: false,
        activeStateCountsMatch: false,
        accountIdDistributionMatches: false,
        patternPresenceDistributionMatches: false,
        dexieActiveCount: activeCount(dexieTemplates),
        httpActiveCount: 0,
        dexieAccountIdKeyCount: distribution(
          dexieTemplates,
          (row) => row.accountIdKey,
        ).size,
        httpAccountIdKeyCount: 0,
        dexiePatternPresenceKeyCount: distribution(
          dexieTemplates,
          (row) => row.patternPresenceSignature,
        ).size,
        httpPatternPresenceKeyCount: 0,
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
      .map(normalizeSmsTemplate)
      .filter((row): row is DiagnosticSmsTemplate => row !== undefined);
    const allHttpRowsNormalized = normalizedHttpRows.length === httpRows.length;
    const httpTruncated =
      httpReportedCount !== undefined &&
      httpReportedCount > normalizedHttpRows.length;
    const comparableDexieRows = httpTruncated
      ? dexieTemplates.slice(0, normalizedHttpRows.length)
      : dexieTemplates;
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
    const dexieAccountIdDistribution = distribution(
      comparableDexieRows,
      (row) => row.accountIdKey,
    );
    const httpAccountIdDistribution = distribution(
      normalizedHttpRows,
      (row) => row.accountIdKey,
    );
    const dexiePatternPresenceDistribution = distribution(
      comparableDexieRows,
      (row) => row.patternPresenceSignature,
    );
    const httpPatternPresenceDistribution = distribution(
      normalizedHttpRows,
      (row) => row.patternPresenceSignature,
    );
    const activeStateCountsMatch = dexieActiveCount === httpActiveCount;
    const accountIdDistributionMatches = mapsMatch(
      dexieAccountIdDistribution,
      httpAccountIdDistribution,
    );
    const patternPresenceDistributionMatches = mapsMatch(
      dexiePatternPresenceDistribution,
      httpPatternPresenceDistribution,
    );
    const countsMatch =
      httpReportedCount !== undefined && httpReportedCount === dexieRows.length;

    const checks: SmsTemplatesReadExperimentDiagnosticCheck[] = [
      dexieTemplates.length === dexieRows.length
        ? pass("dexie sms templates normalized")
        : fail("dexie sms templates normalized", "dexie_sms_template_id_missing"),
      pass("http sms templates loaded"),
      allHttpRowsNormalized
        ? pass("http sms templates normalized")
        : fail(
            "http sms templates normalized",
            "http_sms_template_normalization_failed",
          ),
      countsMatch
        ? pass("sms template counts match")
        : fail("sms template counts match", "sms_template_count_mismatch"),
      httpTruncated
        ? fail(
            "http sms template list is uncapped",
            "http_sms_template_list_truncated",
          )
        : pass("http sms template list is uncapped"),
      loadedIdsMatch
        ? pass("loaded sms template ids match")
        : fail(
            "loaded sms template ids match",
            "sms_template_loaded_ids_mismatch",
          ),
      displayOrderMatches
        ? pass("sms template display order matches")
        : fail(
            "sms template display order matches",
            "sms_template_display_order_mismatch",
          ),
      activeStateCountsMatch
        ? pass("active state counts match")
        : fail(
            "active state counts match",
            "sms_template_active_state_count_mismatch",
          ),
      accountIdDistributionMatches
        ? pass("account id distribution matches")
        : fail(
            "account id distribution matches",
            "sms_template_account_id_distribution_mismatch",
          ),
      patternPresenceDistributionMatches
        ? pass("pattern presence distribution matches")
        : fail(
            "pattern presence distribution matches",
            "sms_template_pattern_presence_distribution_mismatch",
          ),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: SmsTemplatesReadExperimentDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks,
      dexieDerivedCount: dexieRows.length,
      dexieLoadedCount: dexieTemplates.length,
      httpReportedCount,
      httpLoadedCount: normalizedHttpRows.length,
      httpTruncated,
      allHttpRowsNormalized,
      loadedIdsMatch,
      displayOrderMatches,
      activeStateCountsMatch,
      accountIdDistributionMatches,
      patternPresenceDistributionMatches,
      dexieActiveCount,
      httpActiveCount,
      dexieAccountIdKeyCount: dexieAccountIdDistribution.size,
      httpAccountIdKeyCount: httpAccountIdDistribution.size,
      dexiePatternPresenceKeyCount: dexiePatternPresenceDistribution.size,
      httpPatternPresenceKeyCount: httpPatternPresenceDistribution.size,
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
      fail("sms templates read experiment diagnostic", sanitizeErrorCode(error)),
    ];
    const result: SmsTemplatesReadExperimentDiagnosticResult = {
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
      accountIdDistributionMatches: false,
      patternPresenceDistributionMatches: false,
      dexieActiveCount: 0,
      httpActiveCount: 0,
      dexieAccountIdKeyCount: 0,
      httpAccountIdKeyCount: 0,
      dexiePatternPresenceKeyCount: 0,
      httpPatternPresenceKeyCount: 0,
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

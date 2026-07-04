import { LocalApiError } from "../api/localApiClient";
import type { Bucket, Category } from "../db";
import * as categoryRepository from "./categoryRepository";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface BucketsCategoriesReadExperimentDiagnosticOptions {
  limit?: number;
  logSummary?: boolean;
}

export interface BucketsCategoriesReadExperimentDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface BucketsCategoriesReadExperimentDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  limit: number;
  comparedChecks: number;
  failedChecks: number;
  dexieBucketDerivedCount: number;
  dexieBucketLoadedCount: number;
  httpBucketReportedCount?: number;
  httpBucketLoadedCount: number;
  dexieCategoryDerivedCount: number;
  dexieCategoryLoadedCount: number;
  httpCategoryReportedCount?: number;
  httpCategoryLoadedCount: number;
  httpBucketsTruncated: boolean;
  httpCategoriesTruncated: boolean;
  allHttpBucketsNormalized: boolean;
  allHttpCategoriesNormalized: boolean;
  bucketIdsMatch: boolean;
  categoryIdsMatch: boolean;
  bucketOrderMatches: boolean;
  categoryOrderMatches: boolean;
  categoryGroupingMatches: boolean;
  categoryCountsByBucketMatch: boolean;
  bucketActiveStateCountsMatch: boolean;
  categoryActiveStateCountsMatch: boolean;
  sampledDexieBucketIds: string[];
  sampledHttpBucketIds: string[];
  sampledDexieCategoryIds: string[];
  sampledHttpCategoryIds: string[];
  checks: BucketsCategoriesReadExperimentDiagnosticCheck[];
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

interface DiagnosticBucket {
  id: number;
  displayOrder: number;
  isActive: boolean;
}

interface DiagnosticCategory {
  id: number;
  bucketId: number;
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

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const normalizeBucket = (row: RowWithId): DiagnosticBucket | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const displayOrder = numberValue(source.displayOrder);
  const isActive = booleanValue(source.isActive);

  if (id === undefined || displayOrder === undefined || isActive === undefined) {
    return undefined;
  }

  return { id, displayOrder, isActive };
};

const normalizeCategory = (row: RowWithId): DiagnosticCategory | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const bucketId = numberValue(source.bucketId);
  const isActive = booleanValue(source.isActive);

  if (id === undefined || bucketId === undefined || isActive === undefined) {
    return undefined;
  }

  return { id, bucketId, isActive };
};

const dexieBucketForDiagnostic = (
  bucket: Bucket,
): DiagnosticBucket | undefined => {
  if (typeof bucket.id !== "number" || !Number.isFinite(bucket.id)) {
    return undefined;
  }

  return {
    id: bucket.id,
    displayOrder: bucket.displayOrder ?? 0,
    isActive: bucket.isActive !== false,
  };
};

const dexieCategoryForDiagnostic = (
  category: Category,
): DiagnosticCategory | undefined => {
  if (typeof category.id !== "number" || !Number.isFinite(category.id)) {
    return undefined;
  }

  return {
    id: category.id,
    bucketId: category.bucketId,
    isActive: category.isActive !== false,
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

const bucketDisplayOrder = (rows: DiagnosticBucket[]): DiagnosticBucket[] =>
  [...rows].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.id - right.id,
  );

const categoryDisplayOrder = (
  rows: DiagnosticCategory[],
): DiagnosticCategory[] => [...rows].sort((left, right) => left.id - right.id);

const activeCount = (rows: Array<{ isActive: boolean }>): number =>
  rows.filter((row) => row.isActive !== false).length;

const categoryCountsByBucket = (
  categories: DiagnosticCategory[],
): Map<number, number> => {
  const counts = new Map<number, number>();

  for (const category of categories) {
    counts.set(category.bucketId, (counts.get(category.bucketId) ?? 0) + 1);
  }

  return counts;
};

const mapsMatch = (left: Map<number, number>, right: Map<number, number>) =>
  left.size === right.size &&
  Array.from(left.entries()).every(([key, value]) => right.get(key) === value);

const categoryGroupingSignature = (
  categories: DiagnosticCategory[],
): string[] =>
  Array.from(
    categories.reduce((groups, category) => {
      const group = groups.get(category.bucketId) ?? [];
      group.push(category.id);
      groups.set(category.bucketId, group);
      return groups;
    }, new Map<number, number[]>()),
  )
    .map(([bucketId, ids]) => `${bucketId}:${ids.sort((a, b) => a - b).join(",")}`)
    .sort();

const arraysMatch = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const pass = (
  name: string,
): BucketsCategoriesReadExperimentDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): BucketsCategoriesReadExperimentDiagnosticCheck => ({
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

  return "buckets_categories_read_experiment_diagnostic_failed";
};

const printSummary = (
  result: BucketsCategoriesReadExperimentDiagnosticResult,
): void => {
  console.log("Buckets/Categories read experiment diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Limit: ${result.limit}`);
  console.log(`Dexie buckets loaded: ${result.dexieBucketLoadedCount}`);
  console.log(`HTTP buckets loaded: ${result.httpBucketLoadedCount}`);
  console.log(`Dexie categories loaded: ${result.dexieCategoryLoadedCount}`);
  console.log(`HTTP categories loaded: ${result.httpCategoryLoadedCount}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runBucketsCategoriesReadExperimentDiagnostics = async (
  options: BucketsCategoriesReadExperimentDiagnosticOptions = {},
): Promise<BucketsCategoriesReadExperimentDiagnosticResult> => {
  const limit = safeLimit(options.limit);
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [dexieBucketRows, dexieCategoryRows, httpBucketResult, httpCategoryResult] =
      await Promise.all([
        categoryRepository.listBuckets(),
        categoryRepository.listCategories(),
        httpRepositories.buckets.list({ limit, offset: 0 }),
        httpRepositories.categories.list({ limit, offset: 0 }),
      ]);
    const dexieBuckets = dexieBucketRows
      .map(dexieBucketForDiagnostic)
      .filter((row): row is DiagnosticBucket => row !== undefined);
    const dexieCategories = dexieCategoryRows
      .map(dexieCategoryForDiagnostic)
      .filter((row): row is DiagnosticCategory => row !== undefined);
    const httpBucketRows = rowsFromListResult(httpBucketResult as ReadListResult);
    const httpCategoryRows = rowsFromListResult(
      httpCategoryResult as ReadListResult,
    );
    const httpBucketReportedCount = countFromListResult(
      httpBucketResult as ReadListResult,
    );
    const httpCategoryReportedCount = countFromListResult(
      httpCategoryResult as ReadListResult,
    );

    if (!httpBucketRows || !httpCategoryRows) {
      const checks = [
        pass("dexie buckets loaded"),
        pass("dexie categories loaded"),
        httpBucketRows
          ? pass("http buckets loaded")
          : fail("http buckets loaded", "invalid_http_bucket_list_response"),
        httpCategoryRows
          ? pass("http categories loaded")
          : fail("http categories loaded", "invalid_http_category_list_response"),
      ];
      const failedChecks = checks.filter((check) => check.status === "fail").length;
      const result: BucketsCategoriesReadExperimentDiagnosticResult = {
        ok: false,
        generatedAt: new Date().toISOString(),
        limit,
        comparedChecks: checks.length,
        failedChecks,
        dexieBucketDerivedCount: dexieBucketRows.length,
        dexieBucketLoadedCount: dexieBuckets.length,
        httpBucketReportedCount,
        httpBucketLoadedCount: 0,
        dexieCategoryDerivedCount: dexieCategoryRows.length,
        dexieCategoryLoadedCount: dexieCategories.length,
        httpCategoryReportedCount,
        httpCategoryLoadedCount: 0,
        httpBucketsTruncated: false,
        httpCategoriesTruncated: false,
        allHttpBucketsNormalized: false,
        allHttpCategoriesNormalized: false,
        bucketIdsMatch: false,
        categoryIdsMatch: false,
        bucketOrderMatches: false,
        categoryOrderMatches: false,
        categoryGroupingMatches: false,
        categoryCountsByBucketMatch: false,
        bucketActiveStateCountsMatch: false,
        categoryActiveStateCountsMatch: false,
        sampledDexieBucketIds: sampledIds(bucketDisplayOrder(dexieBuckets)),
        sampledHttpBucketIds: [],
        sampledDexieCategoryIds: sampledIds(categoryDisplayOrder(dexieCategories)),
        sampledHttpCategoryIds: [],
        checks,
      };

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const normalizedHttpBuckets = httpBucketRows
      .map(normalizeBucket)
      .filter((row): row is DiagnosticBucket => row !== undefined);
    const normalizedHttpCategories = httpCategoryRows
      .map(normalizeCategory)
      .filter((row): row is DiagnosticCategory => row !== undefined);
    const allHttpBucketsNormalized =
      normalizedHttpBuckets.length === httpBucketRows.length;
    const allHttpCategoriesNormalized =
      normalizedHttpCategories.length === httpCategoryRows.length;
    const httpBucketsTruncated =
      httpBucketReportedCount !== undefined &&
      httpBucketReportedCount > normalizedHttpBuckets.length;
    const httpCategoriesTruncated =
      httpCategoryReportedCount !== undefined &&
      httpCategoryReportedCount > normalizedHttpCategories.length;
    const comparableDexieBuckets = httpBucketsTruncated
      ? dexieBuckets.slice(0, normalizedHttpBuckets.length)
      : dexieBuckets;
    const comparableDexieCategories = httpCategoriesTruncated
      ? dexieCategories.slice(0, normalizedHttpCategories.length)
      : dexieCategories;
    const dexieBucketDisplayRows = bucketDisplayOrder(comparableDexieBuckets);
    const httpBucketDisplayRows = bucketDisplayOrder(normalizedHttpBuckets);
    const dexieCategoryDisplayRows = categoryDisplayOrder(
      comparableDexieCategories,
    );
    const httpCategoryDisplayRows = categoryDisplayOrder(
      normalizedHttpCategories,
    );
    const bucketIdsMatch = normalizedIdSetsMatch(
      comparableDexieBuckets,
      normalizedHttpBuckets,
    );
    const categoryIdsMatch = normalizedIdSetsMatch(
      comparableDexieCategories,
      normalizedHttpCategories,
    );
    const bucketOrderMatches = normalizedOrderingIdsMatch(
      allIds(dexieBucketDisplayRows),
      allIds(httpBucketDisplayRows),
    );
    const categoryOrderMatches = normalizedOrderingIdsMatch(
      allIds(dexieCategoryDisplayRows),
      allIds(httpCategoryDisplayRows),
    );
    const categoryGroupingMatches = arraysMatch(
      categoryGroupingSignature(comparableDexieCategories),
      categoryGroupingSignature(normalizedHttpCategories),
    );
    const categoryCountsByBucketMatch = mapsMatch(
      categoryCountsByBucket(comparableDexieCategories),
      categoryCountsByBucket(normalizedHttpCategories),
    );
    const bucketActiveStateCountsMatch =
      activeCount(comparableDexieBuckets) === activeCount(normalizedHttpBuckets);
    const categoryActiveStateCountsMatch =
      activeCount(comparableDexieCategories) ===
      activeCount(normalizedHttpCategories);
    const bucketCountsMatch =
      httpBucketReportedCount !== undefined &&
      httpBucketReportedCount === dexieBucketRows.length;
    const categoryCountsMatch =
      httpCategoryReportedCount !== undefined &&
      httpCategoryReportedCount === dexieCategoryRows.length;

    const checks: BucketsCategoriesReadExperimentDiagnosticCheck[] = [
      dexieBuckets.length === dexieBucketRows.length
        ? pass("dexie buckets normalized")
        : fail("dexie buckets normalized", "dexie_bucket_id_missing"),
      dexieCategories.length === dexieCategoryRows.length
        ? pass("dexie categories normalized")
        : fail("dexie categories normalized", "dexie_category_id_missing"),
      pass("http buckets loaded"),
      pass("http categories loaded"),
      allHttpBucketsNormalized
        ? pass("http buckets normalized")
        : fail("http buckets normalized", "http_bucket_normalization_failed"),
      allHttpCategoriesNormalized
        ? pass("http categories normalized")
        : fail(
            "http categories normalized",
            "http_category_normalization_failed",
          ),
      bucketCountsMatch
        ? pass("bucket counts match")
        : fail("bucket counts match", "bucket_count_mismatch"),
      categoryCountsMatch
        ? pass("category counts match")
        : fail("category counts match", "category_count_mismatch"),
      httpBucketsTruncated
        ? fail("http bucket list is uncapped", "http_bucket_list_truncated")
        : pass("http bucket list is uncapped"),
      httpCategoriesTruncated
        ? fail(
            "http category list is uncapped",
            "http_category_list_truncated",
          )
        : pass("http category list is uncapped"),
      bucketIdsMatch
        ? pass("loaded bucket ids match")
        : fail("loaded bucket ids match", "bucket_loaded_ids_mismatch"),
      categoryIdsMatch
        ? pass("loaded category ids match")
        : fail("loaded category ids match", "category_loaded_ids_mismatch"),
      bucketOrderMatches
        ? pass("bucket display order matches")
        : fail("bucket display order matches", "bucket_display_order_mismatch"),
      categoryOrderMatches
        ? pass("category display order matches")
        : fail(
            "category display order matches",
            "category_display_order_mismatch",
          ),
      categoryGroupingMatches
        ? pass("category grouping matches")
        : fail("category grouping matches", "category_grouping_mismatch"),
      categoryCountsByBucketMatch
        ? pass("category counts by bucket match")
        : fail(
            "category counts by bucket match",
            "category_counts_by_bucket_mismatch",
          ),
      bucketActiveStateCountsMatch
        ? pass("bucket active state counts match")
        : fail(
            "bucket active state counts match",
            "bucket_active_state_count_mismatch",
          ),
      categoryActiveStateCountsMatch
        ? pass("category active state counts match")
        : fail(
            "category active state counts match",
            "category_active_state_count_mismatch",
          ),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: BucketsCategoriesReadExperimentDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks,
      dexieBucketDerivedCount: dexieBucketRows.length,
      dexieBucketLoadedCount: dexieBuckets.length,
      httpBucketReportedCount,
      httpBucketLoadedCount: normalizedHttpBuckets.length,
      dexieCategoryDerivedCount: dexieCategoryRows.length,
      dexieCategoryLoadedCount: dexieCategories.length,
      httpCategoryReportedCount,
      httpCategoryLoadedCount: normalizedHttpCategories.length,
      httpBucketsTruncated,
      httpCategoriesTruncated,
      allHttpBucketsNormalized,
      allHttpCategoriesNormalized,
      bucketIdsMatch,
      categoryIdsMatch,
      bucketOrderMatches,
      categoryOrderMatches,
      categoryGroupingMatches,
      categoryCountsByBucketMatch,
      bucketActiveStateCountsMatch,
      categoryActiveStateCountsMatch,
      sampledDexieBucketIds: sampledIds(dexieBucketDisplayRows),
      sampledHttpBucketIds: sampledIds(httpBucketDisplayRows),
      sampledDexieCategoryIds: sampledIds(dexieCategoryDisplayRows),
      sampledHttpCategoryIds: sampledIds(httpCategoryDisplayRows),
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [
      fail(
        "buckets categories read experiment diagnostic",
        sanitizeErrorCode(error),
      ),
    ];
    const result: BucketsCategoriesReadExperimentDiagnosticResult = {
      ok: false,
      generatedAt: new Date().toISOString(),
      limit,
      comparedChecks: checks.length,
      failedChecks: checks.length,
      dexieBucketDerivedCount: 0,
      dexieBucketLoadedCount: 0,
      httpBucketLoadedCount: 0,
      dexieCategoryDerivedCount: 0,
      dexieCategoryLoadedCount: 0,
      httpCategoryLoadedCount: 0,
      httpBucketsTruncated: false,
      httpCategoriesTruncated: false,
      allHttpBucketsNormalized: false,
      allHttpCategoriesNormalized: false,
      bucketIdsMatch: false,
      categoryIdsMatch: false,
      bucketOrderMatches: false,
      categoryOrderMatches: false,
      categoryGroupingMatches: false,
      categoryCountsByBucketMatch: false,
      bucketActiveStateCountsMatch: false,
      categoryActiveStateCountsMatch: false,
      sampledDexieBucketIds: [],
      sampledHttpBucketIds: [],
      sampledDexieCategoryIds: [],
      sampledHttpCategoryIds: [],
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  }
};

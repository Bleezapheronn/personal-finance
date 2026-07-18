import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const BUCKETS_CATEGORIES_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT";

const BUCKET_CREATE_CONFIRMATION = "create bucket in disposable sqlite";
const BUCKET_UPDATE_CONFIRMATION = "update bucket in disposable sqlite";
const CATEGORY_CREATE_CONFIRMATION = "create category in disposable sqlite";
const CATEGORY_UPDATE_CONFIRMATION = "update category in disposable sqlite";

export interface BucketWriteInput {
  name: string;
  description?: string;
  minPercentage?: number;
  maxPercentage?: number;
  minFixedAmount?: number;
  excludeFromReports: boolean;
}

export interface CategoryWriteInput {
  name: string;
  bucketId: number;
  description?: string;
}

interface BucketCategoryWriteResponse {
  ok: boolean;
  code?: string;
  entity: "bucket" | "category";
  action: "create" | "update";
  dryRun?: boolean;
  wouldMutate?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  targetIdPresent?: boolean;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes?: string[];
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isBucketsCategoriesWriteExperimentEnabled = (): boolean =>
  envValue(BUCKETS_CATEGORIES_WRITE_EXPERIMENT_FLAG) === "true";

export const bucketCategoryWriteErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }
  return "bucket_category_write_failed";
};

const assertDryRunPassed = (
  response: BucketCategoryWriteResponse,
  entity: BucketCategoryWriteResponse["entity"],
  action: BucketCategoryWriteResponse["action"],
): void => {
  if (
    response.ok !== true ||
    response.entity !== entity ||
    response.action !== action ||
    response.dryRun !== true ||
    response.wouldMutate !== false
  ) {
    throw new LocalApiError(
      response.code ?? `${entity}_${action}_dry_run_failed`,
      "Bucket/category dry-run failed.",
    );
  }
};

const assertWritePassed = (
  response: BucketCategoryWriteResponse,
  entity: BucketCategoryWriteResponse["entity"],
  action: BucketCategoryWriteResponse["action"],
): BucketCategoryWriteResponse => {
  if (
    response.ok !== true ||
    response.entity !== entity ||
    response.action !== action ||
    response.sqliteMutated !== true ||
    response.rowsChanged !== 1
  ) {
    throw new LocalApiError(
      response.code ?? `${entity}_${action}_write_failed`,
      "Bucket/category write failed.",
    );
  }
  return response;
};

const bucketPayload = (input: BucketWriteInput) => ({
  name: input.name,
  description: input.description,
  minPercentage: input.minPercentage,
  maxPercentage: input.maxPercentage,
  minFixedAmount: input.minFixedAmount,
  excludeFromReports: input.excludeFromReports,
});

export const createBucketInDisposableSqlite = async (
  input: BucketWriteInput,
): Promise<BucketCategoryWriteResponse> => {
  const payload = bucketPayload(input);
  const dryRun = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/buckets/dry-run/create",
    payload,
  );
  assertDryRunPassed(dryRun, "bucket", "create");

  const response = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/buckets/write/create",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: BUCKET_CREATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "bucket", "create");
};

export const updateBucketInDisposableSqlite = async (
  id: number,
  input: BucketWriteInput,
): Promise<BucketCategoryWriteResponse> => {
  const payload = { id, ...bucketPayload(input) };
  const dryRun = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/buckets/dry-run/update",
    payload,
  );
  assertDryRunPassed(dryRun, "bucket", "update");

  const response = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/buckets/write/update",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: BUCKET_UPDATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "bucket", "update");
};

const categoryPayload = (input: CategoryWriteInput) => ({
  name: input.name,
  bucketId: input.bucketId,
  description: input.description,
});

export const createCategoryInDisposableSqlite = async (
  input: CategoryWriteInput,
): Promise<BucketCategoryWriteResponse> => {
  const payload = categoryPayload(input);
  const dryRun = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/categories/dry-run/create",
    payload,
  );
  assertDryRunPassed(dryRun, "category", "create");

  const response = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/categories/write/create",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CATEGORY_CREATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "category", "create");
};

export const updateCategoryInDisposableSqlite = async (
  id: number,
  input: CategoryWriteInput,
): Promise<BucketCategoryWriteResponse> => {
  const payload = { id, ...categoryPayload(input) };
  const dryRun = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/categories/dry-run/update",
    payload,
  );
  assertDryRunPassed(dryRun, "category", "update");

  const response = await localApiPost<BucketCategoryWriteResponse>(
    "/prototype/repositories/categories/write/update",
    {
      ...payload,
      dryRunReviewed: true,
      confirmation: CATEGORY_UPDATE_CONFIRMATION,
    },
  );
  return assertWritePassed(response, "category", "update");
};

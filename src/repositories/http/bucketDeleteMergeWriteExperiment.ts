import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const BUCKET_DELETE_MERGE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUCKET_DELETE_MERGE_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  delete: "delete unused bucket from disposable sqlite",
  merge: "merge bucket references in disposable sqlite",
} as const;

export interface BucketDirectReferenceCounts {
  transactions: number;
  budgets: number;
  budgetSnapshots: number;
  smsImportTemplates: number;
}

export interface BucketLifecycleResponse {
  ok: boolean;
  action: "delete" | "merge";
  eligible: boolean;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctBuckets: boolean;
  compatible: boolean;
  categoryCount: number;
  sourceCategoryCount: number;
  categoryCollisionCount: number;
  sourceReferenceCount: number;
  referenceCountsByEntity: BucketDirectReferenceCounts;
  rowsProposedForUpdate: number;
  categoriesProposedForMove: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  sqliteMutated: boolean;
  rowsChanged: number;
  code?: string;
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isBucketDeleteMergeWriteExperimentEnabled = (): boolean =>
  envValue(BUCKET_DELETE_MERGE_WRITE_EXPERIMENT_FLAG) === "true";

const requirePlan = (
  response: BucketLifecycleResponse,
  action: "delete" | "merge",
): BucketLifecycleResponse => {
  if (response.action !== action || typeof response.planFingerprint !== "string") {
    throw new LocalApiError(
      response.code ?? `bucket_${action}_dry_run_failed`,
      "Bucket lifecycle dry-run failed.",
    );
  }
  return response;
};

export const dryRunBucketDelete = async (
  bucketId: number,
): Promise<BucketLifecycleResponse> =>
  requirePlan(
    await localApiPost<BucketLifecycleResponse>(
      "/prototype/repositories/buckets/delete/dry-run",
      { bucketId },
    ),
    "delete",
  );

export const writeBucketDelete = async (
  bucketId: number,
  expectedPlanFingerprint: string,
): Promise<BucketLifecycleResponse> =>
  localApiPost<BucketLifecycleResponse>(
    "/prototype/repositories/buckets/delete/write",
    {
      bucketId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.delete,
      expectedPlanFingerprint,
    },
  );

export const dryRunBucketMerge = async (
  sourceBucketId: number,
  targetBucketId: number,
): Promise<BucketLifecycleResponse> =>
  requirePlan(
    await localApiPost<BucketLifecycleResponse>(
      "/prototype/repositories/buckets/merge/dry-run",
      { sourceBucketId, targetBucketId },
    ),
    "merge",
  );

export const writeBucketMerge = async (
  sourceBucketId: number,
  targetBucketId: number,
  expectedPlanFingerprint: string,
): Promise<BucketLifecycleResponse> =>
  localApiPost<BucketLifecycleResponse>(
    "/prototype/repositories/buckets/merge/write",
    {
      sourceBucketId,
      targetBucketId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.merge,
      expectedPlanFingerprint,
    },
  );

export const bucketLifecycleErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "bucket_lifecycle_failed";

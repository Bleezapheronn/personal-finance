import { LocalApiError, localApiPost } from "../../api/localApiClient";

export const CATEGORY_DELETE_MERGE_WRITE_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_CATEGORY_DELETE_MERGE_WRITE_EXPERIMENT";

const CONFIRMATIONS = {
  delete: "delete unused category from disposable sqlite",
  merge: "merge category references in disposable sqlite",
} as const;

export interface CategoryReferenceCounts {
  transactions: number;
  budgets: number;
  budgetSnapshots: number;
}

export interface CategoryLifecycleResponse {
  ok: boolean;
  action: "delete" | "merge";
  eligible: boolean;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctCategories: boolean;
  compatible: boolean;
  parentCompatible: boolean;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: CategoryReferenceCounts;
  rowsProposedForUpdate: number;
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

export const isCategoryDeleteMergeWriteExperimentEnabled = (): boolean =>
  envValue(CATEGORY_DELETE_MERGE_WRITE_EXPERIMENT_FLAG) === "true";

const requirePlan = (
  response: CategoryLifecycleResponse,
  action: "delete" | "merge",
): CategoryLifecycleResponse => {
  if (
    response.action !== action ||
    typeof response.planFingerprint !== "string"
  ) {
    throw new LocalApiError(
      response.code ?? `category_${action}_dry_run_failed`,
      "Category lifecycle dry-run failed.",
    );
  }
  return response;
};

export const dryRunCategoryDelete = async (
  categoryId: number,
): Promise<CategoryLifecycleResponse> =>
  requirePlan(
    await localApiPost<CategoryLifecycleResponse>(
      "/prototype/repositories/categories/delete/dry-run",
      { categoryId },
    ),
    "delete",
  );

export const writeCategoryDelete = async (
  categoryId: number,
  expectedPlanFingerprint: string,
): Promise<CategoryLifecycleResponse> =>
  localApiPost<CategoryLifecycleResponse>(
    "/prototype/repositories/categories/delete/write",
    {
      categoryId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.delete,
      expectedPlanFingerprint,
    },
  );

export const dryRunCategoryMerge = async (
  sourceCategoryId: number,
  targetCategoryId: number,
): Promise<CategoryLifecycleResponse> =>
  requirePlan(
    await localApiPost<CategoryLifecycleResponse>(
      "/prototype/repositories/categories/merge/dry-run",
      { sourceCategoryId, targetCategoryId },
    ),
    "merge",
  );

export const writeCategoryMerge = async (
  sourceCategoryId: number,
  targetCategoryId: number,
  expectedPlanFingerprint: string,
): Promise<CategoryLifecycleResponse> =>
  localApiPost<CategoryLifecycleResponse>(
    "/prototype/repositories/categories/merge/write",
    {
      sourceCategoryId,
      targetCategoryId,
      dryRunReviewed: true,
      confirmation: CONFIRMATIONS.merge,
      expectedPlanFingerprint,
    },
  );

export const categoryLifecycleErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "category_lifecycle_failed";

import { LocalApiError, localApiPost } from "../../api/localApiClient";

export type LookupActiveStateEntity = "account" | "bucket" | "category";
export type LookupActiveStateAction = "activate" | "deactivate";

interface ActiveStateResponse {
  ok: boolean;
  entity: LookupActiveStateEntity;
  action: LookupActiveStateAction;
  planFingerprint?: string;
  sqliteMutated?: boolean;
  alreadyMatches?: boolean;
  code?: string;
}

const confirmation = (entity: LookupActiveStateEntity, action: LookupActiveStateAction) =>
  `${action} ${entity} in authoritative sqlite`;

const lookupActiveStateResources: Record<
  LookupActiveStateEntity,
  "accounts" | "buckets" | "categories"
> = {
  account: "accounts",
  bucket: "buckets",
  category: "categories",
};

export const lookupActiveStateResource = (entity: LookupActiveStateEntity) =>
  lookupActiveStateResources[entity];

export const writeLookupActiveState = async (
  entity: LookupActiveStateEntity,
  id: number,
  action: LookupActiveStateAction,
): Promise<ActiveStateResponse> => {
  const base = `/prototype/repositories/${lookupActiveStateResource(entity)}/active-state`;
  const dryRun = await localApiPost<ActiveStateResponse>(`${base}/dry-run/${action}`, { id });
  if (dryRun.ok !== true || !dryRun.planFingerprint) {
    throw new LocalApiError(dryRun.code ?? "active_state_dry_run_failed", "Active-state dry run failed.");
  }
  const write = await localApiPost<ActiveStateResponse>(`${base}/write/${action}`, {
    id,
    dryRunReviewed: true,
    confirmation: confirmation(entity, action),
    expectedPlanFingerprint: dryRun.planFingerprint,
  });
  if (write.ok !== true || (write.sqliteMutated !== true && write.alreadyMatches !== true)) {
    throw new LocalApiError(write.code ?? "active_state_write_failed", "Active-state update failed.");
  }
  return write;
};

interface BucketReorderResponse {
  ok: boolean;
  planFingerprint?: string;
  sqliteMutated?: boolean;
  code?: string;
}

export const reorderBuckets = async (orderedBucketIds: number[]): Promise<void> => {
  const dryRun = await localApiPost<BucketReorderResponse>(
    "/prototype/repositories/buckets/reorder/dry-run",
    { orderedBucketIds },
  );
  if (dryRun.ok !== true || !dryRun.planFingerprint) {
    throw new LocalApiError(dryRun.code ?? "bucket_reorder_dry_run_failed", "Bucket reorder dry run failed.");
  }
  const write = await localApiPost<BucketReorderResponse>(
    "/prototype/repositories/buckets/reorder/write",
    { orderedBucketIds, dryRunReviewed: true, confirmation: "reorder buckets in authoritative sqlite", expectedPlanFingerprint: dryRun.planFingerprint },
  );
  if (write.ok !== true || write.sqliteMutated !== true) {
    throw new LocalApiError(write.code ?? "bucket_reorder_write_failed", "Bucket reorder failed.");
  }
};

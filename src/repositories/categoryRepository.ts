import { Bucket, Category, db } from "../db";

export const listBuckets = async (): Promise<Bucket[]> => {
  return db.buckets.toArray();
};

export const listActiveBuckets = async (): Promise<Bucket[]> => {
  const buckets = await listBuckets();
  return buckets.filter((bucket) => bucket.isActive !== false);
};

export const listCategories = async (): Promise<Category[]> => {
  return db.categories.toArray();
};

export const listActiveCategories = async (): Promise<Category[]> => {
  const categories = await listCategories();
  return categories.filter((category) => category.isActive !== false);
};

export const getCategoryById = async (
  id: number,
): Promise<Category | undefined> => {
  return db.categories.get(id);
};

export const getBucketById = async (
  id: number,
): Promise<Bucket | undefined> => {
  return db.buckets.get(id);
};

export const listCategoriesForBucket = async (
  bucketId: number,
): Promise<Category[]> => {
  return db.categories.where("bucketId").equals(bucketId).toArray();
};

export const listCategoriesWithActiveBuckets = async (): Promise<
  Category[]
> => {
  const [categories, buckets] = await Promise.all([
    listActiveCategories(),
    listActiveBuckets(),
  ]);
  const activeBucketIds = new Set(
    buckets
      .map((bucket) => bucket.id)
      .filter((id): id is number => typeof id === "number"),
  );

  return categories.filter((category) => activeBucketIds.has(category.bucketId));
};

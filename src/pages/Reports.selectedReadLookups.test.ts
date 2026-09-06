import { describe, expect, it, vi } from "vitest";
import {
  getActiveReportBucketOptions,
  getActiveReportCategoryOptions,
  loadSelectedReportLookupInputs,
} from "./Reports";

type LookupRepositories = Parameters<typeof loadSelectedReportLookupInputs>[0];

const bucket = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Everyday",
  minPercentage: 0,
  maxPercentage: 100,
  minFixedAmount: null,
  isActive: true,
  displayOrder: 1,
  excludeFromReports: false,
  ...overrides,
});

const category = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  bucketId: 1,
  name: "Food",
  isActive: true,
  ...overrides,
});

const lookupRepositories = (
  categories: unknown[],
  buckets: unknown[],
): {
  repositories: LookupRepositories;
  categoryList: ReturnType<typeof vi.fn>;
  bucketList: ReturnType<typeof vi.fn>;
} => {
  const categoryList = vi.fn().mockImplementation(({ limit, offset }) =>
    Promise.resolve({
      count: categories.length,
      rows: categories.slice(offset, offset + limit),
    }),
  );
  const bucketList = vi.fn().mockImplementation(({ limit, offset }) =>
    Promise.resolve({
      count: buckets.length,
      rows: buckets.slice(offset, offset + limit),
    }),
  );

  return {
    repositories: {
      categories: { list: categoryList },
      buckets: { list: bucketList },
    } as LookupRepositories,
    categoryList,
    bucketList,
  };
};

describe("Reports selected-read lookup inputs", () => {
  it("uses only category and bucket lookup resources with the existing paging", async () => {
    const categories = Array.from({ length: 201 }, (_, index) =>
      category({ id: index + 1 }),
    );
    const buckets = Array.from({ length: 201 }, (_, index) =>
      bucket({ id: index + 1 }),
    );
    const { repositories, categoryList, bucketList } = lookupRepositories(
      categories,
      buckets,
    );

    const result = await loadSelectedReportLookupInputs(repositories);

    expect(result.categories).toHaveLength(201);
    expect(result.buckets).toHaveLength(201);
    expect(categoryList).toHaveBeenCalledTimes(2);
    expect(bucketList).toHaveBeenCalledTimes(2);
    expect(categoryList).toHaveBeenCalledWith({ limit: 200, offset: 0 });
    expect(bucketList).toHaveBeenCalledWith({ limit: 200, offset: 0 });
    expect(categoryList).toHaveBeenLastCalledWith({ limit: 200, offset: 200 });
    expect(bucketList).toHaveBeenLastCalledWith({ limit: 200, offset: 200 });
  });

  it("preserves malformed lookup response failure behavior", async () => {
    const { repositories } = lookupRepositories(
      [category({ id: "not-a-number" })],
      [bucket()],
    );

    await expect(loadSelectedReportLookupInputs(repositories)).rejects.toThrow(
      "reports_selected_read_input_normalization_failed",
    );
  });

  it("keeps active non-excluded report bucket filtering and order", () => {
    expect(
      getActiveReportBucketOptions([
        bucket({ id: 4, name: "Fourth", displayOrder: 2 }),
        bucket({ id: 2, name: null, displayOrder: 1 }),
        bucket({ id: 3, name: "Third", displayOrder: 1 }),
        bucket({ id: 5, isActive: false }),
        bucket({ id: 6, excludeFromReports: true }),
      ]),
    ).toEqual([
      { id: 2, name: "Unnamed" },
      { id: 3, name: "Third" },
      { id: 4, name: "Fourth" },
    ]);
  });

  it("keeps active selected-bucket category filtering and name sorting", () => {
    expect(
      getActiveReportCategoryOptions(
        [
          category({ id: 3, name: "Zoo" }),
          category({ id: 2, name: null }),
          category({ id: 4, name: "Alpha", isActive: false }),
          category({ id: 5, name: "Other", bucketId: 2 }),
        ],
        1,
      ),
    ).toEqual([
      { id: 2, name: "Unnamed" },
      { id: 3, name: "Zoo" },
    ]);
  });
});

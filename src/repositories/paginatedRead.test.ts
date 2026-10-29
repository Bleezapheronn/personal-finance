import { describe, expect, it } from "vitest";
import { appendMissingRowsById, loadAllPages } from "./paginatedRead";

describe("loadAllPages", () => {
  it("loads a second page when a lookup contains more than 500 rows", async () => {
    const rows = Array.from({ length: 506 }, (_, id) => ({ id: id + 1 }));
    const calls: Array<{ limit: number; offset: number }> = [];

    const loaded = await loadAllPages(
      async ({ limit, offset }) => {
        calls.push({ limit, offset });
        return { rows: rows.slice(offset, offset + limit), count: rows.length };
      },
      { pageSize: 500 },
    );

    expect(loaded).toHaveLength(506);
    expect(loaded.at(-1)).toEqual({ id: 506 });
    expect(calls).toEqual([
      { limit: 500, offset: 0 },
      { limit: 500, offset: 500 },
    ]);
  });

  it("fails instead of returning a silently truncated result", async () => {
    await expect(
      loadAllPages(
        async ({ offset }) => ({
          rows: offset === 0 ? [{ id: 1 }] : [],
          count: 2,
        }),
        { pageSize: 1 },
      ),
    ).rejects.toThrow("paged_read_incomplete");
  });

  it("preserves an edit form's selected lookup row with a detail fallback", async () => {
    const fetchedIds: number[] = [];
    const rows = await appendMissingRowsById(
      [{ id: 1, name: "First page recipient" }],
      [1, 502],
      async (id) => {
        fetchedIds.push(id);
        return id === 502 ? { id, name: "Page two recipient" } : undefined;
      },
    );

    expect(rows).toEqual([
      { id: 1, name: "First page recipient" },
      { id: 502, name: "Page two recipient" },
    ]);
    expect(fetchedIds).toEqual([502]);
  });
});

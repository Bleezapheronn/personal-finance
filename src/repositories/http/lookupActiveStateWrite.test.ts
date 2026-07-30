import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ localApiPost: vi.fn() }));

vi.mock("../../api/localApiClient", () => ({
  LocalApiError: class LocalApiError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  localApiPost: api.localApiPost,
}));

import { lookupActiveStateResource, writeLookupActiveState } from "./lookupActiveStateWrite";

describe("lookupActiveStateResource", () => {
  beforeEach(() => {
    api.localApiPost.mockReset();
  });

  it("uses the authoritative plural resource for every lifecycle entity", () => {
    expect(lookupActiveStateResource("account")).toBe("accounts");
    expect(lookupActiveStateResource("bucket")).toBe("buckets");
    expect(lookupActiveStateResource("category")).toBe("categories");
  });

  it("uses the categories route for the Category dry run and write", async () => {
    api.localApiPost
      .mockResolvedValueOnce({ ok: true, planFingerprint: "a".repeat(64) })
      .mockResolvedValueOnce({ ok: true, sqliteMutated: true });

    await writeLookupActiveState("category", 35, "deactivate");

    expect(api.localApiPost).toHaveBeenNthCalledWith(
      1,
      "/prototype/repositories/categories/active-state/dry-run/deactivate",
      { id: 35 },
    );
    expect(api.localApiPost).toHaveBeenNthCalledWith(
      2,
      "/prototype/repositories/categories/active-state/write/deactivate",
      expect.objectContaining({
        id: 35,
        confirmation: "deactivate category in authoritative sqlite",
      }),
    );
  });
});

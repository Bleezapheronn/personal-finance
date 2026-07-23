import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAccountImageUrls } from "./useAccountImageUrls";

const getImage = vi.fn();

vi.mock("../repositories/adapterSelection", () => ({
  getRepositoryBackend: () => "http-readonly",
}));

vi.mock("../repositories/selectedReadRepositories", () => ({
  getSelectedReadRepositories: () => ({
    accounts: { getImage },
  }),
}));

describe("useAccountImageUrls", () => {
  const createObjectUrl = vi.fn((_: Blob) => "blob:account-image");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    getImage.mockReset();
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("loads images, distinguishes missing images and records safe failures", async () => {
    getImage.mockImplementation(async (id: number) => {
      if (id === 1) return new Blob(["image"], { type: "image/png" });
      if (id === 2) return undefined;
      throw Object.assign(new Error("safe"), { code: "sqlite_unavailable" });
    });

    const { result, unmount } = renderHook(() =>
      useAccountImageUrls([{ id: 1 }, { id: 2 }, { id: 3 }]),
    );

    await waitFor(() => {
      expect(result.current.imageUrls.get(1)).toBe("blob:account-image");
      expect(result.current.imageUrls.has(2)).toBe(false);
      expect(result.current.errorCodes.get(3)).toBe("sqlite_unavailable");
    });

    act(() => unmount());
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:account-image");
  });
});

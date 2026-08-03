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

  test("invalidates and replaces cached image URLs after an image mutation", async () => {
    let version = 0;
    createObjectUrl.mockImplementation(() => `blob:account-image-${++version}`);
    getImage.mockResolvedValue(new Blob(["image"], { type: "image/png" }));

    const { result, unmount } = renderHook(() => useAccountImageUrls([{ id: 1 }]));

    await waitFor(() => {
      expect(result.current.imageUrls.get(1)).toBe("blob:account-image-1");
    });

    act(() => result.current.invalidate());

    await waitFor(() => {
      expect(result.current.imageUrls.get(1)).toBe("blob:account-image-2");
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:account-image-1");

    act(() => unmount());
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:account-image-2");
  });

  test("clears and revokes a removed image before the refreshed no-image read completes", async () => {
    getImage
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))
      .mockResolvedValueOnce(undefined);

    const { result, unmount } = renderHook(() => useAccountImageUrls([{ id: 1 }]));

    await waitFor(() => {
      expect(result.current.imageUrls.get(1)).toBe("blob:account-image");
    });

    act(() => result.current.invalidate());

    expect(result.current.imageUrls.has(1)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:account-image");

    await waitFor(() => {
      expect(result.current.imageUrls.has(1)).toBe(false);
      expect(result.current.errorCodes.has(1)).toBe(false);
    });

    act(() => unmount());
  });
});

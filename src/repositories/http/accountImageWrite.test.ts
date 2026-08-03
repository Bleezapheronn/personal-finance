import { beforeEach, describe, expect, test, vi } from "vitest";
import { LocalApiError, localApiPost } from "../../api/localApiClient";
import {
  applyAccountImageChange,
  serializeAccountImageFile,
} from "./accountImageWrite";

vi.mock("../../api/localApiClient", async () => {
  const actual = await vi.importActual<typeof import("../../api/localApiClient")>(
    "../../api/localApiClient",
  );
  return { ...actual, localApiPost: vi.fn() };
});

const post = vi.mocked(localApiPost);

describe("applyAccountImageChange", () => {
  beforeEach(() => {
    post.mockReset();
  });

  test("uses a dry-run fingerprint before removing an image", async () => {
    post
      .mockResolvedValueOnce({
        ok: true,
        entity: "accountImage",
        action: "remove",
        dryRun: true,
        planFingerprint: "plan-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        entity: "accountImage",
        action: "remove",
        sqliteMutated: true,
        rowsChanged: 1,
      });

    await applyAccountImageChange(7, { action: "remove" });

    expect(post).toHaveBeenNthCalledWith(
      1,
      "/prototype/repositories/accounts/images/dry-run/remove",
      { accountId: 7 },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/prototype/repositories/accounts/images/write/remove",
      {
        accountId: 7,
        dryRunReviewed: true,
        confirmation: "remove account image in local sqlite",
        expectedPlanFingerprint: "plan-1",
      },
    );
  });

  test("treats an already-removed image as a successful retry", async () => {
    post.mockRejectedValueOnce(
      new LocalApiError("account_image_not_found", "not found", 404),
    );

    await expect(
      applyAccountImageChange(7, { action: "remove" }),
    ).resolves.toBeUndefined();
  });

  test("rejects an unsupported selected file before mutation", async () => {
    const file = new File(["not an image"], "receipt.svg", {
      type: "image/svg+xml",
    });

    await expect(serializeAccountImageFile(file)).rejects.toMatchObject({
      code: "account_image_mime_unsupported",
    });
    expect(post).not.toHaveBeenCalled();
  });
});

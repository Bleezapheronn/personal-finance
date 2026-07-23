import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localApiGetBlob } from "./localApiClient";

describe("localApiGetBlob", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PERSONAL_FINANCE_LOCAL_API_URL", "http://127.0.0.1:3147");
    vi.stubEnv("VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("fetches authenticated image bytes without exposing the token in the URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["image"], { type: "image/png" }), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const image = await localApiGetBlob(
      "/prototype/repositories/accounts/2/image",
    );

    expect(image?.type).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3147/prototype/repositories/accounts/2/image",
      expect.objectContaining({
        headers: { "x-personal-finance-token": "test-token" },
      }),
    );
  });

  test("distinguishes a missing image from a request failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "account_image_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      localApiGetBlob("/prototype/repositories/accounts/2/image"),
    ).resolves.toBeUndefined();
  });

  test("rejects a successful non-image response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not an image", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      localApiGetBlob("/prototype/repositories/accounts/2/image"),
    ).rejects.toMatchObject({
      code: "local_api_image_content_type_invalid",
    });
  });
});

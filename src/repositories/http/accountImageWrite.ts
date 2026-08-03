import { LocalApiError, localApiPost } from "../../api/localApiClient";
import type { AccountImageChange } from "../../types/accountImage";

const MAX_ACCOUNT_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const confirmations = {
  set: "set account image in local sqlite",
  remove: "remove account image in local sqlite",
} as const;

interface SerializedAccountImage {
  __type: "Blob";
  mimeType: string;
  size: number;
  base64: string;
}

interface AccountImageMutationResponse {
  ok: boolean;
  code?: string;
  entity?: "accountImage";
  action?: "set" | "remove";
  dryRun?: boolean;
  sqliteMutated?: boolean;
  rowsChanged?: number;
  planFingerprint?: string;
}

const fileBase64 = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
};

export const serializeAccountImageFile = async (file: File): Promise<SerializedAccountImage> => {
  const mimeType = file.type.toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new LocalApiError("account_image_mime_unsupported", "Choose a GIF, JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_ACCOUNT_IMAGE_BYTES) {
    throw new LocalApiError("account_image_too_large", "Choose an image no larger than 5 MiB.");
  }
  return { __type: "Blob", mimeType, size: file.size, base64: await fileBase64(file) };
};

export const accountImageWriteErrorCode = (error: unknown): string =>
  error instanceof LocalApiError ? error.code : "account_image_write_failed";

const terminalStateReached = (action: AccountImageChange["action"], error: unknown): boolean => {
  const code = accountImageWriteErrorCode(error);
  return (action === "set" && code === "account_image_unchanged") ||
    (action === "remove" && code === "account_image_not_found");
};

export const applyAccountImageChange = async (
  accountId: number,
  change: AccountImageChange,
): Promise<void> => {
  const imageBlob = change.action === "set" ? await serializeAccountImageFile(change.file) : undefined;
  const dryPayload = { accountId, ...(imageBlob ? { imageBlob } : {}) };
  let dryRun: AccountImageMutationResponse;
  try {
    dryRun = await localApiPost<AccountImageMutationResponse>(
      `/prototype/repositories/accounts/images/dry-run/${change.action}`,
      dryPayload,
    );
  } catch (error) {
    if (terminalStateReached(change.action, error)) return;
    throw error;
  }
  if (dryRun.ok !== true || dryRun.entity !== "accountImage" || dryRun.action !== change.action || dryRun.dryRun !== true || typeof dryRun.planFingerprint !== "string") {
    throw new LocalApiError(dryRun.code ?? "account_image_dry_run_failed", "Account image dry-run failed.");
  }
  try {
    const write = await localApiPost<AccountImageMutationResponse>(
      `/prototype/repositories/accounts/images/write/${change.action}`,
      {
        ...dryPayload,
        dryRunReviewed: true,
        confirmation: confirmations[change.action],
        expectedPlanFingerprint: dryRun.planFingerprint,
      },
    );
    if (write.ok !== true || write.sqliteMutated !== true || write.rowsChanged !== 1) {
      throw new LocalApiError(write.code ?? "account_image_write_failed", "Account image update failed.");
    }
  } catch (error) {
    if (terminalStateReached(change.action, error)) return;
    throw error;
  }
};

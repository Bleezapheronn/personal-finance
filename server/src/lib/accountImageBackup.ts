import { isPlainObject, type BackupRecord } from "./backup.js";

const MAX_ACCOUNT_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_ACCOUNT_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface DecodedAccountImage {
  bytes: Buffer;
  mimeType: string;
}

export class AccountImageDecodeError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "AccountImageDecodeError";
    this.code = code;
  }
}

export const decodeBackupAccountImage = (
  record: BackupRecord,
): DecodedAccountImage | undefined => {
  const value = record.imageBlob;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    !isPlainObject(value) ||
    value.__type !== "Blob" ||
    typeof value.mimeType !== "string" ||
    typeof value.size !== "number" ||
    !Number.isInteger(value.size) ||
    value.size < 0 ||
    typeof value.base64 !== "string"
  ) {
    throw new AccountImageDecodeError("account_image_blob_shape_invalid");
  }

  const mimeType = value.mimeType.toLowerCase();
  if (!SUPPORTED_ACCOUNT_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new AccountImageDecodeError("account_image_mime_unsupported");
  }

  if (
    value.size > MAX_ACCOUNT_IMAGE_BYTES ||
    value.base64.length > Math.ceil(MAX_ACCOUNT_IMAGE_BYTES / 3) * 4 + 4
  ) {
    throw new AccountImageDecodeError("account_image_too_large");
  }

  if (!BASE64_PATTERN.test(value.base64)) {
    throw new AccountImageDecodeError("account_image_base64_invalid");
  }

  const bytes = Buffer.from(value.base64, "base64");
  if (bytes.length !== value.size) {
    throw new AccountImageDecodeError("account_image_size_mismatch");
  }

  return { bytes, mimeType };
};

export const accountImageMaxBytes = MAX_ACCOUNT_IMAGE_BYTES;

export const isSupportedAccountImageMimeType = (value: unknown): value is string =>
  typeof value === "string" &&
  SUPPORTED_ACCOUNT_IMAGE_MIME_TYPES.has(value.toLowerCase());

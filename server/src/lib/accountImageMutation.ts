import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  AccountImageDecodeError,
  decodeSerializedAccountImage,
  type DecodedAccountImage,
} from "./accountImageBackup.js";

export const ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS = {
  set: "set account image in local sqlite",
  remove: "remove account image in local sqlite",
} as const;

export type AccountImageMutationAction = keyof typeof ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS;

interface StoredImage {
  bytes: Buffer | null;
  mimeType: string | null;
}

interface NormalizedInput {
  action: AccountImageMutationAction;
  accountId: number;
  image?: DecodedAccountImage;
  expectedPlanFingerprint?: string;
}

interface ImagePlan {
  input: NormalizedInput;
  account?: Record<string, unknown>;
  currentImage: StoredImage;
  validationErrors: string[];
  planFingerprint?: string;
}

export interface AccountImageMutationResponse {
  ok: boolean;
  mode: "prototype";
  entity: "accountImage";
  action: AccountImageMutationAction;
  accountId: number | null;
  accountPresent: boolean;
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  rowsChanged: number;
  currentImagePresent: boolean;
  nextImagePresent: boolean;
  currentImageMimeType: string | null;
  nextImageMimeType: string | null;
  currentImageBytes: number;
  nextImageBytes: number;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  resultCodes: string[];
  code?: string;
}

export class AccountImageMutationRequestError extends Error {
  statusCode = 400 as const;

  constructor(public readonly code: string) {
    super(code);
  }
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const bytesFingerprint = (bytes: Buffer | null): string | null =>
  bytes === null ? null : createHash("sha256").update(bytes).digest("hex");

const hasExpectedImageSignature = (image: DecodedAccountImage): boolean => {
  const { bytes, mimeType } = image;
  if (mimeType === "image/gif") {
    return bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) ||
      bytes.subarray(0, 6).equals(Buffer.from("GIF89a"));
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
      bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  }
  return false;
};

const positiveInteger = (value: unknown, code: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AccountImageMutationRequestError(code);
  }
  return value;
};

const allowedFields = (action: AccountImageMutationAction, write: boolean): Set<string> =>
  new Set([
    "accountId",
    ...(action === "set" ? ["imageBlob"] : []),
    ...(write ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"] : []),
  ]);

const normalizePayload = (
  payload: unknown,
  action: AccountImageMutationAction,
  write: boolean,
): NormalizedInput => {
  if (!isPlainObject(payload)) {
    throw new AccountImageMutationRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new AccountImageMutationRequestError("unexpected_payload_field");
  }
  const input: NormalizedInput = {
    action,
    accountId: positiveInteger(payload.accountId, "account_id_invalid"),
  };
  if (action === "set") {
    try {
      const image = decodeSerializedAccountImage(payload.imageBlob);
      if (!image) throw new AccountImageMutationRequestError("account_image_required");
      if (!hasExpectedImageSignature(image)) {
        throw new AccountImageMutationRequestError("account_image_content_signature_invalid");
      }
      input.image = image;
    } catch (error) {
      if (error instanceof AccountImageMutationRequestError) throw error;
      if (error instanceof AccountImageDecodeError) {
        throw new AccountImageMutationRequestError(error.code);
      }
      throw error;
    }
  }
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new AccountImageMutationRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== ACCOUNT_IMAGE_MUTATION_CONFIRMATIONS[action]) {
      throw new AccountImageMutationRequestError("matching_dry_run_required");
    }
    if (typeof payload.expectedPlanFingerprint !== "string" || !SHA256_HEX.test(payload.expectedPlanFingerprint)) {
      throw new AccountImageMutationRequestError("expected_account_image_plan_required");
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }
  return input;
};

export const validateAccountImageMutationPayload = (
  payload: unknown,
  action: AccountImageMutationAction,
  write: boolean,
): NormalizedInput => normalizePayload(payload, action, write);

const readAccount = (db: Database.Database, accountId: number): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM accounts WHERE id = @accountId").get({ accountId }) as
    | Record<string, unknown>
    | undefined;

const storedImage = (account?: Record<string, unknown>): StoredImage => ({
  bytes: Buffer.isBuffer(account?.imageBlob) ? account.imageBlob : null,
  mimeType: typeof account?.imageMimeType === "string" ? account.imageMimeType.toLowerCase() : null,
});

const imagePresent = (image: StoredImage): boolean =>
  image.bytes !== null && image.bytes.length > 0 && image.mimeType !== null;

const planFor = (db: Database.Database, input: NormalizedInput): ImagePlan => {
  const account = readAccount(db, input.accountId);
  const currentImage = storedImage(account);
  const validationErrors: string[] = [];
  if (!account) validationErrors.push("account_not_found");
  if (account && input.action === "remove" && !imagePresent(currentImage)) {
    validationErrors.push("account_image_not_found");
  }
  if (account && input.action === "set" && input.image && currentImage.bytes?.equals(input.image.bytes) && currentImage.mimeType === input.image.mimeType) {
    validationErrors.push("account_image_unchanged");
  }
  const state = account === undefined ? undefined : {
    action: input.action,
    accountId: input.accountId,
    accountUpdatedAt: account.updatedAt,
    currentImage: {
      present: imagePresent(currentImage),
      mimeType: currentImage.mimeType,
      byteCount: currentImage.bytes?.length ?? 0,
      sha256: bytesFingerprint(currentImage.bytes),
    },
    proposedImage: input.action === "set" && input.image ? {
      mimeType: input.image.mimeType,
      byteCount: input.image.bytes.length,
      sha256: bytesFingerprint(input.image.bytes),
    } : null,
  };
  return {
    input,
    account,
    currentImage,
    validationErrors,
    ...(validationErrors.length === 0 && state ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const response = (
  plan: ImagePlan,
  options: { dryRun: boolean; sqliteMutated?: boolean; rowsChanged?: number; code?: string },
): AccountImageMutationResponse => {
  const nextImage = plan.input.action === "set" ? plan.input.image : undefined;
  const validationErrors = [...plan.validationErrors];
  const sqliteMutated = options.sqliteMutated === true;
  const code = options.code ?? validationErrors[0];
  return {
    ok: validationErrors.length === 0 && (options.dryRun || sqliteMutated),
    mode: "prototype",
    entity: "accountImage",
    action: plan.input.action,
    accountId: plan.account ? plan.input.accountId : null,
    accountPresent: Boolean(plan.account),
    dryRun: options.dryRun,
    wouldMutate: options.dryRun && validationErrors.length === 0,
    sqliteMutated,
    rowsChanged: options.rowsChanged ?? 0,
    currentImagePresent: imagePresent(plan.currentImage),
    nextImagePresent: plan.input.action === "set",
    currentImageMimeType: plan.currentImage.mimeType,
    nextImageMimeType: nextImage?.mimeType ?? null,
    currentImageBytes: plan.currentImage.bytes?.length ?? 0,
    nextImageBytes: nextImage?.bytes.length ?? 0,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    validationErrors,
    warnings: validationErrors.length === 0 ? ["account_image_bytes_not_returned", "related_records_not_mutated"] : [],
    resultCodes: [
      validationErrors.length === 0 ? options.dryRun ? "dry_run_valid" : "account_image_mutated" : "mutation_has_validation_errors",
      ...(sqliteMutated ? ["sqlite_mutated"] : ["no_mutation_performed"]),
    ],
    ...(code ? { code } : {}),
  };
};

export const accountImageMutationDryRun = (
  db: Database.Database,
  payload: unknown,
  action: AccountImageMutationAction,
): AccountImageMutationResponse => response(
  planFor(db, validateAccountImageMutationPayload(payload, action, false)),
  { dryRun: true },
);

export const accountImageMutationRequestErrorResponse = (
  action: AccountImageMutationAction,
  code: string,
): AccountImageMutationResponse => response({
  input: { action, accountId: 0 },
  currentImage: { bytes: null, mimeType: null },
  validationErrors: [code],
}, { dryRun: true, code });

const nextTimestamp = (previous: unknown): string => {
  const now = Date.now();
  const previousTime = typeof previous === "string" ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) && previousTime >= now ? previousTime + 1 : now).toISOString();
};

export const accountImageMutationWrite = (
  db: Database.Database,
  payload: unknown,
  action: AccountImageMutationAction,
): AccountImageMutationResponse => {
  const input = validateAccountImageMutationPayload(payload, action, true);
  const plan = planFor(db, input);
  if (plan.validationErrors.length > 0) return response(plan, { dryRun: false });
  if (plan.planFingerprint !== input.expectedPlanFingerprint) {
    return response({ ...plan, validationErrors: ["account_image_plan_stale"] }, {
      dryRun: false,
      code: "account_image_plan_stale",
    });
  }
  return db.transaction(() => {
    const before = readAccount(db, input.accountId);
    const result = db.prepare(
      `UPDATE accounts
       SET imageBlob = @imageBlob, imageMimeType = @imageMimeType, updatedAt = @updatedAt
       WHERE id = @accountId`,
    ).run({
      accountId: input.accountId,
      imageBlob: input.action === "set" ? input.image!.bytes : null,
      imageMimeType: input.action === "set" ? input.image!.mimeType : null,
      updatedAt: nextTimestamp(plan.account?.updatedAt),
    });
    const after = readAccount(db, input.accountId);
    if (result.changes !== 1 || !before || !after) throw new Error("account_image_write_failed");
    for (const field of Object.keys(before)) {
      if (["imageBlob", "imageMimeType", "updatedAt"].includes(field)) continue;
      if (serialized(before[field]) !== serialized(after[field])) {
        throw new Error("account_image_non_image_field_changed");
      }
    }
    return response(plan, { dryRun: false, sqliteMutated: true, rowsChanged: 1 });
  })();
};

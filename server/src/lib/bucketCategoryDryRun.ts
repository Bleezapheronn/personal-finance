import Database from "better-sqlite3";

export type BucketCategoryEntity = "bucket" | "category";
export type BucketCategoryAction = "create" | "update";

const BUCKET_CREATE_FIELDS = new Set([
  "name",
  "description",
  "minPercentage",
  "maxPercentage",
  "minFixedAmount",
  "excludeFromReports",
]);
const BUCKET_UPDATE_FIELDS = new Set([...BUCKET_CREATE_FIELDS, "id"]);
const CATEGORY_CREATE_FIELDS = new Set(["name", "bucketId", "description"]);
const CATEGORY_UPDATE_FIELDS = new Set([...CATEGORY_CREATE_FIELDS, "id"]);
const FORBIDDEN_ACTION_FIELDS = new Set([
  "delete",
  "deleteId",
  "merge",
  "mergeId",
  "displayOrder",
  "isActive",
]);

export interface NormalizedBucketInput {
  id?: number;
  name: string;
  description: string | null;
  minPercentage: number;
  maxPercentage: number;
  minFixedAmount: number | null;
  excludeFromReports: boolean;
}

export interface NormalizedCategoryInput {
  id?: number;
  name: string;
  bucketId: number;
  description: string | null;
}

export interface BucketCategoryDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: BucketCategoryEntity;
  action: BucketCategoryAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  targetId: number | null;
  validationErrors: string[];
  warnings: string[];
  duplicateSummary: {
    duplicateNameCandidates: number;
  };
  normalizedFieldPresence: {
    hasName: boolean;
    hasDescription: boolean;
    hasMinFixedAmount: boolean;
    hasBucketReference: boolean;
    hasReportExclusionFlag: boolean;
  };
  timestampBehavior: {
    createdAtWouldChange: boolean;
    updatedAtWouldChange: boolean;
    createdAtPreserved: boolean;
  };
  affectedSummary: {
    bucketRowsWouldChange: 0;
    categoryRowsWouldChange: 0;
    transactionRowsWouldChange: 0;
    budgetRowsWouldChange: 0;
    budgetSnapshotRowsWouldChange: 0;
  };
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BucketCategoryDryRunRequestError extends Error {
  statusCode: 400;
  code: string;

  constructor(code: string) {
    super(code);
    this.statusCode = 400;
    this.code = code;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const validateFields = (
  payload: unknown,
  allowedFields: Set<string>,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new BucketCategoryDryRunRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new BucketCategoryDryRunRequestError("unsupported_write_field");
    }
    if (!allowedFields.has(field)) {
      throw new BucketCategoryDryRunRequestError("unexpected_payload_field");
    }
  }

  return payload;
};

const normalizePositiveInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

const normalizeRequiredText = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_required`);
  }
  return normalized;
};

const normalizeOptionalText = (value: unknown, fieldName: string): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  const normalized = value.trim();
  return normalized || null;
};

const normalizeNumber = (
  value: unknown,
  fieldName: string,
  defaultValue: number,
): number => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

const normalizeOptionalNumber = (
  value: unknown,
  fieldName: string,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

const normalizeBoolean = (
  value: unknown,
  fieldName: string,
  defaultValue: boolean,
): boolean => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new BucketCategoryDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

export const normalizeBucketPayload = (
  payload: unknown,
  action: BucketCategoryAction,
): NormalizedBucketInput => {
  const input = validateFields(
    payload,
    action === "create" ? BUCKET_CREATE_FIELDS : BUCKET_UPDATE_FIELDS,
  );
  const minPercentage = normalizeNumber(input.minPercentage, "minPercentage", 0);
  const maxPercentage = normalizeNumber(input.maxPercentage, "maxPercentage", 100);
  const minFixedAmount = normalizeOptionalNumber(
    input.minFixedAmount,
    "minFixedAmount",
  );

  if (
    minPercentage < 0 ||
    minPercentage > 100 ||
    maxPercentage < 0 ||
    maxPercentage > 100
  ) {
    throw new BucketCategoryDryRunRequestError("percentage_out_of_range");
  }
  if (minPercentage > maxPercentage) {
    throw new BucketCategoryDryRunRequestError(
      "min_percentage_greater_than_max_percentage",
    );
  }
  if (minFixedAmount !== null && minFixedAmount < 0) {
    throw new BucketCategoryDryRunRequestError("min_fixed_amount_negative");
  }

  return {
    ...(action === "update"
      ? { id: normalizePositiveInteger(input.id, "id") }
      : {}),
    name: normalizeRequiredText(input.name, "name"),
    description: normalizeOptionalText(input.description, "description"),
    minPercentage,
    maxPercentage,
    minFixedAmount,
    excludeFromReports: normalizeBoolean(
      input.excludeFromReports,
      "excludeFromReports",
      false,
    ),
  };
};

export const normalizeCategoryPayload = (
  payload: unknown,
  action: BucketCategoryAction,
): NormalizedCategoryInput => {
  const input = validateFields(
    payload,
    action === "create" ? CATEGORY_CREATE_FIELDS : CATEGORY_UPDATE_FIELDS,
  );

  return {
    ...(action === "update"
      ? { id: normalizePositiveInteger(input.id, "id") }
      : {}),
    name: normalizeRequiredText(input.name, "name"),
    bucketId: normalizePositiveInteger(input.bucketId, "bucketId"),
    description: normalizeOptionalText(input.description, "description"),
  };
};

const countByName = (
  db: Database.Database,
  tableName: "buckets" | "categories",
  name: string,
  excludedId?: number,
): number => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ${tableName}
       WHERE LOWER(TRIM(COALESCE(name, ''))) = LOWER(@name)
         AND (@excludedId IS NULL OR id <> @excludedId)`,
    )
    .get({ name, excludedId: excludedId ?? null }) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
};

const rowExists = (
  db: Database.Database,
  tableName: "buckets" | "categories",
  id: number,
): boolean =>
  db.prepare(`SELECT id FROM ${tableName} WHERE id = @id`).get({ id }) !==
  undefined;

const response = (input: {
  entity: BucketCategoryEntity;
  action: BucketCategoryAction;
  targetId: number | null;
  validationErrors?: string[];
  warnings?: string[];
  duplicateNameCandidates?: number;
  hasName?: boolean;
  hasDescription?: boolean;
  hasMinFixedAmount?: boolean;
  hasBucketReference?: boolean;
  hasReportExclusionFlag?: boolean;
  code?: string;
}): BucketCategoryDryRunResponse => {
  const validationErrors = input.validationErrors ?? [];
  const warnings = input.warnings ?? [];
  const resultCodes = [
    validationErrors.length > 0 ? "dry_run_has_validation_errors" : "dry_run_valid",
    ...(warnings.length > 0 ? ["dry_run_has_warnings"] : []),
    "no_mutation_performed",
  ];

  return {
    ok: validationErrors.length === 0,
    mode: "prototype",
    entity: input.entity,
    action: input.action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    validationErrors,
    warnings,
    duplicateSummary: {
      duplicateNameCandidates: input.duplicateNameCandidates ?? 0,
    },
    normalizedFieldPresence: {
      hasName: input.hasName ?? false,
      hasDescription: input.hasDescription ?? false,
      hasMinFixedAmount: input.hasMinFixedAmount ?? false,
      hasBucketReference: input.hasBucketReference ?? false,
      hasReportExclusionFlag: input.hasReportExclusionFlag ?? false,
    },
    timestampBehavior: {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: input.action === "update",
    },
    affectedSummary: {
      bucketRowsWouldChange: 0,
      categoryRowsWouldChange: 0,
      transactionRowsWouldChange: 0,
      budgetRowsWouldChange: 0,
      budgetSnapshotRowsWouldChange: 0,
    },
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const bucketDryRun = (
  db: Database.Database,
  payload: unknown,
  action: BucketCategoryAction,
): BucketCategoryDryRunResponse => {
  const normalized = normalizeBucketPayload(payload, action);
  const validationErrors: string[] = [];
  const warnings = [
    "bucket_fields_affect_report_and_budget_semantics",
    "related_transactions_budgets_and_snapshots_not_mutated",
  ];
  const targetId = action === "update" ? normalized.id ?? null : null;

  if (
    action === "update" &&
    normalized.id !== undefined &&
    !rowExists(db, "buckets", normalized.id)
  ) {
    validationErrors.push("bucket_not_found");
  }
  const duplicateNameCandidates = countByName(
    db,
    "buckets",
    normalized.name,
    normalized.id,
  );
  if (duplicateNameCandidates > 0) {
    warnings.push("duplicate_name_candidates_present");
  }
  if (normalized.excludeFromReports) {
    warnings.push("income_bucket_classification_may_change");
  }

  return response({
    entity: "bucket",
    action,
    targetId,
    validationErrors,
    warnings,
    duplicateNameCandidates,
    hasName: true,
    hasDescription: normalized.description !== null,
    hasMinFixedAmount: normalized.minFixedAmount !== null,
    hasReportExclusionFlag: true,
    code: validationErrors[0],
  });
};

export const categoryDryRun = (
  db: Database.Database,
  payload: unknown,
  action: BucketCategoryAction,
): BucketCategoryDryRunResponse => {
  const normalized = normalizeCategoryPayload(payload, action);
  const validationErrors: string[] = [];
  const warnings = [
    "category_bucket_link_affects_report_and_budget_semantics",
    "related_transactions_budgets_and_snapshots_not_mutated",
  ];
  const targetId = action === "update" ? normalized.id ?? null : null;

  if (
    action === "update" &&
    normalized.id !== undefined &&
    !rowExists(db, "categories", normalized.id)
  ) {
    validationErrors.push("category_not_found");
  }
  if (!rowExists(db, "buckets", normalized.bucketId)) {
    validationErrors.push("bucket_not_found");
  }
  const duplicateNameCandidates = countByName(
    db,
    "categories",
    normalized.name,
    normalized.id,
  );
  if (duplicateNameCandidates > 0) {
    warnings.push("duplicate_name_candidates_present");
  }

  return response({
    entity: "category",
    action,
    targetId,
    validationErrors,
    warnings,
    duplicateNameCandidates,
    hasName: true,
    hasDescription: normalized.description !== null,
    hasBucketReference: true,
    code: validationErrors[0],
  });
};

export const bucketCategoryDryRunRequestErrorResponse = (
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
  code: string,
): BucketCategoryDryRunResponse =>
  response({
    entity,
    action,
    targetId: null,
    validationErrors: [code],
    code,
  });

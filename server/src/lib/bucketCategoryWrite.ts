import Database from "better-sqlite3";
import {
  bucketDryRun,
  type BucketCategoryAction,
  type BucketCategoryDryRunResponse,
  type BucketCategoryEntity,
  categoryDryRun,
  normalizeBucketPayload,
  normalizeCategoryPayload,
  type NormalizedBucketInput,
  type NormalizedCategoryInput,
} from "./bucketCategoryDryRun.js";

export const BUCKET_CREATE_WRITE_CONFIRMATION =
  "create bucket in disposable sqlite" as const;
export const BUCKET_UPDATE_WRITE_CONFIRMATION =
  "update bucket in disposable sqlite" as const;
export const CATEGORY_CREATE_WRITE_CONFIRMATION =
  "create category in disposable sqlite" as const;
export const CATEGORY_UPDATE_WRITE_CONFIRMATION =
  "update category in disposable sqlite" as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
const BUCKET_DATA_FIELDS = new Set([
  "id",
  "name",
  "description",
  "minPercentage",
  "maxPercentage",
  "minFixedAmount",
  "excludeFromReports",
]);
const CATEGORY_DATA_FIELDS = new Set(["id", "name", "bucketId", "description"]);

export interface BucketCategoryWriteResponse {
  ok: boolean;
  mode: "prototype";
  entity: BucketCategoryEntity;
  action: BucketCategoryAction;
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  targetIdPresent: boolean;
  targetId: number | null;
  validationErrors: string[];
  warnings: string[];
  duplicateSummary: {
    duplicateNameCandidates: number;
  };
  normalizedFieldPresence: BucketCategoryDryRunResponse["normalizedFieldPresence"];
  timestampBehavior: BucketCategoryDryRunResponse["timestampBehavior"];
  affectedSummary: {
    bucketRowsChanged: number;
    categoryRowsChanged: number;
    transactionRowsChanged: 0;
    budgetRowsChanged: 0;
    budgetSnapshotRowsChanged: 0;
  };
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BucketCategoryWriteRequestError extends Error {
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

const confirmationFor = (
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
): string => {
  if (entity === "bucket") {
    return action === "create"
      ? BUCKET_CREATE_WRITE_CONFIRMATION
      : BUCKET_UPDATE_WRITE_CONFIRMATION;
  }
  return action === "create"
    ? CATEGORY_CREATE_WRITE_CONFIRMATION
    : CATEGORY_UPDATE_WRITE_CONFIRMATION;
};

export const validateBucketCategoryWritePayload = (
  payload: unknown,
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new BucketCategoryWriteRequestError("payload_must_be_object");
  }

  const allowedDataFields =
    entity === "bucket" ? BUCKET_DATA_FIELDS : CATEGORY_DATA_FIELDS;
  for (const field of Object.keys(payload)) {
    if (!allowedDataFields.has(field) && !CONTROL_FIELDS.has(field)) {
      throw new BucketCategoryWriteRequestError("unexpected_payload_field");
    }
    if (action === "create" && field === "id") {
      throw new BucketCategoryWriteRequestError("unexpected_payload_field");
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new BucketCategoryWriteRequestError("dry_run_reviewed_required");
  }
  if (payload.confirmation !== confirmationFor(entity, action)) {
    throw new BucketCategoryWriteRequestError("matching_dry_run_required");
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => allowedDataFields.has(field)),
  );
};

const tableRows = (
  db: Database.Database,
  tableName: "buckets" | "categories" | "transactions" | "budgets" | "budgetSnapshots",
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${tableName} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const serialized = (rows: Record<string, unknown>[]): string =>
  JSON.stringify(rows);

const withoutId = (
  rows: Record<string, unknown>[],
  id: number,
): Record<string, unknown>[] => rows.filter((row) => row.id !== id);

const nextTimestamp = (previous?: string): string => {
  const now = new Date();
  if (!previous) {
    return now.toISOString();
  }
  const previousTime = Date.parse(previous);
  return Number.isFinite(previousTime) && now.getTime() <= previousTime
    ? new Date(previousTime + 1).toISOString()
    : now.toISOString();
};

const writeResponse = (input: {
  entity: BucketCategoryEntity;
  action: BucketCategoryAction;
  dryRun?: BucketCategoryDryRunResponse;
  targetId: number | null;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes: string[];
  code?: string;
}): BucketCategoryWriteResponse => {
  const dryRun = input.dryRun;
  return {
    ok: (input.validationErrors ?? []).length === 0 && input.resultCodes.includes("sqlite_mutated"),
    mode: "prototype",
    entity: input.entity,
    action: input.action,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    validationErrors: input.validationErrors ?? [],
    warnings: input.warnings ?? dryRun?.warnings ?? [],
    duplicateSummary: dryRun?.duplicateSummary ?? {
      duplicateNameCandidates: 0,
    },
    normalizedFieldPresence: dryRun?.normalizedFieldPresence ?? {
      hasName: false,
      hasDescription: false,
      hasMinFixedAmount: false,
      hasBucketReference: false,
      hasReportExclusionFlag: false,
    },
    timestampBehavior: dryRun?.timestampBehavior ?? {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: input.action === "update",
    },
    affectedSummary: {
      bucketRowsChanged: input.entity === "bucket" ? input.rowsChanged : 0,
      categoryRowsChanged: input.entity === "category" ? input.rowsChanged : 0,
      transactionRowsChanged: 0,
      budgetRowsChanged: 0,
      budgetSnapshotRowsChanged: 0,
    },
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: input.resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const bucketCategoryWriteDisabledResponse = (
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
): BucketCategoryWriteResponse =>
  writeResponse({
    entity,
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: ["bucket_category_writes_disabled"],
    resultCodes: ["bucket_category_writes_disabled", "no_mutation_performed"],
    code: "bucket_category_writes_disabled",
  });

export const bucketCategoryWriteRequestErrorResponse = (
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
  code: string,
): BucketCategoryWriteResponse =>
  writeResponse({
    entity,
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

const assertRelatedTablesUnchanged = (
  db: Database.Database,
  before: Record<string, string>,
): void => {
  for (const tableName of ["transactions", "budgets", "budgetSnapshots"] as const) {
    if (serialized(tableRows(db, tableName)) !== before[tableName]) {
      throw new Error("bucket_category_related_table_boundary_failed");
    }
  }
};

const createBucket = (
  db: Database.Database,
  input: NormalizedBucketInput,
  dryRun: BucketCategoryDryRunResponse,
): BucketCategoryWriteResponse => {
  const bucketRowsBefore = tableRows(db, "buckets");
  const categoryRowsBefore = serialized(tableRows(db, "categories"));
  const relatedBefore = {
    transactions: serialized(tableRows(db, "transactions")),
    budgets: serialized(tableRows(db, "budgets")),
    budgetSnapshots: serialized(tableRows(db, "budgetSnapshots")),
  };
  const timestamp = nextTimestamp();
  const result = db
    .prepare(
      `INSERT INTO buckets (
        name, description, minPercentage, maxPercentage, minFixedAmount,
        isActive, displayOrder, excludeFromReports, createdAt, updatedAt
      ) VALUES (
        @name, @description, @minPercentage, @maxPercentage, @minFixedAmount,
        1, @displayOrder, @excludeFromReports, @createdAt, @updatedAt
      )`,
    )
    .run({
      ...input,
      displayOrder: bucketRowsBefore.length,
      excludeFromReports: input.excludeFromReports ? 1 : 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  const targetId = Number(result.lastInsertRowid);
  const bucketRowsAfter = tableRows(db, "buckets");

  if (
    result.changes !== 1 ||
    bucketRowsAfter.length !== bucketRowsBefore.length + 1 ||
    serialized(withoutId(bucketRowsAfter, targetId)) !== serialized(bucketRowsBefore) ||
    serialized(tableRows(db, "categories")) !== categoryRowsBefore
  ) {
    throw new Error("bucket_create_write_invariant_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return writeResponse({
    entity: "bucket",
    action: "create",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["bucket_created", "sqlite_mutated"],
  });
};

const updateBucket = (
  db: Database.Database,
  input: NormalizedBucketInput,
  dryRun: BucketCategoryDryRunResponse,
): BucketCategoryWriteResponse => {
  const targetId = input.id!;
  const bucketRowsBefore = tableRows(db, "buckets");
  const previous = bucketRowsBefore.find((row) => row.id === targetId);
  if (!previous) {
    return writeResponse({
      entity: "bucket",
      action: "update",
      dryRun,
      targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: ["bucket_not_found"],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: "bucket_not_found",
    });
  }
  const categoryRowsBefore = serialized(tableRows(db, "categories"));
  const relatedBefore = {
    transactions: serialized(tableRows(db, "transactions")),
    budgets: serialized(tableRows(db, "budgets")),
    budgetSnapshots: serialized(tableRows(db, "budgetSnapshots")),
  };
  const result = db
    .prepare(
      `UPDATE buckets
       SET name = @name,
           description = @description,
           minPercentage = @minPercentage,
           maxPercentage = @maxPercentage,
           minFixedAmount = @minFixedAmount,
           excludeFromReports = @excludeFromReports,
           updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run({
      ...input,
      excludeFromReports: input.excludeFromReports ? 1 : 0,
      updatedAt: nextTimestamp(String(previous.updatedAt)),
    });
  const bucketRowsAfter = tableRows(db, "buckets");
  const next = bucketRowsAfter.find((row) => row.id === targetId);

  if (
    result.changes !== 1 ||
    bucketRowsAfter.length !== bucketRowsBefore.length ||
    !next ||
    serialized(withoutId(bucketRowsAfter, targetId)) !==
      serialized(withoutId(bucketRowsBefore, targetId)) ||
    previous.createdAt !== next.createdAt ||
    previous.displayOrder !== next.displayOrder ||
    previous.isActive !== next.isActive ||
    serialized(tableRows(db, "categories")) !== categoryRowsBefore
  ) {
    throw new Error("bucket_update_write_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return writeResponse({
    entity: "bucket",
    action: "update",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["bucket_updated", "sqlite_mutated"],
  });
};

const createCategory = (
  db: Database.Database,
  input: NormalizedCategoryInput,
  dryRun: BucketCategoryDryRunResponse,
): BucketCategoryWriteResponse => {
  const categoryRowsBefore = tableRows(db, "categories");
  const bucketRowsBefore = serialized(tableRows(db, "buckets"));
  const relatedBefore = {
    transactions: serialized(tableRows(db, "transactions")),
    budgets: serialized(tableRows(db, "budgets")),
    budgetSnapshots: serialized(tableRows(db, "budgetSnapshots")),
  };
  const timestamp = nextTimestamp();
  const result = db
    .prepare(
      `INSERT INTO categories (
        name, bucketId, description, isActive, createdAt, updatedAt
      ) VALUES (
        @name, @bucketId, @description, 1, @createdAt, @updatedAt
      )`,
    )
    .run({ ...input, createdAt: timestamp, updatedAt: timestamp });
  const targetId = Number(result.lastInsertRowid);
  const categoryRowsAfter = tableRows(db, "categories");

  if (
    result.changes !== 1 ||
    categoryRowsAfter.length !== categoryRowsBefore.length + 1 ||
    serialized(withoutId(categoryRowsAfter, targetId)) !==
      serialized(categoryRowsBefore) ||
    serialized(tableRows(db, "buckets")) !== bucketRowsBefore
  ) {
    throw new Error("category_create_write_invariant_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return writeResponse({
    entity: "category",
    action: "create",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["category_created", "sqlite_mutated"],
  });
};

const updateCategory = (
  db: Database.Database,
  input: NormalizedCategoryInput,
  dryRun: BucketCategoryDryRunResponse,
): BucketCategoryWriteResponse => {
  const targetId = input.id!;
  const categoryRowsBefore = tableRows(db, "categories");
  const previous = categoryRowsBefore.find((row) => row.id === targetId);
  if (!previous) {
    return writeResponse({
      entity: "category",
      action: "update",
      dryRun,
      targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: ["category_not_found"],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: "category_not_found",
    });
  }
  const bucketRowsBefore = serialized(tableRows(db, "buckets"));
  const relatedBefore = {
    transactions: serialized(tableRows(db, "transactions")),
    budgets: serialized(tableRows(db, "budgets")),
    budgetSnapshots: serialized(tableRows(db, "budgetSnapshots")),
  };
  const result = db
    .prepare(
      `UPDATE categories
       SET name = @name,
           bucketId = @bucketId,
           description = @description,
           updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run({ ...input, updatedAt: nextTimestamp(String(previous.updatedAt)) });
  const categoryRowsAfter = tableRows(db, "categories");
  const next = categoryRowsAfter.find((row) => row.id === targetId);

  if (
    result.changes !== 1 ||
    categoryRowsAfter.length !== categoryRowsBefore.length ||
    !next ||
    serialized(withoutId(categoryRowsAfter, targetId)) !==
      serialized(withoutId(categoryRowsBefore, targetId)) ||
    previous.createdAt !== next.createdAt ||
    previous.isActive !== next.isActive ||
    serialized(tableRows(db, "buckets")) !== bucketRowsBefore
  ) {
    throw new Error("category_update_write_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return writeResponse({
    entity: "category",
    action: "update",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["category_updated", "sqlite_mutated"],
  });
};

export const bucketCategoryRealWrite = (
  db: Database.Database,
  payload: unknown,
  entity: BucketCategoryEntity,
  action: BucketCategoryAction,
): BucketCategoryWriteResponse => {
  const dataPayload = validateBucketCategoryWritePayload(payload, entity, action);
  const dryRun =
    entity === "bucket"
      ? bucketDryRun(db, dataPayload, action)
      : categoryDryRun(db, dataPayload, action);

  if (!dryRun.ok) {
    return writeResponse({
      entity,
      action,
      dryRun,
      targetId: dryRun.targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: dryRun.validationErrors,
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: dryRun.code ?? dryRun.validationErrors[0],
    });
  }

  const transaction = db.transaction(() => {
    if (entity === "bucket") {
      const normalized = normalizeBucketPayload(dataPayload, action);
      return action === "create"
        ? createBucket(db, normalized, dryRun)
        : updateBucket(db, normalized, dryRun);
    }
    const normalized = normalizeCategoryPayload(dataPayload, action);
    return action === "create"
      ? createCategory(db, normalized, dryRun)
      : updateCategory(db, normalized, dryRun);
  });

  return transaction();
};

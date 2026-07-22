import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const BUCKET_LIFECYCLE_CONFIRMATIONS = {
  delete: "delete unused bucket from disposable sqlite",
  merge: "merge bucket references in disposable sqlite",
} as const;

export const BUCKET_REFERENCE_FIELDS = [
  {
    table: "categories",
    field: "bucketId",
    nullable: false,
    kind: "category_parent",
  },
] as const;

export const BUCKET_DERIVED_REFERENCE_FIELDS = [
  { table: "transactions", field: "categoryId", nullable: false },
  { table: "budgets", field: "categoryId", nullable: false },
  { table: "budgetSnapshots", field: "categoryId", nullable: false },
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
type Action = keyof typeof BUCKET_LIFECYCLE_CONFIRMATIONS;
type Row = Record<string, unknown>;

interface NormalizedInput {
  action: Action;
  bucketId?: number;
  sourceBucketId?: number;
  targetBucketId?: number;
  expectedPlanFingerprint?: string;
}

interface DirectReferenceCounts {
  transactions: number;
  budgets: number;
  budgetSnapshots: number;
  smsImportTemplates: number;
}

interface BucketLifecyclePlan {
  input: NormalizedInput;
  source?: Row;
  target?: Row;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctBuckets: boolean;
  compatible: boolean;
  sourceCategories: Row[];
  categoryCollisionCount: number;
  directReferenceCounts: DirectReferenceCounts;
  validationErrors: string[];
  planFingerprint?: string;
}

export interface BucketLifecycleResponse {
  ok: boolean;
  mode: "prototype";
  entity: "bucketLifecycle";
  action: Action;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctBuckets: boolean;
  compatible: boolean;
  eligible: boolean;
  categoryCount: number;
  sourceCategoryCount: number;
  categoryCollisionCount: number;
  referenceCount: number;
  sourceReferenceCount: number;
  referenceCountsByEntity: DirectReferenceCounts;
  rowsProposedForUpdate: number;
  categoriesProposedForMove: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  reportGroupingEffectSummary: {
    globalFinancialTotalsWouldChange: false;
    reportTotalsWouldChange: false;
    budgetHistoryFinancialValuesWouldChange: false;
    bucketGroupingWouldConsolidate: boolean;
  };
  validationErrors: string[];
  warnings: string[];
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  safety: {
    dexieMutated: false;
    filesWritten: false;
    financialFieldsMutated: false;
    categoryIdsMutated: false;
    categoryMetadataMutatedBeyondParent: false;
    transferLinksMutated: false;
    budgetLifecycleInvoked: false;
    targetBucketMutated: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BucketLifecycleRequestError extends Error {
  statusCode = 400 as const;

  constructor(public readonly code: string) {
    super(code);
  }
}

const isPlainObject = (value: unknown): value is Row =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const positiveInteger = (value: unknown, code: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BucketLifecycleRequestError(code);
  }
  return value;
};

const allowedFields = (action: Action, write: boolean): Set<string> =>
  new Set([
    ...(action === "delete"
      ? ["bucketId"]
      : ["sourceBucketId", "targetBucketId"]),
    ...(write
      ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"]
      : []),
  ]);

const normalizePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => {
  if (!isPlainObject(payload)) {
    throw new BucketLifecycleRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new BucketLifecycleRequestError("unexpected_payload_field");
  }

  const input: NormalizedInput =
    action === "delete"
      ? {
          action,
          bucketId: positiveInteger(payload.bucketId, "bucket_id_invalid"),
        }
      : {
          action,
          sourceBucketId: positiveInteger(
            payload.sourceBucketId,
            "source_bucket_id_invalid",
          ),
          targetBucketId: positiveInteger(
            payload.targetBucketId,
            "target_bucket_id_invalid",
          ),
        };

  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new BucketLifecycleRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== BUCKET_LIFECYCLE_CONFIRMATIONS[action]) {
      throw new BucketLifecycleRequestError("matching_dry_run_required");
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      !SHA256_HEX.test(payload.expectedPlanFingerprint)
    ) {
      throw new BucketLifecycleRequestError(
        "expected_bucket_lifecycle_plan_required",
      );
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }

  return input;
};

export const validateBucketLifecyclePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => normalizePayload(payload, action, write);

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const escapedIdentifier = (value: string): string => value.replaceAll('"', '""');
const tableRows = (db: Database.Database, table: string): Row[] =>
  db
    .prepare(`SELECT * FROM "${escapedIdentifier(table)}" ORDER BY id ASC`)
    .all() as Row[];
const bucketById = (db: Database.Database, id: number): Row | undefined =>
  db.prepare("SELECT * FROM buckets WHERE id = @id").get({ id }) as
    | Row
    | undefined;
const userTables = (db: Database.Database): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

const emptyDirectCounts = (): DirectReferenceCounts => ({
  transactions: 0,
  budgets: 0,
  budgetSnapshots: 0,
  smsImportTemplates: 0,
});

const unsupportedBucketReferenceLocations = (
  db: Database.Database,
): string[] => {
  const supported = new Set(
    BUCKET_REFERENCE_FIELDS.map(({ table, field }) =>
      `${table}.${field}`.toLowerCase(),
    ),
  );
  const unsupported: string[] = [];

  for (const table of userTables(db)) {
    const columns = db
      .prepare(`PRAGMA table_info("${escapedIdentifier(table)}")`)
      .all() as Array<{ name: string }>;
    for (const column of columns) {
      if (column.name.toLowerCase() !== "bucketid") continue;
      const location = `${table}.${column.name}`;
      if (!supported.has(location.toLowerCase())) unsupported.push(location);
    }
  }

  return unsupported.sort();
};

const validateStoredState = (db: Database.Database): string[] => {
  const buckets = tableRows(db, "buckets");
  const categories = tableRows(db, "categories");
  const bucketIds = new Set(buckets.map((row) => Number(row.id)));
  const categoryIds = new Set(categories.map((row) => Number(row.id)));
  const errors = new Set<string>();

  for (const category of categories) {
    const bucketId = category.bucketId;
    if (
      typeof bucketId !== "number" ||
      !Number.isInteger(bucketId) ||
      bucketId <= 0 ||
      !bucketIds.has(bucketId)
    ) {
      errors.add("category_bucket_reference_malformed");
    }
  }

  for (const reference of BUCKET_DERIVED_REFERENCE_FIELDS) {
    for (const row of tableRows(db, reference.table)) {
      const value = row[reference.field];
      if (value === null || value === undefined) {
        errors.add(`${reference.table}_category_reference_missing`);
        continue;
      }
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value <= 0 ||
        !categoryIds.has(value)
      ) {
        errors.add(`${reference.table}_category_reference_malformed`);
      }
    }
  }

  return [...errors].sort();
};

const categoriesFor = (db: Database.Database, bucketId: number): Row[] =>
  db
    .prepare("SELECT * FROM categories WHERE bucketId = @bucketId ORDER BY id ASC")
    .all({ bucketId }) as Row[];

const booleanField = (row: Row | undefined, field: string): boolean | null => {
  const value = row?.[field];
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  return null;
};

const semanticCompatibility = (source?: Row, target?: Row): boolean => {
  if (!source || !target) return false;
  const sourceActive = booleanField(source, "isActive");
  const targetActive = booleanField(target, "isActive");
  const sourceExcluded = booleanField(source, "excludeFromReports");
  const targetExcluded = booleanField(target, "excludeFromReports");
  return (
    sourceActive !== null &&
    targetActive !== null &&
    sourceExcluded !== null &&
    targetExcluded !== null &&
    sourceActive === targetActive &&
    sourceExcluded === false &&
    targetExcluded === false
  );
};

const buildPlan = (
  db: Database.Database,
  input: NormalizedInput,
): BucketLifecyclePlan => {
  const sourceId =
    input.action === "delete" ? input.bucketId! : input.sourceBucketId!;
  const targetId = input.action === "merge" ? input.targetBucketId! : undefined;
  const source = bucketById(db, sourceId);
  const target = targetId === undefined ? undefined : bucketById(db, targetId);
  const sourceCategories = categoriesFor(db, sourceId);
  const unsupported = unsupportedBucketReferenceLocations(db);
  const errors = new Set(validateStoredState(db));
  if (unsupported.length > 0) {
    errors.add("unsupported_bucket_reference_location");
  }

  const distinctBuckets = input.action === "delete" || sourceId !== targetId;
  if (!source) {
    errors.add(
      input.action === "delete" ? "bucket_not_found" : "source_bucket_not_found",
    );
  }
  if (input.action === "merge" && !target) errors.add("target_bucket_not_found");
  if (!distinctBuckets) errors.add("source_target_bucket_same");

  let compatible = input.action === "delete";
  if (input.action === "merge" && source && target) {
    compatible = semanticCompatibility(source, target);
    if (!compatible) errors.add("bucket_semantic_flags_incompatible");
  }
  if (source && booleanField(source, "isActive") === null) {
    errors.add("source_bucket_active_state_malformed");
  }
  if (source && booleanField(source, "excludeFromReports") === null) {
    errors.add("source_bucket_report_classification_malformed");
  }
  if (target && booleanField(target, "isActive") === null) {
    errors.add("target_bucket_active_state_malformed");
  }
  if (target && booleanField(target, "excludeFromReports") === null) {
    errors.add("target_bucket_report_classification_malformed");
  }

  if (input.action === "delete" && sourceCategories.length > 0) {
    errors.add("bucket_contains_categories");
  }

  // Category names have no uniqueness constraint in either current data store.
  const categoryCollisionCount = 0;
  const directReferenceCounts = emptyDirectCounts();
  const validationErrors = [...errors].sort();
  const fingerprintEligible =
    Boolean(source) &&
    (input.action === "delete" || Boolean(target)) &&
    distinctBuckets &&
    compatible &&
    unsupported.length === 0 &&
    validationErrors.every((code) => code === "bucket_contains_categories");
  const state = {
    input:
      input.action === "delete"
        ? { action: input.action, bucketId: input.bucketId }
        : {
            action: input.action,
            sourceBucketId: input.sourceBucketId,
            targetBucketId: input.targetBucketId,
          },
    tables: Object.fromEntries(
      userTables(db).map((table) => [table, tableRows(db, table)]),
    ),
    unsupported,
    validationErrors,
  };

  return {
    input,
    source,
    target,
    sourcePresent: Boolean(source),
    targetPresent: input.action === "delete" ? Boolean(source) : Boolean(target),
    distinctBuckets,
    compatible,
    sourceCategories,
    categoryCollisionCount,
    directReferenceCounts,
    validationErrors,
    ...(fingerprintEligible ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const totalDirectReferences = (counts: DirectReferenceCounts): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const response = (
  plan: BucketLifecyclePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): BucketLifecycleResponse => {
  const directReferenceCount = totalDirectReferences(plan.directReferenceCounts);
  const eligible =
    plan.input.action === "delete"
      ? plan.sourcePresent &&
        plan.validationErrors.length === 0 &&
        plan.sourceCategories.length === 0 &&
        directReferenceCount === 0
      : plan.sourcePresent &&
        plan.targetPresent &&
        plan.distinctBuckets &&
        plan.compatible &&
        plan.categoryCollisionCount === 0 &&
        plan.validationErrors.length === 0;
  const sqliteMutated = options.sqliteMutated === true;
  const code = options.code ?? plan.validationErrors[0];

  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype",
    entity: "bucketLifecycle",
    action: plan.input.action,
    sourcePresent: plan.sourcePresent,
    targetPresent: plan.targetPresent,
    distinctBuckets: plan.distinctBuckets,
    compatible: plan.compatible,
    eligible,
    categoryCount: plan.sourceCategories.length,
    sourceCategoryCount: plan.sourceCategories.length,
    categoryCollisionCount: plan.categoryCollisionCount,
    referenceCount: directReferenceCount,
    sourceReferenceCount: directReferenceCount,
    referenceCountsByEntity: { ...plan.directReferenceCounts },
    rowsProposedForUpdate:
      plan.input.action === "merge" ? plan.sourceCategories.length : 0,
    categoriesProposedForMove:
      plan.input.action === "merge" ? plan.sourceCategories.length : 0,
    sourceWouldBeDeleted: eligible,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    reportGroupingEffectSummary: {
      globalFinancialTotalsWouldChange: false,
      reportTotalsWouldChange: false,
      budgetHistoryFinancialValuesWouldChange: false,
      bucketGroupingWouldConsolidate:
        plan.input.action === "merge" && plan.sourceCategories.length > 0,
    },
    validationErrors: [...plan.validationErrors],
    warnings: eligible
      ? plan.input.action === "merge"
        ? [
            "target_bucket_fields_remain_unchanged",
            "category_ids_and_metadata_remain_unchanged",
            "bucket_grouping_will_consolidate",
            "checkpoint_rotation_required_after_write",
          ]
        : [
            "empty_unused_bucket_will_be_deleted",
            "checkpoint_rotation_required_after_write",
          ]
      : plan.validationErrors.includes("bucket_contains_categories")
        ? ["merge_or_manual_cleanup_required"]
        : [],
    wouldMutate: false,
    sqliteMutated,
    rowsChanged: options.rowsChanged ?? 0,
    safety: {
      dexieMutated: false,
      filesWritten: false,
      financialFieldsMutated: false,
      categoryIdsMutated: false,
      categoryMetadataMutatedBeyondParent: false,
      transferLinksMutated: false,
      budgetLifecycleInvoked: false,
      targetBucketMutated: false,
      rawRowsIncluded: false,
      automaticCheckpointCreated: false,
    },
    resultCodes: [
      ...(sqliteMutated
        ? [`bucket_${plan.input.action}_completed`]
        : eligible
          ? [`bucket_${plan.input.action}_dry_run_ready`]
          : []),
      ...(code ? [code] : []),
      ...(sqliteMutated ? [] : ["no_mutation_performed"]),
    ],
    ...(code ? { code } : {}),
  };
};

const emptyPlan = (action: Action, code: string): BucketLifecyclePlan => ({
  input: { action },
  sourcePresent: false,
  targetPresent: false,
  distinctBuckets: false,
  compatible: false,
  sourceCategories: [],
  categoryCollisionCount: 0,
  directReferenceCounts: emptyDirectCounts(),
  validationErrors: [code],
});

export const bucketLifecycleRequestErrorResponse = (
  action: Action,
  code: string,
): BucketLifecycleResponse => response(emptyPlan(action, code), { code });

export const bucketLifecycleDisabledResponse = (
  action: Action,
): BucketLifecycleResponse =>
  response(emptyPlan(action, "bucket_delete_merge_writes_disabled"), {
    code: "bucket_delete_merge_writes_disabled",
  });

export const bucketLifecycleDryRun = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): BucketLifecycleResponse =>
  response(buildPlan(db, normalizePayload(payload, action, false)));

const expectedCategoriesAfterMerge = (
  rows: Row[],
  sourceId: number,
  targetId: number,
): Row[] =>
  rows.map((row) =>
    row.bucketId === sourceId ? { ...row, bucketId: targetId } : row,
  );

export const bucketLifecycleRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): BucketLifecycleResponse => {
  const input = normalizePayload(payload, action, true);
  const initialPlan = buildPlan(db, input);
  if (initialPlan.planFingerprint !== input.expectedPlanFingerprint) {
    return response(initialPlan, { code: "bucket_lifecycle_plan_stale" });
  }
  if (initialPlan.validationErrors.length > 0) return response(initialPlan);

  const execute = db.transaction(() => {
    const plan = buildPlan(db, input);
    if (plan.planFingerprint !== input.expectedPlanFingerprint) {
      return response(plan, { code: "bucket_lifecycle_plan_stale" });
    }
    const sourceId =
      action === "delete" ? input.bucketId! : input.sourceBucketId!;
    const targetId = action === "merge" ? input.targetBucketId! : undefined;
    const tables = userTables(db);
    const before = Object.fromEntries(
      tables.map((table) => [table, tableRows(db, table)]),
    ) as Record<string, Row[]>;
    const targetBefore = targetId === undefined ? undefined : bucketById(db, targetId);
    let updatedRows = 0;

    if (action === "merge") {
      updatedRows = db
        .prepare(
          "UPDATE categories SET bucketId = @targetId WHERE bucketId = @sourceId",
        )
        .run({ sourceId, targetId }).changes;
      if (updatedRows !== plan.sourceCategories.length) {
        throw new Error("bucket_category_parent_update_count_mismatch");
      }
    }

    const deleted = db
      .prepare("DELETE FROM buckets WHERE id = @id")
      .run({ id: sourceId }).changes;
    if (deleted !== 1) throw new Error("bucket_delete_count_mismatch");

    for (const table of tables) {
      let expected = before[table];
      if (table === "buckets") {
        expected = before[table].filter((row) => row.id !== sourceId);
      } else if (action === "merge" && table === "categories") {
        expected = expectedCategoriesAfterMerge(before[table], sourceId, targetId!);
      }
      if (serialized(tableRows(db, table)) !== serialized(expected)) {
        throw new Error("bucket_lifecycle_table_boundary_failed");
      }
    }

    if (bucketById(db, sourceId)) {
      throw new Error("bucket_source_delete_verification_failed");
    }
    if (
      targetId !== undefined &&
      serialized(bucketById(db, targetId)) !== serialized(targetBefore)
    ) {
      throw new Error("bucket_target_changed");
    }
    const remaining = db
      .prepare("SELECT COUNT(*) AS count FROM categories WHERE bucketId = @sourceId")
      .get({ sourceId }) as { count: number };
    if (remaining.count !== 0) {
      throw new Error("bucket_source_reference_remains");
    }

    return response(plan, {
      sqliteMutated: true,
      rowsChanged: updatedRows + deleted,
    });
  });

  return execute();
};

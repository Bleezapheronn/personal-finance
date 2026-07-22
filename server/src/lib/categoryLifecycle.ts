import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const CATEGORY_LIFECYCLE_CONFIRMATIONS = {
  delete: "delete unused category from disposable sqlite",
  merge: "merge category references in disposable sqlite",
} as const;

export const CATEGORY_REFERENCE_FIELDS = [
  { table: "transactions", field: "categoryId", nullable: false },
  { table: "budgets", field: "categoryId", nullable: false },
  { table: "budgetSnapshots", field: "categoryId", nullable: false },
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
type Action = keyof typeof CATEGORY_LIFECYCLE_CONFIRMATIONS;
type Row = Record<string, unknown>;
type ReferenceEntity = (typeof CATEGORY_REFERENCE_FIELDS)[number]["table"];
type ReferenceCounts = Record<ReferenceEntity, number>;

interface NormalizedInput {
  action: Action;
  categoryId?: number;
  sourceCategoryId?: number;
  targetCategoryId?: number;
  expectedPlanFingerprint?: string;
}

interface CategoryLifecyclePlan {
  input: NormalizedInput;
  source?: Row;
  target?: Row;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctCategories: boolean;
  parentCompatible: boolean;
  compatible: boolean;
  sourceReferences: Record<ReferenceEntity, Row[]>;
  targetReferenceCounts: ReferenceCounts;
  validationErrors: string[];
  planFingerprint?: string;
}

export interface CategoryLifecycleResponse {
  ok: boolean;
  mode: "prototype";
  entity: "categoryLifecycle";
  action: Action;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctCategories: boolean;
  parentCompatible: boolean;
  compatible: boolean;
  eligible: boolean;
  referenceCount: number;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: ReferenceCounts;
  rowsProposedForUpdate: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  reportGroupingEffectSummary: {
    globalTotalsWouldChange: false;
    bucketGroupingWouldChange: false;
    categoryGroupingWouldConsolidate: boolean;
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
    transferLinksMutated: false;
    budgetLifecycleInvoked: false;
    targetCategoryMutated: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

export class CategoryLifecycleRequestError extends Error {
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
    throw new CategoryLifecycleRequestError(code);
  }
  return value;
};

const allowedFields = (action: Action, write: boolean): Set<string> =>
  new Set([
    ...(action === "delete"
      ? ["categoryId"]
      : ["sourceCategoryId", "targetCategoryId"]),
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
    throw new CategoryLifecycleRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new CategoryLifecycleRequestError("unexpected_payload_field");
  }

  const input: NormalizedInput =
    action === "delete"
      ? {
          action,
          categoryId: positiveInteger(payload.categoryId, "category_id_invalid"),
        }
      : {
          action,
          sourceCategoryId: positiveInteger(
            payload.sourceCategoryId,
            "source_category_id_invalid",
          ),
          targetCategoryId: positiveInteger(
            payload.targetCategoryId,
            "target_category_id_invalid",
          ),
        };

  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new CategoryLifecycleRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== CATEGORY_LIFECYCLE_CONFIRMATIONS[action]) {
      throw new CategoryLifecycleRequestError("matching_dry_run_required");
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      !SHA256_HEX.test(payload.expectedPlanFingerprint)
    ) {
      throw new CategoryLifecycleRequestError(
        "expected_category_lifecycle_plan_required",
      );
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }

  return input;
};

export const validateCategoryLifecyclePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => normalizePayload(payload, action, write);

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const tableRows = (db: Database.Database, table: string): Row[] =>
  db
    .prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY id ASC`)
    .all() as Row[];
const categoryById = (
  db: Database.Database,
  id: number,
): Row | undefined =>
  db.prepare("SELECT * FROM categories WHERE id = @id").get({ id }) as
    | Row
    | undefined;
const userTables = (db: Database.Database): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

const emptyCounts = (): ReferenceCounts => ({
  transactions: 0,
  budgets: 0,
  budgetSnapshots: 0,
});

const unsupportedCategoryReferenceLocations = (
  db: Database.Database,
): string[] => {
  const supported = new Set(
    CATEGORY_REFERENCE_FIELDS.map(({ table, field }) =>
      `${table}.${field}`.toLowerCase(),
    ),
  );
  const unsupported: string[] = [];

  for (const table of userTables(db)) {
    const escaped = table.replaceAll('"', '""');
    const columns = db
      .prepare(`PRAGMA table_info("${escaped}")`)
      .all() as Array<{ name: string }>;
    for (const column of columns) {
      if (column.name.toLowerCase() !== "categoryid") continue;
      const location = `${table}.${column.name}`;
      if (!supported.has(location.toLowerCase())) unsupported.push(location);
    }
  }

  return unsupported.sort();
};

const validateStoredState = (db: Database.Database): string[] => {
  const categories = tableRows(db, "categories");
  const categoryIds = new Set(categories.map((row) => Number(row.id)));
  const bucketIds = new Set(tableRows(db, "buckets").map((row) => Number(row.id)));
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

  for (const reference of CATEGORY_REFERENCE_FIELDS) {
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

const referencesFor = (
  db: Database.Database,
  categoryId: number,
): Record<ReferenceEntity, Row[]> =>
  Object.fromEntries(
    CATEGORY_REFERENCE_FIELDS.map(({ table }) => [
      table,
      db
        .prepare(
          `SELECT * FROM ${table} WHERE categoryId = @categoryId ORDER BY id ASC`,
        )
        .all({ categoryId }) as Row[],
    ]),
  ) as Record<ReferenceEntity, Row[]>;

const referenceCounts = (
  references: Record<ReferenceEntity, Row[]>,
): ReferenceCounts => ({
  transactions: references.transactions.length,
  budgets: references.budgets.length,
  budgetSnapshots: references.budgetSnapshots.length,
});

const totalCounts = (counts: ReferenceCounts): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const validParentId = (row?: Row): number | null => {
  const value = row?.bucketId;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
};

const buildPlan = (
  db: Database.Database,
  input: NormalizedInput,
): CategoryLifecyclePlan => {
  const sourceId =
    input.action === "delete" ? input.categoryId! : input.sourceCategoryId!;
  const targetId =
    input.action === "merge" ? input.targetCategoryId! : undefined;
  const source = categoryById(db, sourceId);
  const target = targetId === undefined ? undefined : categoryById(db, targetId);
  const sourceReferences = referencesFor(db, sourceId);
  const targetReferences =
    targetId === undefined
      ? { transactions: [], budgets: [], budgetSnapshots: [] }
      : referencesFor(db, targetId);
  const unsupported = unsupportedCategoryReferenceLocations(db);
  const errors = new Set(validateStoredState(db));
  if (unsupported.length > 0) {
    errors.add("unsupported_category_reference_location");
  }

  const distinctCategories = input.action === "delete" || sourceId !== targetId;
  if (!source) {
    errors.add(
      input.action === "delete"
        ? "category_not_found"
        : "source_category_not_found",
    );
  }
  if (input.action === "merge" && !target) {
    errors.add("target_category_not_found");
  }
  if (!distinctCategories) errors.add("source_target_category_same");

  const sourceParentId = validParentId(source);
  const targetParentId = validParentId(target);
  if (source && sourceParentId === null) {
    errors.add("source_category_bucket_invalid");
  }
  if (target && targetParentId === null) {
    errors.add("target_category_bucket_invalid");
  }
  const parentCompatible =
    input.action === "delete" ||
    (sourceParentId !== null &&
      targetParentId !== null &&
      sourceParentId === targetParentId);
  if (
    input.action === "merge" &&
    sourceParentId !== null &&
    targetParentId !== null &&
    !parentCompatible
  ) {
    errors.add("category_bucket_mismatch");
  }

  const counts = referenceCounts(sourceReferences);
  if (input.action === "delete" && totalCounts(counts) > 0) {
    errors.add("category_referenced");
  }

  const validationErrors = [...errors].sort();
  const compatible = parentCompatible;
  const fingerprintEligible =
    Boolean(source) &&
    (input.action === "delete" || Boolean(target)) &&
    distinctCategories &&
    compatible &&
    unsupported.length === 0 &&
    validationErrors.every((code) => code === "category_referenced");
  const state = {
    input:
      input.action === "delete"
        ? { action: input.action, categoryId: input.categoryId }
        : {
            action: input.action,
            sourceCategoryId: input.sourceCategoryId,
            targetCategoryId: input.targetCategoryId,
          },
    categories: tableRows(db, "categories"),
    buckets: tableRows(db, "buckets"),
    references: Object.fromEntries(
      CATEGORY_REFERENCE_FIELDS.map(({ table }) => [table, tableRows(db, table)]),
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
    distinctCategories,
    parentCompatible,
    compatible,
    sourceReferences,
    targetReferenceCounts: referenceCounts(targetReferences),
    validationErrors,
    ...(fingerprintEligible ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const response = (
  plan: CategoryLifecyclePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): CategoryLifecycleResponse => {
  const counts = referenceCounts(plan.sourceReferences);
  const sourceReferenceCount = totalCounts(counts);
  const eligible =
    plan.input.action === "delete"
      ? plan.sourcePresent &&
        plan.validationErrors.length === 0 &&
        sourceReferenceCount === 0
      : plan.sourcePresent &&
        plan.targetPresent &&
        plan.distinctCategories &&
        plan.compatible &&
        plan.validationErrors.length === 0;
  const sqliteMutated = options.sqliteMutated === true;
  const code = options.code ?? plan.validationErrors[0];

  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype",
    entity: "categoryLifecycle",
    action: plan.input.action,
    sourcePresent: plan.sourcePresent,
    targetPresent: plan.targetPresent,
    distinctCategories: plan.distinctCategories,
    parentCompatible: plan.parentCompatible,
    compatible: plan.compatible,
    eligible,
    referenceCount: sourceReferenceCount,
    sourceReferenceCount,
    targetExistingReferenceCount: totalCounts(plan.targetReferenceCounts),
    referenceCountsByEntity: counts,
    rowsProposedForUpdate:
      plan.input.action === "merge" ? sourceReferenceCount : 0,
    sourceWouldBeDeleted: eligible,
    ...(plan.planFingerprint
      ? { planFingerprint: plan.planFingerprint }
      : {}),
    reportGroupingEffectSummary: {
      globalTotalsWouldChange: false,
      bucketGroupingWouldChange: false,
      categoryGroupingWouldConsolidate:
        plan.input.action === "merge" && sourceReferenceCount > 0,
    },
    validationErrors: [...plan.validationErrors],
    warnings: eligible
      ? plan.input.action === "merge"
        ? [
            "target_category_fields_remain_unchanged",
            "category_grouping_will_consolidate",
            "checkpoint_rotation_required_after_write",
          ]
        : [
            "unused_category_will_be_deleted",
            "checkpoint_rotation_required_after_write",
          ]
      : plan.validationErrors.includes("category_referenced")
        ? ["merge_or_manual_cleanup_required"]
        : [],
    wouldMutate: false,
    sqliteMutated,
    rowsChanged: options.rowsChanged ?? 0,
    safety: {
      dexieMutated: false,
      filesWritten: false,
      financialFieldsMutated: false,
      transferLinksMutated: false,
      budgetLifecycleInvoked: false,
      targetCategoryMutated: false,
      rawRowsIncluded: false,
      automaticCheckpointCreated: false,
    },
    resultCodes: [
      ...(sqliteMutated
        ? [`category_${plan.input.action}_completed`]
        : eligible
          ? [`category_${plan.input.action}_dry_run_ready`]
          : []),
      ...(code ? [code] : []),
      ...(sqliteMutated ? [] : ["no_mutation_performed"]),
    ],
    ...(code ? { code } : {}),
  };
};

const emptyPlan = (action: Action, code: string): CategoryLifecyclePlan => ({
  input: { action },
  sourcePresent: false,
  targetPresent: false,
  distinctCategories: false,
  parentCompatible: false,
  compatible: false,
  sourceReferences: {
    transactions: [],
    budgets: [],
    budgetSnapshots: [],
  },
  targetReferenceCounts: emptyCounts(),
  validationErrors: [code],
});

export const categoryLifecycleRequestErrorResponse = (
  action: Action,
  code: string,
): CategoryLifecycleResponse => response(emptyPlan(action, code), { code });

export const categoryLifecycleDisabledResponse = (
  action: Action,
): CategoryLifecycleResponse =>
  response(emptyPlan(action, "category_delete_merge_writes_disabled"), {
    code: "category_delete_merge_writes_disabled",
  });

export const categoryLifecycleDryRun = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): CategoryLifecycleResponse => response(buildPlan(db, normalizePayload(payload, action, false)));

const expectedRowsAfterMerge = (
  rows: Row[],
  sourceId: number,
  targetId: number,
): Row[] =>
  rows.map((row) =>
    row.categoryId === sourceId ? { ...row, categoryId: targetId } : row,
  );

export const categoryLifecycleRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): CategoryLifecycleResponse => {
  const input = normalizePayload(payload, action, true);
  const initialPlan = buildPlan(db, input);
  if (initialPlan.planFingerprint !== input.expectedPlanFingerprint) {
    return response(initialPlan, { code: "category_lifecycle_plan_stale" });
  }
  if (initialPlan.validationErrors.length > 0) return response(initialPlan);

  const execute = db.transaction(() => {
    const plan = buildPlan(db, input);
    if (plan.planFingerprint !== input.expectedPlanFingerprint) {
      return response(plan, { code: "category_lifecycle_plan_stale" });
    }
    const sourceId =
      action === "delete" ? input.categoryId! : input.sourceCategoryId!;
    const targetId = action === "merge" ? input.targetCategoryId! : undefined;
    const tables = userTables(db);
    const before = Object.fromEntries(
      tables.map((table) => [table, tableRows(db, table)]),
    ) as Record<string, Row[]>;
    const targetBefore = targetId === undefined ? undefined : categoryById(db, targetId);
    let updatedRows = 0;

    if (action === "merge") {
      for (const { table } of CATEGORY_REFERENCE_FIELDS) {
        const expected = plan.sourceReferences[table].length;
        const changed = db
          .prepare(
            `UPDATE ${table} SET categoryId = @targetId WHERE categoryId = @sourceId`,
          )
          .run({ sourceId, targetId }).changes;
        if (changed !== expected) {
          throw new Error("category_reference_update_count_mismatch");
        }
        updatedRows += changed;
      }
    }

    const deleted = db
      .prepare("DELETE FROM categories WHERE id = @id")
      .run({ id: sourceId }).changes;
    if (deleted !== 1) throw new Error("category_delete_count_mismatch");

    for (const table of tables) {
      let expected = before[table];
      if (table === "categories") {
        expected = before[table].filter((row) => row.id !== sourceId);
      } else if (
        action === "merge" &&
        CATEGORY_REFERENCE_FIELDS.some((item) => item.table === table)
      ) {
        expected = expectedRowsAfterMerge(before[table], sourceId, targetId!);
      }
      if (serialized(tableRows(db, table)) !== serialized(expected)) {
        throw new Error("category_lifecycle_table_boundary_failed");
      }
    }

    if (categoryById(db, sourceId)) {
      throw new Error("category_source_delete_verification_failed");
    }
    if (
      targetId !== undefined &&
      serialized(categoryById(db, targetId)) !== serialized(targetBefore)
    ) {
      throw new Error("category_target_changed");
    }
    for (const { table } of CATEGORY_REFERENCE_FIELDS) {
      const remaining = db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE categoryId = @sourceId`)
        .get({ sourceId }) as { count: number };
      if (remaining.count !== 0) {
        throw new Error("category_source_reference_remains");
      }
    }

    return response(plan, {
      sqliteMutated: true,
      rowsChanged: updatedRows + deleted,
    });
  });

  return execute();
};

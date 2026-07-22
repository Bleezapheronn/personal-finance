import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const RECIPIENT_LIFECYCLE_CONFIRMATIONS = {
  delete: "delete unused recipient from disposable sqlite",
  merge: "merge recipient references in disposable sqlite",
} as const;

const REFERENCE_FIELDS = [
  { table: "transactions", field: "recipientId", nullable: false },
  { table: "budgets", field: "recipientId", nullable: true },
  { table: "budgetSnapshots", field: "recipientId", nullable: true },
] as const;
const WRITE_FIELDS = new Set([
  "recipientId",
  "sourceRecipientId",
  "targetRecipientId",
  "dryRunReviewed",
  "confirmation",
  "expectedPlanFingerprint",
]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

type Action = keyof typeof RECIPIENT_LIFECYCLE_CONFIRMATIONS;
type Row = Record<string, unknown>;
type ReferenceEntity = (typeof REFERENCE_FIELDS)[number]["table"];
type ReferenceCounts = Record<ReferenceEntity, number>;

interface NormalizedInput {
  action: Action;
  recipientId?: number;
  sourceRecipientId?: number;
  targetRecipientId?: number;
  expectedPlanFingerprint?: string;
}

interface RecipientLifecyclePlan {
  input: NormalizedInput;
  targetPresent: boolean;
  sourcePresent: boolean;
  distinctRecipients: boolean;
  source?: Row;
  target?: Row;
  sourceReferences: Record<ReferenceEntity, Row[]>;
  targetReferenceCounts: ReferenceCounts;
  unsupportedReferenceLocations: string[];
  validationErrors: string[];
  planFingerprint?: string;
}

export interface RecipientLifecycleResponse {
  ok: boolean;
  mode: "prototype";
  entity: "recipientLifecycle";
  action: Action;
  targetPresent: boolean;
  sourcePresent: boolean;
  distinctRecipients: boolean;
  eligible: boolean;
  referenceCount: number;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: ReferenceCounts;
  rowsProposedForUpdate: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  safety: {
    dexieMutated: false;
    filesWritten: false;
    financialFieldsMutated: false;
    budgetLifecycleInvoked: false;
    targetRecipientMutated: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

export class RecipientLifecycleRequestError extends Error {
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
    throw new RecipientLifecycleRequestError(code);
  }
  return value;
};

const allowedFields = (action: Action, write: boolean): Set<string> =>
  new Set([
    ...(action === "delete"
      ? ["recipientId"]
      : ["sourceRecipientId", "targetRecipientId"]),
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
    throw new RecipientLifecycleRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new RecipientLifecycleRequestError("unexpected_payload_field");
  }
  const input: NormalizedInput = action === "delete"
    ? {
        action,
        recipientId: positiveInteger(payload.recipientId, "recipient_id_invalid"),
      }
    : {
        action,
        sourceRecipientId: positiveInteger(
          payload.sourceRecipientId,
          "source_recipient_id_invalid",
        ),
        targetRecipientId: positiveInteger(
          payload.targetRecipientId,
          "target_recipient_id_invalid",
        ),
      };
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new RecipientLifecycleRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== RECIPIENT_LIFECYCLE_CONFIRMATIONS[action]) {
      throw new RecipientLifecycleRequestError("matching_dry_run_required");
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      !SHA256_HEX.test(payload.expectedPlanFingerprint)
    ) {
      throw new RecipientLifecycleRequestError("expected_recipient_lifecycle_plan_required");
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }
  return input;
};

export const validateRecipientLifecyclePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => normalizePayload(payload, action, write);

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const emptyCounts = (): ReferenceCounts => ({
  transactions: 0,
  budgets: 0,
  budgetSnapshots: 0,
});
const tableRows = (db: Database.Database, table: string): Row[] =>
  db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY id ASC`).all() as Row[];
const recipientById = (db: Database.Database, id: number): Row | undefined =>
  db.prepare("SELECT * FROM recipients WHERE id = @id").get({ id }) as Row | undefined;
const userTables = (db: Database.Database): string[] =>
  (db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name ASC`,
  ).all() as Array<{ name: string }>).map((row) => row.name);

const unsupportedRecipientReferenceLocations = (
  db: Database.Database,
): string[] => {
  const supported = new Set(
    REFERENCE_FIELDS.map(({ table, field }) => `${table}.${field}`.toLowerCase()),
  );
  const unsupported: string[] = [];
  for (const table of userTables(db)) {
    const escaped = table.replaceAll('"', '""');
    const columns = db.prepare(`PRAGMA table_info("${escaped}")`).all() as Array<{
      name: string;
    }>;
    for (const column of columns) {
      if (column.name.toLowerCase() !== "recipientid") continue;
      const location = `${table}.${column.name}`;
      if (!supported.has(location.toLowerCase())) unsupported.push(location);
    }
  }
  return unsupported.sort();
};

const validateStoredReferences = (db: Database.Database): string[] => {
  const recipientIds = new Set(
    tableRows(db, "recipients").map((row) => Number(row.id)),
  );
  const errors = new Set<string>();
  for (const reference of REFERENCE_FIELDS) {
    for (const row of tableRows(db, reference.table)) {
      const value = row[reference.field];
      if (value === null || value === undefined) {
        if (!reference.nullable) errors.add(`${reference.table}_recipient_reference_missing`);
        continue;
      }
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value <= 0 ||
        !recipientIds.has(value)
      ) {
        errors.add(`${reference.table}_recipient_reference_malformed`);
      }
    }
  }
  return [...errors].sort();
};

const referencesFor = (
  db: Database.Database,
  recipientId: number,
): Record<ReferenceEntity, Row[]> => ({
  transactions: db.prepare(
    "SELECT * FROM transactions WHERE recipientId = @recipientId ORDER BY id ASC",
  ).all({ recipientId }) as Row[],
  budgets: db.prepare(
    "SELECT * FROM budgets WHERE recipientId = @recipientId ORDER BY id ASC",
  ).all({ recipientId }) as Row[],
  budgetSnapshots: db.prepare(
    "SELECT * FROM budgetSnapshots WHERE recipientId = @recipientId ORDER BY id ASC",
  ).all({ recipientId }) as Row[],
});

const referenceCounts = (
  references: Record<ReferenceEntity, Row[]>,
): ReferenceCounts => ({
  transactions: references.transactions.length,
  budgets: references.budgets.length,
  budgetSnapshots: references.budgetSnapshots.length,
});

const totalCounts = (counts: ReferenceCounts): number =>
  counts.transactions + counts.budgets + counts.budgetSnapshots;

const buildPlan = (
  db: Database.Database,
  input: NormalizedInput,
): RecipientLifecyclePlan => {
  const sourceId = input.action === "delete"
    ? input.recipientId!
    : input.sourceRecipientId!;
  const targetId = input.action === "merge" ? input.targetRecipientId! : undefined;
  const source = recipientById(db, sourceId);
  const target = targetId === undefined ? undefined : recipientById(db, targetId);
  const distinctRecipients = input.action === "delete" || sourceId !== targetId;
  const sourceReferences = referencesFor(db, sourceId);
  const targetReferences = targetId === undefined
    ? { transactions: [], budgets: [], budgetSnapshots: [] }
    : referencesFor(db, targetId);
  const unsupportedReferenceLocations = unsupportedRecipientReferenceLocations(db);
  const errors = new Set<string>(validateStoredReferences(db));
  if (unsupportedReferenceLocations.length > 0) {
    errors.add("unsupported_recipient_reference_location");
  }
  if (!source) {
    errors.add(input.action === "delete" ? "recipient_not_found" : "source_recipient_not_found");
  }
  if (input.action === "merge" && !target) errors.add("target_recipient_not_found");
  if (!distinctRecipients) errors.add("source_target_recipient_same");
  const counts = referenceCounts(sourceReferences);
  if (input.action === "delete" && totalCounts(counts) > 0) {
    errors.add("recipient_referenced");
  }
  const validationErrors = [...errors].sort();
  const fingerprintEligible =
    Boolean(source) &&
    (input.action === "delete" || Boolean(target)) &&
    distinctRecipients &&
    unsupportedReferenceLocations.length === 0 &&
    validationErrors.every((code) => code === "recipient_referenced");
  const state = {
    input: input.action === "delete"
      ? { action: input.action, recipientId: input.recipientId }
      : {
          action: input.action,
          sourceRecipientId: input.sourceRecipientId,
          targetRecipientId: input.targetRecipientId,
        },
    recipients: tableRows(db, "recipients"),
    references: Object.fromEntries(
      REFERENCE_FIELDS.map(({ table }) => [table, tableRows(db, table)]),
    ),
    unsupportedReferenceLocations,
    validationErrors,
  };
  return {
    input,
    targetPresent: input.action === "delete" ? Boolean(source) : Boolean(target),
    sourcePresent: Boolean(source),
    distinctRecipients,
    source,
    target,
    sourceReferences,
    targetReferenceCounts: referenceCounts(targetReferences),
    unsupportedReferenceLocations,
    validationErrors,
    ...(fingerprintEligible ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const response = (
  plan: RecipientLifecyclePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): RecipientLifecycleResponse => {
  const counts = referenceCounts(plan.sourceReferences);
  const sourceReferenceCount = totalCounts(counts);
  const eligible =
    plan.input.action === "delete"
      ? plan.sourcePresent && plan.validationErrors.length === 0 && sourceReferenceCount === 0
      : plan.sourcePresent &&
        plan.targetPresent &&
        plan.distinctRecipients &&
        plan.validationErrors.length === 0;
  const sqliteMutated = options.sqliteMutated === true;
  const code = options.code ?? plan.validationErrors[0];
  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype",
    entity: "recipientLifecycle",
    action: plan.input.action,
    targetPresent: plan.targetPresent,
    sourcePresent: plan.sourcePresent,
    distinctRecipients: plan.distinctRecipients,
    eligible,
    referenceCount: sourceReferenceCount,
    sourceReferenceCount,
    targetExistingReferenceCount: totalCounts(plan.targetReferenceCounts),
    referenceCountsByEntity: counts,
    rowsProposedForUpdate: plan.input.action === "merge" ? sourceReferenceCount : 0,
    sourceWouldBeDeleted: eligible,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    validationErrors: [...plan.validationErrors],
    warnings: eligible
      ? [
          "target_recipient_fields_remain_unchanged",
          "manual_checkpoint_rotation_required_before_authority_restart",
        ]
      : plan.validationErrors.includes("recipient_referenced")
        ? ["referenced_recipient_requires_merge"]
        : [],
    wouldMutate: false,
    sqliteMutated,
    rowsChanged: options.rowsChanged ?? 0,
    safety: {
      dexieMutated: false,
      filesWritten: false,
      financialFieldsMutated: false,
      budgetLifecycleInvoked: false,
      targetRecipientMutated: false,
      rawRowsIncluded: false,
      automaticCheckpointCreated: false,
    },
    resultCodes: sqliteMutated
      ? [`recipient_${plan.input.action}_completed`, "sqlite_mutated"]
      : eligible
        ? [`recipient_${plan.input.action}_dry_run_valid`, "no_mutation_performed"]
        : [`recipient_${plan.input.action}_conflict`, "no_mutation_performed"],
    ...(code ? { code } : {}),
  };
};

const errorPlan = (action: Action, code: string): RecipientLifecyclePlan => ({
  input: { action },
  targetPresent: false,
  sourcePresent: false,
  distinctRecipients: action === "delete",
  sourceReferences: { transactions: [], budgets: [], budgetSnapshots: [] },
  targetReferenceCounts: emptyCounts(),
  unsupportedReferenceLocations: [],
  validationErrors: [code],
});

export const recipientLifecycleRequestErrorResponse = (action: Action, code: string) =>
  response(errorPlan(action, code), { code });
export const recipientLifecycleDisabledResponse = (action: Action) =>
  recipientLifecycleRequestErrorResponse(action, "recipient_delete_merge_writes_disabled");

export const recipientLifecycleDryRun = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): RecipientLifecycleResponse => {
  const input = normalizePayload(payload, action, false);
  return response(buildPlan(db, input));
};

const expectedReferenceRows = (
  before: Row[],
  sourceId: number,
  targetId: number,
): Row[] => before.map((row) =>
  row.recipientId === sourceId ? { ...row, recipientId: targetId } : row,
);

export const recipientLifecycleRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): RecipientLifecycleResponse => {
  const input = normalizePayload(payload, action, true);
  const execute = db.transaction(() => {
    const plan = buildPlan(db, input);
    if (!plan.planFingerprint || plan.planFingerprint !== input.expectedPlanFingerprint) {
      const stale = Boolean(plan.planFingerprint) &&
        plan.planFingerprint !== input.expectedPlanFingerprint;
      return response(plan, {
        code: stale ? "recipient_lifecycle_plan_stale" : plan.validationErrors[0],
      });
    }
    if (plan.validationErrors.length > 0) return response(plan);

    const tables = userTables(db);
    const before = Object.fromEntries(
      tables.map((table) => [table, tableRows(db, table)]),
    ) as Record<string, Row[]>;
    let rowsChanged = 0;

    if (action === "merge") {
      const sourceId = input.sourceRecipientId!;
      const targetId = input.targetRecipientId!;
      for (const { table } of REFERENCE_FIELDS) {
        const changes = db.prepare(
          `UPDATE ${table} SET recipientId = @targetId WHERE recipientId = @sourceId`,
        ).run({ sourceId, targetId }).changes;
        if (changes !== plan.sourceReferences[table].length) {
          throw new Error("recipient_merge_reference_count_mismatch");
        }
        rowsChanged += changes;
      }
    }

    const sourceId = action === "delete" ? input.recipientId! : input.sourceRecipientId!;
    const deleted = db.prepare("DELETE FROM recipients WHERE id = @id").run({ id: sourceId }).changes;
    if (deleted !== 1) throw new Error("recipient_lifecycle_source_delete_failed");
    rowsChanged += deleted;

    for (const table of tables) {
      let expected = before[table];
      if (table === "recipients") {
        expected = before.recipients.filter((row) => Number(row.id) !== sourceId);
      } else if (action === "merge" && REFERENCE_FIELDS.some((item) => item.table === table)) {
        expected = expectedReferenceRows(before[table], sourceId, input.targetRecipientId!);
      }
      if (serialized(tableRows(db, table)) !== serialized(expected)) {
        throw new Error("recipient_lifecycle_mutation_boundary_failed");
      }
    }

    if (recipientById(db, sourceId)) {
      throw new Error("recipient_lifecycle_source_still_present");
    }
    if (
      action === "merge" &&
      serialized(recipientById(db, input.targetRecipientId!)) !== serialized(plan.target)
    ) {
      throw new Error("recipient_lifecycle_target_changed");
    }

    return response(plan, { sqliteMutated: true, rowsChanged });
  });
  return execute.immediate();
};

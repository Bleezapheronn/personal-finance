import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const BUDGET_DELETE_WRITE_CONFIRMATION =
  "delete budget and unlinked snapshots from disposable sqlite" as const;

export const BUDGET_DELETE_REFERENCE_FIELDS = [
  {
    table: "budgetSnapshots",
    field: "budgetId",
    nullable: false,
    kind: "snapshot_owner",
  },
  {
    table: "transactions",
    field: "budgetSnapshotId",
    nullable: true,
    kind: "canonical_transaction_snapshot",
  },
  {
    table: "transactions",
    field: "budgetId",
    nullable: true,
    kind: "legacy_transaction_budget",
  },
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
type Row = Record<string, unknown>;

interface NormalizedBudgetDeleteInput {
  budgetId: number;
  expectedPlanFingerprint?: string;
}

export interface BudgetDeleteDependencyInventory {
  targetSnapshots: Row[];
  canonicalTransactionReferences: Row[];
  legacyDirectTransactionReferences: Row[];
  linkedSnapshotCount: number;
  unlinkedSnapshotCount: number;
  transactionDependencyCount: number;
  unsupportedReferenceLocations: string[];
  unsupportedForeignKeyLocations: string[];
  unsupportedTriggerNames: string[];
  validationErrors: string[];
}

interface BudgetDeletePlan {
  input: NormalizedBudgetDeleteInput;
  target?: Row;
  targetPresent: boolean;
  budgetActive: boolean | null;
  inventory: BudgetDeleteDependencyInventory;
  planFingerprint?: string;
}

export interface BudgetDeleteResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetLifecycle";
  action: "deleteBudget";
  targetPresent: boolean;
  eligible: boolean;
  budgetActive: boolean | null;
  snapshotCount: number;
  unlinkedSnapshotCount: number;
  linkedSnapshotCount: number;
  legacyDirectTransactionReferenceCount: number;
  canonicalTransactionReferenceCount: number;
  transactionDependencyCount: number;
  conflictCount: number;
  expectedRowsDeleted: number;
  planFingerprint?: string;
  budgetHistoryEffectSummary: {
    budgetDefinitionsRemoved: number;
    snapshotRowsRemoved: number;
    targetOccurrencesWouldBeRemoved: boolean;
  };
  reportEffectSummary: {
    transactionRowsChanged: 0;
    transactionLinkFieldsChanged: 0;
    financialTotalsWouldChange: false;
    reportTotalsWouldChange: false;
  };
  validationErrors: string[];
  warnings: string[];
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  transactionLinkMutation: false;
  safety: {
    dexieMutated: false;
    filesWritten: false;
    transactionsMutated: false;
    unrelatedBudgetsMutated: false;
    unrelatedSnapshotsMutated: false;
    lookupRowsMutated: false;
    budgetLifecycleInvoked: false;
    snapshotRepairInvoked: false;
    automaticCheckpointCreated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BudgetDeleteRequestError extends Error {
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

const positiveInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BudgetDeleteRequestError("budget_id_invalid");
  }
  return value;
};

const normalizePayload = (
  payload: unknown,
  write: boolean,
): NormalizedBudgetDeleteInput => {
  if (!isPlainObject(payload)) {
    throw new BudgetDeleteRequestError("payload_must_be_object");
  }
  const allowed = new Set([
    "budgetId",
    ...(write
      ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"]
      : []),
  ]);
  if (Object.keys(payload).some((field) => !allowed.has(field))) {
    throw new BudgetDeleteRequestError("unexpected_payload_field");
  }

  const input: NormalizedBudgetDeleteInput = {
    budgetId: positiveInteger(payload.budgetId),
  };
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new BudgetDeleteRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== BUDGET_DELETE_WRITE_CONFIRMATION) {
      throw new BudgetDeleteRequestError("matching_dry_run_required");
    }
    if (
      typeof payload.expectedPlanFingerprint !== "string" ||
      !SHA256_HEX.test(payload.expectedPlanFingerprint)
    ) {
      throw new BudgetDeleteRequestError("expected_budget_delete_plan_required");
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }
  return input;
};

export const validateBudgetDeletePayload = (
  payload: unknown,
  write: boolean,
): NormalizedBudgetDeleteInput => normalizePayload(payload, write);

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const escapedIdentifier = (value: string): string => value.replaceAll('"', '""');
const userTables = (db: Database.Database): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
const tableRows = (db: Database.Database, table: string): Row[] =>
  db
    .prepare(`SELECT * FROM "${escapedIdentifier(table)}" ORDER BY id ASC`)
    .all() as Row[];
const budgetById = (db: Database.Database, id: number): Row | undefined =>
  db.prepare("SELECT * FROM budgets WHERE id = @id").get({ id }) as
    | Row
    | undefined;

const validStoredId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const booleanField = (row: Row | undefined, field: string): boolean | null => {
  const value = row?.[field];
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  return null;
};

const unsupportedReferenceLocations = (db: Database.Database): string[] => {
  const supported = new Set(
    BUDGET_DELETE_REFERENCE_FIELDS.map(({ table, field }) =>
      `${table}.${field}`.toLowerCase(),
    ),
  );
  const unsupported: string[] = [];
  for (const table of userTables(db)) {
    const columns = db
      .prepare(`PRAGMA table_info("${escapedIdentifier(table)}")`)
      .all() as Array<{ name: string }>;
    for (const column of columns) {
      const normalized = column.name.toLowerCase();
      if (normalized !== "budgetid" && normalized !== "budgetsnapshotid") {
        continue;
      }
      const location = `${table}.${column.name}`;
      if (!supported.has(location.toLowerCase())) unsupported.push(location);
    }
  }
  return unsupported.sort();
};

const unsupportedForeignKeyLocations = (db: Database.Database): string[] => {
  const locations: string[] = [];
  for (const table of userTables(db)) {
    const rows = db
      .prepare(`PRAGMA foreign_key_list("${escapedIdentifier(table)}")`)
      .all() as Array<{ table: string; from: string; to: string }>;
    for (const row of rows) {
      const from = row.from.toLowerCase();
      const targetTable = row.table.toLowerCase();
      if (
        from === "budgetid" ||
        from === "budgetsnapshotid" ||
        targetTable === "budgets" ||
        targetTable === "budgetsnapshots"
      ) {
        locations.push(`${table}.${row.from}->${row.table}.${row.to}`);
      }
    }
  }
  return locations.sort();
};

const unsupportedTriggerNames = (db: Database.Database): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
        AND lower(tbl_name) IN ('budgets', 'budgetsnapshots') ORDER BY name ASC`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

export const buildBudgetDeleteDependencyInventory = (
  db: Database.Database,
  budgetId: number,
): BudgetDeleteDependencyInventory => {
  const budgets = tableRows(db, "budgets");
  const snapshots = tableRows(db, "budgetSnapshots");
  const transactions = tableRows(db, "transactions");
  const budgetIds = new Set<number>();
  const snapshotById = new Map<number, Row>();
  const errors = new Set<string>();

  for (const budget of budgets) {
    if (!validStoredId(budget.id)) {
      errors.add("budget_identity_malformed");
      continue;
    }
    budgetIds.add(budget.id);
  }
  for (const snapshot of snapshots) {
    if (!validStoredId(snapshot.id)) {
      errors.add("snapshot_identity_malformed");
      continue;
    }
    if (
      !validStoredId(snapshot.budgetId) ||
      !budgetIds.has(snapshot.budgetId)
    ) {
      errors.add("snapshot_budget_relationship_malformed");
    }
    snapshotById.set(snapshot.id, snapshot);
  }

  const targetSnapshots = snapshots.filter((row) => row.budgetId === budgetId);
  const targetSnapshotIds = new Set(
    targetSnapshots
      .map((row) => row.id)
      .filter((id): id is number => validStoredId(id)),
  );
  const canonicalTransactionReferences: Row[] = [];
  const legacyDirectTransactionReferences: Row[] = [];
  const dependentTransactionIds = new Set<number>();
  const linkedSnapshotIds = new Set<number>();

  for (const transaction of transactions) {
    if (!validStoredId(transaction.id)) {
      errors.add("transaction_identity_malformed");
      continue;
    }
    if (transaction.budgetId !== null && transaction.budgetId !== undefined) {
      if (
        !validStoredId(transaction.budgetId) ||
        !budgetIds.has(transaction.budgetId)
      ) {
        errors.add("transaction_budget_relationship_malformed");
      }
      if (transaction.budgetId === budgetId) {
        legacyDirectTransactionReferences.push(transaction);
        dependentTransactionIds.add(transaction.id);
      }
    }
    if (
      transaction.budgetSnapshotId !== null &&
      transaction.budgetSnapshotId !== undefined
    ) {
      if (!validStoredId(transaction.budgetSnapshotId)) {
        errors.add("transaction_snapshot_relationship_malformed");
        continue;
      }
      const snapshot = snapshotById.get(transaction.budgetSnapshotId);
      if (!snapshot) {
        errors.add("transaction_snapshot_relationship_malformed");
        continue;
      }
      if (
        transaction.budgetId !== null &&
        transaction.budgetId !== undefined &&
        transaction.budgetId !== snapshot.budgetId
      ) {
        errors.add("transaction_budget_snapshot_relationship_incompatible");
      }
      if (targetSnapshotIds.has(transaction.budgetSnapshotId)) {
        canonicalTransactionReferences.push(transaction);
        dependentTransactionIds.add(transaction.id);
        linkedSnapshotIds.add(transaction.budgetSnapshotId);
      }
    }
  }

  const unsupportedReferences = unsupportedReferenceLocations(db);
  const unsupportedForeignKeys = unsupportedForeignKeyLocations(db);
  const unsupportedTriggers = unsupportedTriggerNames(db);
  if (unsupportedReferences.length > 0) {
    errors.add("unsupported_budget_reference_location");
  }
  if (unsupportedForeignKeys.length > 0) {
    errors.add("unsupported_budget_foreign_key");
  }
  if (unsupportedTriggers.length > 0) {
    errors.add("unsupported_budget_delete_trigger");
  }

  return {
    targetSnapshots,
    canonicalTransactionReferences,
    legacyDirectTransactionReferences,
    linkedSnapshotCount: linkedSnapshotIds.size,
    unlinkedSnapshotCount: targetSnapshots.length - linkedSnapshotIds.size,
    transactionDependencyCount: dependentTransactionIds.size,
    unsupportedReferenceLocations: unsupportedReferences,
    unsupportedForeignKeyLocations: unsupportedForeignKeys,
    unsupportedTriggerNames: unsupportedTriggers,
    validationErrors: [...errors].sort(),
  };
};

const buildPlan = (
  db: Database.Database,
  input: NormalizedBudgetDeleteInput,
): BudgetDeletePlan => {
  const target = budgetById(db, input.budgetId);
  const inventory = buildBudgetDeleteDependencyInventory(db, input.budgetId);
  const errors = new Set(inventory.validationErrors);
  if (!target) errors.add("budget_not_found");
  if (target && !validStoredId(target.id)) errors.add("budget_identity_malformed");
  const budgetActive = booleanField(target, "isActive");
  if (target && budgetActive === null) errors.add("budget_active_state_malformed");

  const normalizedInventory = {
    ...inventory,
    validationErrors: [...errors].sort(),
  };
  const dependencyFree = inventory.transactionDependencyCount === 0;
  const fingerprintEligible =
    Boolean(target) && dependencyFree && normalizedInventory.validationErrors.length === 0;
  const state = {
    input: { budgetId: input.budgetId },
    tables: Object.fromEntries(
      userTables(db).map((table) => [table, tableRows(db, table)]),
    ),
    unsupportedReferenceLocations: inventory.unsupportedReferenceLocations,
    unsupportedForeignKeyLocations: inventory.unsupportedForeignKeyLocations,
    unsupportedTriggerNames: inventory.unsupportedTriggerNames,
    validationErrors: normalizedInventory.validationErrors,
  };

  return {
    input,
    target,
    targetPresent: Boolean(target),
    budgetActive,
    inventory: normalizedInventory,
    ...(fingerprintEligible ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const conflictCode = (plan: BudgetDeletePlan): string | undefined => {
  if (plan.inventory.validationErrors.length > 0) {
    return plan.inventory.validationErrors[0];
  }
  if (plan.inventory.transactionDependencyCount > 0) {
    return "budget_transaction_dependency_exists";
  }
  return undefined;
};

const response = (
  plan: BudgetDeletePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): BudgetDeleteResponse => {
  const sqliteMutated = options.sqliteMutated === true;
  const planConflictCode = conflictCode(plan);
  const code = options.code ?? planConflictCode;
  const eligible =
    plan.targetPresent &&
    plan.inventory.validationErrors.length === 0 &&
    plan.inventory.transactionDependencyCount === 0;
  const snapshotCount = plan.inventory.targetSnapshots.length;
  const canonicalCount = plan.inventory.canonicalTransactionReferences.length;
  const legacyCount = plan.inventory.legacyDirectTransactionReferences.length;

  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype",
    entity: "budgetLifecycle",
    action: "deleteBudget",
    targetPresent: plan.targetPresent,
    eligible,
    budgetActive: plan.budgetActive,
    snapshotCount,
    unlinkedSnapshotCount: plan.inventory.unlinkedSnapshotCount,
    linkedSnapshotCount: plan.inventory.linkedSnapshotCount,
    legacyDirectTransactionReferenceCount: legacyCount,
    canonicalTransactionReferenceCount: canonicalCount,
    transactionDependencyCount: plan.inventory.transactionDependencyCount,
    conflictCount:
      plan.inventory.validationErrors.length +
      (plan.inventory.transactionDependencyCount > 0 ? 1 : 0),
    expectedRowsDeleted: eligible ? snapshotCount + 1 : 0,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    budgetHistoryEffectSummary: {
      budgetDefinitionsRemoved: eligible ? 1 : 0,
      snapshotRowsRemoved: eligible ? snapshotCount : 0,
      targetOccurrencesWouldBeRemoved: eligible,
    },
    reportEffectSummary: {
      transactionRowsChanged: 0,
      transactionLinkFieldsChanged: 0,
      financialTotalsWouldChange: false,
      reportTotalsWouldChange: false,
    },
    validationErrors: [...plan.inventory.validationErrors],
    warnings: eligible
      ? [
          "budget_and_unlinked_snapshots_will_be_permanently_deleted",
          "manual_checkpoint_rotation_required_before_authority_restart",
          "recovery_requires_native_backup_or_prior_checkpoint",
        ]
      : plan.inventory.transactionDependencyCount > 0
        ? ["linked_transactions_are_protected"]
        : [],
    wouldMutate: false,
    sqliteMutated,
    rowsChanged: options.rowsChanged ?? 0,
    transactionLinkMutation: false,
    safety: {
      dexieMutated: false,
      filesWritten: false,
      transactionsMutated: false,
      unrelatedBudgetsMutated: false,
      unrelatedSnapshotsMutated: false,
      lookupRowsMutated: false,
      budgetLifecycleInvoked: false,
      snapshotRepairInvoked: false,
      automaticCheckpointCreated: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      ...(sqliteMutated
        ? ["budget_delete_completed", "sqlite_mutated"]
        : eligible
          ? ["budget_delete_dry_run_ready", "no_mutation_performed"]
          : ["budget_delete_ineligible", "no_mutation_performed"]),
      ...(code ? [code] : []),
    ],
    ...(code ? { code } : {}),
  };
};

const emptyPlan = (code: string): BudgetDeletePlan => ({
  input: { budgetId: 0 },
  targetPresent: false,
  budgetActive: null,
  inventory: {
    targetSnapshots: [],
    canonicalTransactionReferences: [],
    legacyDirectTransactionReferences: [],
    linkedSnapshotCount: 0,
    unlinkedSnapshotCount: 0,
    transactionDependencyCount: 0,
    unsupportedReferenceLocations: [],
    unsupportedForeignKeyLocations: [],
    unsupportedTriggerNames: [],
    validationErrors: [code],
  },
});

export const budgetDeleteRequestErrorResponse = (
  code: string,
): BudgetDeleteResponse => response(emptyPlan(code), { code });

export const budgetDeleteDisabledResponse = (): BudgetDeleteResponse =>
  budgetDeleteRequestErrorResponse("budget_delete_writes_disabled");

export const budgetDeleteDryRun = (
  db: Database.Database,
  payload: unknown,
): BudgetDeleteResponse => response(buildPlan(db, normalizePayload(payload, false)));

export const budgetDeleteRealWrite = (
  db: Database.Database,
  payload: unknown,
): BudgetDeleteResponse => {
  const input = normalizePayload(payload, true);
  const initialPlan = buildPlan(db, input);
  if (initialPlan.planFingerprint !== input.expectedPlanFingerprint) {
    return response(initialPlan, { code: "budget_delete_plan_stale" });
  }
  if (!initialPlan.planFingerprint || conflictCode(initialPlan)) {
    return response(initialPlan);
  }

  const execute = db.transaction(() => {
    const plan = buildPlan(db, input);
    if (plan.planFingerprint !== input.expectedPlanFingerprint) {
      return response(plan, { code: "budget_delete_plan_stale" });
    }
    if (!plan.planFingerprint || conflictCode(plan)) return response(plan);

    const tables = userTables(db);
    const before = Object.fromEntries(
      tables.map((table) => [table, tableRows(db, table)]),
    ) as Record<string, Row[]>;
    const targetSnapshotIds = new Set(
      plan.inventory.targetSnapshots.map((row) => Number(row.id)),
    );

    const snapshotDelete = db.prepare(
      "DELETE FROM budgetSnapshots WHERE id = @id AND budgetId = @budgetId",
    );
    let deletedSnapshots = 0;
    for (const snapshot of plan.inventory.targetSnapshots) {
      deletedSnapshots += snapshotDelete.run({
        id: snapshot.id,
        budgetId: input.budgetId,
      }).changes;
    }
    if (deletedSnapshots !== plan.inventory.targetSnapshots.length) {
      throw new Error("budget_snapshot_delete_count_mismatch");
    }

    const deletedBudget = db
      .prepare("DELETE FROM budgets WHERE id = @budgetId")
      .run({ budgetId: input.budgetId }).changes;
    if (deletedBudget !== 1) throw new Error("budget_delete_count_mismatch");

    for (const table of tables) {
      let expected = before[table];
      if (table === "budgets") {
        expected = expected.filter((row) => row.id !== input.budgetId);
      } else if (table === "budgetSnapshots") {
        expected = expected.filter((row) => !targetSnapshotIds.has(Number(row.id)));
      }
      if (serialized(tableRows(db, table)) !== serialized(expected)) {
        throw new Error("budget_delete_table_boundary_failed");
      }
    }

    if (budgetById(db, input.budgetId)) {
      throw new Error("budget_delete_verification_failed");
    }
    const remainingSnapshots = db
      .prepare("SELECT COUNT(*) AS count FROM budgetSnapshots WHERE budgetId = @budgetId")
      .get({ budgetId: input.budgetId }) as { count: number };
    if (remainingSnapshots.count !== 0) {
      throw new Error("budget_snapshot_delete_verification_failed");
    }

    return response(plan, {
      sqliteMutated: true,
      rowsChanged: deletedSnapshots + deletedBudget,
    });
  });

  return execute.immediate();
};

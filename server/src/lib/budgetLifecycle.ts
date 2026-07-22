import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  calculateBudgetOccurrenceSchedule,
  calculateMissingBudgetSnapshotPlan,
  localDayKey,
  type BudgetGenerationDefinition,
  type BudgetSnapshotGenerationCandidate,
} from "../../shared/budgetSnapshotGeneration.js";
import {
  budgetDefinitionDryRun,
  BudgetDefinitionDryRunRequestError,
  normalizeBudgetDefinitionPayload,
  type BudgetDefinitionAction,
  type NormalizedBudgetDefinitionInput,
} from "./budgetDefinitionDryRun.js";
import { normalizeBudgetSnapshotGenerationAsOf } from "./budgetSnapshotGenerationDryRun.js";

export const BUDGET_LIFECYCLE_CONFIRMATIONS = {
  create: "create budget and lifecycle coverage in disposable sqlite",
  update: "update budget and lifecycle coverage in disposable sqlite",
} as const;

const DEFINITION_FIELDS = [
  "description", "categoryId", "accountId", "recipientId", "amount",
  "transactionCost", "frequency", "frequencyDetails", "isGoal",
  "isFlexible", "goalPercentage", "goalDirection", "remainingCyclesTotal",
  "dueDate",
] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const IMMUTABLE_TABLES = [
  "transactions", "accounts", "paymentMethods", "buckets", "categories",
  "recipients", "smsImportTemplates",
] as const;

type Row = Record<string, unknown>;
type Action = BudgetDefinitionAction;

interface NormalizedLifecycleInput {
  action: Action;
  definition: NormalizedBudgetDefinitionInput;
  isActive: boolean;
  asOf: Date;
}

interface LifecyclePlan {
  input: NormalizedLifecycleInput;
  targetId: number;
  targetPresent: boolean;
  currentBudget?: Row;
  targetSnapshots: Row[];
  retainedSnapshots: Row[];
  cleanupSnapshots: Row[];
  protectedSnapshots: Row[];
  outOfScheduleProtectedCount: number;
  generationCandidates: BudgetSnapshotGenerationCandidate[];
  conflicts: string[];
  validationErrors: string[];
  planFingerprint?: string;
}

export interface BudgetLifecycleResponse {
  ok: boolean;
  mode: "prototype";
  entity: "budgetLifecycle";
  action: "createBudgetLifecycle" | "updateBudgetLifecycle";
  dryRun: boolean;
  wouldMutate: boolean;
  sqliteMutated: boolean;
  normalizedAsOf: string;
  targetPresent: boolean;
  targetId?: number;
  definitionWouldChange: boolean;
  budgetActive: boolean;
  existingSnapshotCount: number;
  pastSnapshotsRetained: number;
  unlinkedFutureSnapshotsProposedForCleanup: number;
  linkedSnapshotsProtected: number;
  outOfScheduleLinkedSnapshotsRetained: number;
  snapshotsProposedForGeneration: number;
  expectedFinalSnapshotCount: number;
  conflictCount: number;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  transactionLinkMutation: false;
  linkedSnapshotRewrite: false;
  historicalSnapshotRewrite: false;
  rowsChanged: number;
  safety: {
    dexieMutated: false;
    filesWritten: false;
    unrelatedRowsMutated: false;
    automaticCheckpointCreated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class BudgetLifecycleRequestError extends Error {
  statusCode = 400 as const;
  constructor(public readonly code: string) { super(code); }
}

const isPlainObject = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const rows = (db: Database.Database, table: string): Row[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Row[];
const rowById = (db: Database.Database, table: string, id: number): Row | undefined =>
  db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id }) as Row | undefined;

const definitionPayload = (payload: Row, action: Action): Row =>
  Object.fromEntries([
    ...(action === "update" ? [["id", payload.id]] : []),
    ...DEFINITION_FIELDS.map((field) => [field, payload[field]]),
  ]);

const allowedFields = (action: Action, write: boolean): Set<string> => new Set([
  ...DEFINITION_FIELDS,
  ...(action === "update" ? ["id"] : []),
  "isActive", "asOf",
  ...(write ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"] : []),
]);

const normalizePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedLifecycleInput & { expectedPlanFingerprint?: string } => {
  if (!isPlainObject(payload)) throw new BudgetLifecycleRequestError("payload_must_be_object");
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new BudgetLifecycleRequestError("unexpected_payload_field");
  }
  if (payload.asOf === undefined) throw new BudgetLifecycleRequestError("asOf_required");
  if (typeof payload.isActive !== "boolean") {
    throw new BudgetLifecycleRequestError("isActive_invalid");
  }
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new BudgetLifecycleRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== BUDGET_LIFECYCLE_CONFIRMATIONS[action]) {
      throw new BudgetLifecycleRequestError("matching_dry_run_required");
    }
    if (typeof payload.expectedPlanFingerprint !== "string" ||
        !SHA256_HEX.test(payload.expectedPlanFingerprint)) {
      throw new BudgetLifecycleRequestError("expected_lifecycle_plan_required");
    }
  }
  try {
    return {
      action,
      definition: normalizeBudgetDefinitionPayload(definitionPayload(payload, action), action),
      isActive: payload.isActive,
      asOf: normalizeBudgetSnapshotGenerationAsOf(payload.asOf),
      ...(write ? { expectedPlanFingerprint: String(payload.expectedPlanFingerprint) } : {}),
    };
  } catch (error) {
    if (error instanceof BudgetDefinitionDryRunRequestError) {
      throw new BudgetLifecycleRequestError(error.code);
    }
    if (error instanceof Error && error.message === "asOf_invalid") {
      throw new BudgetLifecycleRequestError("asOf_invalid");
    }
    throw error;
  }
};

export const validateBudgetLifecyclePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
) => normalizePayload(payload, action, write);

const parseFrequencyDetails = (value: unknown): BudgetGenerationDefinition["frequencyDetails"] => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("frequency_details_invalid");
  const parsed = JSON.parse(value) as unknown;
  if (!isPlainObject(parsed)) throw new Error("frequency_details_invalid");
  return parsed;
};

const proposedBudget = (
  id: number,
  input: NormalizedLifecycleInput,
  updatedAt: string,
): BudgetGenerationDefinition => ({
  id,
  ...input.definition,
  accountId: input.definition.accountId,
  recipientId: input.definition.recipientId,
  isActive: input.isActive,
  updatedAt,
});

const storedBudget = (row: Row): BudgetGenerationDefinition => ({
  id: Number(row.id),
  description: String(row.description),
  categoryId: Number(row.categoryId),
  accountId: row.accountId == null ? null : Number(row.accountId),
  recipientId: row.recipientId == null ? null : Number(row.recipientId),
  amount: Number(row.amount),
  transactionCost: row.transactionCost == null ? null : Number(row.transactionCost),
  frequency: row.frequency as BudgetGenerationDefinition["frequency"],
  frequencyDetails: parseFrequencyDetails(row.frequencyDetails),
  isGoal: Number(row.isGoal),
  isFlexible: Number(row.isFlexible),
  goalPercentage: row.goalPercentage == null ? null : Number(row.goalPercentage),
  goalDirection: row.goalDirection as BudgetGenerationDefinition["goalDirection"],
  isActive: Number(row.isActive),
  remainingCyclesTotal: row.remainingCyclesTotal == null ? null : Number(row.remainingCyclesTotal),
  dueDate: String(row.dueDate),
  updatedAt: String(row.updatedAt),
});

const snapshotIdentities = (snapshots: Row[]) => snapshots.map((row) => ({
  id: Number(row.id), budgetId: Number(row.budgetId),
  occurrenceDate: String(row.occurrenceDate), dueDate: String(row.dueDate),
}));

const nextTargetId = (db: Database.Database): number => {
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM budgets").get() as { id: number };
  return Number(row.id);
};

const buildPlan = (db: Database.Database, input: NormalizedLifecycleInput): LifecyclePlan => {
  const currentBudget = input.action === "update"
    ? rowById(db, "budgets", input.definition.id!)
    : undefined;
  const targetId = input.action === "update" ? input.definition.id! : nextTargetId(db);
  const validationErrors: string[] = [];
  const conflicts = new Set<string>();
  const definitionDryRun = budgetDefinitionDryRun(
    db,
    definitionPayload({ ...input.definition }, input.action),
    input.action,
  );
  validationErrors.push(...definitionDryRun.validationErrors);

  const targetSnapshots = input.action === "update"
    ? (db.prepare("SELECT * FROM budgetSnapshots WHERE budgetId = @budgetId ORDER BY id ASC")
        .all({ budgetId: targetId }) as Row[])
    : [];
  const allSnapshotIds = new Set(rows(db, "budgetSnapshots").map((row) => Number(row.id)));
  const linkedIds = new Set<number>();
  const linkageRows = db.prepare(
    "SELECT id, budgetId, budgetSnapshotId FROM transactions WHERE budgetSnapshotId IS NOT NULL ORDER BY id ASC",
  ).all() as Row[];
  for (const row of linkageRows) {
    const snapshotId = Number(row.budgetSnapshotId);
    if (!Number.isInteger(snapshotId) || !allSnapshotIds.has(snapshotId)) {
      conflicts.add("transaction_snapshot_relationship_malformed");
    }
    linkedIds.add(snapshotId);
  }
  const normalizedAsOf = input.asOf.getTime();
  const cleanupSnapshots: Row[] = [];
  const retainedSnapshots: Row[] = [];
  const protectedSnapshots: Row[] = [];
  for (const snapshot of targetSnapshots) {
    const id = Number(snapshot.id);
    const occurrence = new Date(String(snapshot.occurrenceDate));
    if (!Number.isInteger(id) || id <= 0 || Number.isNaN(occurrence.getTime())) {
      conflicts.add("snapshot_identity_malformed");
      retainedSnapshots.push(snapshot);
      continue;
    }
    if (linkedIds.has(id)) protectedSnapshots.push(snapshot);
    if (occurrence.setHours(0, 0, 0, 0) >= normalizedAsOf && !linkedIds.has(id)) {
      cleanupSnapshots.push(snapshot);
    } else {
      retainedSnapshots.push(snapshot);
    }
  }

  const budget = proposedBudget(
    targetId,
    input,
    currentBudget ? String(currentBudget.updatedAt) : "1970-01-01T00:00:00.000Z",
  );
  const conflictPlan = calculateMissingBudgetSnapshotPlan({
    budgets: [budget], existingSnapshots: snapshotIdentities(targetSnapshots), asOf: input.asOf,
  });
  conflictsForPlan(conflictPlan, conflicts);
  const generationPlan = input.isActive
    ? calculateMissingBudgetSnapshotPlan({
        budgets: [budget], existingSnapshots: snapshotIdentities(retainedSnapshots), asOf: input.asOf,
      })
    : undefined;
  if (generationPlan) conflictsForPlan(generationPlan, conflicts);

  let scheduleKeys = new Set<string>();
  try {
    if (input.isActive) {
      scheduleKeys = new Set(
        calculateBudgetOccurrenceSchedule(budget, generationPlan!.activeHorizon)
          .map((occurrence) => localDayKey(occurrence.occurrenceDate)),
      );
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "recurrence_invalid");
  }
  const outOfScheduleProtectedCount = protectedSnapshots.filter(
    (snapshot) => !scheduleKeys.has(localDayKey(String(snapshot.occurrenceDate))),
  ).length;
  const generationCandidates = generationPlan?.candidates ?? [];
  const uniqueErrors = [...new Set(validationErrors)];
  const uniqueConflicts = [...conflicts].sort();
  const state = {
    action: input.action,
    definition: input.definition,
    isActive: input.isActive,
    asOf: localDayKey(input.asOf),
    budgets: rows(db, "budgets"),
    targetSnapshots,
    linkages: linkageRows,
    cleanupIds: cleanupSnapshots.map((row) => Number(row.id)),
    protectedIds: protectedSnapshots.map((row) => Number(row.id)),
    generation: generationCandidates.map((candidate) => candidate.identityKey),
    conflicts: uniqueConflicts,
    validationErrors: uniqueErrors,
  };
  return {
    input, targetId, targetPresent: input.action === "create" || Boolean(currentBudget),
    currentBudget, targetSnapshots, retainedSnapshots, cleanupSnapshots,
    protectedSnapshots, outOfScheduleProtectedCount, generationCandidates,
    conflicts: uniqueConflicts, validationErrors: uniqueErrors,
    ...(uniqueErrors.length === 0 && uniqueConflicts.length === 0
      ? { planFingerprint: fingerprint(state) }
      : {}),
  };
};

const conflictsForPlan = (
  plan: ReturnType<typeof calculateMissingBudgetSnapshotPlan>,
  conflicts: Set<string>,
) => {
  plan.conflictCodes.forEach((code) => conflicts.add(code));
  plan.validationErrors.forEach((code) => conflicts.add(code));
};

const actionName = (action: Action) =>
  action === "create" ? "createBudgetLifecycle" as const : "updateBudgetLifecycle" as const;

const buildResponse = (
  plan: LifecyclePlan,
  options: { dryRun?: boolean; sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): BudgetLifecycleResponse => {
  const dryRun = options.dryRun !== false;
  const errors = [...plan.validationErrors, ...plan.conflicts];
  const code = options.code ?? errors[0];
  const ok = errors.length === 0 && !code;
  const pastSnapshotsRetained = plan.retainedSnapshots.filter(
    (row) => new Date(String(row.occurrenceDate)).setHours(0, 0, 0, 0) < plan.input.asOf.getTime(),
  ).length;
  return {
    ok: options.sqliteMutated === true || ok,
    mode: "prototype",
    entity: "budgetLifecycle",
    action: actionName(plan.input.action),
    dryRun,
    wouldMutate: false,
    sqliteMutated: options.sqliteMutated === true,
    normalizedAsOf: localDayKey(plan.input.asOf),
    targetPresent: plan.targetPresent,
    ...(plan.input.action === "update" || options.sqliteMutated
      ? { targetId: plan.targetId }
      : {}),
    definitionWouldChange: plan.input.action === "create" || Boolean(plan.currentBudget),
    budgetActive: plan.input.isActive,
    existingSnapshotCount: plan.targetSnapshots.length,
    pastSnapshotsRetained,
    unlinkedFutureSnapshotsProposedForCleanup: plan.cleanupSnapshots.length,
    linkedSnapshotsProtected: plan.protectedSnapshots.length,
    outOfScheduleLinkedSnapshotsRetained: plan.outOfScheduleProtectedCount,
    snapshotsProposedForGeneration: plan.generationCandidates.length,
    expectedFinalSnapshotCount:
      plan.retainedSnapshots.length + plan.generationCandidates.length,
    conflictCount: plan.conflicts.length,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    validationErrors: errors,
    warnings: ok ? [
      "safer_sqlite_budget_lifecycle_policy_not_dexie_parity",
      "manual_checkpoint_rotation_required_before_authority_restart",
    ] : [],
    transactionLinkMutation: false,
    linkedSnapshotRewrite: false,
    historicalSnapshotRewrite: false,
    rowsChanged: options.rowsChanged ?? 0,
    safety: {
      dexieMutated: false, filesWritten: false, unrelatedRowsMutated: false,
      automaticCheckpointCreated: false, rawRowsIncluded: false,
    },
    resultCodes: options.sqliteMutated
      ? ["budget_lifecycle_write_completed", "sqlite_mutated"]
      : ok
        ? ["budget_lifecycle_dry_run_valid", "no_mutation_performed"]
        : ["budget_lifecycle_conflict", "no_mutation_performed"],
    ...(code ? { code } : {}),
  };
};

const errorPlan = (action: Action, code: string): LifecyclePlan => ({
  input: {
    action,
    definition: {} as NormalizedBudgetDefinitionInput,
    isActive: false,
    asOf: new Date(0),
  },
  targetId: 0, targetPresent: false, targetSnapshots: [], retainedSnapshots: [],
  cleanupSnapshots: [], protectedSnapshots: [], outOfScheduleProtectedCount: 0,
  generationCandidates: [], conflicts: [], validationErrors: [code],
});

export const budgetLifecycleRequestErrorResponse = (action: Action, code: string) =>
  buildResponse(errorPlan(action, code), { code });
export const budgetLifecycleDisabledResponse = (action: Action) =>
  budgetLifecycleRequestErrorResponse(action, "budget_lifecycle_writes_disabled");

export const budgetLifecycleDryRun = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): BudgetLifecycleResponse => {
  const input = normalizePayload(payload, action, false);
  return buildResponse(buildPlan(db, input));
};

const sqlDefinition = (input: NormalizedLifecycleInput) => ({
  ...input.definition,
  frequencyDetails: input.definition.frequencyDetails
    ? JSON.stringify(input.definition.frequencyDetails) : null,
  isGoal: input.definition.isGoal ? 1 : 0,
  isFlexible: input.definition.isFlexible ? 1 : 0,
  isActive: input.isActive ? 1 : 0,
});

const nextTimestamp = (previous?: unknown): string => {
  const now = Date.now();
  const old = typeof previous === "string" ? new Date(previous).getTime() : 0;
  return new Date(Math.max(now, Number.isFinite(old) ? old + 1 : now)).toISOString();
};

const insertSnapshot = (db: Database.Database, candidate: BudgetSnapshotGenerationCandidate, timestamp: string) => {
  const value = candidate.values;
  return db.prepare(`INSERT INTO budgetSnapshots (
    budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
    accountId, recipientId, amount, transactionCost, frequency, frequencyDetails,
    isGoal, isFlexible, goalPercentage, goalDirection, remainingCyclesTotal,
    isHistorical, sourceBudgetUpdatedAt, createdAt, updatedAt
  ) VALUES (
    @budgetId, @occurrenceDate, @dueDate, @cycleIndex, @description, @categoryId,
    @accountId, @recipientId, @amount, @transactionCost, @frequency, @frequencyDetails,
    @isGoal, @isFlexible, @goalPercentage, @goalDirection, @remainingCyclesTotal,
    @isHistorical, @sourceBudgetUpdatedAt, @createdAt, @updatedAt
  )`).run({
    ...value,
    occurrenceDate: value.occurrenceDate.toISOString(),
    dueDate: value.dueDate.toISOString(),
    accountId: value.accountId ?? null,
    recipientId: value.recipientId ?? null,
    transactionCost: value.transactionCost ?? null,
    frequencyDetails: value.frequencyDetails ? JSON.stringify(value.frequencyDetails) : null,
    isGoal: value.isGoal ? 1 : 0,
    isFlexible: value.isFlexible ? 1 : 0,
    goalPercentage: value.goalPercentage ?? null,
    goalDirection: value.goalDirection ?? null,
    remainingCyclesTotal: value.remainingCyclesTotal ?? null,
    isHistorical: value.isHistorical ? 1 : 0,
    sourceBudgetUpdatedAt: value.sourceBudgetUpdatedAt instanceof Date
      ? value.sourceBudgetUpdatedAt.toISOString() : value.sourceBudgetUpdatedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

export const budgetLifecycleRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): BudgetLifecycleResponse => {
  const input = normalizePayload(payload, action, true);
  const execute = db.transaction(() => {
    const beforePlan = buildPlan(db, input);
    if (!beforePlan.planFingerprint ||
        beforePlan.planFingerprint !== input.expectedPlanFingerprint) {
      return buildResponse(beforePlan, {
        dryRun: false,
        code: beforePlan.planFingerprint
          ? "budget_lifecycle_plan_stale"
          : beforePlan.validationErrors[0] ?? beforePlan.conflicts[0],
      });
    }
    const before = Object.fromEntries(
      [...IMMUTABLE_TABLES, "budgets", "budgetSnapshots"].map(
        (table) => [table, rows(db, table)],
      ),
    ) as Record<string, Row[]>;
    const definition = sqlDefinition(input);
    const timestamp = nextTimestamp(beforePlan.currentBudget?.updatedAt);
    let targetId = beforePlan.targetId;
    let budgetChanges = 0;
    if (action === "create") {
      const result = db.prepare(`INSERT INTO budgets (
        description, categoryId, paymentChannelId, accountId, recipientId,
        amount, transactionCost, frequency, frequencyDetails, isGoal, isFlexible,
        goalPercentage, goalDirection, isActive, remainingCyclesTotal, dueDate,
        createdAt, updatedAt
      ) VALUES (
        @description, @categoryId, NULL, @accountId, @recipientId, @amount,
        @transactionCost, @frequency, @frequencyDetails, @isGoal, @isFlexible,
        @goalPercentage, @goalDirection, @isActive, @remainingCyclesTotal,
        @dueDate, @createdAt, @updatedAt
      )`).run({ ...definition, createdAt: timestamp, updatedAt: timestamp });
      targetId = Number(result.lastInsertRowid);
      budgetChanges = result.changes;
      if (targetId !== beforePlan.targetId) throw new Error("budget_lifecycle_target_id_changed");
    } else {
      budgetChanges = db.prepare(`UPDATE budgets SET
        description=@description, categoryId=@categoryId, accountId=@accountId,
        recipientId=@recipientId, amount=@amount, transactionCost=@transactionCost,
        frequency=@frequency, frequencyDetails=@frequencyDetails, isGoal=@isGoal,
        isFlexible=@isFlexible, goalPercentage=@goalPercentage,
        goalDirection=@goalDirection, isActive=@isActive,
        remainingCyclesTotal=@remainingCyclesTotal, dueDate=@dueDate,
        updatedAt=@updatedAt WHERE id=@id
      `).run({ ...definition, id: targetId, updatedAt: timestamp }).changes;
    }
    if (budgetChanges !== 1) throw new Error("budget_lifecycle_definition_change_failed");

    const deleteStatement = db.prepare("DELETE FROM budgetSnapshots WHERE id = @id");
    let deleted = 0;
    beforePlan.cleanupSnapshots.forEach((snapshot) => {
      deleted += deleteStatement.run({ id: snapshot.id }).changes;
    });
    if (deleted !== beforePlan.cleanupSnapshots.length) {
      throw new Error("budget_lifecycle_cleanup_count_mismatch");
    }

    const persistedBudget = rowById(db, "budgets", targetId);
    if (!persistedBudget) throw new Error("budget_lifecycle_target_missing_after_write");
    const retained = db.prepare(
      "SELECT * FROM budgetSnapshots WHERE budgetId = @budgetId ORDER BY id ASC",
    ).all({ budgetId: targetId }) as Row[];
    const generationPlan = input.isActive
      ? calculateMissingBudgetSnapshotPlan({
          budgets: [storedBudget(persistedBudget)],
          existingSnapshots: snapshotIdentities(retained),
          asOf: input.asOf,
        })
      : undefined;
    if (generationPlan &&
        (generationPlan.conflictCount > 0 || generationPlan.validationErrors.length > 0)) {
      throw new Error("budget_lifecycle_generation_conflict_after_write");
    }
    let inserted = 0;
    for (const candidate of generationPlan?.candidates ?? []) {
      inserted += insertSnapshot(db, candidate, timestamp).changes;
    }

    for (const table of IMMUTABLE_TABLES) {
      if (serialized(rows(db, table)) !== serialized(before[table])) {
        throw new Error(`budget_lifecycle_changed_${table}`);
      }
    }
    const otherBudgetsBefore = before.budgets.filter((row) => Number(row.id) !== targetId);
    const otherBudgetsAfter = rows(db, "budgets").filter((row) => Number(row.id) !== targetId);
    if (serialized(otherBudgetsAfter) !== serialized(otherBudgetsBefore)) {
      throw new Error("budget_lifecycle_changed_unrelated_budgets");
    }
    const otherSnapshotsBefore = before.budgetSnapshots.filter((row) => Number(row.budgetId) !== targetId);
    const otherSnapshotsAfter = rows(db, "budgetSnapshots").filter((row) => Number(row.budgetId) !== targetId);
    if (serialized(otherSnapshotsAfter) !== serialized(otherSnapshotsBefore)) {
      throw new Error("budget_lifecycle_changed_unrelated_snapshots");
    }
    const finalTarget = rows(db, "budgetSnapshots").filter((row) => Number(row.budgetId) === targetId);
    for (const retainedRow of beforePlan.retainedSnapshots) {
      const after = finalTarget.find((row) => Number(row.id) === Number(retainedRow.id));
      if (serialized(after) !== serialized(retainedRow)) {
        throw new Error("budget_lifecycle_changed_retained_snapshot");
      }
    }
    const finalCheck = calculateMissingBudgetSnapshotPlan({
      budgets: [storedBudget(persistedBudget)],
      existingSnapshots: snapshotIdentities(finalTarget),
      asOf: input.asOf,
    });
    if (finalCheck.conflictCount > 0 || finalCheck.validationErrors.length > 0 ||
        (input.isActive && finalCheck.candidates.length > 0)) {
      throw new Error("budget_lifecycle_final_state_invalid");
    }
    return buildResponse(beforePlan, {
      dryRun: false,
      sqliteMutated: true,
      rowsChanged: budgetChanges + deleted + inserted,
    });
  });
  return execute.immediate();
};

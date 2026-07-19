import Database from "better-sqlite3";
import {
  budgetDefinitionDryRun,
  type BudgetDefinitionAction,
  type BudgetDefinitionDryRunResponse,
  BudgetDefinitionDryRunRequestError,
  normalizeBudgetDefinitionPayload,
  type NormalizedBudgetDefinitionInput,
} from "./budgetDefinitionDryRun.js";

export const BUDGET_DEFINITION_CREATE_CONFIRMATION =
  "create budget definition in disposable sqlite" as const;
export const BUDGET_DEFINITION_UPDATE_CONFIRMATION =
  "update budget definition in disposable sqlite" as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
const DATA_FIELDS = new Set([
  "id",
  "description",
  "categoryId",
  "accountId",
  "recipientId",
  "amount",
  "transactionCost",
  "frequency",
  "frequencyDetails",
  "isGoal",
  "isFlexible",
  "goalPercentage",
  "goalDirection",
  "remainingCyclesTotal",
  "dueDate",
]);
const RELATED_TABLES = [
  "transactions",
  "budgetSnapshots",
  "buckets",
  "categories",
  "accounts",
  "paymentMethods",
  "recipients",
  "smsImportTemplates",
] as const;

export interface BudgetDefinitionWriteResponse
  extends Omit<
    BudgetDefinitionDryRunResponse,
    "dryRun" | "wouldMutate" | "safety"
  > {
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    snapshotsMutated: false;
    transactionsMutated: false;
    rawRowsIncluded: false;
  };
}

export class BudgetDefinitionWriteRequestError extends Error {
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

export const validateBudgetDefinitionWritePayload = (
  payload: unknown,
  action: BudgetDefinitionAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new BudgetDefinitionWriteRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (!DATA_FIELDS.has(field) && !CONTROL_FIELDS.has(field)) {
      throw new BudgetDefinitionWriteRequestError(
        "unexpected_payload_field",
      );
    }
    if (action === "create" && field === "id") {
      throw new BudgetDefinitionWriteRequestError(
        "unexpected_payload_field",
      );
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new BudgetDefinitionWriteRequestError("dry_run_reviewed_required");
  }
  const confirmation =
    action === "create"
      ? BUDGET_DEFINITION_CREATE_CONFIRMATION
      : BUDGET_DEFINITION_UPDATE_CONFIRMATION;
  if (payload.confirmation !== confirmation) {
    throw new BudgetDefinitionWriteRequestError("matching_dry_run_required");
  }
  const data = Object.fromEntries(
    Object.entries(payload).filter(([field]) => DATA_FIELDS.has(field)),
  );
  try {
    normalizeBudgetDefinitionPayload(data, action);
  } catch (error) {
    if (error instanceof BudgetDefinitionDryRunRequestError) {
      throw new BudgetDefinitionWriteRequestError(error.code);
    }
    throw error;
  }
  return data;
};

const rows = (
  db: Database.Database,
  table: "budgets" | (typeof RELATED_TABLES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];
const serialize = (value: unknown): string => JSON.stringify(value);
const withoutId = (
  tableRows: Record<string, unknown>[],
  id: number,
): Record<string, unknown>[] =>
  tableRows.filter((row) => Number(row.id) !== id);
const relatedFingerprints = (
  db: Database.Database,
): Record<(typeof RELATED_TABLES)[number], string> =>
  Object.fromEntries(
    RELATED_TABLES.map((table) => [table, serialize(rows(db, table))]),
  ) as Record<(typeof RELATED_TABLES)[number], string>;

const assertRelatedUnchanged = (
  db: Database.Database,
  before: Record<(typeof RELATED_TABLES)[number], string>,
): void => {
  for (const table of RELATED_TABLES) {
    if (serialize(rows(db, table)) !== before[table]) {
      throw new Error("budget_definition_related_table_boundary_failed");
    }
  }
};

const nextTimestamp = (previous?: unknown): string => {
  const now = new Date();
  const previousTime =
    typeof previous === "string" ? Date.parse(previous) : Number.NaN;
  return Number.isFinite(previousTime) && now.getTime() <= previousTime
    ? new Date(previousTime + 1).toISOString()
    : now.toISOString();
};

const response = (input: {
  action: BudgetDefinitionAction;
  dryRun?: BudgetDefinitionDryRunResponse;
  targetId: number | null;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  resultCodes: string[];
  code?: string;
}): BudgetDefinitionWriteResponse => {
  const dryRun = input.dryRun;
  const validationErrors = input.validationErrors ?? [];
  return {
    ok:
      validationErrors.length === 0 &&
      input.resultCodes.includes("sqlite_mutated"),
    mode: "prototype",
    entity: "budgetDefinition",
    action: input.action,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    goalDirectionSummary: dryRun?.goalDirectionSummary ?? {
      explicit: false,
      effectiveDirection: null,
      amountSignFallbackUsed: false,
    },
    recurrenceSummary: dryRun?.recurrenceSummary ?? {
      frequency: null,
      hasFrequencyDetails: false,
      remainingCyclesLimited: false,
      definitionWouldChange: false,
    },
    referenceSummary: dryRun?.referenceSummary ?? {
      categoryExists: null,
      bucketExists: null,
      accountExists: null,
      recipientProvided: false,
      recipientExists: null,
      categoryWouldChange: false,
    },
    duplicateSummary: dryRun?.duplicateSummary ?? {
      duplicateDefinitionCandidates: 0,
    },
    futureSnapshotImpactSummary: dryRun?.futureSnapshotImpactSummary ?? {
      definitionFieldsAffectingFutureGenerationWouldChange: false,
      existingSnapshotsWouldChange: false,
      snapshotGenerationWouldRun: false,
    },
    historicalSnapshotMutation: false,
    transactionLinkMutation: false,
    timestampBehavior: dryRun?.timestampBehavior ?? {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: input.action === "update",
    },
    validationErrors,
    warnings: dryRun?.warnings ?? [],
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      snapshotsMutated: false,
      transactionsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: input.resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const budgetDefinitionWriteDisabledResponse = (
  action: BudgetDefinitionAction,
): BudgetDefinitionWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: ["budget_definition_writes_disabled"],
    resultCodes: ["budget_definition_writes_disabled", "no_mutation_performed"],
    code: "budget_definition_writes_disabled",
  });

export const budgetDefinitionWriteRequestErrorResponse = (
  action: BudgetDefinitionAction,
  code: string,
): BudgetDefinitionWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

const sqlInput = (input: NormalizedBudgetDefinitionInput) => ({
  ...input,
  frequencyDetails: input.frequencyDetails
    ? JSON.stringify(input.frequencyDetails)
    : null,
  isGoal: input.isGoal ? 1 : 0,
  isFlexible: input.isFlexible ? 1 : 0,
});

const assertPersistedDefinitionFields = (
  row: Record<string, unknown>,
  input: NormalizedBudgetDefinitionInput,
): void => {
  const expected = sqlInput(input);
  for (const field of [
    "description",
    "categoryId",
    "accountId",
    "recipientId",
    "amount",
    "transactionCost",
    "frequency",
    "frequencyDetails",
    "isGoal",
    "isFlexible",
    "goalPercentage",
    "goalDirection",
    "remainingCyclesTotal",
    "dueDate",
  ] as const) {
    if (serialize(row[field]) !== serialize(expected[field])) {
      throw new Error(`budget_definition_persisted_${field}_mismatch`);
    }
  }
};

const createBudgetDefinition = (
  db: Database.Database,
  input: NormalizedBudgetDefinitionInput,
  dryRun: BudgetDefinitionDryRunResponse,
): BudgetDefinitionWriteResponse => {
  const budgetsBefore = rows(db, "budgets");
  const relatedBefore = relatedFingerprints(db);
  const timestamp = nextTimestamp();
  const result = db
    .prepare(
      `INSERT INTO budgets (
        description, categoryId, paymentChannelId, accountId, recipientId,
        amount, transactionCost, frequency, frequencyDetails, isGoal,
        isFlexible, goalPercentage, goalDirection, isActive,
        remainingCyclesTotal, dueDate, createdAt, updatedAt
      ) VALUES (
        @description, @categoryId, NULL, @accountId, @recipientId,
        @amount, @transactionCost, @frequency, @frequencyDetails, @isGoal,
        @isFlexible, @goalPercentage, @goalDirection, 1,
        @remainingCyclesTotal, @dueDate, @createdAt, @updatedAt
      )`,
    )
    .run({
      ...sqlInput(input),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  const targetId = Number(result.lastInsertRowid);
  const budgetsAfter = rows(db, "budgets");
  const created = budgetsAfter.find((row) => Number(row.id) === targetId);
  if (
    result.changes !== 1 ||
    !created ||
    budgetsAfter.length !== budgetsBefore.length + 1 ||
    serialize(withoutId(budgetsAfter, targetId)) !== serialize(budgetsBefore)
  ) {
    throw new Error("budget_definition_create_invariant_failed");
  }
  assertPersistedDefinitionFields(created, input);
  if (
    created.paymentChannelId !== null ||
    Number(created.isActive) !== 1 ||
    created.createdAt !== timestamp ||
    created.updatedAt !== timestamp
  ) {
    throw new Error("budget_definition_create_defaults_mismatch");
  }
  assertRelatedUnchanged(db, relatedBefore);
  return response({
    action: "create",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["budget_definition_created", "sqlite_mutated"],
  });
};

const updateBudgetDefinition = (
  db: Database.Database,
  input: NormalizedBudgetDefinitionInput,
  dryRun: BudgetDefinitionDryRunResponse,
): BudgetDefinitionWriteResponse => {
  const targetId = input.id!;
  const budgetsBefore = rows(db, "budgets");
  const previous = budgetsBefore.find((row) => Number(row.id) === targetId);
  if (!previous) {
    return response({
      action: "update",
      dryRun,
      targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: ["budget_definition_not_found"],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: "budget_definition_not_found",
    });
  }
  const relatedBefore = relatedFingerprints(db);
  const result = db
    .prepare(
      `UPDATE budgets SET
        description = @description,
        categoryId = @categoryId,
        accountId = @accountId,
        recipientId = @recipientId,
        amount = @amount,
        transactionCost = @transactionCost,
        frequency = @frequency,
        frequencyDetails = @frequencyDetails,
        isGoal = @isGoal,
        isFlexible = @isFlexible,
        goalPercentage = @goalPercentage,
        goalDirection = @goalDirection,
        remainingCyclesTotal = @remainingCyclesTotal,
        dueDate = @dueDate,
        updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run({
      ...sqlInput(input),
      updatedAt: nextTimestamp(previous.updatedAt),
    });
  const budgetsAfter = rows(db, "budgets");
  const updated = budgetsAfter.find((row) => Number(row.id) === targetId);
  for (const field of [
    "id",
    "paymentChannelId",
    "isActive",
    "createdAt",
  ]) {
    if (serialize(previous[field]) !== serialize(updated?.[field])) {
      throw new Error(`budget_definition_update_changed_preserved_${field}`);
    }
  }
  if (updated) {
    assertPersistedDefinitionFields(updated, input);
    if (
      serialize(updated.updatedAt) === serialize(previous.updatedAt)
    ) {
      throw new Error("budget_definition_updatedAt_not_advanced");
    }
  }
  if (
    result.changes !== 1 ||
    !updated ||
    budgetsAfter.length !== budgetsBefore.length ||
    serialize(withoutId(budgetsAfter, targetId)) !==
      serialize(withoutId(budgetsBefore, targetId))
  ) {
    throw new Error("budget_definition_update_invariant_failed");
  }
  assertRelatedUnchanged(db, relatedBefore);
  return response({
    action: "update",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["budget_definition_updated", "sqlite_mutated"],
  });
};

export const budgetDefinitionRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: BudgetDefinitionAction,
): BudgetDefinitionWriteResponse => {
  const data = validateBudgetDefinitionWritePayload(payload, action);
  const dryRun = budgetDefinitionDryRun(db, data, action);
  if (!dryRun.ok) {
    return response({
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
    const input = normalizeBudgetDefinitionPayload(data, action);
    return action === "create"
      ? createBudgetDefinition(db, input, dryRun)
      : updateBudgetDefinition(db, input, dryRun);
  });
  return transaction();
};

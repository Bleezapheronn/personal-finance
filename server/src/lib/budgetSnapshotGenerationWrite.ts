import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { BudgetSnapshotGenerationCandidate } from "../../shared/budgetSnapshotGeneration.js";
import { FULL_BACKUP_TABLE_NAMES } from "./backup.js";
import {
  buildBudgetSnapshotGenerationPlan,
  type BudgetSnapshotGenerationDryRunResponse,
  BudgetSnapshotGenerationRequestError,
  normalizeBudgetSnapshotGenerationAsOf,
} from "./budgetSnapshotGenerationDryRun.js";

export const BUDGET_SNAPSHOT_GENERATION_CONFIRMATION =
  "generate missing budget snapshots in disposable sqlite" as const;

const WRITE_FIELDS = new Set(["asOf", "dryRunReviewed", "confirmation"]);

export interface BudgetSnapshotGenerationWriteResponse
  extends Omit<
    BudgetSnapshotGenerationDryRunResponse,
    "dryRun" | "wouldMutate" | "safety"
  > {
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsInserted: number;
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    budgetsMutated: false;
    transactionsMutated: false;
    existingSnapshotsMutated: false;
    rawRowsIncluded: false;
    generatedIdsIncluded: false;
  };
}

export class BudgetSnapshotGenerationWriteRequestError extends Error {
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

export const validateBudgetSnapshotGenerationWritePayload = (
  payload: unknown,
): Date => {
  if (!isPlainObject(payload)) {
    throw new BudgetSnapshotGenerationWriteRequestError(
      "payload_must_be_object",
    );
  }
  for (const field of Object.keys(payload)) {
    if (!WRITE_FIELDS.has(field)) {
      throw new BudgetSnapshotGenerationWriteRequestError(
        "unexpected_payload_field",
      );
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new BudgetSnapshotGenerationWriteRequestError(
      "dry_run_reviewed_required",
    );
  }
  if (payload.confirmation !== BUDGET_SNAPSHOT_GENERATION_CONFIRMATION) {
    throw new BudgetSnapshotGenerationWriteRequestError(
      "matching_dry_run_required",
    );
  }
  try {
    return normalizeBudgetSnapshotGenerationAsOf(payload.asOf);
  } catch (error) {
    if (error instanceof BudgetSnapshotGenerationRequestError) {
      throw new BudgetSnapshotGenerationWriteRequestError(error.code);
    }
    throw error;
  }
};

const tableRows = (
  db: Database.Database,
  table: (typeof FULL_BACKUP_TABLE_NAMES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const tableFingerprints = (
  db: Database.Database,
): Record<(typeof FULL_BACKUP_TABLE_NAMES)[number], string> =>
  Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((table) => [
      table,
      fingerprint(tableRows(db, table)),
    ]),
  ) as Record<(typeof FULL_BACKUP_TABLE_NAMES)[number], string>;

const budgetHistoryFingerprint = (
  db: Database.Database,
  excludedSnapshotIds: Set<number> = new Set(),
): string =>
  fingerprint({
    snapshots: tableRows(db, "budgetSnapshots").filter(
      (row) => !excludedSnapshotIds.has(Number(row.id)),
    ),
    transactions: db
      .prepare(
        `SELECT id, amount, transactionCost, budgetId, occurrenceDate,
          budgetSnapshotId FROM transactions ORDER BY id ASC`,
      )
      .all(),
    budgets: db.prepare("SELECT * FROM budgets ORDER BY id ASC").all(),
  });

const asSql = (
  candidate: BudgetSnapshotGenerationCandidate,
  timestamp: string,
): Record<string, unknown> => {
  const values = candidate.values;
  return {
    ...values,
    occurrenceDate: (values.occurrenceDate as Date).toISOString(),
    dueDate: (values.dueDate as Date).toISOString(),
    accountId: values.accountId ?? null,
    recipientId: values.recipientId ?? null,
    transactionCost: values.transactionCost ?? null,
    frequencyDetails: values.frequencyDetails
      ? JSON.stringify(values.frequencyDetails)
      : null,
    isGoal: values.isGoal ? 1 : 0,
    isFlexible: values.isFlexible ? 1 : 0,
    goalPercentage: values.goalPercentage ?? null,
    goalDirection: values.goalDirection ?? null,
    remainingCyclesTotal: values.remainingCyclesTotal ?? null,
    isHistorical: values.isHistorical ? 1 : 0,
    sourceBudgetUpdatedAt:
      values.sourceBudgetUpdatedAt instanceof Date
        ? values.sourceBudgetUpdatedAt.toISOString()
        : values.sourceBudgetUpdatedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const response = (input: {
  dryRun: BudgetSnapshotGenerationDryRunResponse;
  rowsInserted: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  resultCodes: string[];
  code?: string;
}): BudgetSnapshotGenerationWriteResponse => {
  const {
    dryRun: _dryRun,
    wouldMutate: _wouldMutate,
    safety: _dryRunSafety,
    ...summary
  } = input.dryRun;
  return {
    ...summary,
    ok: (input.validationErrors ?? []).length === 0,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsInserted: input.rowsInserted,
    validationErrors: input.validationErrors ?? input.dryRun.validationErrors,
    resultCodes: input.resultCodes,
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      budgetsMutated: false,
      transactionsMutated: false,
      existingSnapshotsMutated: false,
      rawRowsIncluded: false,
      generatedIdsIncluded: false,
    },
    ...(input.code ? { code: input.code } : {}),
  };
};

export const budgetSnapshotGenerationWriteDisabledResponse = (
  dryRun: BudgetSnapshotGenerationDryRunResponse,
): BudgetSnapshotGenerationWriteResponse =>
  response({
    dryRun,
    rowsInserted: 0,
    sqliteMutated: false,
    validationErrors: ["budget_snapshot_generation_writes_disabled"],
    resultCodes: [
      "budget_snapshot_generation_writes_disabled",
      "no_mutation_performed",
    ],
    code: "budget_snapshot_generation_writes_disabled",
  });

export const budgetSnapshotGenerationWriteRequestErrorResponse = (
  dryRun: BudgetSnapshotGenerationDryRunResponse,
  code: string,
): BudgetSnapshotGenerationWriteResponse =>
  response({
    dryRun,
    rowsInserted: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

export const budgetSnapshotGenerationRealWrite = (
  db: Database.Database,
  payload: unknown,
): BudgetSnapshotGenerationWriteResponse => {
  const asOf = validateBudgetSnapshotGenerationWritePayload(payload);
  const execute = db.transaction(() => {
    const { plan, response: dryRun } = buildBudgetSnapshotGenerationPlan(
      db,
      asOf,
    );
    if (!dryRun.ok) {
      return response({
        dryRun,
        rowsInserted: 0,
        sqliteMutated: false,
        validationErrors: dryRun.validationErrors.length
          ? dryRun.validationErrors
          : [dryRun.code ?? "generation_blocked"],
        resultCodes: ["generation_blocked", "no_mutation_performed"],
        code: dryRun.code ?? "generation_blocked",
      });
    }
    if (plan.candidates.length === 0) {
      return response({
        dryRun,
        rowsInserted: 0,
        sqliteMutated: false,
        resultCodes: ["generation_noop", "no_mutation_performed"],
      });
    }

    const before = tableFingerprints(db);
    const snapshotsBefore = tableRows(db, "budgetSnapshots");
    const historyBefore = budgetHistoryFingerprint(db);
    const timestamp = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO budgetSnapshots (
        budgetId, occurrenceDate, dueDate, cycleIndex, description, categoryId,
        accountId, recipientId, amount, transactionCost, frequency,
        frequencyDetails, isGoal, isFlexible, goalPercentage, goalDirection,
        remainingCyclesTotal, isHistorical, sourceBudgetUpdatedAt, createdAt,
        updatedAt
      ) VALUES (
        @budgetId, @occurrenceDate, @dueDate, @cycleIndex, @description,
        @categoryId, @accountId, @recipientId, @amount, @transactionCost,
        @frequency, @frequencyDetails, @isGoal, @isFlexible, @goalPercentage,
        @goalDirection, @remainingCyclesTotal, @isHistorical,
        @sourceBudgetUpdatedAt, @createdAt, @updatedAt
      )`,
    );
    const insertedIds: number[] = [];
    for (const candidate of plan.candidates) {
      const result = insert.run(asSql(candidate, timestamp));
      if (result.changes !== 1) {
        throw new Error("budget_snapshot_insert_count_mismatch");
      }
      insertedIds.push(Number(result.lastInsertRowid));
    }
    if (new Set(insertedIds).size !== insertedIds.length) {
      throw new Error("budget_snapshot_generated_id_collision");
    }

    const snapshotsAfter = tableRows(db, "budgetSnapshots");
    const insertedIdSet = new Set(insertedIds);
    const preExistingAfter = snapshotsAfter.filter(
      (row) => !insertedIdSet.has(Number(row.id)),
    );
    if (fingerprint(preExistingAfter) !== fingerprint(snapshotsBefore)) {
      throw new Error("pre_existing_budget_snapshot_changed");
    }
    const insertedRows = snapshotsAfter.filter((row) =>
      insertedIdSet.has(Number(row.id)),
    );
    if (
      insertedRows.length !== plan.candidates.length ||
      snapshotsAfter.length !== snapshotsBefore.length + plan.candidates.length
    ) {
      throw new Error("budget_snapshot_insert_invariant_failed");
    }
    for (let index = 0; index < insertedRows.length; index += 1) {
      const expected = asSql(plan.candidates[index], timestamp);
      const actual = insertedRows[index];
      for (const field of Object.keys(expected)) {
        if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
          throw new Error("budget_snapshot_persisted_field_mismatch");
        }
      }
    }

    const after = tableFingerprints(db);
    for (const table of FULL_BACKUP_TABLE_NAMES) {
      if (table === "budgetSnapshots") continue;
      if (after[table] !== before[table]) {
        throw new Error(`budget_snapshot_generation_changed_${table}`);
      }
    }
    const postPlan = buildBudgetSnapshotGenerationPlan(db, asOf);
    if (!postPlan.response.ok || postPlan.plan.candidates.length !== 0) {
      throw new Error("budget_snapshot_generation_not_idempotent");
    }
    if (historyBefore !== budgetHistoryFingerprint(db, insertedIdSet)) {
      throw new Error("pre_existing_budget_history_changed");
    }

    return response({
      dryRun,
      rowsInserted: insertedRows.length,
      sqliteMutated: true,
      resultCodes: ["missing_snapshots_generated", "sqlite_mutated"],
    });
  });
  return execute.immediate();
};

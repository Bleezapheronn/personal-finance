import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { calculateBudgetOccurrenceSchedule, normalizeToLocalDay } from "../../shared/budgetSnapshotGeneration.js";
import { catchUpHistoricalOccurrences, occurrenceFrozen, storedBudgetDefinition } from "./budgetOccurrenceModel.js";
import { normalizeBudgetDefinitionPayload, type NormalizedBudgetDefinitionInput } from "./budgetDefinitionDryRun.js";

type Row = Record<string, unknown>;

export const BUDGET_SCHEDULE_SUCCESSOR_CONFIRMATION =
  "create budget schedule successor in sqlite" as const;

interface Input {
  budgetId: number;
  definition: NormalizedBudgetDefinitionInput;
  asOf: Date;
  expectedPlanFingerprint?: string;
}

interface Transfer { snapshotId: number; dueDate: Date; cycleIndex: number }
interface Plan { input: Input; predecessor?: Row; successorId: number; transfers: Transfer[]; remainingCyclesTotal: number | null; errors: string[]; fingerprint?: string }

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parse = (raw: unknown, write: boolean): Input => {
  if (!plain(raw) || typeof raw.budgetId !== "number" || !Number.isInteger(raw.budgetId) || !plain(raw.definition) || typeof raw.asOf !== "string") {
    throw new Error("schedule_successor_payload_invalid");
  }
  if (write && (raw.dryRunReviewed !== true || raw.confirmation !== BUDGET_SCHEDULE_SUCCESSOR_CONFIRMATION || typeof raw.expectedPlanFingerprint !== "string")) {
    throw new Error("schedule_successor_review_required");
  }
  return {
    budgetId: raw.budgetId,
    definition: normalizeBudgetDefinitionPayload(raw.definition, "create"),
    asOf: normalizeToLocalDay(raw.asOf),
    ...(write ? { expectedPlanFingerprint: String(raw.expectedPlanFingerprint) } : {}),
  };
};

const nextBudgetId = (db: Database.Database) => Number((db.prepare("SELECT COALESCE(MAX(id), 0) + 1 id FROM budgets").get() as { id: number }).id);
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const buildPlan = (db: Database.Database, input: Input): Plan => {
  const predecessor = db.prepare("SELECT * FROM budgets WHERE id = ?").get(input.budgetId) as Row | undefined;
  const errors: string[] = [];
  if (!predecessor) errors.push("budget_not_found");
  if (predecessor && Number(predecessor.isActive) !== 1) errors.push("predecessor_budget_inactive");
  if (predecessor && String(predecessor.frequency) === "once") errors.push("one_time_budget_has_no_successor");
  if (input.definition.frequency === "once") errors.push("successor_frequency_invalid");
  const successorId = nextBudgetId(db);
  const today = input.asOf;
  const snapshots = predecessor
    ? db.prepare(`SELECT s.* FROM budgetSnapshots s WHERE s.budgetId = @budgetId
      AND date(s.dueDate) >= date(@today) AND EXISTS (
        SELECT 1 FROM transactions t WHERE t.budgetSnapshotId = s.id
      ) ORDER BY date(s.dueDate), s.id`).all({ budgetId: input.budgetId, today: today.toISOString() }) as Row[]
    : [];
  const old = predecessor ? storedBudgetDefinition(predecessor) : undefined;
  const oldHistoricalCycles = old
    ? calculateBudgetOccurrenceSchedule(old, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)).length
    : 0;
  const total = old?.remainingCyclesTotal ?? null;
  const remaining = total == null ? null : Math.max(0, total - oldHistoricalCycles);
  if (remaining !== null && snapshots.length > remaining) errors.push("successor_prepaid_cycles_exceed_remaining");
  const successorDefinition = {
    id: successorId,
    ...input.definition,
    isActive: 1,
    updatedAt: new Date().toISOString(),
    remainingCyclesTotal: remaining,
  };
  let transfers: Transfer[] = [];
  try {
    const scheduled = calculateBudgetOccurrenceSchedule(successorDefinition, new Date(2100, 0, 1));
    if (scheduled.length < snapshots.length) errors.push("successor_mapping_insufficient");
    transfers = snapshots.map((snapshot, index) => ({
      snapshotId: Number(snapshot.id), dueDate: scheduled[index]?.occurrenceDate, cycleIndex: index + 1,
    })).filter((value): value is Transfer => value.dueDate instanceof Date);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "successor_mapping_ambiguous");
  }
  const state = { input: { budgetId: input.budgetId, definition: input.definition, asOf: input.asOf.toISOString() }, predecessor, snapshots, remaining, errors };
  return { input, predecessor, successorId, transfers, remainingCyclesTotal: remaining, errors: [...new Set(errors)], ...(errors.length === 0 ? { fingerprint: fingerprint(state) } : {}) };
};

export const budgetScheduleSuccessorDryRun = (db: Database.Database, raw: unknown) => {
  const plan = buildPlan(db, parse(raw, false));
  return { ok: plan.errors.length === 0, dryRun: true, successorId: plan.successorId, transferredOccurrenceCount: plan.transfers.length, remainingCyclesTotal: plan.remainingCyclesTotal, validationErrors: plan.errors, planFingerprint: plan.fingerprint };
};

export const budgetScheduleSuccessorWrite = (db: Database.Database, raw: unknown) => {
  const input = parse(raw, true);
  return db.transaction(() => {
    const plan = buildPlan(db, input);
    if (!plan.fingerprint || plan.fingerprint !== input.expectedPlanFingerprint) return { ok: false, code: plan.fingerprint ? "schedule_successor_plan_stale" : plan.errors[0], validationErrors: plan.errors };
    catchUpHistoricalOccurrences(db, input.budgetId, input.asOf);
    const now = new Date().toISOString();
    const definition = plan.input.definition;
    const inserted = db.prepare(`INSERT INTO budgets (
      id, description, categoryId, paymentChannelId, accountId, recipientId, amount, transactionCost,
      frequency, frequencyDetails, isGoal, isFlexible, goalPercentage, goalDirection, isActive,
      remainingCyclesTotal, predecessorBudgetId, projectionStartsOn, dueDate, createdAt, updatedAt
    ) VALUES (
      @id,@description,@categoryId,NULL,@accountId,@recipientId,@amount,@transactionCost,
      @frequency,@frequencyDetails,@isGoal,@isFlexible,@goalPercentage,@goalDirection,1,
      @remainingCyclesTotal,@predecessorBudgetId,@projectionStartsOn,@dueDate,@createdAt,@updatedAt
    )`).run({ id: plan.successorId, ...definition, frequencyDetails: definition.frequencyDetails ? JSON.stringify(definition.frequencyDetails) : null,
      isGoal: definition.isGoal ? 1 : 0, isFlexible: definition.isFlexible ? 1 : 0,
      remainingCyclesTotal: plan.remainingCyclesTotal, predecessorBudgetId: input.budgetId,
      projectionStartsOn: definition.dueDate, createdAt: now, updatedAt: now });
    if (inserted.changes !== 1) throw new Error("successor_insert_failed");
    if (db.prepare("UPDATE budgets SET isActive=0, updatedAt=? WHERE id=?").run(now, input.budgetId).changes !== 1) throw new Error("predecessor_end_failed");
    const update = db.prepare(`UPDATE budgetSnapshots SET budgetId=@budgetId, occurrenceDate=@dueDate, dueDate=@dueDate,
      cycleIndex=@cycleIndex, description=@description, categoryId=@categoryId, accountId=@accountId,
      recipientId=@recipientId, amount=@amount, transactionCost=@transactionCost, frequency=@frequency,
      frequencyDetails=@frequencyDetails, isGoal=@isGoal, isFlexible=@isFlexible, goalPercentage=@goalPercentage,
      goalDirection=@goalDirection, remainingCyclesTotal=@remainingCyclesTotal, sourceBudgetUpdatedAt=@sourceBudgetUpdatedAt,
      updatedAt=@updatedAt WHERE id=@id`);
    for (const transfer of plan.transfers) {
      if (!occurrenceFrozen(transfer.dueDate, input.asOf)) update.run({ id: transfer.snapshotId, budgetId: plan.successorId,
        dueDate: transfer.dueDate.toISOString(), cycleIndex: transfer.cycleIndex, description: definition.description,
        categoryId: definition.categoryId, accountId: definition.accountId, recipientId: definition.recipientId,
        amount: definition.amount, transactionCost: definition.transactionCost, frequency: definition.frequency,
        frequencyDetails: definition.frequencyDetails ? JSON.stringify(definition.frequencyDetails) : null,
        isGoal: definition.isGoal ? 1 : 0, isFlexible: definition.isFlexible ? 1 : 0,
        goalPercentage: definition.goalPercentage, goalDirection: definition.goalDirection,
        remainingCyclesTotal: plan.remainingCyclesTotal, sourceBudgetUpdatedAt: now, updatedAt: now });
    }
    return { ok: true, successorId: plan.successorId, transferredOccurrenceCount: plan.transfers.length };
  }).immediate();
};

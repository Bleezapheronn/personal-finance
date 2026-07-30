import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export type LookupActiveStateEntity = "account" | "bucket" | "category";
export type LookupActiveStateAction = "activate" | "deactivate";

const tables: Record<LookupActiveStateEntity, string> = {
  account: "accounts",
  bucket: "buckets",
  category: "categories",
};

export const lookupActiveStateConfirmation = (
  entity: LookupActiveStateEntity,
  action: LookupActiveStateAction,
): string => `${action} ${entity} in authoritative sqlite`;

type Row = Record<string, unknown>;

export class LookupActiveStateRequestError extends Error {
  statusCode = 400 as const;
  constructor(public readonly code: string) {
    super(code);
  }
}

interface Input {
  id: number;
  expectedPlanFingerprint?: string;
}

interface Plan {
  row?: Row;
  desiredActive: boolean;
  eligible: boolean;
  alreadyMatches: boolean;
  planFingerprint?: string;
}

export interface LookupActiveStateResponse {
  ok: boolean;
  mode: "prototype";
  entity: LookupActiveStateEntity;
  action: LookupActiveStateAction;
  targetPresent: boolean;
  eligible: boolean;
  alreadyMatches: boolean;
  planFingerprint?: string;
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  validationErrors: string[];
  safety: {
    dexieMutated: false;
    filesWritten: false;
    financialFieldsMutated: false;
    budgetLifecycleInvoked: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

const plainObject = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validFingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const input = (
  payload: unknown,
  entity: LookupActiveStateEntity,
  action: LookupActiveStateAction,
  write: boolean,
): Input => {
  if (!plainObject(payload)) throw new LookupActiveStateRequestError("payload_must_be_object");
  const allowed = new Set(write
    ? ["id", "dryRunReviewed", "confirmation", "expectedPlanFingerprint"]
    : ["id"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new LookupActiveStateRequestError("unexpected_payload_field");
  }
  if (typeof payload.id !== "number" || !Number.isInteger(payload.id) || payload.id <= 0) {
    throw new LookupActiveStateRequestError("lookup_id_invalid");
  }
  if (!write) return { id: payload.id };
  if (payload.dryRunReviewed !== true ||
      payload.confirmation !== lookupActiveStateConfirmation(entity, action) ||
      !validFingerprint(payload.expectedPlanFingerprint)) {
    throw new LookupActiveStateRequestError("matching_dry_run_required");
  }
  return { id: payload.id, expectedPlanFingerprint: payload.expectedPlanFingerprint };
};

export const validateLookupActiveStatePayload = input;

const planFor = (
  db: Database.Database,
  entity: LookupActiveStateEntity,
  action: LookupActiveStateAction,
  value: Input,
): Plan => {
  const table = tables[entity];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id: value.id }) as Row | undefined;
  const desiredActive = action === "activate";
  const currentActive = row?.isActive === 0 || row?.isActive === false ? false : true;
  const eligible = Boolean(row);
  return {
    row,
    desiredActive,
    eligible,
    alreadyMatches: Boolean(row) && currentActive === desiredActive,
    ...(row ? { planFingerprint: sha({ entity, action, id: value.id, row }) } : {}),
  };
};

const response = (
  entity: LookupActiveStateEntity,
  action: LookupActiveStateAction,
  plan: Plan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): LookupActiveStateResponse => {
  const code = options.code ?? (plan.eligible ? undefined : `${entity}_not_found`);
  const sqliteMutated = options.sqliteMutated === true;
  return {
    ok: sqliteMutated || (plan.eligible && !code),
    mode: "prototype", entity, action,
    targetPresent: Boolean(plan.row), eligible: plan.eligible,
    alreadyMatches: plan.alreadyMatches,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    wouldMutate: false, sqliteMutated, rowsChanged: options.rowsChanged ?? 0,
    validationErrors: code ? [code] : [],
    safety: { dexieMutated: false, filesWritten: false, financialFieldsMutated: false,
      budgetLifecycleInvoked: false, rawRowsIncluded: false, automaticCheckpointCreated: false },
    resultCodes: sqliteMutated ? [`${entity}_${action}_completed`, "sqlite_mutated"]
      : plan.eligible ? [plan.alreadyMatches ? "active_state_already_matches" : `${entity}_${action}_dry_run_valid`, "no_mutation_performed"]
      : [code!, "no_mutation_performed"],
    ...(code ? { code } : {}),
  };
};

export const lookupActiveStateDryRun = (
  db: Database.Database, payload: unknown, entity: LookupActiveStateEntity, action: LookupActiveStateAction,
): LookupActiveStateResponse => response(entity, action, planFor(db, entity, action, input(payload, entity, action, false)));

export const lookupActiveStateWrite = (
  db: Database.Database, payload: unknown, entity: LookupActiveStateEntity, action: LookupActiveStateAction,
): LookupActiveStateResponse => {
  const value = input(payload, entity, action, true);
  const first = planFor(db, entity, action, value);
  if (first.planFingerprint !== value.expectedPlanFingerprint) return response(entity, action, first, { code: "active_state_plan_stale" });
  if (!first.eligible || first.alreadyMatches) return response(entity, action, first);
  return db.transaction(() => {
    const plan = planFor(db, entity, action, value);
    if (plan.planFingerprint !== value.expectedPlanFingerprint) return response(entity, action, plan, { code: "active_state_plan_stale" });
    if (plan.alreadyMatches) return response(entity, action, plan);
    const changed = db.prepare(`UPDATE ${tables[entity]} SET isActive = @isActive, updatedAt = @updatedAt WHERE id = @id`)
      .run({ id: value.id, isActive: plan.desiredActive ? 1 : 0, updatedAt: new Date().toISOString() }).changes;
    if (changed !== 1) throw new Error("active_state_target_update_failed");
    return response(entity, action, plan, { sqliteMutated: true, rowsChanged: changed });
  })();
};

export const lookupActiveStateErrorResponse = (
  entity: LookupActiveStateEntity, action: LookupActiveStateAction, code: string,
): LookupActiveStateResponse => response(entity, action, { desiredActive: action === "activate", eligible: false, alreadyMatches: false }, { code });

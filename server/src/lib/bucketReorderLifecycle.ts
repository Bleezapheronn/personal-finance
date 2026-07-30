import { createHash } from "node:crypto";
import Database from "better-sqlite3";

type Row = Record<string, unknown>;
const confirmation = "reorder buckets in authoritative sqlite";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isObject = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export class BucketReorderRequestError extends Error {
  statusCode = 400 as const;
  constructor(public readonly code: string) { super(code); }
}
interface Input { orderedBucketIds: number[]; expectedPlanFingerprint?: string; }
interface Plan { current: Row[]; eligible: boolean; planFingerprint?: string; validationErrors: string[]; }
export interface BucketReorderResponse { ok: boolean; mode: "prototype"; entity: "bucketReorder"; action: "reorder"; eligible: boolean; planFingerprint?: string; validationErrors: string[]; wouldMutate: false; sqliteMutated: boolean; rowsChanged: number; safety: { dexieMutated: false; filesWritten: false; financialFieldsMutated: false; budgetLifecycleInvoked: false; rawRowsIncluded: false; automaticCheckpointCreated: false }; resultCodes: string[]; code?: string; }

const parse = (payload: unknown, write: boolean): Input => {
  if (!isObject(payload)) throw new BucketReorderRequestError("payload_must_be_object");
  const allowed = new Set(write ? ["orderedBucketIds", "dryRunReviewed", "confirmation", "expectedPlanFingerprint"] : ["orderedBucketIds"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new BucketReorderRequestError("unexpected_payload_field");
  if (!Array.isArray(payload.orderedBucketIds) || payload.orderedBucketIds.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) throw new BucketReorderRequestError("ordered_bucket_ids_invalid");
  if (write && (payload.dryRunReviewed !== true || payload.confirmation !== confirmation || typeof payload.expectedPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(payload.expectedPlanFingerprint))) throw new BucketReorderRequestError("matching_dry_run_required");
  return { orderedBucketIds: payload.orderedBucketIds, ...(write ? { expectedPlanFingerprint: payload.expectedPlanFingerprint as string } : {}) };
};
export const validateBucketReorderPayload = parse;
const rows = (db: Database.Database) => db.prepare("SELECT * FROM buckets ORDER BY displayOrder ASC, id ASC").all() as Row[];
const planFor = (db: Database.Database, input: Input): Plan => {
  const current = rows(db);
  const ids = current.map((row) => Number(row.id));
  const requested = input.orderedBucketIds;
  const sameMembers = requested.length === ids.length && new Set(requested).size === requested.length && requested.every((id) => ids.includes(id));
  const validationErrors = sameMembers ? [] : ["ordered_bucket_ids_must_match_current_buckets"];
  return { current, eligible: validationErrors.length === 0, validationErrors, ...(sameMembers ? { planFingerprint: sha({ current, requested }) } : {}) };
};
const response = (plan: Plan, options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {}): BucketReorderResponse => {
  const code = options.code ?? plan.validationErrors[0]; const sqliteMutated = options.sqliteMutated === true;
  return { ok: sqliteMutated || (plan.eligible && !code), mode: "prototype", entity: "bucketReorder", action: "reorder", eligible: plan.eligible, ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}), validationErrors: code ? [code] : [], wouldMutate: false, sqliteMutated, rowsChanged: options.rowsChanged ?? 0, safety: { dexieMutated: false, filesWritten: false, financialFieldsMutated: false, budgetLifecycleInvoked: false, rawRowsIncluded: false, automaticCheckpointCreated: false }, resultCodes: sqliteMutated ? ["bucket_reorder_completed", "sqlite_mutated"] : plan.eligible ? ["bucket_reorder_dry_run_valid", "no_mutation_performed"] : [code!, "no_mutation_performed"], ...(code ? { code } : {}) };
};
export const bucketReorderDryRun = (db: Database.Database, payload: unknown) => response(planFor(db, parse(payload, false)));
export const bucketReorderWrite = (db: Database.Database, payload: unknown) => { const value = parse(payload, true); const first = planFor(db, value); if (first.planFingerprint !== value.expectedPlanFingerprint) return response(first, { code: "bucket_reorder_plan_stale" }); if (!first.eligible) return response(first); return db.transaction(() => { const plan = planFor(db, value); if (plan.planFingerprint !== value.expectedPlanFingerprint) return response(plan, { code: "bucket_reorder_plan_stale" }); let changes = 0; const statement = db.prepare("UPDATE buckets SET displayOrder = @displayOrder, updatedAt = @updatedAt WHERE id = @id"); for (const [displayOrder, id] of value.orderedBucketIds.entries()) changes += statement.run({ id, displayOrder, updatedAt: new Date().toISOString() }).changes; if (changes !== value.orderedBucketIds.length) throw new Error("bucket_reorder_update_count_mismatch"); return response(plan, { sqliteMutated: true, rowsChanged: changes }); })(); };
export const bucketReorderErrorResponse = (code: string) => response({ current: [], eligible: false, validationErrors: [code] }, { code });

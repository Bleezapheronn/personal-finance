import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { isPlainObject } from "./backup.js";
import {
  createSqliteNativeBackup,
  readVerifiedSqliteBackupManifest,
  restoreSqliteNativeBackup,
  verifiedBackupCandidateId,
} from "./sqliteBackupRestore.js";
import {
  backupConfigPathForRuntime,
  inventoryScheduledBackups,
  readBackupSettings,
  type InventoryItem,
} from "./scheduledSqliteBackup.js";
import {
  logicalVerificationsMatch,
  readSqliteLogicalVerificationAtPath,
} from "./sqliteLogicalVerification.js";
import { readRuntimeConfig } from "../runtimeConfig.js";
import { pathsReferToSameLocation } from "./paths.js";

export const RESTORE_HANDOFF_EXIT_CODE = 75;
const RESTORE_STATE_VERSION = 1 as const;
const RUNTIME_CONFIG_ENV = "PERSONAL_FINANCE_RUNTIME_CONFIG_PATH";

export interface RestoreCandidateSummary {
  candidateId: string;
  basename: string;
  classification: "daily" | "monthly";
  createdAt: string;
  normalizedLocalDay: string;
  sqliteSizeBytes: number;
  schemaVersion: number;
  sqliteSha256Short: string;
  databaseFingerprintShort: string;
  verificationStatus: "pass";
}

export type RestoreSessionPhase =
  | "prepared"
  | "handoff-armed"
  | "restarting"
  | "awaiting-verification"
  | "rolled-back"
  | "failed-before-replacement"
  | "recovery-required"
  | "accepted";

export interface RestoreSessionStatus {
  statusVersion: 1;
  sessionId: string;
  planId: string;
  phase: RestoreSessionPhase;
  selected: RestoreCandidateSummary;
  preparedAt: string;
  updatedAt: string;
  lastAction: "restore" | "rollback";
  rehearsalStatus: "pass";
  rollback?: {
    basename: string;
    manifestBasename: string;
    createdAt: string;
    verificationStatus: "pass";
    planId: string;
  };
  resultCode?: string;
}

export interface RestoreControlState {
  candidates: RestoreCandidateSummary[];
  excludedInvalidCount: number;
  session?: RestoreSessionStatus;
}

interface PreparedRestorePlan {
  planVersion: 1;
  sessionId: string;
  planId: string;
  candidateId: string;
  candidatePath: string;
  manifestPath: string;
  rehearsalPath: string;
  selected: RestoreCandidateSummary;
  preparedAt: string;
  consumed: boolean;
  lastAction: "restore" | "rollback";
  rollbackBackupPath?: string;
  rollbackManifestPath?: string;
  rollbackPlanId?: string;
}

interface RestoreHandoffRequest {
  requestVersion: 1;
  sessionId: string;
  planId: string;
  action: "restore" | "rollback";
  planPath: string;
  armedAt: string;
}

export interface RestoreHandoffResult {
  action: "restore" | "rollback";
  sessionId: string;
  planPath: string;
}

const runtimeDirectory = (runtimeConfigPath: string): string =>
  path.dirname(path.resolve(runtimeConfigPath));

export const restoreStatusPathForRuntime = (runtimeConfigPath: string): string =>
  path.join(runtimeDirectory(runtimeConfigPath), "restore-status.json");

export const restoreRequestPathForRuntime = (runtimeConfigPath: string): string =>
  path.join(runtimeDirectory(runtimeConfigPath), "restore-request.json");

const restoreProcessingPathForRuntime = (runtimeConfigPath: string): string =>
  path.join(runtimeDirectory(runtimeConfigPath), "restore-request.processing.json");

const atomicJson = (target: string, value: unknown): void => {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    renameSync(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
};

const readJson = (filePath: string, code: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new Error(code);
  }
};

const readStatus = (runtimeConfigPath: string): RestoreSessionStatus | undefined => {
  const filePath = restoreStatusPathForRuntime(runtimeConfigPath);
  if (!existsSync(filePath)) return undefined;
  const value = readJson(filePath, "restore_status_invalid");
  if (
    !isPlainObject(value) ||
    value.statusVersion !== RESTORE_STATE_VERSION ||
    typeof value.sessionId !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.phase !== "string" ||
    !isPlainObject(value.selected)
  ) {
    throw new Error("restore_status_invalid");
  }
  return value as unknown as RestoreSessionStatus;
};

const writeStatus = (
  runtimeConfigPath: string,
  status: RestoreSessionStatus,
): void => atomicJson(restoreStatusPathForRuntime(runtimeConfigPath), status);

const candidateFromInventory = (item: InventoryItem): RestoreCandidateSummary => {
  if (!item.valid || !item.manifest) throw new Error("restore_candidate_not_verified");
  const candidateId = verifiedBackupCandidateId(
    item.databasePath,
    item.manifestPath,
    item.manifest.logicalVerification,
  );
  return {
    candidateId,
    basename: item.basename,
    classification: item.manifest.classification,
    createdAt: item.manifest.createdAt,
    normalizedLocalDay: item.manifest.normalizedLocalDay,
    sqliteSizeBytes: item.manifest.sqliteSizeBytes,
    schemaVersion: item.manifest.schemaVersion,
    sqliteSha256Short: item.manifest.sqliteSha256.slice(0, 12),
    databaseFingerprintShort:
      item.manifest.logicalVerification.databaseIdentityFingerprint.slice(0, 12),
    verificationStatus: "pass",
  };
};

const inventoryState = (runtimeConfigPath: string): {
  candidates: RestoreCandidateSummary[];
  items: InventoryItem[];
  excludedInvalidCount: number;
} => {
  if (!existsSync(backupConfigPathForRuntime(runtimeConfigPath))) {
    return { candidates: [], items: [], excludedInvalidCount: 0 };
  }
  const items = inventoryScheduledBackups(runtimeConfigPath);
  const valid = items.filter((item) => item.valid && item.manifest);
  return {
    candidates: valid.map(candidateFromInventory),
    items: valid,
    excludedInvalidCount: items.length - valid.length,
  };
};

const readPlan = (planPath: string): PreparedRestorePlan => {
  const value = readJson(planPath, "restore_plan_invalid");
  if (
    !isPlainObject(value) ||
    value.planVersion !== 1 ||
    typeof value.sessionId !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.candidateId !== "string" ||
    typeof value.candidatePath !== "string" ||
    typeof value.manifestPath !== "string" ||
    typeof value.rehearsalPath !== "string" ||
    !isPlainObject(value.selected) ||
    typeof value.preparedAt !== "string" ||
    typeof value.consumed !== "boolean"
  ) {
    throw new Error("restore_plan_invalid");
  }
  return value as unknown as PreparedRestorePlan;
};

const computePlanId = (sessionId: string, candidateId: string): string =>
  createHash("sha256")
    .update(JSON.stringify({ sessionId, candidateId }))
    .digest("hex");

const validatePreparedCandidate = (
  plan: PreparedRestorePlan,
  runtimeConfigPath?: string,
): void => {
  if (plan.consumed) throw new Error("restore_plan_consumed");
  const manifest = readVerifiedSqliteBackupManifest(plan.manifestPath);
  const candidateId = verifiedBackupCandidateId(
    plan.candidatePath,
    plan.manifestPath,
    manifest.expectedVerification,
  );
  if (candidateId !== plan.candidateId || plan.planId !== computePlanId(plan.sessionId, candidateId)) {
    throw new Error("restore_plan_stale");
  }
  if (runtimeConfigPath) {
    const inventory = inventoryState(runtimeConfigPath);
    const index = inventory.candidates.findIndex(
      (candidate) => candidate.candidateId === plan.candidateId,
    );
    const item = inventory.items[index];
    if (
      index < 0 ||
      !item ||
      !pathsReferToSameLocation(item.databasePath, plan.candidatePath) ||
      !pathsReferToSameLocation(item.manifestPath, plan.manifestPath)
    ) {
      throw new Error("restore_plan_stale");
    }
  }
  const rehearsal = readSqliteLogicalVerificationAtPath(
    plan.rehearsalPath,
    new Date(`${manifest.normalizedLocalDay}T12:00:00`),
  );
  if (!logicalVerificationsMatch(rehearsal, manifest.expectedVerification)) {
    throw new Error("restore_rehearsal_mismatch");
  }
};

const timestamp = (): string =>
  new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

const stagePath = (livePath: string, label: string, sessionId: string): string =>
  path.join(
    path.dirname(livePath),
    `.${path.basename(livePath)}.${label}-${sessionId}.sqlite`,
  );

const assertNoSidecars = (livePath: string): void => {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(`${livePath}${suffix}`)) throw new Error("restore_live_sidecar_present");
  }
};

const cleanupGeneratedStage = (filePath: string): void => {
  if (existsSync(filePath)) unlinkSync(filePath);
};

const performCutover = async (
  runtimeConfigPath: string,
  plan: PreparedRestorePlan,
  candidatePath: string,
  manifestPath: string,
  action: "restore" | "rollback",
): Promise<PreparedRestorePlan> => {
  const runtime = readRuntimeConfig(runtimeConfigPath);
  const livePath = runtime.sqlitePath;
  const candidateManifest = readVerifiedSqliteBackupManifest(manifestPath);
  const candidateVerificationDate = new Date(
    `${candidateManifest.normalizedLocalDay}T12:00:00`,
  );
  if (!existsSync(livePath)) throw new Error("restore_live_database_missing");
  assertNoSidecars(livePath);

  const settings = readBackupSettings(runtimeConfigPath);
  const rollbackDirectory = path.join(settings.destinationDirectory, "Restore Rollbacks");
  mkdirSync(rollbackDirectory, { recursive: true });
  const label = action === "restore" ? "pre-restore" : "pre-rollback-safety";
  const rollbackBase = `personal-finance-${label}-${timestamp()}-${plan.sessionId.slice(0, 8)}`;
  const rollbackBackupPath = path.join(rollbackDirectory, `${rollbackBase}.sqlite`);
  const rollbackManifestPath = `${rollbackBackupPath}.manifest.json`;

  const rollbackResult = await createSqliteNativeBackup({
    sourcePath: livePath,
    outputPath: rollbackBackupPath,
    manifestPath: rollbackManifestPath,
  });
  const liveBefore = readSqliteLogicalVerificationAtPath(livePath);
  if (rollbackResult.databaseIdentityFingerprint !== liveBefore.databaseIdentityFingerprint) {
    throw new Error("restore_rollback_fingerprint_mismatch");
  }

  const candidateStage = stagePath(livePath, "candidate", plan.sessionId);
  const rollbackStage = stagePath(livePath, "rollback", plan.sessionId);
  if (existsSync(candidateStage) || existsSync(rollbackStage)) {
    throw new Error("restore_stage_already_exists");
  }

  let liveReplaced = false;
  try {
    const candidateResult = await restoreSqliteNativeBackup({
      backupPath: candidatePath,
      manifestPath,
      outputPath: candidateStage,
    });
    await restoreSqliteNativeBackup({
      backupPath: rollbackBackupPath,
      manifestPath: rollbackManifestPath,
      outputPath: rollbackStage,
    });
    renameSync(candidateStage, livePath);
    liveReplaced = true;
    const liveAfter = readSqliteLogicalVerificationAtPath(
      livePath,
      candidateVerificationDate,
    );
    if (
      liveAfter.databaseIdentityFingerprint !== candidateResult.databaseIdentityFingerprint
      || !logicalVerificationsMatch(liveAfter, candidateManifest.expectedVerification)
    ) {
      throw new Error("restore_live_verification_failed");
    }
    cleanupGeneratedStage(rollbackStage);
  } catch (error) {
    let failure = error;
    if (liveReplaced && existsSync(rollbackStage)) {
      renameSync(rollbackStage, livePath);
      const restoredOriginal = readSqliteLogicalVerificationAtPath(livePath);
      if (!logicalVerificationsMatch(restoredOriginal, liveBefore)) {
        throw new Error("restore_automatic_rollback_failed");
      }
      failure = new Error("restore_automatic_rollback_verified");
    }
    cleanupGeneratedStage(candidateStage);
    cleanupGeneratedStage(rollbackStage);
    throw failure;
  }

  const rollbackManifest = readVerifiedSqliteBackupManifest(rollbackManifestPath);
  const rollbackPlanId = verifiedBackupCandidateId(
    rollbackBackupPath,
    rollbackManifestPath,
    rollbackManifest.expectedVerification,
  );
  return {
    ...plan,
    consumed: true,
    lastAction: action,
    rollbackBackupPath,
    rollbackManifestPath,
    rollbackPlanId,
  };
};

export const readRestoreControlState = (
  runtimeConfigPath: string,
): RestoreControlState => {
  const inventory = inventoryState(runtimeConfigPath);
  return {
    candidates: inventory.candidates,
    excludedInvalidCount: inventory.excludedInvalidCount,
    session: readStatus(runtimeConfigPath),
  };
};

export const prepareRestoreCandidate = async (
  runtimeConfigPath: string,
  candidateId: string,
): Promise<RestoreSessionStatus> => {
  const processingPath = restoreProcessingPathForRuntime(runtimeConfigPath);
  if (existsSync(processingPath)) {
    const status = readStatus(runtimeConfigPath);
    const request = readHandoffRequest(processingPath);
    if (
      status
      && request.sessionId === status.sessionId
      && (status.phase === "rolled-back" || status.phase === "failed-before-replacement")
    ) {
      unlinkSync(processingPath);
    }
  }
  if (
    existsSync(restoreRequestPathForRuntime(runtimeConfigPath)) ||
    existsSync(processingPath)
  ) {
    throw new Error("restore_handoff_pending");
  }
  const inventory = inventoryState(runtimeConfigPath);
  const index = inventory.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
  if (index < 0) throw new Error("restore_candidate_not_found");
  const selected = inventory.candidates[index];
  const item = inventory.items[index];
  const settings = readBackupSettings(runtimeConfigPath);
  const sessionId = randomUUID();
  const restoreRoot = path.join(settings.stagingDirectory, "restore");
  mkdirSync(restoreRoot, { recursive: true });
  const sessionDirectory = path.join(restoreRoot, sessionId);
  mkdirSync(sessionDirectory, { recursive: false });
  const rehearsalPath = path.join(sessionDirectory, "rehearsal.sqlite");
  const restored = await restoreSqliteNativeBackup({
    backupPath: item.databasePath,
    manifestPath: item.manifestPath,
    outputPath: rehearsalPath,
  });
  if (restored.candidateId !== candidateId) throw new Error("restore_candidate_changed");
  const planId = computePlanId(sessionId, candidateId);
  const planPath = path.join(sessionDirectory, "restore-plan.json");
  const preparedAt = new Date().toISOString();
  const plan: PreparedRestorePlan = {
    planVersion: 1,
    sessionId,
    planId,
    candidateId,
    candidatePath: item.databasePath,
    manifestPath: item.manifestPath,
    rehearsalPath,
    selected,
    preparedAt,
    consumed: false,
    lastAction: "restore",
  };
  atomicJson(planPath, plan);
  const status: RestoreSessionStatus = {
    statusVersion: RESTORE_STATE_VERSION,
    sessionId,
    planId,
    phase: "prepared",
    selected,
    preparedAt,
    updatedAt: preparedAt,
    lastAction: "restore",
    rehearsalStatus: "pass",
  };
  writeStatus(runtimeConfigPath, status);
  return status;
};

const findPlanPath = (runtimeConfigPath: string, status: RestoreSessionStatus): string => {
  const settings = readBackupSettings(runtimeConfigPath);
  return path.join(settings.stagingDirectory, "restore", status.sessionId, "restore-plan.json");
};

export const restorePlanPathForSession = (
  runtimeConfigPath: string,
  sessionId: string,
): string => {
  const status = readStatus(runtimeConfigPath);
  if (!status || status.sessionId !== sessionId) throw new Error("restore_session_stale");
  return findPlanPath(runtimeConfigPath, status);
};

export const armRestoreHandoff = (
  runtimeConfigPath: string,
  input: {
    action: "restore" | "rollback";
    sessionId: string;
    planId: string;
    confirmationText: string;
  },
): RestoreSessionStatus => {
  const status = readStatus(runtimeConfigPath);
  if (!status || status.sessionId !== input.sessionId) throw new Error("restore_session_stale");
  const planPath = findPlanPath(runtimeConfigPath, status);
  const plan = readPlan(planPath);
  if (input.action === "restore") {
    if (status.phase !== "prepared" || input.planId !== plan.planId) {
      throw new Error("restore_plan_stale");
    }
    validatePreparedCandidate(plan, runtimeConfigPath);
    if (input.confirmationText !== `RESTORE ${status.selected.basename}`) {
      throw new Error("restore_confirmation_invalid");
    }
  } else {
    if (
      (status.phase !== "awaiting-verification" && status.phase !== "accepted") ||
      !plan.rollbackPlanId ||
      input.planId !== plan.rollbackPlanId ||
      !status.rollback ||
      input.confirmationText !== `ROLL BACK ${status.rollback.basename}`
    ) {
      throw new Error("restore_rollback_confirmation_invalid");
    }
  }
  const requestPath = restoreRequestPathForRuntime(runtimeConfigPath);
  if (existsSync(requestPath) || existsSync(restoreProcessingPathForRuntime(runtimeConfigPath))) {
    throw new Error("restore_handoff_pending");
  }
  const request: RestoreHandoffRequest = {
    requestVersion: 1,
    sessionId: status.sessionId,
    planId: input.planId,
    action: input.action,
    planPath,
    armedAt: new Date().toISOString(),
  };
  writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const next: RestoreSessionStatus = {
    ...status,
    phase: "handoff-armed",
    lastAction: input.action,
    updatedAt: new Date().toISOString(),
  };
  writeStatus(runtimeConfigPath, next);
  return next;
};

const readHandoffRequest = (filePath: string): RestoreHandoffRequest => {
  const value = readJson(filePath, "restore_request_invalid");
  if (
    !isPlainObject(value) ||
    value.requestVersion !== 1 ||
    typeof value.sessionId !== "string" ||
    typeof value.planId !== "string" ||
    (value.action !== "restore" && value.action !== "rollback") ||
    typeof value.planPath !== "string"
  ) {
    throw new Error("restore_request_invalid");
  }
  return value as unknown as RestoreHandoffRequest;
};

export const performArmedRestoreHandoff = async (
  runtimeConfigPath: string,
): Promise<RestoreHandoffResult> => {
  const requestPath = restoreRequestPathForRuntime(runtimeConfigPath);
  const processingPath = restoreProcessingPathForRuntime(runtimeConfigPath);
  if (!existsSync(requestPath) || existsSync(processingPath)) {
    throw new Error("restore_request_unavailable");
  }
  renameSync(requestPath, processingPath);
  const request = readHandoffRequest(processingPath);
  const plan = readPlan(request.planPath);
  const status = readStatus(runtimeConfigPath);
  const expectedPlanPath = status ? findPlanPath(runtimeConfigPath, status) : "";
  if (
    !status ||
    status.phase !== "handoff-armed" ||
    status.sessionId !== request.sessionId ||
    plan.sessionId !== request.sessionId ||
    !expectedPlanPath ||
    !pathsReferToSameLocation(request.planPath, expectedPlanPath)
  ) {
    throw new Error("restore_request_stale");
  }

  let candidatePath = plan.candidatePath;
  let manifestPath = plan.manifestPath;
  if (request.action === "restore") {
    if (request.planId !== plan.planId) throw new Error("restore_request_stale");
    validatePreparedCandidate(plan, runtimeConfigPath);
  } else {
    if (
      request.planId !== plan.rollbackPlanId ||
      !plan.rollbackBackupPath ||
      !plan.rollbackManifestPath
    ) {
      throw new Error("restore_request_stale");
    }
    candidatePath = plan.rollbackBackupPath;
    manifestPath = plan.rollbackManifestPath;
  }

  const restarting: RestoreSessionStatus = {
    ...status,
    phase: "restarting",
    lastAction: request.action,
    updatedAt: new Date().toISOString(),
  };
  writeStatus(runtimeConfigPath, restarting);
  try {
    const updatedPlan = await performCutover(
      runtimeConfigPath,
      { ...plan, consumed: request.action === "restore" ? false : plan.consumed },
      candidatePath,
      manifestPath,
      request.action,
    );
    atomicJson(request.planPath, updatedPlan);
    const next: RestoreSessionStatus = {
      ...restarting,
      rollback: {
        basename: path.basename(updatedPlan.rollbackBackupPath!),
        manifestBasename: path.basename(updatedPlan.rollbackManifestPath!),
        createdAt: new Date().toISOString(),
        verificationStatus: "pass",
        planId: updatedPlan.rollbackPlanId!,
      },
      resultCode: "cutover_verified",
      updatedAt: new Date().toISOString(),
    };
    writeStatus(runtimeConfigPath, next);
    unlinkSync(processingPath);
    return { action: request.action, sessionId: request.sessionId, planPath: request.planPath };
  } catch (error) {
    const code = error instanceof Error ? error.message : "restore_handoff_failed";
    const phase: RestoreSessionPhase = code === "restore_automatic_rollback_verified"
      ? "rolled-back"
      : code === "restore_automatic_rollback_failed"
        ? "recovery-required"
        : "failed-before-replacement";
    const failed: RestoreSessionStatus = {
      ...restarting,
      phase,
      resultCode: code,
      updatedAt: new Date().toISOString(),
    };
    writeStatus(runtimeConfigPath, failed);
    if (phase !== "recovery-required" && existsSync(processingPath)) {
      unlinkSync(processingPath);
    }
    throw error;
  }
};

export const markRestoreRuntimeHealthy = (
  runtimeConfigPath: string,
  result: RestoreHandoffResult,
): void => {
  const status = readStatus(runtimeConfigPath);
  if (!status || status.sessionId !== result.sessionId || status.phase !== "restarting") {
    throw new Error("restore_status_stale");
  }
  writeStatus(runtimeConfigPath, {
    ...status,
    phase: result.action === "restore" ? "awaiting-verification" : "rolled-back",
    resultCode: result.action === "restore" ? "runtime_verified" : "rollback_runtime_verified",
    updatedAt: new Date().toISOString(),
  });
};

export const automaticRollbackAfterRuntimeFailure = async (
  runtimeConfigPath: string,
  result: RestoreHandoffResult,
): Promise<void> => {
  const plan = readPlan(result.planPath);
  if (!plan.rollbackBackupPath || !plan.rollbackManifestPath) {
    throw new Error("restore_rollback_unavailable");
  }
  const runtime = readRuntimeConfig(runtimeConfigPath);
  assertNoSidecars(runtime.sqlitePath);
  const rollbackStage = stagePath(runtime.sqlitePath, "startup-rollback", plan.sessionId);
  if (existsSync(rollbackStage)) throw new Error("restore_stage_already_exists");
  try {
    const rollbackManifest = readVerifiedSqliteBackupManifest(plan.rollbackManifestPath);
    const rollbackVerificationDate = new Date(
      `${rollbackManifest.normalizedLocalDay}T12:00:00`,
    );
    const restored = await restoreSqliteNativeBackup({
      backupPath: plan.rollbackBackupPath,
      manifestPath: plan.rollbackManifestPath,
      outputPath: rollbackStage,
    });
    renameSync(rollbackStage, runtime.sqlitePath);
    const verification = readSqliteLogicalVerificationAtPath(
      runtime.sqlitePath,
      rollbackVerificationDate,
    );
    if (
      verification.databaseIdentityFingerprint !== restored.databaseIdentityFingerprint
      || !logicalVerificationsMatch(verification, rollbackManifest.expectedVerification)
    ) {
      throw new Error("restore_automatic_rollback_failed");
    }
  } finally {
    cleanupGeneratedStage(rollbackStage);
  }
  const status = readStatus(runtimeConfigPath);
  if (status) {
    writeStatus(runtimeConfigPath, {
      ...status,
      phase: "rolled-back",
      resultCode: "runtime_failed_automatic_rollback_verified",
      updatedAt: new Date().toISOString(),
    });
  }
};

export const acceptRestoredState = (
  runtimeConfigPath: string,
  sessionId: string,
): RestoreSessionStatus => {
  const status = readStatus(runtimeConfigPath);
  if (!status || status.sessionId !== sessionId || status.phase !== "awaiting-verification") {
    throw new Error("restore_acceptance_unavailable");
  }
  const accepted: RestoreSessionStatus = {
    ...status,
    phase: "accepted",
    resultCode: "accepted_rollback_retained",
    updatedAt: new Date().toISOString(),
  };
  writeStatus(runtimeConfigPath, accepted);
  return accepted;
};

const runtimeConfigPathFromEnvironment = (): string => {
  const value = process.env[RUNTIME_CONFIG_ENV];
  if (!value || !path.isAbsolute(value)) throw new Error("runtime_config_path_invalid");
  return path.resolve(value);
};

const mapError = (error: unknown): { status: number; code: string } => {
  const code = error instanceof Error ? error.message : "restore_operation_failed";
  if (code.includes("not_found")) return { status: 404, code };
  if (code.includes("invalid") || code.includes("required")) return { status: 400, code };
  if (
    code.includes("stale") ||
    code.includes("pending") ||
    code.includes("unavailable") ||
    code.includes("changed") ||
    code.includes("consumed")
  ) {
    return { status: 409, code };
  }
  return { status: 500, code: "restore_operation_failed" };
};

export const registerRestoreControlRoutes = (
  server: FastifyInstance,
  options: { onHandoffArmed?: () => void } = {},
): void => {
  server.get("/prototype/settings/restore/state", async (_request, reply) => {
    try {
      return { ok: true, state: readRestoreControlState(runtimeConfigPathFromEnvironment()) };
    } catch (error) {
      const mapped = mapError(error);
      return reply.code(mapped.status).send({ ok: false, code: mapped.code });
    }
  });

  server.post<{ Body: { candidateId?: unknown } }>(
    "/prototype/settings/restore/prepare",
    async (request, reply) => {
      try {
        if (typeof request.body?.candidateId !== "string") {
          throw new Error("restore_candidate_required");
        }
        const session = await prepareRestoreCandidate(
          runtimeConfigPathFromEnvironment(),
          request.body.candidateId,
        );
        return { ok: true, session };
      } catch (error) {
        const mapped = mapError(error);
        return reply.code(mapped.status).send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post<{
    Body: {
      action?: unknown;
      sessionId?: unknown;
      planId?: unknown;
      confirmationText?: unknown;
    };
  }>("/prototype/settings/restore/arm", async (request, reply) => {
    try {
      const body = request.body;
      if (
        (body?.action !== "restore" && body?.action !== "rollback") ||
        typeof body.sessionId !== "string" ||
        typeof body.planId !== "string" ||
        typeof body.confirmationText !== "string"
      ) {
        throw new Error("restore_arm_request_invalid");
      }
      const session = armRestoreHandoff(runtimeConfigPathFromEnvironment(), {
        action: body.action,
        sessionId: body.sessionId,
        planId: body.planId,
        confirmationText: body.confirmationText,
      });
      setTimeout(() => options.onHandoffArmed?.(), 350).unref();
      return reply.code(202).send({ ok: true, session });
    } catch (error) {
      const mapped = mapError(error);
      return reply.code(mapped.status).send({ ok: false, code: mapped.code });
    }
  });

  server.post<{ Body: { sessionId?: unknown } }>(
    "/prototype/settings/restore/accept",
    async (request, reply) => {
      try {
        if (typeof request.body?.sessionId !== "string") {
          throw new Error("restore_session_required");
        }
        return {
          ok: true,
          session: acceptRestoredState(
            runtimeConfigPathFromEnvironment(),
            request.body.sessionId,
          ),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply.code(mapped.status).send({ ok: false, code: mapped.code });
      }
    },
  );
};

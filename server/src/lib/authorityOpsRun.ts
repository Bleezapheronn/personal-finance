import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildAuthorityOpsStartPlan,
  checkpointAuthorityOpsProfile,
  portIsAvailable,
  verifyAuthorityOpsProfile,
  type AuthorityCheckpointDependencies,
} from "./authorityOps.js";
import { acquireAuthorityOpsLock, lockPathForProfile } from "./authorityOpsLock.js";
import { readAuthorityOpsProfile } from "./authorityOpsProfile.js";
import { runConditionalAuthorityBuild } from "./authorityOpsBuild.js";
import {
  assertAuthoritySessionReceiptMatches,
  createAuthoritySession,
  readSealedAuthoritySessionReceipt,
} from "./authorityOpsSession.js";
import { createAuthorityApiChildPlan } from "./authorityApiChildPlan.js";
import { readSqliteAuthorityManifestDescriptor } from "./sqliteAuthorityCutover.js";
import {
  readCanonicalAuthorityLogicalFingerprintAtPath,
  readSqliteLogicalVerificationAtPath,
} from "./sqliteLogicalVerification.js";
import {
  authorityProfileIdentity,
  createAuthorityOpsControlServer,
  requestAuthorityOpsStop,
  type AuthorityOpsControlServer,
} from "./authorityOpsControl.js";
import type { AuthorityShutdownMode } from "./authorityApiLifecycle.js";
import {
  childHasExited,
  spawnAuthorityOwnedChild,
  waitForAuthorityOwnedChildExit,
  type AuthorityOwnedChild,
} from "./authorityOwnedChild.js";
import { superviseAuthorityChildSpec } from "./authoritySupervisedChild.js";

const API_EXIT_TIMEOUT_MS = 12_000;
const VITE_EXIT_TIMEOUT_MS = 10_000;
export type AuthorityOpsRuntimeDiagnostic =
  | "starting_logical_fingerprint_mismatch"
  | "mutation_prestate_mismatch"
  | "mutation_lock_timeout"
  | "mutation_fingerprint_failed"
  | "mutation_commit_failed"
  | "shutdown_logical_fingerprint_mismatch"
  | "checkpoint_logical_fingerprint_mismatch"
  | "unguarded_authoritative_write"
  | "api_shutdown_request_failed"
  | "api_shutdown_request_failed_clean_shutdown_verified"
  | "api_shutdown_request_failed_shutdown_proof_failed"
  | "api_drain_timeout"
  | "api_close_failed"
  | "database_close_failed"
  | "clean_receipt_missing"
  | "api_exit_timeout"
  | "api_exit_abnormal"
  | "vite_exit_unexpected"
  | "vite_exit_unexpected_during_seal"
  | "api_spawn_failed"
  | "vite_spawn_failed"
  | "abort_shutdown_failed"
  | "authority_control_close_failed"
  | "authority_control_descriptor_cleanup_failed"
  | "authority_lock_release_failed";
const runtimeDirectory = (profilePath: string) =>
  path.join(path.dirname(path.resolve(profilePath)), ".authority-ops-runtime");
const terminationAttempted = new WeakSet<ChildProcess>();
const waitForOwnedExit = async (
  owned: AuthorityOwnedChild,
  kind: "api" | "vite",
  timeout: number,
  timeoutCode: "api_exit_timeout" | "vite_exit_timeout",
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  waitForAuthorityOwnedChildExit(
    owned,
    timeout,
    timeoutCode,
    kind === "api" ? "api_spawn_failed" : "vite_spawn_failed",
  );

const requestApiShutdown = async (
  profile: ReturnType<typeof readAuthorityOpsProfile>,
  secret: string,
  mode: AuthorityShutdownMode,
): Promise<void> => {
  const token = readFileSync(profile.tokenFilePath, "utf8").trim();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = http.request({
        host: profile.apiHost,
        port: profile.apiPort,
        path: "/authority/session/shutdown",
        method: "POST",
        headers: {
          "x-personal-finance-token": token,
          "x-personal-finance-session-secret": secret,
          "x-personal-finance-shutdown-mode": mode,
          "content-length": "0",
        },
        timeout: 10_000,
      }, (response) => {
        response.resume();
        response.statusCode === 202
          ? resolve()
          : reject(new Error("api_shutdown_request_failed"));
      });
      request.on("timeout", () =>
        request.destroy(new Error("api_shutdown_request_failed")));
      request.on("error", reject);
      request.end();
    });
  } catch {
    throw new Error(mode === "abort" ? "abort_shutdown_failed" : "api_shutdown_request_failed");
  }
};

const requestApiAbortAfterViteSpawnFailure = async (
  profile: ReturnType<typeof readAuthorityOpsProfile>,
  secret: string,
): Promise<boolean> => {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await requestApiShutdown(profile, secret, "abort");
      return true;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  return false;
};

const terminateOwnedChild = (
  child: ChildProcess | undefined,
  kind: "api" | "vite",
  dependencies: AuthorityOpsSupervisorDependencies,
): boolean => {
  if (!child || childHasExited(child)) return false;
  if (terminationAttempted.has(child)) return false;
  terminationAttempted.add(child);
  dependencies.onChildTermination?.(kind, child.pid);
  return child.kill("SIGTERM");
};

const cleanupOwnedChild = async (
  owned: AuthorityOwnedChild | undefined,
  kind: "api" | "vite",
  dependencies: AuthorityOpsSupervisorDependencies,
): Promise<void> => {
  const child = owned?.child;
  if (!child || childHasExited(child)) return;
  terminateOwnedChild(child, kind, dependencies);
  try {
    if (owned) {
      await waitForAuthorityOwnedChildExit(
        owned,
        2_000,
        kind === "api" ? "api_exit_timeout" : "vite_exit_timeout",
        kind === "api" ? "api_spawn_failed" : "vite_spawn_failed",
      );
    }
  } catch {
    // The primary failure remains authoritative; cleanup is bounded.
  }
};

export const stopAuthorityOpsRun = async (profilePath: string): Promise<void> =>
  requestAuthorityOpsStop(profilePath);

export interface AuthorityOpsSupervisorDependencies {
  afterReceiptSeal?: () => Promise<void>;
  createApiChildSpec?: (
    plan: ReturnType<typeof buildAuthorityOpsStartPlan>,
  ) => { executable: string; args: string[]; cwd: string };
  createViteChildSpec?: (
    plan: ReturnType<typeof buildAuthorityOpsStartPlan>,
  ) => { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
  quiescenceProbe?: () => void;
  checkpointDependencies?: AuthorityCheckpointDependencies;
  onChildrenSpawned?: (children: { api: ChildProcess; vite: ChildProcess }) => void;
  onApiShutdownRequest?: (mode: AuthorityShutdownMode) => void;
  /** Test-only synchronization immediately before the authenticated request. */
  beforeApiShutdownRequest?: (mode: AuthorityShutdownMode) => Promise<void>;
  onChildTermination?: (kind: "api" | "vite", processId: number | undefined) => void;
  apiExitTimeoutMs?: number;
  /** Test-only fault injection for checked final supervisor cleanup. */
  finalCleanup?: {
    closeControl?: (control: AuthorityOpsControlServer) => Promise<void>;
    removeControlDescriptor?: (control: AuthorityOpsControlServer) => void;
    releaseLock?: (release: () => void) => void;
  };
}

export class AuthorityOpsFinalCleanupError extends Error {
  constructor(
    readonly stage: "control-close" | "control-descriptor" | "lock-release",
    readonly artifactPath: string,
    readonly originalError: unknown,
    readonly apiShutdownProofPassed: boolean,
    readonly checkpointAccepted: boolean,
  ) {
    super(stage === "control-close"
      ? "authority_control_close_failed"
      : stage === "control-descriptor"
        ? "authority_control_descriptor_cleanup_failed"
        : "authority_lock_release_failed");
  }
}

const cleanupErrorCode = (error: unknown) =>
  error instanceof Error ? error.message : "unknown_cleanup_error";

const reportFinalCleanupFailure = (error: AuthorityOpsFinalCleanupError) => {
  // Keep the artifact and original filesystem error available without allowing
  // a cleanup failure to masquerade as a successful supervisor completion.
  console.error(`${error.message}:stage=${error.stage};artifact=${error.artifactPath};cause=${cleanupErrorCode(error.originalError)};apiShutdownProofPassed=${error.apiShutdownProofPassed};checkpointAccepted=${error.checkpointAccepted}`);
};

export const resolveViteChildSpec = (
  plan: ReturnType<typeof buildAuthorityOpsStartPlan>,
  dependencies: AuthorityOpsSupervisorDependencies,
) => dependencies.createViteChildSpec?.(plan) ?? { ...plan.viteCommand, env: plan.viteEnvironment };

type RuntimeEvent = "seal-requested" | "api-exited" | "vite-exited";
type ViteOwnershipState =
  | "running"
  | "expected-termination-requested"
  | "exited-expected"
  | "exited-unexpected"
  | "spawn-failed";
const waitForRuntimeEvent = (
  shutdownRequested: Promise<void>,
  api: ChildProcess,
  vite: ChildProcess,
): Promise<RuntimeEvent> => new Promise((resolve) => {
  let settled = false;
  const finish = (event: RuntimeEvent) => {
    if (settled) return;
    settled = true;
    api.removeListener("exit", onApiExit);
    vite.removeListener("exit", onViteExit);
    resolve(event);
  };
  const onApiExit = () => finish("api-exited");
  const onViteExit = () => finish("vite-exited");
  api.once("exit", onApiExit);
  vite.once("exit", onViteExit);
  if (childHasExited(api)) return finish("api-exited");
  if (childHasExited(vite)) return finish("vite-exited");
  void shutdownRequested.then(() => finish("seal-requested"));
});

export const runAuthorityOpsSupervisor = async (
  profilePath: string,
  options: { allowRepoPathsForTests?: boolean } = {},
  dependencies: AuthorityOpsSupervisorDependencies = {},
): Promise<void> => {
  let requestShutdown: (() => void) | undefined;
  let interruptRequested = false;
  const shutdownRequested = new Promise<void>((resolve) => { requestShutdown = resolve; });
  // This gate is deliberately installed before the lock and child startup.
  // It remains installed until every final proof and cleanup gate has finished,
  // so repeated Windows console events cannot fall back to Node's default exit.
  const onInterrupt = () => {
    if (interruptRequested) return;
    interruptRequested = true;
    requestShutdown?.();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGBREAK", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  const throwIfStartupInterrupted = () => {
    if (interruptRequested) throw new Error("authority_ops_startup_interrupted");
  };
  let release: (() => void) | undefined;
  let api: ChildProcess | undefined;
  let vite: ChildProcess | undefined;
  let apiOwned: AuthorityOwnedChild | undefined;
  let viteOwned: AuthorityOwnedChild | undefined;
  let control: AuthorityOpsControlServer | undefined;
  let sealRequested = false;
  let apiShutdownRequestFailed = false;
  let apiShutdownProofPassed = false;
  let checkpointAccepted = false;
  let controlCleaned = false;
  let lockReleased = false;
  let controlCleanupFailure: AuthorityOpsFinalCleanupError | undefined;
  let lockReleaseFailure: AuthorityOpsFinalCleanupError | undefined;
  let viteOwnership: ViteOwnershipState = "running";
  const assertViteCheckpointEligible = () => {
    if (viteOwnership === "exited-unexpected") {
      throw new Error(
        sealRequested
          ? "vite_exit_unexpected_during_seal"
          : "vite_exit_unexpected",
      );
    }
    if (viteOwnership === "spawn-failed") throw new Error("vite_spawn_failed");
  };
  const closeControlAndRemoveDescriptor = async () => {
    if (!control || controlCleaned) return;
    if (controlCleanupFailure) throw controlCleanupFailure;
    try {
      await (dependencies.finalCleanup?.closeControl?.(control) ?? control.close());
    } catch (error) {
      controlCleanupFailure = new AuthorityOpsFinalCleanupError(
        "control-close",
        `${path.resolve(profilePath)}.run.json`,
        error,
        apiShutdownProofPassed,
        checkpointAccepted,
      );
      throw controlCleanupFailure;
    }
    try {
      (dependencies.finalCleanup?.removeControlDescriptor ?? ((value) => value.removeDescriptor()))(control);
    } catch (error) {
      controlCleanupFailure = new AuthorityOpsFinalCleanupError(
        "control-descriptor",
        `${path.resolve(profilePath)}.run.json`,
        error,
        apiShutdownProofPassed,
        checkpointAccepted,
      );
      throw controlCleanupFailure;
    }
    controlCleaned = true;
  };
  const releaseLock = () => {
    if (lockReleased) return;
    if (!release) return;
    if (lockReleaseFailure) throw lockReleaseFailure;
    try {
      (dependencies.finalCleanup?.releaseLock ?? ((value) => value()))(release);
      if (existsSync(lockPathForProfile(profilePath))) throw new Error("authority_lock_still_present");
      lockReleased = true;
    } catch (error) {
      lockReleaseFailure = new AuthorityOpsFinalCleanupError(
        "lock-release",
        lockPathForProfile(profilePath),
        error,
        apiShutdownProofPassed,
        checkpointAccepted,
      );
      throw lockReleaseFailure;
    }
  };
  const cleanupAfterFailure = async (): Promise<AuthorityOpsFinalCleanupError | undefined> => {
    let failure: AuthorityOpsFinalCleanupError | undefined;
    try { await closeControlAndRemoveDescriptor(); }
    catch (error) { if (error instanceof AuthorityOpsFinalCleanupError) failure = error; else throw error; }
    try { releaseLock(); }
    catch (error) { if (!failure && error instanceof AuthorityOpsFinalCleanupError) failure = error; else if (!failure) throw error; }
    return failure;
  };
  try {
    release = acquireAuthorityOpsLock(profilePath, "run");
    throwIfStartupInterrupted();
    const receiptDirectory = runtimeDirectory(profilePath);
    runConditionalAuthorityBuild(path.join(receiptDirectory, "build-receipt.json"));
    throwIfStartupInterrupted();
    const profile = readAuthorityOpsProfile(profilePath, options);
    await verifyAuthorityOpsProfile(profilePath, options);
    throwIfStartupInterrupted();
    const [apiFree, viteFree] = await Promise.all([
      portIsAvailable(profile.apiHost, profile.apiPort),
      portIsAvailable(profile.viteHost, profile.vitePort),
    ]);
    if (!apiFree || !viteFree) throw new Error("authority_ops_start_port_occupied");
    if (
      existsSync(`${profile.activeDatabasePath}-wal`) ||
      existsSync(`${profile.activeDatabasePath}-shm`)
    ) throw new Error("authority_ops_run_sidecar_present");
    const descriptor = profile.authorityManifestPath
      ? readSqliteAuthorityManifestDescriptor(profile.authorityManifestPath)
      : undefined;
    if (!descriptor) throw new Error("authority_ops_run_requires_authoritative_profile");
    const startFingerprint =
      readSqliteLogicalVerificationAtPath(profile.activeDatabasePath)
        .databaseIdentityFingerprint;
    const startingLogicalFingerprint =
      readCanonicalAuthorityLogicalFingerprintAtPath(profile.activeDatabasePath);
    const session = createAuthoritySession({
      profileIdentity: authorityProfileIdentity(profilePath),
      receiptPath: path.join(receiptDirectory, `session-${Date.now()}.json`),
      startingCheckpointId: descriptor.checkpointId,
      startingCheckpointSequence: descriptor.checkpointSequence,
      startingDatabaseFingerprint: startFingerprint,
      startingLogicalFingerprint,
    });
    const startPlan = buildAuthorityOpsStartPlan(profile, profilePath);
    const apiChildPlan = createAuthorityApiChildPlan({ startPlan, sessionContext: session.context, sessionSecret: session.secret });
    const plan = { ...startPlan, apiEnvironment: apiChildPlan.environment };
    const apiSpecOverride = dependencies.createApiChildSpec?.(plan);
    const apiSpec = superviseAuthorityChildSpec(
      apiSpecOverride
        ? { ...apiSpecOverride, env: apiChildPlan.environment }
        : apiChildPlan.childSpec,
    );
    apiOwned = spawnAuthorityOwnedChild("api", apiSpec);
    api = apiOwned.child;
    await apiOwned.spawnReady;
    throwIfStartupInterrupted();
    const rawViteSpec = resolveViteChildSpec(plan, dependencies);
    throwIfStartupInterrupted();
    const viteSpec = superviseAuthorityChildSpec(rawViteSpec);
    viteOwned = spawnAuthorityOwnedChild("vite", viteSpec, (observation) => {
      if (observation.type === "spawn-error") {
        viteOwnership = "spawn-failed";
      } else if (viteOwnership === "expected-termination-requested") {
        viteOwnership = "exited-expected";
      } else if (viteOwnership !== "exited-expected") {
        viteOwnership = "exited-unexpected";
      }
    });
    vite = viteOwned.child;
    try {
      await viteOwned.spawnReady;
    } catch {
      dependencies.onApiShutdownRequest?.("abort");
      await requestApiAbortAfterViteSpawnFailure(profile, session.secret);
      await waitForOwnedExit(
        apiOwned,
        "api",
        dependencies.apiExitTimeoutMs ?? API_EXIT_TIMEOUT_MS,
        "api_exit_timeout",
      ).catch(() => undefined);
      throw new Error("vite_spawn_failed");
    }
    throwIfStartupInterrupted();
    dependencies.onChildrenSpawned?.({ api, vite });
    control = await createAuthorityOpsControlServer({
      profilePath,
      sessionId: session.context.sessionId,
      onStop: () => requestShutdown?.(),
    });
    // If an interrupt arrived while the control descriptor was being created,
    // it is already represented by shutdownRequested and enters the same seal.

    const event = await waitForRuntimeEvent(shutdownRequested, api, vite);
    if (event === "api-exited") throw new Error("api_exit_abnormal");
    if (event === "vite-exited") {
      if (!childHasExited(api)) {
        dependencies.onApiShutdownRequest?.("abort");
        await requestApiShutdown(profile, session.secret, "abort");
        const abortExit = await waitForOwnedExit(
          apiOwned,
          "api",
          dependencies.apiExitTimeoutMs ?? API_EXIT_TIMEOUT_MS,
          "api_exit_timeout",
        ).catch(() => { throw new Error("abort_shutdown_failed"); });
        if (abortExit.code === 0 && abortExit.signal === null) {
          throw new Error("abort_shutdown_failed");
        }
      }
      if (existsSync(session.context.receiptPath)) throw new Error("abort_shutdown_failed");
      throw new Error("vite_exit_unexpected");
    }

    sealRequested = true;
    dependencies.onApiShutdownRequest?.("seal");
    try {
      await dependencies.beforeApiShutdownRequest?.("seal");
      await requestApiShutdown(profile, session.secret, "seal");
    } catch {
      // Ctrl+C can race the authenticated request with an API that has already
      // entered its own clean shutdown. The request alone is not shutdown proof;
      // retain the failure and accept it only after every existing proof gate.
      apiShutdownRequestFailed = true;
    }
    const apiExit = await waitForOwnedExit(
      apiOwned,
      "api",
      dependencies.apiExitTimeoutMs ?? API_EXIT_TIMEOUT_MS,
      "api_exit_timeout",
    );
    if (apiExit.code !== 0 || apiExit.signal !== null) throw new Error("api_exit_abnormal");
    assertViteCheckpointEligible();

    await dependencies.afterReceiptSeal?.();
    let receipt;
    try {
      receipt = readSealedAuthoritySessionReceipt(session.context.receiptPath, session.secret);
    } catch (error) {
      if (!existsSync(session.context.receiptPath)) throw new Error("clean_receipt_missing");
      throw error;
    }
    assertAuthoritySessionReceiptMatches(receipt, session.context);
    const finalFingerprint =
      readSqliteLogicalVerificationAtPath(profile.activeDatabasePath)
        .databaseIdentityFingerprint;
    if (finalFingerprint !== receipt.finalDatabaseFingerprint) {
      throw new Error("authority_session_receipt_fingerprint_invalid");
    }
    const finalLogicalFingerprint =
      readCanonicalAuthorityLogicalFingerprintAtPath(profile.activeDatabasePath);
    if (finalLogicalFingerprint !== receipt.finalLogicalFingerprint) {
      throw new Error("shutdown_logical_fingerprint_mismatch");
    }
    assertViteCheckpointEligible();

    if (viteOwnership === "running") {
      if (childHasExited(vite)) {
        viteOwnership = "exited-unexpected";
        assertViteCheckpointEligible();
      }
      // This assignment and the exact-child signal are synchronous: an exit
      // after this point is expected, while every earlier exit stays abnormal.
      viteOwnership = "expected-termination-requested";
      if (!terminateOwnedChild(vite, "vite", dependencies) && !childHasExited(vite)) {
        throw new Error("vite_shutdown_failed");
      }
    }
    await waitForOwnedExit(viteOwned, "vite", VITE_EXIT_TIMEOUT_MS, "vite_exit_timeout");
    if ((viteOwnership as ViteOwnershipState) !== "exited-expected") {
      assertViteCheckpointEligible();
      throw new Error("vite_shutdown_failed");
    }

    if (
      existsSync(`${profile.activeDatabasePath}-wal`) ||
      existsSync(`${profile.activeDatabasePath}-shm`)
    ) throw new Error("authority_ops_run_sidecar_present");
    dependencies.quiescenceProbe?.();
    apiShutdownProofPassed = true;
    // Final control cleanup is a proof gate: do not checkpoint or report a
    // clean race until this server is closed and its descriptor is gone.
    await closeControlAndRemoveDescriptor();
    if (finalFingerprint === session.context.startingDatabaseFingerprint) {
    } else {
      if (receipt.confirmedMutationCount === 0) {
        throw new Error("authority_session_untracked_database_change");
      }
      await checkpointAuthorityOpsProfile(profilePath, {
        ...options,
        expectedDatabaseFingerprint: receipt.finalDatabaseFingerprint,
        expectedLogicalFingerprint: receipt.finalLogicalFingerprint,
        dependencies: dependencies.checkpointDependencies,
      });
      await verifyAuthorityOpsProfile(profilePath, options);
      checkpointAccepted = true;
    }
    // The authority lock remains held through checkpoint acceptance and is
    // itself a final proof gate before successful completion is observable.
    releaseLock();
    if (apiShutdownRequestFailed) {
      console.warn("api_shutdown_request_failed_clean_shutdown_verified");
    }
  } catch (error) {
    // Do not release the authority lock while a startup-interrupted child still
    // owns a listener or database handle.
    await Promise.all([
      cleanupOwnedChild(viteOwned, "vite", dependencies),
      cleanupOwnedChild(apiOwned, "api", dependencies),
    ]);
    const cleanupFailure = await cleanupAfterFailure();
    if (error instanceof AuthorityOpsFinalCleanupError) {
      reportFinalCleanupFailure(error);
    } else if (cleanupFailure) {
      reportFinalCleanupFailure(cleanupFailure);
    }
    if (apiShutdownRequestFailed) {
      const code = error instanceof Error ? error.message : "unknown_shutdown_proof_failure";
      console.error(`api_shutdown_request_failed_${error instanceof AuthorityOpsFinalCleanupError && error.apiShutdownProofPassed ? "final_cleanup_failed" : "shutdown_proof_failed"}:${code}`);
    }
    throw error;
  } finally {
    await Promise.all([
      cleanupOwnedChild(viteOwned, "vite", dependencies),
      cleanupOwnedChild(apiOwned, "api", dependencies),
    ]);
    viteOwned?.dispose();
    apiOwned?.dispose();
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGBREAK", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
};

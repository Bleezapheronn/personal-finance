import Database from "better-sqlite3";
import Fastify from "fastify";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthorityApiLifecycle,
  type AuthorityApiShutdownResult,
} from "./lib/authorityApiLifecycle.js";
import {
  AuthorityMutationTracker,
  createAuthoritySession,
  readSealedAuthoritySessionReceipt,
} from "./lib/authorityOpsSession.js";
import { readCanonicalAuthorityLogicalFingerprintAtPath } from "./lib/sqliteLogicalVerification.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-api-lifecycle-"));
const schema = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"),
  "utf8",
);
const createDatabase = (name: string) => {
  const sqlitePath = path.join(root, name);
  const db = new Database(sqlitePath);
  try { db.exec(schema); } finally { db.close(); }
  return sqlitePath;
};
const recipientCount = (sqlitePath: string) => {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    return Number((db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as { count: number }).count);
  } finally { db.close(); }
};

try {
  const sqlitePath = createDatabase("seal.sqlite");
  const sealStartingLogicalFingerprint = readCanonicalAuthorityLogicalFingerprintAtPath(sqlitePath);
  const session = createAuthoritySession({
    profileIdentity: "disposable-profile",
    receiptPath: path.join(root, "seal-receipt.json"),
    startingCheckpointId: "checkpoint-0",
    startingCheckpointSequence: 0,
    startingDatabaseFingerprint: "starting-fingerprint",
    startingLogicalFingerprint: sealStartingLogicalFingerprint,
  });
  const server = Fastify();
  const tracker = new AuthorityMutationTracker();
  let releaseHeld: (() => void) | undefined;
  let heldReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { heldReady = resolve; });
  const released = new Promise<void>((resolve) => { releaseHeld = resolve; });
  server.post("/held", async () => {
    tracker.begin();
    heldReady?.();
    await released;
    const db = new Database(sqlitePath);
    try {
      db.prepare("INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)")
        .run("disposable-held", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
    } finally { db.close(); }
    tracker.confirm(["recipients"]);
    tracker.end();
    return { ok: true };
  });
  await server.ready();
  let cleanResult: AuthorityApiShutdownResult | undefined;
  const lifecycle = new AuthorityApiLifecycle(
    server, tracker, session.context, session.secret, sqlitePath,
    async () => ({
      mutationProofVersion: 1,
      startingLogicalFingerprint: sealStartingLogicalFingerprint,
      finalLogicalFingerprint: readCanonicalAuthorityLogicalFingerprintAtPath(sqlitePath),
      mutationChainDigest: "c".repeat(64),
      approvedCommittedMutationCount: 1,
    }),
    () => undefined,
    { onComplete: (result) => { cleanResult = result; } },
  );
  const held = server.inject({ method: "POST", url: "/held" });
  await ready;
  const first = lifecycle.request("seal");
  const duplicate = lifecycle.request("abort");
  if (!first.accepted || first.mode !== "seal" || duplicate.accepted || duplicate.mode !== "seal") {
    throw new Error("shutdown_first_transition_not_stable");
  }
  let lateWriteRejected = false;
  try { tracker.begin(); } catch { lateWriteRejected = true; }
  if (!lateWriteRejected || recipientCount(sqlitePath) !== 0) {
    throw new Error("post_shutdown_write_gate_failed");
  }
  const completion = lifecycle.start();
  await new Promise((resolve) => setImmediate(resolve));
  if (existsSync(session.context.receiptPath) || tracker.activeMutationCount() !== 1) {
    throw new Error("receipt_written_before_request_drain");
  }
  releaseHeld?.();
  if ((await held).statusCode !== 200) throw new Error("accepted_request_did_not_drain");
  await completion;
  if (
    cleanResult?.ok !== true ||
    cleanResult.mode !== "seal" ||
    lifecycle.currentState() !== "exited" ||
    server.server.listening ||
    recipientCount(sqlitePath) !== 1
  ) throw new Error("clean_lifecycle_completion_failed");
  const receipt = readSealedAuthoritySessionReceipt(session.context.receiptPath, session.secret);
  if (
    receipt.shutdownProofVersion !== 2 ||
    receipt.confirmedMutationCount !== 1 ||
    receipt.domainCounters.recipients !== 1
  ) throw new Error("stopped_receipt_proof_failed");

  const abortPath = createDatabase("abort.sqlite");
  const abortStartingLogicalFingerprint = readCanonicalAuthorityLogicalFingerprintAtPath(abortPath);
  const abortSession = createAuthoritySession({
    profileIdentity: "disposable-profile",
    receiptPath: path.join(root, "abort-receipt.json"),
    startingCheckpointId: "checkpoint-0",
    startingCheckpointSequence: 0,
    startingDatabaseFingerprint: "starting-fingerprint",
    startingLogicalFingerprint: abortStartingLogicalFingerprint,
  });
  const abortServer = Fastify();
  await abortServer.ready();
  const abortTracker = new AuthorityMutationTracker();
  let abortResult: AuthorityApiShutdownResult | undefined;
  const abortLifecycle = new AuthorityApiLifecycle(
    abortServer, abortTracker, abortSession.context, abortSession.secret, abortPath,
    async () => { throw new Error("abort_must_not_finalize_proof"); },
    () => undefined, { onComplete: (result) => { abortResult = result; } },
  );
  const abortFirst = abortLifecycle.request("abort");
  const attemptedUpgrade = abortLifecycle.request("seal");
  await abortLifecycle.start();
  if (
    !abortFirst.accepted ||
    attemptedUpgrade.accepted ||
    attemptedUpgrade.mode !== "abort" ||
    abortResult?.code !== "abort_shutdown_complete" ||
    existsSync(abortSession.context.receiptPath)
  ) throw new Error("abort_boundary_failed");

  const timeoutPath = createDatabase("timeout.sqlite");
  const timeoutStartingLogicalFingerprint = readCanonicalAuthorityLogicalFingerprintAtPath(timeoutPath);
  const timeoutSession = createAuthoritySession({
    profileIdentity: "disposable-profile",
    receiptPath: path.join(root, "timeout-receipt.json"),
    startingCheckpointId: "checkpoint-0",
    startingCheckpointSequence: 0,
    startingDatabaseFingerprint: "starting-fingerprint",
    startingLogicalFingerprint: timeoutStartingLogicalFingerprint,
  });
  const timeoutServer = Fastify();
  const timeoutTracker = new AuthorityMutationTracker();
  timeoutTracker.begin();
  await timeoutServer.ready();
  let timeoutResult: AuthorityApiShutdownResult | undefined;
  const timeoutLifecycle = new AuthorityApiLifecycle(
    timeoutServer, timeoutTracker, timeoutSession.context, timeoutSession.secret,
    timeoutPath,
    async () => { throw new Error("timeout_must_not_finalize_proof"); },
    () => undefined,
    { drainTimeoutMs: 25, onComplete: (result) => { timeoutResult = result; } },
  );
  timeoutLifecycle.request("seal");
  await timeoutLifecycle.start();
  if (
    timeoutResult?.code !== "api_drain_timeout" ||
    timeoutResult.ok ||
    existsSync(timeoutSession.context.receiptPath)
  ) throw new Error("bounded_drain_failure_not_fail_closed");

  console.log("Authority API lifecycle tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

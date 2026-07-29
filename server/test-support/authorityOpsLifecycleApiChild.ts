import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";
import {
  API_VERSION, READONLY_MODE, SERVER_HOST, SERVICE_MODE, SERVICE_NAME,
  areAccountDeleteMergeWritesEnabled, areAccountWritesEnabled,
  areBucketCategoryWritesEnabled, areBucketDeleteMergeWritesEnabled,
  areBudgetDefinitionWritesEnabled, areBudgetDeleteWritesEnabled,
  areBudgetLifecycleWritesEnabled, areBudgetSnapshotGenerationWritesEnabled,
  areBudgetSnapshotOccurrenceWritesEnabled, areCategoryDeleteMergeWritesEnabled,
  areRecipientActiveStateWritesEnabled, areRecipientCreateUpdateWritesEnabled,
  areRecipientDeleteMergeWritesEnabled, areSmsTemplateWritesEnabled,
  areTransactionBasicWritesEnabled, areTransactionCostBudgetWritesEnabled,
  areTransactionDeleteWritesEnabled, areTransactionTransferWritesEnabled,
  getSqliteCutoverManifestPath, getSqlitePath, isSqliteAuthorityEnabled,
} from "../src/config.js";
import { createAuthorityApiServer } from "../src/createAuthorityApiServer.js";
import { registerAutomaticBackupsRoutes } from "../src/lib/automaticBackups.js";
import { registerLocalApiAuthentication } from "../src/lib/localApiAuthentication.js";
import {
  AUTHORITY_SESSION_CONTEXT_ENV,
  AUTHORITY_SESSION_ID_ENV,
  AUTHORITY_SESSION_SECRET_ENV,
  type AuthoritySessionContext,
} from "../src/lib/authorityOpsSession.js";
import { readWriteCapabilities } from "../src/lib/writeCapabilities.js";

const valueFor = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${flag}_required`);
  return value;
};
const port = Number(valueFor("--port"));
const behavior = valueFor("--behavior");
const gate = process.argv.includes("--gate") ? path.resolve(valueFor("--gate")) : undefined;
const sqlitePath = process.env.PERSONAL_FINANCE_SQLITE_PATH;
const tokenPath = process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH;
if (
  !Number.isInteger(port) || port < 1 || port > 65535 ||
  !["normal", "receipt-without-exit", "drain-timeout", "drain-success", "mutation-lock-hold", "rollback-route", "shutdown-request-race", "shutdown-request-race-failure", "supervised-signal"].includes(behavior) ||
  !sqlitePath || !tokenPath
) throw new Error("authority_test_lifecycle_child_arguments_invalid");
requireDisposablePath(sqlitePath, "authority_test_lifecycle_child_arguments_invalid");
requireDisposablePath(tokenPath, "authority_test_lifecycle_child_arguments_invalid");
if (gate) requireDisposablePath(gate, "authority_test_lifecycle_child_arguments_invalid");
const rawContext = process.env[AUTHORITY_SESSION_CONTEXT_ENV];
const context = rawContext ? JSON.parse(rawContext) as AuthoritySessionContext : undefined;
if (
  !context ||
  context.sessionId !== process.env[AUTHORITY_SESSION_ID_ENV] ||
  !process.env[AUTHORITY_SESSION_SECRET_ENV]
) throw new Error("authority_test_lifecycle_child_session_invalid");

let keepAlive: NodeJS.Timeout | undefined;
const waitForResume = async (gatePath: string) => {
  const deadline = Date.now() + 30_000;
  while (!existsSync(`${gatePath}.resume`)) {
    if (Date.now() >= deadline) throw new Error("authority_test_gate_timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  unlinkSync(`${gatePath}.resume`);
};
const server = createAuthorityApiServer({
  apiVersion: API_VERSION,
  serviceName: SERVICE_NAME,
  serviceMode: SERVICE_MODE,
  readonlyMode: READONLY_MODE,
  getSqlitePath,
  getSqliteCutoverManifestPath,
  isSqliteAuthorityEnabled,
  readWriteCapabilities,
  writeCapabilities: {
    areAccountDeleteMergeWritesEnabled, areAccountWritesEnabled,
    areBucketCategoryWritesEnabled, areBucketDeleteMergeWritesEnabled,
    areBudgetDefinitionWritesEnabled, areBudgetDeleteWritesEnabled,
    areBudgetLifecycleWritesEnabled, areBudgetSnapshotGenerationWritesEnabled,
    areBudgetSnapshotOccurrenceWritesEnabled, areCategoryDeleteMergeWritesEnabled,
    areRecipientActiveStateWritesEnabled, areRecipientCreateUpdateWritesEnabled,
    areRecipientDeleteMergeWritesEnabled, areSmsTemplateWritesEnabled,
    areTransactionBasicWritesEnabled, areTransactionCostBudgetWritesEnabled,
    areTransactionDeleteWritesEnabled, areTransactionTransferWritesEnabled,
  },
  authoritySessionContext: context,
  authoritySessionSecret: process.env[AUTHORITY_SESSION_SECRET_ENV],
  authorityMutationExecutor: behavior === "mutation-lock-hold" ? {
    afterWriterLock: async () => {
      if (!gate) throw new Error("authority_test_lifecycle_gate_missing");
      writeFileSync(`${gate}.ready`, "ready\n", { flag: "wx" });
      await waitForResume(gate);
    },
  } : undefined,
  authorityLifecycle: {
    drainTimeoutMs: behavior === "drain-timeout" ? 300 : 10_000,
    onComplete: (result) => {
      if (behavior === "receipt-without-exit" && result.mode === "seal" && result.ok) {
        keepAlive = setInterval(() => undefined, 1_000);
        return;
      }
      process.exit(result.mode === "seal" && result.ok ? 0 : 2);
    },
  },
  registerAuthentication: registerLocalApiAuthentication,
  registerAutomaticBackups: registerAutomaticBackupsRoutes,
});

if (behavior === "drain-timeout" || behavior === "drain-success") {
  server.post("/test-support/write/held", async () => {
    if (!gate) throw new Error("authority_test_lifecycle_gate_missing");
    writeFileSync(`${gate}.ready`, "ready\n", { flag: "wx" });
    await waitForResume(gate);
    return { ok: true };
  });
}
if (behavior === "normal" || behavior === "rollback-route") {
  server.post("/test-support/write/no-op", async () => ({ ok: true, sqliteMutated: false }));
}
if (behavior === "shutdown-request-race" || behavior === "shutdown-request-race-failure") {
  server.post("/test-support/race/clean-shutdown", async (_request, reply) => {
    const token = readFileSync(tokenPath, "utf8").trim();
    // Let this test-only request complete before the internal seal closes the
    // listener; the supervisor then observes the same refused-request race as
    // a child that has independently begun a clean shutdown.
    setImmediate(() => {
      const request = http.request({
        host: SERVER_HOST,
        port,
        path: "/authority/session/shutdown",
        method: "POST",
        headers: {
          "x-personal-finance-token": token,
          "x-personal-finance-session-secret": process.env[AUTHORITY_SESSION_SECRET_ENV]!,
          "x-personal-finance-shutdown-mode": behavior === "shutdown-request-race" ? "seal" : "abort",
          "content-length": "0",
        },
      }, (response) => response.resume());
      request.on("error", () => undefined);
      request.end();
    });
    return reply.code(202).send({ ok: true });
  });
}
if (behavior === "supervised-signal") {
  server.post("/test-support/signal/inherited", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigbreakListeners = process.listenerCount("SIGBREAK");
    process.emit("SIGINT");
    process.emit("SIGBREAK");
    return { ok: true, sigintListeners, sigbreakListeners };
  });
}
if (behavior === "rollback-route") {
  server.post("/test-support/write/rollback", async () => {
    throw new Error("test_support_rollback");
  });
}

server.listen({ host: SERVER_HOST, port }).catch(() => {
  if (keepAlive) clearInterval(keepAlive);
  process.exit(1);
});

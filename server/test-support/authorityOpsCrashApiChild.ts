import { createAuthorityApiServer } from "../src/createAuthorityApiServer.js";
import {
  API_VERSION, READONLY_MODE, SERVER_HOST, SERVICE_MODE, SERVICE_NAME,
  areAccountDeleteMergeWritesEnabled, areAccountWritesEnabled, areBucketCategoryWritesEnabled,
  areBucketDeleteMergeWritesEnabled, areBudgetDefinitionWritesEnabled, areBudgetDeleteWritesEnabled,
  areBudgetLifecycleWritesEnabled, areBudgetSnapshotGenerationWritesEnabled,
  areBudgetSnapshotOccurrenceWritesEnabled, areCategoryDeleteMergeWritesEnabled,
  areRecipientActiveStateWritesEnabled, areRecipientCreateUpdateWritesEnabled,
  areRecipientDeleteMergeWritesEnabled, areSmsTemplateWritesEnabled,
  areTransactionBasicWritesEnabled, areTransactionCostBudgetWritesEnabled,
  areTransactionDeleteWritesEnabled, areTransactionTransferWritesEnabled,
  getSqliteCutoverManifestPath, getSqlitePath, isSqliteAuthorityEnabled,
} from "../src/config.js";
import { registerAutomaticBackupsRoutes } from "../src/lib/automaticBackups.js";
import { registerLocalApiAuthentication } from "../src/lib/localApiAuthentication.js";
import { AUTHORITY_SESSION_CONTEXT_ENV, AUTHORITY_SESSION_ID_ENV, AUTHORITY_SESSION_SECRET_ENV, type AuthoritySessionContext } from "../src/lib/authorityOpsSession.js";
import { readWriteCapabilities } from "../src/lib/writeCapabilities.js";
import os from "node:os";
import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const sqlitePath = process.env.PERSONAL_FINANCE_SQLITE_PATH;
const tokenPath = process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !sqlitePath || !tokenPath) throw new Error("authority_test_crash_child_arguments_invalid");
requireDisposablePath(sqlitePath, "authority_test_crash_child_arguments_invalid");
requireDisposablePath(tokenPath, "authority_test_crash_child_arguments_invalid");
const rawContext = process.env[AUTHORITY_SESSION_CONTEXT_ENV];
const context = rawContext ? JSON.parse(rawContext) as AuthoritySessionContext : undefined;
if (!context || context.sessionId !== process.env[AUTHORITY_SESSION_ID_ENV] || !process.env[AUTHORITY_SESSION_SECRET_ENV]) throw new Error("authority_test_crash_child_session_invalid");
const server = createAuthorityApiServer({
  apiVersion: API_VERSION, serviceName: SERVICE_NAME, serviceMode: SERVICE_MODE, readonlyMode: READONLY_MODE,
  getSqlitePath, getSqliteCutoverManifestPath, isSqliteAuthorityEnabled, readWriteCapabilities,
  writeCapabilities: { areAccountDeleteMergeWritesEnabled, areAccountWritesEnabled, areBucketCategoryWritesEnabled, areBucketDeleteMergeWritesEnabled, areBudgetDefinitionWritesEnabled, areBudgetDeleteWritesEnabled, areBudgetLifecycleWritesEnabled, areBudgetSnapshotGenerationWritesEnabled, areBudgetSnapshotOccurrenceWritesEnabled, areCategoryDeleteMergeWritesEnabled, areRecipientActiveStateWritesEnabled, areRecipientCreateUpdateWritesEnabled, areRecipientDeleteMergeWritesEnabled, areSmsTemplateWritesEnabled, areTransactionBasicWritesEnabled, areTransactionCostBudgetWritesEnabled, areTransactionDeleteWritesEnabled, areTransactionTransferWritesEnabled },
  authoritySessionContext: context, authoritySessionSecret: process.env[AUTHORITY_SESSION_SECRET_ENV],
  authorityLifecycle: { onComplete: (result) => process.exit(result.mode === "seal" && result.ok ? 0 : 2) },
  registerAuthentication: registerLocalApiAuthentication, registerAutomaticBackups: registerAutomaticBackupsRoutes,
});
server.post("/test-support/authority-crash", async (_request, reply) => { reply.raw.once("finish", () => process.exit(86)); return reply.code(202).send({ ok: true }); });
server.listen({ host: SERVER_HOST, port }).catch(() => process.exit(1));

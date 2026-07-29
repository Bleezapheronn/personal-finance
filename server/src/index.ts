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
  getServerPort, getSqliteCutoverManifestPath, getSqlitePath,
  isSqliteAuthorityEnabled,
} from "./config.js";
import { createAuthorityApiServer } from "./createAuthorityApiServer.js";
import { registerAutomaticBackupsRoutes } from "./lib/automaticBackups.js";
import { registerLocalApiAuthentication } from "./lib/localApiAuthentication.js";
import { readWriteCapabilities } from "./lib/writeCapabilities.js";
import {
  AUTHORITY_SESSION_CONTEXT_ENV, AUTHORITY_SESSION_ID_ENV,
  AUTHORITY_SESSION_SECRET_ENV, type AuthoritySessionContext,
} from "./lib/authorityOpsSession.js";
import { readOrCreateToken } from "./tokenStore.js";

const sessionContext = (() => {
  const raw = process.env[AUTHORITY_SESSION_CONTEXT_ENV];
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as AuthoritySessionContext;
    return value.version === 1 && value.sessionId === process.env[AUTHORITY_SESSION_ID_ENV] ? value : undefined;
  } catch { return undefined; }
})();

const server = createAuthorityApiServer({
  apiVersion: API_VERSION, serviceName: SERVICE_NAME, serviceMode: SERVICE_MODE,
  readonlyMode: READONLY_MODE, getSqlitePath, getSqliteCutoverManifestPath,
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
  authoritySessionContext: sessionContext,
  authoritySessionSecret: process.env[AUTHORITY_SESSION_SECRET_ENV],
  authorityLifecycle: {
    onComplete: (result) => {
      if (!result.ok && result.code !== "abort_shutdown_complete") {
        console.error(result.code);
      }
      process.exit(result.mode === "seal" && result.ok ? 0 : 2);
    },
  },
  registerAuthentication: registerLocalApiAuthentication,
  registerAutomaticBackups: registerAutomaticBackupsRoutes,
});

const start = async () => {
  const port = getServerPort();
  await readOrCreateToken();
  await server.listen({ host: SERVER_HOST, port });
  server.log.info(`${SERVICE_NAME} ${SERVICE_MODE} listening on http://${SERVER_HOST}:${port}`);
};
start().catch((error) => { server.log.error(error, "Failed to start local API server"); process.exit(1); });

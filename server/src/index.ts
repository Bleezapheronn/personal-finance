import {
  API_VERSION, SERVER_HOST, SERVICE_MODE, SERVICE_NAME,
  getServerPort, getSqlitePath,
} from "./config.js";
import { createLocalApiServer } from "./createLocalApiServer.js";
import { registerAutomaticBackupsRoutes } from "./lib/automaticBackups.js";
import {
  registerRestoreControlRoutes,
  RESTORE_HANDOFF_EXIT_CODE,
} from "./lib/restoreControl.js";
import { registerLocalApiAuthentication } from "./lib/localApiAuthentication.js";
import { readOrCreateToken } from "./tokenStore.js";

const server = createLocalApiServer({
  apiVersion: API_VERSION, serviceName: SERVICE_NAME, serviceMode: SERVICE_MODE,
  getSqlitePath,
  registerAuthentication: registerLocalApiAuthentication,
  registerAutomaticBackups: registerAutomaticBackupsRoutes,
  registerRestoreControl: (instance) =>
    registerRestoreControlRoutes(instance, {
      onHandoffArmed: () => {
        process.exitCode = RESTORE_HANDOFF_EXIT_CODE;
        void instance.close().finally(() => process.exit(RESTORE_HANDOFF_EXIT_CODE));
      },
    }),
});

const start = async () => {
  const port = getServerPort();
  await readOrCreateToken();
  await server.listen({ host: SERVER_HOST, port });
  server.log.info(`${SERVICE_NAME} ${SERVICE_MODE} listening on http://${SERVER_HOST}:${port}`);
};
start().catch((error) => { server.log.error(error, "Failed to start local API server"); process.exit(1); });

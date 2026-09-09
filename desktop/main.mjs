import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROFILE_ROOT_ENV = "PERSONAL_FINANCE_PROFILE_ROOT";
const INTERNAL_PROOF_ENV = "PF_INTERNAL_PACKAGING_PROOF";
const INTERNAL_PROOF_RESULT_ENV = "PF_INTERNAL_PACKAGING_PROOF_RESULT";
const SCHEDULED_BACKUP_FLAG = "--pf-run-scheduled-backup";
const RUNTIME_CONFIG_FLAG = "--runtime-config";

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};

const argumentAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const scheduledBackupRun = process.argv.includes(SCHEDULED_BACKUP_FLAG);
const scheduledBackupConfigPath = () => {
  const value = argumentAfter(RUNTIME_CONFIG_FLAG);
  if (!value || !path.isAbsolute(value)) throw new Error("runtime_config_argument_required");
  return path.resolve(value);
};

const configuredProfileRoot = () => {
  const configured = process.env[PROFILE_ROOT_ENV]?.trim() || argumentValue("pf-profile-root");
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("profile_root_must_be_absolute");
    return path.resolve(configured);
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) throw new Error("local_app_data_unavailable");
  return path.join(localAppData, "Personal Finance", "profile");
};

const proofResultPath = () => {
  const configured = process.env[INTERNAL_PROOF_RESULT_ENV]?.trim();
  if (!configured) return undefined;
  if (!path.isAbsolute(configured)) throw new Error("proof_result_path_must_be_absolute");
  return path.resolve(configured);
};

const appPath = app.getAppPath();
const runtimeRoot = path.join(appPath, "desktop-dist", "runtime");
const uiRoot = path.join(appPath, "dist");
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

let profileRoot;
let runtimeConfigPath;
if (!scheduledBackupRun) {
  profileRoot = configuredProfileRoot();
  if (isWithin(appPath, profileRoot)) {
    throw new Error("profile_root_must_be_outside_packaged_application");
  }
  mkdirSync(profileRoot, { recursive: true });
  const chromiumRoot = path.join(profileRoot, "electron-user-data");
  const sessionRoot = path.join(profileRoot, "electron-session-data");
  mkdirSync(chromiumRoot, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });
  app.setPath("userData", chromiumRoot);
  app.setPath("sessionData", sessionRoot);
  app.setAppLogsPath(path.join(profileRoot, "logs"));
  runtimeConfigPath = path.join(profileRoot, "runtime.json");
} else {
  runtimeConfigPath = scheduledBackupConfigPath();
  profileRoot = path.dirname(runtimeConfigPath);
  if (isWithin(appPath, profileRoot)) {
    throw new Error("profile_root_must_be_outside_packaged_application");
  }
  const chromiumRoot = path.join(profileRoot, "electron-user-data");
  const sessionRoot = path.join(profileRoot, "electron-session-data");
  mkdirSync(chromiumRoot, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });
  app.setPath("userData", chromiumRoot);
  app.setPath("sessionData", sessionRoot);
  app.setAppLogsPath(path.join(profileRoot, "logs"));
}

const ownsInteractiveInstance = scheduledBackupRun || app.requestSingleInstanceLock();
if (!ownsInteractiveInstance) app.quit();

let api;
let staticServer;
let mainWindow;
let shuttingDown = false;
let restoreHandoffInProgress = false;
let runtime;
let runtimeConfig;
let token;

const mimeType = (file) => {
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
};

const closeServer = (server) =>
  new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });

const stopOwnedServices = async ({ destroyWindow = false } = {}) => {
  await api?.close();
  api = undefined;
  await closeServer(staticServer);
  staticServer = undefined;
  if (destroyWindow) {
    mainWindow?.destroy();
    mainWindow = undefined;
  }
};

const closeRuntime = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopOwnedServices({ destroyWindow: true });
};

const writeProof = (result) => {
  const outputPath = proofResultPath();
  if (!outputPath) return;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result)}\n`, { encoding: "utf8" });
};

const createStaticServer = () =>
  createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const candidate = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(uiRoot, candidate);
    if (!file.startsWith(`${uiRoot}${path.sep}`) && file !== path.join(uiRoot, "index.html")) {
      response.writeHead(403).end();
      return;
    }
    try {
      response.writeHead(200, { "content-type": mimeType(file) }).end(await readFile(file));
    } catch {
      response.writeHead(200, { "content-type": "text/html" }).end(await readFile(path.join(uiRoot, "index.html")));
    }
  });

const listen = (server, port, host) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForApiHealth = async () => {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}/health`);
      if (response.ok) return true;
    } catch {
      // The local API can be between close and listen during a guarded handoff.
    }
    await delay(200);
  }
  return false;
};

const loadRuntime = async () => {
  if (!existsSync(runtimeConfigPath)) throw new Error("runtime_config_unavailable");
  const runtimeConfigModule = await import(pathToFileUrl(path.join(runtimeRoot, "runtimeConfig.js")));
  runtimeConfig = runtimeConfigModule.readRuntimeConfig(runtimeConfigPath);
  runtimeConfigModule.applyRuntimeConfigToApiEnvironment(runtimeConfigPath, runtimeConfig);
  if (app.isPackaged) {
    process.env.PERSONAL_FINANCE_PACKAGED_SCHEDULER_EXECUTABLE = process.execPath;
  }
  const [config, localApi, automaticBackups, scheduledBackups, restoreControl, localAuth, tokenStore] = await Promise.all([
    import(pathToFileUrl(path.join(runtimeRoot, "config.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "createLocalApiServer.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "lib", "automaticBackups.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "lib", "scheduledSqliteBackup.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "lib", "restoreControl.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "lib", "localApiAuthentication.js"))),
    import(pathToFileUrl(path.join(runtimeRoot, "tokenStore.js"))),
  ]);
  runtime = { config, localApi, automaticBackups, scheduledBackups, restoreControl, localAuth, tokenStore };
};

const ensureWindow = async () => {
  const url = `http://${runtimeConfig.frontendHost}:${runtimeConfig.frontendPort}/`;
  if (!mainWindow) {
    mainWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(appPath, "desktop", "preload.mjs"),
        additionalArguments: [
          `--pf-runtime-api-url=http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}`,
          `--pf-runtime-token=${token}`,
        ],
      },
    });
  }
  await mainWindow.loadURL(url);
  mainWindow.show();
};

const startOwnedRuntime = async () => {
  api = runtime.localApi.createLocalApiServer({
    apiVersion: runtime.config.API_VERSION,
    serviceName: runtime.config.SERVICE_NAME,
    serviceMode: runtime.config.SERVICE_MODE,
    getSqlitePath: runtime.config.getSqlitePath,
    registerAuthentication: runtime.localAuth.registerLocalApiAuthentication,
    registerAutomaticBackups: runtime.automaticBackups.registerAutomaticBackupsRoutes,
    registerRestoreControl: (instance) => runtime.restoreControl.registerRestoreControlRoutes(instance, {
      onHandoffArmed: () => { void handleRestoreHandoff(); },
    }),
  });
  token = await runtime.tokenStore.readOrCreateToken();
  await api.listen({ host: runtime.config.SERVER_HOST, port: runtime.config.getServerPort() });
  staticServer = createStaticServer();
  await listen(staticServer, runtimeConfig.frontendPort, runtimeConfig.frontendHost);
  await ensureWindow();
};

const restartAfterFailedHandoff = async () => {
  try {
    await stopOwnedServices();
    await startOwnedRuntime();
  } finally {
    mainWindow?.show();
  }
};

const handleRestoreHandoff = async () => {
  if (restoreHandoffInProgress || shuttingDown) return;
  restoreHandoffInProgress = true;
  mainWindow?.hide();
  let result;
  try {
    await stopOwnedServices();
    result = await runtime.restoreControl.performArmedRestoreHandoff(runtimeConfigPath);
  } catch (error) {
    await restartAfterFailedHandoff();
    restoreHandoffInProgress = false;
    console.error(`Restore handoff failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  try {
    await startOwnedRuntime();
    if (!(await waitForApiHealth())) throw new Error("restore_runtime_not_healthy");
    runtime.restoreControl.markRestoreRuntimeHealthy(runtimeConfigPath, result);
  } catch (error) {
    try {
      await stopOwnedServices();
      await runtime.restoreControl.automaticRollbackAfterRuntimeFailure(runtimeConfigPath, result);
      await startOwnedRuntime();
      if (!(await waitForApiHealth())) throw new Error("restore_rollback_runtime_failed");
    } catch (rollbackError) {
      console.error(`Restore rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    console.error(`Restored runtime failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    mainWindow?.show();
    restoreHandoffInProgress = false;
  }
};

const start = async () => {
  await loadRuntime();
  await startOwnedRuntime();
  if (process.env[INTERNAL_PROOF_ENV] === "true") {
    const health = await fetch(`http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}/health`);
    const sqlite = await fetch(
      `http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}/prototype/repositories/accounts?limit=1`,
      { headers: { "x-personal-finance-token": token } },
    );
    const sqliteBody = await sqlite.json();
    const staticUi = await fetch(`http://${runtimeConfig.frontendHost}:${runtimeConfig.frontendPort}/`);
    await closeRuntime();
    writeProof({
      apiHealth: health.ok,
      sqliteRead: sqlite.ok && Array.isArray(sqliteBody.rows),
      staticUi: staticUi.ok,
      windowLoaded: true,
      nativeSqlite: true,
      profileExternal: !isWithin(appPath, profileRoot),
      cleanShutdown: true,
    });
    app.exit(0);
  }
};

const runScheduledBackup = async () => {
  await loadRuntime();
  const result = await runtime.scheduledBackups.runScheduledSqliteBackup(runtimeConfigPath);
  console.log(`Verified scheduled backup: ${result.basename}`);
  app.exit(0);
};

const pathToFileUrl = (filePath) => new URL(`file:///${filePath.replace(/\\/g, "/")}`).href;

if (ownsInteractiveInstance) {
  app.whenReady().then(scheduledBackupRun ? runScheduledBackup : start).catch(async (error) => {
    if (!scheduledBackupRun) {
      writeProof({ error: error instanceof Error ? error.message : String(error) });
      await closeRuntime();
    }
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}

if (!scheduledBackupRun) {
  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void closeRuntime().finally(() => app.exit(0));
  });
}

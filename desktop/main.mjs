import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROFILE_ROOT_ENV = "PERSONAL_FINANCE_PROFILE_ROOT";
const INTERNAL_PROOF_ENV = "PF_INTERNAL_PACKAGING_PROOF";
const INTERNAL_PROOF_RESULT_ENV = "PF_INTERNAL_PACKAGING_PROOF_RESULT";

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
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

const profileRoot = configuredProfileRoot();
const appPath = app.getAppPath();
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const runtimeRoot = path.join(appPath, "desktop-dist", "runtime");
const uiRoot = path.join(appPath, "dist");
const runtimeConfigPath = path.join(profileRoot, "runtime.json");
let api;
let staticServer;
let mainWindow;
let shuttingDown = false;

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

const closeRuntime = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  mainWindow?.destroy();
  mainWindow = undefined;
  await api?.close();
  api = undefined;
  await closeServer(staticServer);
  staticServer = undefined;
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

const start = async () => {
  if (!existsSync(runtimeConfigPath)) throw new Error("runtime_config_unavailable");
  const runtimeConfig = await import(pathToFileUrl(path.join(runtimeRoot, "runtimeConfig.js")));
  const config = runtimeConfig.readRuntimeConfig(runtimeConfigPath);
  runtimeConfig.applyRuntimeConfigToApiEnvironment(runtimeConfigPath, config);

  const [{ API_VERSION, SERVER_HOST, SERVICE_MODE, SERVICE_NAME, getServerPort, getSqlitePath }, { createLocalApiServer }, { registerLocalApiAuthentication }, { readOrCreateToken }] =
    await Promise.all([
      import(pathToFileUrl(path.join(runtimeRoot, "config.js"))),
      import(pathToFileUrl(path.join(runtimeRoot, "createLocalApiServer.js"))),
      import(pathToFileUrl(path.join(runtimeRoot, "lib", "localApiAuthentication.js"))),
      import(pathToFileUrl(path.join(runtimeRoot, "tokenStore.js"))),
    ]);

  api = createLocalApiServer({
    apiVersion: API_VERSION,
    serviceName: SERVICE_NAME,
    serviceMode: SERVICE_MODE,
    getSqlitePath,
    registerAuthentication: registerLocalApiAuthentication,
    // Scheduled backup and restore handoff entrypoints are separately scoped.
    registerAutomaticBackups: () => {},
  });
  const token = await readOrCreateToken();
  await api.listen({ host: SERVER_HOST, port: getServerPort() });
  staticServer = createStaticServer();
  await listen(staticServer, config.frontendPort, config.frontendHost);

  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(appPath, "desktop", "preload.mjs"),
      additionalArguments: [
        `--pf-runtime-api-url=http://${config.apiHost}:${config.apiPort}`,
        `--pf-runtime-token=${token}`,
      ],
    },
  });
  await mainWindow.loadURL(`http://${config.frontendHost}:${config.frontendPort}/`);
  mainWindow.show();

  if (process.env[INTERNAL_PROOF_ENV] === "true") {
    const health = await fetch(`http://${config.apiHost}:${config.apiPort}/health`);
    const sqlite = await fetch(
      `http://${config.apiHost}:${config.apiPort}/prototype/repositories/accounts?limit=1`,
      { headers: { "x-personal-finance-token": token } },
    );
    const sqliteBody = await sqlite.json();
    const staticUi = await fetch(`http://${config.frontendHost}:${config.frontendPort}/`);
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

const pathToFileUrl = (filePath) => new URL(`file:///${filePath.replace(/\\/g, "/")}`).href;

app.whenReady().then(start).catch(async (error) => {
  writeProof({ error: error instanceof Error ? error.message : String(error) });
  await closeRuntime();
  app.exit(1);
});

app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  void closeRuntime().finally(() => app.exit(0));
});

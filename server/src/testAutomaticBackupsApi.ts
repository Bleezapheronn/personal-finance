import Fastify from "fastify";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serverRoot } from "./lib/paths.js";
import { registerAutomaticBackupsRoutes } from "./lib/automaticBackups.js";
import { registerLocalApiAuthentication } from "./lib/localApiAuthentication.js";

const token = "test-token";
const assert: (value: unknown) => asserts value = (value) => {
  if (!value) throw new Error("assertion_failed");
};

const main = async (): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "pf-automatic-backups-api-test-"));
  const originalEnv = { ...process.env };
  let app = Fastify();
  try {
    const runtimeDirectory = path.join(root, "runtime");
    const sqlitePath = path.join(runtimeDirectory, "personal-finance.sqlite");
    const tokenPath = path.join(root, "token");
    const runtimeConfigPath = path.join(runtimeDirectory, "runtime.json");
    const destination = path.join(root, "backups");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(tokenPath, token);
    const db = new Database(sqlitePath);
    try {
      db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
    } finally {
      db.close();
    }
    writeFileSync(runtimeConfigPath, JSON.stringify({
      version: 1,
      sqlitePath,
      tokenFilePath: tokenPath,
      apiHost: "127.0.0.1",
      apiPort: 3160,
      frontendHost: "localhost",
      frontendPort: 5173,
    }));
    process.env.PERSONAL_FINANCE_RUNTIME_CONFIG_PATH = runtimeConfigPath;
    process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH = tokenPath;
    process.env.PF_BACKUP_TEST_SIMULATE_SCHEDULER = "true";
    process.env.PF_BACKUP_TEST_SKIP_EXPLORER = "true";

    app = Fastify();
    registerLocalApiAuthentication(app);
    registerAutomaticBackupsRoutes(app);
    const request = (method: "GET" | "POST", url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as never }),
        headers: { "x-personal-finance-token": token },
      });

    assert((await app.inject({ method: "GET", url: "/prototype/settings/automatic-backups/state" })).statusCode === 401);
    const initial = await request("GET", "/prototype/settings/automatic-backups/state");
    assert(initial.statusCode === 200 && initial.json().state.configuration.enabled === false);

    const saved = await request("POST", "/prototype/settings/automatic-backups/save-settings", {
      destinationDirectory: destination,
      dailyLocalTime: "04:30",
    });
    assert(saved.statusCode === 200);
    const enabled = await request("POST", "/prototype/settings/automatic-backups/enable", {});
    assert(enabled.statusCode === 200 && enabled.json().state.scheduler.installed === true);
    const state = await request("GET", "/prototype/settings/automatic-backups/state");
    assert(state.statusCode === 200 && state.json().state.configuration.dailyLocalTime === "04:30");
    console.log("Automatic backup API checks: PASS");
  } finally {
    await app.close();
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./lib/paths.js";
import { readRuntimeConfig, runtimeConfigPathFromArgs } from "./runtimeConfig.js";

const runtimeConfigPath = runtimeConfigPathFromArgs(process.argv.slice(2));
const config = readRuntimeConfig(runtimeConfigPath);
const token = readFileSync(config.tokenFilePath, "utf8").trim();

const api = spawn(
  process.execPath,
  [
    path.join(repoRoot, "server", "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "server", "src", "runtimeServer.ts"),
    "--runtime-config",
    runtimeConfigPath,
  ],
  { cwd: path.join(repoRoot, "server"), stdio: "inherit" },
);

const frontend = spawn(
  process.execPath,
  [
    path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    config.frontendHost,
    "--port",
    String(config.frontendPort),
    "--strictPort",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_PERSONAL_FINANCE_LOCAL_API_URL: `http://${config.apiHost}:${config.apiPort}`,
      VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN: token,
      VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND: "http-sqlite",
    },
  },
);

const children: ChildProcess[] = [api, frontend];
let stopping = false;

const stopChildTree = (child: ChildProcess): void => {
  if (child.exitCode !== null || !child.pid) return;

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // A child can finish naturally between the exit check and taskkill.
    }
    return;
  }

  child.kill("SIGTERM");
};

const stopChildren = (): void => {
  for (const child of children) {
    stopChildTree(child);
  }
};

const stop = (exitCode: number): void => {
  if (stopping) return;
  stopping = true;
  stopChildren();
  process.exitCode = exitCode;
};

for (const child of children) {
  child.once("error", (error) => {
    console.error(`Unable to start Personal Finance runtime: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `Personal Finance runtime process stopped (${signal ?? `exit code ${code ?? 1}`}).`,
      );
      stop(code ?? 1);
    }
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

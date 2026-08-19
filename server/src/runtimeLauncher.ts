import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { repoRoot } from "./lib/paths.js";
import {
  inspectRuntimePreflight,
  preserveRuntimeEvidence,
  runtimePreflightFingerprint,
  sanitizedPreflightSummary,
  stopVerifiedRuntimeTrees,
  type RuntimePreflightResult,
} from "./runtimePreflight.js";
import { readRuntimeConfig, runtimeConfigPathFromArgs } from "./runtimeConfig.js";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const runtimeConfigPath = runtimeConfigPathFromArgs(process.argv.slice(2));
const config = readRuntimeConfig(runtimeConfigPath);
const children: ChildProcess[] = [];
let frontendIpv6Proxy: Server | undefined;
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

const stop = (exitCode: number): void => {
  if (stopping) return;
  stopping = true;
  frontendIpv6Proxy?.close();
  for (const child of children) stopChildTree(child);
  process.exitCode = exitCode;
};

const reportPreflight = (result: RuntimePreflightResult): void => {
  console.error(`Personal Finance runtime state: ${result.kind}.`);
  console.error(result.detail);
  console.error(JSON.stringify(sanitizedPreflightSummary(result), null, 2));
};

const confirmCleanup = async (): Promise<boolean> => {
  if (!input.isTTY) {
    console.error("Cleanup requires confirmation in an interactive terminal; no processes were changed.");
    return false;
  }
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(
      "Stop only the verified stale Personal Finance process tree(s) and restart? [y/N] ",
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    prompt.close();
  }
};

const waitForClearPorts = async (): Promise<boolean> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if ((await inspectRuntimePreflight(config, runtimeConfigPath)).kind === "clear") return true;
    await delay(200);
  }
  return false;
};

const preflight = async (): Promise<"start" | "stop"> => {
  let result = await inspectRuntimePreflight(config, runtimeConfigPath);
  if (result.kind === "clear") return "start";
  if (result.kind === "healthy-existing") {
    console.log(
      `Personal Finance is already running at http://${config.frontendHost}:${config.frontendPort}.`,
    );
    console.log("Keep the existing Personal Finance terminal open to retain that runtime.");
    return "stop";
  }

  if (result.kind === "incomplete" || result.kind === "orphaned") {
    await delay(750);
    result = await inspectRuntimePreflight(config, runtimeConfigPath);
    if (result.kind === "clear") return "start";
    if (result.kind === "healthy-existing") {
      console.log(
        `Personal Finance is already running at http://${config.frontendHost}:${config.frontendPort}.`,
      );
      return "stop";
    }
  }

  reportPreflight(result);
  if (result.kind === "conflict") {
    console.error("Resolve the reported port conflict before launching Personal Finance.");
    process.exitCode = 1;
    return "stop";
  }
  if (result.cleanupRootPids.length === 0 || !(await confirmCleanup())) {
    console.error("Verified stale runtime cleanup was not confirmed; no processes were changed.");
    process.exitCode = 1;
    return "stop";
  }

  const revalidated = await inspectRuntimePreflight(config, runtimeConfigPath);
  if (
    (revalidated.kind !== "incomplete" && revalidated.kind !== "orphaned") ||
    runtimePreflightFingerprint(revalidated) !== runtimePreflightFingerprint(result)
  ) {
    console.error("Runtime ownership changed after confirmation; no processes were changed.");
    process.exitCode = 1;
    return "stop";
  }

  const evidenceFile = preserveRuntimeEvidence(revalidated);
  console.log(`Preserved sanitized runtime evidence as ${evidenceFile}.`);
  try {
    stopVerifiedRuntimeTrees(revalidated.cleanupRootPids);
  } catch {
    console.error("Unable to stop every verified stale Personal Finance process tree.");
    process.exitCode = 1;
    return "stop";
  }
  if (!(await waitForClearPorts())) {
    console.error("Configured ports did not become clear after verified cleanup.");
    process.exitCode = 1;
    return "stop";
  }
  console.log("Verified stale Personal Finance runtime stopped; starting a fresh runtime.");
  return "start";
};

const startRuntime = (): void => {
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
      "127.0.0.1",
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
  children.push(api, frontend);

  frontendIpv6Proxy = createServer((client) => {
    const upstream = connect({ host: "127.0.0.1", port: config.frontendPort });
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });
  frontendIpv6Proxy.once("error", (error) => {
    console.error(`Unable to start Personal Finance IPv6 loopback proxy: ${error.message}`);
    stop(1);
  });
  frontendIpv6Proxy.listen({
    host: "::1",
    port: config.frontendPort,
    ipv6Only: true,
  });

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
};

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
process.once("SIGHUP", () => stop(0));

const main = async (): Promise<void> => {
  if ((await preflight()) === "start") startRuntime();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
});

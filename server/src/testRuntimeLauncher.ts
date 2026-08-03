import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { repoRoot, serverRoot } from "./lib/paths.js";

const assert: (value: unknown) => asserts value = (value) => {
  if (!value) throw new Error("assertion_failed");
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const unusedPort = async (): Promise<number> => {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
};

const listening = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(200);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });

const waitFor = async (condition: () => Promise<boolean>, message: string): Promise<void> => {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    if (await condition()) return;
    await delay(100);
  }
  throw new Error(message);
};

const waitForExit = async (child: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => child.once("exit", (code) => resolve(code)));

const terminateTree = (processId: number): void => {
  execFileSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
};

const directChildPid = (parentPid: number, commandFragment: string): number => {
  const command = [
    `$child = Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${parentPid}' |`,
    `Where-Object { $_.CommandLine -like '*${commandFragment}*' } | Select-Object -First 1 -ExpandProperty ProcessId;`,
    "if ($null -eq $child) { exit 1 }; $child",
  ].join(" ");
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim());
};

const writeRuntimeConfig = (root: string, apiPort: number, frontendPort: number): string => {
  const runtime = path.join(root, "runtime");
  const sqlitePath = path.join(runtime, "personal-finance.sqlite");
  const configPath = path.join(runtime, "runtime.json");
  const tokenPath = path.join(root, "token");
  mkdirSync(runtime, { recursive: true });
  const db = new Database(sqlitePath);
  try {
    db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
  } finally {
    db.close();
  }
  writeFileSync(tokenPath, "runtime-launcher-test-token");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    sqlitePath,
    tokenFilePath: tokenPath,
    apiHost: "127.0.0.1",
    apiPort,
    frontendHost: "127.0.0.1",
    frontendPort,
  }));
  return configPath;
};

const startLauncher = (configPath: string): ChildProcess => spawn(
  process.execPath,
  [
    path.join(repoRoot, "server", "dist", "runtimeLauncher.js"),
    "--runtime-config",
    configPath,
  ],
  { cwd: repoRoot, stdio: "ignore", windowsHide: true },
);

const main = async (): Promise<void> => {
  if (process.platform !== "win32") {
    console.log("Runtime launcher Windows process checks: SKIPPED (Windows only)");
    return;
  }

  const root = mkdtempSync(path.join(tmpdir(), "pf-runtime-launcher-test-"));
  const launched: ChildProcess[] = [];
  try {
    const apiPort = await unusedPort();
    const frontendPort = await unusedPort();
    const configPath = writeRuntimeConfig(root, apiPort, frontendPort);
    const launcher = startLauncher(configPath);
    launched.push(launcher);
    assert(launcher.pid);
    await waitFor(async () => (await listening(apiPort)) && (await listening(frontendPort)), "runtime_did_not_start");

    const vitePid = directChildPid(launcher.pid, "vite.js");
    const launcherExit = waitForExit(launcher);
    terminateTree(vitePid);
    await launcherExit;
    await waitFor(async () => !(await listening(apiPort)) && !(await listening(frontendPort)), "sibling_ports_retained_after_child_exit");

    const restartApiPort = await unusedPort();
    const restartFrontendPort = await unusedPort();
    const restart = startLauncher(writeRuntimeConfig(path.join(root, "restart"), restartApiPort, restartFrontendPort));
    launched.push(restart);
    assert(restart.pid);
    await waitFor(async () => (await listening(restartApiPort)) && (await listening(restartFrontendPort)), "runtime_did_not_restart");
    const restartExit = waitForExit(restart);
    terminateTree(restart.pid);
    await restartExit;
    await waitFor(async () => !(await listening(restartApiPort)) && !(await listening(restartFrontendPort)), "ports_retained_after_tree_termination");

    console.log("Runtime launcher Windows process checks: PASS");
  } finally {
    for (const child of launched) {
      if (child.pid && child.exitCode === null) {
        try { terminateTree(child.pid); } catch { /* already stopped */ }
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { repoRoot, serverRoot } from "./lib/paths.js";
import {
  classifyRuntimeSnapshots,
  inspectRuntimePreflight,
  preserveRuntimeEvidence,
  stopVerifiedRuntimeTrees,
  type ListenerSnapshot,
  type ProcessSnapshot,
} from "./runtimePreflight.js";
import type { PersonalFinanceRuntimeConfig } from "./runtimeConfig.js";

const assert: (value: unknown, message?: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message ?? "assertion_failed");
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const unusedPort = async (): Promise<number> => {
  const listener = createNetServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => error ? reject(error) : resolve()),
  );
  return address.port;
};

const listening = async (port: number, host = "127.0.0.1"): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(200);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });

const waitFor = async (condition: () => Promise<boolean>, message: string): Promise<void> => {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await condition()) return;
    await delay(100);
  }
  throw new Error(message);
};

const waitForExit = async (child: ChildProcess): Promise<number | null> => {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
};

const terminateTree = (processId: number): void => {
  execFileSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
};

const portOwnerPid = (port: number, address: string): number => {
  const command = [
    `$owner = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop |`,
    `Where-Object { $_.LocalAddress -eq '${address}' } |`,
    "Select-Object -First 1 -ExpandProperty OwningProcess;",
    "if ($null -eq $owner) { exit 1 }; $owner",
  ].join(" ");
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim());
};

const writeRuntimeConfig = (
  root: string,
  apiPort: number,
  frontendPort: number,
): { configPath: string; config: PersonalFinanceRuntimeConfig } => {
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
  const config: PersonalFinanceRuntimeConfig = {
    version: 1,
    sqlitePath,
    tokenFilePath: tokenPath,
    apiHost: "127.0.0.1",
    apiPort,
    frontendHost: "localhost",
    frontendPort,
  };
  writeFileSync(configPath, JSON.stringify(config));
  return { configPath, config };
};

interface CapturedProcess {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

const captureProcess = (child: ChildProcess): CapturedProcess => {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  return { child, stdout: () => stdout, stderr: () => stderr };
};

const startDesktopLauncher = (configPath: string): CapturedProcess => captureProcess(spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(repoRoot, "scripts", "Start-PersonalFinance.ps1"),
    "-RuntimeConfigPath",
    configPath,
  ],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
));

const startDirectLauncher = (configPath: string): ChildProcess => spawn(
  process.execPath,
  [path.join(serverRoot, "dist", "runtimeLauncher.js"), "--runtime-config", configPath],
  { cwd: repoRoot, stdio: "ignore", windowsHide: true },
);

const expectFrontend = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url);
    return response.ok && (await response.text()).includes("<title>Personal Finance App</title>");
  } catch {
    return false;
  }
};

const expectCors = async (apiPort: number, origin: string): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/health`, {
      headers: { Origin: origin },
    });
    return response.ok && response.headers.get("access-control-allow-origin") === origin;
  } catch {
    return false;
  }
};

const processSnapshot = (
  pid: number,
  parentPid: number,
  role: ProcessSnapshot["role"],
): ProcessSnapshot => ({
  pid,
  parentPid,
  role,
  name: "node.exe",
  commandLine: "",
  createdAt: "20260819120000.000000+180",
});

const syntheticListener = (
  port: number,
  role: "api-runtime" | "frontend-vite",
  includeOwner: boolean,
): ListenerSnapshot => ({
  port,
  address: "127.0.0.1",
  pid: role === "api-runtime" ? 501 : 601,
  ancestry: role === "api-runtime"
    ? [
      processSnapshot(501, 502, "api-runtime"),
      processSnapshot(502, 500, "api-wrapper"),
      processSnapshot(500, 499, "runtime-launcher"),
      processSnapshot(499, includeOwner ? 498 : 1, "launcher-wrapper"),
      ...(includeOwner ? [processSnapshot(498, 1, "powershell-owner")] : []),
    ]
    : [
      processSnapshot(601, 500, "frontend-vite"),
      processSnapshot(500, 499, "runtime-launcher"),
      processSnapshot(499, includeOwner ? 498 : 1, "launcher-wrapper"),
      ...(includeOwner ? [processSnapshot(498, 1, "powershell-owner")] : []),
    ],
});

const main = async (): Promise<void> => {
  if (process.platform !== "win32") {
    console.log("Runtime launcher Windows process checks: SKIPPED (Windows only)");
    return;
  }

  const root = mkdtempSync(path.join(tmpdir(), "pf-runtime-launcher-test-"));
  const launched: ChildProcess[] = [];
  const evidenceFiles: string[] = [];
  try {
    const apiPort = await unusedPort();
    const frontendPort = await unusedPort();
    const { configPath, config } = writeRuntimeConfig(root, apiPort, frontendPort);

    const incomplete = classifyRuntimeSnapshots(
      config,
      [syntheticListener(apiPort, "api-runtime", true)],
      { apiHealthy: true, frontendHealthy: false },
    );
    assert(incomplete.kind === "incomplete", "incomplete_state_not_classified");
    const orphanedSynthetic = classifyRuntimeSnapshots(
      config,
      [
        syntheticListener(apiPort, "api-runtime", false),
        syntheticListener(frontendPort, "frontend-vite", false),
      ],
      { apiHealthy: true, frontendHealthy: true },
    );
    assert(orphanedSynthetic.kind === "orphaned", "orphaned_state_not_classified");
    console.log("Runtime launcher classification checks: PASS");

    const launcher = startDesktopLauncher(configPath);
    launched.push(launcher.child);
    await waitFor(
      async () =>
        (await listening(apiPort)) &&
        (await listening(frontendPort)) &&
        (await listening(frontendPort, "::1")),
      "runtime_did_not_start",
    );
    assert(await expectFrontend(`http://127.0.0.1:${frontendPort}`), "ipv4_frontend_unavailable");
    assert(await expectFrontend(`http://localhost:${frontendPort}`), "localhost_frontend_unavailable");
    assert(
      await expectCors(apiPort, `http://127.0.0.1:${frontendPort}`),
      "ipv4_origin_not_allowed",
    );
    assert(
      await expectCors(apiPort, `http://localhost:${frontendPort}`),
      "localhost_origin_not_allowed",
    );

    const apiOwnerBefore = portOwnerPid(apiPort, "127.0.0.1");
    const frontendOwnerBefore = portOwnerPid(frontendPort, "127.0.0.1");
    const frontendProxyOwnerBefore = portOwnerPid(frontendPort, "::1");
    const duplicate = startDesktopLauncher(configPath);
    launched.push(duplicate.child);
    const duplicateExit = await waitForExit(duplicate.child);
    assert(duplicateExit === 0, `healthy_duplicate_exit_${duplicateExit ?? "null"}`);
    assert(duplicate.stdout().includes("already running"), "healthy_duplicate_not_reported");
    assert(duplicate.stderr() === "", "healthy_duplicate_reported_error");
    assert(portOwnerPid(apiPort, "127.0.0.1") === apiOwnerBefore, "healthy_duplicate_replaced_api");
    assert(portOwnerPid(frontendPort, "127.0.0.1") === frontendOwnerBefore, "healthy_duplicate_replaced_frontend");
    assert(portOwnerPid(frontendPort, "::1") === frontendProxyOwnerBefore, "healthy_duplicate_replaced_proxy");
    console.log("Runtime launcher healthy duplicate and loopback checks: PASS");

    const launcherExit = waitForExit(launcher.child);
    terminateTree(frontendOwnerBefore);
    await launcherExit;
    await waitFor(
      async () =>
        !(await listening(apiPort)) &&
        !(await listening(frontendPort)) &&
        !(await listening(frontendPort, "::1")),
      "sibling_ports_retained_after_child_exit",
    );

    const restartApiPort = await unusedPort();
    const restartFrontendPort = await unusedPort();
    const restartConfig = writeRuntimeConfig(
      path.join(root, "restart"),
      restartApiPort,
      restartFrontendPort,
    );
    const restart = startDesktopLauncher(restartConfig.configPath);
    launched.push(restart.child);
    await waitFor(
      async () =>
        (await listening(restartApiPort)) &&
        (await listening(restartFrontendPort)) &&
        (await listening(restartFrontendPort, "::1")),
      "runtime_did_not_restart",
    );
    const restartExit = waitForExit(restart.child);
    assert(restart.child.pid);
    terminateTree(restart.child.pid);
    await restartExit;
    await waitFor(
      async () =>
        !(await listening(restartApiPort)) &&
        !(await listening(restartFrontendPort)) &&
        !(await listening(restartFrontendPort, "::1")),
      "ports_retained_after_tree_termination",
    );
    console.log("Runtime launcher supervised cleanup checks: PASS");

    const orphanApiPort = await unusedPort();
    const orphanFrontendPort = await unusedPort();
    const orphanConfig = writeRuntimeConfig(
      path.join(root, "orphan"),
      orphanApiPort,
      orphanFrontendPort,
    );
    const orphanLauncher = startDirectLauncher(orphanConfig.configPath);
    launched.push(orphanLauncher);
    await waitFor(
      async () =>
        (await listening(orphanApiPort)) &&
        (await listening(orphanFrontendPort)) &&
        (await listening(orphanFrontendPort, "::1")),
      "orphan_fixture_did_not_start",
    );
    const declinedCleanup = startDesktopLauncher(orphanConfig.configPath);
    launched.push(declinedCleanup.child);
    const declinedExit = await waitForExit(declinedCleanup.child);
    assert(declinedExit === 1, "unconfirmed_orphan_cleanup_did_not_fail_closed");
    assert(
      declinedCleanup.stderr().includes("no processes were changed"),
      "unconfirmed_orphan_cleanup_not_reported",
    );
    assert(
      (await listening(orphanApiPort)) &&
        (await listening(orphanFrontendPort)) &&
        (await listening(orphanFrontendPort, "::1")),
      "unconfirmed_orphan_cleanup_changed_runtime",
    );
    const orphaned = await inspectRuntimePreflight(orphanConfig.config, orphanConfig.configPath);
    assert(orphaned.kind === "orphaned", "detached_runtime_not_classified");
    assert(orphaned.cleanupRootPids.length === 1, "detached_cleanup_root_not_exact");
    const evidenceFile = preserveRuntimeEvidence(orphaned);
    evidenceFiles.push(evidenceFile);
    const evidence = readFileSync(path.join(tmpdir(), evidenceFile), "utf8");
    assert(evidence.includes('"classification": "orphaned"'), "evidence_missing_classification");
    assert(!evidence.includes("commandLine"), "evidence_exposed_command_line");
    assert(!evidence.includes(orphanConfig.configPath), "evidence_exposed_config_path");
    stopVerifiedRuntimeTrees(orphaned.cleanupRootPids);
    await waitFor(
      async () =>
        !(await listening(orphanApiPort)) &&
        !(await listening(orphanFrontendPort)) &&
        !(await listening(orphanFrontendPort, "::1")),
      "verified_orphan_cleanup_retained_ports",
    );
    await waitForExit(orphanLauncher);
    console.log("Runtime launcher orphan evidence and cleanup checks: PASS");

    const conflictApiPort = await unusedPort();
    const conflictFrontendPort = await unusedPort();
    const conflictConfig = writeRuntimeConfig(
      path.join(root, "conflict"),
      conflictApiPort,
      conflictFrontendPort,
    );
    const foreignListener = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("foreign listener");
    });
    await new Promise<void>((resolve, reject) => {
      foreignListener.once("error", reject);
      foreignListener.listen(conflictApiPort, "127.0.0.1", () => resolve());
    });
    try {
      const conflict = await inspectRuntimePreflight(
        conflictConfig.config,
        conflictConfig.configPath,
      );
      assert(conflict.kind === "conflict", "foreign_listener_not_classified");
      assert(conflict.cleanupRootPids.length === 0, "foreign_listener_cleanup_allowed");
      assert(await listening(conflictApiPort), "foreign_listener_was_changed");
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreignListener.close((error) => error ? reject(error) : resolve()),
      );
    }

    console.log("Runtime launcher Windows process checks: PASS");
  } finally {
    for (const child of launched) {
      if (child.pid && child.exitCode === null) {
        try { terminateTree(child.pid); } catch { /* already stopped */ }
      }
    }
    for (const evidenceFile of evidenceFiles) {
      rmSync(path.join(tmpdir(), evidenceFile), { force: true });
    }
    rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

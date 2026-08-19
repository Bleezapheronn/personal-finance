import { execFile, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "./lib/paths.js";
import type { PersonalFinanceRuntimeConfig } from "./runtimeConfig.js";

const execFileAsync = promisify(execFile);

export type RuntimePreflightKind =
  | "clear"
  | "healthy-existing"
  | "incomplete"
  | "orphaned"
  | "conflict";

type RuntimeProcessRole =
  | "powershell-owner"
  | "launcher-wrapper"
  | "runtime-launcher"
  | "api-wrapper"
  | "api-runtime"
  | "frontend-vite"
  | "frontend-ipv6-proxy"
  | "unknown";

export interface ProcessSnapshot {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string;
  createdAt: string;
  role: RuntimeProcessRole;
}

export interface ListenerSnapshot {
  port: number;
  address: string;
  pid: number;
  ancestry: ProcessSnapshot[];
}

export interface EndpointSnapshot {
  apiHealthy: boolean;
  frontendHealthy: boolean;
}

export interface RuntimePreflightResult {
  kind: RuntimePreflightKind;
  listeners: ListenerSnapshot[];
  endpoints: EndpointSnapshot;
  cleanupRootPids: number[];
  detail: string;
}

const POWERSHELL_INSPECTION = String.raw`
$ports = $env:PERSONAL_FINANCE_RUNTIME_INSPECTION_PORTS.Split(',') | ForEach-Object { [int]$_ }
$connectionsByPort = @()
foreach ($port in $ports) {
  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($connection in $connections) {
    $connectionsByPort += [pscustomobject]@{ port = [int]$port; connection = $connection }
  }
}
if ($connectionsByPort.Count -eq 0) {
  ConvertTo-Json -InputObject @() -Compress
  exit 0
}
$all = @{}
$currentPids = @($connectionsByPort | ForEach-Object { [int]$_.connection.OwningProcess } | Select-Object -Unique)
for ($depth = 0; $depth -lt 16 -and $currentPids.Count -gt 0; $depth += 1) {
  $missingPids = @($currentPids | Where-Object { -not $all.ContainsKey([int]$_) })
  if ($missingPids.Count -eq 0) { break }
  $filter = ($missingPids | ForEach-Object { "ProcessId = $([int]$_)" }) -join ' OR '
  $processes = @(Get-CimInstance Win32_Process -Filter $filter)
  foreach ($process in $processes) { $all[[int]$process.ProcessId] = $process }
  $currentPids = @($processes | ForEach-Object { [int]$_.ParentProcessId } | Where-Object { $_ -gt 0 } | Select-Object -Unique)
}
$rows = @()
foreach ($item in $connectionsByPort) {
    $port = $item.port
    $connection = $item.connection
    $ancestry = @()
    $seen = @{}
    $currentPid = [int]$connection.OwningProcess
    while ($currentPid -gt 0 -and -not $seen.ContainsKey($currentPid) -and $ancestry.Count -lt 16) {
      $seen[$currentPid] = $true
      $process = $all[$currentPid]
      if ($null -eq $process) { break }
      $ancestry += [pscustomobject]@{
        pid = [int]$process.ProcessId
        parentPid = [int]$process.ParentProcessId
        name = [string]$process.Name
        commandLine = [string]$process.CommandLine
        createdAt = [string]$process.CreationDate
      }
      $currentPid = [int]$process.ParentProcessId
    }
    $rows += [pscustomobject]@{
      port = [int]$port
      address = [string]$connection.LocalAddress
      pid = [int]$connection.OwningProcess
      ancestry = @($ancestry)
    }
}
ConvertTo-Json -InputObject @($rows) -Depth 6 -Compress
`;

const normalizeCommand = (value: string): string =>
  value.toLowerCase().replaceAll("/", "\\").replaceAll("file:", "");

const normalizedPath = (value: string): string =>
  path.resolve(value).toLowerCase().replaceAll("/", "\\");

const includesExpectedPath = (command: string, expectedPath: string): boolean =>
  command.includes(normalizedPath(expectedPath));

const classifyRole = (
  processSnapshot: Omit<ProcessSnapshot, "role">,
  runtimeConfigPath: string,
  frontendPort: number,
): RuntimeProcessRole => {
  const command = normalizeCommand(processSnapshot.commandLine);
  const configPath = normalizedPath(runtimeConfigPath);
  const launcherSource = path.join(repoRoot, "server", "src", "runtimeLauncher.ts");
  const launcherBuilt = path.join(repoRoot, "server", "dist", "runtimeLauncher.js");
  const apiSource = path.join(repoRoot, "server", "src", "runtimeServer.ts");
  const apiBuilt = path.join(repoRoot, "server", "dist", "runtimeServer.js");
  const vite = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const powershellLauncher = path.join(repoRoot, "scripts", "Start-PersonalFinance.ps1");
  const usesConfig = command.includes(configPath);

  if (usesConfig && includesExpectedPath(command, powershellLauncher)) {
    return "powershell-owner";
  }
  if (
    usesConfig &&
    (includesExpectedPath(command, launcherSource) || includesExpectedPath(command, launcherBuilt))
  ) {
    return command.includes("tsx\\dist\\cli.mjs")
      ? "launcher-wrapper"
      : "runtime-launcher";
  }
  if (
    usesConfig &&
    (includesExpectedPath(command, apiSource) || includesExpectedPath(command, apiBuilt))
  ) {
    return command.includes("tsx\\dist\\cli.mjs") ? "api-wrapper" : "api-runtime";
  }
  if (
    includesExpectedPath(command, vite) &&
    new RegExp(`(?:--port\\s+|--port=)${frontendPort}(?:\\s|$)`).test(command)
  ) {
    return "frontend-vite";
  }
  return "unknown";
};

const inspectWindowsListeners = async (
  config: PersonalFinanceRuntimeConfig,
  runtimeConfigPath: string,
): Promise<ListenerSnapshot[]> => {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", POWERSHELL_INSPECTION],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PERSONAL_FINANCE_RUNTIME_INSPECTION_PORTS:
          `${config.apiPort},${config.frontendPort}`,
      },
    },
  );
  const parsed = JSON.parse(stdout.trim() || "[]") as Array<{
    port: number;
    address: string;
    pid: number;
    ancestry: Array<Omit<ProcessSnapshot, "role">>;
  }>;
  return parsed.map((listener) => {
    const ancestry = listener.ancestry.map((entry) => ({
      ...entry,
      role: classifyRole(entry, runtimeConfigPath, config.frontendPort),
    }));
    if (
      listener.port === config.frontendPort &&
      listener.address === "::1" &&
      ancestry[0]?.role === "runtime-launcher"
    ) {
      ancestry[0] = { ...ancestry[0], role: "frontend-ipv6-proxy" };
    }
    return {
      port: listener.port,
      address: listener.address,
      pid: listener.pid,
      ancestry,
    };
  });
};

const loopbackHosts = (preferred: "127.0.0.1" | "localhost"): string[] =>
  preferred === "127.0.0.1"
    ? ["127.0.0.1", "localhost"]
    : ["localhost", "127.0.0.1"];

const fetchMatching = async (
  urls: string[],
  matches: (response: Response, body: string) => boolean,
): Promise<boolean> => {
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (matches(response, body)) return true;
    } catch {
      // Try the alternate loopback name before classifying the endpoint.
    }
  }
  return false;
};

const inspectEndpoints = async (
  config: PersonalFinanceRuntimeConfig,
): Promise<EndpointSnapshot> => {
  const apiUrls = loopbackHosts(config.apiHost).map(
    (host) => `http://${host}:${config.apiPort}/health`,
  );
  const frontendUrls = loopbackHosts(config.frontendHost).map(
    (host) => `http://${host}:${config.frontendPort}/`,
  );
  const [apiHealthy, frontendHealthy] = await Promise.all([
    fetchMatching(apiUrls, (response, body) => {
      if (!response.ok) return false;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        return parsed.ok === true && parsed.service === "personal-finance-local-api";
      } catch {
        return false;
      }
    }),
    fetchMatching(
      frontendUrls,
      (response, body) => response.ok && body.includes("<title>Personal Finance App</title>"),
    ),
  ]);
  return { apiHealthy, frontendHealthy };
};

const chainHasRole = (listener: ListenerSnapshot, role: RuntimeProcessRole): boolean =>
  listener.ancestry.some((entry) => entry.role === role);

const runtimeLauncherPid = (listener: ListenerSnapshot): number | undefined =>
  listener.ancestry.find(
    (entry) => entry.role === "runtime-launcher" || entry.role === "frontend-ipv6-proxy",
  )?.pid;

const isExpectedApiListener = (listener: ListenerSnapshot): boolean =>
  listener.ancestry[0]?.role === "api-runtime" &&
  chainHasRole(listener, "api-wrapper");

const isExpectedFrontendListener = (listener: ListenerSnapshot): boolean =>
  listener.ancestry[0]?.role === "frontend-vite" ||
  listener.ancestry[0]?.role === "frontend-ipv6-proxy";

const cleanupRoots = (listeners: ListenerSnapshot[]): number[] => {
  const eligibleRoles = new Set<RuntimeProcessRole>([
    "powershell-owner",
    "launcher-wrapper",
    "runtime-launcher",
    "api-wrapper",
    "api-runtime",
    "frontend-vite",
    "frontend-ipv6-proxy",
  ]);
  const roots = listeners.flatMap((listener) => {
    const verified = listener.ancestry.filter((entry) => eligibleRoles.has(entry.role));
    const root = verified.at(-1);
    return root ? [root.pid] : [];
  });
  return [...new Set(roots)];
};

export const inspectRuntimePreflight = async (
  config: PersonalFinanceRuntimeConfig,
  runtimeConfigPath: string,
): Promise<RuntimePreflightResult> => {
  if (process.platform !== "win32") {
    const endpoints = await inspectEndpoints(config);
    return {
      kind: endpoints.apiHealthy || endpoints.frontendHealthy ? "conflict" : "clear",
      listeners: [],
      endpoints,
      cleanupRootPids: [],
      detail: endpoints.apiHealthy || endpoints.frontendHealthy
        ? "Runtime ownership inspection is unavailable on this platform."
        : "Configured runtime endpoints are clear.",
    };
  }

  let listeners: ListenerSnapshot[];
  try {
    listeners = await inspectWindowsListeners(config, runtimeConfigPath);
  } catch {
    const endpoints = await inspectEndpoints(config);
    return {
      kind: "conflict",
      listeners: [],
      endpoints,
      cleanupRootPids: [],
      detail: "Unable to verify configured port ownership; no processes were changed.",
    };
  }
  if (listeners.length === 0) {
    return classifyRuntimeSnapshots(
      config,
      listeners,
      { apiHealthy: false, frontendHealthy: false },
    );
  }
  const endpoints = await inspectEndpoints(config);
  return classifyRuntimeSnapshots(config, listeners, endpoints);
};

export const classifyRuntimeSnapshots = (
  config: PersonalFinanceRuntimeConfig,
  listeners: ListenerSnapshot[],
  endpoints: EndpointSnapshot,
): RuntimePreflightResult => {
  if (listeners.length === 0) {
    return {
      kind: "clear",
      listeners,
      endpoints,
      cleanupRootPids: [],
      detail: "Configured runtime ports are clear.",
    };
  }

  const apiListeners = listeners.filter((listener) => listener.port === config.apiPort);
  const frontendListeners = listeners.filter(
    (listener) => listener.port === config.frontendPort,
  );
  const expectedApi = apiListeners.length > 0 && apiListeners.every(isExpectedApiListener);
  const expectedFrontend =
    frontendListeners.length > 0 && frontendListeners.every(isExpectedFrontendListener);
  const allExpected =
    apiListeners.length + frontendListeners.length === listeners.length &&
    (apiListeners.length === 0 || expectedApi) &&
    (frontendListeners.length === 0 || expectedFrontend);

  if (!allExpected) {
    return {
      kind: "conflict",
      listeners,
      endpoints,
      cleanupRootPids: [],
      detail: "A configured port belongs to an unknown or unverifiable process.",
    };
  }

  const apiLauncherPids = new Set(apiListeners.map(runtimeLauncherPid).filter(Boolean));
  const frontendLauncherPids = new Set(
    frontendListeners.map(runtimeLauncherPid).filter(Boolean),
  );
  const commonLauncherPid = [...apiLauncherPids].find((pid) => frontendLauncherPids.has(pid));
  const hasExpectedOwner = listeners.some((listener) =>
    chainHasRole(listener, "powershell-owner"),
  );
  const bothServicesPresent = apiListeners.length > 0 && frontendListeners.length > 0;
  const hasIpv4Frontend = frontendListeners.some(
    (listener) => listener.address === "127.0.0.1" && listener.ancestry[0]?.role === "frontend-vite",
  );
  const hasIpv6Frontend = frontendListeners.some(
    (listener) => listener.address === "::1" && listener.ancestry[0]?.role === "frontend-ipv6-proxy",
  );

  if (
    bothServicesPresent &&
    commonLauncherPid !== undefined &&
    hasExpectedOwner &&
    hasIpv4Frontend &&
    hasIpv6Frontend &&
    endpoints.apiHealthy &&
    endpoints.frontendHealthy
  ) {
    return {
      kind: "healthy-existing",
      listeners,
      endpoints,
      cleanupRootPids: [],
      detail: "A healthy Personal Finance runtime is already running.",
    };
  }

  const orphaned = !hasExpectedOwner || (bothServicesPresent && commonLauncherPid === undefined);
  return {
    kind: orphaned ? "orphaned" : "incomplete",
    listeners,
    endpoints,
    cleanupRootPids: cleanupRoots(listeners),
    detail: orphaned
      ? "Verified Personal Finance listeners are detached from the expected owner chain."
      : "Only part of the expected Personal Finance runtime is healthy.",
  };
};

export const sanitizedPreflightSummary = (
  result: RuntimePreflightResult,
): Record<string, unknown> => ({
  capturedAt: new Date().toISOString(),
  classification: result.kind,
  detail: result.detail,
  endpoints: result.endpoints,
  listeners: result.listeners.map((listener) => ({
    port: listener.port,
    address: listener.address,
    pid: listener.pid,
    ancestry: listener.ancestry
      .filter((entry) => entry.role !== "unknown")
      .map((entry) => ({
        pid: entry.pid,
        parentPid: entry.parentPid,
        role: entry.role,
        createdAt: entry.createdAt,
      })),
  })),
  cleanupRootPids: result.cleanupRootPids,
});

export const runtimePreflightFingerprint = (result: RuntimePreflightResult): string =>
  JSON.stringify({
    classification: result.kind,
    listeners: result.listeners.map((listener) => ({
      port: listener.port,
      address: listener.address,
      pid: listener.pid,
      ancestry: listener.ancestry.map((entry) => ({
        pid: entry.pid,
        parentPid: entry.parentPid,
        role: entry.role,
        createdAt: entry.createdAt,
      })),
    })),
    cleanupRootPids: result.cleanupRootPids,
  });

export const preserveRuntimeEvidence = (result: RuntimePreflightResult): string => {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const fileName = `personal-finance-runtime-evidence-${stamp}.json`;
  writeFileSync(
    path.join(tmpdir(), fileName),
    `${JSON.stringify(sanitizedPreflightSummary(result), null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return fileName;
};

export const stopVerifiedRuntimeTrees = (rootPids: number[]): void => {
  for (const pid of rootPids) {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
};

import { execFileSync } from "node:child_process";
import { sep } from "node:path";

const ignoredDirectoryPrefixes = [
  ".git/",
  "node_modules/",
  "dist/",
  "server/dist/",
  "coverage/",
  ".vite/",
  ".cache/",
];

const suspiciousDirectoryPrefixes = [
  ".local-data/",
  "local-data/",
  "personal-finance-data/",
  "backups/",
  "exports/",
  "logs/",
  "temp/",
  "tmp/",
  "runtime/",
  "data/",
  "server/.local-data/",
  "server/local-data/",
  "server/backups/",
  "server/exports/",
  "server/logs/",
  "server/temp/",
  "server/tmp/",
  "server/runtime/",
  "server/data/",
];

const suspiciousPathPatterns = [
  { pattern: /(^|\/)\.env(\..*)?$/i, reason: "environment file" },
  { pattern: /(^|\/)\.server-token$/i, reason: "local API token file" },
  {
    pattern: /(^|\/)[^/]*token[^/]*\.(json|txt|log|env)$/i,
    reason: "token-like artifact file",
  },
  { pattern: /\.(sqlite|sqlite3)$/i, reason: "SQLite database file" },
  { pattern: /\.db(-wal|-shm)?$/i, reason: "database file" },
  {
    pattern: /(^|\/)personal-finance-full-backup-[^/]*\.json$/i,
    reason: "generated full backup JSON",
  },
  {
    pattern: /(^|\/)personal-finance-health-report-[^/]*\.json$/i,
    reason: "generated health report JSON",
  },
  {
    pattern: /(^|\/)personal-finance-backup-validation-[^/]*\.json$/i,
    reason: "generated backup validation JSON",
  },
  {
    pattern: /(^|\/)personal-finance-restore-summary-[^/]*\.json$/i,
    reason: "generated restore summary JSON",
  },
  {
    pattern: /\.import-summary\.json$/i,
    reason: "generated import summary JSON",
  },
  {
    pattern: /(^|\/)[^/]*(comparison|verification|report)[^/]*\.json$/i,
    reason: "generated report JSON",
  },
  {
    pattern: /(^|\/)[^/]*(cutover|authority)[^/]*manifest[^/]*\.json$/i,
    reason: "generated SQLite authority manifest JSON",
  },
  {
    pattern: /(^|\/)[^/]*checkpoint[^/]*\.json$/i,
    reason: "generated SQLite authority checkpoint JSON",
  },
  { pattern: /(^|\/)transactions_[^/]*\.csv$/i, reason: "generated export CSV" },
  { pattern: /(^|\/)budgets_[^/]*\.csv$/i, reason: "generated export CSV" },
  { pattern: /\.(log|tmp|temp)$/i, reason: "generated log/temp file" },
];

const normalizePath = (path) => path.split(sep).join("/");

const git = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const trackedFiles = git(["ls-files"])
  .split(/\r?\n/)
  .map((path) => path.trim())
  .filter(Boolean);

const unignoredOtherFiles = git(["ls-files", "--others", "--exclude-standard"])
  .split(/\r?\n/)
  .map((path) => path.trim())
  .filter(Boolean);

const statusEntries = git(["status", "--short", "--ignored"])
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean)
  .map((line) => ({
    status: line.slice(0, 2),
    path: line.slice(3).trim(),
  }))
  .filter((entry) => entry.path.length > 0);

const candidateMap = new Map();

for (const path of trackedFiles) {
  candidateMap.set(normalizePath(path), "tracked");
}

for (const path of unignoredOtherFiles) {
  candidateMap.set(normalizePath(path), "unignored");
}

for (const entry of statusEntries) {
  const path = normalizePath(entry.path);
  if (entry.status === "!!") {
    continue;
  } else if (!candidateMap.has(path)) {
    candidateMap.set(path, "status");
  }
}

const isIgnoredDirectory = (path) =>
  ignoredDirectoryPrefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));

const suspiciousReason = (path) => {
  if (isIgnoredDirectory(path)) {
    return undefined;
  }

  const directoryReason = suspiciousDirectoryPrefixes.find(
    (prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix),
  );

  if (directoryReason) {
    return `runtime data directory: ${directoryReason}`;
  }

  return suspiciousPathPatterns.find(({ pattern }) => pattern.test(path))?.reason;
};

const suspiciousPaths = Array.from(candidateMap.entries())
  .map(([path, source]) => ({
    path,
    source,
    reason: suspiciousReason(path),
  }))
  .filter((entry) => entry.reason)
  .sort((left, right) => left.path.localeCompare(right.path));

if (suspiciousPaths.length > 0) {
  console.error("Runtime artifact guard: FAIL");
  console.error(`Suspicious paths: ${suspiciousPaths.length}`);
  for (const entry of suspiciousPaths) {
    console.error(`  ${entry.path} (${entry.source}; ${entry.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log("Runtime artifact guard: PASS");
  console.log(`Checked paths: ${candidateMap.size}`);
  console.log("Suspicious paths: 0");
}

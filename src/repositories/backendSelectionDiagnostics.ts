import {
  assertRepositoryBackendSupportsWrites,
  getRepositoryBackend,
  repositoryBackendSupportsWrites,
  resolveRepositoryBackend,
  type RepositoryBackend,
} from "./adapterSelection";
import {
  getSelectedReadRepositoriesForBackend,
  getSelectedReadRepositorySource,
} from "./selectedReadRepositories";

export interface RepositoryBackendSelectionDiagnosticOptions {
  logSummary?: boolean;
}

export interface RepositoryBackendSelectionCheckResult {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface RepositoryBackendSelectionDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  currentBackend: RepositoryBackend;
  comparedChecks: number;
  failedChecks: number;
  checks: RepositoryBackendSelectionCheckResult[];
}

const passOrFail = (
  name: string,
  condition: boolean,
  code: string,
): RepositoryBackendSelectionCheckResult => ({
  name,
  status: condition ? "pass" : "fail",
  code: condition ? undefined : code,
});

const writeGuardThrowsFor = (backend: RepositoryBackend): boolean => {
  try {
    assertRepositoryBackendSupportsWrites(backend);
    return false;
  } catch {
    return true;
  }
};

const printSummary = (
  result: RepositoryBackendSelectionDiagnosticResult,
): void => {
  console.log("Repository backend selection diagnostics:");
  for (const check of result.checks) {
    const suffix = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${suffix}`);
  }
  console.log(`Current backend: ${result.currentBackend}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runRepositoryBackendSelectionDiagnostics = (
  options: RepositoryBackendSelectionDiagnosticOptions = {},
): RepositoryBackendSelectionDiagnosticResult => {
  const currentBackend = getRepositoryBackend();
  const checks: RepositoryBackendSelectionCheckResult[] = [
    passOrFail(
      "undefined backend resolves to dexie",
      resolveRepositoryBackend(undefined) === "dexie",
      "undefined_backend_not_dexie",
    ),
    passOrFail(
      "empty backend resolves to dexie",
      resolveRepositoryBackend("") === "dexie",
      "empty_backend_not_dexie",
    ),
    passOrFail(
      "explicit dexie resolves to dexie",
      resolveRepositoryBackend("dexie") === "dexie",
      "dexie_backend_not_dexie",
    ),
    passOrFail(
      "explicit http-readonly resolves to http-readonly",
      resolveRepositoryBackend("http-readonly") === "http-readonly",
      "http_readonly_backend_not_http_readonly",
    ),
    passOrFail(
      "unknown backend resolves to dexie",
      resolveRepositoryBackend("bad-value") === "dexie",
      "unknown_backend_not_dexie",
    ),
    passOrFail(
      "dexie backend supports writes",
      repositoryBackendSupportsWrites("dexie") === true,
      "dexie_backend_write_guard_failed",
    ),
    passOrFail(
      "http-readonly backend does not support writes",
      repositoryBackendSupportsWrites("http-readonly") === false,
      "http_readonly_backend_write_support_enabled",
    ),
    passOrFail(
      "http-readonly write guard throws",
      writeGuardThrowsFor("http-readonly"),
      "http_readonly_write_guard_did_not_throw",
    ),
    passOrFail(
      "undefined selected facade source is dexie",
      getSelectedReadRepositorySource(undefined) === "dexie",
      "undefined_selected_facade_not_dexie",
    ),
    passOrFail(
      "explicit dexie selected facade source is dexie",
      getSelectedReadRepositorySource("dexie") === "dexie",
      "dexie_selected_facade_not_dexie",
    ),
    passOrFail(
      "explicit http-readonly selected facade source is http-readonly",
      getSelectedReadRepositorySource("http-readonly") === "http-readonly",
      "http_readonly_selected_facade_not_http_readonly",
    ),
    passOrFail(
      "unknown selected facade source is dexie",
      getSelectedReadRepositorySource("bad-value") === "dexie",
      "unknown_selected_facade_not_dexie",
    ),
    passOrFail(
      "dexie selected facade maps to dexie readers",
      getSelectedReadRepositoriesForBackend("dexie").source === "dexie",
      "dexie_selected_facade_source_mismatch",
    ),
    passOrFail(
      "http-readonly selected facade maps to http readers",
      getSelectedReadRepositoriesForBackend("http-readonly").source ===
        "http-readonly",
      "http_readonly_selected_facade_source_mismatch",
    ),
  ];

  const failedChecks = checks.filter((check) => check.status === "fail").length;
  const result: RepositoryBackendSelectionDiagnosticResult = {
    ok: failedChecks === 0,
    generatedAt: new Date().toISOString(),
    currentBackend,
    comparedChecks: checks.length,
    failedChecks,
    checks,
  };

  if (options.logSummary === true) {
    printSummary(result);
  }

  return result;
};

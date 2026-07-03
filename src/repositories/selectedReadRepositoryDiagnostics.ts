import { LocalApiError } from "../api/localApiClient";
import { getRepositoryBackend, type RepositoryBackend } from "./adapterSelection";
import {
  getSelectedReadRepositories,
  type SelectedReadRepositories,
} from "./selectedReadRepositories";

export interface SelectedReadRepositoryDiagnosticOptions {
  logSummary?: boolean;
  sampleLimit?: number;
}

export interface SelectedReadRepositoryCheckResult {
  name: string;
  status: "pass" | "fail";
  code?: string;
  sampledIds?: number[];
}

export interface SelectedReadRepositoryDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  currentBackend: RepositoryBackend;
  selectedSource: SelectedReadRepositories["source"];
  comparedChecks: number;
  failedChecks: number;
  checks: SelectedReadRepositoryCheckResult[];
}

type RowWithId = {
  id?: unknown;
};

type ReadListResult = RowWithId[] | {
  count?: unknown;
  rows?: unknown;
};

type DetailReader = (id: number) => Promise<RowWithId | undefined>;
type ListReader = (options: { limit: number; offset: number }) => Promise<unknown>;

const WRITE_METHOD_NAME_PATTERN =
  /^(add|create|delete|insert|modify|patch|put|remove|save|set|update|upsert)/i;

const safeSampleLimit = (sampleLimit: number | undefined): number => {
  if (!Number.isFinite(sampleLimit) || sampleLimit === undefined) {
    return 3;
  }

  return Math.max(1, Math.min(10, Math.trunc(sampleLimit)));
};

const pass = (
  name: string,
  sampledIds: number[] = [],
): SelectedReadRepositoryCheckResult => ({
  name,
  status: "pass",
  sampledIds: sampledIds.length > 0 ? sampledIds : undefined,
});

const fail = (
  name: string,
  code: string,
  sampledIds: number[] = [],
): SelectedReadRepositoryCheckResult => ({
  name,
  status: "fail",
  code,
  sampledIds: sampledIds.length > 0 ? sampledIds : undefined,
});

const sanitizeErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  if (error instanceof Error && error.message) {
    return "selected_read_repository_check_failed";
  }

  return "selected_read_repository_check_failed";
};

const rowsFromListResult = (result: ReadListResult): RowWithId[] | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.rows)) {
    return result.rows as RowWithId[];
  }

  return undefined;
};

const countFromListResult = (
  result: ReadListResult,
  rows: RowWithId[],
): number | undefined => {
  if (Array.isArray(result)) {
    return rows.length;
  }

  return typeof result.count === "number" ? result.count : undefined;
};

const numericId = (row: RowWithId | undefined): number | undefined =>
  typeof row?.id === "number" && Number.isFinite(row.id) ? row.id : undefined;

const writeLikeMethodNames = (
  repositories: SelectedReadRepositories,
): string[] => {
  const writeMethods: string[] = [];

  for (const [groupName, group] of Object.entries(repositories)) {
    if (groupName === "source" || typeof group !== "object" || group === null) {
      continue;
    }

    for (const [methodName, value] of Object.entries(group)) {
      if (
        typeof value === "function" &&
        WRITE_METHOD_NAME_PATTERN.test(methodName)
      ) {
        writeMethods.push(`${groupName}.${methodName}`);
      }
    }
  }

  return writeMethods;
};

const runCountCheck = async (
  repositories: SelectedReadRepositories,
): Promise<SelectedReadRepositoryCheckResult> => {
  const name = "transactions count";

  try {
    const count = await repositories.transactions.count();
    return Number.isInteger(count) && count >= 0
      ? pass(name)
      : fail(name, "invalid_transaction_count");
  } catch (error) {
    return fail(name, sanitizeErrorCode(error));
  }
};

const runListAndDetailChecks = async (
  resourceName: string,
  list: ListReader,
  getById: DetailReader,
  limit: number,
): Promise<SelectedReadRepositoryCheckResult[]> => {
  const listName = `${resourceName} list`;
  const detailName = `${resourceName} detail`;

  try {
    const listResult = await list({ limit, offset: 0 });
    const rows = rowsFromListResult(listResult as ReadListResult);

    if (!rows) {
      return [
        fail(listName, "invalid_list_response"),
        fail(detailName, "list_response_unavailable"),
      ];
    }

    const totalCount = countFromListResult(listResult as ReadListResult, rows);
    if (totalCount === undefined || totalCount < rows.length) {
      return [
        fail(listName, "invalid_list_count"),
        fail(detailName, "list_response_unavailable"),
      ];
    }

    const sampledId = numericId(rows[0]);
    const sampledIds = sampledId === undefined ? [] : [sampledId];
    const checks = [pass(listName, sampledIds)];

    if (sampledId === undefined) {
      checks.push(pass(detailName));
      return checks;
    }

    const detail = await getById(sampledId);
    checks.push(
      numericId(detail) === sampledId
        ? pass(detailName, sampledIds)
        : fail(detailName, "detail_id_mismatch", sampledIds),
    );

    return checks;
  } catch (error) {
    return [
      fail(listName, sanitizeErrorCode(error)),
      fail(detailName, "list_response_unavailable"),
    ];
  }
};

const printSummary = (
  result: SelectedReadRepositoryDiagnosticResult,
): void => {
  console.log("Selected read repository diagnostics:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    const ids = check.sampledIds?.length
      ? ` sampledIds=${check.sampledIds.join(",")}`
      : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}${ids}`);
  }
  console.log(`Current backend: ${result.currentBackend}`);
  console.log(`Selected source: ${result.selectedSource}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runSelectedReadRepositoryDiagnostics = async (
  options: SelectedReadRepositoryDiagnosticOptions = {},
): Promise<SelectedReadRepositoryDiagnosticResult> => {
  const currentBackend = getRepositoryBackend();
  const repositories = getSelectedReadRepositories(currentBackend);
  const limit = safeSampleLimit(options.sampleLimit);
  const writeMethods = writeLikeMethodNames(repositories);
  const checks: SelectedReadRepositoryCheckResult[] = [
    repositories.source === currentBackend
      ? pass("selected source matches backend")
      : fail("selected source matches backend", "selected_source_mismatch"),
    writeMethods.length === 0
      ? pass("selected facade exposes read methods only")
      : fail("selected facade exposes read methods only", "write_methods_exposed"),
    await runCountCheck(repositories),
    ...(await runListAndDetailChecks(
      "transactions",
      (listOptions) => repositories.transactions.list(listOptions),
      repositories.transactions.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "accounts",
      (listOptions) => repositories.accounts.list(listOptions),
      repositories.accounts.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "buckets",
      (listOptions) => repositories.buckets.list(listOptions),
      repositories.buckets.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "categories",
      (listOptions) => repositories.categories.list(listOptions),
      repositories.categories.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "recipients",
      (listOptions) => repositories.recipients.list(listOptions),
      repositories.recipients.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "budgets",
      (listOptions) => repositories.budgets.list(listOptions),
      repositories.budgets.getById,
      limit,
    )),
    ...(await runListAndDetailChecks(
      "budget snapshots",
      (listOptions) => repositories.budgetSnapshots.list(listOptions),
      repositories.budgetSnapshots.getById,
      limit,
    )),
  ];

  const failedChecks = checks.filter((check) => check.status === "fail").length;
  const result: SelectedReadRepositoryDiagnosticResult = {
    ok: failedChecks === 0,
    generatedAt: new Date().toISOString(),
    currentBackend,
    selectedSource: repositories.source,
    comparedChecks: checks.length,
    failedChecks,
    checks,
  };

  if (options.logSummary === true) {
    printSummary(result);
  }

  return result;
};

import { LocalApiError } from "../api/localApiClient";
import {
  getSelectedReadRepositoriesForBackend,
  type SelectedReadRepositories,
} from "./selectedReadRepositories";

export interface SelectedReadOrderingDiagnosticOptions {
  logSummary?: boolean;
  sampleLimit?: number;
}

export interface SelectedReadOrderingCheck {
  resource: string;
  status: "pass" | "fail";
  matchesExactly: boolean;
  dexieSampledIds?: number[];
  httpSampledIds?: number[];
  dexieCount?: number;
  httpCount?: number;
  code?: string;
}

export interface SelectedReadOrderingDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  sampleLimit: number;
  comparedChecks: number;
  failedChecks: number;
  checks: SelectedReadOrderingCheck[];
}

type RowWithId = {
  id?: unknown;
};

type ReadListResult =
  | RowWithId[]
  | {
      count?: unknown;
      rows?: unknown;
    };

type ListReader = (options: {
  limit: number;
  offset: number;
}) => Promise<unknown>;

const safeSampleLimit = (sampleLimit: number | undefined): number => {
  if (sampleLimit === undefined || !Number.isFinite(sampleLimit)) {
    return 20;
  }

  return Math.max(1, Math.min(50, Math.trunc(sampleLimit)));
};

const sanitizeErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  return "selected_read_ordering_check_failed";
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

const countFromListResult = (result: ReadListResult): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const sampledIdsFromResult = (
  result: ReadListResult,
  limit: number,
): number[] | undefined => {
  const rows = rowsFromListResult(result);
  if (!rows) {
    return undefined;
  }

  return rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, limit);
};

const arraysMatch = (left: number[] = [], right: number[] = []): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const compareResourceOrdering = async (
  resource: string,
  dexieList: ListReader,
  httpList: ListReader,
  limit: number,
): Promise<SelectedReadOrderingCheck> => {
  try {
    const listOptions = { limit, offset: 0 };
    const [dexieResult, httpResult] = await Promise.all([
      dexieList(listOptions),
      httpList(listOptions),
    ]);
    const dexieSampledIds = sampledIdsFromResult(
      dexieResult as ReadListResult,
      limit,
    );
    const httpSampledIds = sampledIdsFromResult(
      httpResult as ReadListResult,
      limit,
    );

    if (!dexieSampledIds || !httpSampledIds) {
      return {
        resource,
        status: "fail",
        matchesExactly: false,
        dexieSampledIds,
        httpSampledIds,
        dexieCount: countFromListResult(dexieResult as ReadListResult),
        httpCount: countFromListResult(httpResult as ReadListResult),
        code: "invalid_ordering_list_response",
      };
    }

    const matchesExactly = arraysMatch(dexieSampledIds, httpSampledIds);

    return {
      resource,
      status: matchesExactly ? "pass" : "fail",
      matchesExactly,
      dexieSampledIds,
      httpSampledIds,
      dexieCount: countFromListResult(dexieResult as ReadListResult),
      httpCount: countFromListResult(httpResult as ReadListResult),
      code: matchesExactly ? undefined : "selected_read_order_mismatch",
    };
  } catch (error) {
    return {
      resource,
      status: "fail",
      matchesExactly: false,
      code: sanitizeErrorCode(error),
    };
  }
};

const orderingChecks = (
  dexieRepositories: SelectedReadRepositories,
  httpRepositories: SelectedReadRepositories,
  limit: number,
): Array<Promise<SelectedReadOrderingCheck>> => [
  compareResourceOrdering(
    "transactions",
    (options) => dexieRepositories.transactions.list(options),
    (options) => httpRepositories.transactions.list(options),
    limit,
  ),
  compareResourceOrdering(
    "budgets",
    (options) => dexieRepositories.budgets.list(options),
    (options) => httpRepositories.budgets.list(options),
    limit,
  ),
  compareResourceOrdering(
    "budget snapshots",
    (options) => dexieRepositories.budgetSnapshots.list(options),
    (options) => httpRepositories.budgetSnapshots.list(options),
    limit,
  ),
  compareResourceOrdering(
    "accounts",
    (options) => dexieRepositories.accounts.list(options),
    (options) => httpRepositories.accounts.list(options),
    limit,
  ),
  compareResourceOrdering(
    "buckets",
    (options) => dexieRepositories.buckets.list(options),
    (options) => httpRepositories.buckets.list(options),
    limit,
  ),
  compareResourceOrdering(
    "categories",
    (options) => dexieRepositories.categories.list(options),
    (options) => httpRepositories.categories.list(options),
    limit,
  ),
  compareResourceOrdering(
    "recipients",
    (options) => dexieRepositories.recipients.list(options),
    (options) => httpRepositories.recipients.list(options),
    limit,
  ),
  compareResourceOrdering(
    "sms import templates",
    (options) => dexieRepositories.smsImportTemplates.list(options),
    (options) => httpRepositories.smsImportTemplates.list(options),
    limit,
  ),
];

const printSummary = (result: SelectedReadOrderingDiagnosticResult): void => {
  console.log("Selected read ordering diagnostics:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    const dexieIds = check.dexieSampledIds?.length
      ? ` dexieIds=${check.dexieSampledIds.join(",")}`
      : "";
    const httpIds = check.httpSampledIds?.length
      ? ` httpIds=${check.httpSampledIds.join(",")}`
      : "";
    console.log(
      `  ${check.status.toUpperCase()} ${check.resource}${code}${dexieIds}${httpIds}`,
    );
  }
  console.log(`Sample limit: ${result.sampleLimit}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

export const runSelectedReadOrderingDiagnostics = async (
  options: SelectedReadOrderingDiagnosticOptions = {},
): Promise<SelectedReadOrderingDiagnosticResult> => {
  const sampleLimit = safeSampleLimit(options.sampleLimit);
  const dexieRepositories = getSelectedReadRepositoriesForBackend("dexie");
  const httpRepositories =
    getSelectedReadRepositoriesForBackend("http-readonly");
  const checks = await Promise.all(
    orderingChecks(dexieRepositories, httpRepositories, sampleLimit),
  );
  const failedChecks = checks.filter((check) => check.status === "fail").length;
  const result: SelectedReadOrderingDiagnosticResult = {
    ok: failedChecks === 0,
    generatedAt: new Date().toISOString(),
    sampleLimit,
    comparedChecks: checks.length,
    failedChecks,
    checks,
  };

  if (options.logSummary === true) {
    printSummary(result);
  }

  return result;
};

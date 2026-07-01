import { readFileSync } from "node:fs";
import { isDirectRun } from "./lib/cli.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3147";
const TOKEN_HEADER_NAME = "x-personal-finance-token";
const DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173";

interface SmokeArgs {
  baseUrl: string;
  token?: string;
  tokenFile?: string;
  origin?: string;
  help: boolean;
}

interface SmokeCheck {
  name: string;
  run: () => Promise<void>;
}

interface SmokeResult {
  name: string;
  status: "pass" | "fail";
  message?: string;
}

interface ResponseJson {
  [key: string]: unknown;
  ok?: unknown;
  code?: unknown;
  error?: unknown;
  service?: unknown;
  mode?: unknown;
  readonly?: unknown;
  tables?: unknown;
  table?: unknown;
  resource?: unknown;
  limit?: unknown;
  offset?: unknown;
  count?: unknown;
  rowCount?: unknown;
  rows?: unknown;
  transaction?: unknown;
  account?: unknown;
  bucket?: unknown;
  category?: unknown;
  recipient?: unknown;
  budget?: unknown;
  budgetSnapshot?: unknown;
}

const usage = `Usage:
  npm run smoke:api -- -- [--base-url <url>] (--token <token> | --token-file <path>) [--origin <origin>]

Options:
  --base-url <url>       Running local API base URL. Defaults to ${DEFAULT_BASE_URL}.
  --token <token>        API token for protected endpoint checks.
  --token-file <path>    File containing the API token.
  --origin <origin>      Optional Origin header for allowed-origin requests.
  --help                 Show this help text.
`;

const parseArgs = (argv: string[]): SmokeArgs => {
  const args: SmokeArgs = {
    baseUrl: DEFAULT_BASE_URL,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--base-url") {
      args.baseUrl = requiredValue(argv[index + 1], "--base-url");
      index += 1;
      continue;
    }

    if (arg === "--token") {
      args.token = requiredValue(argv[index + 1], "--token");
      index += 1;
      continue;
    }

    if (arg === "--token-file") {
      args.tokenFile = requiredValue(argv[index + 1], "--token-file");
      index += 1;
      continue;
    }

    if (arg === "--origin") {
      args.origin = requiredValue(argv[index + 1], "--origin");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
};

const requiredValue = (value: string | undefined, flag: string): string => {
  if (!value || value.trim() === "") {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

const loadToken = (args: SmokeArgs): string => {
  if (args.token && args.tokenFile) {
    throw new Error("Use either --token or --token-file, not both.");
  }

  if (args.token) {
    return args.token;
  }

  if (args.tokenFile) {
    const token = readFileSync(args.tokenFile, "utf8").trim();
    if (!token) {
      throw new Error("--token-file is empty.");
    }
    return token;
  }

  throw new Error("--token or --token-file is required for protected endpoint checks.");
};

const buildUrl = (baseUrl: string, pathname: string): string => {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ""), base).toString();
};

const requestJson = async (
  baseUrl: string,
  pathname: string,
  options: {
    token?: string;
    origin?: string;
  } = {},
): Promise<{ status: number; json: ResponseJson }> => {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers[TOKEN_HEADER_NAME] = options.token;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, pathname), { headers });
  } catch {
    throw new Error("server_unavailable");
  }

  let json: ResponseJson;
  try {
    json = (await response.json()) as ResponseJson;
  } catch {
    throw new Error("invalid_json_response");
  }

  return { status: response.status, json };
};

const requestRaw = async (
  baseUrl: string,
  pathname: string,
  options: {
    method?: string;
    token?: string;
    origin?: string;
    accessControlRequestMethod?: string;
    accessControlRequestHeaders?: string;
  } = {},
): Promise<{ status: number; headers: Headers }> => {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers[TOKEN_HEADER_NAME] = options.token;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }
  if (options.accessControlRequestMethod) {
    headers["Access-Control-Request-Method"] = options.accessControlRequestMethod;
  }
  if (options.accessControlRequestHeaders) {
    headers["Access-Control-Request-Headers"] = options.accessControlRequestHeaders;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, pathname), {
      method: options.method ?? "GET",
      headers,
    });
  } catch {
    throw new Error("server_unavailable");
  }

  return { status: response.status, headers: response.headers };
};

const expect = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectStatus = (actual: number, expected: number): void => {
  expect(actual === expected, `expected_status_${expected}_got_${actual}`);
};

const transactionIdFromListResponse = (json: ResponseJson): number => {
  const rows = json.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("list_empty");
  }
  const firstRow = rows[0] as Record<string, unknown>;
  const id = firstRow.id;
  expect(typeof id === "number", "list_missing_id");
  return id as number;
};

const buildChecks = (baseUrl: string, token: string, origin?: string): SmokeCheck[] => {
  const authedOptions = { token, origin };
  const allowedPreflightOrigin = origin ?? DEFAULT_ALLOWED_ORIGIN;
  let sampledTransactionId: number | undefined;
  let sampledBudgetId: number | undefined;
  let sampledBudgetSnapshotId: number | undefined;
  const sampledLookupIds = new Map<string, number>();
  const lookupResources = ["accounts", "buckets", "categories", "recipients"] as const;
  const lookupDetailKeys = {
    accounts: "account",
    buckets: "bucket",
    categories: "category",
    recipients: "recipient",
  } as const;

  return [
    {
      name: "health succeeds without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/health");
        expectStatus(status, 200);
        expect(json.ok === true && json.service === "personal-finance-local-api", "unexpected_health_response");
      },
    },
    {
      name: "metadata fails without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/metadata");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_metadata_unauthorized_response");
      },
    },
    {
      name: "metadata succeeds with token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/metadata", authedOptions);
        expectStatus(status, 200);
        expect(json.mode === "prototype" && json.readonly === true, "unexpected_metadata_response");
      },
    },
    {
      name: "approved browser preflight succeeds without token",
      run: async () => {
        const { status, headers } = await requestRaw(
          baseUrl,
          "/prototype/repositories/transactions/count",
          {
            method: "OPTIONS",
            origin: allowedPreflightOrigin,
            accessControlRequestMethod: "GET",
            accessControlRequestHeaders: TOKEN_HEADER_NAME,
          },
        );
        expectStatus(status, 204);
        expect(
          headers.get("access-control-allow-origin") === allowedPreflightOrigin,
          "unexpected_preflight_allow_origin",
        );
        expect(headers.get("vary")?.includes("Origin") === true, "unexpected_preflight_vary");
        expect(
          headers.get("access-control-allow-methods")?.includes("GET") === true &&
            headers.get("access-control-allow-methods")?.includes("OPTIONS") === true,
          "unexpected_preflight_allow_methods",
        );
        expect(
          headers
            .get("access-control-allow-headers")
            ?.toLowerCase()
            .includes(TOKEN_HEADER_NAME) === true,
          "unexpected_preflight_allow_headers",
        );
      },
    },
    {
      name: "unexpected origin preflight is rejected",
      run: async () => {
        const { status } = await requestRaw(
          baseUrl,
          "/prototype/repositories/transactions/count",
          {
            method: "OPTIONS",
            origin: "http://unexpected-origin.invalid",
            accessControlRequestMethod: "GET",
            accessControlRequestHeaders: TOKEN_HEADER_NAME,
          },
        );
        expectStatus(status, 403);
      },
    },
    {
      name: "row counts fail without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/sqlite/row-counts");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_row_counts_unauthorized_response");
      },
    },
    {
      name: "row counts succeed with token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/sqlite/row-counts", authedOptions);
        expectStatus(status, 200);
        expect(json.ok === true && json.readonly === true && typeof json.tables === "object", "unexpected_row_counts_response");
      },
    },
    {
      name: "transaction table fails without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/sqlite/tables/transactions?limit=1");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_table_unauthorized_response");
      },
    },
    {
      name: "transaction table succeeds with token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/sqlite/tables/transactions?limit=1",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            json.table === "transactions" &&
            json.limit === 1 &&
            typeof json.rowCount === "number" &&
            Array.isArray(json.rows) &&
            json.rows.length <= 1,
          "unexpected_transaction_table_response",
        );
      },
    },
    {
      name: "invalid table is rejected",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/sqlite/tables/notATable", authedOptions);
        expectStatus(status, 404);
        expect(json.code === "sqlite_table_not_found", "unexpected_invalid_table_response");
      },
    },
    {
      name: "invalid limit is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/sqlite/tables/transactions?limit=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "limit_invalid", "unexpected_invalid_limit_response");
      },
    },
    {
      name: "invalid offset is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/sqlite/tables/transactions?offset=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "offset_invalid", "unexpected_invalid_offset_response");
      },
    },
    {
      name: "transaction repository list fails without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/repositories/transactions?limit=1");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_transaction_repository_unauthorized_response");
      },
    },
    {
      name: "transaction repository list succeeds with token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions?limit=1",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            json.limit === 1 &&
            json.offset === 0 &&
            typeof json.count === "number" &&
            Array.isArray(json.rows) &&
            json.rows.length <= 1,
          "unexpected_transaction_repository_list_response",
        );
        sampledTransactionId = transactionIdFromListResponse(json);
      },
    },
    {
      name: "transaction repository detail succeeds with token",
      run: async () => {
        expect(sampledTransactionId !== undefined, "sample_transaction_id_missing");
        const { status, json } = await requestJson(
          baseUrl,
          `/prototype/repositories/transactions/${sampledTransactionId}`,
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            typeof json.transaction === "object" &&
            json.transaction !== null &&
            (json.transaction as Record<string, unknown>).id === sampledTransactionId,
          "unexpected_transaction_repository_detail_response",
        );
      },
    },
    {
      name: "invalid transaction id is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/not-a-number",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "transaction_id_invalid", "unexpected_invalid_transaction_id_response");
      },
    },
    {
      name: "invalid transaction filter is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions?accountId=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "accountId_invalid", "unexpected_invalid_transaction_filter_response");
      },
    },
    {
      name: "budget repository list fails without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/repositories/budgets?limit=1");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_budget_repository_unauthorized_response");
      },
    },
    {
      name: "budget repository list succeeds with token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budgets?limit=1",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            json.resource === "budgets" &&
            json.limit === 1 &&
            json.offset === 0 &&
            typeof json.count === "number" &&
            Array.isArray(json.rows) &&
            json.rows.length <= 1,
          "unexpected_budget_repository_list_response",
        );
        sampledBudgetId = transactionIdFromListResponse(json);
      },
    },
    {
      name: "budget repository detail succeeds with token",
      run: async () => {
        expect(sampledBudgetId !== undefined, "sample_budget_id_missing");
        const { status, json } = await requestJson(
          baseUrl,
          `/prototype/repositories/budgets/${sampledBudgetId}`,
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            typeof json.budget === "object" &&
            json.budget !== null &&
            (json.budget as Record<string, unknown>).id === sampledBudgetId,
          "unexpected_budget_repository_detail_response",
        );
      },
    },
    {
      name: "budget snapshots for budget succeeds with token",
      run: async () => {
        expect(sampledBudgetId !== undefined, "sample_budget_id_missing");
        const { status, json } = await requestJson(
          baseUrl,
          `/prototype/repositories/budgets/${sampledBudgetId}/snapshots?limit=1`,
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            json.resource === "budgetSnapshots" &&
            json.limit === 1 &&
            json.offset === 0 &&
            typeof json.count === "number" &&
            Array.isArray(json.rows) &&
            json.rows.length <= 1,
          "unexpected_budget_snapshot_for_budget_response",
        );
      },
    },
    {
      name: "budget snapshot repository list succeeds with token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budget-snapshots?limit=1",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            json.resource === "budgetSnapshots" &&
            json.limit === 1 &&
            json.offset === 0 &&
            typeof json.count === "number" &&
            Array.isArray(json.rows) &&
            json.rows.length <= 1,
          "unexpected_budget_snapshot_repository_list_response",
        );
        sampledBudgetSnapshotId = transactionIdFromListResponse(json);
      },
    },
    {
      name: "budget snapshot repository detail succeeds with token",
      run: async () => {
        expect(sampledBudgetSnapshotId !== undefined, "sample_budget_snapshot_id_missing");
        const { status, json } = await requestJson(
          baseUrl,
          `/prototype/repositories/budget-snapshots/${sampledBudgetSnapshotId}`,
          authedOptions,
        );
        expectStatus(status, 200);
        expect(
          json.ok === true &&
            typeof json.budgetSnapshot === "object" &&
            json.budgetSnapshot !== null &&
            (json.budgetSnapshot as Record<string, unknown>).id === sampledBudgetSnapshotId,
          "unexpected_budget_snapshot_repository_detail_response",
        );
      },
    },
    {
      name: "budget snapshot repository list fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budget-snapshots?limit=1",
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_budget_snapshot_repository_unauthorized_response");
      },
    },
    {
      name: "invalid budget id is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budgets/not-a-number",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "budget_id_invalid", "unexpected_invalid_budget_id_response");
      },
    },
    {
      name: "invalid budget query is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budgets?frequency=fortnightly",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "frequency_invalid", "unexpected_invalid_budget_query_response");
      },
    },
    {
      name: "invalid budget snapshot id is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budget-snapshots/not-a-number",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "budget_snapshot_id_invalid", "unexpected_invalid_budget_snapshot_id_response");
      },
    },
    {
      name: "invalid budget snapshot query is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/budget-snapshots?budgetId=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "budgetId_invalid", "unexpected_invalid_budget_snapshot_query_response");
      },
    },
    {
      name: "lookup list fails without token",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/prototype/repositories/accounts?limit=1");
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_lookup_unauthorized_response");
      },
    },
    ...lookupResources.flatMap((resource): SmokeCheck[] => [
      {
        name: `${resource} lookup list succeeds with token`,
        run: async () => {
          const { status, json } = await requestJson(
            baseUrl,
            `/prototype/repositories/${resource}?limit=1`,
            authedOptions,
          );
          expectStatus(status, 200);
          expect(
            json.ok === true &&
              json.resource === resource &&
              json.limit === 1 &&
              json.offset === 0 &&
              typeof json.count === "number" &&
              Array.isArray(json.rows) &&
              json.rows.length <= 1,
            "unexpected_lookup_list_response",
          );
          sampledLookupIds.set(resource, transactionIdFromListResponse(json));
        },
      },
      {
        name: `${resource} lookup detail succeeds with token`,
        run: async () => {
          const sampledId = sampledLookupIds.get(resource);
          expect(sampledId !== undefined, "sample_lookup_id_missing");
          const { status, json } = await requestJson(
            baseUrl,
            `/prototype/repositories/${resource}/${sampledId}`,
            authedOptions,
          );
          const detail = json[lookupDetailKeys[resource]];
          expectStatus(status, 200);
          expect(
            json.ok === true &&
              typeof detail === "object" &&
              detail !== null &&
              (detail as Record<string, unknown>).id === sampledId,
            "unexpected_lookup_detail_response",
          );
        },
      },
    ]),
    {
      name: "invalid lookup id is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/not-a-number",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "accounts_id_invalid", "unexpected_invalid_lookup_id_response");
      },
    },
    {
      name: "invalid lookup query is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/categories?bucketId=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "bucketId_invalid", "unexpected_invalid_lookup_query_response");
      },
    },
    {
      name: "unexpected origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(baseUrl, "/metadata", {
          token,
          origin: "http://unexpected-origin.invalid",
        });
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_origin_response");
      },
    },
  ];
};

const runChecks = async (checks: SmokeCheck[]): Promise<SmokeResult[]> => {
  const results: SmokeResult[] = [];
  for (const check of checks) {
    try {
      await check.run();
      results.push({ name: check.name, status: "pass" });
    } catch (error) {
      results.push({
        name: check.name,
        status: "fail",
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
  return results;
};

const printSummary = (results: SmokeResult[]): void => {
  console.log("API smoke test:");
  for (const result of results) {
    const suffix = result.message ? ` (${result.message})` : "";
    console.log(`  ${result.status.toUpperCase()} ${result.name}${suffix}`);
  }

  const failed = results.filter((result) => result.status === "fail").length;
  console.log(`Total checks: ${results.length}`);
  console.log(`Passed: ${results.length - failed}`);
  console.log(`Failed: ${failed}`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage);
    return;
  }

  const token = loadToken(args);
  const checks = buildChecks(args.baseUrl, token, args.origin);
  const results = await runChecks(checks);
  printSummary(results);

  if (results.some((result) => result.status === "fail")) {
    process.exitCode = 1;
  }
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

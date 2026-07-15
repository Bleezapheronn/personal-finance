import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDirectRun } from "./lib/cli.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3147";
const TOKEN_HEADER_NAME = "x-personal-finance-token";
const DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173";
const RECIPIENT_ACTIVATE_WRITE_CONFIRMATION = "activate recipient in disposable sqlite";
const RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION = "deactivate recipient in disposable sqlite";
const RECIPIENT_CREATE_WRITE_CONFIRMATION = "create recipient in disposable sqlite";
const RECIPIENT_UPDATE_WRITE_CONFIRMATION = "update recipient in disposable sqlite";

interface SmokeArgs {
  baseUrl: string;
  token?: string;
  tokenFile?: string;
  origin?: string;
  allowRecipientActivateWriteSmoke: boolean;
  allowRecipientDeactivateWriteSmoke: boolean;
  allowRecipientCreateUpdateWriteSmoke: boolean;
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
  action?: unknown;
  dryRun?: unknown;
  wouldMutate?: unknown;
  dryRunRequired?: unknown;
  realWrite?: unknown;
  sqliteMutated?: unknown;
  rowsChanged?: unknown;
  targetIdPresent?: unknown;
  validationErrors?: unknown;
  warnings?: unknown;
  normalizedFieldPresence?: unknown;
  duplicateSummary?: unknown;
  timestampBehavior?: unknown;
  affectedSummary?: unknown;
  safety?: unknown;
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
  smsImportTemplate?: unknown;
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
  --allow-recipient-activate-write-smoke
                         Opt in to one disposable SQLite recipient activate write smoke.
  --allow-recipient-deactivate-write-smoke
                         Opt in to one disposable SQLite recipient deactivate write smoke.
  --allow-recipient-create-update-write-smoke
                         Opt in to disposable SQLite recipient create/update write smoke.
  --help                 Show this help text.
`;

const parseArgs = (argv: string[]): SmokeArgs => {
  const args: SmokeArgs = {
    baseUrl: DEFAULT_BASE_URL,
    allowRecipientActivateWriteSmoke: false,
    allowRecipientDeactivateWriteSmoke: false,
    allowRecipientCreateUpdateWriteSmoke: false,
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

    if (arg === "--allow-recipient-activate-write-smoke") {
      args.allowRecipientActivateWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-recipient-deactivate-write-smoke") {
      args.allowRecipientDeactivateWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-recipient-create-update-write-smoke") {
      args.allowRecipientCreateUpdateWriteSmoke = true;
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
    method?: string;
    token?: string;
    origin?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; json: ResponseJson }> => {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers[TOKEN_HEADER_NAME] = options.token;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, pathname), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
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

const optionalIdFromListResponse = (json: ResponseJson): number | undefined => {
  const rows = json.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }

  const firstRow = rows[0] as Record<string, unknown>;
  const id = firstRow.id;
  expect(typeof id === "number", "list_missing_id");
  return id as number;
};

const listResponseFingerprint = (json: ResponseJson): string => {
  if (!Array.isArray(json.rows)) {
    throw new Error("list_missing_rows");
  }

  return createHash("sha256").update(JSON.stringify(json.rows)).digest("hex");
};

const countFromListResponse = (json: ResponseJson): number => {
  expect(typeof json.count === "number", "list_missing_count");
  return json.count as number;
};

const firstRowValue = (json: ResponseJson, fieldName: string): string | number | undefined => {
  const rows = json.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }

  const row = rows[0] as Record<string, unknown>;
  const value = row[fieldName];
  if (typeof value === "string") {
    return value.trim() ? value : undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  return undefined;
};

const expectSafeActiveStateWriteShape = (
  json: ResponseJson,
  action: "activate" | "deactivate",
): void => {
  expect(json.action === action, "unexpected_write_action");
  expect(json.dryRunRequired === true, "write_dry_run_required_flag_missing");
  expect(json.realWrite === true, "real_write_flag_missing");
  expect(typeof json.sqliteMutated === "boolean", "write_sqlite_mutated_flag_missing");
  expect(typeof json.rowsChanged === "number", "write_rows_changed_missing");
  expect(typeof json.targetIdPresent === "boolean", "write_target_presence_missing");
  expect(typeof json.timestampBehavior === "object", "write_timestamp_behavior_missing");
  expect(typeof json.safety === "object", "write_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "write_dexie_mutation_reported");
  expect(safety.filesWritten === false, "write_file_write_reported");
  expect(safety.transactionReferencesMutated === false, "write_transaction_mutation_reported");
  expect(safety.rawRowsIncluded === false, "write_raw_rows_reported");
};

const expectSafeCreateUpdateWriteShape = (
  json: ResponseJson,
  action: "create" | "update",
): void => {
  expect(json.action === action, "unexpected_create_update_write_action");
  expect(json.dryRunRequired === true, "create_update_write_dry_run_required_flag_missing");
  expect(json.realWrite === true, "create_update_real_write_flag_missing");
  expect(typeof json.sqliteMutated === "boolean", "create_update_sqlite_mutated_flag_missing");
  expect(typeof json.rowsChanged === "number", "create_update_rows_changed_missing");
  expect(typeof json.targetIdPresent === "boolean", "create_update_target_presence_missing");
  expect(typeof json.normalizedFieldPresence === "object", "create_update_normalized_summary_missing");
  expect(typeof json.duplicateSummary === "object", "create_update_duplicate_summary_missing");
  expect(typeof json.timestampBehavior === "object", "create_update_timestamp_behavior_missing");
  expect(typeof json.affectedSummary === "object", "create_update_affected_summary_missing");
  expect(typeof json.safety === "object", "create_update_write_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "create_update_write_dexie_mutation_reported");
  expect(safety.filesWritten === false, "create_update_write_file_write_reported");
  expect(
    safety.transactionReferencesMutated === false,
    "create_update_write_transaction_mutation_reported",
  );
  expect(safety.rawRowsIncluded === false, "create_update_write_raw_rows_reported");
};

const recipientDetail = (json: ResponseJson): Record<string, unknown> => {
  const recipient = json.recipient;
  expect(
    typeof recipient === "object" && recipient !== null && !Array.isArray(recipient),
    "recipient_detail_missing",
  );
  return recipient as Record<string, unknown>;
};

const expectRecipientRowsOnlyDifferByActiveState = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void => {
  for (const [key, value] of Object.entries(before)) {
    if (key === "isActive") {
      continue;
    }
    expect(JSON.stringify(after[key]) === JSON.stringify(value), `recipient_field_changed_${key}`);
  }
};

const expectDryRunSafety = (
  json: ResponseJson,
  action: "create" | "update" | "activate" | "deactivate",
): void => {
  expect(json.action === action, "unexpected_dry_run_action");
  expect(json.dryRun === true, "dry_run_flag_missing");
  expect(json.wouldMutate === false, "dry_run_would_mutate");
  expect(typeof json.normalizedFieldPresence === "object", "normalized_summary_missing");
  expect(typeof json.duplicateSummary === "object", "duplicate_summary_missing");
  expect(typeof json.timestampBehavior === "object", "timestamp_behavior_missing");
  expect(typeof json.affectedSummary === "object", "affected_summary_missing");
  expect(typeof json.safety === "object", "safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.sqliteMutated === false, "sqlite_mutation_reported");
  expect(safety.dexieMutated === false, "dexie_mutation_reported");
  expect(safety.filesWritten === false, "file_write_reported");
  expect(safety.transactionReferencesMutated === false, "transaction_mutation_reported");
  expect(safety.rawRowsIncluded === false, "raw_rows_reported");
};

const expectNoSensitiveEcho = (json: ResponseJson, values: Array<string | undefined>): void => {
  const serialized = JSON.stringify(json);
  for (const value of values) {
    if (value && value.trim()) {
      expect(!serialized.includes(value), "dry_run_echoed_sensitive_value");
    }
  }
};

const buildChecks = (
  baseUrl: string,
  token: string,
  origin: string | undefined,
  allowRecipientActivateWriteSmoke: boolean,
  allowRecipientDeactivateWriteSmoke: boolean,
  allowRecipientCreateUpdateWriteSmoke: boolean,
): SmokeCheck[] => {
  const authedOptions = { token, origin };
  const allowedPreflightOrigin = origin ?? DEFAULT_ALLOWED_ORIGIN;
  let sampledTransactionId: number | undefined;
  let sampledBudgetId: number | undefined;
  let sampledBudgetSnapshotId: number | undefined;
  let recipientCountBeforeDryRun: number | undefined;
  let recipientFingerprintBeforeDryRun: string | undefined;
  let sampledRecipientName: string | undefined;
  let sampledRecipientId: number | undefined;
  let alternateRecipientId: number | undefined;
  let sampledRecipientNameDuplicateCount: number | undefined;
  let activeRecipientId: number | undefined;
  let inactiveRecipientId: number | undefined;
  let createdRecipientId: number | undefined;
  let createUpdateSmokeSequence = Date.now();
  const sampledLookupIds = new Map<string, number>();
  const lookupResources = [
    "accounts",
    "buckets",
    "categories",
    "recipients",
    "sms-import-templates",
  ] as const;
  const lookupDetailKeys = {
    accounts: "account",
    buckets: "bucket",
    categories: "category",
    recipients: "recipient",
    "sms-import-templates": "smsImportTemplate",
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
      name: "approved dry-run browser preflight succeeds without token",
      run: async () => {
        const { status, headers } = await requestRaw(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            method: "OPTIONS",
            origin: allowedPreflightOrigin,
            accessControlRequestMethod: "POST",
            accessControlRequestHeaders: `${TOKEN_HEADER_NAME}, content-type`,
          },
        );
        expectStatus(status, 204);
        expect(
          headers.get("access-control-allow-origin") === allowedPreflightOrigin,
          "unexpected_dry_run_preflight_allow_origin",
        );
        expect(
          headers.get("access-control-allow-methods")?.includes("POST") === true,
          "unexpected_dry_run_preflight_allow_methods",
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
          const sampledId = optionalIdFromListResponse(json);
          if (sampledId !== undefined) {
            sampledLookupIds.set(resource, sampledId);
          }
        },
      },
      {
        name: `${resource} lookup detail succeeds with token`,
        run: async () => {
          const sampledId = sampledLookupIds.get(resource);
          if (sampledId === undefined) {
            return;
          }
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
      name: "invalid sms template lookup account filter is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/sms-import-templates?accountId=-1",
          authedOptions,
        );
        expectStatus(status, 400);
        expect(json.code === "accountId_invalid", "unexpected_invalid_sms_template_lookup_query_response");
      },
    },
    {
      name: "recipient create dry-run fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            method: "POST",
            body: { name: "Smoke Dry Run No Token" },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_dry_run_unauthorized_response");
      },
    },
    {
      name: "recipient create dry-run bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: { name: "Smoke Dry Run Bad Origin" },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_dry_run_origin_response");
      },
    },
    {
      name: "recipient create dry-run captures baseline without printing rows",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients?limit=500",
          authedOptions,
        );
        expectStatus(status, 200);
        recipientCountBeforeDryRun = countFromListResponse(json);
        recipientFingerprintBeforeDryRun = listResponseFingerprint(json);
        const sampledId = firstRowValue(json, "id");
        const sampledName = firstRowValue(json, "name");
        sampledRecipientId = typeof sampledId === "number" ? sampledId : undefined;
        sampledRecipientName = typeof sampledName === "string" ? sampledName : undefined;
        const rows = json.rows;
        if (Array.isArray(rows) && rows.length > 1) {
          const alternateId = (rows[1] as Record<string, unknown>).id;
          alternateRecipientId = typeof alternateId === "number" ? alternateId : undefined;
        }
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const source = row as Record<string, unknown>;
            const id = source.id;
            const isActive = source.isActive;
            if (typeof id !== "number") {
              continue;
            }
            if (
              activeRecipientId === undefined &&
              (isActive === 1 || isActive === true)
            ) {
              activeRecipientId = id;
            }
            if (
              inactiveRecipientId === undefined &&
              (isActive === 0 || isActive === false)
            ) {
              inactiveRecipientId = id;
            }
          }
        }
        if (Array.isArray(rows) && sampledRecipientName && rows.length === recipientCountBeforeDryRun) {
          const normalizedSampledName = sampledRecipientName.toLowerCase();
          sampledRecipientNameDuplicateCount = rows.filter((row) => {
            const name = (row as Record<string, unknown>).name;
            return typeof name === "string" && name.toLowerCase() === normalizedSampledName;
          }).length;
        }
      },
    },
    {
      name: "recipient create dry-run missing name fails safely",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: { name: "   " },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "missing_name_dry_run_should_not_pass");
        expect(Array.isArray(json.validationErrors), "missing_name_validation_errors_missing");
        expect(
          (json.validationErrors as unknown[]).includes("name_required"),
          "missing_name_code_missing",
        );
        expectDryRunSafety(json, "create");
      },
    },
    {
      name: "recipient create dry-run valid payload returns redacted summary",
      run: async () => {
        const sensitiveValues = [
          "Smoke Dry Run Unique Recipient",
          "Smoke Dry Run Alias",
          "smoke-dry-run@example.invalid",
          "5550000001",
          "900001",
          "800001",
          "700001",
          "Smoke Dry Run Description",
        ];
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: {
              name: sensitiveValues[0],
              aliases: sensitiveValues[1],
              email: sensitiveValues[2],
              phone: sensitiveValues[3],
              tillNumber: sensitiveValues[4],
              paybill: sensitiveValues[5],
              accountNumber: sensitiveValues[6],
              description: sensitiveValues[7],
            },
          },
        );
        expectStatus(status, 200);
        expectDryRunSafety(json, "create");
        expectNoSensitiveEcho(json, sensitiveValues);
        expect(json.dryRun === true && json.wouldMutate === false, "dry_run_flags_invalid");
      },
    },
    {
      name: "recipient create dry-run reports duplicate candidates as counts only",
      run: async () => {
        if (!sampledRecipientName) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: { name: sampledRecipientName },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "duplicate_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("duplicate_candidate_detected"),
          "duplicate_candidate_code_missing",
        );
        expectDryRunSafety(json, "create");
        expectNoSensitiveEcho(json, [sampledRecipientName]);
        const duplicateSummary = json.duplicateSummary as Record<string, unknown>;
        expect(
          typeof duplicateSummary.duplicateNameCandidates === "number" &&
            duplicateSummary.duplicateNameCandidates > 0,
          "duplicate_name_count_missing",
        );
      },
    },
    {
      name: "recipient create dry-run unexpected fields are rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: { name: "Smoke Dry Run Unexpected", id: 123 },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "unexpected_payload_field", "unexpected_field_code_missing");
        expect(json.dryRun === true && json.wouldMutate === false, "unexpected_field_dry_run_flags_invalid");
      },
    },
    {
      name: "recipient dry-run unsupported actions are not exposed",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: { name: "Smoke Dry Run Merge", merge: true },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "unsupported_first_slice_action", "unsupported_action_code_missing");
      },
    },
    {
      name: "recipient create dry-run does not mutate recipients",
      run: async () => {
        expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
        expect(recipientFingerprintBeforeDryRun !== undefined, "recipient_baseline_fingerprint_missing");

        for (let index = 0; index < 2; index += 1) {
          const { status } = await requestJson(
            baseUrl,
            "/prototype/repositories/recipients/dry-run/create",
            {
              ...authedOptions,
              method: "POST",
              body: { name: `Smoke Dry Run Repeat ${index}` },
            },
          );
          expectStatus(status, 200);
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients?limit=500",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(countFromListResponse(json) === recipientCountBeforeDryRun, "recipient_count_changed");
        expect(listResponseFingerprint(json) === recipientFingerprintBeforeDryRun, "recipient_sample_changed");
      },
    },
    {
      name: "recipient update dry-run fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            method: "POST",
            body: { id: 1, name: "Smoke Dry Run Update" },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_update_dry_run_unauthorized_response");
      },
    },
    {
      name: "recipient update dry-run bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: { id: 1, name: "Smoke Dry Run Bad Origin" },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_update_dry_run_origin_response");
      },
    },
    {
      name: "recipient update dry-run missing id fails safely",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { name: "Smoke Dry Run Missing Id" },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "missing_id_update_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("id_required"),
          "missing_id_code_missing",
        );
        expectDryRunSafety(json, "update");
      },
    },
    {
      name: "recipient update dry-run unknown id fails safely",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { id: 2147483647, name: "Smoke Dry Run Unknown Id" },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "unknown_id_update_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("recipient_not_found"),
          "recipient_not_found_code_missing",
        );
        expectDryRunSafety(json, "update");
      },
    },
    {
      name: "recipient update dry-run missing name fails safely",
      run: async () => {
        if (sampledRecipientId === undefined) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { id: sampledRecipientId, name: "   " },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "missing_name_update_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("name_required"),
          "update_missing_name_code_missing",
        );
        expectDryRunSafety(json, "update");
      },
    },
    {
      name: "recipient update dry-run valid payload returns redacted summary",
      run: async () => {
        if (sampledRecipientId === undefined) {
          return;
        }

        const sensitiveValues = [
          "Smoke Dry Run Updated Recipient",
          "Smoke Dry Run Updated Alias",
          "smoke-dry-run-update@example.invalid",
          "5550000002",
          "900002",
          "800002",
          "700002",
          "Smoke Dry Run Updated Description",
        ];
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: {
              id: sampledRecipientId,
              name: sensitiveValues[0],
              aliases: sensitiveValues[1],
              email: sensitiveValues[2],
              phone: sensitiveValues[3],
              tillNumber: sensitiveValues[4],
              paybill: sensitiveValues[5],
              accountNumber: sensitiveValues[6],
              description: sensitiveValues[7],
            },
          },
        );
        expectStatus(status, 200);
        expectDryRunSafety(json, "update");
        expect(json.dryRun === true && json.wouldMutate === false, "update_dry_run_flags_invalid");
        expect(json.targetIdPresent === true, "update_target_id_presence_missing");
        expectNoSensitiveEcho(json, sensitiveValues);
        const timestampBehavior = json.timestampBehavior as Record<string, unknown>;
        expect(timestampBehavior.createdAtWouldChange === false, "update_created_at_should_not_change");
        expect(timestampBehavior.updatedAtWouldChange === true, "update_updated_at_should_change");
      },
    },
    {
      name: "recipient update dry-run excludes target from duplicate counts",
      run: async () => {
        if (sampledRecipientId === undefined || !sampledRecipientName) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { id: sampledRecipientId, name: sampledRecipientName },
          },
        );
        expectStatus(status, 200);
        expectDryRunSafety(json, "update");
        expectNoSensitiveEcho(json, [sampledRecipientName]);
        const duplicateSummary = json.duplicateSummary as Record<string, unknown>;
        if (sampledRecipientNameDuplicateCount !== undefined) {
          expect(
            duplicateSummary.duplicateNameCandidates ===
              Math.max(sampledRecipientNameDuplicateCount - 1, 0),
            "target_was_not_excluded_from_duplicate_counts",
          );
        } else {
          expect(
            typeof duplicateSummary.duplicateNameCandidates === "number",
            "target_exclusion_duplicate_count_missing",
          );
        }
      },
    },
    {
      name: "recipient update dry-run reports duplicate candidates as counts only",
      run: async () => {
        if (alternateRecipientId === undefined || !sampledRecipientName) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { id: alternateRecipientId, name: sampledRecipientName },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "update_duplicate_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("duplicate_candidate_detected"),
          "update_duplicate_candidate_code_missing",
        );
        expectDryRunSafety(json, "update");
        expectNoSensitiveEcho(json, [sampledRecipientName]);
        const duplicateSummary = json.duplicateSummary as Record<string, unknown>;
        expect(
          typeof duplicateSummary.duplicateNameCandidates === "number" &&
            duplicateSummary.duplicateNameCandidates > 0,
          "update_duplicate_name_count_missing",
        );
      },
    },
    {
      name: "recipient update dry-run unexpected fields are rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { id: 1, name: "Smoke Dry Run Unexpected", createdAt: "2026-01-01" },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "unexpected_payload_field", "update_unexpected_field_code_missing");
        expect(json.dryRun === true && json.wouldMutate === false, "update_unexpected_field_flags_invalid");
      },
    },
    {
      name: "recipient update dry-run does not mutate recipients",
      run: async () => {
        expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
        expect(recipientFingerprintBeforeDryRun !== undefined, "recipient_baseline_fingerprint_missing");
        if (sampledRecipientId === undefined) {
          return;
        }

        for (let index = 0; index < 2; index += 1) {
          const { status } = await requestJson(
            baseUrl,
            "/prototype/repositories/recipients/dry-run/update",
            {
              ...authedOptions,
              method: "POST",
              body: { id: sampledRecipientId, name: `Smoke Dry Run Update Repeat ${index}` },
            },
          );
          expectStatus(status, 200);
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients?limit=500",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(countFromListResponse(json) === recipientCountBeforeDryRun, "recipient_count_changed");
        expect(listResponseFingerprint(json) === recipientFingerprintBeforeDryRun, "recipient_sample_changed");
      },
    },
    {
      name: "recipient activate dry-run fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/activate",
          {
            method: "POST",
            body: { id: 1 },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_activate_dry_run_unauthorized_response");
      },
    },
    {
      name: "recipient deactivate dry-run bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/deactivate",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: { id: 1 },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_deactivate_dry_run_origin_response");
      },
    },
    {
      name: "recipient activate dry-run missing id fails safely",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/activate",
          {
            ...authedOptions,
            method: "POST",
            body: {},
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "missing_id_activate_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("id_required"),
          "activate_missing_id_code_missing",
        );
        expectDryRunSafety(json, "activate");
      },
    },
    {
      name: "recipient deactivate dry-run unknown id fails safely",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/deactivate",
          {
            ...authedOptions,
            method: "POST",
            body: { id: 2147483647 },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === false, "unknown_id_deactivate_dry_run_should_not_pass");
        expect(
          Array.isArray(json.validationErrors) &&
            (json.validationErrors as unknown[]).includes("recipient_not_found"),
          "deactivate_recipient_not_found_code_missing",
        );
        expectDryRunSafety(json, "deactivate");
      },
    },
    {
      name: "recipient activate dry-run no-op warns for active recipient",
      run: async () => {
        if (activeRecipientId === undefined) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/activate",
          {
            ...authedOptions,
            method: "POST",
            body: { id: activeRecipientId },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === true, "activate_noop_should_remain_valid");
        expect(
          Array.isArray(json.warnings) &&
            (json.warnings as unknown[]).includes("recipient_already_active"),
          "recipient_already_active_warning_missing",
        );
        expectDryRunSafety(json, "activate");
        const timestampBehavior = json.timestampBehavior as Record<string, unknown>;
        expect(timestampBehavior.createdAtWouldChange === false, "activate_created_at_should_not_change");
        expect(timestampBehavior.updatedAtWouldChange === false, "activate_updated_at_should_not_change");
        expect(timestampBehavior.isActiveWouldChange === false, "activate_noop_should_not_change_active_state");
      },
    },
    {
      name: "recipient deactivate dry-run no-op warns for inactive recipient when present",
      run: async () => {
        if (inactiveRecipientId === undefined) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/deactivate",
          {
            ...authedOptions,
            method: "POST",
            body: { id: inactiveRecipientId },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === true, "deactivate_noop_should_remain_valid");
        expect(
          Array.isArray(json.warnings) &&
            (json.warnings as unknown[]).includes("recipient_already_inactive"),
          "recipient_already_inactive_warning_missing",
        );
        expectDryRunSafety(json, "deactivate");
        const timestampBehavior = json.timestampBehavior as Record<string, unknown>;
        expect(timestampBehavior.createdAtWouldChange === false, "deactivate_created_at_should_not_change");
        expect(timestampBehavior.updatedAtWouldChange === false, "deactivate_updated_at_should_not_change");
        expect(timestampBehavior.isActiveWouldChange === false, "deactivate_noop_should_not_change_active_state");
      },
    },
    {
      name: "recipient deactivate dry-run valid active-state change is redacted",
      run: async () => {
        if (activeRecipientId === undefined) {
          return;
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/deactivate",
          {
            ...authedOptions,
            method: "POST",
            body: { id: activeRecipientId },
          },
        );
        expectStatus(status, 200);
        expect(json.ok === true, "deactivate_valid_dry_run_should_pass");
        expectDryRunSafety(json, "deactivate");
        expectNoSensitiveEcho(json, [sampledRecipientName]);
        const timestampBehavior = json.timestampBehavior as Record<string, unknown>;
        expect(timestampBehavior.createdAtWouldChange === false, "deactivate_created_at_should_not_change");
        expect(timestampBehavior.updatedAtWouldChange === false, "deactivate_updated_at_should_not_change");
        expect(timestampBehavior.isActiveWouldChange === true, "deactivate_should_change_active_state");
        const affectedSummary = json.affectedSummary as Record<string, unknown>;
        expect(
          typeof affectedSummary.transactionUsageCount === "number",
          "deactivate_usage_count_missing",
        );
      },
    },
    {
      name: "recipient activate dry-run unexpected fields are rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/activate",
          {
            ...authedOptions,
            method: "POST",
            body: { id: 1, name: "Smoke Dry Run Unexpected" },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "unexpected_payload_field", "activate_unexpected_field_code_missing");
        expect(json.dryRun === true && json.wouldMutate === false, "activate_unexpected_field_flags_invalid");
      },
    },
    {
      name: "recipient activate and deactivate dry-runs do not mutate recipients",
      run: async () => {
        expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
        expect(recipientFingerprintBeforeDryRun !== undefined, "recipient_baseline_fingerprint_missing");
        const targetId = activeRecipientId ?? sampledRecipientId;
        if (targetId === undefined) {
          return;
        }

        for (const action of ["activate", "deactivate"] as const) {
          const { status } = await requestJson(
            baseUrl,
            `/prototype/repositories/recipients/dry-run/${action}`,
            {
              ...authedOptions,
              method: "POST",
              body: { id: targetId },
            },
          );
          expectStatus(status, 200);
        }

        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients?limit=500",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(countFromListResponse(json) === recipientCountBeforeDryRun, "recipient_count_changed");
        expect(listResponseFingerprint(json) === recipientFingerprintBeforeDryRun, "recipient_sample_changed");
      },
    },
    {
      name: "recipient activate write fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/activate",
          {
            method: "POST",
            body: {
              id: 1,
              expectedIsActive: false,
              dryRunReviewed: true,
              confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_activate_write_unauthorized_response");
      },
    },
    {
      name: "recipient activate write bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/activate",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: {
              id: 1,
              expectedIsActive: false,
              dryRunReviewed: true,
              confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_activate_write_origin_response");
      },
    },
    {
      name: "recipient activate write validation failures are redacted",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/activate",
          {
            ...authedOptions,
            method: "POST",
            body: { expectedIsActive: false, dryRunReviewed: true },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "id_required", "activate_write_missing_id_code_missing");
        expectSafeActiveStateWriteShape(json, "activate");
        expect(json.sqliteMutated === false, "activate_write_validation_mutated");
        expect(json.rowsChanged === 0, "activate_write_validation_rows_changed");
      },
    },
    ...(!allowRecipientActivateWriteSmoke
      ? [
          {
            name: "recipient activate write default smoke does not mutate",
            run: async () => {
              const { status, json } = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/activate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: 2147483647,
                    expectedIsActive: false,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expect(status === 403 || status === 404, `expected_status_403_or_404_got_${status}`);
              if (status === 403) {
                expect(
                  json.code === "recipient_active_state_writes_disabled",
                  "activate_write_disabled_code_missing",
                );
              } else {
                expect(json.code === "recipient_not_found", "activate_write_unknown_id_code_missing");
              }
              expectSafeActiveStateWriteShape(json, "activate");
              expect(json.sqliteMutated === false, "default_activate_write_mutated");
              expect(json.rowsChanged === 0, "default_activate_write_rows_changed");

              const listResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listResponse.status, 200);
              expect(
                countFromListResponse(listResponse.json) === recipientCountBeforeDryRun,
                "default_activate_write_changed_recipient_count",
              );
              expect(
                listResponseFingerprint(listResponse.json) === recipientFingerprintBeforeDryRun,
                "default_activate_write_changed_recipient_sample",
              );
            },
          },
        ]
      : []),
    {
      name: "recipient deactivate write fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/deactivate",
          {
            method: "POST",
            body: {
              id: 1,
              expectedIsActive: true,
              dryRunReviewed: true,
              confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_deactivate_write_unauthorized_response");
      },
    },
    {
      name: "recipient deactivate write bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/deactivate",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: {
              id: 1,
              expectedIsActive: true,
              dryRunReviewed: true,
              confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_deactivate_write_origin_response");
      },
    },
    {
      name: "recipient deactivate write validation failures are redacted",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/deactivate",
          {
            ...authedOptions,
            method: "POST",
            body: { expectedIsActive: true, dryRunReviewed: true },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "id_required", "deactivate_write_missing_id_code_missing");
        expectSafeActiveStateWriteShape(json, "deactivate");
        expect(json.sqliteMutated === false, "deactivate_write_validation_mutated");
        expect(json.rowsChanged === 0, "deactivate_write_validation_rows_changed");
      },
    },
    ...(!allowRecipientDeactivateWriteSmoke
      ? [
          {
            name: "recipient deactivate write default smoke does not mutate",
            run: async () => {
              const { status, json } = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/deactivate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: 2147483647,
                    expectedIsActive: true,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expect(status === 403 || status === 404, `expected_status_403_or_404_got_${status}`);
              if (status === 403) {
                expect(
                  json.code === "recipient_active_state_writes_disabled",
                  "deactivate_write_disabled_code_missing",
                );
              } else {
                expect(json.code === "recipient_not_found", "deactivate_write_unknown_id_code_missing");
              }
              expectSafeActiveStateWriteShape(json, "deactivate");
              expect(json.sqliteMutated === false, "default_deactivate_write_mutated");
              expect(json.rowsChanged === 0, "default_deactivate_write_rows_changed");

              const listResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listResponse.status, 200);
              expect(
                countFromListResponse(listResponse.json) === recipientCountBeforeDryRun,
                "default_deactivate_write_changed_recipient_count",
              );
              expect(
                listResponseFingerprint(listResponse.json) === recipientFingerprintBeforeDryRun,
                "default_deactivate_write_changed_recipient_sample",
              );
            },
          },
        ]
      : []),
    {
      name: "recipient create write fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/create",
          {
            method: "POST",
            body: {
              name: "Smoke Write No Token",
              dryRunReviewed: true,
              confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_create_write_unauthorized_response");
      },
    },
    {
      name: "recipient create write bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/create",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: {
              name: "Smoke Write Bad Origin",
              dryRunReviewed: true,
              confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_create_write_origin_response");
      },
    },
    {
      name: "recipient create write validation failures are redacted",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/create",
          {
            ...authedOptions,
            method: "POST",
            body: {
              name: "   ",
              dryRunReviewed: true,
              confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "name_required", "create_write_missing_name_code_missing");
        expectSafeCreateUpdateWriteShape(json, "create");
        expect(json.sqliteMutated === false, "create_write_validation_mutated");
        expect(json.rowsChanged === 0, "create_write_validation_rows_changed");
      },
    },
    ...(!allowRecipientCreateUpdateWriteSmoke
      ? [
          {
            name: "recipient create write default smoke does not mutate",
            run: async () => {
              const { status, json } = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    name: "Smoke Write Disabled Create",
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(status, 403);
              expect(
                json.code === "recipient_create_update_writes_disabled",
                "create_write_disabled_code_missing",
              );
              expectSafeCreateUpdateWriteShape(json, "create");
              expect(json.sqliteMutated === false, "default_create_write_mutated");
              expect(json.rowsChanged === 0, "default_create_write_rows_changed");

              const listResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listResponse.status, 200);
              expect(
                countFromListResponse(listResponse.json) === recipientCountBeforeDryRun,
                "default_create_write_changed_recipient_count",
              );
              expect(
                listResponseFingerprint(listResponse.json) === recipientFingerprintBeforeDryRun,
                "default_create_write_changed_recipient_sample",
              );
            },
          },
        ]
      : []),
    {
      name: "recipient update write fails without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/update",
          {
            method: "POST",
            body: {
              id: 1,
              name: "Smoke Write Update No Token",
              dryRunReviewed: true,
              confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_update_write_unauthorized_response");
      },
    },
    {
      name: "recipient update write bad origin is rejected",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/update",
          {
            method: "POST",
            token,
            origin: "http://unexpected-origin.invalid",
            body: {
              id: 1,
              name: "Smoke Write Update Bad Origin",
              dryRunReviewed: true,
              confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_update_write_origin_response");
      },
    },
    {
      name: "recipient update write validation failures are redacted",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/write/update",
          {
            ...authedOptions,
            method: "POST",
            body: {
              name: "Smoke Write Missing Id",
              dryRunReviewed: true,
              confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
            },
          },
        );
        expectStatus(status, 400);
        expect(json.code === "id_required", "update_write_missing_id_code_missing");
        expectSafeCreateUpdateWriteShape(json, "update");
        expect(json.sqliteMutated === false, "update_write_validation_mutated");
        expect(json.rowsChanged === 0, "update_write_validation_rows_changed");
      },
    },
    ...(!allowRecipientCreateUpdateWriteSmoke
      ? [
          {
            name: "recipient update write default smoke does not mutate",
            run: async () => {
              const targetId = sampledRecipientId ?? 1;
              const { status, json } = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: targetId,
                    name: "Smoke Write Disabled Update",
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(status, 403);
              expect(
                json.code === "recipient_create_update_writes_disabled",
                "update_write_disabled_code_missing",
              );
              expectSafeCreateUpdateWriteShape(json, "update");
              expect(json.sqliteMutated === false, "default_update_write_mutated");
              expect(json.rowsChanged === 0, "default_update_write_rows_changed");

              const listResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listResponse.status, 200);
              expect(
                countFromListResponse(listResponse.json) === recipientCountBeforeDryRun,
                "default_update_write_changed_recipient_count",
              );
              expect(
                listResponseFingerprint(listResponse.json) === recipientFingerprintBeforeDryRun,
                "default_update_write_changed_recipient_sample",
              );
            },
          },
        ]
      : []),
    {
      name: "recipient delete and merge writes are not implemented",
      run: async () => {
        for (const action of ["delete", "merge"] as const) {
          const { status } = await requestJson(
            baseUrl,
            `/prototype/repositories/recipients/write/${action}`,
            {
              ...authedOptions,
              method: "POST",
              body: { id: 1 },
            },
          );
          expectStatus(status, 404);
        }
      },
    },
    ...(allowRecipientCreateUpdateWriteSmoke
      ? [
          {
            name: "recipient create/update write opt-in smoke mutates disposable rows only",
            run: async () => {
              expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
              const recipientBaselineCount = recipientCountBeforeDryRun as number;
              createUpdateSmokeSequence += 1;
              const createValues = [
                `Smoke Write Created Recipient ${createUpdateSmokeSequence}`,
                `Smoke Write Created Alias ${createUpdateSmokeSequence}`,
                `smoke-write-${createUpdateSmokeSequence}@example.invalid`,
                `555${createUpdateSmokeSequence}`,
                `91${createUpdateSmokeSequence}`,
                `81${createUpdateSmokeSequence}`,
                `71${createUpdateSmokeSequence}`,
                `Smoke Write Created Description ${createUpdateSmokeSequence}`,
              ];

              const createDryRunResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/dry-run/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    name: createValues[0],
                    aliases: createValues[1],
                    email: createValues[2],
                    phone: createValues[3],
                    tillNumber: createValues[4],
                    paybill: createValues[5],
                    accountNumber: createValues[6],
                    description: createValues[7],
                  },
                },
              );
              expectStatus(createDryRunResponse.status, 200);
              expect(createDryRunResponse.json.ok === true, "create_write_dry_run_failed");
              expectDryRunSafety(createDryRunResponse.json, "create");

              const createWriteResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    name: createValues[0],
                    aliases: createValues[1],
                    email: createValues[2],
                    phone: createValues[3],
                    tillNumber: createValues[4],
                    paybill: createValues[5],
                    accountNumber: createValues[6],
                    description: createValues[7],
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(createWriteResponse.status, 200);
              expect(createWriteResponse.json.ok === true, "create_write_should_pass");
              expectSafeCreateUpdateWriteShape(createWriteResponse.json, "create");
              expect(createWriteResponse.json.sqliteMutated === true, "create_write_did_not_mutate");
              expect(createWriteResponse.json.rowsChanged === 1, "create_write_changed_wrong_row_count");
              expectNoSensitiveEcho(createWriteResponse.json, createValues);
              const targetId = createWriteResponse.json.targetId;
              expect(typeof targetId === "number", "create_write_target_id_missing");
              createdRecipientId = targetId as number;

              const createdDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${createdRecipientId}`,
                authedOptions,
              );
              expectStatus(createdDetailResponse.status, 200);
              const createdRecipient = recipientDetail(createdDetailResponse.json);
              expect(createdRecipient.id === createdRecipientId, "create_write_read_id_mismatch");
              expect(createdRecipient.isActive === 1 || createdRecipient.isActive === true, "created_recipient_not_active");
              const createdAt = createdRecipient.createdAt;
              const firstUpdatedAt = createdRecipient.updatedAt;
              expect(typeof createdAt === "string", "created_at_missing_after_create");
              expect(typeof firstUpdatedAt === "string", "updated_at_missing_after_create");

              const listAfterCreate = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listAfterCreate.status, 200);
              expect(
                countFromListResponse(listAfterCreate.json) === recipientBaselineCount + 1,
                "create_write_did_not_increment_recipient_count",
              );

              createUpdateSmokeSequence += 1;
              const updateValues = [
                `Smoke Write Updated Recipient ${createUpdateSmokeSequence}`,
                `Smoke Write Updated Alias ${createUpdateSmokeSequence}`,
                `smoke-write-update-${createUpdateSmokeSequence}@example.invalid`,
                `556${createUpdateSmokeSequence}`,
                `92${createUpdateSmokeSequence}`,
                `82${createUpdateSmokeSequence}`,
                `72${createUpdateSmokeSequence}`,
                `Smoke Write Updated Description ${createUpdateSmokeSequence}`,
              ];

              const updateDryRunResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/dry-run/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: createdRecipientId,
                    name: updateValues[0],
                    aliases: updateValues[1],
                    email: updateValues[2],
                    phone: updateValues[3],
                    tillNumber: updateValues[4],
                    paybill: updateValues[5],
                    accountNumber: updateValues[6],
                    description: updateValues[7],
                  },
                },
              );
              expectStatus(updateDryRunResponse.status, 200);
              expect(updateDryRunResponse.json.ok === true, "update_write_dry_run_failed");
              expectDryRunSafety(updateDryRunResponse.json, "update");

              const updateWriteResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: createdRecipientId,
                    name: updateValues[0],
                    aliases: updateValues[1],
                    email: updateValues[2],
                    phone: updateValues[3],
                    tillNumber: updateValues[4],
                    paybill: updateValues[5],
                    accountNumber: updateValues[6],
                    description: updateValues[7],
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(updateWriteResponse.status, 200);
              expect(updateWriteResponse.json.ok === true, "update_write_should_pass");
              expectSafeCreateUpdateWriteShape(updateWriteResponse.json, "update");
              expect(updateWriteResponse.json.sqliteMutated === true, "update_write_did_not_mutate");
              expect(updateWriteResponse.json.rowsChanged === 1, "update_write_changed_wrong_row_count");
              expectNoSensitiveEcho(updateWriteResponse.json, [...createValues, ...updateValues]);

              const updatedDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${createdRecipientId}`,
                authedOptions,
              );
              expectStatus(updatedDetailResponse.status, 200);
              const updatedRecipient = recipientDetail(updatedDetailResponse.json);
              expect(updatedRecipient.id === createdRecipientId, "update_write_read_id_mismatch");
              expect(updatedRecipient.createdAt === createdAt, "update_write_changed_created_at");
              expect(updatedRecipient.updatedAt !== firstUpdatedAt, "update_write_did_not_change_updated_at");
              expect(
                updatedRecipient.isActive === createdRecipient.isActive,
                "update_write_changed_active_state",
              );

              const listAfterUpdate = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(listAfterUpdate.status, 200);
              expect(
                countFromListResponse(listAfterUpdate.json) === recipientBaselineCount + 1,
                "update_write_changed_recipient_count",
              );
            },
          },
        ]
      : []),
    ...(allowRecipientActivateWriteSmoke
      ? [
          {
            name: "recipient activate write opt-in smoke mutates exactly one disposable row",
            run: async () => {
              expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
              const recipientBaselineCount = recipientCountBeforeDryRun as number;
              if (inactiveRecipientId === undefined) {
                throw new Error("inactive_recipient_required_for_opt_in_write_smoke");
              }

              const beforeDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${inactiveRecipientId}`,
                authedOptions,
              );
              expectStatus(beforeDetailResponse.status, 200);
              const beforeRecipient = recipientDetail(beforeDetailResponse.json);
              const targetName =
                typeof beforeRecipient.name === "string" ? beforeRecipient.name : undefined;
              expect(
                beforeRecipient.isActive === 0 || beforeRecipient.isActive === false,
                "activate_write_target_not_inactive",
              );

              const dryRunResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/dry-run/activate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: { id: inactiveRecipientId },
                },
              );
              expectStatus(dryRunResponse.status, 200);
              expect(dryRunResponse.json.ok === true, "activate_write_dry_run_failed");
              expectDryRunSafety(dryRunResponse.json, "activate");

              const writeResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/activate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: inactiveRecipientId,
                    expectedIsActive: false,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(writeResponse.status, 200);
              expect(writeResponse.json.ok === true, "activate_write_should_pass");
              expectSafeActiveStateWriteShape(writeResponse.json, "activate");
              expect(writeResponse.json.sqliteMutated === true, "activate_write_did_not_mutate");
              expect(writeResponse.json.rowsChanged === 1, "activate_write_changed_wrong_row_count");
              expectNoSensitiveEcho(writeResponse.json, [targetName]);

              const afterDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${inactiveRecipientId}`,
                authedOptions,
              );
              expectStatus(afterDetailResponse.status, 200);
              const afterRecipient = recipientDetail(afterDetailResponse.json);
              expect(
                afterRecipient.isActive === 1 || afterRecipient.isActive === true,
                "activate_write_read_endpoint_not_active",
              );
              expectRecipientRowsOnlyDifferByActiveState(beforeRecipient, afterRecipient);

              const afterListResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(afterListResponse.status, 200);
              expect(
                countFromListResponse(afterListResponse.json) ===
                  recipientBaselineCount + (createdRecipientId !== undefined ? 1 : 0),
                "activate_write_changed_recipient_count",
              );

              const repeatResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/activate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: inactiveRecipientId,
                    expectedIsActive: false,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(repeatResponse.status, 200);
              expectSafeActiveStateWriteShape(repeatResponse.json, "activate");
              expect(repeatResponse.json.sqliteMutated === false, "activate_repeat_mutated");
              expect(repeatResponse.json.rowsChanged === 0, "activate_repeat_rows_changed");
              expect(
                Array.isArray(repeatResponse.json.warnings) &&
                  (repeatResponse.json.warnings as unknown[]).includes("recipient_already_active"),
                "activate_repeat_noop_warning_missing",
              );
            },
          },
        ]
      : []),
    ...(allowRecipientDeactivateWriteSmoke
      ? [
          {
            name: "recipient deactivate write opt-in smoke mutates exactly one disposable row",
            run: async () => {
              expect(recipientCountBeforeDryRun !== undefined, "recipient_baseline_count_missing");
              const recipientBaselineCount = recipientCountBeforeDryRun as number;
              if (activeRecipientId === undefined) {
                throw new Error("active_recipient_required_for_opt_in_write_smoke");
              }

              const beforeDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${activeRecipientId}`,
                authedOptions,
              );
              expectStatus(beforeDetailResponse.status, 200);
              const beforeRecipient = recipientDetail(beforeDetailResponse.json);
              const targetName =
                typeof beforeRecipient.name === "string" ? beforeRecipient.name : undefined;
              expect(
                beforeRecipient.isActive === 1 || beforeRecipient.isActive === true,
                "deactivate_write_target_not_active",
              );

              const dryRunResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/dry-run/deactivate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: { id: activeRecipientId },
                },
              );
              expectStatus(dryRunResponse.status, 200);
              expect(dryRunResponse.json.ok === true, "deactivate_write_dry_run_failed");
              expectDryRunSafety(dryRunResponse.json, "deactivate");

              const writeResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/deactivate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: activeRecipientId,
                    expectedIsActive: true,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(writeResponse.status, 200);
              expect(writeResponse.json.ok === true, "deactivate_write_should_pass");
              expectSafeActiveStateWriteShape(writeResponse.json, "deactivate");
              expect(writeResponse.json.sqliteMutated === true, "deactivate_write_did_not_mutate");
              expect(writeResponse.json.rowsChanged === 1, "deactivate_write_changed_wrong_row_count");
              expectNoSensitiveEcho(writeResponse.json, [targetName]);

              const afterDetailResponse = await requestJson(
                baseUrl,
                `/prototype/repositories/recipients/${activeRecipientId}`,
                authedOptions,
              );
              expectStatus(afterDetailResponse.status, 200);
              const afterRecipient = recipientDetail(afterDetailResponse.json);
              expect(
                afterRecipient.isActive === 0 || afterRecipient.isActive === false,
                "deactivate_write_read_endpoint_not_inactive",
              );
              expectRecipientRowsOnlyDifferByActiveState(beforeRecipient, afterRecipient);

              const afterListResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients?limit=500",
                authedOptions,
              );
              expectStatus(afterListResponse.status, 200);
              expect(
                countFromListResponse(afterListResponse.json) ===
                  recipientBaselineCount + (createdRecipientId !== undefined ? 1 : 0),
                "deactivate_write_changed_recipient_count",
              );

              const repeatResponse = await requestJson(
                baseUrl,
                "/prototype/repositories/recipients/write/deactivate",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: activeRecipientId,
                    expectedIsActive: true,
                    dryRunReviewed: true,
                    confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(repeatResponse.status, 200);
              expectSafeActiveStateWriteShape(repeatResponse.json, "deactivate");
              expect(repeatResponse.json.sqliteMutated === false, "deactivate_repeat_mutated");
              expect(repeatResponse.json.rowsChanged === 0, "deactivate_repeat_rows_changed");
              expect(
                Array.isArray(repeatResponse.json.warnings) &&
                  (repeatResponse.json.warnings as unknown[]).includes("recipient_already_inactive"),
                "deactivate_repeat_noop_warning_missing",
              );
            },
          },
        ]
      : []),
    {
      name: "recipient delete dry-run is not implemented",
      run: async () => {
        const { status } = await requestJson(
          baseUrl,
          "/prototype/repositories/recipients/dry-run/delete",
          {
            ...authedOptions,
            method: "POST",
            body: { id: 1 },
          },
        );
        expectStatus(status, 404);
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
  const checks = buildChecks(
    args.baseUrl,
    token,
    args.origin,
    args.allowRecipientActivateWriteSmoke,
    args.allowRecipientDeactivateWriteSmoke,
    args.allowRecipientCreateUpdateWriteSmoke,
  );
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

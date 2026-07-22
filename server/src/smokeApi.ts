import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDirectRun } from "./lib/cli.js";
import {
  TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION,
  TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION,
} from "./lib/transactionBasicWrite.js";
import {
  TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION,
  TRANSACTION_TRANSFER_UPDATE_WRITE_CONFIRMATION,
} from "./lib/transactionTransferWrite.js";
import { SMS_TEMPLATE_WRITE_CONFIRMATIONS } from "./lib/smsTemplateWrite.js";
import {
  BUDGET_DEFINITION_CREATE_CONFIRMATION,
  BUDGET_DEFINITION_UPDATE_CONFIRMATION,
} from "./lib/budgetDefinitionWrite.js";
import { budgetGoalDirectionNormalizationSanityCheck } from "./lib/budgetDefinitionDryRun.js";
import {
  BUDGET_SNAPSHOT_GENERATION_CONFIRMATION,
} from "./lib/budgetSnapshotGenerationWrite.js";
import {
  calculateBudgetOccurrenceSchedule,
  calculateMissingBudgetSnapshotPlan,
  effectiveGoalDirection,
  localDayKey,
  type BudgetGenerationDefinition,
  type ExistingSnapshotIdentity,
} from "../shared/budgetSnapshotGeneration.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3147";
const TOKEN_HEADER_NAME = "x-personal-finance-token";
const DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173";
const RECIPIENT_ACTIVATE_WRITE_CONFIRMATION = "activate recipient in disposable sqlite";
const RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION = "deactivate recipient in disposable sqlite";
const RECIPIENT_CREATE_WRITE_CONFIRMATION = "create recipient in disposable sqlite";
const RECIPIENT_UPDATE_WRITE_CONFIRMATION = "update recipient in disposable sqlite";
const BUCKET_CREATE_WRITE_CONFIRMATION = "create bucket in disposable sqlite";
const BUCKET_UPDATE_WRITE_CONFIRMATION = "update bucket in disposable sqlite";
const CATEGORY_CREATE_WRITE_CONFIRMATION = "create category in disposable sqlite";
const CATEGORY_UPDATE_WRITE_CONFIRMATION = "update category in disposable sqlite";
const ACCOUNT_CREATE_WRITE_CONFIRMATION = "create account in disposable sqlite";
const ACCOUNT_UPDATE_WRITE_CONFIRMATION = "update account in disposable sqlite";

interface SmokeArgs {
  baseUrl: string;
  token?: string;
  tokenFile?: string;
  origin?: string;
  allowRecipientActivateWriteSmoke: boolean;
  allowRecipientDeactivateWriteSmoke: boolean;
  allowRecipientCreateUpdateWriteSmoke: boolean;
  allowBucketCategoryWriteSmoke: boolean;
  allowAccountWriteSmoke: boolean;
  allowTransactionBasicWriteSmoke: boolean;
  allowTransactionCostBudgetWriteSmoke: boolean;
  allowTransactionTransferWriteSmoke: boolean;
  allowSmsTemplateWriteSmoke: boolean;
  allowBudgetDefinitionWriteSmoke: boolean;
  allowBudgetSnapshotGenerationWriteSmoke: boolean;
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
  entity?: unknown;
  dryRun?: unknown;
  wouldMutate?: unknown;
  dryRunRequired?: unknown;
  realWrite?: unknown;
  sqliteMutated?: unknown;
  rowsChanged?: unknown;
  rowsInserted?: unknown;
  proposedSnapshotCount?: unknown;
  conflictCount?: unknown;
  targetIdPresent?: unknown;
  targetId?: unknown;
  validationErrors?: unknown;
  warnings?: unknown;
  classification?: unknown;
  foreignKeyPresence?: unknown;
  unsupportedReasons?: unknown;
  financialEffectSummary?: unknown;
  reportEffectSummary?: unknown;
  budgetHistoryEffectSummary?: unknown;
  transactionCostPresence?: unknown;
  transactionCostClassification?: unknown;
  budgetSnapshotLinkagePresence?: unknown;
  budgetLinkageAction?: unknown;
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
  --allow-bucket-category-write-smoke
                         Opt in to disposable SQLite bucket/category create/update write smoke.
  --allow-account-write-smoke
                         Opt in to disposable SQLite account create/update write smoke.
  --allow-transaction-basic-write-smoke
                         Opt in to disposable SQLite basic transaction create/update write smoke.
  --allow-transaction-cost-budget-write-smoke
                         Opt in to disposable SQLite transaction cost/budget-link create/update write smoke.
  --allow-transaction-transfer-write-smoke
                         Opt in to disposable SQLite paired transfer create/update write smoke.
  --allow-sms-template-write-smoke
                         Opt in to disposable SQLite SMS template CRUD write smoke.
  --allow-budget-definition-write-smoke
                         Opt in to disposable SQLite Budget-definition create/update write smoke.
  --allow-budget-snapshot-generation-write-smoke
                         Opt in to deterministic missing Budget snapshot generation smoke.
  --help                 Show this help text.
`;

const parseArgs = (argv: string[]): SmokeArgs => {
  const args: SmokeArgs = {
    baseUrl: DEFAULT_BASE_URL,
    allowRecipientActivateWriteSmoke: false,
    allowRecipientDeactivateWriteSmoke: false,
    allowRecipientCreateUpdateWriteSmoke: false,
    allowBucketCategoryWriteSmoke: false,
    allowAccountWriteSmoke: false,
    allowTransactionBasicWriteSmoke: false,
    allowTransactionCostBudgetWriteSmoke: false,
    allowTransactionTransferWriteSmoke: false,
    allowSmsTemplateWriteSmoke: false,
    allowBudgetDefinitionWriteSmoke: false,
    allowBudgetSnapshotGenerationWriteSmoke: false,
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

    if (arg === "--allow-bucket-category-write-smoke") {
      args.allowBucketCategoryWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-account-write-smoke") {
      args.allowAccountWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-transaction-basic-write-smoke") {
      args.allowTransactionBasicWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-transaction-cost-budget-write-smoke") {
      args.allowTransactionCostBudgetWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-transaction-transfer-write-smoke") {
      args.allowTransactionTransferWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-sms-template-write-smoke") {
      args.allowSmsTemplateWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-budget-definition-write-smoke") {
      args.allowBudgetDefinitionWriteSmoke = true;
      continue;
    }

    if (arg === "--allow-budget-snapshot-generation-write-smoke") {
      args.allowBudgetSnapshotGenerationWriteSmoke = true;
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

const rowsFingerprint = (rows: Record<string, unknown>[]): string =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");

const readAllTableRows = async (
  baseUrl: string,
  table: string,
  options: { token: string; origin?: string },
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  let rowCount = Number.POSITIVE_INFINITY;

  while (offset < rowCount) {
    const response = await requestJson(
      baseUrl,
      `/prototype/sqlite/tables/${table}?limit=200&offset=${offset}`,
      options,
    );
    expectStatus(response.status, 200);
    expect(Array.isArray(response.json.rows), `${table}_rows_missing`);
    expect(typeof response.json.rowCount === "number", `${table}_count_missing`);
    const page = response.json.rows as Record<string, unknown>[];
    rowCount = response.json.rowCount as number;
    rows.push(...page);
    if (page.length === 0) {
      break;
    }
    offset += page.length;
  }

  expect(rows.length === rowCount, `${table}_pagination_incomplete`);
  return rows;
};

const cents = (value: number): number => Math.round(value * 100);

const transactionAggregates = (
  rows: Record<string, unknown>[],
): { accounts: Map<number, number>; months: Map<string, number> } => {
  const accounts = new Map<number, number>();
  const months = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.amount !== "number" || typeof row.date !== "string") {
      throw new Error("transaction_aggregate_input_invalid");
    }
    const netCents = cents(
      row.amount +
        (typeof row.transactionCost === "number" ? row.transactionCost : 0),
    );
    if (typeof row.accountId === "number") {
      accounts.set(row.accountId, (accounts.get(row.accountId) ?? 0) + netCents);
    }
    const month = row.date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + netCents);
  }
  return { accounts, months };
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

const expectSafeBucketCategoryShape = (
  json: ResponseJson,
  entity: "bucket" | "category",
  action: "create" | "update",
  dryRun: boolean,
): void => {
  expect(json.entity === entity, "unexpected_bucket_category_entity");
  expect(json.action === action, "unexpected_bucket_category_action");
  if (dryRun) {
    expect(json.dryRun === true, "bucket_category_dry_run_flag_missing");
    expect(json.wouldMutate === false, "bucket_category_dry_run_would_mutate");
  } else {
    expect(json.dryRunRequired === true, "bucket_category_dry_run_required_missing");
    expect(json.realWrite === true, "bucket_category_real_write_flag_missing");
    expect(
      typeof json.sqliteMutated === "boolean",
      "bucket_category_sqlite_mutated_flag_missing",
    );
    expect(typeof json.rowsChanged === "number", "bucket_category_rows_changed_missing");
  }
  expect(typeof json.normalizedFieldPresence === "object", "bucket_category_fields_missing");
  expect(typeof json.duplicateSummary === "object", "bucket_category_duplicates_missing");
  expect(typeof json.timestampBehavior === "object", "bucket_category_timestamps_missing");
  expect(typeof json.affectedSummary === "object", "bucket_category_affected_missing");
  expect(typeof json.safety === "object", "bucket_category_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "bucket_category_dexie_mutation_reported");
  expect(safety.filesWritten === false, "bucket_category_file_write_reported");
  expect(safety.relatedRecordsMutated === false, "bucket_category_related_mutation_reported");
  expect(safety.rawRowsIncluded === false, "bucket_category_raw_rows_reported");
};

const expectSafeAccountShape = (
  json: ResponseJson,
  action: "create" | "update",
  dryRun: boolean,
): void => {
  expect(json.entity === "account", "unexpected_account_entity");
  expect(json.action === action, "unexpected_account_action");
  if (dryRun) {
    expect(json.dryRun === true, "account_dry_run_flag_missing");
    expect(json.wouldMutate === false, "account_dry_run_would_mutate");
  } else {
    expect(json.dryRunRequired === true, "account_dry_run_required_missing");
    expect(json.realWrite === true, "account_real_write_flag_missing");
    expect(typeof json.sqliteMutated === "boolean", "account_mutation_flag_missing");
    expect(typeof json.rowsChanged === "number", "account_rows_changed_missing");
  }
  expect(typeof json.normalizedFieldPresence === "object", "account_fields_missing");
  expect(typeof json.duplicateSummary === "object", "account_duplicates_missing");
  expect(typeof json.timestampBehavior === "object", "account_timestamps_missing");
  expect(typeof json.financialSignificance === "object", "account_financial_summary_missing");
  expect(typeof json.affectedSummary === "object", "account_affected_missing");
  expect(typeof json.safety === "object", "account_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "account_dexie_mutation_reported");
  expect(safety.filesWritten === false, "account_file_write_reported");
  expect(safety.relatedRecordsMutated === false, "account_related_mutation_reported");
  expect(safety.rawRowsIncluded === false, "account_raw_rows_reported");
};

const expectSafeTransactionBasicShape = (
  json: ResponseJson,
  action: "create" | "update",
  dryRun: boolean,
): void => {
  expect(json.entity === "transaction", "unexpected_transaction_entity");
  expect(json.action === action, "unexpected_transaction_action");
  if (dryRun) {
    expect(json.dryRun === true, "transaction_dry_run_flag_missing");
    expect(json.wouldMutate === false, "transaction_dry_run_would_mutate");
  } else {
    expect(json.dryRunRequired === true, "transaction_dry_run_required_missing");
    expect(json.realWrite === true, "transaction_real_write_flag_missing");
    expect(
      typeof json.sqliteMutated === "boolean",
      "transaction_mutation_flag_missing",
    );
    expect(typeof json.rowsChanged === "number", "transaction_rows_changed_missing");
  }
  expect(
    json.classification === null ||
      json.classification === "income" ||
      json.classification === "expense",
    "transaction_classification_invalid",
  );
  expect(typeof json.foreignKeyPresence === "object", "transaction_fk_summary_missing");
  expect(Array.isArray(json.unsupportedReasons), "transaction_unsupported_missing");
  expect(
    typeof json.financialEffectSummary === "object",
    "transaction_financial_summary_missing",
  );
  expect(
    typeof json.reportEffectSummary === "object",
    "transaction_report_summary_missing",
  );
  expect(
    typeof json.budgetHistoryEffectSummary === "object",
    "transaction_budget_history_summary_missing",
  );
  expect(
    typeof json.transactionCostPresence === "boolean",
    "transaction_cost_presence_missing",
  );
  expect(
    json.transactionCostClassification === "none" ||
      json.transactionCostClassification === "zero" ||
      json.transactionCostClassification === "negative",
    "transaction_cost_classification_invalid",
  );
  expect(
    typeof json.budgetSnapshotLinkagePresence === "boolean",
    "transaction_budget_link_presence_missing",
  );
  expect(
    ["none", "preserve", "link", "change", "unlink"].includes(
      String(json.budgetLinkageAction),
    ),
    "transaction_budget_link_action_invalid",
  );
  expect(typeof json.timestampBehavior === "object", "transaction_timestamps_missing");
  expect(typeof json.affectedSummary === "object", "transaction_affected_missing");
  expect(typeof json.safety === "object", "transaction_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "transaction_dexie_mutation_reported");
  expect(safety.filesWritten === false, "transaction_file_write_reported");
  expect(
    safety.relatedRecordsMutated === false,
    "transaction_related_mutation_reported",
  );
  expect(safety.rawRowsIncluded === false, "transaction_raw_rows_reported");
};

const expectSafeTransactionTransferShape = (
  json: ResponseJson,
  action: "create" | "update",
  dryRun: boolean,
): void => {
  expect(json.entity === "transfer", "unexpected_transfer_entity");
  expect(json.action === action, "unexpected_transfer_action");
  if (dryRun) {
    expect(json.dryRun === true, "transfer_dry_run_flag_missing");
    expect(json.wouldMutate === false, "transfer_dry_run_would_mutate");
  } else {
    expect(json.realWrite === true, "transfer_real_write_flag_missing");
    expect(
      typeof json.sqliteMutated === "boolean",
      "transfer_mutation_flag_missing",
    );
    expect(typeof json.rowsChanged === "number", "transfer_rows_changed_missing");
  }
  expect(
    typeof json.financialEffectSummary === "object",
    "transfer_financial_summary_missing",
  );
  expect(typeof json.timestampBehavior === "object", "transfer_timestamps_missing");
  expect(typeof json.safety === "object", "transfer_safety_missing");
  const safety = json.safety as Record<string, unknown>;
  expect(safety.dexieMutated === false, "transfer_dexie_mutation_reported");
  expect(safety.filesWritten === false, "transfer_file_write_reported");
  expect(
    safety.relatedRecordsMutated === false,
    "transfer_related_mutation_reported",
  );
  expect(safety.rawRowsIncluded === false, "transfer_raw_rows_reported");
};

const detailRow = (
  json: ResponseJson,
  key: "account" | "bucket" | "category",
): Record<string, unknown> => {
  const row = json[key];
  expect(
    typeof row === "object" && row !== null && !Array.isArray(row),
    `${key}_detail_missing`,
  );
  return row as Record<string, unknown>;
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

const sqliteBudgetRowsForGeneration = (
  rows: Record<string, unknown>[],
): BudgetGenerationDefinition[] =>
  rows.map((row) => ({
    id: Number(row.id),
    description: String(row.description),
    categoryId: Number(row.categoryId),
    accountId: row.accountId == null ? null : Number(row.accountId),
    recipientId: row.recipientId == null ? null : Number(row.recipientId),
    amount: Number(row.amount),
    transactionCost:
      row.transactionCost == null ? null : Number(row.transactionCost),
    frequency: row.frequency as BudgetGenerationDefinition["frequency"],
    frequencyDetails:
      typeof row.frequencyDetails === "string" && row.frequencyDetails
        ? (JSON.parse(row.frequencyDetails) as BudgetGenerationDefinition["frequencyDetails"])
        : null,
    isGoal: Number(row.isGoal),
    isFlexible: row.isFlexible == null ? false : Number(row.isFlexible),
    goalPercentage:
      row.goalPercentage == null ? null : Number(row.goalPercentage),
    goalDirection:
      row.goalDirection == null
        ? null
        : (row.goalDirection as BudgetGenerationDefinition["goalDirection"]),
    isActive: Number(row.isActive),
    remainingCyclesTotal:
      row.remainingCyclesTotal == null
        ? null
        : Number(row.remainingCyclesTotal),
    dueDate: String(row.dueDate),
    updatedAt: String(row.updatedAt),
  }));

const sqliteSnapshotIdentities = (
  rows: Record<string, unknown>[],
): ExistingSnapshotIdentity[] =>
  rows.map((row) => ({
    id: Number(row.id),
    budgetId: Number(row.budgetId),
    occurrenceDate: String(row.occurrenceDate),
    dueDate: String(row.dueDate),
  }));

const generatedSnapshotComparable = (row: Record<string, unknown>) => ({
  budgetId: Number(row.budgetId),
  occurrenceDate: localDayKey(String(row.occurrenceDate)),
  dueDate: localDayKey(String(row.dueDate)),
  cycleIndex: Number(row.cycleIndex),
  description: String(row.description),
  categoryId: Number(row.categoryId),
  accountId: row.accountId == null ? null : Number(row.accountId),
  recipientId: row.recipientId == null ? null : Number(row.recipientId),
  amount: Number(row.amount),
  transactionCost:
    row.transactionCost == null ? null : Number(row.transactionCost),
  frequency: String(row.frequency),
  frequencyDetails:
    typeof row.frequencyDetails === "string" && row.frequencyDetails
      ? JSON.parse(row.frequencyDetails)
      : null,
  isGoal: Number(row.isGoal) === 1,
  isFlexible: Number(row.isFlexible) === 1,
  goalPercentage:
    row.goalPercentage == null ? null : Number(row.goalPercentage),
  goalDirection: row.goalDirection ?? null,
  remainingCyclesTotal:
    row.remainingCyclesTotal == null ? null : Number(row.remainingCyclesTotal),
  isHistorical: Number(row.isHistorical) === 1,
  sourceBudgetUpdatedAt: String(row.sourceBudgetUpdatedAt),
});

const buildChecks = (
  baseUrl: string,
  token: string,
  origin: string | undefined,
  allowRecipientActivateWriteSmoke: boolean,
  allowRecipientDeactivateWriteSmoke: boolean,
  allowRecipientCreateUpdateWriteSmoke: boolean,
  allowBucketCategoryWriteSmoke: boolean,
  allowAccountWriteSmoke: boolean,
  allowTransactionBasicWriteSmoke: boolean,
  allowTransactionCostBudgetWriteSmoke: boolean,
  allowTransactionTransferWriteSmoke: boolean,
  allowSmsTemplateWriteSmoke: boolean,
  allowBudgetDefinitionWriteSmoke: boolean,
  allowBudgetSnapshotGenerationWriteSmoke: boolean,
): SmokeCheck[] => {
  const authedOptions = { token, origin };
  const allowedPreflightOrigin = origin ?? DEFAULT_ALLOWED_ORIGIN;
  const expectedEnabledCapabilities = new Set<string>([
    ...(allowRecipientActivateWriteSmoke || allowRecipientDeactivateWriteSmoke
      ? ["recipientActiveStateWrites"]
      : []),
    ...(allowRecipientCreateUpdateWriteSmoke
      ? ["recipientCreateUpdateWrites"]
      : []),
    ...(allowBucketCategoryWriteSmoke ? ["bucketCategoryWrites"] : []),
    ...(allowAccountWriteSmoke ? ["accountWrites"] : []),
    ...(allowTransactionBasicWriteSmoke ||
    allowTransactionCostBudgetWriteSmoke ||
    allowTransactionTransferWriteSmoke
      ? ["transactionBasicWrites"]
      : []),
    ...(allowTransactionCostBudgetWriteSmoke
      ? ["transactionCostBudgetWrites"]
      : []),
    ...(allowTransactionTransferWriteSmoke
      ? ["transactionTransferWrites"]
      : []),
    ...(allowSmsTemplateWriteSmoke ? ["smsTemplateWrites"] : []),
    ...(allowBudgetDefinitionWriteSmoke ? ["budgetDefinitionWrites"] : []),
    ...(allowBudgetSnapshotGenerationWriteSmoke
      ? ["budgetSnapshotGenerationWrites"]
      : []),
  ]);
  const writeCapabilityKeys = [
    "recipientActiveStateWrites",
    "recipientCreateUpdateWrites",
    "bucketCategoryWrites",
    "accountWrites",
    "transactionBasicWrites",
    "transactionCostBudgetWrites",
    "transactionTransferWrites",
    "smsTemplateWrites",
    "budgetDefinitionWrites",
    "budgetSnapshotGenerationWrites",
  ] as const;
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
  const bucketCategorySmokeSequence = Date.now();
  const accountSmokeSequence = Date.now();
  const transactionSmokeSequence = Date.now();
  const smsTemplateSmokeSequence = Date.now();
  const budgetDefinitionSmokeSequence = Date.now();
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
      name: "write capabilities fail without token",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/write-capabilities",
        );
        expectStatus(status, 401);
        expect(json.error === "unauthorized", "unexpected_capabilities_unauthorized_response");
      },
    },
    {
      name: "write capabilities reject unexpected origin",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/write-capabilities",
          {
            token,
            origin: "http://unexpected-origin.invalid",
          },
        );
        expectStatus(status, 403);
        expect(json.error === "forbidden_origin", "unexpected_capabilities_origin_response");
      },
    },
    {
      name: "write capabilities are protected read-only and redacted",
      run: async () => {
        const { status, json } = await requestJson(
          baseUrl,
          "/prototype/write-capabilities",
          authedOptions,
        );
        expectStatus(status, 200);
        expect(json.ok === true, "write_capabilities_not_ok");
        expect(json.storageMode === "sqlite-disposable", "unexpected_storage_mode");
        expect(json.authoritative === false, "unexpected_authoritative_mode");
        expect(typeof json.capabilities === "object", "capabilities_missing");
        expect(Array.isArray(json.unsupportedOperations), "unsupported_operations_missing");
        expect(typeof json.safety === "object", "capabilities_safety_missing");

        const capabilities = json.capabilities as Record<string, unknown>;
        for (const key of writeCapabilityKeys) {
          expect(typeof capabilities[key] === "boolean", `capability_${key}_invalid`);
        }

        const safety = json.safety as Record<string, unknown>;
        expect(safety.endpointReadOnly === true, "capabilities_endpoint_not_read_only");
        expect(safety.dexieAccessed === false, "capabilities_dexie_access_reported");
        expect(safety.filesWritten === false, "capabilities_file_write_reported");

        if (expectedEnabledCapabilities.size === 0) {
          for (const key of writeCapabilityKeys) {
            expect(capabilities[key] === false, `default_capability_${key}_enabled`);
          }
        } else {
          for (const key of expectedEnabledCapabilities) {
            expect(capabilities[key] === true, `expected_capability_${key}_disabled`);
          }
        }

        const serialized = JSON.stringify(json);
        expect(!serialized.includes(token), "capabilities_echoed_token");
        for (const forbiddenKey of [
          "sqlitePath",
          "backupPath",
          "filePath",
          "token",
          "environment",
        ]) {
          expect(!serialized.includes(forbiddenKey), `capabilities_exposed_${forbiddenKey}`);
        }
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
      name: "bucket/category dry-run and write routes require token",
      run: async () => {
        for (const resource of ["buckets", "categories"] as const) {
          for (const mode of ["dry-run", "write"] as const) {
            for (const action of ["create", "update"] as const) {
              const { status, json } = await requestJson(
                baseUrl,
                `/prototype/repositories/${resource}/${mode}/${action}`,
                { method: "POST", body: {} },
              );
              expectStatus(status, 401);
              expect(json.error === "unauthorized", "bucket_category_route_not_protected");
            }
          }
        }
      },
    },
    {
      name: "bucket/category dry-run and write routes reject bad origin",
      run: async () => {
        for (const resource of ["buckets", "categories"] as const) {
          for (const mode of ["dry-run", "write"] as const) {
            for (const action of ["create", "update"] as const) {
              const { status, json } = await requestJson(
                baseUrl,
                `/prototype/repositories/${resource}/${mode}/${action}`,
                {
                  method: "POST",
                  token,
                  origin: "http://unexpected-origin.invalid",
                  body: {},
                },
              );
              expectStatus(status, 403);
              expect(json.error === "forbidden_origin", "bucket_category_bad_origin_allowed");
            }
          }
        }
      },
    },
    {
      name: "bucket/category routes reject invalid and unexpected payloads safely",
      run: async () => {
        for (const resource of ["buckets", "categories"] as const) {
          for (const mode of ["dry-run", "write"] as const) {
            for (const action of ["create", "update"] as const) {
              const route = `/prototype/repositories/${resource}/${mode}/${action}`;
              const invalidResponse = await requestJson(baseUrl, route, {
                ...authedOptions,
                method: "POST",
                body: [],
              });
              expectStatus(invalidResponse.status, 400);
              expect(
                invalidResponse.json.code === "payload_must_be_object",
                "bucket_category_invalid_payload_code",
              );

              const unexpectedResponse = await requestJson(baseUrl, route, {
                ...authedOptions,
                method: "POST",
                body: { unexpected: "unexpected-value-must-not-echo" },
              });
              expectStatus(unexpectedResponse.status, 400);
              expect(
                unexpectedResponse.json.code === "unexpected_payload_field",
                "bucket_category_unexpected_field_code",
              );
              expectNoSensitiveEcho(unexpectedResponse.json, [
                "unexpected-value-must-not-echo",
              ]);
            }
          }
        }
      },
    },
    {
      name: "bucket/category dry-runs validate without mutation",
      run: async () => {
        const bucketBefore = await requestJson(
          baseUrl,
          "/prototype/repositories/buckets?limit=500",
          authedOptions,
        );
        const categoryBefore = await requestJson(
          baseUrl,
          "/prototype/repositories/categories?limit=500",
          authedOptions,
        );
        expectStatus(bucketBefore.status, 200);
        expectStatus(categoryBefore.status, 200);
        const bucketId = optionalIdFromListResponse(bucketBefore.json);
        const categoryId = optionalIdFromListResponse(categoryBefore.json);
        const bucketName = `Bucket Dry Run ${bucketCategorySmokeSequence}`;
        const categoryName = `Category Dry Run ${bucketCategorySmokeSequence}`;

        const cases: Array<{
          entity: "bucket" | "category";
          resource: "buckets" | "categories";
          action: "create" | "update";
          body: Record<string, unknown>;
          sensitive: string;
        }> = [
          {
            entity: "bucket",
            resource: "buckets",
            action: "create",
            body: {
              name: bucketName,
              minPercentage: 0,
              maxPercentage: 100,
              excludeFromReports: false,
            },
            sensitive: bucketName,
          },
          ...(bucketId === undefined
            ? []
            : [{
                entity: "bucket" as const,
                resource: "buckets" as const,
                action: "update" as const,
                body: {
                  id: bucketId,
                  name: bucketName,
                  minPercentage: 0,
                  maxPercentage: 100,
                  excludeFromReports: false,
                },
                sensitive: bucketName,
              }]),
          {
            entity: "category",
            resource: "categories",
            action: "create",
            body: {
              name: categoryName,
              bucketId: bucketId ?? 1,
            },
            sensitive: categoryName,
          },
          ...(categoryId === undefined
            ? []
            : [{
                entity: "category" as const,
                resource: "categories" as const,
                action: "update" as const,
                body: {
                  id: categoryId,
                  name: categoryName,
                  bucketId: bucketId ?? 1,
                },
                sensitive: categoryName,
              }]),
        ];

        for (const testCase of cases) {
          const response = await requestJson(
            baseUrl,
            `/prototype/repositories/${testCase.resource}/dry-run/${testCase.action}`,
            { ...authedOptions, method: "POST", body: testCase.body },
          );
          expectStatus(response.status, 200);
          expectSafeBucketCategoryShape(
            response.json,
            testCase.entity,
            testCase.action,
            true,
          );
          expectNoSensitiveEcho(response.json, [testCase.sensitive]);
        }

        const bucketAfter = await requestJson(
          baseUrl,
          "/prototype/repositories/buckets?limit=500",
          authedOptions,
        );
        const categoryAfter = await requestJson(
          baseUrl,
          "/prototype/repositories/categories?limit=500",
          authedOptions,
        );
        expect(
          countFromListResponse(bucketAfter.json) === countFromListResponse(bucketBefore.json) &&
            listResponseFingerprint(bucketAfter.json) === listResponseFingerprint(bucketBefore.json),
          "bucket_dry_run_mutated_rows",
        );
        expect(
          countFromListResponse(categoryAfter.json) === countFromListResponse(categoryBefore.json) &&
            listResponseFingerprint(categoryAfter.json) ===
              listResponseFingerprint(categoryBefore.json),
          "category_dry_run_mutated_rows",
        );
      },
    },
    ...(!allowBucketCategoryWriteSmoke
      ? [
          {
            name: "bucket/category writes are disabled and non-mutating by default",
            run: async () => {
              const bucketBefore = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets?limit=500",
                authedOptions,
              );
              const categoryBefore = await requestJson(
                baseUrl,
                "/prototype/repositories/categories?limit=500",
                authedOptions,
              );
              const bucketId = optionalIdFromListResponse(bucketBefore.json);
              const categoryId = optionalIdFromListResponse(categoryBefore.json);
              const cases = [
                {
                  resource: "buckets",
                  action: "create",
                  body: {
                    name: "Disabled Bucket Create",
                    minPercentage: 0,
                    maxPercentage: 100,
                    excludeFromReports: false,
                    dryRunReviewed: true,
                    confirmation: BUCKET_CREATE_WRITE_CONFIRMATION,
                  },
                },
                ...(bucketId === undefined
                  ? []
                  : [{
                      resource: "buckets",
                      action: "update",
                      body: {
                        id: bucketId,
                        name: "Disabled Bucket Update",
                        minPercentage: 0,
                        maxPercentage: 100,
                        excludeFromReports: false,
                        dryRunReviewed: true,
                        confirmation: BUCKET_UPDATE_WRITE_CONFIRMATION,
                      },
                    }]),
                {
                  resource: "categories",
                  action: "create",
                  body: {
                    name: "Disabled Category Create",
                    bucketId: bucketId ?? 1,
                    dryRunReviewed: true,
                    confirmation: CATEGORY_CREATE_WRITE_CONFIRMATION,
                  },
                },
                ...(categoryId === undefined
                  ? []
                  : [{
                      resource: "categories",
                      action: "update",
                      body: {
                        id: categoryId,
                        name: "Disabled Category Update",
                        bucketId: bucketId ?? 1,
                        dryRunReviewed: true,
                        confirmation: CATEGORY_UPDATE_WRITE_CONFIRMATION,
                      },
                    }]),
              ];

              for (const testCase of cases) {
                const response = await requestJson(
                  baseUrl,
                  `/prototype/repositories/${testCase.resource}/write/${testCase.action}`,
                  { ...authedOptions, method: "POST", body: testCase.body },
                );
                expectStatus(response.status, 403);
                expect(
                  response.json.code === "bucket_category_writes_disabled",
                  "bucket_category_disabled_code_missing",
                );
                expect(response.json.sqliteMutated === false, "disabled_write_mutated");
              }

              const bucketAfter = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets?limit=500",
                authedOptions,
              );
              const categoryAfter = await requestJson(
                baseUrl,
                "/prototype/repositories/categories?limit=500",
                authedOptions,
              );
              expect(
                listResponseFingerprint(bucketAfter.json) ===
                  listResponseFingerprint(bucketBefore.json),
                "disabled_bucket_write_changed_rows",
              );
              expect(
                listResponseFingerprint(categoryAfter.json) ===
                  listResponseFingerprint(categoryBefore.json),
                "disabled_category_write_changed_rows",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "account dry-run and write routes enforce protection and validation",
      run: async () => {
        for (const mode of ["dry-run", "write"] as const) {
          for (const action of ["create", "update"] as const) {
            const route = `/prototype/repositories/accounts/${mode}/${action}`;
            const unauthorized = await requestJson(baseUrl, route, {
              method: "POST",
              body: {},
            });
            expectStatus(unauthorized.status, 401);

            const unexpected = await requestJson(baseUrl, route, {
              ...authedOptions,
              method: "POST",
              body: { unexpected: "account-sensitive-value-must-not-echo" },
            });
            expectStatus(unexpected.status, 400);
            expect(
              unexpected.json.code === "unexpected_payload_field",
              "account_unexpected_field_code",
            );
            expectNoSensitiveEcho(unexpected.json, [
              "account-sensitive-value-must-not-echo",
            ]);
          }
        }

        const badOrigin = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/dry-run/create",
          {
            token,
            origin: "http://unexpected-origin.invalid",
            method: "POST",
            body: {
              name: "Origin Rejection Account",
              currency: "KES",
              isCredit: false,
            },
          },
        );
        expectStatus(badOrigin.status, 403);

        const missingName = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: { currency: "KES", isCredit: false },
          },
        );
        expectStatus(missingName.status, 400);
        expect(
          missingName.json.code === "name_invalid" ||
            missingName.json.code === "name_required",
          "account_missing_name_code",
        );

        const invalidCreditLimit = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: {
              name: "Invalid Credit Account",
              currency: "KES",
              isCredit: true,
              creditLimit: -1,
            },
          },
        );
        expectStatus(invalidCreditLimit.status, 400);
        expect(
          invalidCreditLimit.json.code === "creditLimit_invalid",
          "account_credit_limit_validation_code",
        );

        const unknownUpdate = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: {
              id: 2147483647,
              name: "Unknown Account",
              currency: "KES",
              isCredit: false,
            },
          },
        );
        expectStatus(unknownUpdate.status, 404);
        expect(
          unknownUpdate.json.code === "account_not_found",
          "account_unknown_update_code",
        );
      },
    },
    {
      name: "account create and update dry-runs are redacted and non-mutating",
      run: async () => {
        const accountsBefore = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts?limit=500",
          authedOptions,
        );
        const transactionsBefore = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions?limit=200",
          authedOptions,
        );
        expectStatus(accountsBefore.status, 200);
        expectStatus(transactionsBefore.status, 200);
        const name = `Account Dry Run ${accountSmokeSequence}`;
        const createDryRun = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts/dry-run/create",
          {
            ...authedOptions,
            method: "POST",
            body: {
              name,
              currency: "KES",
              isCredit: true,
              creditLimit: 100,
            },
          },
        );
        expectStatus(createDryRun.status, 200);
        expectSafeAccountShape(createDryRun.json, "create", true);
        expectNoSensitiveEcho(createDryRun.json, [name]);

        const accountId = optionalIdFromListResponse(accountsBefore.json);
        if (accountId !== undefined) {
          const detail = await requestJson(
            baseUrl,
            `/prototype/repositories/accounts/${accountId}`,
            authedOptions,
          );
          expectStatus(detail.status, 200);
          const account = detailRow(detail.json, "account");
          const updateName = `Account Update Dry Run ${accountSmokeSequence}`;
          const updateDryRun = await requestJson(
            baseUrl,
            "/prototype/repositories/accounts/dry-run/update",
            {
              ...authedOptions,
              method: "POST",
              body: {
                id: accountId,
                name: updateName,
                currency:
                  typeof account.currency === "string"
                    ? account.currency
                    : "KES",
                isCredit:
                  account.isCredit === true || account.isCredit === 1,
                creditLimit:
                  typeof account.creditLimit === "number"
                    ? account.creditLimit
                    : undefined,
              },
            },
          );
          expectStatus(updateDryRun.status, 200);
          expectSafeAccountShape(updateDryRun.json, "update", true);
          expectNoSensitiveEcho(updateDryRun.json, [updateName]);
        }

        const accountsAfter = await requestJson(
          baseUrl,
          "/prototype/repositories/accounts?limit=500",
          authedOptions,
        );
        const transactionsAfter = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions?limit=200",
          authedOptions,
        );
        expect(
          countFromListResponse(accountsAfter.json) ===
            countFromListResponse(accountsBefore.json) &&
            listResponseFingerprint(accountsAfter.json) ===
              listResponseFingerprint(accountsBefore.json),
          "account_dry_run_mutated_accounts",
        );
        expect(
          countFromListResponse(transactionsAfter.json) ===
            countFromListResponse(transactionsBefore.json) &&
            listResponseFingerprint(transactionsAfter.json) ===
              listResponseFingerprint(transactionsBefore.json),
          "account_dry_run_mutated_transactions",
        );
      },
    },
    ...(!allowAccountWriteSmoke
      ? [
          {
            name: "account writes are disabled and non-mutating by default",
            run: async () => {
              const accountsBefore = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts?limit=500",
                authedOptions,
              );
              expectStatus(accountsBefore.status, 200);
              const accountId = optionalIdFromListResponse(accountsBefore.json);
              const cases = [
                {
                  action: "create",
                  body: {
                    name: "Disabled Account Create",
                    currency: "KES",
                    isCredit: false,
                    dryRunReviewed: true,
                    confirmation: ACCOUNT_CREATE_WRITE_CONFIRMATION,
                  },
                },
                ...(accountId === undefined
                  ? []
                  : [
                      {
                        action: "update",
                        body: {
                          id: accountId,
                          name: "Disabled Account Update",
                          currency: "KES",
                          isCredit: false,
                          dryRunReviewed: true,
                          confirmation: ACCOUNT_UPDATE_WRITE_CONFIRMATION,
                        },
                      },
                    ]),
              ];

              for (const testCase of cases) {
                const write = await requestJson(
                  baseUrl,
                  `/prototype/repositories/accounts/write/${testCase.action}`,
                  { ...authedOptions, method: "POST", body: testCase.body },
                );
                expectStatus(write.status, 403);
                expect(
                  write.json.code === "account_writes_disabled",
                  "account_disabled_code_missing",
                );
                expect(write.json.sqliteMutated === false, "disabled_account_write_mutated");
                expectNoSensitiveEcho(write.json, [
                  String(testCase.body.name),
                ]);
              }

              const accountsAfter = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts?limit=500",
                authedOptions,
              );
              expect(
                countFromListResponse(accountsAfter.json) ===
                  countFromListResponse(accountsBefore.json) &&
                  listResponseFingerprint(accountsAfter.json) ===
                    listResponseFingerprint(accountsBefore.json),
                "disabled_account_write_changed_rows",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
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
    ...(allowBucketCategoryWriteSmoke
      ? [
          {
            name: "bucket/category opt-in smoke mutates disposable rows only",
            run: async () => {
              const readList = (pathname: string) =>
                requestJson(baseUrl, pathname, authedOptions);
              const bucketsBefore = await readList(
                "/prototype/repositories/buckets?limit=500",
              );
              const categoriesBefore = await readList(
                "/prototype/repositories/categories?limit=500",
              );
              const transactionsBefore = await readList(
                "/prototype/repositories/transactions?limit=200",
              );
              const budgetsBefore = await readList(
                "/prototype/repositories/budgets?limit=500",
              );
              const snapshotsBefore = await readList(
                "/prototype/repositories/budget-snapshots?limit=500",
              );
              for (const response of [
                bucketsBefore,
                categoriesBefore,
                transactionsBefore,
                budgetsBefore,
                snapshotsBefore,
              ]) {
                expectStatus(response.status, 200);
              }

              const bucketName = `SQLite Bucket Smoke ${bucketCategorySmokeSequence}`;
              const bucketUpdatedName = `${bucketName} Updated`;
              const bucketPayload = {
                name: bucketName,
                description: "Disposable smoke bucket",
                minPercentage: 5,
                maxPercentage: 40,
                minFixedAmount: 1,
                excludeFromReports: false,
              };
              const bucketDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets/dry-run/create",
                { ...authedOptions, method: "POST", body: bucketPayload },
              );
              expectStatus(bucketDryRun.status, 200);
              expectSafeBucketCategoryShape(bucketDryRun.json, "bucket", "create", true);
              expectNoSensitiveEcho(bucketDryRun.json, [
                bucketName,
                bucketPayload.description,
              ]);

              const bucketWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...bucketPayload,
                    dryRunReviewed: true,
                    confirmation: BUCKET_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(bucketWrite.status, 200);
              expectSafeBucketCategoryShape(bucketWrite.json, "bucket", "create", false);
              expect(bucketWrite.json.sqliteMutated === true, "bucket_create_did_not_mutate");
              expect(bucketWrite.json.rowsChanged === 1, "bucket_create_wrong_row_count");
              expectNoSensitiveEcho(bucketWrite.json, [
                bucketName,
                bucketPayload.description,
              ]);
              const bucketId = bucketWrite.json.targetId;
              expect(typeof bucketId === "number", "bucket_create_target_id_missing");

              const bucketDetailBeforeUpdate = await requestJson(
                baseUrl,
                `/prototype/repositories/buckets/${bucketId}`,
                authedOptions,
              );
              expectStatus(bucketDetailBeforeUpdate.status, 200);
              const createdBucket = detailRow(bucketDetailBeforeUpdate.json, "bucket");
              expect(createdBucket.name === bucketName, "created_bucket_not_readable");

              const bucketUpdatePayload = {
                id: bucketId,
                name: bucketUpdatedName,
                description: "Disposable smoke bucket updated",
                minPercentage: 10,
                maxPercentage: 50,
                minFixedAmount: 2,
                excludeFromReports: false,
              };
              const bucketUpdateDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets/dry-run/update",
                { ...authedOptions, method: "POST", body: bucketUpdatePayload },
              );
              expectStatus(bucketUpdateDryRun.status, 200);
              expectSafeBucketCategoryShape(
                bucketUpdateDryRun.json,
                "bucket",
                "update",
                true,
              );
              expectNoSensitiveEcho(bucketUpdateDryRun.json, [
                bucketUpdatedName,
                bucketUpdatePayload.description,
              ]);

              const bucketUpdate = await requestJson(
                baseUrl,
                "/prototype/repositories/buckets/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...bucketUpdatePayload,
                    dryRunReviewed: true,
                    confirmation: BUCKET_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(bucketUpdate.status, 200);
              expectSafeBucketCategoryShape(bucketUpdate.json, "bucket", "update", false);
              expect(bucketUpdate.json.rowsChanged === 1, "bucket_update_wrong_row_count");
              expectNoSensitiveEcho(bucketUpdate.json, [
                bucketUpdatedName,
                bucketUpdatePayload.description,
              ]);

              const bucketDetailAfterUpdate = await requestJson(
                baseUrl,
                `/prototype/repositories/buckets/${bucketId}`,
                authedOptions,
              );
              expectStatus(bucketDetailAfterUpdate.status, 200);
              const updatedBucket = detailRow(bucketDetailAfterUpdate.json, "bucket");
              expect(updatedBucket.name === bucketUpdatedName, "updated_bucket_not_readable");
              for (const field of ["id", "isActive", "displayOrder", "createdAt"]) {
                expect(
                  JSON.stringify(updatedBucket[field]) ===
                    JSON.stringify(createdBucket[field]),
                  `bucket_update_changed_immutable_${field}`,
                );
              }

              const categoryName = `SQLite Category Smoke ${bucketCategorySmokeSequence}`;
              const categoryUpdatedName = `${categoryName} Updated`;
              const categoryPayload = {
                name: categoryName,
                bucketId,
                description: "Disposable smoke category",
              };
              const categoryDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/categories/dry-run/create",
                { ...authedOptions, method: "POST", body: categoryPayload },
              );
              expectStatus(categoryDryRun.status, 200);
              expectSafeBucketCategoryShape(categoryDryRun.json, "category", "create", true);
              expectNoSensitiveEcho(categoryDryRun.json, [
                categoryName,
                categoryPayload.description,
              ]);

              const categoryWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/categories/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...categoryPayload,
                    dryRunReviewed: true,
                    confirmation: CATEGORY_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(categoryWrite.status, 200);
              expectSafeBucketCategoryShape(categoryWrite.json, "category", "create", false);
              expect(categoryWrite.json.rowsChanged === 1, "category_create_wrong_row_count");
              expectNoSensitiveEcho(categoryWrite.json, [
                categoryName,
                categoryPayload.description,
              ]);
              const categoryId = categoryWrite.json.targetId;
              expect(typeof categoryId === "number", "category_create_target_id_missing");

              const categoryDetailBeforeUpdate = await requestJson(
                baseUrl,
                `/prototype/repositories/categories/${categoryId}`,
                authedOptions,
              );
              expectStatus(categoryDetailBeforeUpdate.status, 200);
              const createdCategory = detailRow(
                categoryDetailBeforeUpdate.json,
                "category",
              );
              expect(createdCategory.name === categoryName, "created_category_not_readable");

              const categoryUpdatePayload = {
                id: categoryId,
                name: categoryUpdatedName,
                bucketId,
                description: "Disposable smoke category updated",
              };
              const categoryUpdateDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/categories/dry-run/update",
                { ...authedOptions, method: "POST", body: categoryUpdatePayload },
              );
              expectStatus(categoryUpdateDryRun.status, 200);
              expectSafeBucketCategoryShape(
                categoryUpdateDryRun.json,
                "category",
                "update",
                true,
              );

              const categoryUpdate = await requestJson(
                baseUrl,
                "/prototype/repositories/categories/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...categoryUpdatePayload,
                    dryRunReviewed: true,
                    confirmation: CATEGORY_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(categoryUpdate.status, 200);
              expectSafeBucketCategoryShape(
                categoryUpdate.json,
                "category",
                "update",
                false,
              );
              expect(categoryUpdate.json.rowsChanged === 1, "category_update_wrong_row_count");
              expectNoSensitiveEcho(categoryUpdate.json, [
                categoryUpdatedName,
                categoryUpdatePayload.description,
              ]);

              const categoryDetailAfterUpdate = await requestJson(
                baseUrl,
                `/prototype/repositories/categories/${categoryId}`,
                authedOptions,
              );
              expectStatus(categoryDetailAfterUpdate.status, 200);
              const updatedCategory = detailRow(
                categoryDetailAfterUpdate.json,
                "category",
              );
              expect(
                updatedCategory.name === categoryUpdatedName,
                "updated_category_not_readable",
              );
              for (const field of ["id", "isActive", "createdAt"]) {
                expect(
                  JSON.stringify(updatedCategory[field]) ===
                    JSON.stringify(createdCategory[field]),
                  `category_update_changed_immutable_${field}`,
                );
              }

              const bucketsAfter = await readList(
                "/prototype/repositories/buckets?limit=500",
              );
              const categoriesAfter = await readList(
                "/prototype/repositories/categories?limit=500",
              );
              expect(
                countFromListResponse(bucketsAfter.json) ===
                  countFromListResponse(bucketsBefore.json) + 1,
                "bucket_count_did_not_increase_once",
              );
              expect(
                countFromListResponse(categoriesAfter.json) ===
                  countFromListResponse(categoriesBefore.json) + 1,
                "category_count_did_not_increase_once",
              );

              for (const [pathname, before, code] of [
                [
                  "/prototype/repositories/transactions?limit=200",
                  transactionsBefore,
                  "transactions",
                ],
                ["/prototype/repositories/budgets?limit=500", budgetsBefore, "budgets"],
                [
                  "/prototype/repositories/budget-snapshots?limit=500",
                  snapshotsBefore,
                  "budget_snapshots",
                ],
              ] as const) {
                const after = await readList(pathname);
                expectStatus(after.status, 200);
                expect(
                  countFromListResponse(after.json) ===
                    countFromListResponse(before.json),
                  `${code}_count_changed`,
                );
                expect(
                  listResponseFingerprint(after.json) ===
                    listResponseFingerprint(before.json),
                  `${code}_content_changed`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    ...(allowAccountWriteSmoke
      ? [
          {
            name: "account opt-in smoke mutates disposable account rows only",
            run: async () => {
              const read = (pathname: string) =>
                requestJson(baseUrl, pathname, authedOptions);
              const accountsBefore = await read(
                "/prototype/repositories/accounts?limit=500",
              );
              const transactionsBefore = await read(
                "/prototype/repositories/transactions?limit=200",
              );
              const paymentMethodsBefore = await read(
                "/prototype/sqlite/tables/paymentMethods?limit=200",
              );
              const budgetsBefore = await read(
                "/prototype/repositories/budgets?limit=500",
              );
              const snapshotsBefore = await read(
                "/prototype/repositories/budget-snapshots?limit=500",
              );
              for (const response of [
                accountsBefore,
                transactionsBefore,
                paymentMethodsBefore,
                budgetsBefore,
                snapshotsBefore,
              ]) {
                expectStatus(response.status, 200);
              }

              const name = `SQLite Account Smoke ${accountSmokeSequence}`;
              const updatedName = `${name} Updated`;
              const createPayload = {
                name,
                currency: "KES",
                isCredit: false,
              };
              const createDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts/dry-run/create",
                { ...authedOptions, method: "POST", body: createPayload },
              );
              expectStatus(createDryRun.status, 200);
              expectSafeAccountShape(createDryRun.json, "create", true);
              expectNoSensitiveEcho(createDryRun.json, [name]);

              const createWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...createPayload,
                    dryRunReviewed: true,
                    confirmation: ACCOUNT_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(createWrite.status, 200);
              expectSafeAccountShape(createWrite.json, "create", false);
              expect(createWrite.json.sqliteMutated === true, "account_create_did_not_mutate");
              expect(createWrite.json.rowsChanged === 1, "account_create_wrong_row_count");
              expectNoSensitiveEcho(createWrite.json, [name]);
              const accountId = createWrite.json.targetId;
              expect(typeof accountId === "number", "account_create_target_id_missing");

              const createdDetail = await read(
                `/prototype/repositories/accounts/${accountId}`,
              );
              expectStatus(createdDetail.status, 200);
              const createdAccount = detailRow(createdDetail.json, "account");
              expect(createdAccount.name === name, "created_account_not_readable");

              const updatePayload = {
                id: accountId,
                name: updatedName,
                currency: "USD",
                isCredit: true,
                creditLimit: 250,
              };
              const updateDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts/dry-run/update",
                { ...authedOptions, method: "POST", body: updatePayload },
              );
              expectStatus(updateDryRun.status, 200);
              expectSafeAccountShape(updateDryRun.json, "update", true);
              expectNoSensitiveEcho(updateDryRun.json, [updatedName]);

              const financialSummary =
                updateDryRun.json.financialSignificance as Record<
                  string,
                  unknown
                >;
              expect(
                financialSummary.currencyWouldChange === true &&
                  financialSummary.creditClassificationWouldChange === true &&
                  financialSummary.balancesWouldChange === false &&
                  financialSummary.transactionsWouldChange === false,
                "account_financial_significance_summary_invalid",
              );

              const updateWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/accounts/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...updatePayload,
                    dryRunReviewed: true,
                    confirmation: ACCOUNT_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(updateWrite.status, 200);
              expectSafeAccountShape(updateWrite.json, "update", false);
              expect(updateWrite.json.rowsChanged === 1, "account_update_wrong_row_count");
              expectNoSensitiveEcho(updateWrite.json, [updatedName]);

              const updatedDetail = await read(
                `/prototype/repositories/accounts/${accountId}`,
              );
              expectStatus(updatedDetail.status, 200);
              const updatedAccount = detailRow(updatedDetail.json, "account");
              expect(updatedAccount.name === updatedName, "updated_account_not_readable");
              expect(updatedAccount.currency === "USD", "updated_account_currency_missing");
              expect(
                updatedAccount.isCredit === 1 || updatedAccount.isCredit === true,
                "updated_account_credit_classification_missing",
              );
              expect(updatedAccount.creditLimit === 250, "updated_account_credit_limit_missing");
              for (const field of [
                "id",
                "description",
                "imageMimeType",
                "isActive",
                "createdAt",
              ]) {
                expect(
                  JSON.stringify(updatedAccount[field]) ===
                    JSON.stringify(createdAccount[field]),
                  `account_update_changed_preserved_${field}`,
                );
              }
              expect(
                updatedAccount.updatedAt !== createdAccount.updatedAt,
                "account_update_timestamp_unchanged",
              );

              const accountsAfter = await read(
                "/prototype/repositories/accounts?limit=500",
              );
              expect(
                countFromListResponse(accountsAfter.json) ===
                  countFromListResponse(accountsBefore.json) + 1,
                "account_count_did_not_increase_once",
              );

              for (const [pathname, before, code] of [
                [
                  "/prototype/repositories/transactions?limit=200",
                  transactionsBefore,
                  "transactions",
                ],
                [
                  "/prototype/sqlite/tables/paymentMethods?limit=200",
                  paymentMethodsBefore,
                  "payment_methods",
                ],
                ["/prototype/repositories/budgets?limit=500", budgetsBefore, "budgets"],
                [
                  "/prototype/repositories/budget-snapshots?limit=500",
                  snapshotsBefore,
                  "budget_snapshots",
                ],
              ] as const) {
                const after = await read(pathname);
                expectStatus(after.status, 200);
                const beforeCount =
                  typeof before.json.count === "number"
                    ? before.json.count
                    : before.json.rowCount;
                const afterCount =
                  typeof after.json.count === "number"
                    ? after.json.count
                    : after.json.rowCount;
                expect(afterCount === beforeCount, `${code}_count_changed`);
                expect(
                  listResponseFingerprint(after.json) ===
                    listResponseFingerprint(before.json),
                  `${code}_content_changed`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "transaction basic dry-run and write routes remain protected",
      run: async () => {
        const payload = {
          classification: "expense",
          date: "2098-01-10T12:00:00.000Z",
          amount: -1,
          categoryId: 1,
          accountId: 1,
          recipientId: 1,
          description: "Protected transaction smoke",
        };
        for (const mode of ["dry-run", "write"] as const) {
          for (const action of ["create", "update"] as const) {
            const route = `/prototype/repositories/transactions/${mode}/${action}`;
            const unauthorized = await requestJson(baseUrl, route, {
              method: "POST",
              body:
                mode === "write"
                  ? {
                      ...payload,
                      ...(action === "update" ? { id: 1 } : {}),
                      dryRunReviewed: true,
                      confirmation:
                        action === "create"
                          ? TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION
                          : TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION,
                    }
                  : { ...payload, ...(action === "update" ? { id: 1 } : {}) },
            });
            expectStatus(unauthorized.status, 401);

            const badOrigin = await requestJson(baseUrl, route, {
              ...authedOptions,
              origin: "https://unexpected.invalid",
              method: "POST",
              body: { ...payload, ...(action === "update" ? { id: 1 } : {}) },
            });
            expectStatus(badOrigin.status, 403);
          }
        }
      },
    },
    {
      name: "transaction basic dry-runs validate safely without mutation",
      run: async () => {
        const tableNames = [
          "transactions",
          "accounts",
          "paymentMethods",
          "budgets",
          "budgetSnapshots",
          "buckets",
          "categories",
          "recipients",
          "smsImportTemplates",
        ] as const;
        const before = new Map<string, Record<string, unknown>[]>();
        for (const table of tableNames) {
          before.set(
            table,
            await readAllTableRows(baseUrl, table, authedOptions),
          );
        }
        const accounts = before.get("accounts")!;
        const buckets = before.get("buckets")!;
        const categories = before.get("categories")!;
        const recipients = before.get("recipients")!;
        const transactions = before.get("transactions")!;
        const category = categories.find(
          (candidate) =>
            typeof candidate.id === "number" &&
            typeof candidate.bucketId === "number" &&
            buckets.some((bucket) => bucket.id === candidate.bucketId),
        );
        const account = accounts.find((candidate) => typeof candidate.id === "number");
        const recipient = recipients.find(
          (candidate) => typeof candidate.id === "number",
        );
        const eligibleTarget = transactions.find(
          (candidate) =>
            typeof candidate.id === "number" &&
            typeof candidate.amount === "number" &&
            candidate.amount !== 0 &&
            typeof candidate.date === "string" &&
            typeof candidate.accountId === "number" &&
            typeof candidate.categoryId === "number" &&
            typeof candidate.recipientId === "number" &&
            accounts.some((item) => item.id === candidate.accountId) &&
            categories.some(
              (item) =>
                item.id === candidate.categoryId &&
                buckets.some((bucket) => bucket.id === item.bucketId),
            ) &&
            recipients.some((item) => item.id === candidate.recipientId) &&
            candidate.transferPairId == null &&
            candidate.isTransfer !== 1 &&
            candidate.isTransfer !== true &&
            (candidate.transactionCost == null ||
              candidate.transactionCost === 0) &&
            candidate.budgetId == null &&
            candidate.occurrenceDate == null &&
            candidate.budgetSnapshotId == null,
        );
        expect(Boolean(account && category && recipient), "transaction_fk_fixture_missing");
        expect(Boolean(eligibleTarget), "eligible_transaction_fixture_missing");

        const sensitiveDescription = `Transaction Dry Run ${transactionSmokeSequence}`;
        const basePayload = {
          classification: "expense",
          date: "2098-01-10T12:00:00.000Z",
          amount: -10,
          categoryId: category!.id,
          accountId: account!.id,
          recipientId: recipient!.id,
          description: sensitiveDescription,
          transactionReference: `private-reference-${transactionSmokeSequence}`,
        };
        const validCreate = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/dry-run/create",
          { ...authedOptions, method: "POST", body: basePayload },
        );
        expectStatus(validCreate.status, 200);
        expectSafeTransactionBasicShape(validCreate.json, "create", true);
        expectNoSensitiveEcho(validCreate.json, [
          sensitiveDescription,
          basePayload.transactionReference,
        ]);

        const targetAmount = eligibleTarget!.amount as number;
        const validUpdatePayload = {
          id: eligibleTarget!.id,
          classification: targetAmount > 0 ? "income" : "expense",
          date: eligibleTarget!.date,
          amount: targetAmount,
          originalAmount: eligibleTarget!.originalAmount,
          originalCurrency: eligibleTarget!.originalCurrency,
          exchangeRate: eligibleTarget!.exchangeRate,
          transactionReference: eligibleTarget!.transactionReference,
          categoryId: eligibleTarget!.categoryId,
          accountId: eligibleTarget!.accountId,
          recipientId: eligibleTarget!.recipientId,
          description: eligibleTarget!.description,
          transactionCost: eligibleTarget!.transactionCost,
        };
        const validUpdate = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/dry-run/update",
          { ...authedOptions, method: "POST", body: validUpdatePayload },
        );
        expectStatus(validUpdate.status, 200);
        expectSafeTransactionBasicShape(validUpdate.json, "update", true);

        const ineligibleTarget = transactions.find(
          (candidate) =>
            typeof candidate.id === "number" &&
            typeof candidate.amount === "number" &&
            candidate.amount !== 0 &&
            typeof candidate.date === "string" &&
            typeof candidate.description === "string" &&
            candidate.description.trim().length >= 2 &&
            typeof candidate.accountId === "number" &&
            typeof candidate.categoryId === "number" &&
            typeof candidate.recipientId === "number" &&
            accounts.some((item) => item.id === candidate.accountId) &&
            categories.some((item) => item.id === candidate.categoryId) &&
            recipients.some((item) => item.id === candidate.recipientId) &&
            (candidate.transferPairId != null ||
              candidate.isTransfer === 1 ||
              (candidate.transactionCost != null &&
                candidate.transactionCost !== 0) ||
              candidate.budgetId != null ||
              candidate.occurrenceDate != null ||
              candidate.budgetSnapshotId != null),
        );
        expect(Boolean(ineligibleTarget), "ineligible_transaction_fixture_missing");
        const ineligibleUpdate = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: {
              id: ineligibleTarget!.id,
              classification:
                (ineligibleTarget!.amount as number) > 0 ? "income" : "expense",
              date: ineligibleTarget!.date,
              amount: ineligibleTarget!.amount,
              originalAmount: ineligibleTarget!.originalAmount,
              originalCurrency: ineligibleTarget!.originalCurrency,
              exchangeRate: ineligibleTarget!.exchangeRate,
              transactionReference: ineligibleTarget!.transactionReference,
              categoryId: ineligibleTarget!.categoryId,
              accountId: ineligibleTarget!.accountId,
              recipientId: ineligibleTarget!.recipientId,
              description: "Ineligible target validation",
            },
          },
        );
        expectStatus(ineligibleUpdate.status, 400);
        expectSafeTransactionBasicShape(ineligibleUpdate.json, "update", true);
        expect(
          Array.isArray(ineligibleUpdate.json.unsupportedReasons) &&
            ineligibleUpdate.json.unsupportedReasons.length > 0,
          "ineligible_transaction_target_not_rejected",
        );

        const invalidCases: Array<{
          action: "create" | "update";
          body: Record<string, unknown>;
          expectedStatus: number;
        }> = [
          {
            action: "create",
            body: { ...basePayload, amount: "invalid" },
            expectedStatus: 400,
          },
          { action: "create", body: { ...basePayload, amount: 0 }, expectedStatus: 400 },
          {
            action: "create",
            body: { ...basePayload, amount: 10 },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: Object.fromEntries(
              Object.entries(basePayload).filter(([field]) => field !== "accountId"),
            ),
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, accountId: 2_147_483_647 },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, categoryId: 2_147_483_647 },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, recipientId: 2_147_483_647 },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, unexpected: true },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, isTransfer: true },
            expectedStatus: 400,
          },
          {
            action: "create",
            body: { ...basePayload, transferPairId: 1 },
            expectedStatus: 400,
          },
          ...(!allowTransactionCostBudgetWriteSmoke
            ? [
                {
                  action: "create" as const,
                  body: { ...basePayload, transactionCost: -1 },
                  expectedStatus: 400,
                },
              ]
            : []),
          {
            action: "create",
            body: { ...basePayload, paymentChannelId: 1 },
            expectedStatus: 400,
          },
          ...(!allowTransactionCostBudgetWriteSmoke
            ? [
                {
                  action: "create" as const,
                  body: { ...basePayload, budgetId: 1 },
                  expectedStatus: 400,
                },
                {
                  action: "create" as const,
                  body: {
                    ...basePayload,
                    occurrenceDate: "2098-01-10T12:00:00.000Z",
                  },
                  expectedStatus: 400,
                },
                {
                  action: "create" as const,
                  body: { ...basePayload, budgetSnapshotId: 1 },
                  expectedStatus: 400,
                },
              ]
            : []),
          {
            action: "update",
            body: { ...basePayload, id: 2_147_483_647 },
            expectedStatus: 404,
          },
        ];
        for (const testCase of invalidCases) {
          const result = await requestJson(
            baseUrl,
            `/prototype/repositories/transactions/dry-run/${testCase.action}`,
            { ...authedOptions, method: "POST", body: testCase.body },
          );
          expectStatus(result.status, testCase.expectedStatus);
          expectSafeTransactionBasicShape(
            result.json,
            testCase.action,
            true,
          );
          expectNoSensitiveEcho(result.json, [
            sensitiveDescription,
            basePayload.transactionReference,
          ]);
        }

        for (const table of tableNames) {
          const after = await readAllTableRows(baseUrl, table, authedOptions);
          expect(
            rowsFingerprint(after) === rowsFingerprint(before.get(table)!),
            `${table}_changed_during_transaction_dry_run`,
          );
        }
      },
    },
    ...(!allowTransactionBasicWriteSmoke &&
    !allowTransactionCostBudgetWriteSmoke &&
    !allowTransactionTransferWriteSmoke
      ? [
          {
            name: "transaction basic writes are disabled and non-mutating by default",
            run: async () => {
              const accounts = await readAllTableRows(
                baseUrl,
                "accounts",
                authedOptions,
              );
              const buckets = await readAllTableRows(
                baseUrl,
                "buckets",
                authedOptions,
              );
              const categories = await readAllTableRows(
                baseUrl,
                "categories",
                authedOptions,
              );
              const recipients = await readAllTableRows(
                baseUrl,
                "recipients",
                authedOptions,
              );
              const transactionsBefore = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              expect(
                Boolean(accounts[0] && category && recipients[0]),
                "transaction_fk_fixture_missing",
              );
              const response = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    classification: "expense",
                    date: "2098-01-10T12:00:00.000Z",
                    amount: -1,
                    categoryId: category!.id,
                    accountId: accounts[0].id,
                    recipientId: recipients[0].id,
                    description: "Disabled transaction smoke",
                    dryRunReviewed: true,
                    confirmation: TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(response.status, 403);
              expectSafeTransactionBasicShape(response.json, "create", false);
              const transactionsAfter = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              expect(
                rowsFingerprint(transactionsAfter) ===
                  rowsFingerprint(transactionsBefore),
                "disabled_transaction_write_mutated",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
    ...(!allowTransactionCostBudgetWriteSmoke
      ? [
          {
            name: "transaction cost and budget writes require explicit Phase 2 opt-in",
            run: async () => {
              const transactionsBefore = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const accounts = await readAllTableRows(
                baseUrl,
                "accounts",
                authedOptions,
              );
              const buckets = await readAllTableRows(
                baseUrl,
                "buckets",
                authedOptions,
              );
              const categories = await readAllTableRows(
                baseUrl,
                "categories",
                authedOptions,
              );
              const recipients = await readAllTableRows(
                baseUrl,
                "recipients",
                authedOptions,
              );
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              expect(
                Boolean(accounts[0] && category && recipients[0]),
                "transaction_phase2_fixture_missing",
              );
              const response = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    classification: "expense",
                    date: "2098-02-10T12:00:00.000Z",
                    amount: -10,
                    transactionCost: -1,
                    categoryId: category!.id,
                    accountId: accounts[0].id,
                    recipientId: recipients[0].id,
                    description: "Disabled Phase 2 transaction smoke",
                    dryRunReviewed: true,
                    confirmation: TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(response.status, 403);
              expect(
                response.json.code ===
                  "transaction_cost_budget_writes_disabled" ||
                  (!allowTransactionBasicWriteSmoke &&
                    response.json.code === "transaction_basic_writes_disabled"),
                "transaction_phase2_disabled_code_missing",
              );
              expectSafeTransactionBasicShape(
                response.json,
                "create",
                false,
              );
              const transactionsAfter = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              expect(
                rowsFingerprint(transactionsAfter) ===
                  rowsFingerprint(transactionsBefore),
                "disabled_transaction_phase2_write_mutated",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
    ...(allowTransactionBasicWriteSmoke
      ? [
          {
            name: "transaction opt-in smoke verifies isolated rows and exact financial deltas",
            run: async () => {
              const relatedTables = [
                "accounts",
                "paymentMethods",
                "budgets",
                "budgetSnapshots",
                "buckets",
                "categories",
                "recipients",
                "smsImportTemplates",
              ] as const;
              const relatedBefore = new Map<string, Record<string, unknown>[]>();
              for (const table of relatedTables) {
                relatedBefore.set(
                  table,
                  await readAllTableRows(baseUrl, table, authedOptions),
                );
              }
              const transactionsBefore = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const accounts = relatedBefore.get("accounts")!;
              const buckets = relatedBefore.get("buckets")!;
              const categories = relatedBefore.get("categories")!;
              const recipients = relatedBefore.get("recipients")!;
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              const account = accounts[0];
              const recipient = recipients[0];
              expect(
                Boolean(account && category && recipient),
                "transaction_fk_fixture_missing",
              );
              const accountId = account.id as number;
              const month = "2098-01";
              const baselineAggregates = transactionAggregates(transactionsBefore);
              const privateReference = `transaction-smoke-${transactionSmokeSequence}`;
              const createInputs = [
                {
                  classification: "expense",
                  date: "2098-01-15T12:00:00.000Z",
                  amount: -123.45,
                  transactionCost: null,
                  description: `Expense Smoke ${transactionSmokeSequence}`,
                },
                {
                  classification: "income",
                  date: "2098-01-16T12:00:00.000Z",
                  amount: 67.89,
                  transactionCost: 0,
                  description: `Income Smoke ${transactionSmokeSequence}`,
                },
              ] as const;
              const createdIds: number[] = [];

              for (const input of createInputs) {
                const payload = {
                  ...input,
                  categoryId: category!.id,
                  accountId,
                  recipientId: recipient.id,
                  transactionReference: privateReference,
                };
                const dryRun = await requestJson(
                  baseUrl,
                  "/prototype/repositories/transactions/dry-run/create",
                  { ...authedOptions, method: "POST", body: payload },
                );
                expectStatus(dryRun.status, 200);
                expectSafeTransactionBasicShape(dryRun.json, "create", true);
                expectNoSensitiveEcho(dryRun.json, [
                  input.description,
                  privateReference,
                ]);

                const write = await requestJson(
                  baseUrl,
                  "/prototype/repositories/transactions/write/create",
                  {
                    ...authedOptions,
                    method: "POST",
                    body: {
                      ...payload,
                      dryRunReviewed: true,
                      confirmation: TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION,
                    },
                  },
                );
                expectStatus(write.status, 200);
                expectSafeTransactionBasicShape(write.json, "create", false);
                expect(write.json.rowsChanged === 1, "transaction_create_wrong_count");
                expectNoSensitiveEcho(write.json, [
                  input.description,
                  privateReference,
                ]);
                expect(typeof write.json.targetId === "number", "transaction_id_missing");
                createdIds.push(write.json.targetId as number);
              }

              const transactionsAfterCreate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              expect(
                transactionsAfterCreate.length === transactionsBefore.length + 2,
                "transaction_create_count_delta_invalid",
              );
              const existingAfterCreate = transactionsAfterCreate.filter(
                (row) => !createdIds.includes(row.id as number),
              );
              expect(
                rowsFingerprint(existingAfterCreate) ===
                  rowsFingerprint(transactionsBefore),
                "existing_transaction_changed_during_create",
              );
              for (const id of createdIds) {
                const row = transactionsAfterCreate.find((item) => item.id === id)!;
                expect(row.transferPairId == null, "created_transfer_pair_present");
                expect(row.isTransfer === 0, "created_transaction_marked_transfer");
                expect(
                  row.transactionCost == null || row.transactionCost === 0,
                  "created_transaction_cost_nonzero",
                );
                expect(
                  row.budgetId == null &&
                    row.occurrenceDate == null &&
                    row.budgetSnapshotId == null,
                  "created_transaction_budget_link_present",
                );
              }
              const afterCreateAggregates =
                transactionAggregates(transactionsAfterCreate);
              const createDelta = cents(-123.45 + 67.89);
              expect(
                (afterCreateAggregates.accounts.get(accountId) ?? 0) -
                  (baselineAggregates.accounts.get(accountId) ?? 0) ===
                  createDelta,
                "account_aggregate_create_delta_invalid",
              );
              expect(
                (afterCreateAggregates.months.get(month) ?? 0) -
                  (baselineAggregates.months.get(month) ?? 0) ===
                  createDelta,
                "report_aggregate_create_delta_invalid",
              );

              const updateInputs = [
                { id: createdIds[0], ...createInputs[0], amount: -100 },
                { id: createdIds[1], ...createInputs[1], amount: 80 },
              ] as const;
              for (const input of updateInputs) {
                const payload = {
                  ...input,
                  categoryId: category!.id,
                  accountId,
                  recipientId: recipient.id,
                  transactionReference: privateReference,
                };
                const dryRun = await requestJson(
                  baseUrl,
                  "/prototype/repositories/transactions/dry-run/update",
                  { ...authedOptions, method: "POST", body: payload },
                );
                expectStatus(dryRun.status, 200);
                expectSafeTransactionBasicShape(dryRun.json, "update", true);

                const write = await requestJson(
                  baseUrl,
                  "/prototype/repositories/transactions/write/update",
                  {
                    ...authedOptions,
                    method: "POST",
                    body: {
                      ...payload,
                      dryRunReviewed: true,
                      confirmation: TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION,
                    },
                  },
                );
                expectStatus(write.status, 200);
                expectSafeTransactionBasicShape(write.json, "update", false);
                expect(write.json.rowsChanged === 1, "transaction_update_wrong_count");
              }

              const transactionsAfterUpdate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              expect(
                transactionsAfterUpdate.length === transactionsAfterCreate.length,
                "transaction_update_changed_count",
              );
              const existingAfterUpdate = transactionsAfterUpdate.filter(
                (row) => !createdIds.includes(row.id as number),
              );
              expect(
                rowsFingerprint(existingAfterUpdate) ===
                  rowsFingerprint(transactionsBefore),
                "existing_transaction_changed_during_update",
              );
              const finalAggregates = transactionAggregates(transactionsAfterUpdate);
              const updateDelta = cents((-100 + 80) - (-123.45 + 67.89));
              expect(
                (finalAggregates.accounts.get(accountId) ?? 0) -
                  (afterCreateAggregates.accounts.get(accountId) ?? 0) ===
                  updateDelta,
                "account_aggregate_update_delta_invalid",
              );
              expect(
                (finalAggregates.months.get(month) ?? 0) -
                  (afterCreateAggregates.months.get(month) ?? 0) ===
                  updateDelta,
                "report_aggregate_update_delta_invalid",
              );

              for (const id of createdIds) {
                const beforeUpdate = transactionsAfterCreate.find(
                  (row) => row.id === id,
                )!;
                const afterUpdate = transactionsAfterUpdate.find(
                  (row) => row.id === id,
                )!;
                for (const field of [
                  "id",
                  "paymentChannelId",
                  "transactionCost",
                  "transferPairId",
                  "isTransfer",
                  "budgetId",
                  "occurrenceDate",
                  "budgetSnapshotId",
                ]) {
                  expect(
                    JSON.stringify(afterUpdate[field]) ===
                      JSON.stringify(beforeUpdate[field]),
                    `transaction_smoke_changed_preserved_${field}`,
                  );
                }
                expect(
                  !("createdAt" in afterUpdate) && !("updatedAt" in afterUpdate),
                  "transaction_smoke_invented_timestamps",
                );
              }

              for (const [index, id] of createdIds.entries()) {
                const detail = await requestJson(
                  baseUrl,
                  `/prototype/repositories/transactions/${id}`,
                  authedOptions,
                );
                expectStatus(detail.status, 200);
                const row = detail.json.transaction as Record<string, unknown>;
                expect(row.id === id, "updated_transaction_detail_missing");
                expect(
                  row.amount === updateInputs[index].amount,
                  "updated_transaction_amount_missing",
                );
              }
              const list = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions?dateFrom=2098-01-01T00%3A00%3A00.000Z&dateTo=2098-01-31T23%3A59%3A59.999Z&limit=200",
                authedOptions,
              );
              expectStatus(list.status, 200);
              const listedIds = (list.json.rows as Record<string, unknown>[]).map(
                (row) => row.id,
              );
              for (const id of createdIds) {
                expect(listedIds.includes(id), "updated_transaction_missing_from_list");
              }

              for (const table of relatedTables) {
                const after = await readAllTableRows(
                  baseUrl,
                  table,
                  authedOptions,
                );
                expect(
                  rowsFingerprint(after) ===
                    rowsFingerprint(relatedBefore.get(table)!),
                  `${table}_changed_during_transaction_write_smoke`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    ...(allowTransactionCostBudgetWriteSmoke
      ? [
          {
            name: "transaction Phase 2 opt-in smoke verifies cost and existing snapshot linkage",
            run: async () => {
              const relatedTables = [
                "accounts",
                "paymentMethods",
                "budgets",
                "budgetSnapshots",
                "buckets",
                "categories",
                "recipients",
                "smsImportTemplates",
              ] as const;
              const relatedBefore = new Map<
                string,
                Record<string, unknown>[]
              >();
              for (const table of relatedTables) {
                relatedBefore.set(
                  table,
                  await readAllTableRows(baseUrl, table, authedOptions),
                );
              }
              const transactionsBefore = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const accounts = relatedBefore.get("accounts")!;
              const buckets = relatedBefore.get("buckets")!;
              const categories = relatedBefore.get("categories")!;
              const recipients = relatedBefore.get("recipients")!;
              const budgets = relatedBefore.get("budgets")!;
              const snapshots = relatedBefore.get("budgetSnapshots")!;
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              const snapshot = snapshots.find(
                (candidate) =>
                  typeof candidate.id === "number" &&
                  typeof candidate.budgetId === "number" &&
                  typeof candidate.dueDate === "string" &&
                  budgets.some((budget) => budget.id === candidate.budgetId),
              );
              expect(
                Boolean(accounts[0] && category && recipients[0] && snapshot),
                "transaction_phase2_fixture_missing",
              );

              const privateDescription = `Phase 2 Smoke ${transactionSmokeSequence}`;
              const privateReference = `phase2-reference-${transactionSmokeSequence}`;
              const basePayload = {
                classification: "expense",
                date: "2098-02-15T12:00:00.000Z",
                amount: -125,
                transactionCost: -2.5,
                categoryId: category!.id,
                accountId: accounts[0].id,
                recipientId: recipients[0].id,
                description: privateDescription,
                transactionReference: privateReference,
                budgetSnapshotId: snapshot!.id,
                budgetId: snapshot!.budgetId,
                occurrenceDate: snapshot!.dueDate,
              };

              const invalidCases = [
                {
                  body: { ...basePayload, transactionCost: 2.5 },
                  code: "transactionCost_must_be_non_positive",
                },
                {
                  body: { ...basePayload, transactionCost: "invalid" },
                  code: "transactionCost_invalid",
                },
                {
                  body: { ...basePayload, budgetSnapshotId: 2_147_483_647 },
                  code: "budget_snapshot_not_found",
                },
                {
                  body: { ...basePayload, budgetId: 2_147_483_647 },
                  code: "budget_snapshot_budget_mismatch",
                },
                {
                  body: {
                    ...basePayload,
                    occurrenceDate: "2098-02-16T12:00:00.000Z",
                  },
                  code: "budget_snapshot_occurrence_mismatch",
                },
              ];
              for (const invalidCase of invalidCases) {
                const result = await requestJson(
                  baseUrl,
                  "/prototype/repositories/transactions/dry-run/create",
                  {
                    ...authedOptions,
                    method: "POST",
                    body: invalidCase.body,
                  },
                );
                expectStatus(result.status, 400);
                expect(
                  result.json.code === invalidCase.code ||
                    (Array.isArray(result.json.validationErrors) &&
                      result.json.validationErrors.includes(invalidCase.code)),
                  `transaction_phase2_validation_missing_${invalidCase.code}`,
                );
                expectNoSensitiveEcho(result.json, [
                  privateDescription,
                  privateReference,
                ]);
              }
              expect(
                rowsFingerprint(
                  await readAllTableRows(
                    baseUrl,
                    "transactions",
                    authedOptions,
                  ),
                ) === rowsFingerprint(transactionsBefore),
                "transaction_phase2_invalid_dry_run_mutated",
              );

              const createDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/dry-run/create",
                { ...authedOptions, method: "POST", body: basePayload },
              );
              expectStatus(createDryRun.status, 200);
              expectSafeTransactionBasicShape(
                createDryRun.json,
                "create",
                true,
              );
              expect(
                createDryRun.json.transactionCostClassification === "negative" &&
                  createDryRun.json.budgetLinkageAction === "link",
                "transaction_phase2_create_summary_invalid",
              );
              expectNoSensitiveEcho(createDryRun.json, [
                privateDescription,
                privateReference,
              ]);

              const createWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...basePayload,
                    dryRunReviewed: true,
                    confirmation: TRANSACTION_BASIC_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(createWrite.status, 200);
              expectSafeTransactionBasicShape(
                createWrite.json,
                "create",
                false,
              );
              expect(
                createWrite.json.rowsChanged === 1 &&
                  typeof createWrite.json.targetId === "number",
                "transaction_phase2_create_write_failed",
              );
              const createdId = createWrite.json.targetId as number;
              const transactionsAfterCreate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              expect(
                transactionsAfterCreate.length === transactionsBefore.length + 1,
                "transaction_phase2_create_count_invalid",
              );
              const created = transactionsAfterCreate.find(
                (row) => row.id === createdId,
              );
              expect(Boolean(created), "transaction_phase2_created_row_missing");
              expect(
                created!.transactionCost === -2.5 &&
                  created!.budgetSnapshotId === snapshot!.id &&
                  created!.budgetId === snapshot!.budgetId &&
                  new Date(String(created!.occurrenceDate)).getTime() ===
                    new Date(String(snapshot!.dueDate)).getTime(),
                "transaction_phase2_create_storage_invalid",
              );
              expect(
                rowsFingerprint(
                  transactionsAfterCreate.filter((row) => row.id !== createdId),
                ) === rowsFingerprint(transactionsBefore),
                "transaction_phase2_create_changed_existing_row",
              );

              const baselineAggregates =
                transactionAggregates(transactionsBefore);
              const createAggregates =
                transactionAggregates(transactionsAfterCreate);
              const accountId = accounts[0].id as number;
              const month = "2098-02";
              const createDelta = cents(-127.5);
              expect(
                (createAggregates.accounts.get(accountId) ?? 0) -
                  (baselineAggregates.accounts.get(accountId) ?? 0) ===
                  createDelta,
                "transaction_phase2_account_delta_invalid",
              );
              expect(
                (createAggregates.months.get(month) ?? 0) -
                  (baselineAggregates.months.get(month) ?? 0) ===
                  createDelta,
                "transaction_phase2_report_delta_invalid",
              );
              expect(
                transactionsAfterCreate.filter(
                  (row) => row.budgetSnapshotId === snapshot!.id,
                ).length ===
                  transactionsBefore.filter(
                    (row) => row.budgetSnapshotId === snapshot!.id,
                  ).length +
                    1,
                "transaction_phase2_budget_history_membership_invalid",
              );

              const updatePayload = {
                ...basePayload,
                id: createdId,
                amount: -140,
                transactionCost: -3.75,
                budgetSnapshotId: null,
                budgetId: null,
                occurrenceDate: null,
              };
              const updateDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/dry-run/update",
                { ...authedOptions, method: "POST", body: updatePayload },
              );
              expectStatus(updateDryRun.status, 200);
              expectSafeTransactionBasicShape(
                updateDryRun.json,
                "update",
                true,
              );
              expect(
                updateDryRun.json.budgetLinkageAction === "unlink",
                "transaction_phase2_unlink_summary_missing",
              );
              const updateWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...updatePayload,
                    dryRunReviewed: true,
                    confirmation: TRANSACTION_BASIC_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(updateWrite.status, 200);
              expectSafeTransactionBasicShape(
                updateWrite.json,
                "update",
                false,
              );
              const transactionsAfterUpdate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const updated = transactionsAfterUpdate.find(
                (row) => row.id === createdId,
              );
              expect(
                transactionsAfterUpdate.length ===
                  transactionsAfterCreate.length &&
                  updated?.amount === -140 &&
                  updated.transactionCost === -3.75 &&
                  updated.budgetSnapshotId == null &&
                  updated.budgetId == null &&
                  updated.occurrenceDate == null,
                "transaction_phase2_update_storage_invalid",
              );
              expect(
                rowsFingerprint(
                  transactionsAfterUpdate.filter((row) => row.id !== createdId),
                ) === rowsFingerprint(transactionsBefore),
                "transaction_phase2_update_changed_other_row",
              );
              const updateAggregates =
                transactionAggregates(transactionsAfterUpdate);
              expect(
                (updateAggregates.accounts.get(accountId) ?? 0) -
                  (createAggregates.accounts.get(accountId) ?? 0) ===
                  cents(-16.25),
                "transaction_phase2_update_account_delta_invalid",
              );
              expect(
                (updateAggregates.months.get(month) ?? 0) -
                  (createAggregates.months.get(month) ?? 0) ===
                  cents(-16.25),
                "transaction_phase2_update_report_delta_invalid",
              );

              const detail = await requestJson(
                baseUrl,
                `/prototype/repositories/transactions/${createdId}`,
                authedOptions,
              );
              expectStatus(detail.status, 200);
              const detailTransaction = detail.json.transaction as Record<
                string,
                unknown
              >;
              expect(
                detailTransaction.id === createdId &&
                  detailTransaction.transactionCost === -3.75 &&
                  detailTransaction.budgetSnapshotId == null,
                "transaction_phase2_selected_read_refresh_invalid",
              );

              for (const table of relatedTables) {
                const after = await readAllTableRows(
                  baseUrl,
                  table,
                  authedOptions,
                );
                expect(
                  rowsFingerprint(after) ===
                    rowsFingerprint(relatedBefore.get(table)!),
                  `${table}_changed_during_transaction_phase2_write_smoke`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "transaction transfer routes remain protected and dry-runs are non-mutating",
      run: async () => {
        const accounts = await readAllTableRows(
          baseUrl,
          "accounts",
          authedOptions,
        );
        const buckets = await readAllTableRows(
          baseUrl,
          "buckets",
          authedOptions,
        );
        const categories = await readAllTableRows(
          baseUrl,
          "categories",
          authedOptions,
        );
        const recipients = await readAllTableRows(
          baseUrl,
          "recipients",
          authedOptions,
        );
        const category = categories.find((candidate) =>
          buckets.some((bucket) => bucket.id === candidate.bucketId),
        );
        expect(
          Boolean(accounts[0] && accounts[1] && category && recipients[0]),
          "transaction_transfer_fixture_missing",
        );
        const privateDescription = `Transfer Dry Run ${transactionSmokeSequence}`;
        const privateReference = `transfer-private-${transactionSmokeSequence}`;
        const payload = {
          sourceAccountId: accounts[0].id,
          destinationAccountId: accounts[1].id,
          sourceRecipientId: recipients[0].id,
          destinationRecipientId: recipients[0].id,
          date: "2098-03-10T12:00:00.000Z",
          amount: 10,
          transactionCost: -1,
          categoryId: category!.id,
          description: privateDescription,
          transactionReference: privateReference,
        };
        for (const mode of ["dry-run", "write"] as const) {
          for (const action of ["create", "update"] as const) {
            const route = `/prototype/repositories/transactions/transfers/${mode}/${action}`;
            const body = {
              ...payload,
              ...(action === "update" ? { id: 2_147_483_647 } : {}),
              ...(mode === "write"
                ? {
                    dryRunReviewed: true,
                    confirmation:
                      action === "create"
                        ? TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION
                        : TRANSACTION_TRANSFER_UPDATE_WRITE_CONFIRMATION,
                  }
                : {}),
            };
            expectStatus(
              (
                await requestJson(baseUrl, route, {
                  method: "POST",
                  body,
                })
              ).status,
              401,
            );
            expectStatus(
              (
                await requestJson(baseUrl, route, {
                  ...authedOptions,
                  origin: "https://unexpected.invalid",
                  method: "POST",
                  body,
                })
              ).status,
              403,
            );
          }
        }

        const tables = [
          "transactions",
          "accounts",
          "paymentMethods",
          "budgets",
          "budgetSnapshots",
          "buckets",
          "categories",
          "recipients",
          "smsImportTemplates",
        ] as const;
        const before = new Map<string, string>();
        for (const table of tables) {
          before.set(
            table,
            rowsFingerprint(
              await readAllTableRows(baseUrl, table, authedOptions),
            ),
          );
        }
        const valid = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/transfers/dry-run/create",
          { ...authedOptions, method: "POST", body: payload },
        );
        expectStatus(valid.status, 200);
        expectSafeTransactionTransferShape(valid.json, "create", true);
        expectNoSensitiveEcho(valid.json, [
          privateDescription,
          privateReference,
        ]);

        const invalidCases = [
          { ...payload, sourceAccountId: 2_147_483_647 },
          { ...payload, destinationAccountId: 2_147_483_647 },
          { ...payload, destinationAccountId: accounts[0].id },
          { ...payload, amount: 0 },
          { ...payload, amount: -10 },
          { ...payload, id: 1 },
          { ...payload, transferPairId: 1 },
          { ...payload, budgetSnapshotId: 1 },
          { ...payload, unexpected: true },
        ];
        for (const body of invalidCases) {
          const result = await requestJson(
            baseUrl,
            "/prototype/repositories/transactions/transfers/dry-run/create",
            { ...authedOptions, method: "POST", body },
          );
          expectStatus(result.status, 400);
          expectSafeTransactionTransferShape(result.json, "create", true);
          expectNoSensitiveEcho(result.json, [
            privateDescription,
            privateReference,
          ]);
        }
        const missingUpdate = await requestJson(
          baseUrl,
          "/prototype/repositories/transactions/transfers/dry-run/update",
          {
            ...authedOptions,
            method: "POST",
            body: { ...payload, id: 2_147_483_647 },
          },
        );
        expectStatus(missingUpdate.status, 404);
        expectSafeTransactionTransferShape(
          missingUpdate.json,
          "update",
          true,
        );
        for (const table of tables) {
          expect(
            rowsFingerprint(
              await readAllTableRows(baseUrl, table, authedOptions),
            ) === before.get(table),
            `${table}_changed_during_transfer_dry_run`,
          );
        }
      },
    },
    ...(!allowTransactionTransferWriteSmoke
      ? [
          {
            name: "transaction transfer writes are disabled and non-mutating by default",
            run: async () => {
              const accounts = await readAllTableRows(
                baseUrl,
                "accounts",
                authedOptions,
              );
              const buckets = await readAllTableRows(
                baseUrl,
                "buckets",
                authedOptions,
              );
              const categories = await readAllTableRows(
                baseUrl,
                "categories",
                authedOptions,
              );
              const recipients = await readAllTableRows(
                baseUrl,
                "recipients",
                authedOptions,
              );
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              expect(
                Boolean(accounts[0] && accounts[1] && category && recipients[0]),
                "transaction_transfer_fixture_missing",
              );
              const before = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const response = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/transfers/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    sourceAccountId: accounts[0].id,
                    destinationAccountId: accounts[1].id,
                    sourceRecipientId: recipients[0].id,
                    destinationRecipientId: recipients[0].id,
                    date: "2098-03-10T12:00:00.000Z",
                    amount: 10,
                    categoryId: category!.id,
                    description: "Disabled transfer smoke",
                    dryRunReviewed: true,
                    confirmation:
                      TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(response.status, 403);
              expectSafeTransactionTransferShape(
                response.json,
                "create",
                false,
              );
              expect(
                rowsFingerprint(
                  await readAllTableRows(
                    baseUrl,
                    "transactions",
                    authedOptions,
                  ),
                ) === rowsFingerprint(before),
                "disabled_transfer_write_mutated",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
    ...(allowTransactionTransferWriteSmoke
      ? [
          {
            name: "transaction transfer opt-in smoke verifies atomic pair and exact deltas",
            run: async () => {
              const relatedTables = [
                "accounts",
                "paymentMethods",
                "budgets",
                "budgetSnapshots",
                "buckets",
                "categories",
                "recipients",
                "smsImportTemplates",
              ] as const;
              const relatedBefore = new Map<string, string>();
              for (const table of relatedTables) {
                relatedBefore.set(
                  table,
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ),
                );
              }
              const transactionsBefore = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const accounts = await readAllTableRows(
                baseUrl,
                "accounts",
                authedOptions,
              );
              const categories = await readAllTableRows(
                baseUrl,
                "categories",
                authedOptions,
              );
              const buckets = await readAllTableRows(
                baseUrl,
                "buckets",
                authedOptions,
              );
              const recipients = await readAllTableRows(
                baseUrl,
                "recipients",
                authedOptions,
              );
              const category = categories.find((candidate) =>
                buckets.some((bucket) => bucket.id === candidate.bucketId),
              );
              expect(
                Boolean(accounts[0] && accounts[1] && category && recipients[0]),
                "transaction_transfer_fixture_missing",
              );
              const sourceAccountId = accounts[0].id as number;
              const destinationAccountId = accounts[1].id as number;
              const privateDescription = `Transfer Write ${transactionSmokeSequence}`;
              const privateReference = `transfer-write-${transactionSmokeSequence}`;
              const createPayload = {
                sourceAccountId,
                destinationAccountId,
                sourceRecipientId: recipients[0].id,
                destinationRecipientId: recipients[0].id,
                date: "2098-03-10T12:00:00.000Z",
                amount: 100,
                transactionCost: -2,
                categoryId: category!.id,
                description: privateDescription,
                transactionReference: privateReference,
              };
              const dryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/transfers/dry-run/create",
                { ...authedOptions, method: "POST", body: createPayload },
              );
              expectStatus(dryRun.status, 200);
              expectSafeTransactionTransferShape(dryRun.json, "create", true);
              const write = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/transfers/write/create",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...createPayload,
                    dryRunReviewed: true,
                    confirmation:
                      TRANSACTION_TRANSFER_CREATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(write.status, 200);
              expectSafeTransactionTransferShape(write.json, "create", false);
              expect(
                write.json.rowsChanged === 2 &&
                  write.json.transactionCountDelta === 2 &&
                  write.json.pairIntegrityVerified === true,
                "transaction_transfer_create_summary_invalid",
              );
              expectNoSensitiveEcho(write.json, [
                privateDescription,
                privateReference,
              ]);
              const sourceId = write.json.sourceTransactionId as number;
              const destinationId = write.json.destinationTransactionId as number;
              expect(
                Number.isInteger(sourceId) &&
                  Number.isInteger(destinationId) &&
                  sourceId !== destinationId,
                "transaction_transfer_created_ids_invalid",
              );

              const afterCreate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const source = afterCreate.find((row) => row.id === sourceId);
              const destination = afterCreate.find(
                (row) => row.id === destinationId,
              );
              expect(
                afterCreate.length === transactionsBefore.length + 2 &&
                  source?.amount === -100 &&
                  source.transactionCost === -2 &&
                  source.transferPairId === destinationId &&
                  source.isTransfer === 1 &&
                  destination?.amount === 100 &&
                  destination.transactionCost == null &&
                  destination.transferPairId === sourceId &&
                  destination.isTransfer === 1,
                "transaction_transfer_pair_storage_invalid",
              );
              expect(
                rowsFingerprint(
                  afterCreate.filter(
                    (row) => row.id !== sourceId && row.id !== destinationId,
                  ),
                ) === rowsFingerprint(transactionsBefore),
                "transaction_transfer_create_changed_existing_row",
              );
              const beforeAggregates = transactionAggregates(transactionsBefore);
              const createAggregates = transactionAggregates(afterCreate);
              expect(
                (createAggregates.accounts.get(sourceAccountId) ?? 0) -
                  (beforeAggregates.accounts.get(sourceAccountId) ?? 0) ===
                  cents(-102),
                "transaction_transfer_source_delta_invalid",
              );
              expect(
                (createAggregates.accounts.get(destinationAccountId) ?? 0) -
                  (beforeAggregates.accounts.get(destinationAccountId) ?? 0) ===
                  cents(100),
                "transaction_transfer_destination_delta_invalid",
              );
              const total = (values: Map<number, number>): number =>
                [...values.values()].reduce((sum, value) => sum + value, 0);
              expect(
                total(createAggregates.accounts) -
                  total(beforeAggregates.accounts) ===
                  cents(-2),
                "transaction_transfer_net_delta_invalid",
              );

              const updatePayload = {
                ...createPayload,
                id: destinationId,
                amount: 120,
                transactionCost: -3,
                date: "2098-03-11T12:00:00.000Z",
                description: `${privateDescription} updated`,
              };
              const updateDryRun = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/transfers/dry-run/update",
                { ...authedOptions, method: "POST", body: updatePayload },
              );
              expectStatus(updateDryRun.status, 200);
              expectSafeTransactionTransferShape(
                updateDryRun.json,
                "update",
                true,
              );
              const updateWrite = await requestJson(
                baseUrl,
                "/prototype/repositories/transactions/transfers/write/update",
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...updatePayload,
                    dryRunReviewed: true,
                    confirmation:
                      TRANSACTION_TRANSFER_UPDATE_WRITE_CONFIRMATION,
                  },
                },
              );
              expectStatus(updateWrite.status, 200);
              expectSafeTransactionTransferShape(
                updateWrite.json,
                "update",
                false,
              );
              expect(
                updateWrite.json.sourceTransactionId === sourceId &&
                  updateWrite.json.destinationTransactionId === destinationId &&
                  updateWrite.json.rowsChanged === 2 &&
                  updateWrite.json.transactionCountDelta === 0,
                "transaction_transfer_update_summary_invalid",
              );
              const afterUpdate = await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              );
              const updatedSource = afterUpdate.find(
                (row) => row.id === sourceId,
              );
              const updatedDestination = afterUpdate.find(
                (row) => row.id === destinationId,
              );
              expect(
                afterUpdate.length === afterCreate.length &&
                  updatedSource?.amount === -120 &&
                  updatedSource.transactionCost === -3 &&
                  updatedSource.transferPairId === destinationId &&
                  updatedDestination?.amount === 120 &&
                  updatedDestination.transferPairId === sourceId,
                "transaction_transfer_update_storage_invalid",
              );
              const updateAggregates = transactionAggregates(afterUpdate);
              expect(
                (updateAggregates.accounts.get(sourceAccountId) ?? 0) -
                  (createAggregates.accounts.get(sourceAccountId) ?? 0) ===
                  cents(-21),
                "transaction_transfer_source_update_delta_invalid",
              );
              expect(
                (updateAggregates.accounts.get(destinationAccountId) ?? 0) -
                  (createAggregates.accounts.get(destinationAccountId) ?? 0) ===
                  cents(20),
                "transaction_transfer_destination_update_delta_invalid",
              );
              expect(
                total(updateAggregates.accounts) -
                  total(createAggregates.accounts) ===
                  cents(-1),
                "transaction_transfer_net_update_delta_invalid",
              );
              for (const id of [sourceId, destinationId]) {
                const detail = await requestJson(
                  baseUrl,
                  `/prototype/repositories/transactions/${id}`,
                  authedOptions,
                );
                expectStatus(detail.status, 200);
                const row = detail.json.transaction as Record<string, unknown>;
                expect(
                  row.id === id &&
                    [sourceId, destinationId].includes(
                      row.transferPairId as number,
                    ),
                  "transaction_transfer_selected_read_missing",
                );
              }
              for (const table of relatedTables) {
                expect(
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ) === relatedBefore.get(table),
                  `${table}_changed_during_transaction_transfer_write`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "Budget definition dry-runs and disabled writes are safe",
      run: async () => {
        expect(
          budgetGoalDirectionNormalizationSanityCheck(),
          "budget_definition_goal_direction_helper_sanity_failed",
        );
        const path = "/prototype/repositories/budgets";
        const [accounts, categories, budgetsBefore, snapshotsBefore, transactionsBefore] =
          await Promise.all([
            readAllTableRows(baseUrl, "accounts", authedOptions),
            readAllTableRows(baseUrl, "categories", authedOptions),
            readAllTableRows(baseUrl, "budgets", authedOptions),
            readAllTableRows(baseUrl, "budgetSnapshots", authedOptions),
            readAllTableRows(baseUrl, "transactions", authedOptions),
          ]);
        const accountId = Number(accounts[0]?.id);
        const categoryId = Number(categories[0]?.id);
        expect(
          Number.isInteger(accountId) && Number.isInteger(categoryId),
          "budget_definition_smoke_requires_lookup_rows",
        );
        const validPayload = {
          description: `Synthetic Budget ${budgetDefinitionSmokeSequence}`,
          categoryId,
          accountId,
          recipientId: null,
          amount: -100,
          transactionCost: null,
          frequency: "once",
          frequencyDetails: null,
          isGoal: false,
          isFlexible: false,
          goalPercentage: null,
          goalDirection: null,
          remainingCyclesTotal: null,
          dueDate: "2035-01-15T00:00:00.000Z",
        };
        const fingerprints = {
          budgets: rowsFingerprint(budgetsBefore),
          snapshots: rowsFingerprint(snapshotsBefore),
          transactions: rowsFingerprint(transactionsBefore),
        };

        const missingToken = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          { method: "POST", body: validPayload, origin },
        );
        expectStatus(missingToken.status, 401);
        const badOrigin = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            token,
            origin: "http://unexpected-origin.invalid",
            method: "POST",
            body: validPayload,
          },
        );
        expectStatus(badOrigin.status, 403);

        const invalidCases = [
          {
            payload: { ...validPayload, amount: 0 },
            code: "amount_must_be_nonzero",
          },
          {
            payload: { ...validPayload, goalDirection: "sideways" },
            code: "goalDirection_invalid",
          },
          {
            payload: {
              ...validPayload,
              frequency: "monthly",
              frequencyDetails: { dayOfMonth: 32 },
            },
            code: "frequencyDetails_dayOfMonth_invalid",
          },
          {
            payload: { ...validPayload, dueDate: "not-a-date" },
            code: "dueDate_invalid",
          },
          {
            payload: { ...validPayload, categoryId: 2147483647 },
            code: "category_not_found",
          },
          {
            payload: { ...validPayload, snapshotId: 1 },
            code: "unsupported_write_field",
          },
        ] as const;
        for (const testCase of invalidCases) {
          const result = await requestJson(
            baseUrl,
            `${path}/dry-run/create`,
            {
              ...authedOptions,
              method: "POST",
              body: testCase.payload,
            },
          );
          expectStatus(result.status, 400);
          expect(
            result.json.code === testCase.code,
            `budget_definition_${testCase.code}_not_rejected`,
          );
        }

        const explicitIncome = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: {
              ...validPayload,
              amount: -100,
              goalDirection: "income",
            },
          },
        );
        expectStatus(explicitIncome.status, 200);
        const explicitSummary = explicitIncome.json
          .goalDirectionSummary as Record<string, unknown>;
        expect(
          explicitSummary.explicit === true &&
            explicitSummary.effectiveDirection === "income" &&
            explicitSummary.amountSignFallbackUsed === false,
          "budget_definition_explicit_direction_precedence_failed",
        );

        const fallback = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: validPayload,
          },
        );
        expectStatus(fallback.status, 200);
        const fallbackSummary = fallback.json
          .goalDirectionSummary as Record<string, unknown>;
        expect(
          fallbackSummary.explicit === false &&
            fallbackSummary.effectiveDirection === "expense" &&
            fallbackSummary.amountSignFallbackUsed === true,
          "budget_definition_amount_sign_fallback_failed",
        );
        expectNoSensitiveEcho(fallback.json, [validPayload.description]);

        const unknownUpdate = await requestJson(
          baseUrl,
          `${path}/dry-run/update`,
          {
            ...authedOptions,
            method: "POST",
            body: { id: 2147483647, ...validPayload },
          },
        );
        expectStatus(unknownUpdate.status, 404);
        expect(
          unknownUpdate.json.code === "budget_definition_not_found",
          "budget_definition_unknown_update_not_rejected",
        );

        expect(
          rowsFingerprint(
            await readAllTableRows(baseUrl, "budgets", authedOptions),
          ) === fingerprints.budgets &&
            rowsFingerprint(
              await readAllTableRows(
                baseUrl,
                "budgetSnapshots",
                authedOptions,
              ),
            ) === fingerprints.snapshots &&
            rowsFingerprint(
              await readAllTableRows(
                baseUrl,
                "transactions",
                authedOptions,
              ),
            ) === fingerprints.transactions,
          "budget_definition_dry_run_mutated_data",
        );

        for (const unsupportedPath of [
          `${path}/dry-run/delete`,
          `${path}/write/delete`,
          "/prototype/repositories/budget-snapshots/write/create",
          "/prototype/repositories/budget-snapshots/write/update",
          "/prototype/repositories/budget-snapshots/write/delete",
        ]) {
          const result = await requestJson(baseUrl, unsupportedPath, {
            ...authedOptions,
            method: "POST",
            body: { id: 1 },
          });
          expectStatus(result.status, 404);
        }

        if (!allowBudgetDefinitionWriteSmoke) {
          const invalidWrite = await requestJson(
            baseUrl,
            `${path}/write/create`,
            {
              ...authedOptions,
              method: "POST",
              body: {
                ...validPayload,
                amount: 0,
                dryRunReviewed: true,
                confirmation: BUDGET_DEFINITION_CREATE_CONFIRMATION,
              },
            },
          );
          expectStatus(invalidWrite.status, 400);
          expect(
            invalidWrite.json.code === "amount_must_be_nonzero",
            "budget_definition_invalid_write_not_rejected_safely",
          );
          const disabled = await requestJson(
            baseUrl,
            `${path}/write/create`,
            {
              ...authedOptions,
              method: "POST",
              body: {
                ...validPayload,
                dryRunReviewed: true,
                confirmation: BUDGET_DEFINITION_CREATE_CONFIRMATION,
              },
            },
          );
          expectStatus(disabled.status, 403);
          expect(
            disabled.json.code === "budget_definition_writes_disabled",
            "budget_definition_write_not_disabled",
          );
        }
      },
    },
    ...(allowBudgetDefinitionWriteSmoke
      ? [
          {
            name: "Budget definition opt-in smoke preserves snapshots and links",
            run: async () => {
              const path = "/prototype/repositories/budgets";
              const tableNames = [
                "transactions",
                "budgetSnapshots",
                "buckets",
                "categories",
                "accounts",
                "paymentMethods",
                "recipients",
                "smsImportTemplates",
              ] as const;
              const [accounts, categories, budgetsBefore] = await Promise.all([
                readAllTableRows(baseUrl, "accounts", authedOptions),
                readAllTableRows(baseUrl, "categories", authedOptions),
                readAllTableRows(baseUrl, "budgets", authedOptions),
              ]);
              const accountId = Number(accounts[0]?.id);
              const categoryId = Number(categories[0]?.id);
              expect(
                Number.isInteger(accountId) && Number.isInteger(categoryId),
                "budget_definition_write_smoke_requires_lookup_rows",
              );
              const relatedBefore = new Map<string, string>();
              for (const table of tableNames) {
                relatedBefore.set(
                  table,
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ),
                );
              }
              const createPayload = {
                description: `Synthetic Budget ${budgetDefinitionSmokeSequence}`,
                categoryId,
                accountId,
                recipientId: null,
                amount: 100,
                transactionCost: -2,
                frequency: "once",
                frequencyDetails: null,
                isGoal: true,
                isFlexible: false,
                goalPercentage: 10,
                goalDirection: "expense",
                remainingCyclesTotal: 1,
                dueDate: "2035-02-15T00:00:00.000Z",
              };
              const createDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/create`,
                { ...authedOptions, method: "POST", body: createPayload },
              );
              expectStatus(createDryRun.status, 200);
              const createWrite = await requestJson(
                baseUrl,
                `${path}/write/create`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...createPayload,
                    dryRunReviewed: true,
                    confirmation: BUDGET_DEFINITION_CREATE_CONFIRMATION,
                  },
                },
              );
              expectStatus(createWrite.status, 200);
              expect(
                createWrite.json.ok === true &&
                  createWrite.json.sqliteMutated === true &&
                  createWrite.json.rowsChanged === 1 &&
                  typeof createWrite.json.targetId === "number",
                "budget_definition_create_write_invalid",
              );
              expectNoSensitiveEcho(createWrite.json, [
                createPayload.description,
              ]);
              const targetId = createWrite.json.targetId as number;
              const budgetsAfterCreate = await readAllTableRows(
                baseUrl,
                "budgets",
                authedOptions,
              );
              expect(
                budgetsAfterCreate.length === budgetsBefore.length + 1 &&
                  rowsFingerprint(
                    budgetsAfterCreate.filter(
                      (row) => Number(row.id) !== targetId,
                    ),
                  ) === rowsFingerprint(budgetsBefore),
                "budget_definition_create_boundary_failed",
              );
              for (const table of tableNames) {
                expect(
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ) === relatedBefore.get(table),
                  `${table}_changed_during_budget_definition_create`,
                );
              }

              const detail = await requestJson(
                baseUrl,
                `${path}/${targetId}`,
                authedOptions,
              );
              expectStatus(detail.status, 200);
              const created = detail.json.budget as Record<string, unknown>;
              expect(
                created.id === targetId &&
                  created.goalDirection === "expense" &&
                  created.frequency === "once",
                "budget_definition_create_not_visible",
              );

              const updatePayload = {
                ...createPayload,
                id: targetId,
                amount: -125,
                transactionCost: null,
                frequency: "monthly",
                frequencyDetails: { dayOfMonth: 15 },
                goalDirection: "income",
                isFlexible: true,
                remainingCyclesTotal: 6,
                dueDate: "2035-03-15T00:00:00.000Z",
              };
              const fallbackDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/update`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: { ...updatePayload, goalDirection: null },
                },
              );
              expectStatus(fallbackDryRun.status, 200);
              const fallbackSummary = fallbackDryRun.json
                .goalDirectionSummary as Record<string, unknown>;
              expect(
                fallbackSummary.effectiveDirection === "expense" &&
                  fallbackSummary.amountSignFallbackUsed === true,
                "budget_definition_update_fallback_invalid",
              );

              const updateDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/update`,
                { ...authedOptions, method: "POST", body: updatePayload },
              );
              expectStatus(updateDryRun.status, 200);
              const updateWrite = await requestJson(
                baseUrl,
                `${path}/write/update`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...updatePayload,
                    dryRunReviewed: true,
                    confirmation: BUDGET_DEFINITION_UPDATE_CONFIRMATION,
                  },
                },
              );
              expectStatus(updateWrite.status, 200);
              expect(
                updateWrite.json.ok === true &&
                  updateWrite.json.rowsChanged === 1,
                "budget_definition_update_write_invalid",
              );
              expectNoSensitiveEcho(updateWrite.json, [
                updatePayload.description,
              ]);
              const budgetsAfterUpdate = await readAllTableRows(
                baseUrl,
                "budgets",
                authedOptions,
              );
              expect(
                budgetsAfterUpdate.length === budgetsAfterCreate.length &&
                  rowsFingerprint(
                    budgetsAfterUpdate.filter(
                      (row) => Number(row.id) !== targetId,
                    ),
                  ) ===
                    rowsFingerprint(
                      budgetsAfterCreate.filter(
                        (row) => Number(row.id) !== targetId,
                      ),
                    ),
                "budget_definition_update_boundary_failed",
              );
              const updatedDetail = await requestJson(
                baseUrl,
                `${path}/${targetId}`,
                authedOptions,
              );
              expectStatus(updatedDetail.status, 200);
              const updated = updatedDetail.json
                .budget as Record<string, unknown>;
              expect(
                updated.goalDirection === "income" &&
                  updated.frequency === "monthly" &&
                  Number(updated.isFlexible) === 1,
                "budget_definition_update_not_visible",
              );
              for (const table of tableNames) {
                expect(
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ) === relatedBefore.get(table),
                  `${table}_changed_during_budget_definition_update`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "Budget snapshot generation dry-run and disabled write are safe",
      run: async () => {
        const dryRunPath =
          "/prototype/repositories/budget-snapshots/lifecycle/dry-run/generate";
        const writePath =
          "/prototype/repositories/budget-snapshots/lifecycle/write/generate";
        const asOf = "2026-07-22";
        const tableNames = [
          "transactions",
          "budgets",
          "budgetSnapshots",
          "buckets",
          "categories",
          "accounts",
          "paymentMethods",
          "recipients",
          "smsImportTemplates",
        ] as const;
        const before = new Map<string, string>();
        for (const table of tableNames) {
          before.set(
            table,
            rowsFingerprint(
              await readAllTableRows(baseUrl, table, authedOptions),
            ),
          );
        }

        const duplicateSanity = calculateMissingBudgetSnapshotPlan({
          budgets: [
            {
              id: 1,
              description: "redacted fixture",
              categoryId: 1,
              amount: -1,
              frequency: "once",
              isGoal: false,
              isFlexible: false,
              isActive: true,
              dueDate: "2026-07-22",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          existingSnapshots: [
            {
              id: 1,
              budgetId: 1,
              occurrenceDate: "2026-07-22",
              dueDate: "2026-07-22",
            },
            {
              id: 2,
              budgetId: 1,
              occurrenceDate: "2026-07-22",
              dueDate: "2026-07-22",
            },
          ],
          asOf,
        });
        expect(
          duplicateSanity.conflictCount > 0 &&
            duplicateSanity.conflictCodes.includes(
              "duplicate_occurrence_snapshots",
            ),
          "budget_snapshot_duplicate_conflict_sanity_failed",
        );
        const recurrenceFixture = {
          id: 1,
          description: "redacted fixture",
          categoryId: 1,
          amount: -1,
          isGoal: false,
          isFlexible: false,
          isActive: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const scheduleKeys = (
          frequency: BudgetGenerationDefinition["frequency"],
          dueDate: string,
          horizon: string,
          frequencyDetails?: BudgetGenerationDefinition["frequencyDetails"],
        ) =>
          calculateBudgetOccurrenceSchedule(
            { ...recurrenceFixture, frequency, frequencyDetails, dueDate },
            horizon,
          ).map((row) => localDayKey(row.occurrenceDate));
        expect(
          JSON.stringify(
            scheduleKeys("monthly", "2026-01-31", "2026-03-31", {
              dayOfMonth: 31,
            }),
          ) === JSON.stringify(["2026-01-31", "2026-02-28", "2026-03-31"]) &&
            JSON.stringify(
              scheduleKeys("custom", "2026-01-01", "2026-01-11", {
                intervalDays: 5,
              }),
            ) === JSON.stringify(["2026-01-01", "2026-01-06", "2026-01-11"]) &&
            scheduleKeys("once", "2026-07-22", "2026-07-22").length === 1 &&
            effectiveGoalDirection("expense", 100) === "expense" &&
            effectiveGoalDirection("income", -100) === "income" &&
            effectiveGoalDirection(null, -100) === "expense" &&
            effectiveGoalDirection(null, 100) === "income",
          "budget_snapshot_generation_recurrence_sanity_failed",
        );

        const missingToken = await requestJson(baseUrl, dryRunPath, {
          method: "POST",
          body: { asOf },
          origin,
        });
        expectStatus(missingToken.status, 401);

        const badOrigin = await requestJson(baseUrl, dryRunPath, {
          method: "POST",
          body: { asOf },
          token,
          origin: "http://unexpected-origin.invalid",
        });
        expectStatus(badOrigin.status, 403);

        for (const testCase of [
          { body: { asOf: "not-a-date" }, code: "asOf_invalid" },
          {
            body: { asOf, unexpected: true },
            code: "unexpected_payload_field",
          },
        ]) {
          const result = await requestJson(baseUrl, dryRunPath, {
            ...authedOptions,
            method: "POST",
            body: testCase.body,
          });
          expectStatus(result.status, 400);
          expect(result.json.code === testCase.code, `${testCase.code}_not_rejected`);
        }

        const dryRun = await requestJson(baseUrl, dryRunPath, {
          ...authedOptions,
          method: "POST",
          body: { asOf },
        });
        expectStatus(dryRun.status, 200);
        expect(
          dryRun.json.ok === true &&
            dryRun.json.dryRun === true &&
            dryRun.json.wouldMutate === false &&
            dryRun.json.normalizedAsOf === asOf &&
            dryRun.json.historicalMutation === false &&
            dryRun.json.transactionLinkMutation === false,
          "budget_snapshot_generation_dry_run_invalid",
        );
        const serializedDryRun = JSON.stringify(dryRun.json);
        const dryRunSafety = dryRun.json.safety as Record<string, unknown>;
        expect(
          !serializedDryRun.includes("description") &&
            dryRunSafety.generatedIdsIncluded === false &&
            dryRunSafety.rawRowsIncluded === false,
          "budget_snapshot_generation_dry_run_not_redacted",
        );

        const invalidWrite = await requestJson(baseUrl, writePath, {
          ...authedOptions,
          method: "POST",
          body: {
            asOf,
            confirmation: BUDGET_SNAPSHOT_GENERATION_CONFIRMATION,
          },
        });
        expectStatus(invalidWrite.status, 400);
        expect(
          invalidWrite.json.code === "dry_run_reviewed_required",
          "budget_snapshot_generation_write_validation_failed_open",
        );

        if (!allowBudgetSnapshotGenerationWriteSmoke) {
          const disabled = await requestJson(baseUrl, writePath, {
            ...authedOptions,
            method: "POST",
            body: {
              asOf,
              dryRunReviewed: true,
              confirmation: BUDGET_SNAPSHOT_GENERATION_CONFIRMATION,
            },
          });
          expectStatus(disabled.status, 403);
          expect(
            disabled.json.code ===
              "budget_snapshot_generation_writes_disabled",
            "budget_snapshot_generation_write_not_disabled",
          );
        }

        for (const unsupportedPath of [
          "/prototype/repositories/budget-snapshots/lifecycle/write/prune",
          "/prototype/repositories/budget-snapshots/lifecycle/write/delete",
          "/prototype/repositories/budget-snapshots/lifecycle/write/update",
          "/prototype/repositories/budget-snapshots/lifecycle/write/repair",
        ]) {
          const result = await requestJson(baseUrl, unsupportedPath, {
            ...authedOptions,
            method: "POST",
            body: {},
          });
          expectStatus(result.status, 404);
        }

        for (const table of tableNames) {
          expect(
            rowsFingerprint(
              await readAllTableRows(baseUrl, table, authedOptions),
            ) === before.get(table),
            `${table}_changed_during_snapshot_generation_normal_smoke`,
          );
        }
      },
    },
    ...(allowBudgetSnapshotGenerationWriteSmoke
      ? [
          {
            name: "Budget snapshot generation opt-in smoke is insert-only and idempotent",
            run: async () => {
              const dryRunPath =
                "/prototype/repositories/budget-snapshots/lifecycle/dry-run/generate";
              const writePath =
                "/prototype/repositories/budget-snapshots/lifecycle/write/generate";
              const tableNames = [
                "transactions",
                "budgets",
                "budgetSnapshots",
                "buckets",
                "categories",
                "accounts",
                "paymentMethods",
                "recipients",
                "smsImportTemplates",
              ] as const;
              const rowsBefore = new Map<string, Record<string, unknown>[]>();
              for (const table of tableNames) {
                rowsBefore.set(
                  table,
                  await readAllTableRows(baseUrl, table, authedOptions),
                );
              }

              let selectedAsOf: string | undefined;
              let dryRun: Awaited<ReturnType<typeof requestJson>> | undefined;
              for (const candidateAsOf of [
                "2026-07-22",
                "2027-07-22",
                "2030-01-15",
                "2035-01-15",
              ]) {
                const candidate = await requestJson(baseUrl, dryRunPath, {
                  ...authedOptions,
                  method: "POST",
                  body: { asOf: candidateAsOf },
                });
                if (
                  candidate.status === 200 &&
                  Number(candidate.json.proposedSnapshotCount) > 0
                ) {
                  selectedAsOf = candidateAsOf;
                  dryRun = candidate;
                  break;
                }
              }
              expect(
                selectedAsOf !== undefined && dryRun !== undefined,
                "budget_snapshot_generation_smoke_requires_missing_occurrence",
              );
              const budgetsBefore = rowsBefore.get("budgets") ?? [];
              const snapshotsBefore = rowsBefore.get("budgetSnapshots") ?? [];
              const expectedPlan = calculateMissingBudgetSnapshotPlan({
                budgets: sqliteBudgetRowsForGeneration(budgetsBefore),
                existingSnapshots: sqliteSnapshotIdentities(snapshotsBefore),
                asOf: selectedAsOf as string,
              });
              expect(
                expectedPlan.validationErrors.length === 0 &&
                  expectedPlan.conflictCount === 0 &&
                  expectedPlan.proposedSnapshotCount ===
                    Number(dryRun?.json.proposedSnapshotCount),
                "budget_snapshot_generation_expected_plan_invalid",
              );

              const writeBody = {
                asOf: selectedAsOf,
                dryRunReviewed: true,
                confirmation: BUDGET_SNAPSHOT_GENERATION_CONFIRMATION,
              };
              const write = await requestJson(baseUrl, writePath, {
                ...authedOptions,
                method: "POST",
                body: writeBody,
              });
              expectStatus(write.status, 200);
              expect(
                write.json.ok === true &&
                  write.json.realWrite === true &&
                  write.json.sqliteMutated === true &&
                  Number(write.json.rowsInserted) ===
                    expectedPlan.proposedSnapshotCount,
                "budget_snapshot_generation_write_invalid",
              );
              const serializedWrite = JSON.stringify(write.json);
              const writeSafety = write.json.safety as Record<string, unknown>;
              expect(
                !serializedWrite.includes("description") &&
                  writeSafety.generatedIdsIncluded === false &&
                  writeSafety.rawRowsIncluded === false,
                "budget_snapshot_generation_write_not_redacted",
              );

              const snapshotsAfter = await readAllTableRows(
                baseUrl,
                "budgetSnapshots",
                authedOptions,
              );
              const beforeIds = new Set(
                snapshotsBefore.map((row) => Number(row.id)),
              );
              const inserted = snapshotsAfter.filter(
                (row) => !beforeIds.has(Number(row.id)),
              );
              expect(
                snapshotsAfter.length ===
                  snapshotsBefore.length + expectedPlan.proposedSnapshotCount &&
                  inserted.length === expectedPlan.proposedSnapshotCount &&
                  new Set(inserted.map((row) => Number(row.id))).size ===
                    inserted.length,
                "budget_snapshot_generation_insert_count_invalid",
              );
              expect(
                rowsFingerprint(
                  snapshotsAfter.filter((row) => beforeIds.has(Number(row.id))),
                ) === rowsFingerprint(snapshotsBefore),
                "preexisting_budget_snapshot_changed",
              );

              const expectedRows = expectedPlan.candidates
                .map((candidate) =>
                  generatedSnapshotComparable({
                    ...candidate.values,
                    occurrenceDate: candidate.values.occurrenceDate.toISOString(),
                    dueDate: candidate.values.dueDate.toISOString(),
                    frequencyDetails: candidate.values.frequencyDetails
                      ? JSON.stringify(candidate.values.frequencyDetails)
                      : null,
                    isGoal: candidate.values.isGoal ? 1 : 0,
                    isFlexible: candidate.values.isFlexible ? 1 : 0,
                    isHistorical: candidate.values.isHistorical ? 1 : 0,
                    sourceBudgetUpdatedAt:
                      candidate.values.sourceBudgetUpdatedAt instanceof Date
                        ? candidate.values.sourceBudgetUpdatedAt.toISOString()
                        : candidate.values.sourceBudgetUpdatedAt,
                  }),
                )
                .sort((left, right) =>
                  JSON.stringify(left).localeCompare(JSON.stringify(right)),
                );
              const insertedRows = inserted
                .map(generatedSnapshotComparable)
                .sort((left, right) =>
                  JSON.stringify(left).localeCompare(JSON.stringify(right)),
                );
              expect(
                rowsFingerprint(insertedRows) === rowsFingerprint(expectedRows),
                "inserted_budget_snapshots_do_not_match_plan",
              );

              for (const table of tableNames.filter(
                (table) => table !== "budgetSnapshots",
              )) {
                expect(
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ) === rowsFingerprint(rowsBefore.get(table) ?? []),
                  `${table}_changed_during_snapshot_generation_write`,
                );
              }

              const repeated = await requestJson(baseUrl, writePath, {
                ...authedOptions,
                method: "POST",
                body: writeBody,
              });
              expectStatus(repeated.status, 200);
              expect(
                repeated.json.ok === true &&
                  repeated.json.sqliteMutated === false &&
                  Number(repeated.json.rowsInserted) === 0 &&
                  Number(repeated.json.proposedSnapshotCount) === 0,
                "budget_snapshot_generation_not_idempotent",
              );
              expect(
                rowsFingerprint(
                  await readAllTableRows(
                    baseUrl,
                    "budgetSnapshots",
                    authedOptions,
                  ),
                ) === rowsFingerprint(snapshotsAfter),
                "idempotent_generation_changed_snapshots",
              );
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "SMS template dry-run and disabled write paths are safe",
      run: async () => {
        const path = "/prototype/repositories/sms-import-templates";
        const validPayload = {
          name: `Smoke SMS Template ${smsTemplateSmokeSequence}`,
          amountPattern: "Ksh\\s*([\\d,]+(?:\\.\\d{1,2})?)",
          incomePattern: "received",
        };
        const before = await readAllTableRows(
          baseUrl,
          "smsImportTemplates",
          authedOptions,
        );
        const beforeFingerprint = rowsFingerprint(before);

        const missingToken = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          { method: "POST", body: validPayload, origin },
        );
        expectStatus(missingToken.status, 401);

        const badOrigin = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            token,
            origin: "http://unexpected-origin.invalid",
            method: "POST",
            body: validPayload,
          },
        );
        expectStatus(badOrigin.status, 403);

        const invalidPattern = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: { name: "Synthetic invalid pattern", amountPattern: "(" },
          },
        );
        expectStatus(invalidPattern.status, 400);
        expect(
          invalidPattern.json.code === "amountPattern_invalid_regex",
          "sms_template_invalid_regex_not_rejected",
        );

        const invalidCapture = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: { name: "Synthetic invalid capture", amountPattern: "Ksh" },
          },
        );
        expectStatus(invalidCapture.status, 400);
        expect(
          invalidCapture.json.code === "amountPattern_capture_required",
          "sms_template_invalid_capture_not_rejected",
        );

        const unexpectedField = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: { ...validPayload, rawSms: "not allowed" },
          },
        );
        expectStatus(unexpectedField.status, 400);
        expect(
          unexpectedField.json.code === "unexpected_payload_field",
          "sms_template_unexpected_field_not_rejected",
        );

        const missingAccount = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          {
            ...authedOptions,
            method: "POST",
            body: { ...validPayload, accountId: 2147483647 },
          },
        );
        expectStatus(missingAccount.status, 400);
        expect(
          missingAccount.json.code === "account_not_found",
          "sms_template_missing_account_not_rejected",
        );

        const dryRun = await requestJson(
          baseUrl,
          `${path}/dry-run/create`,
          { ...authedOptions, method: "POST", body: validPayload },
        );
        expectStatus(dryRun.status, 200);
        expect(
          dryRun.json.ok === true &&
            dryRun.json.entity === "smsImportTemplate" &&
            dryRun.json.dryRun === true &&
            dryRun.json.wouldMutate === false,
          "sms_template_dry_run_shape_invalid",
        );
        expectNoSensitiveEcho(dryRun.json, [
          validPayload.name,
          validPayload.amountPattern,
          validPayload.incomePattern,
        ]);
        expect(
          rowsFingerprint(
            await readAllTableRows(baseUrl, "smsImportTemplates", authedOptions),
          ) === beforeFingerprint,
          "sms_template_dry_run_mutated",
        );

        for (const action of ["update", "activate", "deactivate", "delete"] as const) {
          const body =
            action === "update"
              ? { id: 2147483647, ...validPayload }
              : { id: 2147483647 };
          const unknown = await requestJson(
            baseUrl,
            `${path}/dry-run/${action}`,
            { ...authedOptions, method: "POST", body },
          );
          expectStatus(unknown.status, 404);
          expect(
            unknown.json.code === "sms_template_not_found",
            `sms_template_${action}_unknown_id_not_rejected`,
          );
        }

        const unsupported = await requestJson(
          baseUrl,
          `${path}/write/test-parse`,
          { ...authedOptions, method: "POST", body: { id: 1 } },
        );
        expectStatus(unsupported.status, 404);

        if (!allowSmsTemplateWriteSmoke) {
          const disabledWrite = await requestJson(
            baseUrl,
            `${path}/write/create`,
            {
              ...authedOptions,
              method: "POST",
              body: {
                ...validPayload,
                dryRunReviewed: true,
                confirmation: SMS_TEMPLATE_WRITE_CONFIRMATIONS.create,
              },
            },
          );
          expectStatus(disabledWrite.status, 403);
          expect(
            disabledWrite.json.code === "sms_template_writes_disabled",
            "sms_template_write_not_disabled",
          );
          expect(
            rowsFingerprint(
              await readAllTableRows(baseUrl, "smsImportTemplates", authedOptions),
            ) === beforeFingerprint,
            "disabled_sms_template_write_mutated",
          );
        }
      },
    },
    ...(allowSmsTemplateWriteSmoke
      ? [
          {
            name: "SMS template opt-in smoke mutates only disposable template rows",
            run: async () => {
              const path = "/prototype/repositories/sms-import-templates";
              const relatedTables = [
                "transactions",
                "budgets",
                "budgetSnapshots",
                "buckets",
                "categories",
                "accounts",
                "paymentMethods",
                "recipients",
              ] as const;
              const templatesBefore = await readAllTableRows(
                baseUrl,
                "smsImportTemplates",
                authedOptions,
              );
              const relatedBefore = new Map<string, string>();
              for (const table of relatedTables) {
                relatedBefore.set(
                  table,
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ),
                );
              }
              const createPayload = {
                name: `Synthetic SMS Template ${smsTemplateSmokeSequence}`,
                description: "Synthetic smoke template",
                referencePattern: "Ref\\s+([A-Z0-9]+)",
                amountPattern: "Ksh\\s*([\\d,]+(?:\\.\\d{1,2})?)",
                incomePattern: "received",
              };

              const createDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/create`,
                { ...authedOptions, method: "POST", body: createPayload },
              );
              expectStatus(createDryRun.status, 200);
              const createWrite = await requestJson(
                baseUrl,
                `${path}/write/create`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...createPayload,
                    dryRunReviewed: true,
                    confirmation: SMS_TEMPLATE_WRITE_CONFIRMATIONS.create,
                  },
                },
              );
              expectStatus(createWrite.status, 200);
              expect(
                createWrite.json.ok === true &&
                  createWrite.json.sqliteMutated === true &&
                  createWrite.json.rowsChanged === 1 &&
                  typeof createWrite.json.targetId === "number",
                "sms_template_create_write_invalid",
              );
              expectNoSensitiveEcho(createWrite.json, [
                createPayload.name,
                createPayload.description,
                createPayload.referencePattern,
                createPayload.amountPattern,
              ]);
              const targetId = createWrite.json.targetId as number;
              let templates = await readAllTableRows(
                baseUrl,
                "smsImportTemplates",
                authedOptions,
              );
              expect(
                templates.length === templatesBefore.length + 1,
                "sms_template_create_count_invalid",
              );
              let detail = await requestJson(
                baseUrl,
                `${path}/${targetId}`,
                authedOptions,
              );
              expectStatus(detail.status, 200);
              let template = detail.json.smsImportTemplate as Record<string, unknown>;
              expect(
                template.id === targetId && Number(template.isActive) === 1,
                "sms_template_create_not_visible",
              );

              const updatePayload = {
                id: targetId,
                ...createPayload,
                name: `${createPayload.name} Updated`,
                expensePattern: "sent to",
              };
              const updateDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/update`,
                { ...authedOptions, method: "POST", body: updatePayload },
              );
              expectStatus(updateDryRun.status, 200);
              const updateWrite = await requestJson(
                baseUrl,
                `${path}/write/update`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    ...updatePayload,
                    dryRunReviewed: true,
                    confirmation: SMS_TEMPLATE_WRITE_CONFIRMATIONS.update,
                  },
                },
              );
              expectStatus(updateWrite.status, 200);
              expect(
                updateWrite.json.ok === true &&
                  updateWrite.json.rowsChanged === 1,
                "sms_template_update_write_invalid",
              );
              templates = await readAllTableRows(
                baseUrl,
                "smsImportTemplates",
                authedOptions,
              );
              expect(
                templates.length === templatesBefore.length + 1,
                "sms_template_update_changed_count",
              );

              for (const action of ["deactivate", "activate"] as const) {
                const dryRun = await requestJson(
                  baseUrl,
                  `${path}/dry-run/${action}`,
                  { ...authedOptions, method: "POST", body: { id: targetId } },
                );
                expectStatus(dryRun.status, 200);
                const write = await requestJson(
                  baseUrl,
                  `${path}/write/${action}`,
                  {
                    ...authedOptions,
                    method: "POST",
                    body: {
                      id: targetId,
                      dryRunReviewed: true,
                      confirmation: SMS_TEMPLATE_WRITE_CONFIRMATIONS[action],
                    },
                  },
                );
                expectStatus(write.status, 200);
                expect(
                  write.json.sqliteMutated === true &&
                    write.json.rowsChanged === 1,
                  `sms_template_${action}_write_invalid`,
                );
                detail = await requestJson(
                  baseUrl,
                  `${path}/${targetId}`,
                  authedOptions,
                );
                expectStatus(detail.status, 200);
                template = detail.json.smsImportTemplate as Record<string, unknown>;
                expect(
                  Number(template.isActive) === (action === "activate" ? 1 : 0),
                  `sms_template_${action}_not_visible`,
                );
              }

              const deleteDryRun = await requestJson(
                baseUrl,
                `${path}/dry-run/delete`,
                { ...authedOptions, method: "POST", body: { id: targetId } },
              );
              expectStatus(deleteDryRun.status, 200);
              const deleteWrite = await requestJson(
                baseUrl,
                `${path}/write/delete`,
                {
                  ...authedOptions,
                  method: "POST",
                  body: {
                    id: targetId,
                    dryRunReviewed: true,
                    confirmation: SMS_TEMPLATE_WRITE_CONFIRMATIONS.delete,
                  },
                },
              );
              expectStatus(deleteWrite.status, 200);
              expect(
                deleteWrite.json.ok === true &&
                  deleteWrite.json.rowsChanged === 1,
                "sms_template_delete_write_invalid",
              );
              templates = await readAllTableRows(
                baseUrl,
                "smsImportTemplates",
                authedOptions,
              );
              expect(
                rowsFingerprint(templates) === rowsFingerprint(templatesBefore),
                "sms_template_delete_did_not_restore_rows",
              );
              for (const table of relatedTables) {
                expect(
                  rowsFingerprint(
                    await readAllTableRows(baseUrl, table, authedOptions),
                  ) === relatedBefore.get(table),
                  `${table}_changed_during_sms_template_write`,
                );
              }
            },
          } satisfies SmokeCheck,
        ]
      : []),
    {
      name: "transaction delete transfer repair and bulk write routes are not implemented",
      run: async () => {
        for (const action of ["delete", "transfer", "repair", "bulk"] as const) {
          const response = await requestJson(
            baseUrl,
            `/prototype/repositories/transactions/write/${action}`,
            { ...authedOptions, method: "POST", body: { id: 1 } },
          );
          expectStatus(response.status, 404);
        }
      },
    },
    {
      name: "account delete and merge dry-run/write routes are not implemented",
      run: async () => {
        for (const mode of ["dry-run", "write"] as const) {
          for (const action of ["delete", "merge"] as const) {
            const { status } = await requestJson(
              baseUrl,
              `/prototype/repositories/accounts/${mode}/${action}`,
              { ...authedOptions, method: "POST", body: { id: 1 } },
            );
            expectStatus(status, 404);
          }
        }
      },
    },
    {
      name: "bucket/category delete dry-run and write routes are not implemented",
      run: async () => {
        for (const resource of ["buckets", "categories"] as const) {
          for (const mode of ["dry-run", "write"] as const) {
            const { status } = await requestJson(
              baseUrl,
              `/prototype/repositories/${resource}/${mode}/delete`,
              { ...authedOptions, method: "POST", body: { id: 1 } },
            );
            expectStatus(status, 404);
          }
        }
      },
    },
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
    args.allowBucketCategoryWriteSmoke,
    args.allowAccountWriteSmoke,
    args.allowTransactionBasicWriteSmoke,
    args.allowTransactionCostBudgetWriteSmoke,
    args.allowTransactionTransferWriteSmoke,
    args.allowSmsTemplateWriteSmoke,
    args.allowBudgetDefinitionWriteSmoke,
    args.allowBudgetSnapshotGenerationWriteSmoke,
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

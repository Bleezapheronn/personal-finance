import Fastify, { type FastifyReply } from "fastify";
import {
  ALLOWED_ORIGINS,
  API_VERSION,
  areAccountWritesEnabled,
  areBucketCategoryWritesEnabled,
  areRecipientActiveStateWritesEnabled,
  areRecipientCreateUpdateWritesEnabled,
  areTransactionBasicWritesEnabled,
  getServerPort,
  getSqlitePath,
  READONLY_MODE,
  SERVER_HOST,
  SERVICE_MODE,
  SERVICE_NAME,
  TOKEN_HEADER_NAME,
} from "./config.js";
import {
  isKnownTableName,
  openReadOnlyDatabase,
  openWritableExistingDatabase,
  readKnownTableRowCounts,
  readPaginatedKnownTable,
} from "./lib/sqlite.js";
import {
  getLookupConfig,
  getLookupRowById,
  listLookupRows,
  lookupResources,
  type LookupFilters,
  type LookupResource,
} from "./lib/lookups.js";
import {
  activateRecipientDryRun,
  createRecipientDryRun,
  deactivateRecipientDryRun,
  recipientDryRunRequestErrorResponse,
  RecipientDryRunRequestError,
  updateRecipientDryRun,
} from "./lib/recipientDryRun.js";
import {
  activateRecipientWrite,
  createRecipientRealWrite,
  deactivateRecipientWrite,
  recipientActivateWriteDisabledResponse,
  recipientActivateWriteRequestErrorResponse,
  recipientCreateWriteDisabledResponse,
  recipientCreateWriteRequestErrorResponse,
  recipientDeactivateWriteDisabledResponse,
  recipientDeactivateWriteRequestErrorResponse,
  recipientUpdateWriteDisabledResponse,
  recipientUpdateWriteRequestErrorResponse,
  RecipientWriteRequestError,
  validateRecipientActivateWritePayload,
  validateRecipientCreateWritePayload,
  validateRecipientDeactivateWritePayload,
  validateRecipientUpdateWritePayload,
  updateRecipientRealWrite,
} from "./lib/recipientWrite.js";
import {
  bucketCategoryDryRunRequestErrorResponse,
  BucketCategoryDryRunRequestError,
  bucketDryRun,
  categoryDryRun,
} from "./lib/bucketCategoryDryRun.js";
import {
  bucketCategoryRealWrite,
  bucketCategoryWriteDisabledResponse,
  bucketCategoryWriteRequestErrorResponse,
  BucketCategoryWriteRequestError,
  validateBucketCategoryWritePayload,
} from "./lib/bucketCategoryWrite.js";
import {
  accountDryRun,
  accountDryRunRequestErrorResponse,
  AccountDryRunRequestError,
} from "./lib/accountDryRun.js";
import {
  accountRealWrite,
  accountWriteDisabledResponse,
  accountWriteRequestErrorResponse,
  AccountWriteRequestError,
  validateAccountWritePayload,
} from "./lib/accountWrite.js";
import {
  getBudgetById,
  getBudgetSnapshotById,
  isBudgetFrequency,
  listBudgets,
  listBudgetSnapshots,
  type BudgetFilters,
  type BudgetSnapshotFilters,
} from "./lib/budgets.js";
import {
  countTransactions,
  getTransactionById,
  listTransactions,
  type TransactionFilters,
} from "./lib/transactions.js";
import {
  transactionBasicDryRun,
  transactionBasicDryRunRequestErrorResponse,
  TransactionBasicDryRunRequestError,
} from "./lib/transactionBasicDryRun.js";
import {
  transactionBasicRealWrite,
  transactionBasicWriteDisabledResponse,
  transactionBasicWriteRequestErrorResponse,
  TransactionBasicWriteRequestError,
  validateTransactionBasicWritePayload,
} from "./lib/transactionBasicWrite.js";
import { readOrCreateToken } from "./tokenStore.js";

const server = Fastify({
  logger: {
    level: "info",
  },
  disableRequestLogging: true,
});

const publicPaths = new Set(["/health"]);
const DEFAULT_TABLE_READ_LIMIT = 50;
const MAX_TABLE_READ_LIMIT = 200;
const DEFAULT_LOOKUP_READ_LIMIT = 100;
const MAX_LOOKUP_READ_LIMIT = 500;
const DEFAULT_BUDGET_READ_LIMIT = 100;
const MAX_BUDGET_READ_LIMIT = 500;
const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
const CORS_ALLOW_HEADERS = `${TOKEN_HEADER_NAME}, content-type`;

const parsePaginationValue = (
  rawValue: unknown,
  defaultValue: number,
  fieldName: "limit" | "offset",
  maxLimit = MAX_TABLE_READ_LIMIT,
): number => {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (Array.isArray(rawValue) || typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new Error(`${fieldName}_invalid`);
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName}_invalid`);
  }

  if (fieldName === "limit") {
    return Math.min(parsedValue, maxLimit);
  }

  return parsedValue;
};

const parsePositiveInteger = (rawValue: unknown, fieldName: string): number => {
  if (Array.isArray(rawValue) || typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new Error(`${fieldName}_invalid`);
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName}_invalid`);
  }

  return parsedValue;
};

const parseOptionalNonNegativeInteger = (
  rawValue: unknown,
  fieldName:
    | keyof Pick<
        TransactionFilters,
        "accountId" | "categoryId" | "recipientId" | "budgetSnapshotId"
      >
    | keyof Pick<BudgetSnapshotFilters, "budgetId">
    | "bucketId"
    | "accountId",
): number | undefined => {
  if (rawValue === undefined) {
    return undefined;
  }

  if (Array.isArray(rawValue) || typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new Error(`${fieldName}_invalid`);
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName}_invalid`);
  }

  return parsedValue;
};

const parseOptionalBoolean = (
  rawValue: unknown,
  fieldName: "isTransfer" | "activeOnly" | "isGoal" | "isHistorical",
): boolean | undefined => {
  if (rawValue === undefined) {
    return undefined;
  }

  if (Array.isArray(rawValue) || typeof rawValue !== "string") {
    throw new Error(`${fieldName}_invalid`);
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "true" || normalizedValue === "1") {
    return true;
  }
  if (normalizedValue === "false" || normalizedValue === "0") {
    return false;
  }

  throw new Error(`${fieldName}_invalid`);
};

const parseOptionalDateText = (
  rawValue: unknown,
  fieldName: "dateFrom" | "dateTo",
): string | undefined => {
  if (rawValue === undefined) {
    return undefined;
  }

  if (Array.isArray(rawValue) || typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new Error(`${fieldName}_invalid`);
  }

  if (Number.isNaN(Date.parse(rawValue))) {
    throw new Error(`${fieldName}_invalid`);
  }

  return rawValue;
};

const parseTransactionFilters = (query: {
  accountId?: string;
  categoryId?: string;
  recipientId?: string;
  budgetSnapshotId?: string;
  isTransfer?: string;
  dateFrom?: string;
  dateTo?: string;
}): TransactionFilters => ({
  accountId: parseOptionalNonNegativeInteger(query.accountId, "accountId"),
  categoryId: parseOptionalNonNegativeInteger(query.categoryId, "categoryId"),
  recipientId: parseOptionalNonNegativeInteger(query.recipientId, "recipientId"),
  budgetSnapshotId: parseOptionalNonNegativeInteger(query.budgetSnapshotId, "budgetSnapshotId"),
  isTransfer: parseOptionalBoolean(query.isTransfer, "isTransfer"),
  dateFrom: parseOptionalDateText(query.dateFrom, "dateFrom"),
  dateTo: parseOptionalDateText(query.dateTo, "dateTo"),
});

const parseLookupFilters = (
  resource: LookupResource,
  query: {
    activeOnly?: string;
    bucketId?: string;
    accountId?: string;
  },
): LookupFilters => {
  const activeOnly = parseOptionalBoolean(query.activeOnly, "activeOnly");
  const bucketId = parseOptionalNonNegativeInteger(query.bucketId, "bucketId");
  const accountId = parseOptionalNonNegativeInteger(query.accountId, "accountId");

  if (bucketId !== undefined && resource !== "categories") {
    throw new Error("bucketId_unsupported");
  }
  if (accountId !== undefined && resource !== "sms-import-templates") {
    throw new Error("accountId_unsupported");
  }

  return {
    activeOnly,
    bucketId,
    accountId,
  };
};

const parseBudgetFilters = (query: {
  activeOnly?: string;
  categoryId?: string;
  accountId?: string;
  recipientId?: string;
  frequency?: string;
  isGoal?: string;
}): BudgetFilters => {
  let frequency: BudgetFilters["frequency"];
  if (query.frequency !== undefined) {
    if (Array.isArray(query.frequency) || typeof query.frequency !== "string") {
      throw new Error("frequency_invalid");
    }

    const normalizedFrequency = query.frequency.trim();
    if (!isBudgetFrequency(normalizedFrequency)) {
      throw new Error("frequency_invalid");
    }
    frequency = normalizedFrequency;
  }

  return {
    activeOnly: parseOptionalBoolean(query.activeOnly, "activeOnly"),
    categoryId: parseOptionalNonNegativeInteger(query.categoryId, "categoryId"),
    accountId: parseOptionalNonNegativeInteger(query.accountId, "accountId"),
    recipientId: parseOptionalNonNegativeInteger(query.recipientId, "recipientId"),
    frequency,
    isGoal: parseOptionalBoolean(query.isGoal, "isGoal"),
  };
};

const parseBudgetSnapshotFilters = (query: {
  budgetId?: string;
  categoryId?: string;
  accountId?: string;
  recipientId?: string;
  isHistorical?: string;
  dateFrom?: string;
  dateTo?: string;
}): BudgetSnapshotFilters => ({
  budgetId: parseOptionalNonNegativeInteger(query.budgetId, "budgetId"),
  categoryId: parseOptionalNonNegativeInteger(query.categoryId, "categoryId"),
  accountId: parseOptionalNonNegativeInteger(query.accountId, "accountId"),
  recipientId: parseOptionalNonNegativeInteger(query.recipientId, "recipientId"),
  isHistorical: parseOptionalBoolean(query.isHistorical, "isHistorical"),
  dateFrom: parseOptionalDateText(query.dateFrom, "dateFrom"),
  dateTo: parseOptionalDateText(query.dateTo, "dateTo"),
});

const sqliteUnavailableStatusCode = (error: unknown): 503 | 500 => {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Cannot open database") ||
    message.includes("unable to open database") ||
    message.includes("SQLite table")
    ? 503
    : 500;
};

const openConfiguredReadOnlyDatabase = ():
  | { ok: true; db: ReturnType<typeof openReadOnlyDatabase> }
  | { ok: false; code: "sqlite_not_configured" } => {
  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return { ok: false, code: "sqlite_not_configured" };
  }

  return { ok: true, db: openReadOnlyDatabase(sqlitePath) };
};

const openConfiguredWritableDatabase = ():
  | { ok: true; db: ReturnType<typeof openWritableExistingDatabase> }
  | { ok: false; code: "sqlite_not_configured" } => {
  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return { ok: false, code: "sqlite_not_configured" };
  }

  return { ok: true, db: openWritableExistingDatabase(sqlitePath) };
};

const applyCorsHeaders = (reply: FastifyReply, origin: string): void => {
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
};

server.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    await reply.code(403).send({
      error: "forbidden_origin",
    });
    return;
  }

  if (origin) {
    applyCorsHeaders(reply, origin);
  }

  if (request.method === "OPTIONS") {
    await reply.code(204).send();
    return;
  }

  if (publicPaths.has(request.url)) {
    return;
  }

  const configuredToken = await readOrCreateToken();
  const requestToken = request.headers[TOKEN_HEADER_NAME];

  if (requestToken !== configuredToken) {
    return reply.code(401).send({
      error: "unauthorized",
    });
  }
});

server.get("/health", async () => {
  return {
    ok: true,
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
  };
});

server.get("/metadata", async () => {
  return {
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
    apiVersion: API_VERSION,
    readonly: READONLY_MODE,
  };
});

server.get("/prototype/sqlite/row-counts", async (_request, reply) => {
  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_row_counts_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      tables: readKnownTableRowCounts(opened.db),
    };
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);

    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_row_counts_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{
  Params: { tableName: string };
  Querystring: { limit?: string; offset?: string };
}>("/prototype/sqlite/tables/:tableName", async (request, reply) => {
  const { tableName } = request.params;
  if (!isKnownTableName(tableName)) {
    return reply.code(404).send({
      ok: false,
      code: "sqlite_table_not_found",
    });
  }

  let limit: number;
  let offset: number;
  try {
    limit = parsePaginationValue(request.query.limit, DEFAULT_TABLE_READ_LIMIT, "limit");
    offset = parsePaginationValue(request.query.offset, 0, "offset");
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      code: error instanceof Error ? error.message : "pagination_invalid",
    });
  }

  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_table_read_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    const result = readPaginatedKnownTable(opened.db, tableName, limit, offset);
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      table: result.table,
      limit: result.limit,
      offset: result.offset,
      rowCount: result.rowCount,
      rows: result.rows,
    };
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);

    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_table_read_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{
  Querystring: {
    accountId?: string;
    categoryId?: string;
    recipientId?: string;
    budgetSnapshotId?: string;
    isTransfer?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}>("/prototype/repositories/transactions/count", async (request, reply) => {
  let filters: TransactionFilters;
  try {
    filters = parseTransactionFilters(request.query);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      code: error instanceof Error ? error.message : "transaction_filter_invalid",
    });
  }

  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "transaction_count_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      count: countTransactions(opened.db, filters),
    };
  } catch {
    return reply.code(500).send({
      ok: false,
      code: "transaction_count_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{
  Querystring: {
    limit?: string;
    offset?: string;
    accountId?: string;
    categoryId?: string;
    recipientId?: string;
    budgetSnapshotId?: string;
    isTransfer?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}>("/prototype/repositories/transactions", async (request, reply) => {
  let limit: number;
  let offset: number;
  let filters: TransactionFilters;
  try {
    limit = parsePaginationValue(request.query.limit, DEFAULT_TABLE_READ_LIMIT, "limit");
    offset = parsePaginationValue(request.query.offset, 0, "offset");
    filters = parseTransactionFilters(request.query);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      code: error instanceof Error ? error.message : "transaction_query_invalid",
    });
  }

  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "transaction_list_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    const result = listTransactions(opened.db, { limit, offset, filters });
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      limit: result.limit,
      offset: result.offset,
      count: result.count,
      rows: result.rows,
    };
  } catch {
    return reply.code(500).send({
      ok: false,
      code: "transaction_list_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{ Params: { id: string } }>(
  "/prototype/repositories/transactions/:id",
  async (request, reply) => {
    let id: number;
    try {
      id = parsePositiveInteger(request.params.id, "transaction_id");
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code: error instanceof Error ? error.message : "transaction_id_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "transaction_read_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const transaction = getTransactionById(opened.db, id);
      if (!transaction) {
        return reply.code(404).send({
          ok: false,
          code: "transaction_not_found",
        });
      }

      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        transaction,
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "transaction_read_failed",
      });
    } finally {
      opened.db.close();
    }
  }
);

server.get<{
  Querystring: {
    limit?: string;
    offset?: string;
    activeOnly?: string;
    categoryId?: string;
    accountId?: string;
    recipientId?: string;
    frequency?: string;
    isGoal?: string;
  };
}>("/prototype/repositories/budgets", async (request, reply) => {
  let limit: number;
  let offset: number;
  let filters: BudgetFilters;
  try {
    limit = parsePaginationValue(
      request.query.limit,
      DEFAULT_BUDGET_READ_LIMIT,
      "limit",
      MAX_BUDGET_READ_LIMIT,
    );
    offset = parsePaginationValue(request.query.offset, 0, "offset");
    filters = parseBudgetFilters(request.query);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      code: error instanceof Error ? error.message : "budget_query_invalid",
    });
  }

  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "budget_list_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    const result = listBudgets(opened.db, { limit, offset, filters });
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      resource: result.resource,
      limit: result.limit,
      offset: result.offset,
      count: result.count,
      rows: result.rows,
    };
  } catch {
    return reply.code(500).send({
      ok: false,
      code: "budget_list_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{
  Querystring: {
    limit?: string;
    offset?: string;
    categoryId?: string;
    accountId?: string;
    recipientId?: string;
    isHistorical?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}>("/prototype/repositories/budget-snapshots", async (request, reply) => {
  let limit: number;
  let offset: number;
  let filters: BudgetSnapshotFilters;
  try {
    limit = parsePaginationValue(
      request.query.limit,
      DEFAULT_BUDGET_READ_LIMIT,
      "limit",
      MAX_BUDGET_READ_LIMIT,
    );
    offset = parsePaginationValue(request.query.offset, 0, "offset");
    filters = parseBudgetSnapshotFilters(request.query);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      code: error instanceof Error ? error.message : "budget_snapshot_query_invalid",
    });
  }

  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try {
    opened = openConfiguredReadOnlyDatabase();
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);
    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "budget_snapshot_list_failed",
    });
  }

  if (!opened.ok) {
    return reply.code(503).send({
      ok: false,
      code: opened.code,
    });
  }

  try {
    const result = listBudgetSnapshots(opened.db, { limit, offset, filters });
    return {
      ok: true,
      mode: SERVICE_MODE,
      readonly: READONLY_MODE,
      resource: result.resource,
      limit: result.limit,
      offset: result.offset,
      count: result.count,
      rows: result.rows,
    };
  } catch {
    return reply.code(500).send({
      ok: false,
      code: "budget_snapshot_list_failed",
    });
  } finally {
    opened.db.close();
  }
});

server.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
  "/prototype/repositories/budgets/:id/snapshots",
  async (request, reply) => {
    let id: number;
    let limit: number;
    let offset: number;
    try {
      id = parsePositiveInteger(request.params.id, "budget_id");
      limit = parsePaginationValue(
        request.query.limit,
        DEFAULT_BUDGET_READ_LIMIT,
        "limit",
        MAX_BUDGET_READ_LIMIT,
      );
      offset = parsePaginationValue(request.query.offset, 0, "offset");
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code: error instanceof Error ? error.message : "budget_snapshot_query_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "budget_snapshot_list_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const result = listBudgetSnapshots(opened.db, {
        limit,
        offset,
        filters: { budgetId: id },
      });
      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        resource: result.resource,
        budgetId: id,
        limit: result.limit,
        offset: result.offset,
        count: result.count,
        rows: result.rows,
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "budget_snapshot_list_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.get<{ Params: { id: string } }>(
  "/prototype/repositories/budgets/:id",
  async (request, reply) => {
    let id: number;
    try {
      id = parsePositiveInteger(request.params.id, "budget_id");
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code: error instanceof Error ? error.message : "budget_id_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "budget_read_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const budget = getBudgetById(opened.db, id);
      if (!budget) {
        return reply.code(404).send({
          ok: false,
          code: "budget_not_found",
        });
      }

      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        budget,
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "budget_read_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.get<{ Params: { id: string } }>(
  "/prototype/repositories/budget-snapshots/:id",
  async (request, reply) => {
    let id: number;
    try {
      id = parsePositiveInteger(request.params.id, "budget_snapshot_id");
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code: error instanceof Error ? error.message : "budget_snapshot_id_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "budget_snapshot_read_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const budgetSnapshot = getBudgetSnapshotById(opened.db, id);
      if (!budgetSnapshot) {
        return reply.code(404).send({
          ok: false,
          code: "budget_snapshot_not_found",
        });
      }

      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        budgetSnapshot,
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "budget_snapshot_read_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

const bucketCategoryRouteConfigs = [
  {
    entity: "bucket",
    resource: "buckets",
    dryRun: bucketDryRun,
  },
  {
    entity: "category",
    resource: "categories",
    dryRun: categoryDryRun,
  },
] as const;

for (const config of bucketCategoryRouteConfigs) {
  for (const action of ["create", "update"] as const) {
    server.post<{ Body: unknown }>(
      `/prototype/repositories/${config.resource}/dry-run/${action}`,
      async (request, reply) => {
        let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
        try {
          opened = openConfiguredReadOnlyDatabase();
        } catch (error) {
          const statusCode = sqliteUnavailableStatusCode(error);
          return reply.code(statusCode).send({
            ok: false,
            code:
              statusCode === 503
                ? "sqlite_unavailable"
                : `${config.entity}_${action}_dry_run_failed`,
          });
        }

        if (!opened.ok) {
          return reply.code(503).send({
            ok: false,
            code: opened.code,
          });
        }

        try {
          const response = config.dryRun(opened.db, request.body, action);
          return response.ok ? response : reply.code(400).send(response);
        } catch (error) {
          if (error instanceof BucketCategoryDryRunRequestError) {
            return reply.code(error.statusCode).send(
              bucketCategoryDryRunRequestErrorResponse(
                config.entity,
                action,
                error.code,
              ),
            );
          }

          return reply.code(500).send({
            ok: false,
            code: `${config.entity}_${action}_dry_run_failed`,
          });
        } finally {
          opened.db.close();
        }
      },
    );

    server.post<{ Body: unknown }>(
      `/prototype/repositories/${config.resource}/write/${action}`,
      async (request, reply) => {
        try {
          validateBucketCategoryWritePayload(
            request.body,
            config.entity,
            action,
          );
        } catch (error) {
          if (error instanceof BucketCategoryWriteRequestError) {
            return reply.code(error.statusCode).send(
              bucketCategoryWriteRequestErrorResponse(
                config.entity,
                action,
                error.code,
              ),
            );
          }
          return reply.code(400).send(
            bucketCategoryWriteRequestErrorResponse(
              config.entity,
              action,
              `${config.entity}_${action}_write_invalid`,
            ),
          );
        }

        if (!areBucketCategoryWritesEnabled()) {
          return reply
            .code(403)
            .send(bucketCategoryWriteDisabledResponse(config.entity, action));
        }

        let opened: ReturnType<typeof openConfiguredWritableDatabase>;
        try {
          opened = openConfiguredWritableDatabase();
        } catch (error) {
          const statusCode = sqliteUnavailableStatusCode(error);
          return reply.code(statusCode).send({
            ok: false,
            code:
              statusCode === 503
                ? "sqlite_unavailable"
                : `${config.entity}_${action}_write_failed`,
          });
        }

        if (!opened.ok) {
          return reply.code(503).send({
            ok: false,
            code: opened.code,
          });
        }

        try {
          const response = bucketCategoryRealWrite(
            opened.db,
            request.body,
            config.entity,
            action,
          );
          if (
            response.code === "bucket_not_found" ||
            response.code === "category_not_found"
          ) {
            return reply.code(404).send(response);
          }
          return response.ok ? response : reply.code(400).send(response);
        } catch (error) {
          if (error instanceof BucketCategoryWriteRequestError) {
            return reply.code(error.statusCode).send(
              bucketCategoryWriteRequestErrorResponse(
                config.entity,
                action,
                error.code,
              ),
            );
          }
          return reply.code(500).send({
            ok: false,
            code: `${config.entity}_${action}_write_failed`,
          });
        } finally {
          opened.db.close();
        }
      },
    );
  }
}

for (const action of ["create", "update"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/accounts/dry-run/${action}`,
    async (request, reply) => {
      let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
      try {
        opened = openConfiguredReadOnlyDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code:
            statusCode === 503
              ? "sqlite_unavailable"
              : `account_${action}_dry_run_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({
          ok: false,
          code: opened.code,
        });
      }

      try {
        const response = accountDryRun(opened.db, request.body, action);
        if (response.code === "account_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof AccountDryRunRequestError) {
          return reply
            .code(error.statusCode)
            .send(accountDryRunRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `account_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/accounts/write/${action}`,
    async (request, reply) => {
      try {
        validateAccountWritePayload(request.body, action);
      } catch (error) {
        if (error instanceof AccountWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(accountWriteRequestErrorResponse(action, error.code));
        }
        return reply
          .code(400)
          .send(
            accountWriteRequestErrorResponse(
              action,
              `account_${action}_write_invalid`,
            ),
          );
      }

      if (!areAccountWritesEnabled()) {
        return reply.code(403).send(accountWriteDisabledResponse(action));
      }

      let opened: ReturnType<typeof openConfiguredWritableDatabase>;
      try {
        opened = openConfiguredWritableDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code:
            statusCode === 503
              ? "sqlite_unavailable"
              : `account_${action}_write_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({
          ok: false,
          code: opened.code,
        });
      }

      try {
        const response = accountRealWrite(opened.db, request.body, action);
        if (response.code === "account_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof AccountWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(accountWriteRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `account_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

for (const action of ["create", "update"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/transactions/dry-run/${action}`,
    async (request, reply) => {
      let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
      try {
        opened = openConfiguredReadOnlyDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code:
            statusCode === 503
              ? "sqlite_unavailable"
              : `transaction_${action}_dry_run_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({
          ok: false,
          code: opened.code,
        });
      }

      try {
        const response = transactionBasicDryRun(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "transaction_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof TransactionBasicDryRunRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              transactionBasicDryRunRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `transaction_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/transactions/write/${action}`,
    async (request, reply) => {
      try {
        validateTransactionBasicWritePayload(request.body, action);
      } catch (error) {
        if (error instanceof TransactionBasicWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              transactionBasicWriteRequestErrorResponse(action, error.code),
            );
        }
        return reply
          .code(400)
          .send(
            transactionBasicWriteRequestErrorResponse(
              action,
              `transaction_${action}_write_invalid`,
            ),
          );
      }

      if (!areTransactionBasicWritesEnabled()) {
        return reply
          .code(403)
          .send(transactionBasicWriteDisabledResponse(action));
      }

      let opened: ReturnType<typeof openConfiguredWritableDatabase>;
      try {
        opened = openConfiguredWritableDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code:
            statusCode === 503
              ? "sqlite_unavailable"
              : `transaction_${action}_write_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({
          ok: false,
          code: opened.code,
        });
      }

      try {
        const response = transactionBasicRealWrite(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "transaction_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof TransactionBasicWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              transactionBasicWriteRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `transaction_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/dry-run/create",
  async (request, reply) => {
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_create_dry_run_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      return createRecipientDryRun(opened.db, request.body);
    } catch (error) {
      if (error instanceof RecipientDryRunRequestError) {
        return reply.code(error.statusCode).send({
          ...recipientDryRunRequestErrorResponse("create", error.code),
          code: error.code,
        });
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_create_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/dry-run/update",
  async (request, reply) => {
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_update_dry_run_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      return updateRecipientDryRun(opened.db, request.body);
    } catch (error) {
      if (error instanceof RecipientDryRunRequestError) {
        return reply.code(error.statusCode).send({
          ...recipientDryRunRequestErrorResponse("update", error.code),
          code: error.code,
        });
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_update_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/dry-run/activate",
  async (request, reply) => {
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_activate_dry_run_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      return activateRecipientDryRun(opened.db, request.body);
    } catch (error) {
      if (error instanceof RecipientDryRunRequestError) {
        return reply.code(error.statusCode).send({
          ...recipientDryRunRequestErrorResponse("activate", error.code),
          code: error.code,
        });
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_activate_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/write/activate",
  async (request, reply) => {
    let validatedPayload: ReturnType<typeof validateRecipientActivateWritePayload>;
    try {
      validatedPayload = validateRecipientActivateWritePayload(request.body);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientActivateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(400).send(
        recipientActivateWriteRequestErrorResponse("recipient_activate_write_invalid"),
      );
    }

    if (!areRecipientActiveStateWritesEnabled()) {
      return reply
        .code(403)
        .send(recipientActivateWriteDisabledResponse(validatedPayload.id));
    }

    let opened: ReturnType<typeof openConfiguredWritableDatabase>;
    try {
      opened = openConfiguredWritableDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_activate_write_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const response = activateRecipientWrite(opened.db, request.body);
      if (response.code === "recipient_not_found") {
        return reply.code(404).send(response);
      }
      return response;
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientActivateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_activate_write_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/write/create",
  async (request, reply) => {
    let validatedPayload: ReturnType<typeof validateRecipientCreateWritePayload>;
    try {
      validatedPayload = validateRecipientCreateWritePayload(request.body);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientCreateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(400).send(
        recipientCreateWriteRequestErrorResponse("recipient_create_write_invalid"),
      );
    }

    if (!areRecipientCreateUpdateWritesEnabled()) {
      return reply
        .code(403)
        .send(recipientCreateWriteDisabledResponse(validatedPayload));
    }

    let opened: ReturnType<typeof openConfiguredWritableDatabase>;
    try {
      opened = openConfiguredWritableDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_create_write_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const response = createRecipientRealWrite(opened.db, request.body);
      return response.ok ? response : reply.code(400).send(response);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientCreateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_create_write_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/write/update",
  async (request, reply) => {
    let validatedPayload: ReturnType<typeof validateRecipientUpdateWritePayload>;
    try {
      validatedPayload = validateRecipientUpdateWritePayload(request.body);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientUpdateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(400).send(
        recipientUpdateWriteRequestErrorResponse("recipient_update_write_invalid"),
      );
    }

    if (!areRecipientCreateUpdateWritesEnabled()) {
      return reply
        .code(403)
        .send(recipientUpdateWriteDisabledResponse(validatedPayload));
    }

    let opened: ReturnType<typeof openConfiguredWritableDatabase>;
    try {
      opened = openConfiguredWritableDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_update_write_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const response = updateRecipientRealWrite(opened.db, request.body);
      if (response.code === "recipient_not_found") {
        return reply.code(404).send(response);
      }
      return response.ok ? response : reply.code(400).send(response);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientUpdateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_update_write_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/write/deactivate",
  async (request, reply) => {
    let validatedPayload: ReturnType<typeof validateRecipientDeactivateWritePayload>;
    try {
      validatedPayload = validateRecipientDeactivateWritePayload(request.body);
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientDeactivateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(400).send(
        recipientDeactivateWriteRequestErrorResponse("recipient_deactivate_write_invalid"),
      );
    }

    if (!areRecipientActiveStateWritesEnabled()) {
      return reply
        .code(403)
        .send(recipientDeactivateWriteDisabledResponse(validatedPayload.id));
    }

    let opened: ReturnType<typeof openConfiguredWritableDatabase>;
    try {
      opened = openConfiguredWritableDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_deactivate_write_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const response = deactivateRecipientWrite(opened.db, request.body);
      if (response.code === "recipient_not_found") {
        return reply.code(404).send(response);
      }
      return response;
    } catch (error) {
      if (error instanceof RecipientWriteRequestError) {
        return reply.code(error.statusCode).send(
          recipientDeactivateWriteRequestErrorResponse(error.code),
        );
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_deactivate_write_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/recipients/dry-run/deactivate",
  async (request, reply) => {
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "recipient_deactivate_dry_run_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      return deactivateRecipientDryRun(opened.db, request.body);
    } catch (error) {
      if (error instanceof RecipientDryRunRequestError) {
        return reply.code(error.statusCode).send({
          ...recipientDryRunRequestErrorResponse("deactivate", error.code),
          code: error.code,
        });
      }

      return reply.code(500).send({
        ok: false,
        code: "recipient_deactivate_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

for (const resource of lookupResources) {
  server.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      activeOnly?: string;
      bucketId?: string;
      accountId?: string;
    };
  }>(`/prototype/repositories/${resource}`, async (request, reply) => {
    let limit: number;
    let offset: number;
    let filters: LookupFilters;
    try {
      limit = parsePaginationValue(
        request.query.limit,
        DEFAULT_LOOKUP_READ_LIMIT,
        "limit",
        MAX_LOOKUP_READ_LIMIT,
      );
      offset = parsePaginationValue(request.query.offset, 0, "offset");
      filters = parseLookupFilters(resource, request.query);
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code: error instanceof Error ? error.message : "lookup_query_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch (error) {
      const statusCode = sqliteUnavailableStatusCode(error);
      return reply.code(statusCode).send({
        ok: false,
        code: statusCode === 503 ? "sqlite_unavailable" : "lookup_list_failed",
      });
    }

    if (!opened.ok) {
      return reply.code(503).send({
        ok: false,
        code: opened.code,
      });
    }

    try {
      const result = listLookupRows(opened.db, { resource, limit, offset, filters });
      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        resource: result.resource,
        limit: result.limit,
        offset: result.offset,
        count: result.count,
        rows: result.rows,
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "lookup_list_failed",
      });
    } finally {
      opened.db.close();
    }
  });

  server.get<{ Params: { id: string } }>(
    `/prototype/repositories/${resource}/:id`,
    async (request, reply) => {
      let id: number;
      try {
        id = parsePositiveInteger(request.params.id, `${resource}_id`);
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          code: error instanceof Error ? error.message : "lookup_id_invalid",
        });
      }

      let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
      try {
        opened = openConfiguredReadOnlyDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code: statusCode === 503 ? "sqlite_unavailable" : "lookup_read_failed",
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({
          ok: false,
          code: opened.code,
        });
      }

      try {
        const row = getLookupRowById(opened.db, resource, id);
        if (!row) {
          return reply.code(404).send({
            ok: false,
            code: "lookup_not_found",
          });
        }

        return {
          ok: true,
          mode: SERVICE_MODE,
          readonly: READONLY_MODE,
          [getLookupConfig(resource).detailKey]: row,
        };
      } catch {
        return reply.code(500).send({
          ok: false,
          code: "lookup_read_failed",
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

const start = async (): Promise<void> => {
  const port = getServerPort();
  await readOrCreateToken();

  await server.listen({
    host: SERVER_HOST,
    port,
  });

  server.log.info(
    `${SERVICE_NAME} ${SERVICE_MODE} listening on http://${SERVER_HOST}:${port}`,
  );
};

start().catch((error) => {
  server.log.error(error, "Failed to start local API server");
  process.exit(1);
});

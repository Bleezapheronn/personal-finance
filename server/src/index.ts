import Fastify from "fastify";
import {
  ALLOWED_ORIGINS,
  API_VERSION,
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
  readKnownTableRowCounts,
  readPaginatedKnownTable,
} from "./lib/sqlite.js";
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

const parsePaginationValue = (
  rawValue: unknown,
  defaultValue: number,
  fieldName: "limit" | "offset",
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
    return Math.min(parsedValue, MAX_TABLE_READ_LIMIT);
  }

  return parsedValue;
};

const sqliteUnavailableStatusCode = (error: unknown): 503 | 500 => {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Cannot open database") ||
    message.includes("unable to open database") ||
    message.includes("SQLite table")
    ? 503
    : 500;
};

server.addHook("onRequest", async (request, reply) => {
  if (publicPaths.has(request.url)) {
    return;
  }

  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    await reply.code(403).send({
      error: "forbidden_origin",
    });
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
  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return reply.code(503).send({
      ok: false,
      code: "sqlite_not_configured",
    });
  }

  try {
    const db = openReadOnlyDatabase(sqlitePath);
    try {
      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        tables: readKnownTableRowCounts(db),
      };
    } finally {
      db.close();
    }
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);

    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_row_counts_failed",
    });
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

  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return reply.code(503).send({
      ok: false,
      code: "sqlite_not_configured",
    });
  }

  try {
    const db = openReadOnlyDatabase(sqlitePath);
    try {
      const result = readPaginatedKnownTable(db, tableName, limit, offset);
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
    } finally {
      db.close();
    }
  } catch (error) {
    const statusCode = sqliteUnavailableStatusCode(error);

    return reply.code(statusCode).send({
      ok: false,
      code: statusCode === 503 ? "sqlite_unavailable" : "sqlite_table_read_failed",
    });
  }
});

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

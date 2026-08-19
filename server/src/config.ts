export const SERVER_HOST = "127.0.0.1" as const;
export const DEFAULT_SERVER_PORT = 3147;

export const SERVICE_NAME = "personal-finance-local-api" as const;
export const SERVICE_MODE = "local" as const;
export const API_VERSION = "0.1.0" as const;
export const TOKEN_HEADER_NAME = "x-personal-finance-token" as const;
export const TOKEN_FILE_NAME = ".server-token" as const;
export const TOKEN_FILE_PATH_ENV_VAR =
  "PERSONAL_FINANCE_TOKEN_FILE_PATH" as const;
export const ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR =
  "PERSONAL_FINANCE_ADDITIONAL_ALLOWED_ORIGIN" as const;
export const SQLITE_PATH_ENV_VAR = "PERSONAL_FINANCE_SQLITE_PATH" as const;

const configuredAdditionalOrigin =
  process.env[ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR]?.trim();

let configuredLoopbackOrigins: string[] = [];

if (configuredAdditionalOrigin) {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(configuredAdditionalOrigin);
  } catch {
    throw new Error("PERSONAL_FINANCE_ADDITIONAL_ALLOWED_ORIGIN must be a local HTTP origin.");
  }
  if (
    parsedOrigin.protocol !== "http:" ||
    (parsedOrigin.hostname !== "127.0.0.1" &&
      parsedOrigin.hostname !== "localhost") ||
    parsedOrigin.username !== "" ||
    parsedOrigin.password !== "" ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search !== "" ||
    parsedOrigin.hash !== ""
  ) {
    throw new Error("PERSONAL_FINANCE_ADDITIONAL_ALLOWED_ORIGIN must be a local HTTP origin.");
  }
  const alternateOrigin = new URL(parsedOrigin.origin);
  alternateOrigin.hostname = parsedOrigin.hostname === "localhost" ? "127.0.0.1" : "localhost";
  configuredLoopbackOrigins = [parsedOrigin.origin, alternateOrigin.origin];
}

export const ALLOWED_ORIGINS = new Set([
  "http://localhost:8100",
  "http://127.0.0.1:8100",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...configuredLoopbackOrigins,
]);

export const getServerPort = (): number => {
  const rawPort = process.env.PORT;
  if (!rawPort) return DEFAULT_SERVER_PORT;

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return parsedPort;
};

export const getDataDir = (): string =>
  process.env.PERSONAL_FINANCE_DATA_DIR || "C:\\dev\\personal-finance-data";

export const getTokenFilePath = (): string | undefined => {
  const tokenPath = process.env[TOKEN_FILE_PATH_ENV_VAR];
  return tokenPath && tokenPath.trim().length > 0 ? tokenPath : undefined;
};

export const getSqlitePath = (): string | undefined => {
  const sqlitePath = process.env[SQLITE_PATH_ENV_VAR];
  return sqlitePath && sqlitePath.trim().length > 0 ? sqlitePath : undefined;
};

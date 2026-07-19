export const SERVER_HOST = "127.0.0.1" as const;
export const DEFAULT_SERVER_PORT = 3147;

export const SERVICE_NAME = "personal-finance-local-api" as const;
export const SERVICE_MODE = "prototype" as const;
export const API_VERSION = "0.1.0" as const;
export const READONLY_MODE = true as const;
export const TOKEN_HEADER_NAME = "x-personal-finance-token" as const;
export const TOKEN_FILE_NAME = ".server-token" as const;
export const SQLITE_PATH_ENV_VAR = "PERSONAL_FINANCE_SQLITE_PATH" as const;
export const RECIPIENT_ACTIVE_STATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES" as const;
export const RECIPIENT_CREATE_UPDATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES" as const;
export const BUCKET_CATEGORY_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES" as const;
export const ACCOUNT_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES" as const;
export const TRANSACTION_BASIC_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES" as const;
export const TRANSACTION_COST_BUDGET_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_COST_BUDGET_WRITES" as const;
export const TRANSACTION_TRANSFER_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_TRANSFER_WRITES" as const;
export const SMS_TEMPLATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_SMS_TEMPLATE_WRITES" as const;
export const BUDGET_DEFINITION_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_DEFINITION_WRITES" as const;

export const ALLOWED_ORIGINS = new Set([
  "http://localhost:8100",
  "http://127.0.0.1:8100",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export const getServerPort = (): number => {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    return DEFAULT_SERVER_PORT;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsedPort;
};

export const getDataDir = (): string => {
  return process.env.PERSONAL_FINANCE_DATA_DIR || "C:\\dev\\personal-finance-data";
};

export const getSqlitePath = (): string | undefined => {
  const sqlitePath = process.env[SQLITE_PATH_ENV_VAR];
  return sqlitePath && sqlitePath.trim().length > 0 ? sqlitePath : undefined;
};

export const areRecipientActiveStateWritesEnabled = (): boolean =>
  process.env[RECIPIENT_ACTIVE_STATE_WRITES_ENV_VAR] === "true";

export const areRecipientCreateUpdateWritesEnabled = (): boolean =>
  process.env[RECIPIENT_CREATE_UPDATE_WRITES_ENV_VAR] === "true";

export const areBucketCategoryWritesEnabled = (): boolean =>
  process.env[BUCKET_CATEGORY_WRITES_ENV_VAR] === "true";

export const areAccountWritesEnabled = (): boolean =>
  process.env[ACCOUNT_WRITES_ENV_VAR] === "true";

export const areTransactionBasicWritesEnabled = (): boolean =>
  process.env[TRANSACTION_BASIC_WRITES_ENV_VAR] === "true";

export const areTransactionCostBudgetWritesEnabled = (): boolean =>
  process.env[TRANSACTION_COST_BUDGET_WRITES_ENV_VAR] === "true";

export const areTransactionTransferWritesEnabled = (): boolean =>
  process.env[TRANSACTION_TRANSFER_WRITES_ENV_VAR] === "true";

export const areSmsTemplateWritesEnabled = (): boolean =>
  process.env[SMS_TEMPLATE_WRITES_ENV_VAR] === "true";

export const areBudgetDefinitionWritesEnabled = (): boolean =>
  process.env[BUDGET_DEFINITION_WRITES_ENV_VAR] === "true";

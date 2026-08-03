export const SERVER_HOST = "127.0.0.1" as const;
export const DEFAULT_SERVER_PORT = 3147;

export const SERVICE_NAME = "personal-finance-local-api" as const;
export const SERVICE_MODE = "prototype" as const;
export const API_VERSION = "0.1.0" as const;
export const READONLY_MODE = true as const;
export const TOKEN_HEADER_NAME = "x-personal-finance-token" as const;
export const TOKEN_FILE_NAME = ".server-token" as const;
export const TOKEN_FILE_PATH_ENV_VAR =
  "PERSONAL_FINANCE_TOKEN_FILE_PATH" as const;
export const AUTHORITY_PROFILE_PATH_ENV_VAR =
  "PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH" as const;
export const ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR =
  "PERSONAL_FINANCE_ADDITIONAL_ALLOWED_ORIGIN" as const;
export const SQLITE_PATH_ENV_VAR = "PERSONAL_FINANCE_SQLITE_PATH" as const;
export const SQLITE_AUTHORITY_ENABLED_ENV_VAR =
  "PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED" as const;
export const SQLITE_CUTOVER_MANIFEST_PATH_ENV_VAR =
  "PERSONAL_FINANCE_SQLITE_CUTOVER_MANIFEST_PATH" as const;
export const RECIPIENT_ACTIVE_STATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES" as const;
export const RECIPIENT_CREATE_UPDATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES" as const;
export const RECIPIENT_DELETE_MERGE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_RECIPIENT_DELETE_MERGE_WRITES" as const;
export const BUCKET_CATEGORY_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES" as const;
export const ACCOUNT_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES" as const;
export const ACCOUNT_DELETE_MERGE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_ACCOUNT_DELETE_MERGE_WRITES" as const;
export const CATEGORY_DELETE_MERGE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_CATEGORY_DELETE_MERGE_WRITES" as const;
export const BUCKET_DELETE_MERGE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUCKET_DELETE_MERGE_WRITES" as const;
export const LOOKUP_ACTIVE_STATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_LOOKUP_ACTIVE_STATE_WRITES" as const;
export const BUCKET_REORDER_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUCKET_REORDER_WRITES" as const;
export const TRANSACTION_BASIC_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES" as const;
export const TRANSACTION_COST_BUDGET_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_COST_BUDGET_WRITES" as const;
export const TRANSACTION_TRANSFER_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_TRANSFER_WRITES" as const;
export const TRANSACTION_DELETE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_TRANSACTION_DELETE_WRITES" as const;
export const SMS_TEMPLATE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_SMS_TEMPLATE_WRITES" as const;
export const BUDGET_DEFINITION_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_DEFINITION_WRITES" as const;
export const BUDGET_SNAPSHOT_GENERATION_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_SNAPSHOT_GENERATION_WRITES" as const;
export const BUDGET_LIFECYCLE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_LIFECYCLE_WRITES" as const;
export const BUDGET_DELETE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_DELETE_WRITES" as const;
export const BUDGET_SNAPSHOT_OCCURRENCE_WRITES_ENV_VAR =
  "PERSONAL_FINANCE_ENABLE_BUDGET_SNAPSHOT_OCCURRENCE_WRITES" as const;

const configuredAdditionalOrigin =
  process.env[ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR]?.trim();

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
}

export const ALLOWED_ORIGINS = new Set([
  "http://localhost:8100",
  "http://127.0.0.1:8100",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(configuredAdditionalOrigin ? [configuredAdditionalOrigin] : []),
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

export const getTokenFilePath = (): string | undefined => {
  const tokenPath = process.env[TOKEN_FILE_PATH_ENV_VAR];
  return tokenPath && tokenPath.trim().length > 0 ? tokenPath : undefined;
};

export const getSqlitePath = (): string | undefined => {
  const sqlitePath = process.env[SQLITE_PATH_ENV_VAR];
  return sqlitePath && sqlitePath.trim().length > 0 ? sqlitePath : undefined;
};

export const isSqliteAuthorityEnabled = (): boolean =>
  process.env[SQLITE_AUTHORITY_ENABLED_ENV_VAR] === "true";

export const getSqliteCutoverManifestPath = (): string | undefined => {
  const manifestPath = process.env[SQLITE_CUTOVER_MANIFEST_PATH_ENV_VAR];
  return manifestPath && manifestPath.trim().length > 0
    ? manifestPath
    : undefined;
};

// SQLite is the normal local runtime. These routes remain protected by the
// existing authenticated, validated mutation contracts; they are no longer
// migration/profile capability switches.
export const areRecipientActiveStateWritesEnabled = (): boolean => true;

export const areRecipientCreateUpdateWritesEnabled = (): boolean => true;

export const areRecipientDeleteMergeWritesEnabled = (): boolean => true;

export const areBucketCategoryWritesEnabled = (): boolean => true;

export const areAccountWritesEnabled = (): boolean => true;

export const areAccountDeleteMergeWritesEnabled = (): boolean => true;

export const areCategoryDeleteMergeWritesEnabled = (): boolean => true;

export const areBucketDeleteMergeWritesEnabled = (): boolean => true;

export const areLookupActiveStateWritesEnabled = (): boolean => true;

export const areBucketReorderWritesEnabled = (): boolean => true;

export const areTransactionBasicWritesEnabled = (): boolean => true;

export const areTransactionCostBudgetWritesEnabled = (): boolean => true;

export const areTransactionTransferWritesEnabled = (): boolean => true;

export const areTransactionDeleteWritesEnabled = (): boolean => true;

export const areSmsTemplateWritesEnabled = (): boolean => true;

export const areBudgetDefinitionWritesEnabled = (): boolean => true;

export const areBudgetSnapshotGenerationWritesEnabled = (): boolean => true;

export const areBudgetLifecycleWritesEnabled = (): boolean => true;

export const areBudgetDeleteWritesEnabled = (): boolean => true;

export const areBudgetSnapshotOccurrenceWritesEnabled = (): boolean => true;

import {
  LocalApiError,
  getLocalApiClientConfig,
  localApiGet,
} from "../api/localApiClient";
import {
  getRepositoryBackend,
  isSqliteAuthorityRehearsalBackend,
  type RepositoryBackend,
} from "./adapterSelection";

export const SQLITE_AUTHORITY_REHEARSAL_ACKNOWLEDGEMENT_FLAG =
  "VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL";

export const REQUIRED_SQLITE_REHEARSAL_CAPABILITIES = [
  "recipientActiveStateWrites",
  "recipientCreateUpdateWrites",
  "bucketCategoryWrites",
  "accountWrites",
  "transactionBasicWrites",
  "transactionCostBudgetWrites",
  "transactionTransferWrites",
  "smsTemplateWrites",
  "budgetDefinitionWrites",
] as const;

export type SqliteRehearsalCapability =
  (typeof REQUIRED_SQLITE_REHEARSAL_CAPABILITIES)[number];

interface WriteCapabilitiesResponse {
  ok?: unknown;
  mode?: unknown;
  storageMode?: unknown;
  authoritative?: unknown;
  capabilities?: unknown;
  unsupportedOperations?: unknown;
  safety?: unknown;
}

export interface SqliteAuthorityRehearsalReadiness {
  mode: RepositoryBackend;
  selected: boolean;
  acknowledged: boolean;
  checking: boolean;
  ready: boolean;
  apiAvailable: boolean;
  missingCapabilities: SqliteRehearsalCapability[];
  missingRequirements: string[];
  unsupportedOperations: string[];
  code?: string;
  message: string;
}

const envValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
};

export const isSqliteAuthorityRehearsalAcknowledged = (): boolean =>
  envValue(SQLITE_AUTHORITY_REHEARSAL_ACKNOWLEDGEMENT_FLAG) === "true";

const initialReadiness = (
  mode: RepositoryBackend = getRepositoryBackend(),
): SqliteAuthorityRehearsalReadiness => {
  const selected = isSqliteAuthorityRehearsalBackend(mode);
  const acknowledged = isSqliteAuthorityRehearsalAcknowledged();

  if (!selected) {
    return {
      mode,
      selected: false,
      acknowledged,
      checking: false,
      ready: false,
      apiAvailable: false,
      missingCapabilities: [],
      missingRequirements: [],
      unsupportedOperations: [],
      message: "SQLite authority rehearsal is not selected.",
    };
  }

  return {
    mode,
    selected: true,
    acknowledged,
    checking: acknowledged,
    ready: false,
    apiAvailable: false,
    missingCapabilities: [],
    missingRequirements: acknowledged ? [] : ["rehearsal_acknowledgement"],
    unsupportedOperations: [],
    code: acknowledged ? undefined : "rehearsal_acknowledgement_missing",
    message: acknowledged
      ? "Checking required local API capabilities."
      : "SQLite authority rehearsal acknowledgement is missing. Writes are disabled.",
  };
};

export const getInitialSqliteAuthorityRehearsalReadiness =
  initialReadiness;

const invalidReadiness = (
  code: string,
  message: string,
  missingRequirements: string[] = [],
): SqliteAuthorityRehearsalReadiness => ({
  ...initialReadiness("http-sqlite-rehearsal"),
  checking: false,
  ready: false,
  apiAvailable: false,
  missingRequirements,
  code,
  message,
});

export const normalizeSqliteAuthorityRehearsalCapabilities = (
  response: WriteCapabilitiesResponse,
): SqliteAuthorityRehearsalReadiness => {
  if (
    response.ok !== true ||
    response.mode !== "prototype" ||
    response.storageMode !== "sqlite-disposable" ||
    response.authoritative !== false ||
    typeof response.capabilities !== "object" ||
    response.capabilities === null ||
    !Array.isArray(response.unsupportedOperations) ||
    typeof response.safety !== "object" ||
    response.safety === null
  ) {
    return invalidReadiness(
      "write_capabilities_response_invalid",
      "Local API capability response is invalid. Writes are disabled.",
      ["valid_capability_response"],
    );
  }

  const capabilities = response.capabilities as Record<string, unknown>;
  if (
    REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.some(
      (key) => typeof capabilities[key] !== "boolean",
    ) ||
    response.unsupportedOperations.some((value) => typeof value !== "string")
  ) {
    return invalidReadiness(
      "write_capabilities_response_invalid",
      "Local API capability response is invalid. Writes are disabled.",
      ["valid_capability_response"],
    );
  }

  const safety = response.safety as Record<string, unknown>;
  if (
    safety.endpointReadOnly !== true ||
    safety.sqliteAvailable !== true ||
    safety.dexieAccessed !== false ||
    safety.filesWritten !== false ||
    safety.rawConfigurationIncluded !== false
  ) {
    return invalidReadiness(
      "sqlite_rehearsal_storage_unavailable",
      "Disposable SQLite is unavailable or its safety status is invalid. Writes are disabled.",
      ["disposable_sqlite_available"],
    );
  }

  const missingCapabilities = REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.filter(
    (key) => capabilities[key] !== true,
  );
  const ready = missingCapabilities.length === 0;

  return {
    mode: "http-sqlite-rehearsal",
    selected: true,
    acknowledged: true,
    checking: false,
    ready,
    apiAvailable: true,
    missingCapabilities,
    missingRequirements: [],
    unsupportedOperations: [...response.unsupportedOperations] as string[],
    code: ready ? undefined : "required_write_capabilities_missing",
    message: ready
      ? "All required disposable SQLite write capabilities are available."
      : "Required local API capabilities are missing. Writes are disabled.",
  };
};

export const loadSqliteAuthorityRehearsalReadiness = async (): Promise<SqliteAuthorityRehearsalReadiness> => {
  const initial = initialReadiness();
  if (!initial.selected || !initial.acknowledged) {
    return initial;
  }

  try {
    getLocalApiClientConfig();
    const response = await localApiGet<WriteCapabilitiesResponse>(
      "/prototype/write-capabilities",
    );
    return normalizeSqliteAuthorityRehearsalCapabilities(response);
  } catch (error) {
    const code =
      error instanceof LocalApiError
        ? error.code
        : "write_capabilities_request_failed";
    const missingRequirement =
      code === "local_api_base_url_missing"
        ? "local_api_url"
        : code === "local_api_token_missing"
          ? "local_api_token"
          : "local_api_capability_check";

    return invalidReadiness(
      code,
      "Local API capabilities are unavailable. Writes are disabled.",
      [missingRequirement],
    );
  }
};

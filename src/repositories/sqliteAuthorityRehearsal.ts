import {
  LocalApiError,
  getLocalApiClientConfig,
  localApiGet,
} from "../api/localApiClient";
import {
  getRepositoryBackend,
  isSqliteAuthoritativeBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "./adapterSelection";

export const SQLITE_AUTHORITY_REHEARSAL_ACKNOWLEDGEMENT_FLAG =
  "VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL";
export const SQLITE_AUTHORITY_ENABLED_FLAG =
  "VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED";

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
  "budgetSnapshotGenerationWrites",
] as const;

export type SqliteRehearsalCapability =
  (typeof REQUIRED_SQLITE_REHEARSAL_CAPABILITIES)[number];

export const REQUIRED_SQLITE_UNSUPPORTED_OPERATIONS = [
  "recipient_delete",
  "recipient_merge",
  "recipient_reference_reassignment",
  "bucket_category_delete",
  "bucket_reorder",
  "bucket_category_active_state",
  "account_delete",
  "account_merge",
  "account_active_state",
  "account_reference_migration",
  "transaction_delete",
  "transaction_duplicate_import_export",
  "transfer_pair_repair",
  "budget_definition_delete",
  "budget_snapshot_editing",
  "budget_snapshot_deletion",
  "budget_snapshot_pruning",
  "budget_snapshot_repair",
  "historical_snapshot_relink",
  "sms_parse_or_import",
] as const;

interface WriteCapabilitiesResponse {
  ok?: unknown;
  mode?: unknown;
  storageMode?: unknown;
  authoritative?: unknown;
  cutoverVerified?: unknown;
  backupVerified?: unknown;
  rollbackAvailable?: unknown;
  missingRequirements?: unknown;
  capabilities?: unknown;
  unsupportedOperations?: unknown;
  safety?: unknown;
}

interface MetadataResponse {
  mode?: unknown;
  storageMode?: unknown;
  authoritative?: unknown;
  cutoverVerified?: unknown;
  backupVerified?: unknown;
  rollbackAvailable?: unknown;
  missingRequirements?: unknown;
}

interface AuthorityReadinessResponse extends MetadataResponse {
  ok?: unknown;
  authorityEnabled?: unknown;
  ready?: unknown;
  requiredCapabilities?: unknown;
  unsupportedOperations?: unknown;
}

export interface SqliteAuthorityRehearsalReadiness {
  mode: RepositoryBackend;
  selected: boolean;
  authoritativeMode: boolean;
  acknowledged: boolean;
  checking: boolean;
  ready: boolean;
  apiAvailable: boolean;
  missingCapabilities: SqliteRehearsalCapability[];
  missingRequirements: string[];
  unsupportedOperations: string[];
  transactionDeleteWritesAvailable: boolean;
  budgetLifecycleWritesAvailable: boolean;
  recipientDeleteMergeWritesAvailable: boolean;
  accountDeleteMergeWritesAvailable: boolean;
  categoryDeleteMergeWritesAvailable: boolean;
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

export const isSqliteAuthorityEnabledInFrontend = (): boolean =>
  envValue(SQLITE_AUTHORITY_ENABLED_FLAG) === "true";

const initialReadiness = (
  mode: RepositoryBackend = getRepositoryBackend(),
): SqliteAuthorityRehearsalReadiness => {
  const selected = isSqliteAuthorityControlledBackend(mode);
  const authoritativeMode = isSqliteAuthoritativeBackend(mode);
  const acknowledged = authoritativeMode
    ? isSqliteAuthorityEnabledInFrontend()
    : isSqliteAuthorityRehearsalAcknowledged();

  if (!selected) {
    return {
      mode,
      selected: false,
      authoritativeMode: false,
      acknowledged,
      checking: false,
      ready: false,
      apiAvailable: false,
      missingCapabilities: [],
      missingRequirements: [],
      unsupportedOperations: [],
      transactionDeleteWritesAvailable: false,
      budgetLifecycleWritesAvailable: false,
      recipientDeleteMergeWritesAvailable: false,
      accountDeleteMergeWritesAvailable: false,
      categoryDeleteMergeWritesAvailable: false,
      message: "SQLite authority mode is not selected.",
    };
  }

  const acknowledgementRequirement = authoritativeMode
    ? "authority_acknowledgement"
    : "rehearsal_acknowledgement";
  return {
    mode,
    selected: true,
    authoritativeMode,
    acknowledged,
    checking: acknowledged,
    ready: false,
    apiAvailable: false,
    missingCapabilities: [],
    missingRequirements: acknowledged ? [] : [acknowledgementRequirement],
    unsupportedOperations: [],
    transactionDeleteWritesAvailable: false,
    budgetLifecycleWritesAvailable: false,
    recipientDeleteMergeWritesAvailable: false,
    accountDeleteMergeWritesAvailable: false,
    categoryDeleteMergeWritesAvailable: false,
    code: acknowledged ? undefined : `${acknowledgementRequirement}_missing`,
    message: acknowledged
      ? "Checking required local API authority status."
      : authoritativeMode
        ? "SQLite authority acknowledgement is missing. Writes are disabled."
        : "SQLite authority rehearsal acknowledgement is missing. Writes are disabled.",
  };
};

export const getInitialSqliteAuthorityRehearsalReadiness = initialReadiness;

const invalidReadiness = (
  code: string,
  message: string,
  missingRequirements: string[] = [],
  mode: RepositoryBackend = getRepositoryBackend(),
): SqliteAuthorityRehearsalReadiness => ({
  ...initialReadiness(mode),
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
      "http-sqlite-rehearsal",
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
      "http-sqlite-rehearsal",
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
      "http-sqlite-rehearsal",
    );
  }

  const missingCapabilities = REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.filter(
    (key) => capabilities[key] !== true,
  );
  const ready = missingCapabilities.length === 0;
  return {
    mode: "http-sqlite-rehearsal",
    selected: true,
    authoritativeMode: false,
    acknowledged: true,
    checking: false,
    ready,
    apiAvailable: true,
    missingCapabilities,
    missingRequirements: [],
    unsupportedOperations: [...response.unsupportedOperations] as string[],
    transactionDeleteWritesAvailable:
      capabilities.transactionDeleteWrites === true,
    budgetLifecycleWritesAvailable:
      capabilities.budgetLifecycleWrites === true,
    recipientDeleteMergeWritesAvailable:
      capabilities.recipientDeleteMergeWrites === true,
    accountDeleteMergeWritesAvailable:
      capabilities.accountDeleteMergeWrites === true,
    categoryDeleteMergeWritesAvailable:
      capabilities.categoryDeleteMergeWrites === true,
    code: ready ? undefined : "required_write_capabilities_missing",
    message: ready
      ? "All required disposable SQLite write capabilities are available."
      : "Required local API capabilities are missing. Writes are disabled.",
  };
};

const validStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const normalizeSqliteAuthoritativeReadiness = (
  metadata: MetadataResponse,
  authority: AuthorityReadinessResponse,
  capabilitiesResponse: WriteCapabilitiesResponse,
): SqliteAuthorityRehearsalReadiness => {
  const capabilities = capabilitiesResponse.capabilities as
    | Record<string, unknown>
    | undefined;
  const missingCapabilities = capabilities
    ? REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.filter(
        (key) => capabilities[key] !== true,
      )
    : [...REQUIRED_SQLITE_REHEARSAL_CAPABILITIES];
  const missingRequirements = validStringArray(authority.missingRequirements)
    ? authority.missingRequirements
    : ["valid_authority_readiness_response"];
  const unsupportedOperations = validStringArray(authority.unsupportedOperations)
    ? authority.unsupportedOperations
    : [];
  const reportedRequiredCapabilities = validStringArray(
    authority.requiredCapabilities,
  )
    ? authority.requiredCapabilities
    : [];
  const safety = capabilitiesResponse.safety as
    | Record<string, unknown>
    | undefined;
  const requiredUnsupportedOperations = REQUIRED_SQLITE_UNSUPPORTED_OPERATIONS.filter(
    (operation) => {
      if (operation === "transaction_delete") {
        return capabilities?.transactionDeleteWrites !== true;
      }
      if (
        operation === "recipient_delete" ||
        operation === "recipient_merge" ||
        operation === "recipient_reference_reassignment"
      ) {
        return capabilities?.recipientDeleteMergeWrites !== true;
      }
      if (
        operation === "account_delete" ||
        operation === "account_merge" ||
        operation === "account_reference_migration"
      ) {
        return capabilities?.accountDeleteMergeWrites !== true;
      }
      if (
        operation === "bucket_category_delete"
      ) {
        return capabilities?.categoryDeleteMergeWrites !== true;
      }
      return true;
    },
  );
  const valid =
    metadata.mode === "prototype" &&
    metadata.storageMode === "sqlite-authoritative" &&
    metadata.authoritative === true &&
    metadata.cutoverVerified === true &&
    metadata.backupVerified === true &&
    metadata.rollbackAvailable === true &&
    authority.ok === true &&
    authority.authorityEnabled === true &&
    authority.ready === true &&
    authority.storageMode === "sqlite-authoritative" &&
    authority.authoritative === true &&
    authority.cutoverVerified === true &&
    authority.backupVerified === true &&
    authority.rollbackAvailable === true &&
    capabilitiesResponse.ok === true &&
    capabilitiesResponse.storageMode === "sqlite-authoritative" &&
    capabilitiesResponse.authoritative === true &&
    capabilitiesResponse.cutoverVerified === true &&
    capabilitiesResponse.backupVerified === true &&
    capabilitiesResponse.rollbackAvailable === true &&
    safety?.endpointReadOnly === true &&
    safety.sqliteAvailable === true &&
    safety.dexieAccessed === false &&
    safety.filesWritten === false &&
    safety.rawConfigurationIncluded === false &&
    missingCapabilities.length === 0 &&
    missingRequirements.length === 0 &&
    REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.every((key) =>
      reportedRequiredCapabilities.includes(key),
    ) &&
    requiredUnsupportedOperations.every((operation) =>
      unsupportedOperations.includes(operation),
    );

  if (!valid) {
    return invalidReadiness(
      "sqlite_authority_verification_failed",
      "SQLite authoritative mode failed verification. Writes are disabled.",
      [
        ...missingRequirements,
        ...missingCapabilities.map((key) => `capability:${key}`),
      ],
      "http-sqlite-authoritative",
    );
  }

  return {
    mode: "http-sqlite-authoritative",
    selected: true,
    authoritativeMode: true,
    acknowledged: true,
    checking: false,
    ready: true,
    apiAvailable: true,
    missingCapabilities: [],
    missingRequirements: [],
    unsupportedOperations,
    transactionDeleteWritesAvailable:
      capabilities?.transactionDeleteWrites === true,
    budgetLifecycleWritesAvailable:
      capabilities?.budgetLifecycleWrites === true,
    recipientDeleteMergeWritesAvailable:
      capabilities?.recipientDeleteMergeWrites === true,
    accountDeleteMergeWritesAvailable:
      capabilities?.accountDeleteMergeWrites === true,
    categoryDeleteMergeWritesAvailable:
      capabilities?.categoryDeleteMergeWrites === true,
    message:
      "Verified SQLite authoritative mode is active. Dexie writes remain disabled.",
  };
};

export const normalizeSqliteAuthorityReadinessFailure = (
  error: unknown,
  mode: RepositoryBackend,
): SqliteAuthorityRehearsalReadiness => {
  const initial = initialReadiness(mode);
  const code =
    error instanceof LocalApiError
      ? error.code
      : isSqliteAuthoritativeBackend(mode)
        ? "local_api_authority_check_failed"
        : "write_capabilities_request_failed";
  const missingRequirement =
    code === "local_api_base_url_missing"
      ? "local_api_url"
      : code === "local_api_token_missing"
        ? "local_api_token"
        : "local_api_authority_check";
  return invalidReadiness(
    code,
    initial.authoritativeMode
      ? "SQLite authoritative mode failed verification. Writes are disabled."
      : "Local API capabilities are unavailable. Writes are disabled.",
    [missingRequirement],
    mode,
  );
};

export const loadSqliteAuthorityRehearsalReadiness = async (): Promise<SqliteAuthorityRehearsalReadiness> => {
  const initial = initialReadiness();
  if (!initial.selected || !initial.acknowledged) return initial;

  try {
    getLocalApiClientConfig();
    if (isSqliteAuthoritativeBackend(initial.mode)) {
      const [metadata, authority, capabilities] = await Promise.all([
        localApiGet<MetadataResponse>("/metadata"),
        localApiGet<AuthorityReadinessResponse>(
          "/prototype/sqlite/authority-readiness",
        ),
        localApiGet<WriteCapabilitiesResponse>(
          "/prototype/write-capabilities",
        ),
      ]);
      return normalizeSqliteAuthoritativeReadiness(
        metadata,
        authority,
        capabilities,
      );
    }
    const response = await localApiGet<WriteCapabilitiesResponse>(
      "/prototype/write-capabilities",
    );
    return normalizeSqliteAuthorityRehearsalCapabilities(response);
  } catch (error) {
    return normalizeSqliteAuthorityReadinessFailure(error, initial.mode);
  }
};

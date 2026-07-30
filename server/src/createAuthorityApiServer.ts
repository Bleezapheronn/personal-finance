import Fastify, { type FastifyInstance } from "fastify";
import {
  isKnownTableName,
  openReadOnlyDatabase,
  readKnownTableRowCounts,
  readPaginatedKnownTable,
} from "./lib/sqlite.js";
import {
  evaluateSqliteAuthorityReadiness,
  type SqliteAuthorityReadiness,
} from "./lib/sqliteAuthorityCutover.js";
import {
  RUNTIME_FRONTEND_REQUIRED_CAPABILITY_KEYS,
  unsupportedOperationsForCapabilities,
  type WriteCapabilities,
} from "./lib/writeCapabilities.js";
import {
  getLookupConfig,
  getAccountImageById,
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
  recipientLifecycleDisabledResponse,
  recipientLifecycleDryRun,
  recipientLifecycleRealWrite,
  recipientLifecycleRequestErrorResponse,
  RecipientLifecycleRequestError,
  validateRecipientLifecyclePayload,
} from "./lib/recipientLifecycle.js";
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
  accountLifecycleDisabledResponse,
  accountLifecycleDryRun,
  accountLifecycleRealWrite,
  accountLifecycleRequestErrorResponse,
  AccountLifecycleRequestError,
  validateAccountLifecyclePayload,
} from "./lib/accountLifecycle.js";
import {
  categoryLifecycleDisabledResponse,
  categoryLifecycleDryRun,
  categoryLifecycleRealWrite,
  categoryLifecycleRequestErrorResponse,
  CategoryLifecycleRequestError,
  validateCategoryLifecyclePayload,
} from "./lib/categoryLifecycle.js";
import {
  bucketLifecycleDisabledResponse,
  bucketLifecycleDryRun,
  bucketLifecycleRealWrite,
  bucketLifecycleRequestErrorResponse,
  BucketLifecycleRequestError,
  validateBucketLifecyclePayload,
} from "./lib/bucketLifecycle.js";
import {
  lookupActiveStateDryRun,
  lookupActiveStateErrorResponse,
  lookupActiveStateWrite,
  LookupActiveStateRequestError,
  type LookupActiveStateAction,
  type LookupActiveStateEntity,
  validateLookupActiveStatePayload,
} from "./lib/lookupActiveStateLifecycle.js";
import {
  bucketReorderDryRun,
  bucketReorderErrorResponse,
  bucketReorderWrite,
  BucketReorderRequestError,
  validateBucketReorderPayload,
} from "./lib/bucketReorderLifecycle.js";
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
  budgetDefinitionDryRun,
  budgetDefinitionDryRunRequestErrorResponse,
  BudgetDefinitionDryRunRequestError,
} from "./lib/budgetDefinitionDryRun.js";
import {
  budgetDefinitionRealWrite,
  budgetDefinitionWriteDisabledResponse,
  budgetDefinitionWriteRequestErrorResponse,
  BudgetDefinitionWriteRequestError,
  validateBudgetDefinitionWritePayload,
} from "./lib/budgetDefinitionWrite.js";
import {
  budgetLifecycleDisabledResponse,
  budgetLifecycleDryRun,
  budgetLifecycleRealWrite,
  budgetLifecycleRequestErrorResponse,
  BudgetLifecycleRequestError,
  validateBudgetLifecyclePayload,
} from "./lib/budgetLifecycle.js";
import {
  budgetDeleteDisabledResponse,
  budgetDeleteDryRun,
  budgetDeleteRealWrite,
  budgetDeleteRequestErrorResponse,
  BudgetDeleteRequestError,
  validateBudgetDeletePayload,
} from "./lib/budgetDelete.js";
import {
  budgetSnapshotGenerationDryRun,
  budgetSnapshotGenerationRequestErrorResponse,
  BudgetSnapshotGenerationRequestError,
} from "./lib/budgetSnapshotGenerationDryRun.js";
import {
  budgetSnapshotGenerationRealWrite,
  budgetSnapshotGenerationWriteDisabledResponse,
  budgetSnapshotGenerationWriteRequestErrorResponse,
  BudgetSnapshotGenerationWriteRequestError,
  validateBudgetSnapshotGenerationWritePayload,
} from "./lib/budgetSnapshotGenerationWrite.js";
import {
  budgetSnapshotOccurrenceDisabledResponse,
  budgetSnapshotOccurrenceDryRun,
  budgetSnapshotOccurrenceRealWrite,
  budgetSnapshotOccurrenceRequestErrorResponse,
  BudgetSnapshotOccurrenceRequestError,
  type BudgetSnapshotOccurrenceAction,
} from "./lib/budgetSnapshotOccurrence.js";
import {
  budgetFromTransactionDryRun,
  budgetFromTransactionRealWrite,
  budgetFromTransactionRequestErrorResponse,
  BudgetFromTransactionRequestError,
} from "./lib/budgetFromTransaction.js";
import {
  countTransactions,
  getMostRecentTransactionByDescription,
  getTransactionDescriptionPrefill,
  getTransactionById,
  listTransactionDescriptionSuggestions,
  listTransactions,
  type TransactionFilters,
} from "./lib/transactions.js";
import {
  transactionBasicDryRun,
  transactionBasicDryRunRequestErrorResponse,
  transactionPayloadRequestsCostBudgetWrite,
  TransactionBasicDryRunRequestError,
} from "./lib/transactionBasicDryRun.js";
import {
  transactionBasicRealWrite,
  transactionBasicWriteDisabledResponse,
  transactionCostBudgetWriteDisabledResponse,
  transactionBasicWriteRequestErrorResponse,
  TransactionBasicWriteRequestError,
  validateTransactionBasicWritePayload,
} from "./lib/transactionBasicWrite.js";
import {
  transactionTransferDryRun,
  transactionTransferDryRunRequestErrorResponse,
  TransactionTransferDryRunRequestError,
} from "./lib/transactionTransferDryRun.js";
import {
  transactionTransferRealWrite,
  transactionTransferWriteDisabledResponse,
  transactionTransferWriteRequestErrorResponse,
  TransactionTransferWriteRequestError,
  validateTransactionTransferWritePayload,
} from "./lib/transactionTransferWrite.js";
import {
  transactionDeleteDisabledResponse,
  transactionDeleteDryRun,
  transactionDeleteRealWrite,
  transactionDeleteRequestErrorResponse,
  TransactionDeleteRequestError,
  validateTransactionDeleteWritePayload,
} from "./lib/transactionDelete.js";
import {
  smsTemplateDryRun,
  smsTemplateDryRunRequestErrorResponse,
  SmsTemplateDryRunRequestError,
  type SmsTemplateAction,
} from "./lib/smsTemplateDryRun.js";
import {
  smsTemplateRealWrite,
  smsTemplateWriteDisabledResponse,
  smsTemplateWriteRequestErrorResponse,
  SmsTemplateWriteRequestError,
  validateSmsTemplateWritePayload,
} from "./lib/smsTemplateWrite.js";
import { buildWriteCapabilitiesResponse } from "./lib/writeCapabilities.js";
import {
  AuthorityMutationTracker,
  mutationDomainsForPath,
  type AuthoritySessionContext,
} from "./lib/authorityOpsSession.js";
import {
  AuthorityApiLifecycle,
  type AuthorityApiLifecycleDependencies,
  type AuthorityShutdownMode,
} from "./lib/authorityApiLifecycle.js";
import {
  AuthorityMutationExecutor,
  type AuthorityMutationExecutorDependencies,
  type AuthorityMutationFence,
} from "./lib/authorityMutationExecutor.js";
import { isAuthoritativeMutationPath } from "./lib/authorityMutationRequest.js";
import { productionAuthenticatedCommittedWriteRoutes } from "./lib/authorityProductionWriteRouteRegistry.js";

export interface AuthorityApiServerOptions {
  readonly apiVersion: string;
  readonly serviceName: string;
  readonly serviceMode: string;
  readonly readonlyMode: boolean;
  readonly getSqlitePath: () => string | undefined;
  readonly getSqliteCutoverManifestPath: () => string | undefined;
  readonly isSqliteAuthorityEnabled: () => boolean;
  readonly writeCapabilities: Readonly<Record<string, () => boolean>>;
  readonly readWriteCapabilities: () => WriteCapabilities;
  readonly authoritySessionContext?: AuthoritySessionContext;
  readonly authoritySessionSecret?: string;
  readonly authorityLifecycle?: AuthorityApiLifecycleDependencies;
  readonly authorityMutationExecutor?: AuthorityMutationExecutorDependencies;
  readonly registerAuthentication: (server: FastifyInstance) => void;
  readonly registerAutomaticBackups: (server: FastifyInstance) => void;
}

export const createAuthorityApiServer = (options: AuthorityApiServerOptions): FastifyInstance => {
const API_VERSION = options.apiVersion;
const SERVICE_NAME = options.serviceName;
const SERVICE_MODE = options.serviceMode;
const READONLY_MODE = options.readonlyMode;
const getSqlitePath = options.getSqlitePath;
const getSqliteCutoverManifestPath = options.getSqliteCutoverManifestPath;
const isSqliteAuthorityEnabled = options.isSqliteAuthorityEnabled;
const readWriteCapabilities = options.readWriteCapabilities;
const {
  areAccountDeleteMergeWritesEnabled, areAccountWritesEnabled,
  areCategoryDeleteMergeWritesEnabled, areBucketDeleteMergeWritesEnabled,
  areLookupActiveStateWritesEnabled, areBucketReorderWritesEnabled,
  areBudgetDefinitionWritesEnabled, areBudgetDeleteWritesEnabled,
  areBudgetLifecycleWritesEnabled, areBudgetSnapshotGenerationWritesEnabled,
  areBudgetSnapshotOccurrenceWritesEnabled, areBucketCategoryWritesEnabled,
  areRecipientActiveStateWritesEnabled, areRecipientCreateUpdateWritesEnabled,
  areRecipientDeleteMergeWritesEnabled, areSmsTemplateWritesEnabled,
  areTransactionBasicWritesEnabled, areTransactionCostBudgetWritesEnabled,
  areTransactionDeleteWritesEnabled, areTransactionTransferWritesEnabled,
} = options.writeCapabilities;

const server = Fastify({
  logger: {
    level: "info",
  },
  disableRequestLogging: true,
});

const DEFAULT_TABLE_READ_LIMIT = 50;
const MAX_TABLE_READ_LIMIT = 200;
const DEFAULT_LOOKUP_READ_LIMIT = 100;
const MAX_LOOKUP_READ_LIMIT = 500;
const DEFAULT_BUDGET_READ_LIMIT = 100;
const MAX_BUDGET_READ_LIMIT = 500;

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

const openDatabases = new Set<{ close: () => void }>();
const trackDatabase = <T extends { close: () => void }>(db: T): T => {
  const originalClose = db.close.bind(db);
  let closed = false;
  db.close = () => {
    if (closed) return;
    closed = true;
    openDatabases.delete(db);
    return originalClose();
  };
  openDatabases.add(db);
  return db;
};
const closeBuilderDatabases = (): void => {
  let failure = false;
  for (const db of [...openDatabases]) {
    try { db.close(); } catch { failure = true; }
  }
  if (failure || openDatabases.size > 0) throw new Error("database_close_failed");
};

const openConfiguredReadOnlyDatabase = ():
  | { ok: true; db: ReturnType<typeof openReadOnlyDatabase> }
  | { ok: false; code: "sqlite_not_configured" } => {
  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return { ok: false, code: "sqlite_not_configured" };
  }

  return { ok: true, db: trackDatabase(openReadOnlyDatabase(sqlitePath)) };
};

const openConfiguredWritableDatabase = ():
  | { ok: true; db: AuthorityMutationFence["database"] }
  | { ok: false; code: "sqlite_not_configured" } => {
  const sqlitePath = getSqlitePath();
  if (!sqlitePath) {
    return { ok: false, code: "sqlite_not_configured" };
  }
  const context = currentMutationContext;
  if (!context || context.fence.finalized) {
    throw new Error("unguarded_authoritative_write");
  }
  return { ok: true, db: context.fence.database };
};

options.registerAuthentication(server);

// Keep the completion gate tied to Fastify's actual structured registrations.
// This catches a production write route added without updating the canonical
// route registry, without relying on source-text scans.
const registeredProductionWriteRoutes = new Set<string>();
server.addHook("onRoute", (route) => {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  if (methods.includes("POST") && route.url.startsWith("/prototype/") && isAuthoritativeMutationPath(route.url)) registeredProductionWriteRoutes.add(route.url);
});
server.addHook("onReady", async () => {
  const expected = new Set<string>(productionAuthenticatedCommittedWriteRoutes);
  const missing = productionAuthenticatedCommittedWriteRoutes.filter((route) => !registeredProductionWriteRoutes.has(route));
  const extra = [...registeredProductionWriteRoutes].filter((route) => !expected.has(route));
  if (missing.length || extra.length) throw new Error(`production_write_route_registry_mismatch:missing=${missing.join(",")}:extra=${extra.join(",")}`);
});

const authoritySessionContext = options.authoritySessionContext;
const authoritySessionSecret = options.authoritySessionSecret;
const authorityMutationTracker = authoritySessionContext && authoritySessionSecret
  ? new AuthorityMutationTracker()
  : undefined;
const authorityMutationExecutor = (() => {
  const sqlitePath = getSqlitePath();
  return authoritySessionContext && authoritySessionSecret && sqlitePath
    ? new AuthorityMutationExecutor(
        sqlitePath,
        authoritySessionContext.startingLogicalFingerprint,
        options.authorityMutationExecutor,
      )
    : undefined;
})();
const authorityLifecycle = (() => {
  const sqlitePath = getSqlitePath();
  return authorityMutationTracker && authorityMutationExecutor && authoritySessionContext && authoritySessionSecret && sqlitePath
    ? new AuthorityApiLifecycle(
        server,
        authorityMutationTracker,
        authoritySessionContext,
        authoritySessionSecret,
        sqlitePath,
        () => authorityMutationExecutor.finalizeSealProof(),
        closeBuilderDatabases,
        options.authorityLifecycle,
      )
    : undefined;
})();
const isAuthoritativeMutationRequest = isAuthoritativeMutationPath;
const isContaminatedSessionControlRequest = (url: string) => {
  const path = url.split("?", 1)[0];
  return path === "/health" || path === "/authority/session/shutdown";
};
interface MutationRequestContext {
  domains: ReturnType<typeof mutationDomainsForPath>;
  fence: AuthorityMutationFence;
  finalized: boolean;
  trackerEnded: boolean;
}
const mutationRequests = new WeakMap<object, MutationRequestContext>();
let currentMutationContext: MutationRequestContext | undefined;
const finishTrackedMutation = (context: MutationRequestContext) => {
  if (!context.finalized) {
    context.finalized = true;
    authorityMutationExecutor?.rollback(context.fence);
  }
  if (!context.trackerEnded) {
    context.trackerEnded = true;
    authorityMutationTracker?.end();
  }
};

server.addHook("preHandler", async (request, reply) => {
  if (
    authorityMutationExecutor?.isContaminated() &&
    !isContaminatedSessionControlRequest(request.url)
  ) {
    return reply.code(503).send({
      ok: false,
      code: "untracked_database_change",
    });
  }
  if (!isAuthoritativeMutationRequest(request.url)) return;
  if (!authorityMutationTracker || !authorityMutationExecutor) {
    return reply.code(503).send({ ok: false, code: "unguarded_authoritative_write" });
  }
  if (!authorityMutationTracker.isAccepting()) {
    return reply.code(503).send({ ok: false, code: "authority_shutdown_in_progress" });
  }
  const domains = mutationDomainsForPath(request.url);
  let fence: AuthorityMutationFence | undefined;
  try {
    fence = await authorityMutationExecutor.begin(domains);
    authorityMutationTracker.begin();
  } catch (error) {
    if (fence) authorityMutationExecutor.rollback(fence);
    const message = error instanceof Error ? error.message : "mutation_fingerprint_failed";
    const contaminated = message === "mutation_prestate_mismatch" || message === "untracked_database_change";
    return reply.code(contaminated ? 409 : 503).send({
      ok: false,
      code: contaminated ? "untracked_database_change" : message,
    });
  }
  const context = { domains, fence, finalized: false, trackerEnded: false };
  mutationRequests.set(request, context);
  currentMutationContext = context;
});
server.addHook("onSend", async (request, reply, payload) => {
  const context = mutationRequests.get(request);
  if (!authorityMutationTracker || !context) return payload;
  if (context.finalized || context.fence.finalized) return payload;
  if (reply.statusCode >= 400) {
    finishTrackedMutation(context);
    return payload;
  }
  try {
    const { changed, changedDomains } = authorityMutationExecutor!.commit(context.fence);
    if (changed) authorityMutationTracker.confirm(changedDomains);
    context.finalized = true;
    return payload;
  } catch (error) {
    context.finalized = true;
    const message = error instanceof Error ? error.message : "mutation_commit_failed";
    reply.code(500);
    return JSON.stringify({ ok: false, code: message });
  }
});
server.addHook("onError", async (request) => {
  const context = mutationRequests.get(request);
  if (context) finishTrackedMutation(context);
});
server.addHook("onResponse", async (request) => {
  const context = mutationRequests.get(request);
  if (!context) return;
  finishTrackedMutation(context);
  if (currentMutationContext === context) currentMutationContext = undefined;
  mutationRequests.delete(request);
});

server.post("/authority/session/shutdown", async (request, reply) => {
  if (!authorityLifecycle || !authoritySessionSecret) {
    return reply.code(404).send({ ok: false, code: "authority_session_unavailable" });
  }
  if (request.headers["x-personal-finance-session-secret"] !== authoritySessionSecret) {
    return reply.code(403).send({ ok: false, code: "authority_session_forbidden" });
  }
  const mode = request.headers["x-personal-finance-shutdown-mode"];
  if (mode !== "seal" && mode !== "abort") {
    return reply.code(400).send({ ok: false, code: "authority_shutdown_mode_invalid" });
  }
  const transition = authorityLifecycle.request(mode as AuthorityShutdownMode);
  reply.raw.once("finish", () => { void authorityLifecycle.start(); });
  return reply.code(202).send({
    ok: true,
    accepted: transition.accepted,
    mode: transition.mode,
    state: transition.state,
  });
});

server.get("/health", async () => {
  return {
    ok: true,
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
  };
});

let sqliteAuthorityReadiness: SqliteAuthorityReadiness =
  evaluateSqliteAuthorityReadiness({
    authorityEnabled: false,
    capabilities: readWriteCapabilities(),
  });

server.addHook("preHandler", async (request, reply) => {
  if (
    isSqliteAuthorityEnabled() &&
    request.url.split("?", 1)[0].includes("/write/") &&
    !sqliteAuthorityReadiness.ready
  ) {
    return reply.code(503).send({
      ok: false,
      code: "sqlite_authority_not_ready",
    });
  }
});

options.registerAutomaticBackups(server);

server.get("/metadata", async () => {
  return {
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
    apiVersion: API_VERSION,
    readonly: !sqliteAuthorityReadiness.authoritative,
    storageMode: sqliteAuthorityReadiness.storageMode,
    authoritative: sqliteAuthorityReadiness.authoritative,
    cutoverVerified: sqliteAuthorityReadiness.cutoverVerified,
    backupVerified: sqliteAuthorityReadiness.backupVerified,
    rollbackAvailable: sqliteAuthorityReadiness.rollbackAvailable,
    missingRequirements: [...sqliteAuthorityReadiness.missingRequirements],
  };
});

server.get("/prototype/sqlite/authority-readiness", async () => ({
  ok: true,
  mode: SERVICE_MODE,
  authorityEnabled: sqliteAuthorityReadiness.authorityEnabled,
  ready: sqliteAuthorityReadiness.ready,
  storageMode: sqliteAuthorityReadiness.storageMode,
  authoritative: sqliteAuthorityReadiness.authoritative,
  cutoverVerified: sqliteAuthorityReadiness.cutoverVerified,
  backupVerified: sqliteAuthorityReadiness.backupVerified,
  rollbackAvailable: sqliteAuthorityReadiness.rollbackAvailable,
  missingRequirements: [...sqliteAuthorityReadiness.missingRequirements],
  // Legacy requiredCapabilities remains the checkpoint-manifest schema.
  // Runtime management requirements are intentionally published separately.
  requiredCapabilities: [...sqliteAuthorityReadiness.requiredCapabilities],
  runtimeRequiredCapabilities: [...RUNTIME_FRONTEND_REQUIRED_CAPABILITY_KEYS],
  unsupportedOperations: sqliteAuthorityReadiness.unsupportedOperations.filter(
    (operation) => unsupportedOperationsForCapabilities(readWriteCapabilities()).includes(operation),
  ),
  code: sqliteAuthorityReadiness.code,
}));

server.get("/prototype/write-capabilities", async () => {
  let sqliteAvailable = false;
  let database: ReturnType<typeof openReadOnlyDatabase> | undefined;

  try {
    const opened = openConfiguredReadOnlyDatabase();
    if (opened.ok) {
      database = opened.db;
      sqliteAvailable = true;
    }
  } catch {
    sqliteAvailable = false;
  } finally {
    database?.close();
  }

  return buildWriteCapabilitiesResponse(sqliteAvailable, sqliteAuthorityReadiness);
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

server.get<{ Querystring: { limit?: string } }>(
  "/prototype/repositories/transactions/descriptions",
  async (request, reply) => {
    let limit: number;
    try {
      limit = parsePaginationValue(request.query.limit, 100, "limit");
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        code:
          error instanceof Error
            ? error.message
            : "transaction_description_query_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch {
      return reply.code(503).send({
        ok: false,
        code: "sqlite_unavailable",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }

    try {
      return {
        ok: true,
        mode: SERVICE_MODE,
        readonly: READONLY_MODE,
        limit,
        rows: listTransactionDescriptionSuggestions(opened.db, limit),
      };
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "transaction_description_list_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.get<{ Querystring: { description?: string } }>(
  "/prototype/repositories/transactions/description-prefill",
  async (request, reply) => {
    const description = request.query.description?.trim();
    if (!description || description.length > 500) {
      return reply.code(400).send({ ok: false, code: "transaction_description_invalid" });
    }
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch {
      return reply.code(503).send({ ok: false, code: "sqlite_unavailable" });
    }
    if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
    try {
      const prefill = getTransactionDescriptionPrefill(opened.db, description);
      if (!prefill) return reply.code(404).send({ ok: false, code: "transaction_description_not_found" });
      return { ok: true, mode: SERVICE_MODE, readonly: READONLY_MODE, prefill };
    } catch {
      return reply.code(500).send({ ok: false, code: "transaction_description_read_failed" });
    } finally {
      opened.db.close();
    }
  },
);

server.get<{ Querystring: { description?: string } }>(
  "/prototype/repositories/transactions/most-recent-by-description",
  async (request, reply) => {
    const description = request.query.description?.trim();
    if (!description || description.length > 500) {
      return reply.code(400).send({
        ok: false,
        code: "transaction_description_invalid",
      });
    }

    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch {
      return reply.code(503).send({
        ok: false,
        code: "sqlite_unavailable",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }

    try {
      const transaction = getMostRecentTransactionByDescription(
        opened.db,
        description,
      );
      if (!transaction) {
        return reply.code(404).send({
          ok: false,
          code: "transaction_description_not_found",
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
        code: "transaction_description_read_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

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

for (const action of ["create", "update"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/budgets/dry-run/${action}`,
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
              : `budget_definition_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = budgetDefinitionDryRun(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "budget_definition_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof BudgetDefinitionDryRunRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              budgetDefinitionDryRunRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_definition_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/budgets/write/${action}`,
    async (request, reply) => {
      try {
        validateBudgetDefinitionWritePayload(request.body, action);
      } catch (error) {
        if (error instanceof BudgetDefinitionWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              budgetDefinitionWriteRequestErrorResponse(action, error.code),
            );
        }
        return reply
          .code(400)
          .send(
            budgetDefinitionWriteRequestErrorResponse(
              action,
              `budget_definition_${action}_write_invalid`,
            ),
          );
      }
      if (!areBudgetDefinitionWritesEnabled()) {
        return reply
          .code(403)
          .send(budgetDefinitionWriteDisabledResponse(action));
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
              : `budget_definition_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = budgetDefinitionRealWrite(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "budget_definition_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof BudgetDefinitionWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              budgetDefinitionWriteRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_definition_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

const lookupActiveStateResources = {
  account: "accounts",
  bucket: "buckets",
  category: "categories",
} as const;

for (const entity of ["account", "bucket", "category"] as const) {
  const resource = lookupActiveStateResources[entity];
  for (const action of ["activate", "deactivate"] as const) {
    server.post<{ Body: unknown }>(
      `/prototype/repositories/${resource}/active-state/dry-run/${action}`,
      async (request, reply) => {
        let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
        try { opened = openConfiguredReadOnlyDatabase(); } catch (error) {
          return reply.code(sqliteUnavailableStatusCode(error)).send({ ok: false, code: "sqlite_unavailable" });
        }
        if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
        try {
          const result = lookupActiveStateDryRun(opened.db, request.body, entity, action);
          return result.ok ? result : reply.code(result.code?.endsWith("_not_found") ? 404 : 409).send(result);
        } catch (error) {
          if (error instanceof LookupActiveStateRequestError) {
            return reply.code(error.statusCode).send(lookupActiveStateErrorResponse(entity, action, error.code));
          }
          return reply.code(500).send({ ok: false, code: `${entity}_active_state_dry_run_failed` });
        } finally { opened.db.close(); }
      },
    );
    server.post<{ Body: unknown }>(
      `/prototype/repositories/${resource}/active-state/write/${action}`,
      async (request, reply) => {
        try { validateLookupActiveStatePayload(request.body, entity, action, true); } catch (error) {
          if (error instanceof LookupActiveStateRequestError) return reply.code(error.statusCode).send(lookupActiveStateErrorResponse(entity, action, error.code));
          return reply.code(400).send(lookupActiveStateErrorResponse(entity, action, "active_state_write_invalid"));
        }
        if (!areLookupActiveStateWritesEnabled()) {
          return reply.code(403).send(lookupActiveStateErrorResponse(entity, action, "lookup_active_state_writes_disabled"));
        }
        let opened: ReturnType<typeof openConfiguredWritableDatabase>;
        try { opened = openConfiguredWritableDatabase(); } catch (error) {
          return reply.code(sqliteUnavailableStatusCode(error)).send({ ok: false, code: "sqlite_unavailable" });
        }
        if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
        try {
          const result = lookupActiveStateWrite(opened.db, request.body, entity, action);
          return result.ok ? result : reply.code(result.code?.endsWith("_not_found") ? 404 : 409).send(result);
        } catch (error) {
          if (error instanceof LookupActiveStateRequestError) return reply.code(error.statusCode).send(lookupActiveStateErrorResponse(entity, action, error.code));
          return reply.code(500).send({ ok: false, code: `${entity}_active_state_write_failed` });
        } finally { opened.db.close(); }
      },
    );
  }
}

server.post<{ Body: unknown }>("/prototype/repositories/buckets/reorder/dry-run", async (request, reply) => {
  let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
  try { opened = openConfiguredReadOnlyDatabase(); } catch (error) { return reply.code(sqliteUnavailableStatusCode(error)).send({ ok: false, code: "sqlite_unavailable" }); }
  if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
  try { const result = bucketReorderDryRun(opened.db, request.body); return result.ok ? result : reply.code(409).send(result); }
  catch (error) { if (error instanceof BucketReorderRequestError) return reply.code(error.statusCode).send(bucketReorderErrorResponse(error.code)); return reply.code(500).send({ ok: false, code: "bucket_reorder_dry_run_failed" }); }
  finally { opened.db.close(); }
});
server.post<{ Body: unknown }>("/prototype/repositories/buckets/reorder/write", async (request, reply) => {
  try { validateBucketReorderPayload(request.body, true); } catch (error) {
    if (error instanceof BucketReorderRequestError) return reply.code(error.statusCode).send(bucketReorderErrorResponse(error.code));
    return reply.code(400).send(bucketReorderErrorResponse("bucket_reorder_write_invalid"));
  }
  if (!areBucketReorderWritesEnabled()) return reply.code(403).send(bucketReorderErrorResponse("bucket_reorder_writes_disabled"));
  let opened: ReturnType<typeof openConfiguredWritableDatabase>;
  try { opened = openConfiguredWritableDatabase(); } catch (error) { return reply.code(sqliteUnavailableStatusCode(error)).send({ ok: false, code: "sqlite_unavailable" }); }
  if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
  try { const result = bucketReorderWrite(opened.db, request.body); return result.ok ? result : reply.code(409).send(result); }
  catch (error) { if (error instanceof BucketReorderRequestError) return reply.code(error.statusCode).send(bucketReorderErrorResponse(error.code)); return reply.code(500).send({ ok: false, code: "bucket_reorder_write_failed" }); }
  finally { opened.db.close(); }
});

for (const action of ["delete", "merge"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/buckets/${action}/dry-run`,
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
              : `bucket_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = bucketLifecycleDryRun(opened.db, request.body, action);
        if (
          ["bucket_not_found", "source_bucket_not_found", "target_bucket_not_found"].includes(
            result.code ?? "",
          )
        ) {
          return reply.code(404).send(result);
        }
        if (action === "delete" && result.code === "bucket_contains_categories") {
          return result;
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof BucketLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(bucketLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(500)
          .send({ ok: false, code: `bucket_${action}_dry_run_failed` });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/buckets/${action}/write`,
    async (request, reply) => {
      try {
        validateBucketLifecyclePayload(request.body, action, true);
      } catch (error) {
        if (error instanceof BucketLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(bucketLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(400)
          .send(
            bucketLifecycleRequestErrorResponse(
              action,
              "bucket_lifecycle_write_invalid",
            ),
          );
      }
      if (!areBucketDeleteMergeWritesEnabled()) {
        return reply.code(403).send(bucketLifecycleDisabledResponse(action));
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
              : `bucket_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = bucketLifecycleRealWrite(opened.db, request.body, action);
        if (
          ["bucket_not_found", "source_bucket_not_found", "target_bucket_not_found"].includes(
            result.code ?? "",
          )
        ) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof BucketLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(bucketLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(500)
          .send({ ok: false, code: `bucket_${action}_write_failed` });
      } finally {
        opened.db.close();
      }
    },
  );
}

for (const action of ["delete", "merge"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/accounts/${action}/dry-run`,
    async (request, reply) => {
      let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
      try {
        opened = openConfiguredReadOnlyDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code: statusCode === 503 ? "sqlite_unavailable" : `account_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
      try {
        const result = accountLifecycleDryRun(opened.db, request.body, action);
        if (["account_not_found", "source_account_not_found", "target_account_not_found"]
          .includes(result.code ?? "")) {
          return reply.code(404).send(result);
        }
        if (action === "delete" && result.code === "account_referenced") return result;
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof AccountLifecycleRequestError) {
          return reply.code(error.statusCode)
            .send(accountLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({ ok: false, code: `account_${action}_dry_run_failed` });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/accounts/${action}/write`,
    async (request, reply) => {
      try {
        validateAccountLifecyclePayload(request.body, action, true);
      } catch (error) {
        if (error instanceof AccountLifecycleRequestError) {
          return reply.code(error.statusCode)
            .send(accountLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(400)
          .send(accountLifecycleRequestErrorResponse(action, "account_lifecycle_write_invalid"));
      }
      if (!areAccountDeleteMergeWritesEnabled()) {
        return reply.code(403).send(accountLifecycleDisabledResponse(action));
      }
      let opened: ReturnType<typeof openConfiguredWritableDatabase>;
      try {
        opened = openConfiguredWritableDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code: statusCode === 503 ? "sqlite_unavailable" : `account_${action}_write_failed`,
        });
      }
      if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });
      try {
        const result = accountLifecycleRealWrite(opened.db, request.body, action);
        if (["account_not_found", "source_account_not_found", "target_account_not_found"]
          .includes(result.code ?? "")) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof AccountLifecycleRequestError) {
          return reply.code(error.statusCode)
            .send(accountLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({ ok: false, code: `account_${action}_write_failed` });
      } finally {
        opened.db.close();
      }
    },
  );
}

for (const action of ["delete", "merge"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/categories/${action}/dry-run`,
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
              : `category_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = categoryLifecycleDryRun(opened.db, request.body, action);
        if (
          [
            "category_not_found",
            "source_category_not_found",
            "target_category_not_found",
          ].includes(result.code ?? "")
        ) {
          return reply.code(404).send(result);
        }
        if (action === "delete" && result.code === "category_referenced") {
          return result;
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof CategoryLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(categoryLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(500)
          .send({ ok: false, code: `category_${action}_dry_run_failed` });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/categories/${action}/write`,
    async (request, reply) => {
      try {
        validateCategoryLifecyclePayload(request.body, action, true);
      } catch (error) {
        if (error instanceof CategoryLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(categoryLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(400)
          .send(
            categoryLifecycleRequestErrorResponse(
              action,
              "category_lifecycle_write_invalid",
            ),
          );
      }
      if (!areCategoryDeleteMergeWritesEnabled()) {
        return reply.code(403).send(categoryLifecycleDisabledResponse(action));
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
              : `category_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = categoryLifecycleRealWrite(opened.db, request.body, action);
        if (
          [
            "category_not_found",
            "source_category_not_found",
            "target_category_not_found",
          ].includes(result.code ?? "")
        ) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof CategoryLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(categoryLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(500)
          .send({ ok: false, code: `category_${action}_write_failed` });
      } finally {
        opened.db.close();
      }
    },
  );
}

for (const action of ["create", "update"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/budgets/lifecycle/dry-run/${action}`,
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
              : `budget_lifecycle_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = budgetLifecycleDryRun(opened.db, request.body, action);
        if (response.code === "budget_definition_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(409).send(response);
      } catch (error) {
        if (error instanceof BudgetLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(budgetLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_lifecycle_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/budgets/lifecycle/write/${action}`,
    async (request, reply) => {
      try {
        validateBudgetLifecyclePayload(request.body, action, true);
      } catch (error) {
        if (error instanceof BudgetLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(budgetLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(400).send(
          budgetLifecycleRequestErrorResponse(
            action,
            `budget_lifecycle_${action}_write_invalid`,
          ),
        );
      }
      if (!areBudgetLifecycleWritesEnabled()) {
        return reply.code(403).send(budgetLifecycleDisabledResponse(action));
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
              : `budget_lifecycle_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = budgetLifecycleRealWrite(opened.db, request.body, action);
        if (response.code === "budget_definition_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(409).send(response);
      } catch (error) {
        if (error instanceof BudgetLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(budgetLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_lifecycle_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

for (const action of [
  "delete",
  "create",
  "link",
  "changeLink",
  "unlink",
  "createAndLink",
] as const satisfies readonly BudgetSnapshotOccurrenceAction[]) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/budget-snapshot-occurrences/dry-run/${action}`,
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
              : `budget_snapshot_occurrence_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = budgetSnapshotOccurrenceDryRun(
          opened.db,
          request.body,
          action,
        );
        if (
          result.code === "snapshot_not_found" ||
          result.code === "budget_not_found" ||
          result.code === "transaction_not_found"
        ) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof BudgetSnapshotOccurrenceRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              budgetSnapshotOccurrenceRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_snapshot_occurrence_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/budget-snapshot-occurrences/write/${action}`,
    async (request, reply) => {
      if (!areBudgetSnapshotOccurrenceWritesEnabled()) {
        return reply
          .code(403)
          .send(budgetSnapshotOccurrenceDisabledResponse(action));
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
              : `budget_snapshot_occurrence_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const result = budgetSnapshotOccurrenceRealWrite(
          opened.db,
          request.body,
          action,
        );
        if (
          result.code === "snapshot_not_found" ||
          result.code === "budget_not_found" ||
          result.code === "transaction_not_found"
        ) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof BudgetSnapshotOccurrenceRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              budgetSnapshotOccurrenceRequestErrorResponse(action, error.code),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `budget_snapshot_occurrence_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

server.post<{ Body: unknown }>(
  "/prototype/repositories/budgets/from-transaction/dry-run",
  async (request, reply) => {
    let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
    try {
      opened = openConfiguredReadOnlyDatabase();
    } catch {
      return reply
        .code(503)
        .send({ ok: false, code: "sqlite_unavailable" });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const result = budgetFromTransactionDryRun(opened.db, request.body);
      if (result.code === "transaction_not_found") {
        return reply.code(404).send(result);
      }
      return result.ok ? result : reply.code(409).send(result);
    } catch (error) {
      if (error instanceof BudgetFromTransactionRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetFromTransactionRequestErrorResponse(error.code));
      }
      return reply
        .code(500)
        .send({ ok: false, code: "budget_from_transaction_dry_run_failed" });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/budgets/from-transaction/write",
  async (request, reply) => {
    if (
      !areBudgetDefinitionWritesEnabled() ||
      !areBudgetSnapshotOccurrenceWritesEnabled()
    ) {
      return reply.code(403).send(
        budgetFromTransactionRequestErrorResponse(
          "budget_from_transaction_writes_disabled",
        ),
      );
    }
    let opened: ReturnType<typeof openConfiguredWritableDatabase>;
    try {
      opened = openConfiguredWritableDatabase();
    } catch {
      return reply
        .code(503)
        .send({ ok: false, code: "sqlite_unavailable" });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const result = budgetFromTransactionRealWrite(opened.db, request.body);
      if (result.code === "transaction_not_found") {
        return reply.code(404).send(result);
      }
      return result.ok ? result : reply.code(409).send(result);
    } catch (error) {
      if (error instanceof BudgetFromTransactionRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetFromTransactionRequestErrorResponse(error.code));
      }
      return reply
        .code(500)
        .send({ ok: false, code: "budget_from_transaction_write_failed" });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/budgets/delete/dry-run",
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
            : "budget_delete_dry_run_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = budgetDeleteDryRun(opened.db, request.body);
      if (response.code === "budget_not_found") {
        return reply.code(404).send(response);
      }
      return response;
    } catch (error) {
      if (error instanceof BudgetDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetDeleteRequestErrorResponse(error.code));
      }
      return reply
        .code(500)
        .send({ ok: false, code: "budget_delete_dry_run_failed" });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/budgets/delete/write",
  async (request, reply) => {
    try {
      validateBudgetDeletePayload(request.body, true);
    } catch (error) {
      if (error instanceof BudgetDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetDeleteRequestErrorResponse(error.code));
      }
      return reply
        .code(400)
        .send(budgetDeleteRequestErrorResponse("budget_delete_write_invalid"));
    }
    if (!areBudgetDeleteWritesEnabled()) {
      return reply.code(403).send(budgetDeleteDisabledResponse());
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
            : "budget_delete_write_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = budgetDeleteRealWrite(opened.db, request.body);
      if (response.code === "budget_not_found") {
        return reply.code(404).send(response);
      }
      return response.ok ? response : reply.code(409).send(response);
    } catch (error) {
      if (error instanceof BudgetDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetDeleteRequestErrorResponse(error.code));
      }
      return reply
        .code(500)
        .send({ ok: false, code: "budget_delete_write_failed" });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/transactions/delete/dry-run",
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
            : "transaction_delete_dry_run_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = transactionDeleteDryRun(opened.db, request.body);
      if (response.code === "transaction_not_found") {
        return reply.code(404).send(response);
      }
      return response.ok ? response : reply.code(409).send(response);
    } catch (error) {
      if (error instanceof TransactionDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(transactionDeleteRequestErrorResponse(error.code));
      }
      return reply.code(500).send({
        ok: false,
        code: "transaction_delete_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/transactions/delete/write",
  async (request, reply) => {
    try {
      validateTransactionDeleteWritePayload(request.body);
    } catch (error) {
      if (error instanceof TransactionDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(transactionDeleteRequestErrorResponse(error.code));
      }
      return reply
        .code(400)
        .send(transactionDeleteRequestErrorResponse("transaction_delete_write_invalid"));
    }
    if (!areTransactionDeleteWritesEnabled()) {
      return reply.code(403).send(transactionDeleteDisabledResponse());
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
            : "transaction_delete_write_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = transactionDeleteRealWrite(opened.db, request.body);
      if (response.code === "transaction_not_found") {
        return reply.code(404).send(response);
      }
      return response.ok ? response : reply.code(409).send(response);
    } catch (error) {
      if (error instanceof TransactionDeleteRequestError) {
        return reply
          .code(error.statusCode)
          .send(transactionDeleteRequestErrorResponse(error.code));
      }
      return reply.code(500).send({
        ok: false,
        code: "transaction_delete_write_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/budget-snapshots/lifecycle/dry-run/generate",
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
            : "budget_snapshot_generation_dry_run_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = budgetSnapshotGenerationDryRun(opened.db, request.body);
      if (response.conflictCount > 0) {
        return reply.code(409).send(response);
      }
      return response.ok ? response : reply.code(400).send(response);
    } catch (error) {
      if (error instanceof BudgetSnapshotGenerationRequestError) {
        return reply
          .code(error.statusCode)
          .send(budgetSnapshotGenerationRequestErrorResponse(error.code));
      }
      return reply.code(500).send({
        ok: false,
        code: "budget_snapshot_generation_dry_run_failed",
      });
    } finally {
      opened.db.close();
    }
  },
);

server.post<{ Body: unknown }>(
  "/prototype/repositories/budget-snapshots/lifecycle/write/generate",
  async (request, reply) => {
    let normalizedAsOf: Date;
    try {
      normalizedAsOf = validateBudgetSnapshotGenerationWritePayload(
        request.body,
      );
    } catch (error) {
      if (error instanceof BudgetSnapshotGenerationWriteRequestError) {
        const dryRun = budgetSnapshotGenerationRequestErrorResponse(error.code);
        return reply
          .code(error.statusCode)
          .send(
            budgetSnapshotGenerationWriteRequestErrorResponse(
              dryRun,
              error.code,
            ),
          );
      }
      return reply.code(400).send({
        ok: false,
        code: "budget_snapshot_generation_write_invalid",
      });
    }

    if (!areBudgetSnapshotGenerationWritesEnabled()) {
      const dryRun = budgetSnapshotGenerationRequestErrorResponse(
        "budget_snapshot_generation_writes_disabled",
        normalizedAsOf,
      );
      return reply
        .code(403)
        .send(budgetSnapshotGenerationWriteDisabledResponse(dryRun));
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
            : "budget_snapshot_generation_write_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }
    try {
      const response = budgetSnapshotGenerationRealWrite(
        opened.db,
        request.body,
      );
      if (response.conflictCount > 0) {
        return reply.code(409).send(response);
      }
      return response.ok ? response : reply.code(400).send(response);
    } catch (error) {
      if (error instanceof BudgetSnapshotGenerationWriteRequestError) {
        const dryRun = budgetSnapshotGenerationRequestErrorResponse(error.code);
        return reply
          .code(error.statusCode)
          .send(
            budgetSnapshotGenerationWriteRequestErrorResponse(
              dryRun,
              error.code,
            ),
          );
      }
      return reply.code(500).send({
        ok: false,
        code: "budget_snapshot_generation_write_failed",
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
          {
            costBudget:
              areTransactionBasicWritesEnabled() &&
              areTransactionCostBudgetWritesEnabled(),
          },
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
      const costBudgetRequested =
        transactionPayloadRequestsCostBudgetWrite(request.body);
      if (
        costBudgetRequested &&
        !areTransactionCostBudgetWritesEnabled()
      ) {
        return reply
          .code(403)
          .send(transactionCostBudgetWriteDisabledResponse(action));
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
          {
            costBudget: areTransactionCostBudgetWritesEnabled(),
          },
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

for (const action of ["create", "update"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/transactions/transfers/dry-run/${action}`,
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
              : `transaction_transfer_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = transactionTransferDryRun(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "transaction_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof TransactionTransferDryRunRequestError) {
          return reply
            .code(error.statusCode)
            .send(
              transactionTransferDryRunRequestErrorResponse(
                action,
                error.code,
              ),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `transaction_transfer_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/transactions/transfers/write/${action}`,
    async (request, reply) => {
      try {
        validateTransactionTransferWritePayload(request.body, action);
      } catch (error) {
        if (
          error instanceof TransactionTransferWriteRequestError ||
          error instanceof TransactionTransferDryRunRequestError
        ) {
          return reply
            .code(error.statusCode)
            .send(
              transactionTransferWriteRequestErrorResponse(
                action,
                error.code,
              ),
            );
        }
        return reply
          .code(400)
          .send(
            transactionTransferWriteRequestErrorResponse(
              action,
              `transaction_transfer_${action}_write_invalid`,
            ),
          );
      }
      if (!areTransactionBasicWritesEnabled()) {
        return reply
          .code(403)
          .send(
            transactionTransferWriteDisabledResponse(
              action,
              "transaction_basic_writes_disabled",
            ),
          );
      }
      if (!areTransactionTransferWritesEnabled()) {
        return reply
          .code(403)
          .send(transactionTransferWriteDisabledResponse(action));
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
              : `transaction_transfer_${action}_write_failed`,
        });
      }
      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }
      try {
        const response = transactionTransferRealWrite(
          opened.db,
          request.body,
          action,
        );
        if (response.code === "transaction_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (
          error instanceof TransactionTransferWriteRequestError ||
          error instanceof TransactionTransferDryRunRequestError
        ) {
          return reply
            .code(error.statusCode)
            .send(
              transactionTransferWriteRequestErrorResponse(
                action,
                error.code,
              ),
            );
        }
        return reply.code(500).send({
          ok: false,
          code: `transaction_transfer_${action}_write_failed`,
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

for (const action of ["delete", "merge"] as const) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/recipients/${action}/dry-run`,
    async (request, reply) => {
      let opened: ReturnType<typeof openConfiguredReadOnlyDatabase>;
      try {
        opened = openConfiguredReadOnlyDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code: statusCode === 503
            ? "sqlite_unavailable"
            : `recipient_${action}_dry_run_failed`,
        });
      }
      if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });

      try {
        const result = recipientLifecycleDryRun(opened.db, request.body, action);
        if (
          result.code === "recipient_not_found" ||
          result.code === "source_recipient_not_found" ||
          result.code === "target_recipient_not_found"
        ) {
          return reply.code(404).send(result);
        }
        if (action === "delete" && result.code === "recipient_referenced") {
          return result;
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof RecipientLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(recipientLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `recipient_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/recipients/${action}/write`,
    async (request, reply) => {
      try {
        validateRecipientLifecyclePayload(request.body, action, true);
      } catch (error) {
        if (error instanceof RecipientLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(recipientLifecycleRequestErrorResponse(action, error.code));
        }
        return reply
          .code(400)
          .send(recipientLifecycleRequestErrorResponse(action, "recipient_lifecycle_write_invalid"));
      }

      if (!areRecipientDeleteMergeWritesEnabled()) {
        return reply.code(403).send(recipientLifecycleDisabledResponse(action));
      }

      let opened: ReturnType<typeof openConfiguredWritableDatabase>;
      try {
        opened = openConfiguredWritableDatabase();
      } catch (error) {
        const statusCode = sqliteUnavailableStatusCode(error);
        return reply.code(statusCode).send({
          ok: false,
          code: statusCode === 503
            ? "sqlite_unavailable"
            : `recipient_${action}_write_failed`,
        });
      }
      if (!opened.ok) return reply.code(503).send({ ok: false, code: opened.code });

      try {
        const result = recipientLifecycleRealWrite(opened.db, request.body, action);
        if (
          result.code === "recipient_not_found" ||
          result.code === "source_recipient_not_found" ||
          result.code === "target_recipient_not_found"
        ) {
          return reply.code(404).send(result);
        }
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof RecipientLifecycleRequestError) {
          return reply
            .code(error.statusCode)
            .send(recipientLifecycleRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `recipient_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

const smsTemplateActions: SmsTemplateAction[] = [
  "create",
  "update",
  "activate",
  "deactivate",
  "delete",
];

for (const action of smsTemplateActions) {
  server.post<{ Body: unknown }>(
    `/prototype/repositories/sms-import-templates/dry-run/${action}`,
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
              : `sms_template_${action}_dry_run_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }

      try {
        const response = smsTemplateDryRun(opened.db, request.body, action);
        if (response.code === "sms_template_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ? response : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof SmsTemplateDryRunRequestError) {
          return reply
            .code(error.statusCode)
            .send(smsTemplateDryRunRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `sms_template_${action}_dry_run_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );

  server.post<{ Body: unknown }>(
    `/prototype/repositories/sms-import-templates/write/${action}`,
    async (request, reply) => {
      try {
        validateSmsTemplateWritePayload(request.body, action);
      } catch (error) {
        if (error instanceof SmsTemplateWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(smsTemplateWriteRequestErrorResponse(action, error.code));
        }
        return reply
          .code(400)
          .send(smsTemplateWriteRequestErrorResponse(action, "sms_template_write_invalid"));
      }

      if (!areSmsTemplateWritesEnabled()) {
        return reply.code(403).send(smsTemplateWriteDisabledResponse(action));
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
              : `sms_template_${action}_write_failed`,
        });
      }

      if (!opened.ok) {
        return reply.code(503).send({ ok: false, code: opened.code });
      }

      try {
        const response = smsTemplateRealWrite(opened.db, request.body, action);
        if (response.code === "sms_template_not_found") {
          return reply.code(404).send(response);
        }
        return response.ok ||
          response.resultCodes.includes("active_state_already_matches")
          ? response
          : reply.code(400).send(response);
      } catch (error) {
        if (error instanceof SmsTemplateWriteRequestError) {
          return reply
            .code(error.statusCode)
            .send(smsTemplateWriteRequestErrorResponse(action, error.code));
        }
        return reply.code(500).send({
          ok: false,
          code: `sms_template_${action}_write_failed`,
        });
      } finally {
        opened.db.close();
      }
    },
  );
}

server.get<{ Params: { id: string } }>(
  "/prototype/repositories/accounts/:id/image",
  async (request, reply) => {
    let id: number;
    try {
      id = parsePositiveInteger(request.params.id, "account_id");
    } catch {
      return reply.code(400).send({
        ok: false,
        code: "account_id_invalid",
      });
    }

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
            : "account_image_read_failed",
      });
    }
    if (!opened.ok) {
      return reply.code(503).send({ ok: false, code: opened.code });
    }

    try {
      const image = getAccountImageById(opened.db, id);
      if (!image) {
        return reply.code(404).send({
          ok: false,
          code: "account_image_not_found",
        });
      }
      return reply
        .header("content-type", image.mimeType)
        .header("cache-control", "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .send(image.bytes);
    } catch {
      return reply.code(500).send({
        ok: false,
        code: "account_image_read_failed",
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

sqliteAuthorityReadiness = evaluateSqliteAuthorityReadiness({
    authorityEnabled: isSqliteAuthorityEnabled(),
    sqlitePath: getSqlitePath(),
    manifestPath: getSqliteCutoverManifestPath(),
    capabilities: readWriteCapabilities(),
  });
return server;
};

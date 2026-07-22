import { describe, expect, it } from "vitest";
import { LocalApiError } from "../api/localApiClient";
import { resolveRepositoryBackend } from "./adapterSelection";
import {
  REQUIRED_SQLITE_REHEARSAL_CAPABILITIES,
  REQUIRED_SQLITE_UNSUPPORTED_OPERATIONS,
  normalizeSqliteAuthoritativeReadiness,
  normalizeSqliteAuthorityReadinessFailure,
} from "./sqliteAuthorityRehearsal";

const enabledCapabilities = Object.fromEntries(
  REQUIRED_SQLITE_REHEARSAL_CAPABILITIES.map((key) => [key, true]),
);

const metadata = {
  mode: "prototype",
  storageMode: "sqlite-authoritative",
  authoritative: true,
  cutoverVerified: true,
  backupVerified: true,
  rollbackAvailable: true,
  missingRequirements: [],
};

const readiness = {
  ok: true,
  authorityEnabled: true,
  ready: true,
  ...metadata,
  requiredCapabilities: [...REQUIRED_SQLITE_REHEARSAL_CAPABILITIES],
  unsupportedOperations: REQUIRED_SQLITE_UNSUPPORTED_OPERATIONS.filter(
    (operation) => operation !== "transaction_delete",
  ),
};

const capabilities = {
  ok: true,
  ...metadata,
  capabilities: {
    ...enabledCapabilities,
    transactionDeleteWrites: true,
    budgetLifecycleWrites: true,
    recipientDeleteMergeWrites: true,
    accountDeleteMergeWrites: true,
    categoryDeleteMergeWrites: true,
    bucketDeleteMergeWrites: true,
  },
  unsupportedOperations: [...REQUIRED_SQLITE_UNSUPPORTED_OPERATIONS],
  safety: {
    endpointReadOnly: true,
    sqliteAvailable: true,
    dexieAccessed: false,
    filesWritten: false,
    rawConfigurationIncluded: false,
  },
};

describe("SQLite authoritative frontend readiness", () => {
  it("recognizes the explicit backend without changing the default", () => {
    expect(resolveRepositoryBackend(undefined)).toBe("dexie");
    expect(resolveRepositoryBackend("http-sqlite-authoritative")).toBe(
      "http-sqlite-authoritative",
    );
    expect(resolveRepositoryBackend("bad-value")).toBe("dexie");
  });

  it("enables readiness only for matching verified server authority", () => {
    const result = normalizeSqliteAuthoritativeReadiness(
      metadata,
      readiness,
      capabilities,
    );
    expect(result.ready).toBe(true);
    expect(result.authoritativeMode).toBe(true);
    expect(result.transactionDeleteWritesAvailable).toBe(true);
    expect(result.budgetLifecycleWritesAvailable).toBe(true);
    expect(result.recipientDeleteMergeWritesAvailable).toBe(true);
    expect(result.accountDeleteMergeWritesAvailable).toBe(true);
    expect(result.categoryDeleteMergeWritesAvailable).toBe(true);
    expect(result.bucketDeleteMergeWritesAvailable).toBe(true);
  });

  it("fails closed when frontend authority meets a disposable server", () => {
    const result = normalizeSqliteAuthoritativeReadiness(
      { ...metadata, storageMode: "sqlite-disposable", authoritative: false },
      { ...readiness, authorityEnabled: false, ready: false },
      { ...capabilities, storageMode: "sqlite-disposable", authoritative: false },
    );
    expect(result.ready).toBe(false);
    expect(result.code).toBe("sqlite_authority_verification_failed");
  });

  it("fails closed when a capability or backup verification is missing", () => {
    const result = normalizeSqliteAuthoritativeReadiness(
      metadata,
      { ...readiness, backupVerified: false, rollbackAvailable: false },
      {
        ...capabilities,
        capabilities: { ...enabledCapabilities, transactionBasicWrites: false },
      },
    );
    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain(
      "capability:transactionBasicWrites",
    );
  });

  it("fails closed without fallback when the local API is unavailable", () => {
    const result = normalizeSqliteAuthorityReadinessFailure(
      new LocalApiError("local_api_unavailable", "unavailable"),
      "http-sqlite-authoritative",
    );
    expect(result.ready).toBe(false);
    expect(result.authoritativeMode).toBe(true);
    expect(result.missingRequirements).toContain("local_api_authority_check");
  });
});

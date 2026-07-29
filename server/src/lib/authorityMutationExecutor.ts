import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  readCanonicalAuthorityLogicalFingerprint,
  readAuthorityMutationDomainFingerprints,
} from "./sqliteLogicalVerification.js";
import {
  emptyDomainCounters,
  type DomainCounters,
  type MutationDomain,
} from "./authorityOpsSession.js";
import { AUTHORITY_MUTATION_DOMAIN_DEFINITIONS } from "./authorityMutationDomains.js";

export const AUTHORITY_MUTATION_PROOF_VERSION = 1 as const;

export interface AuthorityMutationProof {
  mutationProofVersion: typeof AUTHORITY_MUTATION_PROOF_VERSION;
  startingLogicalFingerprint: string;
  finalLogicalFingerprint: string;
  mutationChainDigest: string;
  approvedCommittedMutationCount: number;
}

export interface AuthorityMutationFence {
  readonly database: Database.Database;
  readonly domains: readonly MutationDomain[];
  readonly preFingerprint: string;
  readonly preDomainFingerprints: Readonly<Record<string, string>>;
  finalized: boolean;
  release: () => void;
  close: () => void;
}

export interface AuthorityMutationExecutorDependencies {
  afterWriterLock?: () => Promise<void>;
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: (() => void) | undefined;
    const predecessor = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release?.();
    };
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const safeRollback = (db: Database.Database): void => {
  try {
    if (db.inTransaction) db.exec("ROLLBACK");
  } catch {
    // Preserve the original stable failure category.
  }
};

export class AuthorityMutationExecutor {
  private readonly mutex = new AsyncMutex();
  private readonly startingLogicalFingerprint: string;
  private trustedLogicalFingerprint: string;
  private mutationChainDigest: string;
  private approvedCommittedMutationCount = 0;
  private counters: DomainCounters = emptyDomainCounters();
  private contaminated = false;

  constructor(
    private readonly sqlitePath: string,
    expectedStartingLogicalFingerprint: string,
    private readonly dependencies: AuthorityMutationExecutorDependencies = {},
  ) {
    let actual: string;
    try {
      const db = new Database(sqlitePath, { fileMustExist: true });
      try {
        actual = readCanonicalAuthorityLogicalFingerprint(db);
      } finally { db.close(); }
    } catch {
      throw new Error("starting_logical_fingerprint_mismatch");
    }
    if (actual !== expectedStartingLogicalFingerprint) {
      throw new Error("starting_logical_fingerprint_mismatch");
    }
    this.startingLogicalFingerprint = actual;
    this.trustedLogicalFingerprint = actual;
    this.mutationChainDigest = sha256(
      `authority-mutation-chain-v1\n${actual}`,
    );
  }

  isContaminated(): boolean {
    return this.contaminated;
  }

  domainCounters(): DomainCounters {
    return { ...this.counters };
  }

  async begin(domains: readonly MutationDomain[]): Promise<AuthorityMutationFence> {
    if (this.contaminated) throw new Error("untracked_database_change");
    const release = await this.mutex.acquire();
    if (this.contaminated) {
      release();
      throw new Error("untracked_database_change");
    }
    const db = new Database(this.sqlitePath, { fileMustExist: true });
    const realClose = db.close.bind(db);
    try {
      db.pragma("busy_timeout = 5000");
      try {
        db.exec("BEGIN IMMEDIATE");
      } catch {
        throw new Error("mutation_lock_timeout");
      }
      await this.dependencies.afterWriterLock?.();
      let preFingerprint: string;
      let preDomainFingerprints: Record<string, string>;
      try {
        preFingerprint = readCanonicalAuthorityLogicalFingerprint(db);
        preDomainFingerprints = readAuthorityMutationDomainFingerprints(db);
      } catch {
        throw new Error("mutation_fingerprint_failed");
      }
      if (preFingerprint !== this.trustedLogicalFingerprint) {
        this.contaminated = true;
        throw new Error("mutation_prestate_mismatch");
      }
      db.close = () => db;
      return {
        database: db,
        domains: [...domains],
        preFingerprint,
        preDomainFingerprints,
        finalized: false,
        release,
        close: realClose,
      };
    } catch (error) {
      safeRollback(db);
      realClose();
      release();
      throw error;
    }
  }

  commit(fence: AuthorityMutationFence): { changed: boolean; changedDomains: MutationDomain[] } {
    if (fence.finalized) throw new Error("mutation_commit_failed");
    fence.finalized = true;
    const db = fence.database;
    try {
      let postFingerprint: string;
      try {
        postFingerprint = readCanonicalAuthorityLogicalFingerprint(db);
      } catch {
        this.contaminated = true;
        throw new Error("mutation_fingerprint_failed");
      }
      const changed = postFingerprint !== fence.preFingerprint;
      const postDomainFingerprints = changed
        ? readAuthorityMutationDomainFingerprints(db)
        : fence.preDomainFingerprints;
      const changedDomains = AUTHORITY_MUTATION_DOMAIN_DEFINITIONS
        .map(({ domain }) => domain)
        .filter((domain) => postDomainFingerprints[domain] !== fence.preDomainFingerprints[domain]);
      try {
        db.exec("COMMIT");
      } catch {
        this.contaminated = true;
        throw new Error("mutation_commit_failed");
      }
      if (changed) {
        const nextCount = this.approvedCommittedMutationCount + 1;
        this.mutationChainDigest = sha256([
          "authority-mutation-chain-step-v1",
          this.mutationChainDigest,
          fence.preFingerprint,
          postFingerprint,
          String(nextCount),
          [...fence.domains].sort().join(","),
        ].join("\n"));
        this.trustedLogicalFingerprint = postFingerprint;
        this.approvedCommittedMutationCount = nextCount;
        for (const domain of changedDomains) this.counters[domain] += 1;
      }
      return { changed, changedDomains };
    } finally {
      safeRollback(db);
      fence.close();
      fence.release();
    }
  }

  rollback(fence: AuthorityMutationFence): void {
    if (fence.finalized) return;
    fence.finalized = true;
    try {
      safeRollback(fence.database);
    } finally {
      fence.close();
      fence.release();
    }
  }

  async finalizeSealProof(): Promise<AuthorityMutationProof> {
    if (this.contaminated) throw new Error("shutdown_logical_fingerprint_mismatch");
    const release = await this.mutex.acquire();
    const db = new Database(this.sqlitePath, { fileMustExist: true });
    try {
      db.pragma("busy_timeout = 5000");
      try {
        db.exec("BEGIN IMMEDIATE");
      } catch {
        throw new Error("mutation_lock_timeout");
      }
      let current: string;
      try {
        current = readCanonicalAuthorityLogicalFingerprint(db);
      } catch {
        throw new Error("mutation_fingerprint_failed");
      }
      if (current !== this.trustedLogicalFingerprint) {
        this.contaminated = true;
        throw new Error("shutdown_logical_fingerprint_mismatch");
      }
      db.exec("COMMIT");
      return {
        mutationProofVersion: AUTHORITY_MUTATION_PROOF_VERSION,
        startingLogicalFingerprint: this.startingLogicalFingerprint,
        finalLogicalFingerprint: this.trustedLogicalFingerprint,
        mutationChainDigest: this.mutationChainDigest,
        approvedCommittedMutationCount: this.approvedCommittedMutationCount,
      };
    } finally {
      safeRollback(db);
      db.close();
      release();
    }
  }
}

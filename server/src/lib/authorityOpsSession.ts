import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readSqliteLogicalVerificationAtPath } from "./sqliteLogicalVerification.js";
import type { AuthorityMutationProof } from "./authorityMutationExecutor.js";

export const AUTHORITY_SESSION_ID_ENV = "PERSONAL_FINANCE_AUTHORITY_SESSION_ID";
export const AUTHORITY_SESSION_SECRET_ENV = "PERSONAL_FINANCE_AUTHORITY_SESSION_SECRET";
export const AUTHORITY_SESSION_CONTEXT_ENV = "PERSONAL_FINANCE_AUTHORITY_SESSION_CONTEXT";

export type MutationDomain = "transactions" | "transfers" | "budgets" | "budgetSnapshots" | "accounts" | "paymentMethods" | "recipients" | "buckets" | "categories" | "smsImportTemplates" | "smsTemplates" | "deletes" | "merges";
export type DomainCounters = Record<MutationDomain, number>;
export const emptyDomainCounters = (): DomainCounters => ({ transactions: 0, transfers: 0, budgets: 0, budgetSnapshots: 0, accounts: 0, paymentMethods: 0, recipients: 0, buckets: 0, categories: 0, smsImportTemplates: 0, smsTemplates: 0, deletes: 0, merges: 0 });

export interface AuthoritySessionContext {
  version: 1;
  sessionId: string;
  profileIdentity: string;
  receiptPath: string;
  startingCheckpointId: string;
  startingCheckpointSequence: number;
  startingDatabaseFingerprint: string;
  startingLogicalFingerprint: string;
  startedAt: string;
}
export interface SealedAuthoritySessionReceipt extends AuthoritySessionContext {
  shutdownProofVersion: 2;
  mutationProofVersion: 1;
  finalLogicalFingerprint: string;
  mutationChainDigest: string;
  approvedCommittedMutationCount: number;
  finalDatabaseFingerprint: string;
  confirmedMutationCount: number;
  domainCounters: DomainCounters;
  lastConfirmedMutationAt: string | null;
  sealedAt: string;
  cleanShutdown: true;
  signature: string;
}

const canonical = (value: Omit<SealedAuthoritySessionReceipt, "signature">) => JSON.stringify(value);
export const signAuthoritySessionReceipt = (value: Omit<SealedAuthoritySessionReceipt, "signature">, secret: string) =>
  createHmac("sha256", secret).update(canonical(value)).digest("hex");

export const writeJsonAtomic = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, filePath);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
};

export const readSealedAuthoritySessionReceipt = (receiptPath: string, secret: string): SealedAuthoritySessionReceipt => {
  let value: unknown;
  try { value = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { throw new Error("authority_session_receipt_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authority_session_receipt_invalid");
  const receipt = value as SealedAuthoritySessionReceipt;
  if (receipt.version !== 1 || receipt.shutdownProofVersion !== 2 || receipt.mutationProofVersion !== 1 || receipt.cleanShutdown !== true || typeof receipt.signature !== "string" ||
      typeof receipt.sessionId !== "string" || typeof receipt.profileIdentity !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.startingLogicalFingerprint) ||
      !/^[a-f0-9]{64}$/.test(receipt.finalLogicalFingerprint) ||
      !/^[a-f0-9]{64}$/.test(receipt.mutationChainDigest) ||
      typeof receipt.finalDatabaseFingerprint !== "string" ||
      !Number.isInteger(receipt.approvedCommittedMutationCount) ||
      receipt.approvedCommittedMutationCount < 0 ||
      receipt.confirmedMutationCount !== receipt.approvedCommittedMutationCount) {
    throw new Error("authority_session_receipt_invalid");
  }
  const { signature, ...unsigned } = receipt;
  if (signAuthoritySessionReceipt(unsigned, secret) !== signature) throw new Error("authority_session_receipt_signature_invalid");
  return receipt;
};

export const assertAuthoritySessionReceiptMatches = (
  receipt: SealedAuthoritySessionReceipt,
  context: AuthoritySessionContext,
): void => {
  if (
    receipt.sessionId !== context.sessionId ||
    receipt.profileIdentity !== context.profileIdentity ||
    receipt.startingCheckpointId !== context.startingCheckpointId ||
    receipt.startingCheckpointSequence !== context.startingCheckpointSequence ||
    receipt.startingDatabaseFingerprint !== context.startingDatabaseFingerprint ||
    receipt.startingLogicalFingerprint !== context.startingLogicalFingerprint
  ) {
    throw new Error("authority_session_receipt_identity_invalid");
  }
};

export const createAuthoritySession = (context: Omit<AuthoritySessionContext, "version" | "sessionId" | "startedAt">) => ({
  context: { ...context, version: 1 as const, sessionId: randomBytes(24).toString("hex"), startedAt: new Date().toISOString() },
  secret: randomBytes(32).toString("base64url"),
});

export class AuthorityMutationTracker {
  private accepting = true;
  private activeMutations = 0;
  private count = 0;
  private counters = emptyDomainCounters();
  private lastAt: string | null = null;
  isAccepting(): boolean { return this.accepting; }
  stopAccepting(): void { this.accepting = false; }
  begin(): void { if (!this.accepting) throw new Error("authority_session_sealing"); this.activeMutations += 1; }
  confirm(domains: readonly MutationDomain[]): void { this.count += 1; for (const domain of domains) this.counters[domain] += 1; this.lastAt = new Date().toISOString(); }
  end(): void { this.activeMutations = Math.max(0, this.activeMutations - 1); }
  activeMutationCount(): number { return this.activeMutations; }
  async waitForDrain(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeMutations > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.activeMutations > 0) throw new Error("api_drain_timeout");
  }
  writeStoppedReceipt(context: AuthoritySessionContext, secret: string, sqlitePath: string, proof: AuthorityMutationProof): SealedAuthoritySessionReceipt {
    if (this.accepting || this.activeMutations > 0) throw new Error("clean_receipt_missing");
    if (
      proof.startingLogicalFingerprint !== context.startingLogicalFingerprint ||
      proof.approvedCommittedMutationCount !== this.count
    ) throw new Error("clean_receipt_missing");
    const finalDatabaseFingerprint = readSqliteLogicalVerificationAtPath(sqlitePath).databaseIdentityFingerprint;
    const unsigned = { ...context, shutdownProofVersion: 2 as const, ...proof, finalDatabaseFingerprint, confirmedMutationCount: this.count, domainCounters: this.counters, lastConfirmedMutationAt: this.lastAt, sealedAt: new Date().toISOString(), cleanShutdown: true as const };
    const receipt = { ...unsigned, signature: signAuthoritySessionReceipt(unsigned, secret) };
    writeJsonAtomic(context.receiptPath, receipt);
    return receipt;
  }
}

export const mutationDomainsForPath = (url: string): MutationDomain[] => {
  const value = url.split("?", 1)[0];
  const domains: MutationDomain[] = [];
  if (value.includes("/transactions/transfers/")) domains.push("transactions", "transfers");
  else if (value.includes("/transactions/")) domains.push("transactions");
  if (value.includes("/budgets/")) domains.push("budgets");
  // These operation families explicitly own both the definition and snapshots.
  if (value.includes("/budgets/lifecycle/write/") || value.includes("/budgets/delete/write")) domains.push("budgetSnapshots");
  if (value.includes("budget-snapshot")) domains.push("budgetSnapshots");
  for (const [needle, domain] of [["/accounts/", "accounts"], ["/recipients/", "recipients"], ["/buckets/", "buckets"], ["/categories/", "categories"], ["sms-import-templates", "smsImportTemplates"]] as const) if (value.includes(needle)) domains.push(domain);
  if (value.includes("/delete/")) domains.push("deletes");
  if (value.includes("/merge/")) domains.push("merges");
  return domains;
};

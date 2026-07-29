import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { AuthorityMutationExecutor } from "./lib/authorityMutationExecutor.js";
import {
  readCanonicalAuthorityLogicalFingerprintAtPath,
  readAuthorityMutationDomainFingerprints,
} from "./lib/sqliteLogicalVerification.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-mutation-executor-"));
const schema = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "prototype-schema.sql"),
  "utf8",
);
const createDatabase = (name: string) => {
  const file = path.join(root, name);
  const db = new Database(file);
  try { db.exec(schema); } finally { db.close(); }
  return file;
};
const countRecipients = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return Number((db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as { count: number }).count);
  } finally { db.close(); }
};

try {
  const file = createDatabase("executor.sqlite");
  const starting = readCanonicalAuthorityLogicalFingerprintAtPath(file);
  let startingMismatchRejected = false;
  try {
    new AuthorityMutationExecutor(file, "f".repeat(64));
  } catch (error) {
    startingMismatchRejected =
      error instanceof Error &&
      error.message === "starting_logical_fingerprint_mismatch";
  }
  if (!startingMismatchRejected) {
    throw new Error("starting_logical_fingerprint_mismatch_not_rejected");
  }
  const executor = new AuthorityMutationExecutor(file, starting);
  const initialProof = await executor.finalizeSealProof();

  const noOp = await executor.begin(["recipients"]);
  const noOpResult = executor.commit(noOp);
  const afterNoOp = await executor.finalizeSealProof();
  if (
    noOpResult.changed ||
    afterNoOp.approvedCommittedMutationCount !== 0 ||
    afterNoOp.mutationChainDigest !== initialProof.mutationChainDigest ||
    afterNoOp.finalLogicalFingerprint !== starting
  ) throw new Error("no_op_advanced_mutation_chain");

  const rolledBack = await executor.begin(["recipients"]);
  rolledBack.database.prepare(
    "INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)",
  ).run("rolled-back", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
  executor.rollback(rolledBack);
  if (
    countRecipients(file) !== 0 ||
    (await executor.finalizeSealProof()).mutationChainDigest !== initialProof.mutationChainDigest
  ) throw new Error("rollback_advanced_mutation_chain");

  const failed = await executor.begin(["recipients"]);
  let failedSql = false;
  try {
    failed.database.prepare("INSERT INTO table_that_does_not_exist VALUES (1)").run();
  } catch { failedSql = true; }
  executor.rollback(failed);
  if (!failedSql || countRecipients(file) !== 0) {
    throw new Error("failed_transaction_changed_database");
  }

  const valid = await executor.begin(["recipients"]);
  valid.database.prepare(
    "INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)",
  ).run("approved", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
  if (!executor.commit(valid).changed) throw new Error("valid_mutation_not_detected");
  const validProof = await executor.finalizeSealProof();
  if (
    validProof.approvedCommittedMutationCount !== 1 ||
    validProof.mutationChainDigest === initialProof.mutationChainDigest ||
    validProof.finalLogicalFingerprint !==
      readCanonicalAuthorityLogicalFingerprintAtPath(file)
  ) throw new Error("valid_mutation_proof_invalid");

  // Diagnostic classification is derived from every authoritative table, not
  // from the route's declared domain. One fenced write may touch multiple
  // domains and must report each touched table exactly once.
  const crossDomain = await executor.begin(["recipients"]);
  crossDomain.database.prepare(
    `INSERT INTO accounts
     (id, name, isActive, isCredit, createdAt, updatedAt)
     VALUES (?, ?, 1, 0, ?, ?)`,
  ).run(7001, "cross-domain-account", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
  crossDomain.database.prepare(
    `INSERT INTO transactions
     (id, categoryId, recipientId, date, amount, description)
     VALUES (?, 1, 1, ?, ?, ?)`,
  ).run(7001, "2026-07-27T00:00:00.000Z", -7, "cross-domain-transaction");
  const crossDomainResult = executor.commit(crossDomain);
  if (
    !crossDomainResult.changed ||
    crossDomainResult.changedDomains.length !== 2 ||
    !crossDomainResult.changedDomains.includes("accounts") ||
    !crossDomainResult.changedDomains.includes("transactions") ||
    crossDomainResult.changedDomains.includes("recipients")
  ) throw new Error("cross_domain_diagnostic_classification_failed");

  const contaminatedFile = createDatabase("contaminated.sqlite");
  const contaminatedStart =
    readCanonicalAuthorityLogicalFingerprintAtPath(contaminatedFile);
  const contaminated = new AuthorityMutationExecutor(
    contaminatedFile,
    contaminatedStart,
  );
  const external = new Database(contaminatedFile);
  try {
    external.prepare(
      "INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)",
    ).run("external", "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
  } finally { external.close(); }
  let mismatch = false;
  try { await contaminated.begin(["recipients"]); }
  catch (error) {
    mismatch = error instanceof Error && error.message === "mutation_prestate_mismatch";
  }
  const restore = new Database(contaminatedFile);
  try { restore.prepare("DELETE FROM recipients").run(); } finally { restore.close(); }
  let irreversible = false;
  try { await contaminated.begin(["recipients"]); }
  catch (error) {
    irreversible = error instanceof Error && error.message === "untracked_database_change";
  }
  if (!mismatch || !irreversible || !contaminated.isContaminated()) {
    throw new Error("contamination_not_irreversible");
  }

  const large = createDatabase("large.sqlite");
  const largeDb = new Database(large);
  try {
    const insert = largeDb.prepare(
      `INSERT INTO transactions
       (id, categoryId, recipientId, date, amount, description)
       VALUES (?, 1, 1, ?, ?, ?)`,
    );
    const populate = largeDb.transaction(() => {
      for (let id = 1; id <= 5_000; id += 1) {
        insert.run(id, "2026-07-27T00:00:00.000Z", -id, `synthetic-${id}`);
      }
    });
    populate();
  } finally { largeDb.close(); }
  const smallStarted = performance.now();
  const smallFingerprint = readCanonicalAuthorityLogicalFingerprintAtPath(file);
  const smallMs = performance.now() - smallStarted;
  const largeStarted = performance.now();
  const largeFingerprint = readCanonicalAuthorityLogicalFingerprintAtPath(large);
  const largeMs = performance.now() - largeStarted;
  const smallDomainDb = new Database(file, { readonly: true });
  const smallDomainStarted = performance.now();
  readAuthorityMutationDomainFingerprints(smallDomainDb);
  const smallDomainMs = performance.now() - smallDomainStarted;
  smallDomainDb.close();
  const largeDomainDb = new Database(large, { readonly: true });
  const largeDomainStarted = performance.now();
  readAuthorityMutationDomainFingerprints(largeDomainDb);
  const largeDomainMs = performance.now() - largeDomainStarted;
  largeDomainDb.close();
  const backup = path.join(root, "large-backup.sqlite");
  const backupSource = new Database(large, { readonly: true });
  await backupSource.backup(backup);
  backupSource.close();
  if (
    smallFingerprint.length !== 64 ||
    largeFingerprint.length !== 64 ||
    readCanonicalAuthorityLogicalFingerprintAtPath(backup) !== largeFingerprint
  ) throw new Error("logical_fingerprint_backup_determinism_failed");
  const changedSchema = new Database(backup);
  try { changedSchema.exec("CREATE INDEX synthetic_description_index ON transactions(description)"); }
  finally { changedSchema.close(); }
  if (readCanonicalAuthorityLogicalFingerprintAtPath(backup) === largeFingerprint) {
    throw new Error("logical_fingerprint_schema_change_not_detected");
  }

  console.log(`Authority mutation executor tests: PASS; fingerprint small=${smallMs.toFixed(1)}ms large5000=${largeMs.toFixed(1)}ms; domains small=${smallDomainMs.toFixed(1)}ms large5000=${largeDomainMs.toFixed(1)}ms`);
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

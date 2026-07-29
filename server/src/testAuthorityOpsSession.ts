import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertAuthoritySessionReceiptMatches, createAuthoritySession, emptyDomainCounters, readSealedAuthoritySessionReceipt, signAuthoritySessionReceipt, writeJsonAtomic } from "./lib/authorityOpsSession.js";

const directory = mkdtempSync(path.join(os.tmpdir(), "pf-authority-session-"));
try {
  const created = createAuthoritySession({ profileIdentity: "profile", receiptPath: path.join(directory, "session.json"), startingCheckpointId: "checkpoint", startingCheckpointSequence: 1, startingDatabaseFingerprint: "start", startingLogicalFingerprint: "a".repeat(64) });
  const unsigned = { ...created.context, shutdownProofVersion: 2 as const, mutationProofVersion: 1 as const, finalLogicalFingerprint: "b".repeat(64), mutationChainDigest: "c".repeat(64), approvedCommittedMutationCount: 2, finalDatabaseFingerprint: "final", confirmedMutationCount: 2, domainCounters: { ...emptyDomainCounters(), transactions: 2 }, lastConfirmedMutationAt: new Date().toISOString(), sealedAt: new Date().toISOString(), cleanShutdown: true as const };
  writeJsonAtomic(created.context.receiptPath, { ...unsigned, signature: signAuthoritySessionReceipt(unsigned, created.secret) });
  const receipt = readSealedAuthoritySessionReceipt(created.context.receiptPath, created.secret);
  if (receipt.confirmedMutationCount !== 2 || receipt.domainCounters.transactions !== 2) throw new Error("receipt_roundtrip_failed");
  assertAuthoritySessionReceiptMatches(receipt, created.context);
  let rejected = false;
  try { readSealedAuthoritySessionReceipt(created.context.receiptPath, "wrong-secret"); } catch { rejected = true; }
  if (!rejected) throw new Error("receipt_signature_not_enforced");
  const { shutdownProofVersion: _proof, signature: _signature, ...legacyUnsigned } = receipt;
  writeJsonAtomic(created.context.receiptPath, { ...legacyUnsigned, signature: signAuthoritySessionReceipt(legacyUnsigned as never, created.secret) });
  let legacyRejected = false;
  try { readSealedAuthoritySessionReceipt(created.context.receiptPath, created.secret); } catch { legacyRejected = true; }
  if (!legacyRejected) throw new Error("legacy_pre_shutdown_receipt_accepted");
  writeJsonAtomic(created.context.receiptPath, receipt);
  const { mutationProofVersion: _mutationProof, finalLogicalFingerprint: _finalLogical, mutationChainDigest: _chain, approvedCommittedMutationCount: _approved, signature: _mutationSignature, ...preMutationProof } = receipt;
  writeJsonAtomic(created.context.receiptPath, { ...preMutationProof, signature: signAuthoritySessionReceipt(preMutationProof as never, created.secret) });
  let missingMutationProofRejected = false;
  try { readSealedAuthoritySessionReceipt(created.context.receiptPath, created.secret); } catch { missingMutationProofRejected = true; }
  if (!missingMutationProofRejected) throw new Error("legacy_pre_mutation_proof_receipt_accepted");
  writeJsonAtomic(created.context.receiptPath, receipt);
  for (const altered of [
    { ...receipt, sessionId: "foreign-session" },
    { ...receipt, profileIdentity: "foreign-profile" },
    { ...receipt, startingCheckpointId: "foreign-checkpoint" },
    { ...receipt, startingCheckpointSequence: receipt.startingCheckpointSequence + 1 },
    { ...receipt, startingDatabaseFingerprint: "foreign-fingerprint" },
    { ...receipt, startingLogicalFingerprint: "d".repeat(64) },
  ]) {
    const { signature: _signature, ...unsignedAltered } = altered;
    const signed = { ...unsignedAltered, signature: signAuthoritySessionReceipt(unsignedAltered, created.secret) };
    let identityRejected = false;
    try { assertAuthoritySessionReceiptMatches(signed, created.context); } catch { identityRejected = true; }
    if (!identityRejected) throw new Error("receipt_foreign_identity_accepted");
  }
  console.log("Authority session receipt test: PASS");
} finally { rmSync(directory, { recursive: true, force: true }); }

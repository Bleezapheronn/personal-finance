import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionFiles = execFileSync("rg", ["--files", "server/src"], {
  cwd: root,
  encoding: "utf8",
}).split(/\r?\n/).filter(Boolean).map((name) => name.replaceAll("\\", "/"))
  .filter((name) => name.endsWith(".ts") && !/server\/src\/test[^/]*\.ts$/i.test(name));
const directDatabaseAllowlist = new Set([
  "server/src/hydrateAccountImages.ts",
  "server/src/importBackup.ts",
  "server/src/lib/authorityCheckpointAcceptance.ts",
  "server/src/lib/authorityMutationExecutor.ts",
  "server/src/lib/sqlite.ts",
  "server/src/lib/sqliteAuthorityCutover.ts",
  "server/src/lib/sqliteBackupRestore.ts",
]);
const helperTransactionAllowlist = new Set([
  "server/src/importBackup.ts",
  "server/src/lib/accountImageHydration.ts",
  "server/src/lib/accountLifecycle.ts",
  "server/src/lib/accountWrite.ts",
  "server/src/lib/bucketCategoryWrite.ts",
  "server/src/lib/bucketLifecycle.ts",
  "server/src/lib/budgetDefinitionWrite.ts",
  "server/src/lib/budgetDelete.ts",
  "server/src/lib/budgetFromTransaction.ts",
  "server/src/lib/budgetLifecycle.ts",
  "server/src/lib/budgetSnapshotGenerationWrite.ts",
  "server/src/lib/budgetSnapshotOccurrence.ts",
  "server/src/lib/categoryLifecycle.ts",
  "server/src/lib/recipientLifecycle.ts",
  "server/src/lib/recipientWrite.ts",
  "server/src/lib/smsTemplateWrite.ts",
  "server/src/lib/transactionBasicWrite.ts",
  "server/src/lib/transactionDelete.ts",
  "server/src/lib/transactionTransferWrite.ts",
]);
const writerFenceAllowlist = new Set([
  "server/src/lib/authorityCheckpointAcceptance.ts",
  "server/src/lib/authorityMutationExecutor.ts",
]);
const violations = [];
for (const name of productionFiles) {
  const source = readFileSync(path.join(root, name), "utf8");
  if (source.includes("openWritableExistingDatabase")) {
    violations.push(`${name}: unrestricted writable acquisition`);
  }
  if (/\bnew\s+Database\s*\(/.test(source) && !directDatabaseAllowlist.has(name)) {
    violations.push(`${name}: direct SQLite connection outside allowlist`);
  }
  if (/\.transaction\s*\(/.test(source) && !helperTransactionAllowlist.has(name)) {
    violations.push(`${name}: transaction creation outside reviewed helper allowlist`);
  }
  if (/\bBEGIN\s+(?:IMMEDIATE|EXCLUSIVE|TRANSACTION)\b/i.test(source) &&
      !writerFenceAllowlist.has(name)) {
    violations.push(`${name}: live writer transaction outside authority executor`);
  }
}
const apiSource = readFileSync(
  path.join(root, "server/src/createAuthorityApiServer.ts"),
  "utf8",
);
for (const proof of [
  "authorityMutationExecutor.begin(domains)",
  "authorityMutationExecutor!.commit(context.fence)",
  "unguarded_authoritative_write",
  'url.split("?", 1)[0].includes("/write/")',
]) {
  if (!apiSource.includes(proof)) {
    violations.push(`server/src/createAuthorityApiServer.ts: missing boundary proof ${proof}`);
  }
}
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Authority write-boundary guard: PASS (${productionFiles.length} production files)`);

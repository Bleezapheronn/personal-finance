import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mutationDomainsForPath } from "./lib/authorityOpsSession.js";

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "createAuthorityApiServer.ts"), "utf8");
const expected: Array<[string, string[]]> = [
  ["/prototype/repositories/transactions/write/create", ["transactions"]],
  ["/prototype/repositories/transactions/transfers/write/create", ["transactions", "transfers"]],
  ["/prototype/repositories/transactions/delete/write", ["transactions", "deletes"]],
  ["/prototype/repositories/budgets/write/create", ["budgets"]],
  ["/prototype/repositories/budget-snapshot-occurrences/write/create", ["budgetSnapshots"]],
  ["/prototype/repositories/accounts/merge/write", ["accounts", "merges"]],
  ["/prototype/repositories/recipients/delete/write", ["recipients", "deletes"]],
  ["/prototype/repositories/buckets/merge/write", ["buckets", "merges"]],
  ["/prototype/repositories/categories/write/create", ["categories"]],
  ["/prototype/repositories/sms-import-templates/write/create", ["smsImportTemplates"]],
];
const focusedClassification: Array<[string, string[]]> = [
  ["/prototype/repositories/categories/write/create", ["categories"]],
  ["/prototype/repositories/transactions/dry-run/create", ["transactions"]],
  ["/prototype/repositories/transactions/write/create", ["transactions"]],
];
for (const [route, domains] of focusedClassification) {
  const actual = mutationDomainsForPath(route);
  if (actual.length !== domains.length || !domains.every((domain) => actual.includes(domain as never))) {
    throw new Error(`focused_mutation_domain_classification_failed_${route}`);
  }
}
for (const route of [
  "/prototype/repositories/categories/dry-run/create",
  "/prototype/repositories/transactions/dry-run/create",
  "/health",
  "/metadata",
]) {
  if (route.includes("/write/") && mutationDomainsForPath(route).length === 0) throw new Error(`write_route_unclassified_${route}`);
  if (!route.includes("/write/") && (route === "/health" || route === "/metadata") && mutationDomainsForPath(route).length !== 0) throw new Error(`non_write_route_classified_${route}`);
}
for (const [route, domains] of expected) {
  const actual = mutationDomainsForPath(route);
  if (!domains.every((domain) => actual.includes(domain as never))) throw new Error(`mutation_domain_untracked_${route}`);
}
if (!source.includes("authorityMutationExecutor.begin(domains)")) throw new Error("transaction_fence_begin_missing");
if (!source.includes("authorityMutationExecutor!.commit(context.fence)")) throw new Error("transaction_fence_commit_missing");
if (!source.includes("unguarded_authoritative_write")) throw new Error("unguarded_write_assertion_missing");
if (source.includes("openWritableExistingDatabase") || source.includes("SELECT total_changes() AS count")) throw new Error("legacy_writable_or_count_trust_present");
if ((source.match(/openConfiguredWritableDatabase\(/g) ?? []).length < 18) throw new Error("authoritative_write_route_coverage_reduced");
console.log("Authority session tracking structural test: PASS");

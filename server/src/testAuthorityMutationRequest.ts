import { isAuthoritativeMutationPath } from "./lib/authorityMutationRequest.js";

const cases: Array<[string, boolean]> = [
  ["/prototype/repositories/transactions/delete/write", true],
  ["/prototype/repositories/recipients/write/create", true],
  ["/prototype/repositories/transactions/delete/dry-run", false],
  ["/prototype/repositories/transactions/1", false],
  ["/prototype/repositories/writeable/read", false],
  ["/prototype/repositories/transactions/delete/write?dryRun=false", true],
];
for (const [path, expected] of cases) {
  if (isAuthoritativeMutationPath(path) !== expected) {
    throw new Error("authority_mutation_path_classification_failed");
  }
}
console.log(`Authority mutation path classification: PASS (${cases.length} cases)`);

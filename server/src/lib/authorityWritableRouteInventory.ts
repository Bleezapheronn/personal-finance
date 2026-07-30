import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAuthoritativeMutationPath } from "./authorityMutationRequest.js";
import { realSupervisorScenarios, type RealSupervisorScenario } from "./authorityRealSupervisorScenarioRegistry.js";
import { productionAuthenticatedCommittedWriteRoutes } from "./authorityProductionWriteRouteRegistry.js";

export type WritableRouteCoverageStatus = "covered" | "planned" | "excluded";
export type WritableRouteFamily =
  | "recipients" | "accounts" | "categories" | "buckets" | "transactions"
  | "transfers" | "budgets" | "budget-snapshots" | "budget-occurrences"
  | "budget-from-transaction" | "sms-import-templates" | "payment-method-compatibility";

export interface WritableRouteInventoryEntry {
  method: "POST";
  path: string;
  family: WritableRouteFamily;
  operation: string;
  authenticationRequired: true;
  committedWrite: true;
  mutationPathClassification: "authoritative";
  registrationMarker: string;
  dryRunPath?: string;
  coverageStatus: WritableRouteCoverageStatus;
  realSupervisorScenarioId?: string;
  exclusionReason?: string;
}
export interface WritableRouteExclusion { family: WritableRouteFamily; reason: string; }
export const writableRouteInventoryExclusions: WritableRouteExclusion[] = [
  { family: "payment-method-compatibility", reason: "No authenticated payment-method production write route is registered; only legacy compatibility references are present." },
];

const covered = (family: WritableRouteFamily, operation: string, path: string, marker = path, scenario = "authority-route-families") => ({ family, operation, path, registrationMarker: marker, coverageStatus: "covered" as const, realSupervisorScenarioId: scenario });
const planned = (family: WritableRouteFamily, operation: string, path: string, marker: string, dryRunPath?: string) => ({ family, operation, path, registrationMarker: marker, dryRunPath, coverageStatus: "planned" as const });

const actionRoutes = (family: WritableRouteFamily, template: string, actions: readonly string[], marker: string, status: "covered" | "planned", scenario?: string) => actions.map((operation) => status === "covered" ? covered(family, operation, template.replace("{action}", operation), marker, scenario) : planned(family, operation, template.replace("{action}", operation), marker, template.replace("/write/", "/dry-run/"))) ;

const definitions = [
  covered("budgets", "definition-create", "/prototype/repositories/budgets/write/create", "/prototype/repositories/budgets/write/${action}", "authority-budget-definition-create"),
  covered("budgets", "definition-update", "/prototype/repositories/budgets/write/update", "/prototype/repositories/budgets/write/${action}", "authority-budget-definition-update"),
  covered("buckets", "delete", "/prototype/repositories/buckets/delete/write", "/prototype/repositories/buckets/${action}/write", "authority-bucket-delete"),
  covered("buckets", "merge", "/prototype/repositories/buckets/merge/write", "/prototype/repositories/buckets/${action}/write", "authority-bucket-merge"),
  covered("accounts", "delete", "/prototype/repositories/accounts/delete/write", "/prototype/repositories/accounts/${action}/write", "authority-account-delete"),
  covered("accounts", "merge", "/prototype/repositories/accounts/merge/write", "/prototype/repositories/accounts/${action}/write", "authority-account-merge"),
  covered("categories", "delete", "/prototype/repositories/categories/delete/write", "/prototype/repositories/categories/${action}/write", "authority-category-delete"),
  covered("categories", "merge", "/prototype/repositories/categories/merge/write", "/prototype/repositories/categories/${action}/write", "authority-category-merge"),
  ...actionRoutes("budgets", "/prototype/repositories/budgets/lifecycle/write/{action}", ["create", "update"], "/prototype/repositories/budgets/lifecycle/write/${action}", "covered", "authority-route-families"),
  covered("budget-occurrences", "delete", "/prototype/repositories/budget-snapshot-occurrences/write/delete", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-delete"),
  covered("budget-occurrences", "create", "/prototype/repositories/budget-snapshot-occurrences/write/create", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-create"),
  covered("budget-occurrences", "link", "/prototype/repositories/budget-snapshot-occurrences/write/link", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-link"),
  covered("budget-occurrences", "changeLink", "/prototype/repositories/budget-snapshot-occurrences/write/changeLink", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-change-link"),
  covered("budget-occurrences", "unlink", "/prototype/repositories/budget-snapshot-occurrences/write/unlink", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-unlink"),
  covered("budget-occurrences", "createAndLink", "/prototype/repositories/budget-snapshot-occurrences/write/createAndLink", "/prototype/repositories/budget-snapshot-occurrences/write/${action}", "authority-occurrence-create-and-link"),
  covered("budget-from-transaction", "create", "/prototype/repositories/budgets/from-transaction/write", "/prototype/repositories/budgets/from-transaction/write", "authority-budget-from-transaction"),
  covered("budgets", "delete", "/prototype/repositories/budgets/delete/write", "/prototype/repositories/budgets/delete/write", "authority-budget-delete"),
  { ...planned("transactions", "delete", "/prototype/repositories/transactions/delete/write", "/prototype/repositories/transactions/delete/write", "/prototype/repositories/transactions/delete/dry-run"), coverageStatus: "covered" as const, realSupervisorScenarioId: "authority-transaction-delete" },
  covered("budget-snapshots", "generate", "/prototype/repositories/budget-snapshots/lifecycle/write/generate", "/prototype/repositories/budget-snapshots/lifecycle/write/generate", "authority-snapshot-generation"),
  covered("buckets", "create", "/prototype/repositories/buckets/write/create", "/prototype/repositories/${config.resource}/write/${action}", "authority-bucket-create"),
  covered("buckets", "update", "/prototype/repositories/buckets/write/update", "/prototype/repositories/${config.resource}/write/${action}", "authority-bucket-update"),
  ...actionRoutes("buckets", "/prototype/repositories/buckets/active-state/write/{action}", ["activate", "deactivate"], "/prototype/repositories/buckets/active-state/write/${action}", "covered", "authority-bucket-active-state"),
  covered("buckets", "reorder", "/prototype/repositories/buckets/reorder/write", "/prototype/repositories/buckets/reorder/write", "authority-bucket-reorder"),
  covered("categories", "create", "/prototype/repositories/categories/write/create", "/prototype/repositories/${config.resource}/write/${action}", "authority-category-create"),
  covered("categories", "update", "/prototype/repositories/categories/write/update", "/prototype/repositories/${config.resource}/write/${action}", "authority-category-update"),
  ...actionRoutes("categories", "/prototype/repositories/categories/active-state/write/{action}", ["activate", "deactivate"], "/prototype/repositories/categories/active-state/write/${action}", "covered", "authority-category-active-state"),
  covered("accounts", "create", "/prototype/repositories/accounts/write/create", "/prototype/repositories/accounts/write/${action}", "authority-account-create"),
  covered("accounts", "update", "/prototype/repositories/accounts/write/update", "/prototype/repositories/accounts/write/${action}", "authority-account-update"),
  ...actionRoutes("accounts", "/prototype/repositories/accounts/active-state/write/{action}", ["activate", "deactivate"], "/prototype/repositories/accounts/active-state/write/${action}", "covered", "authority-account-active-state"),
  ...actionRoutes("transactions", "/prototype/repositories/transactions/write/{action}", ["create", "update"], "/prototype/repositories/transactions/write/${action}", "covered", "authority-route-families"),
  covered("transfers", "create", "/prototype/repositories/transactions/transfers/write/create", "/prototype/repositories/transactions/transfers/write/${action}", "authority-transfer-create"),
  covered("transfers", "update", "/prototype/repositories/transactions/transfers/write/update", "/prototype/repositories/transactions/transfers/write/${action}", "authority-transfer-update"),
  covered("recipients", "activate", "/prototype/repositories/recipients/write/activate", "/prototype/repositories/recipients/write/activate", "authority-recipient-activate"),
  covered("recipients", "create", "/prototype/repositories/recipients/write/create", undefined, "authority-recipient-lifecycle"),
  covered("recipients", "update", "/prototype/repositories/recipients/write/update", undefined, "authority-recipient-lifecycle"),
  covered("recipients", "deactivate", "/prototype/repositories/recipients/write/deactivate", "/prototype/repositories/recipients/write/deactivate", "authority-recipient-deactivate"),
  ...actionRoutes("recipients", "/prototype/repositories/recipients/{action}/write", ["delete", "merge"], "/prototype/repositories/recipients/${action}/write", "covered", "authority-recipient-lifecycle"),
  covered("sms-import-templates", "create", "/prototype/repositories/sms-import-templates/write/create", "/prototype/repositories/sms-import-templates/write/${action}", "authority-sms-template-create"),
  covered("sms-import-templates", "update", "/prototype/repositories/sms-import-templates/write/update", "/prototype/repositories/sms-import-templates/write/${action}", "authority-sms-template-update"),
  covered("sms-import-templates", "activate", "/prototype/repositories/sms-import-templates/write/activate", "/prototype/repositories/sms-import-templates/write/${action}", "authority-sms-template-activate"),
  covered("sms-import-templates", "deactivate", "/prototype/repositories/sms-import-templates/write/deactivate", "/prototype/repositories/sms-import-templates/write/${action}", "authority-sms-template-deactivate"),
  covered("sms-import-templates", "delete", "/prototype/repositories/sms-import-templates/write/delete", "/prototype/repositories/sms-import-templates/write/${action}", "authority-sms-template-delete"),
].map((entry) => ({ ...entry, method: "POST" as const, authenticationRequired: true as const, committedWrite: true as const, mutationPathClassification: "authoritative" as const }));

export const writableRouteInventory: WritableRouteInventoryEntry[] = definitions;

export interface InventorySummary { inspected: number; committed: number; covered: number; planned: number; excluded: number; unknown: number; byFamily: Record<string, number>; }
export const summarizeWritableRouteInventory = (): InventorySummary => {
  const byFamily: Record<string, number> = {};
  for (const entry of writableRouteInventory) byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1;
  return { inspected: writableRouteInventory.length, committed: writableRouteInventory.filter((e) => e.committedWrite).length, covered: writableRouteInventory.filter((e) => e.coverageStatus === "covered").length, planned: writableRouteInventory.filter((e) => e.coverageStatus === "planned").length, excluded: writableRouteInventoryExclusions.length + writableRouteInventory.filter((e) => e.coverageStatus === "excluded").length, unknown: writableRouteInventory.filter((e) => !e.coverageStatus).length, byFamily };
};

export interface WritableRouteValidationOptions {
  readonly productionRoutes?: readonly string[];
  readonly scenarios?: readonly RealSupervisorScenario[];
  readonly scriptNames?: ReadonlySet<string>;
}

export const validateWritableRouteEntries = (entries: readonly WritableRouteInventoryEntry[], _source: string, requireComplete = false, options: WritableRouteValidationOptions = {}): InventorySummary => {
  const productionRoutes = options.productionRoutes ?? productionAuthenticatedCommittedWriteRoutes;
  const scenarios = options.scenarios ?? realSupervisorScenarios;
  const scriptNames = options.scriptNames ?? new Set<string>();
  const production = new Set(productionRoutes);
  if (production.size !== productionRoutes.length) throw new Error("duplicate_production_route");
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.method}:${entry.path}`;
    if (seen.has(key)) throw new Error(`duplicate_inventory_route:${key}`);
    seen.add(key);
    if (!entry.authenticationRequired || !entry.committedWrite || entry.mutationPathClassification !== "authoritative" || !isAuthoritativeMutationPath(entry.path)) throw new Error(`invalid_inventory_route:${key}`);
    if (!production.has(entry.path)) throw new Error(`inventory_route_not_production:${key}`);
    if (entry.coverageStatus === "covered" && !entry.realSupervisorScenarioId) throw new Error(`covered_route_missing_executed_scenario:${key}`);
    if (entry.coverageStatus === "excluded" && !entry.exclusionReason) throw new Error(`excluded_route_missing_reason:${key}`);
  }
  for (const route of production) if (!seen.has(`POST:${route}`)) throw new Error(`production_route_missing_inventory:${route}`);
  const claims = new Map<string, number>();
  for (const scenario of scenarios) {
    if (scenario.executed && scenario.routes.length === 0) throw new Error(`covered_scenario_empty_routes:${scenario.id}`);
    if (scriptNames.size && !scriptNames.has(scenario.command)) throw new Error(`scenario_command_missing:${scenario.id}:${scenario.command}`);
    for (const route of scenario.routes) {
      if (!production.has(route)) throw new Error(`scenario_route_not_production:${scenario.id}:${route}`);
      const inventory = entries.find((entry) => entry.method === "POST" && entry.path === route);
      if (!inventory || inventory.coverageStatus !== "covered") throw new Error(`scenario_route_not_covered_inventory:${scenario.id}:${route}`);
      claims.set(route, (claims.get(route) ?? 0) + 1);
    }
  }
  for (const entry of entries.filter((entry) => entry.coverageStatus === "covered")) {
    const claimCount = claims.get(entry.path) ?? 0;
    if (claimCount === 0) throw new Error(`covered_route_missing_scenario_membership:${entry.path}`);
    if (claimCount > 1) throw new Error(`duplicate_scenario_route_claim:${entry.path}`);
  }
  const byFamily: Record<string, number> = {};
  for (const entry of entries) byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1;
  const summary = { inspected: entries.length, committed: entries.filter((e) => e.committedWrite).length, covered: entries.filter((e) => e.coverageStatus === "covered").length, planned: entries.filter((e) => e.coverageStatus === "planned").length, excluded: writableRouteInventoryExclusions.length + entries.filter((e) => e.coverageStatus === "excluded").length, unknown: entries.filter((e) => !e.coverageStatus).length, byFamily };
  if (summary.unknown !== 0) throw new Error(`unknown_routes:${summary.unknown}`);
  if (requireComplete && summary.planned !== 0) throw new Error(`planned_routes:${[...new Set(entries.filter((e) => e.coverageStatus === "planned").map((e) => e.family))].join(",")}`);
  return summary;
};

export const assertWritableRouteInventory = (requireComplete = false): InventorySummary => {
  const sourcePath = fileURLToPath(new URL("../createAuthorityApiServer.ts", import.meta.url));
  const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
  return validateWritableRouteEntries(writableRouteInventory, readFileSync(sourcePath, "utf8"), requireComplete, { scriptNames: new Set(Object.keys(packageJson.scripts ?? {})) });
};

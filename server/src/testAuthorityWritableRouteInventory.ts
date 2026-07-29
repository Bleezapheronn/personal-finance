import { assertWritableRouteInventory, summarizeWritableRouteInventory, validateWritableRouteEntries, writableRouteInventory, writableRouteInventoryExclusions } from "./lib/authorityWritableRouteInventory.js";
import { isAuthoritativeMutationPath } from "./lib/authorityMutationRequest.js";
import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import type { RealSupervisorScenario } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { productionAuthenticatedCommittedWriteRoutes } from "./lib/authorityProductionWriteRouteRegistry.js";

const summary = assertWritableRouteInventory(process.argv.includes("--require-complete"));
const route = (path: string) => writableRouteInventory.find((entry) => entry.path === path);
const requireEntry = (path: string) => { const entry = route(path); if (!entry) throw new Error(`missing_expected_inventory_entry:${path}`); return entry; };

// Focused drift guards. These use disposable metadata and never alter production registration.
if (writableRouteInventory.some((entry) => entry.path === "/test-support/write/no-op")) throw new Error("test_support_route_in_inventory");
if (isAuthoritativeMutationPath("/prototype/repositories/transactions/dry-run/delete")) throw new Error("dry_run_classified_authoritative");
if (isAuthoritativeMutationPath("/prototype/repositories/transactions/rewritten")) throw new Error("unrelated_write_word_classified_authoritative");
if (!isAuthoritativeMutationPath("/prototype/repositories/transactions/delete/write")) throw new Error("terminal_write_not_classified_authoritative");
const recipientCreate = requireEntry("/prototype/repositories/recipients/write/create");
if (recipientCreate.coverageStatus !== "covered" || recipientCreate.realSupervisorScenarioId !== "authority-recipient-lifecycle") throw new Error("recipient_create_coverage_not_registered");
const transactionDelete = requireEntry("/prototype/repositories/transactions/delete/write");
if (transactionDelete.realSupervisorScenarioId !== "authority-transaction-delete") throw new Error("transaction_delete_coverage_not_registered");
if (summary.unknown !== 0) throw new Error("unknown_inventory_status");
if (!writableRouteInventoryExclusions.every((entry) => entry.reason.trim().length > 0)) throw new Error("unsupported_exclusion_without_reason");
const scripts = new Set(realSupervisorScenarios.map((scenario) => scenario.command));
const validate = (entries: readonly typeof writableRouteInventory[number][] = writableRouteInventory, scenarios: readonly RealSupervisorScenario[] = realSupervisorScenarios, productionRoutes: readonly string[] = productionAuthenticatedCommittedWriteRoutes, scriptNames: ReadonlySet<string> = scripts) => validateWritableRouteEntries(entries, "fixture", true, { scenarios, productionRoutes, scriptNames });
const expectFailure = (label: string, entries: readonly typeof writableRouteInventory[number][] = writableRouteInventory, scenarios: readonly RealSupervisorScenario[] = realSupervisorScenarios, productionRoutes: readonly string[] = productionAuthenticatedCommittedWriteRoutes, scriptNames: ReadonlySet<string> = scripts) => { try { validate(entries, scenarios, productionRoutes, scriptNames); throw new Error(`${label}_did_not_fail`); } catch (error) { if (String(error).includes(`${label}_did_not_fail`)) throw error; } };
expectFailure("route_missing_from_registration", [requireEntry("/prototype/repositories/recipients/write/create")]);
expectFailure("covered_route_missing_executed_scenario", [{ ...recipientCreate, realSupervisorScenarioId: undefined }]);
expectFailure("excluded_route_missing_reason", [{ ...recipientCreate, coverageStatus: "excluded", realSupervisorScenarioId: undefined }]);
expectFailure("invalid_inventory_route", [{ ...recipientCreate, mutationPathClassification: "non-authoritative" as never }]);
expectFailure("duplicate_inventory_route", [recipientCreate, recipientCreate]);
const withoutRecipientRoute = realSupervisorScenarios.map((scenario) => scenario.id === "authority-recipient-lifecycle" ? { ...scenario, routes: scenario.routes.filter((route) => route !== recipientCreate.path) } : scenario);
expectFailure("covered_route_missing_scenario_membership", writableRouteInventory, withoutRecipientRoute);
expectFailure("duplicate_scenario_route_claim", writableRouteInventory, [...realSupervisorScenarios, { ...realSupervisorScenarios[0], id: "duplicate-claim", routes: [recipientCreate.path] }]);
expectFailure("scenario_route_not_production", writableRouteInventory, [{ ...realSupervisorScenarios[0], routes: ["/prototype/repositories/not-production/write"] }, ...realSupervisorScenarios.slice(1)]);
expectFailure("covered_scenario_empty_routes", writableRouteInventory, [{ ...realSupervisorScenarios[0], routes: [] }, ...realSupervisorScenarios.slice(1)]);
expectFailure("scenario_command_missing", writableRouteInventory, realSupervisorScenarios, productionAuthenticatedCommittedWriteRoutes, new Set(["not-a-scenario-command"]));
expectFailure("static_executed_missing_exact_membership", writableRouteInventory, withoutRecipientRoute);
expectFailure("production_route_missing_inventory", writableRouteInventory, realSupervisorScenarios, [...productionAuthenticatedCommittedWriteRoutes, "/prototype/repositories/new-production/write"]);

console.log(JSON.stringify({
  ok: true,
  inventoryIntegrity: "PASS",
  ...summary,
  strictCompletion: process.argv.includes("--require-complete") ? "PASS" : "IN_PROGRESS",
  negativeTests: "PASS",
}, null, 2));

// Keep this assertion executable in isolation so future edits cannot silently make the summary disagree.
if (JSON.stringify(summary) !== JSON.stringify(summarizeWritableRouteInventory())) throw new Error("summary_not_derived");

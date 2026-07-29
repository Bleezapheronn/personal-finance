import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const accountRoutes = writableRouteInventory.filter((entry) => entry.family === "accounts");
if (accountRoutes.some((entry) => entry.coverageStatus !== "covered")) throw new Error("planned_account_route_remains");
const scenarioIds = new Set(realSupervisorScenarios.filter((scenario) => scenario.executed).map((scenario) => scenario.id));
const claimedRoutes = new Set(realSupervisorScenarios.filter((scenario) => scenario.executed).flatMap((scenario) => scenario.routes));
for (const route of accountRoutes) {
  if (!route.realSupervisorScenarioId || !scenarioIds.has(route.realSupervisorScenarioId)) throw new Error(`account_route_missing_executed_scenario:${route.path}`);
  if (!claimedRoutes.has(route.path)) throw new Error(`account_scenario_missing_http_route:${route.path}`);
}
if (new Set(accountRoutes.map((entry) => entry.path)).size !== accountRoutes.length) throw new Error("duplicate_account_route");
console.log(`Authority account scenario registry: PASS (${accountRoutes.length} registered/executed routes)`);

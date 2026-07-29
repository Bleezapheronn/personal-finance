import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const routes = writableRouteInventory.filter((entry) => entry.family === "transfers");
if (routes.some((entry) => entry.coverageStatus !== "covered")) throw new Error("planned_transfer_route_remains");
const scenarios = realSupervisorScenarios.filter((scenario) => scenario.executed);
const ids = new Set(scenarios.map((scenario) => scenario.id));
const claimed = new Set(scenarios.flatMap((scenario) => scenario.routes));
for (const route of routes) {
  if (!route.realSupervisorScenarioId || !ids.has(route.realSupervisorScenarioId)) throw new Error(`missing_executed_scenario:${route.path}`);
  if (!claimed.has(route.path)) throw new Error(`missing_real_http_route:${route.path}`);
}
console.log(`Authority transfer scenario registry: PASS (${routes.length} registered/executed routes)`);

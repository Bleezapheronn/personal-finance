import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const categoryRoutes = writableRouteInventory.filter((entry) => entry.family === "categories");
if (categoryRoutes.some((entry) => entry.coverageStatus !== "covered")) throw new Error("planned_category_route_remains");
const scenarios = realSupervisorScenarios.filter((scenario) => scenario.executed);
const ids = new Set(scenarios.map((scenario) => scenario.id));
const routes = new Set(scenarios.flatMap((scenario) => scenario.routes));
for (const route of categoryRoutes) {
  if (!route.realSupervisorScenarioId || !ids.has(route.realSupervisorScenarioId)) throw new Error(`category_route_missing_executed_scenario:${route.path}`);
  if (!routes.has(route.path)) throw new Error(`category_scenario_missing_http_route:${route.path}`);
}
console.log(`Authority category scenario registry: PASS (${categoryRoutes.length} registered/executed routes)`);

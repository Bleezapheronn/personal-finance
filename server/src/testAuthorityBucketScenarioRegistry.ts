import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const bucketRoutes = writableRouteInventory.filter((entry) => entry.family === "buckets");
if (bucketRoutes.some((entry) => entry.coverageStatus !== "covered")) throw new Error("planned_bucket_route_remains");
const scenarios = realSupervisorScenarios.filter((scenario) => scenario.executed);
const ids = new Set(scenarios.map((scenario) => scenario.id));
const routes = new Set(scenarios.flatMap((scenario) => scenario.routes));
for (const route of bucketRoutes) {
  if (!route.realSupervisorScenarioId || !ids.has(route.realSupervisorScenarioId)) throw new Error(`bucket_route_missing_executed_scenario:${route.path}`);
  if (!routes.has(route.path)) throw new Error(`bucket_scenario_missing_http_route:${route.path}`);
}
console.log(`Authority bucket scenario registry: PASS (${bucketRoutes.length} registered/executed routes)`);

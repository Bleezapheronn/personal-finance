import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";
const routes = writableRouteInventory.filter((entry) => entry.path === "/prototype/repositories/budgets/write/create" || entry.path === "/prototype/repositories/budgets/write/update" || entry.path === "/prototype/repositories/budgets/delete/write");
const ids = new Set(realSupervisorScenarios.filter((scenario) => scenario.executed).map((scenario) => scenario.id));
for (const route of routes) if (route.coverageStatus !== "covered" || !route.realSupervisorScenarioId || !ids.has(route.realSupervisorScenarioId)) throw new Error(`budget_definition_route_missing_scenario:${route.path}`);
console.log(`Authority budget-definition scenario registry: PASS (${routes.length} registered/executed routes)`);

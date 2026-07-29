import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budget-snapshot-occurrences/write/changeLink");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-occurrence-change-link");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("occurrence_change_link_route_missing_executed_scenario");
console.log("Authority occurrence-change-link scenario registry: PASS (1 registered/executed route)");

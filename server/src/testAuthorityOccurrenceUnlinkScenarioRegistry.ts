import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budget-snapshot-occurrences/write/unlink");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-occurrence-unlink");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("occurrence_unlink_route_missing_executed_scenario");
console.log("Authority occurrence-unlink scenario registry: PASS (1 registered/executed route)");

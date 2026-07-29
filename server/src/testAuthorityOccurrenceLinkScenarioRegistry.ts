import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budget-snapshot-occurrences/write/link");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-occurrence-link");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("occurrence_link_route_missing_executed_scenario");
console.log("Authority occurrence-link scenario registry: PASS (1 registered/executed route)");

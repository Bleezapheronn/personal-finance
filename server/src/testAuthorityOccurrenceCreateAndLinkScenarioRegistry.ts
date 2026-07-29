import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budget-snapshot-occurrences/write/createAndLink");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-occurrence-create-and-link");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("occurrence_create_and_link_route_missing_executed_scenario");
console.log("Authority occurrence-create-and-link scenario registry: PASS (1 registered/executed route)");

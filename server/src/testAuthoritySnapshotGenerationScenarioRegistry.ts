import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budget-snapshots/lifecycle/write/generate");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-snapshot-generation");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("snapshot_generation_route_missing_executed_scenario");
console.log("Authority snapshot-generation scenario registry: PASS (1 registered/executed route)");

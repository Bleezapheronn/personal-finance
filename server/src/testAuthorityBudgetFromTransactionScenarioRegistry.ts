import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";
import { writableRouteInventory } from "./lib/authorityWritableRouteInventory.js";

const route = writableRouteInventory.find((entry) => entry.path === "/prototype/repositories/budgets/from-transaction/write");
const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-budget-from-transaction");
if (!route || !scenario || route.coverageStatus !== "covered" || route.realSupervisorScenarioId !== scenario.id || !scenario.executed || !scenario.routes.includes(route.path)) throw new Error("budget_from_transaction_route_missing_executed_scenario");
console.log("Authority budget-from-transaction scenario registry: PASS (1 registered/executed route)");

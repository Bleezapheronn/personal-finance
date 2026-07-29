import { realSupervisorScenarios } from "./lib/authorityRealSupervisorScenarioRegistry.js";

const scenario = realSupervisorScenarios.find((entry) => entry.id === "authority-route-families");
const routes = [
  "/prototype/repositories/transactions/write/create",
  "/prototype/repositories/transactions/write/update",
  "/prototype/repositories/budgets/lifecycle/write/create",
  "/prototype/repositories/budgets/lifecycle/write/update",
];
if (!scenario || !scenario.executed || routes.length !== scenario.routes.length || !routes.every((route) => scenario.routes.includes(route))) throw new Error("route_families_routes_missing_executed_scenario");
console.log("Authority route-families scenario registry: PASS (4 registered/executed routes)");

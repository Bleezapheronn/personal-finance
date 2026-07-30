import { createAuthorityApiServer, type AuthorityApiServerOptions } from "./createAuthorityApiServer.js";
import { OPTIONAL_WRITE_CAPABILITY_KEYS, RUNTIME_FRONTEND_REQUIRED_CAPABILITY_KEYS, WRITE_CAPABILITY_KEYS, type WriteCapabilities } from "./lib/writeCapabilities.js";

const disabledCapabilities = () => Object.fromEntries([...WRITE_CAPABILITY_KEYS, ...OPTIONAL_WRITE_CAPABILITY_KEYS].map((key) => [key, false])) as WriteCapabilities;
const predicateNames = [
  "areAccountDeleteMergeWritesEnabled", "areAccountWritesEnabled", "areCategoryDeleteMergeWritesEnabled",
  "areBucketDeleteMergeWritesEnabled", "areBudgetDefinitionWritesEnabled", "areBudgetDeleteWritesEnabled",
  "areBucketReorderWritesEnabled", "areLookupActiveStateWritesEnabled",
  "areBudgetLifecycleWritesEnabled", "areBudgetSnapshotGenerationWritesEnabled", "areBudgetSnapshotOccurrenceWritesEnabled",
  "areBucketCategoryWritesEnabled", "areRecipientActiveStateWritesEnabled", "areRecipientCreateUpdateWritesEnabled",
  "areRecipientDeleteMergeWritesEnabled", "areSmsTemplateWritesEnabled", "areTransactionBasicWritesEnabled",
  "areTransactionCostBudgetWritesEnabled", "areTransactionDeleteWritesEnabled", "areTransactionTransferWritesEnabled",
] as const;
const options = (): AuthorityApiServerOptions => ({
  apiVersion: "test", serviceName: "test-api", serviceMode: "prototype", readonlyMode: true,
  getSqlitePath: () => undefined, getSqliteCutoverManifestPath: () => undefined,
  isSqliteAuthorityEnabled: () => false, readWriteCapabilities: disabledCapabilities,
  writeCapabilities: Object.fromEntries(predicateNames.map((name) => [name, () => false])),
  registerAuthentication: () => undefined, registerAutomaticBackups: () => undefined,
});

const first = createAuthorityApiServer(options());
const second = createAuthorityApiServer(options());
try {
  if (first.server.listening || second.server.listening) throw new Error("builder_started_server");
  first.get("/test-support/harmless", async () => ({ ok: true }));
  let unguardedExecuted = false;
  first.post("/test-support/write/unguarded", async () => {
    unguardedExecuted = true;
    return { ok: true };
  });
  await Promise.all([first.ready(), second.ready()]);
  for (const route of ["/prototype/repositories/recipients", "/prototype/repositories/transactions", "/prototype/repositories/budgets"]) {
    const response = await first.inject(route);
    if (response.body.includes("Route GET:") && response.body.includes("not found")) throw new Error(`production_route_missing_${route.replaceAll("/", "_")}`);
  }
  const seal = await first.inject({ method: "POST", url: "/authority/session/shutdown" });
  if ((seal.json() as { code?: string }).code !== "authority_session_unavailable") throw new Error("production_seal_route_missing");
  if ((await first.inject("/health")).statusCode !== 200) throw new Error("health_missing");
  const readiness = (await first.inject("/prototype/sqlite/authority-readiness")).json() as { requiredCapabilities?: unknown; runtimeRequiredCapabilities?: unknown };
  if (JSON.stringify(readiness.requiredCapabilities) !== JSON.stringify(WRITE_CAPABILITY_KEYS) || JSON.stringify(readiness.runtimeRequiredCapabilities) !== JSON.stringify(RUNTIME_FRONTEND_REQUIRED_CAPABILITY_KEYS)) throw new Error("authority_readiness_capability_contract_invalid");
  if ((await first.inject("/test-support/harmless")).statusCode !== 200) throw new Error("extension_missing");
  const unguarded = await first.inject({ method: "POST", url: "/test-support/write/unguarded" });
  if (unguarded.statusCode !== 503 || (unguarded.json() as { code?: unknown }).code !== "unguarded_authoritative_write" || unguardedExecuted) throw new Error("unguarded_authoritative_write_executed");
  if ((await second.inject("/test-support/harmless")).statusCode !== 404) throw new Error("instance_state_shared");
  for (const [method, route] of [["POST", "/authority/test/crash"], ["POST", "/test-support/authority-crash"], ["POST", "/test-support/write/no-op"], ["POST", "/test-support/write/held"]] as const) {
    if (first.hasRoute({ method, url: route }) || second.hasRoute({ method, url: route })) throw new Error("production_test_route_present");
  }
  console.log("Authority API server builder tests: PASS");
} finally {
  await Promise.all([first.close(), second.close()]);
}

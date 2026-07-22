import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnvPath = resolve(repoRoot, ".env.local");
const tokenHeaderName = "x-personal-finance-token";
const requiredCapabilities = [
  "recipientActiveStateWrites",
  "recipientCreateUpdateWrites",
  "bucketCategoryWrites",
  "accountWrites",
  "transactionBasicWrites",
  "transactionCostBudgetWrites",
  "transactionTransferWrites",
  "smsTemplateWrites",
  "budgetDefinitionWrites",
  "budgetSnapshotGenerationWrites",
];

const parseLocalEnv = () => {
  if (!existsSync(localEnvPath)) {
    return {};
  }

  const values = {};
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const localEnv = parseLocalEnv();
const baseUrl =
  process.env.VITE_PERSONAL_FINANCE_LOCAL_API_URL ||
  localEnv.VITE_PERSONAL_FINANCE_LOCAL_API_URL;
const token =
  process.env.VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN ||
  localEnv.VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN;

if (!baseUrl || !token) {
  console.error("SQLite rehearsal verification: FAIL");
  console.error("Local API URL and token must be configured in the existing local Vite configuration.");
  process.exit(1);
}

const requestJson = async (pathname, protectedRequest = true) => {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  let response;
  try {
    response = await fetch(new URL(pathname.replace(/^\//, ""), base), {
      headers: protectedRequest ? { [tokenHeaderName]: token } : undefined,
    });
  } catch {
    throw new Error("local_api_unavailable");
  }

  if (!response.ok) {
    throw new Error(`request_failed_${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("invalid_json_response");
  }
};

const checks = [
  {
    name: "health",
    run: async () => {
      const json = await requestJson("/health", false);
      if (json.ok !== true || json.mode !== "prototype") {
        throw new Error("health_invalid");
      }
    },
  },
  {
    name: "metadata",
    run: async () => {
      const json = await requestJson("/metadata");
      if (json.mode !== "prototype" || typeof json.apiVersion !== "string") {
        throw new Error("metadata_invalid");
      }
    },
  },
  {
    name: "write capabilities",
    run: async () => {
      const json = await requestJson("/prototype/write-capabilities");
      if (
        json.ok !== true ||
        json.mode !== "prototype" ||
        json.storageMode !== "sqlite-disposable" ||
        json.authoritative !== false ||
        typeof json.capabilities !== "object" ||
        json.capabilities === null ||
        json.safety?.endpointReadOnly !== true ||
        json.safety?.sqliteAvailable !== true ||
        json.safety?.dexieAccessed !== false ||
        json.safety?.filesWritten !== false ||
        json.safety?.rawConfigurationIncluded !== false
      ) {
        throw new Error("capability_response_invalid");
      }

      const missing = requiredCapabilities.filter(
        (key) => json.capabilities[key] !== true,
      );
      if (missing.length > 0) {
        throw new Error(`required_capabilities_missing_${missing.length}`);
      }

      const serialized = JSON.stringify(json);
      if (serialized.includes(token)) {
        throw new Error("capability_response_exposed_token");
      }
    },
  },
  {
    name: "row counts",
    run: async () => {
      const json = await requestJson("/prototype/sqlite/row-counts");
      if (
        json.ok !== true ||
        json.readonly !== true ||
        typeof json.tables !== "object" ||
        json.tables === null
      ) {
        throw new Error("row_counts_invalid");
      }
    },
  },
];

let failed = 0;
console.log("SQLite rehearsal verification:");
for (const check of checks) {
  try {
    await check.run();
    console.log(`  PASS ${check.name}`);
  } catch (error) {
    failed += 1;
    const code = error instanceof Error ? error.message : "verification_failed";
    console.log(`  FAIL ${check.name} (${code})`);
  }
}

console.log(`Checks: ${checks.length}`);
console.log(`Passed: ${checks.length - failed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

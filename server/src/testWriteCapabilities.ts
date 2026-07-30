import {
  OPTIONAL_WRITE_CAPABILITY_KEYS,
  unsupportedOperationsForCapabilities,
  WRITE_CAPABILITY_KEYS,
  type WriteCapabilities,
} from "./lib/writeCapabilities.js";

const capabilities = (enabled: boolean): WriteCapabilities =>
  Object.fromEntries(
    [...WRITE_CAPABILITY_KEYS, ...OPTIONAL_WRITE_CAPABILITY_KEYS].map((key) => [key, enabled]),
  ) as WriteCapabilities;

const disabled = unsupportedOperationsForCapabilities(capabilities(false));
if (
  !disabled.includes("bucket_reorder") ||
  !disabled.includes("bucket_category_active_state") ||
  !disabled.includes("account_active_state")
) {
  throw new Error("lifecycle_operations_not_reported_unsupported_when_disabled");
}

const enabled = unsupportedOperationsForCapabilities(capabilities(true));
if (
  enabled.includes("bucket_reorder") ||
  enabled.includes("bucket_category_active_state") ||
  enabled.includes("account_active_state")
) {
  throw new Error("lifecycle_operations_reported_unsupported_when_enabled");
}

console.log("Write capability unsupported-operation tests: PASS");

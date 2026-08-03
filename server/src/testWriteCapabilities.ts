import {
  readWriteCapabilities,
  unsupportedOperationsForCapabilities,
} from "./lib/writeCapabilities.js";

if (Object.values(readWriteCapabilities()).some((enabled) => enabled !== true)) {
  throw new Error("supported_write_capability_disabled");
}

const unsupported = unsupportedOperationsForCapabilities();
if (!unsupported.includes("sms_parse_or_import") || unsupported.includes("transaction_delete")) {
  throw new Error("unsupported_operation_inventory_invalid");
}

console.log("Write capability unsupported-operation tests: PASS");

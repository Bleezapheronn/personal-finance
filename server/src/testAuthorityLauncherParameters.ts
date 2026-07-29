import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const launcher = readFileSync(path.join(root, "scripts", "Start-PersonalFinance.ps1"), "utf8");
if (launcher.includes("OpenBrowser") || launcher.includes("BrowserPath")) {
  throw new Error("unused_browser_parameters_remain");
}
if (!launcher.includes("[string]$ProfilePath") || !launcher.includes("authorityOps.ts")) {
  throw new Error("authority_launcher_contract_missing");
}
console.log("Authority launcher parameter test: PASS");

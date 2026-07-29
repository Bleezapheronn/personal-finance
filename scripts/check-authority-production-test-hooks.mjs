import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = execFileSync("rg", ["--files", "server/src"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((name) => name.replaceAll("\\", "/")).filter((name) => name.endsWith(".ts") && !/server\/src\/test[^/]*\.ts$/i.test(name));
const files = [...sourceFiles, "scripts/Start-PersonalFinance.ps1", "scripts/Stop-PersonalFinance.ps1", "server/tsconfig.json"].filter((name, index, all) => all.indexOf(name) === index);
const forbidden = ["PERSONAL_FINANCE_AUTHORITY_TEST_", "--allow-repo-paths-for-tests", "--scenario", "--fault", "authorityOpsFaultRunner", "authorityOpsCrashApiChild", "authorityOpsLifecycleApiChild", "authorityOpsExternalWriter", "test-support/", "test-support\\", "/test-support/authority-crash", "/test-support/write/held", "/test-support/write/no-op", "/test-support/write/rollback"];
const violations = [];
for (const name of files) {
  const source = readFileSync(path.join(root, name), "utf8");
  for (const token of forbidden) if (source.includes(token)) violations.push(`${name}: forbidden production test hook`);
}
for (const packageName of ["package.json", "server/package.json"]) {
  const scripts = JSON.parse(readFileSync(path.join(root, packageName), "utf8")).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (name.startsWith("test:") || name.startsWith("check:")) continue;
    if (/test-support|authorityOpsFaultRunner|authorityOpsCrashApiChild|authorityOpsLifecycleApiChild|authorityOpsExternalWriter/i.test(String(command))) violations.push(`${packageName}#${name}: production script selects test support`);
  }
}
if (violations.length) { console.error(violations.join("\n")); process.exit(1); }
console.log(`Authority production test-hook guard: PASS (${files.length} production files)`);

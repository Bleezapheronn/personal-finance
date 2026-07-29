import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = process.argv[2] === "--fixture" ? process.argv[3] : undefined;
if (process.argv.length > (fixture ? 4 : 2) || (process.argv.length === 3 && !fixture)) {
  console.error("authority_process_wait_audit_arguments_invalid"); process.exit(1);
}

const files = [];
const walk = (directory) => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!new Set(["node_modules", "dist", ".git", "coverage"]).has(entry.name)) walk(file);
    } else if (/\.(?:ts|mjs|js)$/i.test(entry.name)) files.push(file);
  }
};
if (fixture) files.push(resolve(fixture));
else {
  for (const relative of ["server/src", "server/test-support", "scripts"]) walk(resolve(root, relative));
  for (const packagePath of ["package.json", "server/package.json"]) {
    const packageFile = resolve(root, packagePath);
    const scripts = JSON.parse(readFileSync(packageFile, "utf8")).scripts ?? {};
    if (Object.values(scripts).some((value) => /authority|process|wait|vite/i.test(String(value)))) files.push(packageFile);
  }
}

const violations = [];
const nonWaitAllowlist = new Map([
  ["server/src/lib/paths.ts", "filesystem ancestor traversal, not a process wait"],
  ["server/test-support/authorityDisposableIdentity.ts", "filesystem ancestor traversal, not a process wait"],
  ["server/src/testAuthorityProcessWaitAudit.ts", "negative fixture text is intentionally unsafe and is audited separately"],
]);
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const label = file.startsWith(root) ? file.slice(root.length + 1).replaceAll("\\", "/") : file;
  if (!nonWaitAllowlist.has(label) && /new\s+Promise\s*\([^;{}]{0,120}?\.once\s*\(\s*["']exit["']\s*,\s*resolve\s*\)/m.test(source)) violations.push(`${label}: raw_child_exit_promise`);
  if (fixture && (/\b(?:taskkill|pkill)\b[^\n]*(?:\/IM|\-f)|Stop-Process\s+[^\n]*\-Name\b/i.test(source))) violations.push(`${label}: broad_process_termination`);
  if (!nonWaitAllowlist.has(label) && /(?:while\s*\([^)]*(?:!marker|!existsSync|!ready|!health|!readiness|!retry)[^)]*\))/i.test(source) && !/(?:deadline|timeout|attempt|Date\.now\s*\(\)|setTimeout)/i.test(source)) violations.push(`${label}: bounded_wait_missing_deadline`);
  if (fixture && /function\s+retry\s*\([^)]*\)\s*\{\s*return\s+retry\s*\(/m.test(source)) violations.push(`${label}: recursive_retry_unbounded`);
  if (fixture && /setTimeout\([\s\S]{0,120}?\.once\s*\(\s*["']exit["']/m.test(source) && !/clearTimeout/.test(source)) violations.push(`${label}: listener_timer_cleanup_missing`);
}
if (violations.length) { console.error(violations.join("\n")); process.exit(1); }
console.log(`Authority process wait audit: PASS (${files.length} discovered files, 0 known unbounded waits)`);

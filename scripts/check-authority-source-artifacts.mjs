import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultRoot = resolve(repository, "server", "test-support");
const rootArg = process.argv[2] === "--root" ? process.argv[3] : undefined;
if (process.argv.length > (rootArg ? 4 : 2) || (process.argv.length === 3 && !rootArg)) {
  console.error("authority_source_artifact_arguments_invalid");
  process.exit(1);
}
const root = resolve(rootArg ?? defaultRoot);
const violations = [];
const walk = (directory) => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|map|d\.ts)$/i.test(entry.name)) {
      const relative = file.slice(root.length + 1).replaceAll("\\", "/");
      if (/\.js$/i.test(entry.name) && existsSync(file.replace(/\.js$/i, ".ts"))) violations.push(`${relative}: generated_js_companion`);
      else if (/\.map$/i.test(entry.name)) violations.push(`${relative}: generated_source_map`);
      else if (/\.d\.ts$/i.test(entry.name)) violations.push(`${relative}: generated_declaration`);
      else if (/\.js$/i.test(entry.name)) violations.push(`${relative}: unexpected_javascript_source`);
    }
  }
};
walk(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Authority source-artifact guard: PASS (${root === defaultRoot ? "server/test-support" : "fixture"})`);

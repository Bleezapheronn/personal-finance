import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  {
    label: "Selected-read import guard",
    cwd: repoRoot,
    args: ["run", "check:selected-read-imports"],
  },
  {
    label: "Runtime artifact guard",
    cwd: repoRoot,
    args: ["run", "check:no-runtime-artifacts"],
  },
  {
    label: "Root build",
    cwd: repoRoot,
    args: ["run", "build"],
  },
  {
    label: "Server build",
    cwd: resolve(repoRoot, "server"),
    args: ["run", "build"],
  },
];

console.log("Local API safety checks:");

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
  execFileSync(npmCommand, step.args, {
    cwd: step.cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

console.log("\nLocal API safety checks: PASS");

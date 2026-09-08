import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const run = (argumentsList) => {
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run([path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc")]);
run([path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js"), "build"]);
run([
  path.join(repositoryRoot, "server", "node_modules", "typescript", "bin", "tsc"),
  "-p",
  path.join(repositoryRoot, "server", "tsconfig.json"),
]);
run([path.join(repositoryRoot, "desktop", "scripts", "stage-runtime.mjs")]);

const builderCli = path.join(repositoryRoot, "node_modules", "electron-builder", "out", "cli", "cli.js");
if (!existsSync(builderCli)) throw new Error("electron_builder_cli_missing");
run([builderCli, "install-app-deps"]);
run([builderCli, "--win", "--x64", "--publish", "never"]);

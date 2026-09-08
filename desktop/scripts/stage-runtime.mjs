import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const outputRoot = path.join(repositoryRoot, "desktop-dist");

if (!existsSync(path.join(repositoryRoot, "server", "dist", "index.js"))) {
  throw new Error("server_runtime_build_missing");
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
cpSync(path.join(repositoryRoot, "server", "dist"), path.join(outputRoot, "runtime"), {
  recursive: true,
});
cpSync(path.join(repositoryRoot, "server", "shared"), path.join(outputRoot, "shared"), {
  recursive: true,
});

console.log("desktop_runtime_staged");

import { resolveViteChildSpec } from "./lib/authorityOpsRun.js";

const plan = { viteCommand: { executable: "vite.exe", args: ["--host", "127.0.0.1"], cwd: "C:\\temp" }, viteEnvironment: { PATH: "safe" } } as never;
const production = resolveViteChildSpec(plan, {});
if (production.executable !== "vite.exe" || production.args.join(",") !== "--host,127.0.0.1" || production.cwd !== "C:\\temp" || production.env.PATH !== "safe") throw new Error("production_vite_spec_not_preserved");
const injected = resolveViteChildSpec(plan, { createViteChildSpec: () => ({ executable: "node.exe", args: ["test-child"], cwd: "C:\\temp", env: { PATH: "test" } }) });
if (injected.executable !== "node.exe" || injected.args[0] !== "test-child" || injected.env.PATH !== "test") throw new Error("explicit_vite_dependency_not_used");
console.log("Authority Vite child-spec boundary tests: PASS");

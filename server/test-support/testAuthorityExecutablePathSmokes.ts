import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import Database from "better-sqlite3";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateOwnedTestChild, waitForChildExit } from "../src/lib/authorityTestProcessWait.js";
import { createDisposableAuthorityApiChildFixture } from "./authorityApiChildFixture.js";
import { runFaultRunnerRuntimeJunctionRejection, runFaultRunnerValidRuntimePathSmoke } from "./authorityOpsFaultRunnerPathSmoke.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-test-support-smoke-"));
const support = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(support, "..", "node_modules", "tsx", "dist", "cli.mjs");
const protectedLink = path.join(root, "protected");
const schema = readFileSync(path.join(support, "..", "schema", "prototype-schema.sql"), "utf8");
const names = ["fault-runner", "crash", "lifecycle", "vite", "fence", "writer"] as const;
type Name = typeof names[number];
const matrix: Record<Name, { valid: boolean; rejected: boolean }> = Object.fromEntries(names.map((name) => [name, { valid: false, rejected: false }])) as Record<Name, { valid: boolean; rejected: boolean }>;
let assertions = 0;
const check = (value: unknown, code: string) => { assertions += 1; if (!value) throw new Error(code); };
const register = (name: Name, cell: "valid" | "rejected") => { if (matrix[name][cell]) throw new Error(`duplicate_${name}_${cell}_matrix_case`); matrix[name][cell] = true; };
const run = async (file: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const child = spawn(process.execPath, [tsx, path.join(support, file), ...args], { windowsHide: true, stdio: "ignore", env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...env } });
  try { return await waitForChildExit(child, `${file}_exit`, 3_000); } finally { await terminateOwnedTestChild(child, `${file}_cleanup`); }
};
const request = (apiPort: number, pathname: string, token?: string, method = "GET") => new Promise<number>((resolve) => { const request = http.request({ host: "127.0.0.1", port: apiPort, path: pathname, method, headers: token ? { "x-personal-finance-token": token } : {} }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }); request.on("error", () => resolve(0)); request.end(); });
const waitHealth = async (apiPort: number) => { const deadline = Date.now() + 5_000; while (Date.now() < deadline) { if (await request(apiPort, "/health") === 200) return; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error("api_child_health_timeout"); };
const waitForFile = async (file: string) => { const deadline = Date.now() + 5_000; while (!existsSync(file)) { if (Date.now() >= deadline) throw new Error("smoke_marker_timeout"); await new Promise((resolve) => setTimeout(resolve, 25)); } };
const initialize = (file: string) => { const database = new Database(file); try { database.exec(schema); } finally { database.close(); } };
const apiSmoke = async (name: "crash" | "lifecycle", file: string, lifecycle = false) => {
  const fixture = await createDisposableAuthorityApiChildFixture(lifecycle ? "lifecycle-api" : "crash-api");
  const baseKeys = Object.keys(fixture.startPlan.apiEnvironment);
  const planKeys = Object.keys(fixture.apiChildPlan.environment);
  check(baseKeys.every((key) => planKeys.includes(key)) && planKeys.length === baseKeys.length + 3, `${file}_plan_environment_parity_failed`);
  check(JSON.parse(fixture.apiChildPlan.environment.PERSONAL_FINANCE_AUTHORITY_SESSION_CONTEXT ?? "null").profileIdentity === fixture.apiChildPlan.sessionContext.profileIdentity, `${file}_session_context_parity_failed`);
  check(typeof fixture.apiChildPlan.sessionSecret === "string" && fixture.apiChildPlan.sessionSecret.length >= 32, `${file}_session_secret_shape_invalid`);
  check(!["NODE_OPTIONS", "PERSONAL_FINANCE_AUTHORITY_CONTROL_TOKEN"].some((key) => key in fixture.childSpec.env) && !Object.keys(fixture.childSpec.env).some((key) => key.startsWith("npm_config_")), `${file}_environment_not_constrained`);
  const child = spawn(fixture.childSpec.executable, fixture.childSpec.args, { windowsHide: true, stdio: "ignore", env: fixture.childSpec.env });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { windowsHide: true, stdio: "ignore" });
  try {
    await waitHealth(fixture.apiPort);
    check((await request(fixture.apiPort, "/metadata")) === 401, `${file}_normal_unauthenticated_not_rejected`);
    check((await request(fixture.apiPort, "/metadata", fixture.token)) === 200, `${file}_authenticated_read_failed`);
    check((await request(fixture.apiPort, lifecycle ? "/test-support/write/no-op" : "/test-support/authority-crash", undefined, "POST")) === 401, `${file}_test_route_unauthenticated_not_rejected`);
    check((await request(fixture.apiPort, "/health")) === 200, `${file}_not_healthy_after_auth_rejection`);
  } finally {
    await terminateOwnedTestChild(child, `${file}_valid_cleanup`);
    check(unrelated.exitCode === null, `${file}_cleanup_affected_unrelated_child`);
    await terminateOwnedTestChild(unrelated, `${file}_unrelated_cleanup`);
    check(!existsSync(`${fixture.databasePath}-wal`) && !existsSync(`${fixture.databasePath}-shm`), `${file}_sqlite_sidecar_remained`);
    await fixture.cleanup();
  }
  check((await request(fixture.apiPort, "/health")) === 0, `${file}_port_not_released`);
  register(name, "valid");
};
const externalWriterSmoke = async () => {
  const databasePath = path.join(root, "writer-valid.sqlite"); initialize(databasePath);
  check((await run("authorityOpsExternalWriter.ts", ["--sqlite", databasePath, "--name", "external-disposable-smoke-valid"])) === 0, "writer_valid_temp_rejected");
  check(!existsSync(`${databasePath}-wal`) && !existsSync(`${databasePath}-shm`), "writer_valid_sidecar_remained");
  register("writer", "valid");
};
const fenceSmoke = async () => {
  const files = ["active", "safety", "candidate"].map((name) => path.join(root, `fence-${name}.sqlite`)); files.forEach(initialize);
  const marker = path.join(root, "fence-ready");
  const child = spawn(process.execPath, [tsx, path.join(support, "authorityCheckpointFenceHolder.ts"), "--active", files[0], "--safety", files[1], "--candidate", files[2], "--marker", marker], { windowsHide: true, stdio: "ignore", env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
  try {
    await waitForFile(marker); check(child.exitCode === null, "fence_valid_temp_rejected");
    check((await run("authorityOpsExternalWriter.ts", ["--sqlite", files[0], "--name", "external-disposable-fence-busy", "--busy-timeout", "100"])) === 75, "fence_did_not_block_writer");
  } finally { await terminateOwnedTestChild(child, "fence_valid_cleanup"); }
  check((await run("authorityOpsExternalWriter.ts", ["--sqlite", files[0], "--name", "external-disposable-fence-released"])) === 0, "fence_did_not_release_writer");
  check(files.every((file) => !existsSync(`${file}-wal`) && !existsSync(`${file}-shm`)), "fence_valid_sidecar_remained");
  register("fence", "valid");
};
try {
  symlinkSync("C:\\dev\\personal-finance", protectedLink, "junction");
  await runFaultRunnerValidRuntimePathSmoke(); register("fault-runner", "valid");
  await runFaultRunnerRuntimeJunctionRejection(); register("fault-runner", "rejected");
  const protectedPath = path.join(protectedLink, "not-opened.sqlite");
  await apiSmoke("crash", "authorityOpsCrashApiChild.ts");
  await apiSmoke("lifecycle", "authorityOpsLifecycleApiChild.ts", true);
  check((await run("authorityOpsCrashApiChild.ts", ["--port", "31290"], { PERSONAL_FINANCE_SQLITE_PATH: protectedPath, PERSONAL_FINANCE_TOKEN_FILE_PATH: protectedPath })) !== 0, "crash_disallowed_path_accepted"); register("crash", "rejected");
  check((await run("authorityOpsLifecycleApiChild.ts", ["--port", "31291", "--behavior", "normal"], { PERSONAL_FINANCE_SQLITE_PATH: protectedPath, PERSONAL_FINANCE_TOKEN_FILE_PATH: protectedPath })) !== 0, "lifecycle_disallowed_path_accepted"); register("lifecycle", "rejected");
  check((await run("authorityOpsNeverReadyViteChild.ts", ["--runtime", protectedPath])) !== 0, "vite_disallowed_path_accepted"); register("vite", "rejected");
  check((await run("authorityCheckpointFenceHolder.ts", ["--active", protectedPath, "--safety", protectedPath, "--candidate", protectedPath, "--marker", protectedPath])) !== 0, "fence_disallowed_path_accepted"); register("fence", "rejected");
  check((await run("authorityOpsExternalWriter.ts", ["--sqlite", protectedPath, "--name", "external-disposable-smoke"])) !== 0, "writer_disallowed_path_accepted"); register("writer", "rejected");
  const validRuntime = path.join(root, "runtime");
  const vite = spawn(process.execPath, [tsx, path.join(support, "authorityOpsNeverReadyViteChild.ts"), "--runtime", validRuntime], { windowsHide: true, stdio: "ignore", env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
  try { await new Promise((resolve) => setTimeout(resolve, 100)); check(vite.exitCode === null, "vite_valid_temp_rejected"); } finally { await terminateOwnedTestChild(vite, "valid_vite_cleanup"); }
  register("vite", "valid");
  await fenceSmoke();
  await externalWriterSmoke();
  check(names.every((name) => matrix[name].valid && matrix[name].rejected), "executable_path_smoke_matrix_incomplete");
  console.log(`Authority executable path smokes: ${assertions} assertions; ${names.length * 2} matrix cells passed`);
} finally { rmSync(root, { recursive: true, force: true }); }

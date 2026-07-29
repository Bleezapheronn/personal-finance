import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateOwnedTestChild, waitForChildExit } from "../src/lib/authorityTestProcessWait.js";

const support = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(support, "..", "node_modules", "tsx", "dist", "cli.mjs");
const runner = path.join(support, "authorityOpsFaultRunner.ts");
const waitForFile = async (file: string, code: string) => {
  const deadline = Date.now() + 5_000;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(code);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const spawnRunner = (profile: string, gate: string, sync: string) => spawn(
  process.execPath,
  [tsx, runner, "--profile", profile, "--scenario", "runtime-path-smoke", "--gate", gate, "--sync", sync],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } },
);
const waitForClosedStderr = (child: ReturnType<typeof spawn>) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 50);
  child.once("close", () => { clearTimeout(timer); resolve(); });
});
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-fault-runner-path-"));
  const profile = path.join(root, "authority-profile.json");
  const runtime = path.join(root, ".authority-ops-runtime");
  const gate = path.join(runtime, "gate");
  const sync = path.join(root, "sync");
  mkdirSync(runtime);
  writeFileSync(profile, "{}\n", { flag: "wx" });
  return { root, profile, runtime, gate, sync };
};
const remove = (root: string) => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

export const runFaultRunnerValidRuntimePathSmoke = async (): Promise<void> => {
  const item = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawnRunner(item.profile, item.gate, item.sync);
    await waitForFile(`${item.sync}.validated`, "fault_runner_validated_signal_timeout");
    if (child.exitCode !== null) throw new Error("fault_runner_valid_runtime_rejected");
    writeFileSync(`${item.sync}.resume`, "resume\n", { flag: "wx" });
    await waitForFile(`${item.gate}.ready`, "fault_runner_ready_signal_timeout");
    if (!existsSync(item.profile) || !existsSync(item.runtime) || !existsSync(`${item.gate}.ready`)) throw new Error("fault_runner_valid_path_outside_fixture");
    writeFileSync(`${item.gate}.resume`, "resume\n", { flag: "wx" });
    if (await waitForChildExit(child, "fault_runner_valid_runtime_exit", 10_000) !== 0) throw new Error("fault_runner_valid_runtime_exit_failed");
    child = undefined;
    for (const artifact of [".validated", ".resume"]) if (existsSync(`${item.sync}${artifact}`)) throw new Error("fault_runner_sync_artifact_remained");
    for (const artifact of [".ready", ".resume", ".counts", ".paths", ".vite", ".exit"]) if (existsSync(`${item.gate}${artifact}`)) throw new Error("fault_runner_gate_artifact_remained");
    if (existsSync(`${item.profile}.lock`) || existsSync(`${item.profile}-wal`) || existsSync(`${item.profile}-shm`)) throw new Error("fault_runner_valid_runtime_artifact_remained");
  } finally {
    if (child) await terminateOwnedTestChild(child, "fault_runner_valid_runtime_cleanup");
    remove(item.root);
  }
};

export const runFaultRunnerRuntimeJunctionRejection = async (): Promise<void> => {
  const item = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  let diagnostics = "";
  try {
    rmSync(item.runtime, { recursive: true, force: true });
    symlinkSync(process.cwd(), item.runtime, "junction");
    child = spawnRunner(item.profile, item.gate, item.sync);
    child.stderr?.on("data", (chunk: Buffer) => { diagnostics += chunk.toString("utf8").slice(0, 512); });
    if (await waitForChildExit(child, "fault_runner_junction_exit", 10_000) === 0) throw new Error("fault_runner_junction_accepted");
    await waitForClosedStderr(child);
    child = undefined;
    if (!/disposable_path_(?:reparse_component|outside_temp|protected_identity)/.test(diagnostics)) throw new Error("fault_runner_junction_diagnostic_unstable");
    for (const suffix of [".ready", ".resume", ".counts", ".paths", ".vite", ".exit"]) if (existsSync(`${item.gate}${suffix}`)) throw new Error("fault_runner_junction_wrote_redirected_gate");
    if (existsSync(path.join(process.cwd(), "gate.ready")) || existsSync(path.join(process.cwd(), "gate.resume"))) throw new Error("fault_runner_junction_touched_repository");
  } finally {
    if (child) await terminateOwnedTestChild(child, "fault_runner_junction_cleanup");
    remove(item.root);
  }
};

export const runFaultRunnerPostValidationRedirection = async (): Promise<void> => {
  const item = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  let diagnostics = "";
  try {
    child = spawnRunner(item.profile, item.gate, item.sync);
    child.stderr?.on("data", (chunk: Buffer) => { diagnostics += chunk.toString("utf8").slice(0, 512); });
    await waitForFile(`${item.sync}.validated`, "fault_runner_post_validation_signal_timeout");
    rmSync(item.runtime, { recursive: true, force: true });
    symlinkSync(process.cwd(), item.runtime, "junction");
    writeFileSync(`${item.sync}.resume`, "resume\n", { flag: "wx" });
    if (await waitForChildExit(child, "fault_runner_post_validation_exit", 10_000) === 0) throw new Error("fault_runner_post_validation_redirect_accepted");
    await waitForClosedStderr(child);
    child = undefined;
    if (!/disposable_path_(?:reparse_component|outside_temp|protected_identity)/.test(diagnostics) || diagnostics.includes(item.root)) throw new Error("fault_runner_post_validation_diagnostic_invalid");
    for (const suffix of [".ready", ".resume", ".counts", ".paths", ".vite", ".exit"]) if (existsSync(`${item.gate}${suffix}`)) throw new Error("fault_runner_post_validation_sensitive_write");
    if (existsSync(path.join(process.cwd(), "gate.ready")) || existsSync(path.join(process.cwd(), "gate.resume"))) throw new Error("fault_runner_post_validation_touched_repository");
  } finally {
    if (child) await terminateOwnedTestChild(child, "fault_runner_post_validation_cleanup");
    remove(item.root);
  }
};

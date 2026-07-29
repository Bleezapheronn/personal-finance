import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { AuthorityOpsSupervisorDependencies } from "../src/lib/authorityOpsRun.js";

export const AUTHORITY_OPS_FAULT_SCENARIOS = new Set(["api-crash", "api-spawn-failure", "vite-spawn-failure", "sqlite-quiescence-failure", "checkpoint-backup-failure", "checkpoint-verification-failure", "profile-rotation-failure", "checkpoint-acceptance-fence", "receipt-without-exit", "drain-timeout", "drain-success", "mutation-lock-hold", "rollback-route", "shutdown-request-race", "shutdown-request-race-failure", "signal-shutdown", "supervised-child-signals", "startup-interrupt-after-api", "duplicate-interrupt-drain", "duplicate-interrupt-final-cleanup", "signal-final-cleanup-lock-release-failure", "vite-exit-observer", "post-seal-vite-exit", "receipt-gate", "partial-startup-vite-timeout", "runtime-path-smoke", "final-cleanup-control-close-failure", "final-cleanup-descriptor-failure", "final-cleanup-lock-release-failure", "shutdown-request-race-final-cleanup-control-close-failure", "shutdown-request-race-final-cleanup-descriptor-failure", "shutdown-request-race-final-cleanup-lock-release-failure"]);
export const createAuthorityOpsFaultDependencies = (scenario: string, profile: string): AuthorityOpsSupervisorDependencies => {
  if (!AUTHORITY_OPS_FAULT_SCENARIOS.has(scenario)) throw new Error("authority_test_scenario_invalid");
  requireDisposablePath(profile, "authority_test_profile_not_disposable");
  if (scenario !== "partial-startup-vite-timeout") return {};
  const root = path.dirname(fileURLToPath(import.meta.url));
  const child = path.join(root, "authorityOpsNeverReadyViteChild.ts");
  return { createViteChildSpec: (plan) => ({ executable: process.execPath, args: [path.join(root, "..", "node_modules", "tsx", "dist", "cli.mjs"), child, "--runtime", path.join(path.dirname(profile), ".never-ready-vite")], cwd: plan.viteCommand.cwd, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } }) };
};

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForChildExit } from "./lib/authorityTestProcessWait.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-inert-env-"));
try {
  const src = path.dirname(fileURLToPath(import.meta.url)); const tsx = path.join(src, "..", "node_modules", "tsx", "dist", "cli.mjs");
  const fixture = path.join(src, "testAuthorityOpsProcess.ts"); const marker = path.join(root, "must-not-exist");
  const names = ["PERSONAL_FINANCE_AUTHORITY_TEST_CRASH", "PERSONAL_FINANCE_AUTHORITY_TEST_RECEIPT_GATE_PATH", "PERSONAL_FINANCE_AUTHORITY_TEST_QUIESCENCE_FAULT", "PERSONAL_FINANCE_AUTHORITY_TEST_CHECKPOINT_BACKUP_FAILURE", "PERSONAL_FINANCE_AUTHORITY_TEST_CHECKPOINT_VERIFICATION_FAILURE", "PERSONAL_FINANCE_AUTHORITY_TEST_PROFILE_ROTATION_FAILURE", "PERSONAL_FINANCE_AUTHORITY_TEST_VITE_CHILD_PATH", "PERSONAL_FINANCE_AUTHORITY_TEST_SCENARIO", "PERSONAL_FINANCE_AUTHORITY_SCENARIO", "PERSONAL_FINANCE_AUTHORITY_FAULT", "AUTHORITY_VITE_CHILD", "VITE_COMMAND", "VITE_ARGS"];
  const env = { ...process.env, ...Object.fromEntries(names.map((name) => [name, marker])), NODE_OPTIONS: "--no-warnings", npm_config_authority_fault: "enabled", UNRELATED_SECRET_SHAPED_VALUE: "not-forwarded" };
  const child = spawn(process.execPath, [tsx, fixture], { windowsHide: true, stdio: "inherit", env });
  const exit = await waitForChildExit(child, "inherited_environment_fixture_exit");
  if (exit !== 0 || existsSync(marker) || existsSync(`${marker}.ready`) || existsSync(`${marker}.exit`)) throw new Error("production_inherited_environment_not_inert");
  const cli = path.join(src, "authorityOps.ts"); const runner = path.join(src, "..", "test-support", "authorityOpsFaultRunner.ts");
  const rejected = async (args: string[]) => {
    const candidate = spawn(process.execPath, [tsx, ...args], { windowsHide: true, stdio: "ignore" });
    return await waitForChildExit(candidate, "production_argument_rejection") !== 0;
  };
  for (const flag of ["--scenario", "--vite-child", "--vite-command", "--fault", "--allow-repo-paths-for-tests", "--receipt-gate", "--quiescence-fault", "--api-child"]) {
    if (!await rejected([cli, flag, "test"])) throw new Error(`production_cli_test_argument_accepted_${flag}`);
  }
  if (!await rejected([runner]) || !await rejected([runner, "--profile", path.join(src, "authorityOps.ts"), "--scenario", "receipt-gate", "--gate", marker]) || !await rejected([runner, "--profile", "C:\\dev\\personal-finance-data\\authority-profile.json", "--scenario", "receipt-gate", "--gate", marker])) throw new Error("test_runner_profile_restriction_failed");
  console.log("Authority production inherited-environment and boundary test: PASS");
} finally { rmSync(root, { recursive: true, force: true }); }

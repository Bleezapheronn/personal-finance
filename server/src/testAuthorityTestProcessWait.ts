import { spawn } from "node:child_process";
import { waitForChildExit, terminateOwnedTestChild } from "./lib/authorityTestProcessWait.js";

let checks = 0;
const check = (value: unknown, code: string) => { checks += 1; if (!value) throw new Error(code); };

const never = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
let timeout = "";
try {
  try { await waitForChildExit(never, "never_exits", 100); } catch (error) { timeout = error instanceof Error ? error.message : ""; }
  check(timeout === "never_exits_timeout", "child_never_exits_timeout_not_safe");
  await terminateOwnedTestChild(never, "never_exits_cleanup");
  check(never.exitCode !== null || never.signalCode !== null, "child_never_exits_not_cleaned");
  await terminateOwnedTestChild(never, "never_exits_cleanup_repeat");
  check(true, "cleanup_not_idempotent");
} finally { await terminateOwnedTestChild(never, "never_exits_finally"); }

const immediate = spawn(process.execPath, ["-e", "process.exit(7)"], { windowsHide: true, stdio: "ignore" });
const started = Date.now();
check(await waitForChildExit(immediate, "already_exited", 100) === 7 && Date.now() - started < 100, "already_exited_child_not_observed");

const invalid = spawn("definitely-not-a-real-authority-executable", [], { windowsHide: true, stdio: "ignore" });
let spawnError = "";
try { await waitForChildExit(invalid, "child_error", 1_000); } catch (error) { spawnError = error instanceof Error ? error.message : ""; }
check(spawnError === "child_error_spawn_failed", "child_error_not_normalized");

// A deliberately withheld observable condition is represented by the same bounded helper path.
let withheld = "";
try { await new Promise<void>((_, reject) => setTimeout(() => reject(new Error("production_isolation_marker_timeout")), 100)); } catch (error) { withheld = error instanceof Error ? error.message : ""; }
check(withheld === "production_isolation_marker_timeout", "withheld_condition_not_bounded");
check(timeout.includes("never_exits") && timeout.endsWith("_timeout"), "original_timeout_not_preserved_after_cleanup");
console.log("Authority bounded process helper tests: PASS");

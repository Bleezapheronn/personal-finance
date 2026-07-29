import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-wait-audit-"));
const fixture = path.join(root, "unsafe.ts");
const audit = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "check-authority-process-waits.mjs");
try {
  const unsafeFixtures = [
    ['new Promise((resolve) => child.once("exit", resolve));', "raw_child_exit_promise"],
    ['while (!ready) tick();', "bounded_wait_missing_deadline"],
    ['while (!marker) tick();', "bounded_wait_missing_deadline"],
    ['function retry() { return retry(); }', "recursive_retry_unbounded"],
    ['taskkill /IM node.exe /F', "broad_process_termination"],
    ['setTimeout(() => {}, 1000); child.once("exit", () => {});', "listener_timer_cleanup_missing"],
  ] as const;
  for (const [unsafeSource, expectedDiagnostic] of unsafeFixtures) {
    writeFileSync(fixture, unsafeSource);
    const unsafe = spawnSync(process.execPath, [audit, "--fixture", fixture], { encoding: "utf8", windowsHide: true });
    const diagnostic = `${unsafe.stdout}${unsafe.stderr}`;
    if (unsafe.status === 0 || !diagnostic.includes(expectedDiagnostic)) throw new Error(`unsafe_wait_fixture_not_rejected_${expectedDiagnostic}`);
  }
  writeFileSync(fixture, 'const deadline = Date.now() + 1;\nwhile (Date.now() < deadline) await tick();\nconst retry = (attempt = 0) => attempt < 2 ? retry(attempt + 1) : undefined;\n');
  const safe = spawnSync(process.execPath, [audit, "--fixture", fixture], { encoding: "utf8", windowsHide: true });
  if (safe.status !== 0) throw new Error("corrected_wait_fixture_not_accepted");
  console.log("Authority process wait audit self-test: PASS");
} finally { rmSync(root, { recursive: true, force: true }); }

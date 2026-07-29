import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-source-artifact-audit-"));
const audit = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "check-authority-source-artifacts.mjs");
try {
  mkdirSync(path.join(root, "nested"), { recursive: true });
  writeFileSync(path.join(root, "authoritative.ts"), "export {};");
  writeFileSync(path.join(root, "authoritative.js"), "");
  writeFileSync(path.join(root, "nested", "authoritative.map"), "{}");
  const unsafe = spawnSync(process.execPath, [audit, "--root", root], { encoding: "utf8", windowsHide: true });
  if (unsafe.status === 0 || !unsafe.stderr.includes("generated_js_companion") || !unsafe.stderr.includes("generated_source_map")) throw new Error("unsafe_source_artifact_not_rejected");
  rmSync(path.join(root, "authoritative.js"));
  rmSync(path.join(root, "nested", "authoritative.map"));
  const safe = spawnSync(process.execPath, [audit, "--root", root], { encoding: "utf8", windowsHide: true });
  if (safe.status !== 0) throw new Error("corrected_source_artifact_not_accepted");
  console.log("Authority source-artifact audit self-test: PASS");
} finally { rmSync(root, { recursive: true, force: true }); }

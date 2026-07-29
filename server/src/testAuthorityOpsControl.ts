import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorityProfileIdentity, controlPathForProfile, createAuthorityOpsControlServer, type ControlDescriptor } from "./lib/authorityOpsControl.js";

const timeout = <T>(promise: Promise<T>, milliseconds = 5_000) => Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("control_test_timeout")), milliseconds))]);
const execute = (file: string, args: string[]) => new Promise<void>((resolve, reject) => execFile(file, args, { windowsHide: true }, (error) => error ? reject(error) : resolve()));
const expectCode = async (work: () => Promise<unknown>, code: string) => {
  try { await work(); } catch (error) { if (error instanceof Error && error.message === code) return; throw error; }
  throw new Error(`expected_${code}`);
};
const expectFailure = async (work: () => Promise<unknown>) => {
  try { await work(); } catch { return; }
  throw new Error("expected_failure");
};
const request = async (pipeName: string, payload: string): Promise<string> => new Promise((resolve, reject) => {
  const socket = net.createConnection(pipeName); let response = "";
  socket.setTimeout(2_000, () => reject(new Error("request_timeout")));
  socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
  socket.once("connect", () => socket.end(payload));
  socket.once("end", () => resolve(response)); socket.once("error", reject);
});
const rejected = async (pipeName: string, payload: string) => {
  const response = await timeout(request(pipeName, payload));
  if (response !== '{"version":1,"ok":false}\n') throw new Error("unsafe_or_invalid_rejection");
};
const command = (descriptor: ControlDescriptor, changes: Partial<Record<"version" | "action" | "profileIdentity" | "sessionId" | "controlToken", unknown>> = {}) =>
  `${JSON.stringify({ version: 1, action: "stop", profileIdentity: descriptor.profileIdentity, sessionId: descriptor.sessionId, controlToken: descriptor.controlToken, ...changes })}\n`;
const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-control-"));
const profileA = path.join(root, "profile-a.json");
const profileB = path.join(root, "profile-b.json");
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const controlSource = readFileSync(path.join(sourceRoot, "lib", "authorityOpsControl.ts"), "utf8");
const runSource = readFileSync(path.join(sourceRoot, "lib", "authorityOpsRun.ts"), "utf8");
const stopScript = readFileSync(path.join(sourceRoot, "..", "..", "scripts", "Stop-PersonalFinance.ps1"), "utf8");
if (/process\.kill|taskkill|Stop-Process|Get-Process/.test(`${controlSource}\n${stopScript}`)) throw new Error("stop_path_process_termination_present");
if (!controlSource.includes("timingSafeEqual") || !controlSource.includes("current.sessionId !== descriptor.sessionId") || !controlSource.includes("matches(current.controlToken, descriptor.controlToken)")) throw new Error("control_static_safety_missing");
if (runSource.includes("controlToken") || runSource.includes("pipeName")) throw new Error("control_secret_leaked_to_runtime_children");
const state = { stoppedA: 0, stoppedB: 0 };
const stopCounts = () => ({ a: state.stoppedA, b: state.stoppedB });
const controlA = await createAuthorityOpsControlServer({ profilePath: profileA, sessionId: "a".repeat(48), onStop: () => { state.stoppedA += 1; } });
const controlB = await createAuthorityOpsControlServer({ profilePath: profileB, sessionId: "b".repeat(48), onStop: () => { state.stoppedB += 1; } });
const descriptorA = controlA.descriptor; const descriptorB = controlB.descriptor;
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityOps.ts");
const tsx = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs");
try {
  // Authentication rejection matrix.  Every failure is a fixed, secret-free response.
  await rejected(descriptorA.pipeName, command(descriptorA, { controlToken: "x".repeat(43) }));
  await rejected(descriptorA.pipeName, command(descriptorA, { profileIdentity: authorityProfileIdentity(profileB) }));
  await rejected(descriptorA.pipeName, command(descriptorA, { sessionId: "c".repeat(48) }));
  await rejected(descriptorA.pipeName, "not-json\n");
  await rejected(descriptorA.pipeName, `${"x".repeat(1_025)}\n`);
  await rejected(descriptorA.pipeName, `${command(descriptorA)}${command(descriptorA)}`);
  await rejected(descriptorA.pipeName, command(descriptorA, { version: 2 }));
  await rejected(descriptorA.pipeName, command(descriptorA, { action: "status" }));
  if (stopCounts().a !== 0 || !existsSync(controlPathForProfile(profileA))) throw new Error("rejected_request_changed_state");

  // A descriptor copied across profiles is rejected before it can address a foreign pipe.
  const originalB = readFileSync(controlPathForProfile(profileB), "utf8");
  writeFileSync(controlPathForProfile(profileB), JSON.stringify(descriptorA), "utf8");
  await expectFailure(() => execute(process.execPath, [tsx, cli, "--profile", profileB, "stop"]));
  writeFileSync(controlPathForProfile(profileB), originalB, "utf8");
  if (stopCounts().a !== 0 || stopCounts().b !== 0) throw new Error("foreign_descriptor_was_accepted");

  // The real CLI only reads its exact profile descriptor and stops A alone.
  await timeout(execute(process.execPath, [tsx, cli, "--profile", profileA, "stop"]));
  if (stopCounts().a !== 1 || stopCounts().b !== 0 || !existsSync(controlPathForProfile(profileA))) throw new Error("profile_isolation_failed");
  await rejected(descriptorB.pipeName, command(descriptorA));

  // A repeated valid request is safely rejected after the one state transition.
  await rejected(descriptorA.pipeName, command(descriptorA));
  if (stopCounts().a !== 1) throw new Error("duplicate_stop_changed_state");
  await timeout(execute(process.execPath, [tsx, cli, "--profile", profileB, "stop"]));
  if (stopCounts().b !== 1) throw new Error("profile_b_stop_failed");

  // Replacement ownership: A's cleanup preserves a newer B descriptor.
  const replacementProfile = path.join(root, "replacement.json");
  const replacementA = await createAuthorityOpsControlServer({ profilePath: replacementProfile, sessionId: "d".repeat(48), onStop: () => undefined });
  const replacementDescriptor: ControlDescriptor = { ...replacementA.descriptor, sessionId: "e".repeat(48), pipeName: descriptorB.pipeName, controlToken: descriptorB.controlToken };
  writeFileSync(controlPathForProfile(replacementProfile), JSON.stringify(replacementDescriptor), "utf8");
  await replacementA.close();
  if (!existsSync(controlPathForProfile(replacementProfile))) throw new Error("replacement_descriptor_deleted");
  rmSync(controlPathForProfile(replacementProfile));

  // Startup always fails closed on stale, malformed, and active descriptors.
  const conflictProfile = path.join(root, "conflict.json");
  const stale: ControlDescriptor = { ...descriptorA, profileIdentity: authorityProfileIdentity(conflictProfile), sessionId: "f".repeat(48), pipeName: "\\\\.\\pipe\\personal-finance-missing", controlToken: "z".repeat(43) };
  writeFileSync(controlPathForProfile(conflictProfile), JSON.stringify(stale), "utf8");
  await expectCode(() => createAuthorityOpsControlServer({ profilePath: conflictProfile, sessionId: "g".repeat(48), onStop: () => undefined }), "supervisor_control_active");
  if (!existsSync(controlPathForProfile(conflictProfile))) throw new Error("stale_descriptor_not_preserved");
  rmSync(controlPathForProfile(conflictProfile)); writeFileSync(controlPathForProfile(conflictProfile), "malformed", "utf8");
  await expectCode(() => createAuthorityOpsControlServer({ profilePath: conflictProfile, sessionId: "g".repeat(48), onStop: () => undefined }), "supervisor_control_invalid");
  await expectFailure(() => execute(process.execPath, [tsx, cli, "--profile", conflictProfile, "stop"]));
  rmSync(controlPathForProfile(conflictProfile));

  console.log("Authority control isolation tests: PASS");
} finally {
  await controlA.close(); await controlB.close();
  rmSync(root, { recursive: true, force: true });
}

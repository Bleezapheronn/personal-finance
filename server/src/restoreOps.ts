import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import {
  armRestoreHandoff,
  markRestoreRuntimeHealthy,
  performArmedRestoreHandoff,
  prepareRestoreCandidate,
  readRestoreControlState,
  restorePlanPathForSession,
} from "./lib/restoreControl.js";
import { inspectRuntimePreflight } from "./runtimePreflight.js";
import { readRuntimeConfig } from "./runtimeConfig.js";

const usage = `Usage:
  npm run restore:ops -- --runtime-config <runtime.json> list
  npm run restore:ops -- --runtime-config <runtime.json> prepare --candidate <candidate-id>
  npm run restore:ops -- --runtime-config <runtime.json> arm --action <restore|rollback> --session <id> --plan <id> --confirmation <exact-text>
  npm run restore:ops -- --runtime-config <runtime.json> apply-armed --confirm-apply <session-id>
  npm run restore:ops -- --runtime-config <runtime.json> verify-live --session <session-id>
`;

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  let runtimeConfigPath = "";
  let candidateId = "";
  let action: "restore" | "rollback" | "" = "";
  let sessionId = "";
  let planId = "";
  let confirmation = "";
  let confirmApply = "";
  const commands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index] || "";
    if (arg === "--runtime-config") runtimeConfigPath = next();
    else if (arg === "--candidate") candidateId = next();
    else if (arg === "--action") {
      const value = next();
      if (value !== "restore" && value !== "rollback") throw new Error("restore_action_invalid");
      action = value;
    } else if (arg === "--session") sessionId = next();
    else if (arg === "--plan") planId = next();
    else if (arg === "--confirmation") confirmation = next();
    else if (arg === "--confirm-apply") confirmApply = next();
    else if (arg === "--help" || arg === "-h") return void console.log(usage);
    else commands.push(arg);
  }
  if (!runtimeConfigPath || !path.isAbsolute(runtimeConfigPath)) {
    throw new Error("runtime_config_path_invalid");
  }
  const command = commands[0];
  if (command === "list") {
    console.log(JSON.stringify(readRestoreControlState(runtimeConfigPath), null, 2));
    return;
  }
  if (command === "prepare") {
    if (!candidateId) throw new Error("restore_candidate_required");
    console.log(JSON.stringify(await prepareRestoreCandidate(runtimeConfigPath, candidateId), null, 2));
    return;
  }
  if (command === "arm") {
    if (!action || !sessionId || !planId || !confirmation) {
      throw new Error("restore_arm_request_invalid");
    }
    console.log(JSON.stringify(armRestoreHandoff(runtimeConfigPath, {
      action,
      sessionId,
      planId,
      confirmationText: confirmation,
    }), null, 2));
    return;
  }
  if (command === "apply-armed") {
    const state = readRestoreControlState(runtimeConfigPath);
    if (!state.session || confirmApply !== state.session.sessionId) {
      throw new Error("restore_apply_confirmation_invalid");
    }
    const config = readRuntimeConfig(runtimeConfigPath);
    if ((await inspectRuntimePreflight(config, runtimeConfigPath)).kind !== "clear") {
      throw new Error("restore_runtime_not_clear");
    }
    const result = await performArmedRestoreHandoff(runtimeConfigPath);
    console.log(JSON.stringify({ action: result.action, sessionId: result.sessionId }, null, 2));
    return;
  }
  if (command === "verify-live") {
    const state = readRestoreControlState(runtimeConfigPath);
    if (!state.session || state.session.sessionId !== sessionId) {
      throw new Error("restore_session_stale");
    }
    const config = readRuntimeConfig(runtimeConfigPath);
    if ((await inspectRuntimePreflight(config, runtimeConfigPath)).kind !== "healthy-existing") {
      throw new Error("restore_runtime_not_healthy");
    }
    markRestoreRuntimeHealthy(runtimeConfigPath, {
      action: state.session.lastAction,
      sessionId,
      planPath: restorePlanPathForSession(runtimeConfigPath, sessionId),
    });
    console.log("Restore runtime verification: PASS");
    return;
  }
  console.error(usage);
  throw new Error("restore_ops_command_invalid");
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "restore_ops_failed"));
    process.exitCode = 1;
  });
}

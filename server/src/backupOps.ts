import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import {
  applyRetentionPlan,
  backupConfigPathForRuntime,
  backupStatusPathForRuntime,
  createRetentionPlan,
  initializeBackupSettings,
  inventoryScheduledBackups,
  readBackupSettings,
  runScheduledSqliteBackup,
  schedulerInstall,
  updateBackupSettings,
  validateBackupDestination,
} from "./lib/scheduledSqliteBackup.js";

type Command = "config" | "backup" | "retention" | "scheduler";
export const backupOpsUsage =
  "Usage: npm run backup:ops -- --runtime-config <runtime.json> <config|backup|retention|scheduler> <command> [options]";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  let runtimeConfigPath = "";
  let destination = "";
  let time = "";
  let planId = "";
  let initialize = false;
  let confirm = false;
  let classification: "daily" | "monthly" = "daily";
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--runtime-config") runtimeConfigPath = args[++index] || "";
    else if (arg === "--destination") destination = args[++index] || "";
    else if (arg === "--time") time = args[++index] || "";
    else if (arg === "--plan") planId = args[++index] || "";
    else if (arg === "--initialize") initialize = true;
    else if (arg === "--confirm") confirm = true;
    else if (arg === "--monthly") classification = "monthly";
    else if (arg === "--help" || arg === "-h") return void console.log(backupOpsUsage);
    else words.push(arg);
  }
  if (!runtimeConfigPath || !path.isAbsolute(runtimeConfigPath)) {
    throw new Error("backup_ops_runtime_config_required");
  }
  const [group, command] = words as [Command, string];
  if (!group || !command) throw new Error("backup_ops_command_required");
  if (group === "config") {
    if (command === "init") {
      console.log(JSON.stringify(initializeBackupSettings(runtimeConfigPath, {
        ...(destination ? { destinationDirectory: destination } : {}),
        ...(time ? { dailyLocalTime: time } : {}),
      }), null, 2));
    } else if (command === "status") {
      console.log(JSON.stringify({ configPath: backupConfigPathForRuntime(runtimeConfigPath), settings: readBackupSettings(runtimeConfigPath) }, null, 2));
    } else if (command === "validate-destination" && destination) {
      console.log(JSON.stringify(validateBackupDestination(runtimeConfigPath, destination, initialize), null, 2));
    } else if (command === "set-destination" && destination) {
      console.log(JSON.stringify(updateBackupSettings(runtimeConfigPath, { destinationDirectory: destination }, initialize), null, 2));
    } else if (command === "set-time" && time) {
      console.log(JSON.stringify(updateBackupSettings(runtimeConfigPath, { dailyLocalTime: time }), null, 2));
    } else if (command === "enable" || command === "disable") {
      console.log(JSON.stringify(updateBackupSettings(runtimeConfigPath, { enabled: command === "enable" }), null, 2));
    } else throw new Error("backup_ops_command_invalid");
    return;
  }
  if (group === "backup") {
    if (command === "run") console.log(JSON.stringify(await runScheduledSqliteBackup(runtimeConfigPath, classification), null, 2));
    else if (["list", "verify", "verify-latest"].includes(command)) console.log(JSON.stringify(inventoryScheduledBackups(runtimeConfigPath).map(({ basename, valid, reason }) => ({ basename, valid, reason })), null, 2));
    else if (command === "status") console.log(JSON.stringify({ statusPath: backupStatusPathForRuntime(runtimeConfigPath), inventory: inventoryScheduledBackups(runtimeConfigPath).length }, null, 2));
    else throw new Error("backup_ops_command_invalid");
    return;
  }
  if (group === "retention") {
    const plan = createRetentionPlan(runtimeConfigPath);
    if (command === "dry-run") console.log(JSON.stringify(plan, null, 2));
    else if (command === "apply" && planId === plan.planId) console.log(JSON.stringify(applyRetentionPlan(runtimeConfigPath, plan, confirm), null, 2));
    else throw new Error("backup_ops_command_invalid");
    return;
  }
  if (group === "scheduler" && ["install", "update", "remove"].includes(command)) {
    schedulerInstall(runtimeConfigPath, command as "install" | "update" | "remove");
    console.log("scheduler_operation_pass");
    return;
  }
  throw new Error("backup_ops_command_invalid");
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "backup_ops_failed"));
    process.exitCode = 1;
  });
}

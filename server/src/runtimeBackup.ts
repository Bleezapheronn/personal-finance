import { runScheduledSqliteBackup } from "./lib/scheduledSqliteBackup.js";
import { readRuntimeConfig, runtimeConfigPathFromArgs } from "./runtimeConfig.js";

const runtimeConfigPath = runtimeConfigPathFromArgs(process.argv.slice(2));
readRuntimeConfig(runtimeConfigPath);
runScheduledSqliteBackup(runtimeConfigPath)
  .then((result) => console.log(`Verified scheduled backup: ${result.basename}`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "scheduled_backup_failed");
    process.exitCode = 1;
  });

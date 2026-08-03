import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serverRoot } from "./lib/paths.js";
import {
  initializeBackupSettings,
  inventoryScheduledBackups,
  runScheduledSqliteBackup,
  updateBackupSettings,
} from "./lib/scheduledSqliteBackup.js";

const assert: (value: unknown) => asserts value = (value) => {
  if (!value) throw new Error("assertion_failed");
};

const main = async (): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "pf-scheduled-backup-test-"));
  try {
    const runtimeDirectory = path.join(root, "runtime");
    const sqlitePath = path.join(runtimeDirectory, "personal-finance.sqlite");
    const tokenPath = path.join(root, "token");
    const runtimeConfigPath = path.join(runtimeDirectory, "runtime.json");
    const destination = path.join(root, "backups");
    const staging = path.join(root, "staging");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(tokenPath, "test-token");
    const db = new Database(sqlitePath);
    try {
      db.exec(readFileSync(path.join(serverRoot, "schema", "prototype-schema.sql"), "utf8"));
    } finally {
      db.close();
    }
    writeFileSync(runtimeConfigPath, JSON.stringify({
      version: 1,
      sqlitePath,
      tokenFilePath: tokenPath,
      apiHost: "127.0.0.1",
      apiPort: 3160,
      frontendHost: "localhost",
      frontendPort: 5173,
    }));
    initializeBackupSettings(runtimeConfigPath, {
      destinationDirectory: destination,
      stagingDirectory: staging,
      taskName: "PF scheduled backup test",
    });
    await runScheduledSqliteBackup(runtimeConfigPath, "daily", { allowDisabledForManualRun: true });
    assert(inventoryScheduledBackups(runtimeConfigPath).every((item) => item.valid));

    updateBackupSettings(runtimeConfigPath, { enabled: true, dailyLocalTime: "04:30" });
    const scheduled = await runScheduledSqliteBackup(runtimeConfigPath, "monthly");
    assert(existsSync(path.join(destination, "Monthly", scheduled.basename)));
    assert(inventoryScheduledBackups(runtimeConfigPath).filter((item) => item.valid).length === 2);
    console.log("Scheduled SQLite backup checks: PASS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

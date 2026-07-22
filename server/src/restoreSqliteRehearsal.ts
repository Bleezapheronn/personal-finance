import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { restoreSqliteAuthorityCheckpointBackup } from "./lib/sqliteAuthorityCheckpoint.js";
import { restoreSqliteNativeBackup } from "./lib/sqliteBackupRestore.js";

export interface RestoreSqliteArgs {
  backup?: string;
  output?: string;
  manifest?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const restoreSqliteUsage = `Usage:
  npm run restore:sqlite-rehearsal -- -- --backup <backup.sqlite> --output <restored.sqlite> --manifest <manifest.json>

Options:
  --backup <path>                    Existing SQLite-native backup.
  --output <path>                    Fresh restored SQLite database path.
  --manifest <path>                  Manifest produced with the backup.
  --allow-repo-output-for-tests      Permit repo-local paths only for explicit tests.
  --help                             Show this help text.
`;

export const parseRestoreSqliteArgs = (argv: string[]): RestoreSqliteArgs => {
  const args: RestoreSqliteArgs = {
    allowRepoOutputForTests: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
      continue;
    }
    if (["--backup", "--output", "--manifest"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--backup") args.backup = value;
      if (arg === "--output") args.output = value;
      if (arg === "--manifest") args.manifest = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseRestoreSqliteArgs(process.argv.slice(2));
  if (args.help) {
    console.log(restoreSqliteUsage);
    return;
  }
  if (!args.backup || !args.output || !args.manifest) {
    console.error(restoreSqliteUsage);
    throw new Error("--backup, --output, and --manifest are required.");
  }
  const options = {
    backupPath: path.resolve(args.backup),
    outputPath: path.resolve(args.output),
    manifestPath: path.resolve(args.manifest),
    allowRepoOutputForTests: args.allowRepoOutputForTests,
  };
  let result;
  try {
    result = await restoreSqliteNativeBackup(options);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "backup_manifest_invalid") {
      throw error;
    }
    result = await restoreSqliteAuthorityCheckpointBackup(options);
  }
  console.log("SQLite restore rehearsal: PASS");
  console.log(`Backup: ${result.backupFile}`);
  console.log(`Restored: ${result.restoredFile}`);
  console.log(`Manifest: ${result.manifestFile}`);
  console.log(`Verified tables: ${result.tableCount}`);
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_restore_rehearsal_failed"));
    process.exitCode = 1;
  });
}

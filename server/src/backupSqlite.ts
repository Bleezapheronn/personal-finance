import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { createSqliteNativeBackup } from "./lib/sqliteBackupRestore.js";

export interface BackupSqliteArgs {
  source?: string;
  output?: string;
  manifest?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const backupSqliteUsage = `Usage:
  npm run backup:sqlite -- -- --source <source.sqlite> --output <backup.sqlite> [--manifest <manifest.json>]

Options:
  --source <path>                    Existing SQLite source database.
  --output <path>                    Fresh SQLite-native backup path.
  --manifest <path>                  Optional manifest path; defaults beside the backup.
  --allow-repo-output-for-tests      Permit repo-local paths only for explicit tests.
  --help                             Show this help text.
`;

export const parseBackupSqliteArgs = (argv: string[]): BackupSqliteArgs => {
  const args: BackupSqliteArgs = {
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
    if (["--source", "--output", "--manifest"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--source") args.source = value;
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
  const args = parseBackupSqliteArgs(process.argv.slice(2));
  if (args.help) {
    console.log(backupSqliteUsage);
    return;
  }
  if (!args.source || !args.output) {
    console.error(backupSqliteUsage);
    throw new Error("--source and --output are required.");
  }
  const result = await createSqliteNativeBackup({
    sourcePath: path.resolve(args.source),
    outputPath: path.resolve(args.output),
    manifestPath: args.manifest ? path.resolve(args.manifest) : undefined,
    allowRepoOutputForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite native backup: PASS");
  console.log(`Source: ${result.sourceFile}`);
  console.log(`Backup: ${result.backupFile}`);
  console.log(`Manifest: ${result.manifestFile}`);
  console.log(`Verified tables: ${result.tableCount}`);
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_backup_failed"));
    process.exitCode = 1;
  });
}

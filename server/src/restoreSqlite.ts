import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { restoreSqliteNativeBackup } from "./lib/sqliteBackupRestore.js";

export interface RestoreSqliteArgs {
  backup?: string;
  output?: string;
  manifest?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const restoreSqliteUsage = `Usage:
  npm run restore:sqlite -- --backup <backup.sqlite> --output <restored.sqlite> --manifest <manifest.json>
`;

export const parseRestoreSqliteArgs = (argv: string[]): RestoreSqliteArgs => {
  const args: RestoreSqliteArgs = { allowRepoOutputForTests: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
    } else if (["--backup", "--output", "--manifest"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--backup") args.backup = value;
      if (arg === "--output") args.output = value;
      if (arg === "--manifest") args.manifest = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseRestoreSqliteArgs(process.argv.slice(2));
  if (args.help) return void console.log(restoreSqliteUsage);
  if (!args.backup || !args.output || !args.manifest) {
    console.error(restoreSqliteUsage);
    throw new Error("--backup, --output, and --manifest are required.");
  }
  const result = await restoreSqliteNativeBackup({
    backupPath: path.resolve(args.backup),
    outputPath: path.resolve(args.output),
    manifestPath: path.resolve(args.manifest),
    allowRepoOutputForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite restore: PASS");
  console.log(`Manifest kind: ${result.manifestKind}`);
  console.log(`Verified tables: ${result.tableCount}`);
  console.log(`Candidate ID: ${result.candidateId}`);
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_restore_failed"));
    process.exitCode = 1;
  });
}

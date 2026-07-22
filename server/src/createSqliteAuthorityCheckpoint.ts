import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { createSqliteAuthorityCheckpoint } from "./lib/sqliteAuthorityCheckpoint.js";

interface Args {
  sqlite?: string;
  currentManifest?: string;
  backupOutput?: string;
  manifestOutput?: string;
  label?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const createSqliteAuthorityCheckpointUsage = `Usage:
  npm run create:sqlite-authority-checkpoint -- -- --sqlite <current.sqlite> --current-manifest <authority-manifest.json> --backup-output <new-backup.sqlite> --manifest-output <new-authority-manifest.json> [--label <safe-label>]
`;

export const parseCreateSqliteAuthorityCheckpointArgs = (
  argv: string[],
): Args => {
  const args: Args = { allowRepoOutputForTests: false, help: false };
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
    if (
      [
        "--sqlite",
        "--current-manifest",
        "--backup-output",
        "--manifest-output",
        "--label",
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--sqlite") args.sqlite = value;
      if (arg === "--current-manifest") args.currentManifest = value;
      if (arg === "--backup-output") args.backupOutput = value;
      if (arg === "--manifest-output") args.manifestOutput = value;
      if (arg === "--label") args.label = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseCreateSqliteAuthorityCheckpointArgs(process.argv.slice(2));
  if (args.help) {
    console.log(createSqliteAuthorityCheckpointUsage);
    return;
  }
  if (
    !args.sqlite ||
    !args.currentManifest ||
    !args.backupOutput ||
    !args.manifestOutput
  ) {
    console.error(createSqliteAuthorityCheckpointUsage);
    throw new Error("authority_checkpoint_arguments_required");
  }
  const result = await createSqliteAuthorityCheckpoint({
    sqlitePath: path.resolve(args.sqlite),
    currentManifestPath: path.resolve(args.currentManifest),
    backupOutputPath: path.resolve(args.backupOutput),
    manifestOutputPath: path.resolve(args.manifestOutput),
    label: args.label,
    allowRepoOutputForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite authority checkpoint creation: PASS");
  console.log(`Checkpoint sequence: ${result.checkpointSequence}`);
  console.log(`Backup: ${result.backupFile}`);
  console.log(`Manifest: ${result.manifestFile}`);
  console.log(`Verified tables: ${result.verifiedTables}`);
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_authority_checkpoint_failed"));
    process.exitCode = 1;
  });
}

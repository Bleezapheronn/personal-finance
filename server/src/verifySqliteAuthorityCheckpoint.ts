import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { verifySqliteAuthorityCheckpoint } from "./lib/sqliteAuthorityCheckpoint.js";

interface Args {
  manifest?: string;
  sqlite?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const verifySqliteAuthorityCheckpointUsage = `Usage:
  npm run verify:sqlite-authority-checkpoint -- -- --manifest <authority-manifest.json> [--sqlite <active.sqlite>]
`;

export const parseVerifySqliteAuthorityCheckpointArgs = (
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
    if (arg === "--manifest" || arg === "--sqlite") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--manifest") args.manifest = value;
      if (arg === "--sqlite") args.sqlite = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = (): void => {
  const args = parseVerifySqliteAuthorityCheckpointArgs(process.argv.slice(2));
  if (args.help) {
    console.log(verifySqliteAuthorityCheckpointUsage);
    return;
  }
  if (!args.manifest) {
    console.error(verifySqliteAuthorityCheckpointUsage);
    throw new Error("authority_checkpoint_manifest_required");
  }
  const result = verifySqliteAuthorityCheckpoint({
    manifestPath: path.resolve(args.manifest),
    sqlitePath: args.sqlite ? path.resolve(args.sqlite) : undefined,
    allowRepoPathsForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite authority checkpoint verification: PASS");
  console.log(`Checkpoint sequence: ${result.checkpointSequence}`);
  console.log(`Backup verified: ${result.backupVerified}`);
  console.log(`Active SQLite verified: ${result.activeSqliteVerified}`);
};

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      safeCliErrorMessage(error, "sqlite_authority_checkpoint_verification_failed"),
    );
    process.exitCode = 1;
  }
}

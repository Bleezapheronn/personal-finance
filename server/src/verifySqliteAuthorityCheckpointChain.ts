import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { verifySqliteAuthorityCheckpointChain } from "./lib/sqliteAuthorityCheckpoint.js";

interface Args {
  manifests: string[];
  sqlite?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const verifySqliteAuthorityCheckpointChainUsage = `Usage:
  npm run verify:sqlite-authority-checkpoint-chain -- -- --manifest <checkpoint-0.json> --manifest <checkpoint-1.json> [--manifest <checkpoint-n.json>] [--sqlite <active.sqlite>]
`;

export const parseVerifySqliteAuthorityCheckpointChainArgs = (
  argv: string[],
): Args => {
  const args: Args = {
    manifests: [],
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
    if (arg === "--manifest" || arg === "--sqlite") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--manifest") args.manifests.push(value);
      if (arg === "--sqlite") args.sqlite = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = (): void => {
  const args = parseVerifySqliteAuthorityCheckpointChainArgs(
    process.argv.slice(2),
  );
  if (args.help) {
    console.log(verifySqliteAuthorityCheckpointChainUsage);
    return;
  }
  if (args.manifests.length === 0) {
    console.error(verifySqliteAuthorityCheckpointChainUsage);
    throw new Error("authority_checkpoint_chain_manifests_required");
  }
  const result = verifySqliteAuthorityCheckpointChain({
    manifestPaths: args.manifests.map((value) => path.resolve(value)),
    sqlitePath: args.sqlite ? path.resolve(args.sqlite) : undefined,
    allowRepoPathsForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite authority checkpoint chain verification: PASS");
  console.log(`Checkpoints: ${result.checkpointCount}`);
  console.log(`Final sequence: ${result.finalSequence}`);
  console.log(`Backups verified: ${result.backupsVerified}`);
  console.log(`Active SQLite verified: ${result.activeSqliteVerified}`);
};

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      safeCliErrorMessage(error, "sqlite_authority_checkpoint_chain_failed"),
    );
    process.exitCode = 1;
  }
}

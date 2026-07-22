import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { verifySqliteAuthorityRollback } from "./lib/sqliteAuthorityCutover.js";

interface Args {
  sqlite?: string;
  cutoverManifest?: string;
  currentBackup?: string;
  currentBackupManifest?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const verifySqliteAuthorityRollbackUsage = `Usage:
  npm run verify:sqlite-authority-rollback -- -- --sqlite <current.sqlite> --cutover-manifest <manifest.json> --current-backup <backup.sqlite> --current-backup-manifest <backup-manifest.json>
`;

export const parseVerifySqliteAuthorityRollbackArgs = (argv: string[]): Args => {
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
    if (["--sqlite", "--cutover-manifest", "--current-backup", "--current-backup-manifest"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--sqlite") args.sqlite = value;
      if (arg === "--cutover-manifest") args.cutoverManifest = value;
      if (arg === "--current-backup") args.currentBackup = value;
      if (arg === "--current-backup-manifest") args.currentBackupManifest = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = (): void => {
  const args = parseVerifySqliteAuthorityRollbackArgs(process.argv.slice(2));
  if (args.help) {
    console.log(verifySqliteAuthorityRollbackUsage);
    return;
  }
  if (!args.sqlite || !args.cutoverManifest || !args.currentBackup || !args.currentBackupManifest) {
    console.error(verifySqliteAuthorityRollbackUsage);
    throw new Error("rollback_arguments_required");
  }
  const result = verifySqliteAuthorityRollback({
    currentSqlitePath: path.resolve(args.sqlite),
    cutoverManifestPath: path.resolve(args.cutoverManifest),
    currentBackupPath: path.resolve(args.currentBackup),
    currentBackupManifestPath: path.resolve(args.currentBackupManifest),
    allowRepoPathsForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite authority rollback verification: PASS");
  console.log(`Cutover backup verified: ${result.cutoverBackupVerified}`);
  console.log(`Current backup verified: ${result.currentBackupVerified}`);
  console.log(`Instructions: ${result.rollbackInstructionsId}`);
};

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(safeCliErrorMessage(error, "sqlite_authority_rollback_failed"));
    process.exitCode = 1;
  }
}

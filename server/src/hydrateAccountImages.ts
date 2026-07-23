import Database from "better-sqlite3";
import path from "node:path";
import { existsSync } from "node:fs";
import { hydrateAccountImages } from "./lib/accountImageHydration.js";
import {
  assertOutsideRepoUnlessAllowed,
  basename,
  isInsidePath,
  repoRoot,
} from "./lib/paths.js";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";

interface Args {
  backup?: string;
  sqlite?: string;
  apply: boolean;
  confirmImageOnlyWrite: boolean;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

const usage = `Usage:
  npm run hydrate:account-images -- -- --backup <full-backup.json> --sqlite <existing.sqlite>

Options:
  --apply                         Perform the image-only update. Default is dry-run.
  --confirm-image-only-write     Required together with --apply.
  --allow-repo-output-for-tests  Allow repo-local fixtures only for explicit tests.
  --help                          Show this help text.
`;

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    apply: false,
    confirmImageOnlyWrite: false,
    allowRepoOutputForTests: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--backup" || arg === "--sqlite") {
      args[arg.slice(2) as "backup" | "sqlite"] = argv[index + 1];
      index += 1;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--confirm-image-only-write") {
      args.confirmImageOnlyWrite = true;
    } else if (arg === "--allow-repo-output-for-tests") {
      args.allowRepoOutputForTests = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error("unknown_argument");
    }
  }
  return args;
};

export const runAccountImageHydrationCli = (argv: string[]): number => {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage);
    return 0;
  }
  if (!args.backup || !args.sqlite) throw new Error("required_arguments_missing");
  if (!path.isAbsolute(args.backup) || !path.isAbsolute(args.sqlite)) {
    throw new Error("absolute_paths_required");
  }
  assertOutsideRepoUnlessAllowed(
    args.sqlite,
    args.allowRepoOutputForTests,
    "SQLite account image hydration target",
  );
  if (
    !args.allowRepoOutputForTests &&
    (isInsidePath(repoRoot, path.resolve(args.backup)) ||
      isInsidePath(repoRoot, path.resolve(args.sqlite)))
  ) {
    throw new Error("repo_local_path_refused");
  }
  if (!existsSync(args.backup) || !existsSync(args.sqlite)) {
    throw new Error("input_file_missing");
  }
  if (args.apply && !args.confirmImageOnlyWrite) {
    throw new Error("image_only_write_confirmation_required");
  }

  const db = new Database(args.sqlite, {
    readonly: !args.apply,
    fileMustExist: true,
  });
  try {
    const result = hydrateAccountImages(db, args.backup, args.apply);
    console.log(`Account image hydration: ${result.ok ? "PASS" : "FAIL"}`);
    console.log(`Mode: ${result.dryRun ? "dry-run" : "image-only write"}`);
    console.log(`Backup: ${basename(args.backup)}`);
    console.log(`SQLite: ${basename(args.sqlite)}`);
    console.log(`Accounts inspected: ${result.backupAccountsInspected}`);
    console.log(`Images found: ${result.imagesFound}`);
    console.log(`Target accounts matched: ${result.targetAccountsMatched}`);
    console.log(`Images eligible: ${result.imagesEligible}`);
    console.log(`Unchanged images: ${result.unchangedImages}`);
    console.log(`Missing target accounts: ${result.missingTargetAccounts}`);
    console.log(`Validation failures: ${result.validationFailures}`);
    console.log(`Rows ${result.dryRun ? "that would change" : "changed"}: ${
      result.dryRun ? result.rowsWouldChange : result.rowsChanged
    }`);
    console.log(`Result code: ${result.resultCode}`);
    return result.ok ? 0 : 1;
  } finally {
    db.close();
  }
};

if (isDirectRun(import.meta.url)) {
  try {
    process.exitCode = runAccountImageHydrationCli(process.argv.slice(2));
  } catch (error) {
    console.error(safeCliErrorMessage(error, "account_image_hydration_failed"));
    console.error(usage);
    process.exitCode = 1;
  }
}

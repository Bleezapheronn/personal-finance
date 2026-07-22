import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import { prepareSqliteAuthorityCutover } from "./lib/sqliteAuthorityCutover.js";

interface Args {
  backup?: string;
  sqlite?: string;
  backupOutput?: string;
  manifest?: string;
  asOf?: string;
  allowRepoOutputForTests: boolean;
  help: boolean;
}

export const prepareSqliteAuthorityCutoverUsage = `Usage:
  npm run prepare:sqlite-authority-cutover -- -- --backup <matching-full-backup.json> --sqlite <candidate.sqlite> --backup-output <backup.sqlite> --manifest <cutover-manifest.json> [--as-of YYYY-MM-DD]

Options:
  --backup <path>                    Matching full JSON backup from Dexie.
  --sqlite <path>                    Existing verified SQLite candidate.
  --backup-output <path>             Fresh mandatory native backup path.
  --manifest <path>                  Fresh redacted cutover manifest path.
  --as-of <YYYY-MM-DD>               Optional fixed local verification day.
  --allow-repo-output-for-tests      Permit repo-local paths only for tests.
  --help                             Show this help text.
`;

export const parsePrepareSqliteAuthorityCutoverArgs = (argv: string[]): Args => {
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
    if (["--backup", "--sqlite", "--backup-output", "--manifest", "--as-of"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--backup") args.backup = value;
      if (arg === "--sqlite") args.sqlite = value;
      if (arg === "--backup-output") args.backupOutput = value;
      if (arg === "--manifest") args.manifest = value;
      if (arg === "--as-of") args.asOf = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const parseAsOf = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("as_of_invalid");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("as_of_invalid");
  }
  return date;
};

const main = async (): Promise<void> => {
  const args = parsePrepareSqliteAuthorityCutoverArgs(process.argv.slice(2));
  if (args.help) {
    console.log(prepareSqliteAuthorityCutoverUsage);
    return;
  }
  if (!args.backup || !args.sqlite || !args.backupOutput || !args.manifest) {
    console.error(prepareSqliteAuthorityCutoverUsage);
    throw new Error(
      "--backup, --sqlite, --backup-output, and --manifest are required.",
    );
  }
  const result = await prepareSqliteAuthorityCutover({
    sourceBackupPath: path.resolve(args.backup),
    candidatePath: path.resolve(args.sqlite),
    backupOutputPath: path.resolve(args.backupOutput),
    manifestPath: path.resolve(args.manifest),
    asOf: parseAsOf(args.asOf),
    allowRepoOutputForTests: args.allowRepoOutputForTests,
  });
  console.log("SQLite authority cutover preparation: PASS");
  console.log(`Candidate: ${result.candidateFile}`);
  console.log(`Backup: ${result.backupFile}`);
  console.log(`Manifest: ${result.manifestFile}`);
  console.log(`Verified tables: ${result.verifiedTables}`);
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_authority_cutover_failed"));
    process.exitCode = 1;
  });
}

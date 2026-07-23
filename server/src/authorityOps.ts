import path from "node:path";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import {
  assertStartable,
  checkpointAuthorityOpsProfile,
  inspectAuthorityOpsProfile,
  initializeAuthorityOpsProfile,
  rollbackAuthorityOpsProfile,
  startAuthorityOpsProcesses,
  verifyAuthorityOpsProfile,
} from "./lib/authorityOps.js";
import { acquireAuthorityOpsLock } from "./lib/authorityOpsLock.js";
import {
  AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
  type AuthorityOpsMode,
  type AuthorityOpsProfile,
} from "./lib/authorityOpsProfile.js";
import type { AuthorityOpsCapabilityName } from "./lib/authorityOpsCapabilities.js";

export const AUTHORITY_PROFILE_PATH_ENV_VAR =
  "PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH" as const;

type Command = "init" | "status" | "verify" | "start" | "checkpoint" | "rollback";

interface AuthorityOpsArgs {
  command?: Command;
  profile?: string;
  mode?: AuthorityOpsMode;
  sqlite?: string;
  manifest?: string;
  sourceBackup?: string;
  tokenFile?: string;
  backupDirectory?: string;
  apiHost: "127.0.0.1";
  apiPort: number;
  viteHost: "127.0.0.1" | "localhost";
  vitePort: number;
  capabilities: string[];
  replace: boolean;
  apiOnly: boolean;
  viteOnly: boolean;
  dryRun: boolean;
  label?: string;
  toManifest?: string;
  confirmRollback: boolean;
  allowRepoPathsForTests: boolean;
  help: boolean;
}

export const authorityOpsUsage = `Usage:
  npm run authority:ops -- --profile <absolute-profile.json> init --mode <rehearsal|authoritative> --sqlite <active.sqlite> --token-file <token-file> --backup-directory <directory> [--manifest <authority-manifest.json>] [--source-backup <full-backup.json>] [--capability <name>] [--api-port 3160] [--vite-port 5173] [--replace]
  npm run authority:ops -- --profile <absolute-profile.json> status
  npm run authority:ops -- --profile <absolute-profile.json> verify
  npm run authority:ops -- --profile <absolute-profile.json> start [--api-only|--vite-only] [--dry-run]
  npm run authority:ops -- --profile <absolute-profile.json> checkpoint [--label <safe-label>]
  npm run authority:ops -- --profile <absolute-profile.json> rollback --to-manifest <checkpoint.manifest.json> --confirm-rollback

The --profile argument may be replaced by PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH.
`;

const parsePort = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${flag}_invalid`);
  }
  return parsed;
};

export const parseAuthorityOpsArgs = (argv: string[]): AuthorityOpsArgs => {
  const args: AuthorityOpsArgs = {
    apiHost: "127.0.0.1",
    apiPort: 3160,
    viteHost: "127.0.0.1",
    vitePort: 5173,
    capabilities: [],
    replace: false,
    apiOnly: false,
    viteOnly: false,
    // npm consumes --dry-run as its own option and forwards this safe state.
    dryRun: process.env.npm_config_dry_run === "true",
    confirmRollback: false,
    allowRepoPathsForTests: false,
    help: false,
  };
  const commands = new Set<Command>([
    "init",
    "status",
    "verify",
    "start",
    "checkpoint",
    "rollback",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (commands.has(argument as Command)) {
      if (args.command) throw new Error("authority_ops_command_repeated");
      args.command = argument as Command;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    if (argument === "--replace") args.replace = true;
    else if (argument === "--api-only") args.apiOnly = true;
    else if (argument === "--vite-only") args.viteOnly = true;
    else if (argument === "--dry-run") args.dryRun = true;
    else if (argument === "--confirm-rollback") args.confirmRollback = true;
    else if (argument === "--allow-repo-paths-for-tests") {
      args.allowRepoPathsForTests = true;
    } else if (
      [
        "--profile",
        "--mode",
        "--sqlite",
        "--manifest",
        "--source-backup",
        "--token-file",
        "--backup-directory",
        "--api-host",
        "--api-port",
        "--vite-host",
        "--vite-port",
        "--capability",
        "--label",
        "--to-manifest",
      ].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument}_requires_value`);
      if (argument === "--profile") args.profile = value;
      if (argument === "--mode") {
        if (value !== "rehearsal" && value !== "authoritative") {
          throw new Error("authority_ops_mode_invalid");
        }
        args.mode = value;
      }
      if (argument === "--sqlite") args.sqlite = value;
      if (argument === "--manifest") args.manifest = value;
      if (argument === "--source-backup") args.sourceBackup = value;
      if (argument === "--token-file") args.tokenFile = value;
      if (argument === "--backup-directory") args.backupDirectory = value;
      if (argument === "--api-host") {
        if (value !== "127.0.0.1") throw new Error("authority_ops_api_host_invalid");
        args.apiHost = value;
      }
      if (argument === "--api-port") args.apiPort = parsePort(value, "api_port");
      if (argument === "--vite-host") {
        if (value !== "127.0.0.1" && value !== "localhost") {
          throw new Error("authority_ops_vite_host_invalid");
        }
        args.viteHost = value;
      }
      if (argument === "--vite-port") args.vitePort = parsePort(value, "vite_port");
      if (argument === "--capability") {
        args.capabilities.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      }
      if (argument === "--label") args.label = value;
      if (argument === "--to-manifest") args.toManifest = value;
      index += 1;
    } else if (!args.profile && path.isAbsolute(argument)) {
      // npm 10 consumes its reserved --profile flag but forwards the value.
      args.profile = argument;
    } else {
      throw new Error(`unknown_argument_${argument}`);
    }
  }
  return args;
};

const resolvedProfilePath = (args: AuthorityOpsArgs): string => {
  const configured =
    args.profile ?? process.env[AUTHORITY_PROFILE_PATH_ENV_VAR]?.trim();
  if (!configured) throw new Error("authority_ops_profile_required");
  if (!path.isAbsolute(configured)) {
    throw new Error("authority_profile_path_invalid");
  }
  return path.resolve(configured);
};

const requiredInitProfile = (
  args: AuthorityOpsArgs,
): AuthorityOpsProfile => {
  if (
    !args.mode ||
    !args.sqlite ||
    !args.tokenFile ||
    !args.backupDirectory
  ) {
    throw new Error("authority_ops_init_arguments_required");
  }
  return {
    schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
    mode: args.mode,
    activeDatabasePath: args.sqlite,
    authorityManifestPath: args.manifest ?? null,
    sourceBackupPath: args.sourceBackup ?? null,
    tokenFilePath: args.tokenFile,
    backupDirectory: args.backupDirectory,
    apiHost: args.apiHost,
    apiPort: args.apiPort,
    viteHost: args.viteHost,
    vitePort: args.vitePort,
    enabledWriteCapabilities:
      args.capabilities as AuthorityOpsCapabilityName[],
  };
};

const printStatus = (status: Awaited<ReturnType<typeof inspectAuthorityOpsProfile>>) => {
  console.log("SQLite authority operations status:");
  console.log(`  Profile: ${status.profilePath}`);
  console.log(`  Schema version: ${status.schemaVersion}`);
  console.log(`  Mode: ${status.mode}`);
  console.log(`  Active database: ${status.activeDatabasePath}`);
  console.log(`  Database exists: ${status.databaseExists}`);
  console.log(`  Database size: ${status.databaseSizeBytes} bytes`);
  console.log(`  Manifest: ${status.authorityManifestPath ?? "none"}`);
  console.log(`  Manifest type: ${status.manifestType}`);
  console.log(`  Token file: ${status.tokenFilePath}`);
  console.log(`  Token file exists: ${status.tokenFileExists}`);
  console.log(`  Backup directory: ${status.backupDirectory}`);
  console.log(`  API: ${status.apiAddress}`);
  console.log(`  Vite: ${status.viteAddress}`);
  console.log(`  Capabilities: ${status.enabledCapabilities.join(", ") || "none"}`);
  console.log(`  Database fingerprint: ${status.databaseFingerprint || "unavailable"}`);
  console.log(`  Manifest fingerprint: ${status.manifestFingerprint ?? "unavailable"}`);
  console.log(`  Database matches manifest: ${status.databaseMatchesManifest ?? "not applicable"}`);
  console.log(`  Checkpoint required: ${status.checkpointRotationRequired}`);
  console.log(`  Checkpoint chain verified: ${status.checkpointChainVerified}`);
  console.log(`  API port available: ${status.apiPortAvailable}`);
  console.log(`  Vite port available: ${status.vitePortAvailable}`);
  console.log(`  WAL sidecar present: ${status.walSidecarExists}`);
  console.log(`  SHM sidecar present: ${status.shmSidecarExists}`);
  console.log(`  Mutation lock present: ${status.mutationLock.present}`);
  console.log(`  Readiness: ${status.readiness}`);
  if (status.code) console.log(`  Code: ${status.code}`);
};

const printStartDryRun = (
  plan: Awaited<ReturnType<typeof assertStartable>>,
  args: AuthorityOpsArgs,
) => {
  console.log("SQLite authority operations start dry-run:");
  console.log(`  Mode: ${plan.profile.mode}`);
  console.log(`  API address: http://${plan.profile.apiHost}:${plan.profile.apiPort}`);
  console.log(`  Vite address: http://${plan.profile.viteHost}:${plan.profile.vitePort}`);
  console.log(`  API selected: ${!args.viteOnly}`);
  console.log(`  Vite selected: ${!args.apiOnly}`);
  if (!args.viteOnly) {
    console.log(`  API command: ${plan.apiCommand.executable} ${plan.apiCommand.args.join(" ")}`);
    console.log(`  API working directory: ${plan.apiCommand.cwd}`);
  }
  if (!args.apiOnly) {
    console.log(`  Vite command: ${plan.viteCommand.executable} ${plan.viteCommand.args.join(" ")}`);
    console.log(`  Vite working directory: ${plan.viteCommand.cwd}`);
  }
  console.log("  Backend environment:");
  for (const [name, state] of Object.entries(plan.sanitizedEnvironment.backend)) {
    console.log(`    ${name}: ${state}`);
  }
  console.log("  Frontend environment:");
  for (const [name, state] of Object.entries(plan.sanitizedEnvironment.frontend)) {
    console.log(`    ${name}: ${state}`);
  }
  console.log(`  Token contents displayed: false`);
};

export const runAuthorityOps = async (argv: string[]): Promise<void> => {
  const args = parseAuthorityOpsArgs(argv);
  if (args.help) {
    console.log(authorityOpsUsage);
    return;
  }
  if (!args.command) {
    console.error(authorityOpsUsage);
    throw new Error("authority_ops_command_required");
  }
  const profilePath = resolvedProfilePath(args);
  const testOptions = {
    allowRepoPathsForTests: args.allowRepoPathsForTests,
  };

  if (args.command === "init") {
    const release = acquireAuthorityOpsLock(profilePath, "init");
    try {
      const result = await initializeAuthorityOpsProfile(
        profilePath,
        requiredInitProfile(args),
        { ...testOptions, replace: args.replace },
      );
      console.log("SQLite authority profile initialization: PASS");
      console.log(`Profile: ${result.profilePath}`);
      if (result.previousProfilePath) {
        console.log(`Previous profile: ${result.previousProfilePath}`);
      }
    } finally {
      release();
    }
    return;
  }

  if (args.command === "status") {
    const status = await inspectAuthorityOpsProfile(profilePath, testOptions);
    printStatus(status);
    if (
      status.readiness !== "ready to start" &&
      status.readiness !== "rehearsal ready"
    ) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.command === "verify") {
    const result = await verifyAuthorityOpsProfile(profilePath, testOptions);
    console.log("SQLite authority operations verification: PASS");
    console.log(`Mode: ${result.mode}`);
    console.log(`Checks: ${result.checks.length}`);
    console.log(`Full source comparison run: ${result.sourceComparisonRun}`);
    return;
  }

  if (args.command === "start") {
    const plan = await assertStartable(profilePath, {
      ...testOptions,
      apiOnly: args.apiOnly,
      viteOnly: args.viteOnly,
      dryRun: args.dryRun,
    });
    if (args.dryRun) {
      printStartDryRun(plan, args);
      return;
    }
    console.log("SQLite authority operations startup checks: PASS");
    console.log(`Mode: ${plan.profile.mode}`);
    console.log(`API: http://${plan.profile.apiHost}:${plan.profile.apiPort}`);
    console.log(`Vite: http://${plan.profile.viteHost}:${plan.profile.vitePort}`);
    const exitCode = await startAuthorityOpsProcesses(plan, {
      apiOnly: args.apiOnly,
      viteOnly: args.viteOnly,
    });
    if (exitCode !== 0) throw new Error("authority_ops_child_process_failed");
    return;
  }

  if (args.command === "checkpoint") {
    const release = acquireAuthorityOpsLock(profilePath, "checkpoint");
    try {
      const result = await checkpointAuthorityOpsProfile(profilePath, {
        ...testOptions,
        label: args.label,
      });
      console.log("SQLite authority checkpoint operation: PASS");
      console.log(`Safety backup: ${result.safetyBackupPath}`);
      console.log(`Checkpoint backup: ${result.checkpointBackupPath}`);
      console.log(`Checkpoint manifest: ${result.checkpointManifestPath}`);
      console.log(`Checkpoint sequence: ${result.checkpointSequence}`);
      console.log(`Previous profile: ${result.previousProfilePath}`);
    } finally {
      release();
    }
    return;
  }

  if (!args.toManifest) throw new Error("authority_ops_rollback_target_required");
  if (!path.isAbsolute(args.toManifest)) {
    throw new Error("authority_ops_rollback_target_path_invalid");
  }
  const release = acquireAuthorityOpsLock(profilePath, "rollback");
  try {
    const result = await rollbackAuthorityOpsProfile(
      profilePath,
      args.toManifest,
      { ...testOptions, confirmed: args.confirmRollback },
    );
    console.log("SQLite authority rollback operation: PASS");
    console.log(`Safety backup: ${result.safetyBackupPath}`);
    console.log(`Restored runtime: ${result.restoredRuntimePath}`);
    console.log(`Former runtime preserved: ${result.formerRuntimePath}`);
    console.log(`Target manifest: ${result.targetManifestPath}`);
    console.log(`Previous profile: ${result.previousProfilePath}`);
  } finally {
    release();
  }
};

if (isDirectRun(import.meta.url)) {
  runAuthorityOps(process.argv.slice(2)).catch((error) => {
    console.error(safeCliErrorMessage(error, "authority_ops_failed"));
    process.exitCode = 1;
  });
}

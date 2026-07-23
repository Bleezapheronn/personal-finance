import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { runSqlitePrototypeVerification } from "../verifySqlitePrototype.js";
import {
  ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR,
  SQLITE_AUTHORITY_ENABLED_ENV_VAR,
  SQLITE_CUTOVER_MANIFEST_PATH_ENV_VAR,
  SQLITE_PATH_ENV_VAR,
  TOKEN_FILE_PATH_ENV_VAR,
} from "../config.js";
import {
  AUTHORITY_OPS_CAPABILITIES,
  OPERATIONAL_READ_EXPERIMENT_FLAGS,
  buildCapabilityEnvironment,
  type AuthorityOpsCapabilityName,
} from "./authorityOpsCapabilities.js";
import { readAuthorityOpsLockStatus } from "./authorityOpsLock.js";
import {
  readAuthorityOpsProfile,
  validateAuthorityOpsProfile,
  writeAuthorityOpsProfileAtomic,
  type AuthorityOpsProfile,
} from "./authorityOpsProfile.js";
import {
  describeSqliteAuthorityManifest,
  evaluateSqliteAuthorityReadiness,
  readSqliteAuthorityManifest,
  readSqliteAuthorityManifestDescriptor,
  strictSqliteAuthorityLocalDay,
  type SqliteAuthorityManifestDescriptor,
} from "./sqliteAuthorityCutover.js";
import {
  createSqliteAuthorityCheckpoint,
  restoreSqliteAuthorityCheckpointBackup,
  verifySqliteAuthorityCheckpoint,
  verifySqliteAuthorityCheckpointChain,
} from "./sqliteAuthorityCheckpoint.js";
import { createSqliteNativeBackup } from "./sqliteBackupRestore.js";
import {
  logicalVerificationsMatch,
  readSqliteLogicalVerificationAtPath,
} from "./sqliteLogicalVerification.js";
import { assertSqliteAuthoritySchemaContract } from "./sqliteAuthorityCutover.js";
import {
  OPTIONAL_WRITE_CAPABILITY_KEYS,
  WRITE_CAPABILITY_KEYS,
  type WriteCapabilities,
} from "./writeCapabilities.js";
import { repoRoot } from "./paths.js";

export type AuthorityOpsReadiness =
  | "ready to start"
  | "rehearsal ready"
  | "checkpoint required before authoritative restart"
  | "invalid profile"
  | "unsafe path"
  | "missing dependency"
  | "verification failed";

export interface AuthorityOpsStatus {
  profilePath: string;
  schemaVersion: number;
  mode: AuthorityOpsProfile["mode"];
  activeDatabasePath: string;
  databaseExists: boolean;
  databaseSizeBytes: number;
  authorityManifestPath: string | null;
  manifestType: "none" | "cutover" | "checkpoint";
  tokenFilePath: string;
  tokenFileExists: boolean;
  backupDirectory: string;
  backupDirectoryAvailable: boolean;
  apiAddress: string;
  viteAddress: string;
  enabledCapabilities: AuthorityOpsCapabilityName[];
  databaseFingerprint: string;
  manifestFingerprint: string | null;
  databaseMatchesManifest: boolean | null;
  checkpointRotationRequired: boolean;
  authorityVerificationPassed: boolean;
  checkpointChainVerified: boolean;
  apiPortAvailable: boolean;
  vitePortAvailable: boolean;
  walSidecarExists: boolean;
  shmSidecarExists: boolean;
  configuredPathInsideRepository: false;
  mutationLock: ReturnType<typeof readAuthorityOpsLockStatus>;
  readiness: AuthorityOpsReadiness;
  code?: string;
}

export interface AuthorityOpsVerificationResult {
  status: "pass";
  mode: AuthorityOpsProfile["mode"];
  checks: string[];
  sourceComparisonRun: boolean;
}

const allCapabilitiesRecord = (
  enabled: readonly AuthorityOpsCapabilityName[],
): WriteCapabilities => {
  const selected = new Set<string>(enabled);
  return Object.fromEntries(
    [...WRITE_CAPABILITY_KEYS, ...OPTIONAL_WRITE_CAPABILITY_KEYS].map((name) => [
      name,
      selected.has(name),
    ]),
  ) as WriteCapabilities;
};

const assertHealthyLogicalState = (
  databasePath: string,
  asOf: Date,
) => {
  const verification = readSqliteLogicalVerificationAtPath(databasePath, asOf);
  assertSqliteAuthoritySchemaContract(verification, asOf);
  if (Object.values(verification.integritySummary).some((count) => count !== 0)) {
    throw new Error("authority_ops_structural_integrity_failed");
  }
  return verification;
};

export const portIsAvailable = (
  host: string,
  port: number,
): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });

const authorityManifestCandidates = (
  profile: AuthorityOpsProfile,
  extraManifestPath?: string,
): string[] => {
  const candidates = new Set<string>();
  for (const entry of readdirSync(profile.backupDirectory, {
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      candidates.add(path.resolve(profile.backupDirectory, entry.name));
    }
  }
  if (profile.authorityManifestPath) {
    candidates.add(path.resolve(profile.authorityManifestPath));
  }
  if (extraManifestPath) candidates.add(path.resolve(extraManifestPath));
  return [...candidates];
};

const readableAuthorityDescriptors = (
  profile: AuthorityOpsProfile,
  extraManifestPath?: string,
): Array<{ path: string; descriptor: SqliteAuthorityManifestDescriptor }> => {
  const values: Array<{
    path: string;
    descriptor: SqliteAuthorityManifestDescriptor;
  }> = [];
  for (const manifestPath of authorityManifestCandidates(
    profile,
    extraManifestPath,
  )) {
    try {
      values.push({
        path: manifestPath,
        descriptor: readSqliteAuthorityManifestDescriptor(manifestPath),
      });
    } catch {
      // Unrelated JSON runtime artifacts are not authority-chain members.
    }
  }
  return values;
};

export const resolveAuthorityManifestChain = (
  profile: AuthorityOpsProfile,
  finalManifestPath = profile.authorityManifestPath,
): string[] => {
  if (!finalManifestPath) throw new Error("authority_profile_manifest_required");
  const finalDescriptor = readSqliteAuthorityManifestDescriptor(finalManifestPath);
  const members = readableAuthorityDescriptors(profile, finalManifestPath).filter(
    ({ descriptor }) =>
      descriptor.authorityLineageId === finalDescriptor.authorityLineageId &&
      descriptor.checkpointSequence <= finalDescriptor.checkpointSequence,
  );
  const chain: string[] = [];
  for (let sequence = 0; sequence <= finalDescriptor.checkpointSequence; sequence += 1) {
    const matches = members.filter(
      ({ descriptor }) => descriptor.checkpointSequence === sequence,
    );
    if (matches.length !== 1) {
      throw new Error("authority_ops_checkpoint_chain_ambiguous");
    }
    chain.push(matches[0].path);
  }
  const last = readSqliteAuthorityManifestDescriptor(chain[chain.length - 1]);
  if (last.checkpointId !== finalDescriptor.checkpointId) {
    throw new Error("authority_ops_checkpoint_chain_target_mismatch");
  }
  verifySqliteAuthorityCheckpointChain({ manifestPaths: chain });
  return chain;
};

const inspectAuthoritativeState = (profile: AuthorityOpsProfile) => {
  if (!profile.authorityManifestPath) {
    throw new Error("authority_profile_manifest_required");
  }
  const descriptor = readSqliteAuthorityManifestDescriptor(
    profile.authorityManifestPath,
  );
  verifySqliteAuthorityCheckpoint({
    manifestPath: profile.authorityManifestPath,
  });
  const chain = resolveAuthorityManifestChain(profile);
  const asOf = strictSqliteAuthorityLocalDay(descriptor.normalizedAsOf);
  const databaseVerification = assertHealthyLogicalState(
    profile.activeDatabasePath,
    asOf,
  );
  const databaseMatchesManifest = logicalVerificationsMatch(
    databaseVerification,
    descriptor.databaseVerification,
  );
  const readiness = evaluateSqliteAuthorityReadiness({
    authorityEnabled: true,
    sqlitePath: profile.activeDatabasePath,
    manifestPath: profile.authorityManifestPath,
    capabilities: allCapabilitiesRecord(profile.enabledWriteCapabilities),
  });
  return {
    descriptor,
    chain,
    databaseVerification,
    databaseMatchesManifest,
    readiness,
  };
};

export const inspectAuthorityOpsProfile = async (
  profilePath: string,
  options: { allowRepoPathsForTests?: boolean } = {},
): Promise<AuthorityOpsStatus> => {
  const profile = readAuthorityOpsProfile(profilePath, options);
  const [apiPortAvailable, vitePortAvailable] = await Promise.all([
    portIsAvailable(profile.apiHost, profile.apiPort),
    portIsAvailable(profile.viteHost, profile.vitePort),
  ]);
  const stat = statSync(profile.activeDatabasePath);
  let databaseFingerprint = "";
  let manifestFingerprint: string | null = null;
  let databaseMatchesManifest: boolean | null = null;
  let checkpointRotationRequired = false;
  let authorityVerificationPassed = false;
  let checkpointChainVerified = false;
  let manifestType: AuthorityOpsStatus["manifestType"] = "none";
  let readiness: AuthorityOpsReadiness = "verification failed";
  let code: string | undefined;
  const mutationLock = readAuthorityOpsLockStatus(profilePath);

  try {
    if (profile.mode === "authoritative") {
      const inspected = inspectAuthoritativeState(profile);
      databaseFingerprint =
        inspected.databaseVerification.databaseIdentityFingerprint;
      manifestFingerprint =
        inspected.descriptor.databaseVerification.databaseIdentityFingerprint;
      databaseMatchesManifest = inspected.databaseMatchesManifest;
      checkpointRotationRequired = !databaseMatchesManifest;
      checkpointChainVerified = true;
      authorityVerificationPassed = inspected.readiness.ready;
      manifestType =
        inspected.descriptor.checkpointSequence === 0 ? "cutover" : "checkpoint";
      if (checkpointRotationRequired) {
        readiness = "checkpoint required before authoritative restart";
        code = "authority_checkpoint_required";
      } else if (inspected.readiness.ready) {
        readiness = "ready to start";
      } else {
        readiness = "verification failed";
        code = inspected.readiness.code ?? "authority_verification_failed";
      }
    } else {
      const verification = assertHealthyLogicalState(
        profile.activeDatabasePath,
        new Date(),
      );
      databaseFingerprint = verification.databaseIdentityFingerprint;
      readiness = "rehearsal ready";
      authorityVerificationPassed = true;
    }
  } catch (error) {
    code = error instanceof Error ? error.message : "authority_ops_status_failed";
    readiness = "verification failed";
  }
  if (
    (readiness === "ready to start" || readiness === "rehearsal ready") &&
    (!apiPortAvailable || !vitePortAvailable)
  ) {
    readiness = "missing dependency";
    code = "authority_ops_ports_occupied";
  } else if (
    (readiness === "ready to start" || readiness === "rehearsal ready") &&
    mutationLock.present
  ) {
    readiness = "missing dependency";
    code = mutationLock.stale
      ? "authority_ops_lock_stale"
      : "authority_ops_lock_held";
  }

  return {
    profilePath: path.resolve(profilePath),
    schemaVersion: profile.schemaVersion,
    mode: profile.mode,
    activeDatabasePath: profile.activeDatabasePath,
    databaseExists: true,
    databaseSizeBytes: stat.size,
    authorityManifestPath: profile.authorityManifestPath,
    manifestType,
    tokenFilePath: profile.tokenFilePath,
    tokenFileExists: true,
    backupDirectory: profile.backupDirectory,
    backupDirectoryAvailable: true,
    apiAddress: `http://${profile.apiHost}:${profile.apiPort}`,
    viteAddress: `http://${profile.viteHost}:${profile.vitePort}`,
    enabledCapabilities: [...profile.enabledWriteCapabilities],
    databaseFingerprint,
    manifestFingerprint,
    databaseMatchesManifest,
    checkpointRotationRequired,
    authorityVerificationPassed,
    checkpointChainVerified,
    apiPortAvailable,
    vitePortAvailable,
    walSidecarExists: existsSync(`${profile.activeDatabasePath}-wal`),
    shmSidecarExists: existsSync(`${profile.activeDatabasePath}-shm`),
    configuredPathInsideRepository: false,
    mutationLock,
    readiness,
    ...(code ? { code } : {}),
  };
};

export const verifyAuthorityOpsProfile = async (
  profilePath: string,
  options: { allowRepoPathsForTests?: boolean } = {},
): Promise<AuthorityOpsVerificationResult> => {
  const profile = readAuthorityOpsProfile(profilePath, options);
  const checks = ["profile", "path safety", "logical SQLite verification"];
  if (profile.mode === "authoritative") {
    const inspected = inspectAuthoritativeState(profile);
    if (!inspected.databaseMatchesManifest || !inspected.readiness.ready) {
      throw new Error(
        inspected.databaseMatchesManifest
          ? inspected.readiness.code ?? "authority_verification_failed"
          : "authority_checkpoint_required",
      );
    }
    checks.push("authority manifest", "checkpoint chain", "authority readiness");
  } else {
    assertHealthyLogicalState(profile.activeDatabasePath, new Date());
  }
  let sourceComparisonRun = false;
  if (profile.sourceBackupPath) {
    const comparison = runSqlitePrototypeVerification(
      profile.sourceBackupPath,
      profile.activeDatabasePath,
      undefined,
      undefined,
    );
    if (
      comparison.overallStatus !== "pass" ||
      comparison.failedChecks !== 0 ||
      comparison.totalMismatchCount !== 0
    ) {
      throw new Error("authority_ops_source_comparison_failed");
    }
    sourceComparisonRun = true;
    checks.push("full source comparison");
  }
  return { status: "pass", mode: profile.mode, checks, sourceComparisonRun };
};

export const initializeAuthorityOpsProfile = async (
  profilePath: string,
  profileValue: AuthorityOpsProfile,
  options: { replace?: boolean; allowRepoPathsForTests?: boolean } = {},
) => {
  const profile = validateAuthorityOpsProfile(profileValue, profilePath, options);
  if (profile.mode === "authoritative") {
    const inspected = inspectAuthoritativeState(profile);
    if (!inspected.databaseMatchesManifest || !inspected.readiness.ready) {
      throw new Error(
        inspected.databaseMatchesManifest
          ? inspected.readiness.code ?? "authority_profile_not_ready"
          : "authority_profile_database_manifest_mismatch",
      );
    }
  } else {
    assertHealthyLogicalState(profile.activeDatabasePath, new Date());
  }
  return writeAuthorityOpsProfileAtomic(profilePath, profile, options);
};

const artifactStamp = (): string =>
  new Date().toISOString().replace(/[-:.TZ]/g, "");

export const checkpointAuthorityOpsProfile = async (
  profilePath: string,
  options: { label?: string; allowRepoPathsForTests?: boolean } = {},
) => {
  const profile = readAuthorityOpsProfile(profilePath, options);
  if (profile.mode !== "authoritative" || !profile.authorityManifestPath) {
    throw new Error("authority_ops_checkpoint_requires_authoritative_profile");
  }
  const [apiAvailable, viteAvailable] = await Promise.all([
    portIsAvailable(profile.apiHost, profile.apiPort),
    portIsAvailable(profile.viteHost, profile.vitePort),
  ]);
  if (!apiAvailable || !viteAvailable) {
    throw new Error("authority_ops_services_must_be_stopped");
  }
  const stamp = artifactStamp();
  const safetyBackupPath = path.join(
    profile.backupDirectory,
    `authority-safety-before-checkpoint-${stamp}.sqlite`,
  );
  const safetyManifestPath = `${safetyBackupPath}.manifest.json`;
  await createSqliteNativeBackup({
    sourcePath: profile.activeDatabasePath,
    outputPath: safetyBackupPath,
    manifestPath: safetyManifestPath,
    allowRepoOutputForTests: options.allowRepoPathsForTests,
  });
  const checkpointBackupPath = path.join(
    profile.backupDirectory,
    `authority-checkpoint-${stamp}.sqlite`,
  );
  const checkpointManifestPath = path.join(
    profile.backupDirectory,
    `authority-checkpoint-${stamp}.manifest.json`,
  );
  const checkpoint = await createSqliteAuthorityCheckpoint({
    sqlitePath: profile.activeDatabasePath,
    currentManifestPath: profile.authorityManifestPath,
    backupOutputPath: checkpointBackupPath,
    manifestOutputPath: checkpointManifestPath,
    label: options.label,
    allowRepoOutputForTests: options.allowRepoPathsForTests,
  });
  verifySqliteAuthorityCheckpoint({
    manifestPath: checkpointManifestPath,
    sqlitePath: profile.activeDatabasePath,
    allowRepoPathsForTests: options.allowRepoPathsForTests,
  });
  const nextProfile: AuthorityOpsProfile = {
    ...profile,
    authorityManifestPath: checkpointManifestPath,
  };
  resolveAuthorityManifestChain(nextProfile, checkpointManifestPath);
  const updated = writeAuthorityOpsProfileAtomic(profilePath, nextProfile, {
    replace: true,
    allowRepoPathsForTests: options.allowRepoPathsForTests,
  });
  return {
    status: "ready" as const,
    safetyBackupPath,
    safetyManifestPath,
    checkpointBackupPath,
    checkpointManifestPath,
    checkpointSequence: checkpoint.checkpointSequence,
    previousProfilePath: updated.previousProfilePath!,
  };
};

const sha256File = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

export const rollbackAuthorityOpsProfile = async (
  profilePath: string,
  targetManifestPath: string,
  options: { confirmed: boolean; allowRepoPathsForTests?: boolean } = {
    confirmed: false,
  },
) => {
  if (!options.confirmed) throw new Error("authority_ops_rollback_confirmation_required");
  const profile = readAuthorityOpsProfile(profilePath, options);
  if (profile.mode !== "authoritative" || !profile.authorityManifestPath) {
    throw new Error("authority_ops_rollback_requires_authoritative_profile");
  }
  const [apiAvailable, viteAvailable] = await Promise.all([
    portIsAvailable(profile.apiHost, profile.apiPort),
    portIsAvailable(profile.viteHost, profile.vitePort),
  ]);
  if (!apiAvailable || !viteAvailable) {
    throw new Error("authority_ops_services_must_be_stopped");
  }
  const resolvedTarget = path.resolve(targetManifestPath);
  const currentChain = resolveAuthorityManifestChain(profile);
  const currentDescriptor = readSqliteAuthorityManifestDescriptor(
    profile.authorityManifestPath,
  );
  const targetDescriptor = readSqliteAuthorityManifestDescriptor(resolvedTarget);
  const targetMember = currentChain.find((manifestPath) => {
    const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
    return descriptor.checkpointId === targetDescriptor.checkpointId;
  });
  if (
    !targetMember ||
    targetDescriptor.authorityLineageId !== currentDescriptor.authorityLineageId ||
    targetDescriptor.checkpointSequence >= currentDescriptor.checkpointSequence
  ) {
    throw new Error("authority_ops_rollback_target_not_prior_checkpoint");
  }
  const stamp = artifactStamp();
  const safetyBackupPath = path.join(
    profile.backupDirectory,
    `authority-safety-before-rollback-${stamp}.sqlite`,
  );
  const safetyManifestPath = `${safetyBackupPath}.manifest.json`;
  await createSqliteNativeBackup({
    sourcePath: profile.activeDatabasePath,
    outputPath: safetyBackupPath,
    manifestPath: safetyManifestPath,
    allowRepoOutputForTests: options.allowRepoPathsForTests,
  });

  const targetBackupPath = path.resolve(
    path.dirname(targetMember),
    targetDescriptor.backupFileName,
  );
  const targetBefore = sha256File(targetBackupPath);
  const activeExtension = path.extname(profile.activeDatabasePath);
  const activeStem = path.basename(profile.activeDatabasePath, activeExtension);
  const restoredRuntimePath = path.join(
    path.dirname(profile.activeDatabasePath),
    `${activeStem}-rollback-${stamp}${activeExtension}`,
  );
  await restoreSqliteAuthorityCheckpointBackup({
    backupPath: targetBackupPath,
    outputPath: restoredRuntimePath,
    manifestPath: targetMember,
    allowRepoOutputForTests: options.allowRepoPathsForTests,
  });
  if (sha256File(targetBackupPath) !== targetBefore) {
    throw new Error("authority_ops_rollback_target_changed");
  }
  verifySqliteAuthorityCheckpoint({
    manifestPath: targetMember,
    sqlitePath: restoredRuntimePath,
    allowRepoPathsForTests: options.allowRepoPathsForTests,
  });
  const nextProfile: AuthorityOpsProfile = {
    ...profile,
    activeDatabasePath: restoredRuntimePath,
    authorityManifestPath: targetMember,
  };
  const updated = writeAuthorityOpsProfileAtomic(profilePath, nextProfile, {
    replace: true,
    allowRepoPathsForTests: options.allowRepoPathsForTests,
  });
  return {
    status: "ready" as const,
    safetyBackupPath,
    safetyManifestPath,
    restoredRuntimePath,
    targetManifestPath: targetMember,
    formerRuntimePath: profile.activeDatabasePath,
    previousProfilePath: updated.previousProfilePath!,
  };
};

export interface AuthorityOpsStartPlan {
  profile: AuthorityOpsProfile;
  apiCommand: { executable: string; args: string[]; cwd: string };
  viteCommand: { executable: string; args: string[]; cwd: string };
  apiEnvironment: NodeJS.ProcessEnv;
  viteEnvironment: NodeJS.ProcessEnv;
  sanitizedEnvironment: {
    backend: Record<string, "enabled" | "disabled" | "configured">;
    frontend: Record<string, "enabled" | "disabled" | "configured">;
  };
}

export const buildAuthorityOpsStartPlan = (
  profile: AuthorityOpsProfile,
): AuthorityOpsStartPlan => {
  const token = readFileSync(profile.tokenFilePath, "utf8").trim();
  if (!token) throw new Error("authority_profile_token_file_empty");
  const capabilityEnvironment = buildCapabilityEnvironment(
    profile.enabledWriteCapabilities,
  );
  const apiOrigin = `http://${profile.viteHost}:${profile.vitePort}`;
  const apiEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(profile.apiPort),
    [SQLITE_PATH_ENV_VAR]: profile.activeDatabasePath,
    [TOKEN_FILE_PATH_ENV_VAR]: profile.tokenFilePath,
    [ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR]: apiOrigin,
    [SQLITE_AUTHORITY_ENABLED_ENV_VAR]:
      profile.mode === "authoritative" ? "true" : "false",
    [SQLITE_CUTOVER_MANIFEST_PATH_ENV_VAR]:
      profile.authorityManifestPath ?? "",
    ...capabilityEnvironment.backend,
  };
  const frontendMode =
    profile.mode === "authoritative"
      ? "http-sqlite-authoritative"
      : "http-sqlite-rehearsal";
  const viteEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_PERSONAL_FINANCE_LOCAL_API_URL: `http://${profile.apiHost}:${profile.apiPort}`,
    VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN: token,
    VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND: frontendMode,
    VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL:
      profile.mode === "rehearsal" ? "true" : "false",
    VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED:
      profile.mode === "authoritative" ? "true" : "false",
    ...Object.fromEntries(
      OPERATIONAL_READ_EXPERIMENT_FLAGS.map((flag) => [flag, "true"]),
    ),
    ...capabilityEnvironment.frontend,
  };
  const repositoryRoot = repoRoot;
  const apiEntry = path.join(repositoryRoot, "server", "dist", "index.js");
  const viteEntry = path.join(
    repositoryRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js",
  );
  if (!existsSync(apiEntry)) throw new Error("authority_ops_server_build_missing");
  if (!existsSync(viteEntry)) throw new Error("authority_ops_vite_missing");
  const sanitized = (environment: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(environment).map(([name, value]) => [
        name,
        value === "true"
          ? "enabled"
          : value === "false" || value === ""
            ? "disabled"
            : "configured",
      ]),
    ) as Record<string, "enabled" | "disabled" | "configured">;
  return {
    profile,
    apiCommand: {
      executable: process.execPath,
      args: [apiEntry],
      cwd: path.join(repositoryRoot, "server"),
    },
    viteCommand: {
      executable: process.execPath,
      args: [
        viteEntry,
        "--host",
        profile.viteHost,
        "--port",
        String(profile.vitePort),
        "--strictPort",
      ],
      cwd: repositoryRoot,
    },
    apiEnvironment,
    viteEnvironment,
    sanitizedEnvironment: {
      backend: sanitized({
        [SQLITE_PATH_ENV_VAR]: profile.activeDatabasePath,
        [TOKEN_FILE_PATH_ENV_VAR]: profile.tokenFilePath,
        [ADDITIONAL_ALLOWED_ORIGIN_ENV_VAR]: apiOrigin,
        [SQLITE_AUTHORITY_ENABLED_ENV_VAR]:
          profile.mode === "authoritative" ? "true" : "false",
        [SQLITE_CUTOVER_MANIFEST_PATH_ENV_VAR]:
          profile.authorityManifestPath ?? "",
        ...capabilityEnvironment.backend,
      }),
      frontend: sanitized({
        VITE_PERSONAL_FINANCE_LOCAL_API_URL: "configured",
        VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN: "configured",
        VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND: frontendMode,
        VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL:
          profile.mode === "rehearsal" ? "true" : "false",
        VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED:
          profile.mode === "authoritative" ? "true" : "false",
        ...Object.fromEntries(
          OPERATIONAL_READ_EXPERIMENT_FLAGS.map((flag) => [flag, "true"]),
        ),
        ...capabilityEnvironment.frontend,
      }),
    },
  };
};

const stopChild = (child: ChildProcess | undefined): void => {
  if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
};

export const startAuthorityOpsProcesses = async (
  plan: AuthorityOpsStartPlan,
  options: { apiOnly?: boolean; viteOnly?: boolean } = {},
): Promise<number> => {
  if (options.apiOnly && options.viteOnly) {
    throw new Error("authority_ops_start_mode_conflict");
  }
  const children: ChildProcess[] = [];
  let api: ChildProcess | undefined;
  let vite: ChildProcess | undefined;
  if (!options.viteOnly) {
    api = spawn(plan.apiCommand.executable, plan.apiCommand.args, {
      cwd: plan.apiCommand.cwd,
      env: plan.apiEnvironment,
      stdio: "inherit",
      windowsHide: false,
    });
    children.push(api);
  }
  if (!options.apiOnly) {
    vite = spawn(plan.viteCommand.executable, plan.viteCommand.args, {
      cwd: plan.viteCommand.cwd,
      env: plan.viteEnvironment,
      stdio: "inherit",
      windowsHide: false,
    });
    children.push(vite);
  }
  const cleanup = () => {
    stopChild(api);
    stopChild(vite);
  };
  const onSignal = () => cleanup();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await new Promise<number>((resolve) => {
      let settled = false;
      for (const child of children) {
        child.once("error", () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(1);
        });
        child.once("exit", (code, signal) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(code ?? (signal ? 1 : 0));
        });
      }
    });
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    cleanup();
  }
};

export const assertStartable = async (
  profilePath: string,
  options: {
    apiOnly?: boolean;
    viteOnly?: boolean;
    dryRun?: boolean;
    allowRepoPathsForTests?: boolean;
  } = {},
): Promise<AuthorityOpsStartPlan> => {
  const lock = readAuthorityOpsLockStatus(profilePath);
  if (lock.present && !options.dryRun) throw new Error("authority_ops_lock_held");
  const profile = readAuthorityOpsProfile(profilePath, options);
  await verifyAuthorityOpsProfile(profilePath, options);
  const checks: Array<Promise<boolean>> = [];
  if (!options.viteOnly) checks.push(portIsAvailable(profile.apiHost, profile.apiPort));
  if (!options.apiOnly) checks.push(portIsAvailable(profile.viteHost, profile.vitePort));
  const availability = await Promise.all(checks);
  if (availability.some((available) => !available)) {
    throw new Error("authority_ops_start_port_occupied");
  }
  return buildAuthorityOpsStartPlan(profile);
};

export const capabilityRegistrySummary = () =>
  AUTHORITY_OPS_CAPABILITIES.map((capability) => ({
    name: capability.name,
    backendEnvironmentVariable: capability.backendEnvironmentVariable,
    frontendEnvironmentVariable: "frontendEnvironmentVariable" in capability
      ? capability.frontendEnvironmentVariable
      : null,
    apiCapabilityField: capability.apiCapabilityField,
    authorityRequired: capability.authorityRequired,
  }));

export const describeManifestAtPath = (manifestPath: string) =>
  describeSqliteAuthorityManifest(readSqliteAuthorityManifest(manifestPath));

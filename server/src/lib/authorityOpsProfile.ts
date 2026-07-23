import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isPlainObject } from "./backup.js";
import {
  assertOutsideRepoUnlessAllowed,
  isInsidePath,
  pathsReferToSameLocation,
  repoRoot,
  resolvePathIdentity,
} from "./paths.js";
import {
  readSqliteAuthorityManifestDescriptor,
} from "./sqliteAuthorityCutover.js";
import {
  validateCapabilitySelection,
  type AuthorityOpsCapabilityName,
} from "./authorityOpsCapabilities.js";

export const AUTHORITY_OPS_PROFILE_SCHEMA_VERSION = 1 as const;
export type AuthorityOpsMode = "rehearsal" | "authoritative";

export interface AuthorityOpsProfile {
  schemaVersion: 1;
  mode: AuthorityOpsMode;
  activeDatabasePath: string;
  authorityManifestPath: string | null;
  sourceBackupPath: string | null;
  tokenFilePath: string;
  backupDirectory: string;
  apiHost: "127.0.0.1";
  apiPort: number;
  viteHost: "127.0.0.1" | "localhost";
  vitePort: number;
  enabledWriteCapabilities: AuthorityOpsCapabilityName[];
}

const PROFILE_FIELDS = new Set([
  "schemaVersion",
  "mode",
  "activeDatabasePath",
  "authorityManifestPath",
  "sourceBackupPath",
  "tokenFilePath",
  "backupDirectory",
  "apiHost",
  "apiPort",
  "viteHost",
  "vitePort",
  "enabledWriteCapabilities",
]);

const assertAbsolutePath = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(code);
  }
  return path.resolve(value);
};

const assertNullableAbsolutePath = (
  value: unknown,
  code: string,
): string | null => {
  if (value === null) return null;
  return assertAbsolutePath(value, code);
};

const assertPort = (value: unknown, code: string): number => {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(code);
  }
  return Number(value);
};

const assertExistingFile = (filePath: string, code: string): void => {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(code);
  }
};

const assertExistingDirectory = (directoryPath: string, code: string): void => {
  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    throw new Error(code);
  }
};

const assertOutsideRepo = (
  filePath: string,
  label: string,
  allowRepoPathsForTests: boolean,
): void =>
  assertOutsideRepoUnlessAllowed(
    resolvePathIdentity(filePath),
    allowRepoPathsForTests,
    label,
  );

const assertRuntimeDatabaseName = (databasePath: string): void => {
  const fileName = path.basename(databasePath).toLowerCase();
  if (
    !/\.(sqlite|sqlite3|db)$/.test(fileName) ||
    /(?:-wal|-shm)$/.test(fileName) ||
    /(?:backup|checkpoint|manifest|report|export|\.tmp|\.temp)/.test(fileName)
  ) {
    throw new Error("authority_profile_active_database_name_unsafe");
  }
};

const assertDistinctPaths = (
  entries: Array<{ value: string | null; code: string }>,
): void => {
  const present = entries.filter(
    (entry): entry is { value: string; code: string } => entry.value !== null,
  );
  for (let left = 0; left < present.length; left += 1) {
    for (let right = left + 1; right < present.length; right += 1) {
      if (pathsReferToSameLocation(present[left].value, present[right].value)) {
        throw new Error(present[right].code);
      }
    }
  }
};

const assertActiveIsNotManifestBackup = (
  activeDatabasePath: string,
  manifestPath: string,
): void => {
  const descriptor = readSqliteAuthorityManifestDescriptor(manifestPath);
  const immutableBackupPath = path.resolve(
    path.dirname(manifestPath),
    descriptor.backupFileName,
  );
  if (pathsReferToSameLocation(activeDatabasePath, immutableBackupPath)) {
    throw new Error("authority_profile_immutable_backup_selected_as_runtime");
  }
};

export const validateAuthorityOpsProfile = (
  value: unknown,
  profilePath: string,
  options: { allowRepoPathsForTests?: boolean } = {},
): AuthorityOpsProfile => {
  if (!isPlainObject(value)) throw new Error("authority_profile_invalid");
  if (Object.keys(value).some((field) => !PROFILE_FIELDS.has(field))) {
    throw new Error("authority_profile_unknown_field");
  }
  if (value.schemaVersion !== AUTHORITY_OPS_PROFILE_SCHEMA_VERSION) {
    throw new Error("authority_profile_schema_version_unsupported");
  }
  if (value.mode !== "rehearsal" && value.mode !== "authoritative") {
    throw new Error("authority_profile_mode_invalid");
  }
  const mode = value.mode;
  const activeDatabasePath = assertAbsolutePath(
    value.activeDatabasePath,
    "authority_profile_active_database_path_invalid",
  );
  const authorityManifestPath = assertNullableAbsolutePath(
    value.authorityManifestPath,
    "authority_profile_manifest_path_invalid",
  );
  const sourceBackupPath = assertNullableAbsolutePath(
    value.sourceBackupPath,
    "authority_profile_source_backup_path_invalid",
  );
  const tokenFilePath = assertAbsolutePath(
    value.tokenFilePath,
    "authority_profile_token_path_invalid",
  );
  const backupDirectory = assertAbsolutePath(
    value.backupDirectory,
    "authority_profile_backup_directory_invalid",
  );
  const resolvedProfilePath = assertAbsolutePath(
    profilePath,
    "authority_profile_path_invalid",
  );
  if (value.apiHost !== "127.0.0.1") {
    throw new Error("authority_profile_api_host_invalid");
  }
  if (value.viteHost !== "127.0.0.1" && value.viteHost !== "localhost") {
    throw new Error("authority_profile_vite_host_invalid");
  }
  const apiPort = assertPort(value.apiPort, "authority_profile_api_port_invalid");
  const vitePort = assertPort(
    value.vitePort,
    "authority_profile_vite_port_invalid",
  );
  if (apiPort === vitePort) throw new Error("authority_profile_ports_must_differ");
  if (!Array.isArray(value.enabledWriteCapabilities)) {
    throw new Error("authority_profile_capabilities_invalid");
  }
  const enabledWriteCapabilities = validateCapabilitySelection(
    value.enabledWriteCapabilities.map(String),
    mode,
  );

  const allowRepoPathsForTests = options.allowRepoPathsForTests === true;
  for (const [filePath, label] of [
    [resolvedProfilePath, "authority operations profile"],
    [activeDatabasePath, "active SQLite database"],
    [tokenFilePath, "token file"],
    [backupDirectory, "backup directory"],
    ...(authorityManifestPath
      ? ([[authorityManifestPath, "authority manifest"]] as const)
      : []),
    ...(sourceBackupPath
      ? ([[sourceBackupPath, "source backup"]] as const)
      : []),
  ] as const) {
    assertOutsideRepo(filePath, label, allowRepoPathsForTests);
  }

  assertExistingFile(
    activeDatabasePath,
    "authority_profile_active_database_missing",
  );
  assertExistingFile(tokenFilePath, "authority_profile_token_file_missing");
  assertExistingDirectory(
    backupDirectory,
    "authority_profile_backup_directory_missing",
  );
  if (sourceBackupPath) {
    assertExistingFile(sourceBackupPath, "authority_profile_source_backup_missing");
  }
  assertRuntimeDatabaseName(activeDatabasePath);
  if (
    isInsidePath(
      resolvePathIdentity(backupDirectory),
      resolvePathIdentity(activeDatabasePath),
    )
  ) {
    throw new Error("authority_profile_active_database_inside_backup_directory");
  }
  assertDistinctPaths([
    { value: activeDatabasePath, code: "authority_profile_database_path_alias" },
    { value: tokenFilePath, code: "authority_profile_token_path_alias" },
    { value: authorityManifestPath, code: "authority_profile_manifest_path_alias" },
    { value: sourceBackupPath, code: "authority_profile_source_backup_path_alias" },
  ]);

  if (mode === "authoritative") {
    if (!authorityManifestPath) {
      throw new Error("authority_profile_manifest_required");
    }
    assertExistingFile(
      authorityManifestPath,
      "authority_profile_manifest_missing",
    );
    assertActiveIsNotManifestBackup(activeDatabasePath, authorityManifestPath);
  } else if (authorityManifestPath !== null) {
    throw new Error("authority_profile_rehearsal_manifest_not_allowed");
  }

  return {
    schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
    mode,
    activeDatabasePath,
    authorityManifestPath,
    sourceBackupPath,
    tokenFilePath,
    backupDirectory,
    apiHost: value.apiHost,
    apiPort,
    viteHost: value.viteHost,
    vitePort,
    enabledWriteCapabilities,
  };
};

export const readAuthorityOpsProfile = (
  profilePath: string,
  options: { allowRepoPathsForTests?: boolean } = {},
): AuthorityOpsProfile => {
  const resolved = path.resolve(profilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  } catch {
    throw new Error("authority_profile_read_failed");
  }
  return validateAuthorityOpsProfile(parsed, resolved, options);
};

const timestampForFileName = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-");

const reserveUniquePath = (basePath: string): string => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = `${basePath}.${timestampForFileName()}${suffix}.bak`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("authority_profile_backup_name_exhausted");
};

export const writeAuthorityOpsProfileAtomic = (
  profilePath: string,
  profile: AuthorityOpsProfile,
  options: { replace?: boolean; allowRepoPathsForTests?: boolean } = {},
): { profilePath: string; previousProfilePath?: string } => {
  const resolved = path.resolve(profilePath);
  const validated = validateAuthorityOpsProfile(profile, resolved, options);
  const replace = options.replace === true;
  if (existsSync(resolved) && !replace) {
    throw new Error("authority_profile_already_exists");
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporaryPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  let previousProfilePath: string | undefined;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    if (existsSync(resolved)) {
      previousProfilePath = reserveUniquePath(resolved);
      copyFileSync(resolved, previousProfilePath, constants.COPYFILE_EXCL);
    }
    renameSync(temporaryPath, resolved);
    return { profilePath: resolved, ...(previousProfilePath ? { previousProfilePath } : {}) };
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
};

export const authorityOpsRepoRoot = repoRoot;

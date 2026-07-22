export type RepositoryBackend =
  | "dexie"
  | "http-readonly"
  | "http-sqlite-rehearsal"
  | "http-sqlite-authoritative";

const REPOSITORY_BACKEND_ENV_VAR = "VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND";
const DEFAULT_REPOSITORY_BACKEND: RepositoryBackend = "dexie";

const repositoryBackendValues = new Set<RepositoryBackend>([
  "dexie",
  "http-readonly",
  "http-sqlite-rehearsal",
  "http-sqlite-authoritative",
]);

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const resolveRepositoryBackend = (
  configuredBackend: string | undefined,
): RepositoryBackend => {
  const normalizedBackend = configuredBackend?.trim();
  if (!normalizedBackend) {
    return DEFAULT_REPOSITORY_BACKEND;
  }

  if (repositoryBackendValues.has(normalizedBackend as RepositoryBackend)) {
    return normalizedBackend as RepositoryBackend;
  }

  return DEFAULT_REPOSITORY_BACKEND;
};

export const getRepositoryBackend = (): RepositoryBackend =>
  resolveRepositoryBackend(getEnvValue(REPOSITORY_BACKEND_ENV_VAR));

export const isDexieRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "dexie";

export const isHttpReadonlyRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "http-readonly";

export const isSqliteAuthorityRehearsalBackend = (
  backend: RepositoryBackend = getRepositoryBackend(),
): boolean => backend === "http-sqlite-rehearsal";

export const isSqliteAuthoritativeBackend = (
  backend: RepositoryBackend = getRepositoryBackend(),
): boolean => backend === "http-sqlite-authoritative";

export const isSqliteAuthorityControlledBackend = (
  backend: RepositoryBackend = getRepositoryBackend(),
): boolean =>
  isSqliteAuthorityRehearsalBackend(backend) ||
  isSqliteAuthoritativeBackend(backend);

export const isHttpSelectedReadRepositoryBackend = (
  backend: RepositoryBackend = getRepositoryBackend(),
): boolean => backend !== "dexie";

export const repositoryBackendSupportsWrites = (
  backend: RepositoryBackend,
): boolean => backend === "dexie";

export const assertRepositoryBackendSupportsWrites = (
  backend: RepositoryBackend = getRepositoryBackend(),
): void => {
  if (!repositoryBackendSupportsWrites(backend)) {
    throw new Error("http_repository_backend_does_not_support_direct_writes");
  }
};

export type RepositoryBackend = "dexie" | "http-readonly" | "http-sqlite";

const REPOSITORY_BACKEND_ENV_VAR = "VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND";

const getEnvValue = (key: string): string | undefined => {
  const value = (import.meta.env as Record<string, string | undefined>)[key]?.trim();
  return value || undefined;
};

export const resolveRepositoryBackend = (
  configuredBackend: string | undefined,
): RepositoryBackend => {
  if (configuredBackend === "http-sqlite" || configuredBackend === "http-readonly") {
    return configuredBackend;
  }
  return "dexie";
};

export const getRepositoryBackend = (): RepositoryBackend =>
  resolveRepositoryBackend(getEnvValue(REPOSITORY_BACKEND_ENV_VAR));

export const isDexieRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "dexie";

export const isHttpReadonlyRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "http-readonly";

export const isLocalSqliteBackend = (
  backend: RepositoryBackend = getRepositoryBackend(),
): boolean => backend === "http-sqlite";

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

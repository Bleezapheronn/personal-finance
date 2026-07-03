export type RepositoryBackend = "dexie" | "http-readonly";

const REPOSITORY_BACKEND_ENV_VAR = "VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND";
const DEFAULT_REPOSITORY_BACKEND: RepositoryBackend = "dexie";

const repositoryBackendValues = new Set<RepositoryBackend>([
  "dexie",
  "http-readonly",
]);

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const getRepositoryBackend = (): RepositoryBackend => {
  const configuredBackend = getEnvValue(REPOSITORY_BACKEND_ENV_VAR);

  if (!configuredBackend) {
    return DEFAULT_REPOSITORY_BACKEND;
  }

  if (repositoryBackendValues.has(configuredBackend as RepositoryBackend)) {
    return configuredBackend as RepositoryBackend;
  }

  return DEFAULT_REPOSITORY_BACKEND;
};

export const isDexieRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "dexie";

export const isHttpReadonlyRepositoryBackend = (): boolean =>
  getRepositoryBackend() === "http-readonly";

export const assertRepositoryBackendSupportsWrites = (): void => {
  if (isHttpReadonlyRepositoryBackend()) {
    throw new Error("http_readonly_repository_backend_does_not_support_writes");
  }
};

import { readFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_CONFIG_VERSION = 1 as const;

export interface PersonalFinanceRuntimeConfig {
  version: 1;
  sqlitePath: string;
  tokenFilePath: string;
  apiHost: "127.0.0.1" | "localhost";
  apiPort: number;
  frontendHost: "127.0.0.1" | "localhost";
  frontendPort: number;
}

const isLoopbackHost = (value: unknown): value is "127.0.0.1" | "localhost" =>
  value === "127.0.0.1" || value === "localhost";

const isPort = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 65535;

const isAbsolutePath = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && path.isAbsolute(value);

export const readRuntimeConfig = (configPath: string): PersonalFinanceRuntimeConfig => {
  if (!path.isAbsolute(configPath)) throw new Error("runtime_config_path_invalid");

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error("runtime_config_unavailable");
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "sqlitePath",
          "tokenFilePath",
          "apiHost",
          "apiPort",
          "frontendHost",
          "frontendPort",
        ].includes(key),
    )
  ) {
    throw new Error("runtime_config_invalid");
  }

  const config = value as Record<string, unknown>;
  if (
    config.version !== RUNTIME_CONFIG_VERSION ||
    !isAbsolutePath(config.sqlitePath) ||
    !isAbsolutePath(config.tokenFilePath) ||
    !isLoopbackHost(config.apiHost) ||
    !isPort(config.apiPort) ||
    !isLoopbackHost(config.frontendHost) ||
    !isPort(config.frontendPort) ||
    config.apiPort === config.frontendPort
  ) {
    throw new Error("runtime_config_invalid");
  }

  return {
    version: RUNTIME_CONFIG_VERSION,
    sqlitePath: path.resolve(config.sqlitePath),
    tokenFilePath: path.resolve(config.tokenFilePath),
    apiHost: config.apiHost,
    apiPort: config.apiPort,
    frontendHost: config.frontendHost,
    frontendPort: config.frontendPort,
  };
};

export const runtimeConfigPathFromArgs = (argv: string[]): string => {
  if (argv.length !== 2 || argv[0] !== "--runtime-config") {
    throw new Error("runtime_config_argument_required");
  }
  return argv[1];
};

export const applyRuntimeConfigToApiEnvironment = (
  runtimeConfigPath: string,
  config: PersonalFinanceRuntimeConfig,
): void => {
  process.env.PERSONAL_FINANCE_RUNTIME_CONFIG_PATH = path.resolve(runtimeConfigPath);
  process.env.PORT = String(config.apiPort);
  process.env.PERSONAL_FINANCE_SQLITE_PATH = config.sqlitePath;
  process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH = config.tokenFilePath;
  process.env.PERSONAL_FINANCE_ADDITIONAL_ALLOWED_ORIGIN =
    `http://${config.frontendHost}:${config.frontendPort}`;
};

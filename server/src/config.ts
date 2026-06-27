export const SERVER_HOST = "127.0.0.1" as const;
export const DEFAULT_SERVER_PORT = 3147;

export const SERVICE_NAME = "personal-finance-local-api" as const;
export const SERVICE_MODE = "prototype" as const;

export const getServerPort = (): number => {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    return DEFAULT_SERVER_PORT;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsedPort;
};

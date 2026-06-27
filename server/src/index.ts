import Fastify from "fastify";
import {
  ALLOWED_ORIGINS,
  API_VERSION,
  getServerPort,
  READONLY_MODE,
  SERVER_HOST,
  SERVICE_MODE,
  SERVICE_NAME,
  TOKEN_HEADER_NAME,
} from "./config.js";
import { readOrCreateToken } from "./tokenStore.js";

const server = Fastify({
  logger: {
    level: "info",
  },
  disableRequestLogging: true,
});

const publicPaths = new Set(["/health"]);

server.addHook("onRequest", async (request, reply) => {
  if (publicPaths.has(request.url)) {
    return;
  }

  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    await reply.code(403).send({
      error: "forbidden_origin",
    });
    return;
  }

  const configuredToken = await readOrCreateToken();
  const requestToken = request.headers[TOKEN_HEADER_NAME];

  if (requestToken !== configuredToken) {
    return reply.code(401).send({
      error: "unauthorized",
    });
  }
});

server.get("/health", async () => {
  return {
    ok: true,
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
  };
});

server.get("/metadata", async () => {
  return {
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
    apiVersion: API_VERSION,
    readonly: READONLY_MODE,
  };
});

const start = async (): Promise<void> => {
  const port = getServerPort();
  await readOrCreateToken();

  await server.listen({
    host: SERVER_HOST,
    port,
  });

  server.log.info(
    `${SERVICE_NAME} ${SERVICE_MODE} listening on http://${SERVER_HOST}:${port}`,
  );
};

start().catch((error) => {
  server.log.error(error, "Failed to start local API server");
  process.exit(1);
});

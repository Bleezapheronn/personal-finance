import Fastify from "fastify";
import {
  getServerPort,
  SERVER_HOST,
  SERVICE_MODE,
  SERVICE_NAME,
} from "./config.js";

const server = Fastify({
  logger: {
    level: "info",
  },
});

server.get("/health", async () => {
  return {
    ok: true,
    service: SERVICE_NAME,
    mode: SERVICE_MODE,
  };
});

const start = async (): Promise<void> => {
  const port = getServerPort();

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

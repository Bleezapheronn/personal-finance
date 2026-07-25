import type { FastifyInstance } from "fastify";
import {
  ALLOWED_ORIGINS,
  TOKEN_HEADER_NAME,
} from "../config.js";
import { readOrCreateToken } from "../tokenStore.js";

const PUBLIC_PATHS = new Set(["/health"]);
const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
const CORS_ALLOW_HEADERS = `${TOKEN_HEADER_NAME}, content-type`;

export const registerLocalApiAuthentication = (server: FastifyInstance): void => {
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      await reply.code(403).send({ error: "forbidden_origin" });
      return;
    }

    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
      reply.header("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    }

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
      return;
    }

    if (PUBLIC_PATHS.has(request.url)) return;

    const configuredToken = await readOrCreateToken();
    if (request.headers[TOKEN_HEADER_NAME] !== configuredToken) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });
};

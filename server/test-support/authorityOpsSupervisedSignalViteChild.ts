import http from "node:http";
import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

const valueFor = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${flag}_required`);
  return value;
};
const port = Number(valueFor("--port"));
const runtime = path.resolve(valueFor("--runtime"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("authority_test_vite_signal_port_invalid");
}
requireDisposablePath(runtime, "authority_test_vite_signal_runtime_invalid");

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (request.method === "POST" && request.url === "/test-support/signal/inherited") {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigbreakListeners = process.listenerCount("SIGBREAK");
    process.emit("SIGINT");
    process.emit("SIGBREAK");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, sigintListeners, sigbreakListeners }));
    return;
  }
  response.writeHead(404);
  response.end();
});

process.once("SIGTERM", () => {
  server.close(() => process.exit(0));
});
server.listen({ host: "127.0.0.1", port });

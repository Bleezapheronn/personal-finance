import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateOwnedTestChild, waitForChildExit } from "./lib/authorityTestProcessWait.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-never-ready-vite-"));
const childSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-support", "authorityOpsNeverReadyViteChild.ts");
const tsx = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs");
const port = await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("port_unavailable"))); }); });
const child = spawn(process.execPath, [tsx, childSource, "--runtime", root], { windowsHide: true, stdio: "ignore", env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
try {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && child.exitCode === null) {
    const open = await new Promise<boolean>((resolve) => { const socket = net.connect(port, "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); });
    if (!open) break;
  }
  if (child.exitCode !== null || existsSync(path.join(root, "ready"))) throw new Error("never_ready_child_not_alive_or_created_marker");
  await terminateOwnedTestChild(child, "never_ready_child");
  if ((await waitForChildExit(child, "never_ready_child_exit", 1_000)) === null && child.signalCode === null) throw new Error("never_ready_child_exit_not_observed");
  console.log("Authority never-ready Vite child test: PASS");
} finally { await terminateOwnedTestChild(child, "never_ready_child_cleanup"); rmSync(root, { recursive: true, force: true }); }

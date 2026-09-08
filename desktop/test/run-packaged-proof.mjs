import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const installer = process.argv[2];
if (!installer || !path.isAbsolute(installer) || !existsSync(installer)) {
  throw new Error("usage: node desktop/test/run-packaged-proof.mjs <absolute-installer-path>");
}

const proofRoot = process.env.PF123_PROOF_ROOT
  ? path.resolve(process.env.PF123_PROOF_ROOT)
  : path.join(os.tmpdir(), `pf123-packaged-proof-${Date.now()}`);
if (path.basename(proofRoot).toLowerCase().startsWith("pf123-packaged-proof-") && existsSync(proofRoot)) {
  rmSync(proofRoot, { recursive: true, force: true });
}
mkdirSync(proofRoot, { recursive: true });
const profileRoot = path.join(proofRoot, "profile");
const installRoot = path.join(proofRoot, "installation");
mkdirSync(profileRoot, { recursive: true });

const listenPort = async () => {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
};
const apiPort = await listenPort();
const frontendPort = await listenPort();
const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..", "..");
const serverRequire = createRequire(path.join(repositoryRoot, "server", "package.json"));
const Database = serverRequire("better-sqlite3");
const sqlitePath = path.join(profileRoot, "personal-finance.sqlite");
const tokenPath = path.join(profileRoot, "local.token");
const database = new Database(sqlitePath);
database.exec(readFileSync(path.join(repositoryRoot, "server", "schema", "prototype-schema.sql"), "utf8"));
database.close();
writeFileSync(tokenPath, "pf123-disposable-token\n", { encoding: "utf8" });
writeFileSync(path.join(profileRoot, "runtime.json"), `${JSON.stringify({
  version: 1,
  sqlitePath,
  tokenFilePath: tokenPath,
  apiHost: "127.0.0.1",
  apiPort,
  frontendHost: "127.0.0.1",
  frontendPort,
}, null, 2)}\n`);

await new Promise((resolve, reject) => {
  const child = spawn(installer, ["/S", `/D=${installRoot}`], { stdio: "ignore", windowsHide: true });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`installer_exit_${code ?? "unknown"}`)));
});
const executable = path.join(installRoot, "Personal Finance.exe");
if (!existsSync(executable)) throw new Error("installed_executable_missing");
const resultPath = path.join(proofRoot, "proof-result.json");
await new Promise((resolve, reject) => {
  const child = spawn(executable, [`--pf-profile-root=${profileRoot}`], {
    env: {
      ...process.env,
      PF_INTERNAL_PACKAGING_PROOF: "true",
      PF_INTERNAL_PACKAGING_PROOF_RESULT: resultPath,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("packaged_proof_timeout"));
  }, 90_000);
  child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  child.once("exit", () => { clearTimeout(timeout); resolve(); });
});
if (!existsSync(resultPath)) throw new Error("packaged_proof_result_missing");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const expected = ["apiHealth", "sqliteRead", "staticUi", "windowLoaded", "nativeSqlite", "profileExternal", "cleanShutdown"];
if (expected.some((key) => result[key] !== true)) throw new Error("packaged_proof_failed");
console.log(JSON.stringify(Object.fromEntries(expected.map((key) => [key, result[key]]))));

import { spawnAuthorityOwnedChild, waitForAuthorityOwnedChildExit } from "./lib/authorityOwnedChild.js";

let checks = 0;
const check = (value: unknown, code: string) => {
  checks += 1;
  if (!value) throw new Error(code);
};

const normal = spawnAuthorityOwnedChild("api", {
  executable: process.execPath,
  args: ["-e", "process.exit(7)"],
  cwd: process.cwd(),
  env: process.env,
});
await normal.spawnReady;
const normalExit = await waitForAuthorityOwnedChildExit(normal, 1_000, "normal_timeout", "api_spawn_failed");
check(normalExit.code === 7 && normalExit.signal === null, "normal_exit_not_preserved");
normal.dispose();
check(normal.child.listenerCount("error") === 0 && normal.child.listenerCount("exit") === 0, "normal_listeners_not_removed");

const invalid = spawnAuthorityOwnedChild("vite", {
  executable: "definitely-not-a-real-authority-owned-child",
  args: [],
  cwd: process.cwd(),
  env: process.env,
});
let spawnCode = "";
try {
  await invalid.spawnReady;
} catch (error) {
  spawnCode = error instanceof Error ? error.message : "";
}
check(spawnCode === "vite_spawn_failed", "spawn_error_not_normalized");
let waitCode = "";
try {
  await waitForAuthorityOwnedChildExit(invalid, 1_000, "invalid_timeout", "vite_spawn_failed");
} catch (error) {
  waitCode = error instanceof Error ? error.message : "";
}
check(waitCode === "vite_spawn_failed", "spawn_error_wait_not_normalized");
invalid.dispose();
check(invalid.child.listenerCount("error") === 0 && invalid.child.listenerCount("exit") === 0, "spawn_error_listeners_not_removed");

console.log(`Authority owned-child tests: ${checks} passed, 0 failed`);

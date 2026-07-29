import { spawn } from "node:child_process";

const waitForCondition = async (
  stage: string,
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${stage}_timeout`);
};
const waitForExit = (child: ReturnType<typeof spawn>, timeoutMs: number) => {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wait_cleanup_timeout")), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("wait_cleanup_spawn_failed")); });
  });
};

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  windowsHide: true,
  stdio: "ignore",
});
let childExited = child.exitCode !== null;
child.once("exit", () => { childExited = true; });
try {
  let timedOut = false;
  try { await waitForCondition("deliberate_marker", () => false, 100); }
  catch (error) { timedOut = error instanceof Error && error.message === "deliberate_marker_timeout"; }
  if (!timedOut) throw new Error("missing_marker_did_not_time_out");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await waitForExit(child, 2_000);
}
if (!childExited) throw new Error("timed_out_fixture_not_cleaned");
console.log("Authority process wait timeout/cleanup test: PASS");

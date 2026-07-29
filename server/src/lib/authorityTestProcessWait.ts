import type { ChildProcess } from "node:child_process";

export const waitForChildExit = (
  child: ChildProcess,
  stage: string,
  timeoutMs = 30_000,
): Promise<number | null> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); child.removeListener("exit", onExit); child.removeListener("error", onError); callback(); };
    const onExit = (code: number | null) => finish(() => resolve(code));
    const onError = () => finish(() => reject(new Error(`${stage}_spawn_failed`)));
    const timer = setTimeout(() => finish(() => reject(new Error(`${stage}_timeout`))), timeoutMs);
    child.once("exit", onExit); child.once("error", onError);
  });
};

export const terminateOwnedTestChild = async (child: ChildProcess, stage: string): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try { await waitForChildExit(child, `${stage}_terminate`, 2_000); }
  catch { child.kill("SIGKILL"); await waitForChildExit(child, `${stage}_force_terminate`, 2_000).catch(() => undefined); }
};

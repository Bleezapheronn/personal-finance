import { spawn, type ChildProcess } from "node:child_process";

export type AuthorityOwnedChildKind = "api" | "vite";

export interface AuthorityOwnedChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

type AuthorityOwnedChildObservation =
  | { type: "exit"; exit: AuthorityOwnedChildExit }
  | { type: "spawn-error" };

export interface AuthorityOwnedChild {
  child: ChildProcess;
  spawnReady: Promise<void>;
  observation: Promise<AuthorityOwnedChildObservation>;
  spawnFailed(): boolean;
  dispose(): void;
}

export const childHasExited = (child: ChildProcess | undefined): boolean =>
  Boolean(child && (child.exitCode !== null || child.signalCode !== null));

export const spawnAuthorityOwnedChild = (
  kind: AuthorityOwnedChildKind,
  spec: { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv },
  onObservation?: (observation: AuthorityOwnedChildObservation) => void,
): AuthorityOwnedChild => {
  let child: ChildProcess;
  try {
    child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    throw new Error(`${kind}_spawn_failed`);
  }

  let failed = false;
  let resolveSpawn: (() => void) | undefined;
  let rejectSpawn: ((error: Error) => void) | undefined;
  let resolveObservation: ((value: AuthorityOwnedChildObservation) => void) | undefined;
  const spawnReady = new Promise<void>((resolve, reject) => {
    resolveSpawn = resolve;
    rejectSpawn = reject;
  });
  // The caller awaits this immediately. This also prevents a late spawn error
  // from becoming an unhandled rejection if startup cleanup wins the race.
  void spawnReady.catch(() => undefined);
  const observation = new Promise<AuthorityOwnedChildObservation>((resolve) => {
    resolveObservation = resolve;
  });
  let observed = false;
  const report = (value: AuthorityOwnedChildObservation) => {
    if (observed) return;
    observed = true;
    resolveObservation?.(value);
    onObservation?.(value);
  };
  const onSpawn = () => resolveSpawn?.();
  const onError = () => {
    failed = true;
    rejectSpawn?.(new Error(`${kind}_spawn_failed`));
    report({ type: "spawn-error" });
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    report({ type: "exit", exit: { code, signal } });
    child.removeListener("error", onError);
  };
  child.once("spawn", onSpawn);
  child.once("error", onError);
  child.once("exit", onExit);
  return {
    child,
    spawnReady,
    observation,
    spawnFailed: () => failed,
    dispose: () => {
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    },
  };
};

export const waitForAuthorityOwnedChildExit = async (
  owned: AuthorityOwnedChild,
  timeoutMs: number,
  timeoutCode: string,
  spawnCode: string,
): Promise<AuthorityOwnedChildExit> => {
  if (owned.spawnFailed()) throw new Error(spawnCode);
  if (childHasExited(owned.child)) {
    return { code: owned.child.exitCode, signal: owned.child.signalCode };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const observed = await Promise.race([
      owned.observation,
      new Promise<AuthorityOwnedChildObservation>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
      }),
    ]);
    if (observed.type === "spawn-error") throw new Error(spawnCode);
    return observed.exit;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

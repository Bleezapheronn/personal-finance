import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPlainObject } from "./backup.js";

export interface AuthorityOpsLockStatus {
  present: boolean;
  live: boolean | null;
  stale: boolean;
  command?: string;
  processId?: number;
  startedAt?: string;
}

const lockPathForProfile = (profilePath: string): string =>
  `${path.resolve(profilePath)}.lock`;

const processIsLive = (processId: number): boolean | null => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return null;
  }
};

export const readAuthorityOpsLockStatus = (
  profilePath: string,
): AuthorityOpsLockStatus => {
  const lockPath = lockPathForProfile(profilePath);
  if (!existsSync(lockPath)) return { present: false, live: null, stale: false };
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (
      !isPlainObject(parsed) ||
      !Number.isInteger(parsed.processId) ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.command !== "string" ||
      typeof parsed.startedAt !== "string"
    ) {
      return { present: true, live: null, stale: false };
    }
    const sameHost = parsed.hostname === os.hostname();
    const live = sameHost ? processIsLive(Number(parsed.processId)) : null;
    return {
      present: true,
      live,
      stale: sameHost && live === false,
      command: parsed.command,
      processId: Number(parsed.processId),
      startedAt: parsed.startedAt,
    };
  } catch {
    return { present: true, live: null, stale: false };
  }
};

export const acquireAuthorityOpsLock = (
  profilePath: string,
  command: string,
): (() => void) => {
  const lockPath = lockPathForProfile(profilePath);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const existing = readAuthorityOpsLockStatus(profilePath);
  if (existing.present) {
    throw new Error(existing.stale ? "authority_ops_lock_stale" : "authority_ops_lock_held");
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(lockPath, "wx");
    writeFileSync(
      descriptor,
      `${JSON.stringify({
        processId: process.pid,
        hostname: os.hostname(),
        command,
        startedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new Error(
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "authority_ops_lock_held"
        : "authority_ops_lock_acquisition_failed",
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (existsSync(lockPath)) unlinkSync(lockPath);
  };
};

import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireCheckpointAcceptanceFences } from "../src/lib/authorityOps.js";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

const valueFor = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${flag}_required`);
  return value;
};

const assertDisposable = (value: string): string => requireDisposablePath(value, "authority_test_fence_holder_not_disposable");

const files = ["--active", "--safety", "--candidate"].map((flag) =>
  assertDisposable(valueFor(flag)),
);
const marker = assertDisposable(valueFor("--marker"));
if (existsSync(marker)) throw new Error("authority_test_fence_marker_exists");

const release = acquireCheckpointAcceptanceFences(files);
let released = false;
const finish = () => {
  if (released) return;
  released = true;
  release();
  process.exit(0);
};

process.once("SIGTERM", finish);
process.once("SIGINT", finish);
writeFileSync(marker, "acceptance fences held\n", { flag: "wx" });
setInterval(() => undefined, 1_000);

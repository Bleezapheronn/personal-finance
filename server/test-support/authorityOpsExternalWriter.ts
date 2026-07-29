import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

const valueFor = (flag: string): string => {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${flag}_required`);
  return value;
};
const sqlitePath = path.resolve(valueFor("--sqlite"));
requireDisposablePath(sqlitePath, "authority_test_external_writer_not_disposable");
const name = valueFor("--name");
if (!/^external-disposable-[a-z0-9-]+$/.test(name)) {
  throw new Error("authority_test_external_writer_name_invalid");
}
const marker = process.argv.includes("--marker") ? path.resolve(valueFor("--marker")) : undefined;
const busyTimeout = process.argv.includes("--busy-timeout")
  ? Number(valueFor("--busy-timeout"))
  : 10_000;
if (
  !Number.isSafeInteger(busyTimeout) ||
  busyTimeout < 1 ||
  busyTimeout > 10_000
) {
  throw new Error("authority_test_external_writer_busy_timeout_invalid");
}
if (marker) {
  requireDisposablePath(marker, "authority_test_external_writer_marker_not_disposable");
  writeFileSync(`${marker}.attempting`, "attempting\n", { flag: "wx" });
}
const db = new Database(sqlitePath, { fileMustExist: true });
try {
  db.pragma(`busy_timeout = ${busyTimeout}`);
  db.prepare(
    "INSERT INTO recipients (name, isActive, createdAt, updatedAt) VALUES (?, 1, ?, ?)",
  ).run(name, "2026-07-27T00:00:00.000Z", "2026-07-27T00:00:00.000Z");
  if (marker) writeFileSync(`${marker}.committed`, "committed\n", { flag: "wx" });
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_BUSY"
  ) {
    process.exitCode = 75;
  } else {
    throw error;
  }
} finally {
  db.close();
}

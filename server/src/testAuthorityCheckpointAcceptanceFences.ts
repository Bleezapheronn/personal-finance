import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireCheckpointAcceptanceFences } from "./lib/authorityOps.js";
import {
  terminateOwnedTestChild,
  waitForChildExit,
} from "./lib/authorityTestProcessWait.js";

const root = mkdtempSync(
  path.join(os.tmpdir(), "pf-checkpoint-acceptance-fences-"),
);
const files = ["active.sqlite", "safety.sqlite", "candidate.sqlite"].map(
  (name) => path.join(root, name),
);
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.join(sourceDirectory, "..");
const tsx = path.join(
  serverDirectory,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const externalWriter = path.join(
  serverDirectory,
  "test-support",
  "authorityOpsExternalWriter.ts",
);
const fenceHolder = path.join(
  serverDirectory,
  "test-support",
  "authorityCheckpointFenceHolder.ts",
);
const schema = readFileSync(
  path.join(serverDirectory, "schema", "prototype-schema.sql"),
  "utf8",
);

const waitForMarker = async (marker: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!existsSync(marker)) {
    if (Date.now() >= deadline) throw new Error("fence_holder_ready_timeout");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const runWriter = async (
  file: string,
  name: string,
  marker: string,
): Promise<number | null> => {
  const child = spawn(
    process.execPath,
    [
      tsx,
      externalWriter,
      "--sqlite",
      file,
      "--name",
      name,
      "--marker",
      marker,
      "--busy-timeout",
      "100",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  return waitForChildExit(
    child,
    "checkpoint_acceptance_external_writer",
    5_000,
  );
};

try {
  for (const file of files) {
    const db = new Database(file);
    try {
      db.exec(schema);
    } finally {
      db.close();
    }
  }

  const release = acquireCheckpointAcceptanceFences(files);
  try {
    for (const [index, file] of files.entries()) {
      const marker = path.join(root, `blocked-${index}`);
      const exitCode = await runWriter(
        file,
        `external-disposable-blocked-${index}`,
        marker,
      );
      if (
        exitCode !== 75 ||
        !existsSync(`${marker}.attempting`) ||
        existsSync(`${marker}.committed`)
      ) {
        throw new Error("acceptance_fence_did_not_block_external_writer");
      }
    }
  } finally {
    release();
    release();
  }

  for (const [index, file] of files.entries()) {
    const marker = path.join(root, `released-${index}`);
    if (
      (await runWriter(
        file,
        `external-disposable-released-${index}`,
        marker,
      )) !== 0 ||
      !existsSync(`${marker}.committed`)
    ) {
      throw new Error("acceptance_fence_release_failed");
    }
    const db = new Database(file);
    try {
      const count = (
        db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as {
          count: number;
        }
      ).count;
      if (count !== 1) throw new Error("acceptance_fence_release_failed");
    } finally {
      db.close();
    }
  }

  let partialAcquisitionFailed = false;
  try {
    acquireCheckpointAcceptanceFences([
      files[0],
      path.join(root, "missing.sqlite"),
    ]);
  } catch (error) {
    partialAcquisitionFailed =
      error instanceof Error &&
      error.message === "checkpoint_acceptance_fence_failed";
  }
  const partialMarker = path.join(root, "partial-acquisition-cleanup");
  if (
    !partialAcquisitionFailed ||
    (await runWriter(
      files[0],
      "external-disposable-partial-cleanup",
      partialMarker,
    )) !== 0
  ) {
    throw new Error("acceptance_fence_partial_acquisition_cleanup_failed");
  }

  const holderMarker = path.join(root, "holder-ready");
  const holder = spawn(
    process.execPath,
    [
      tsx,
      fenceHolder,
      "--active",
      files[0],
      "--safety",
      files[1],
      "--candidate",
      files[2],
      "--marker",
      holderMarker,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  try {
    await waitForMarker(holderMarker);
    await terminateOwnedTestChild(
      holder,
      "checkpoint_acceptance_fence_holder",
    );
    if (holder.exitCode !== 0 && holder.signalCode === null) {
      throw new Error("acceptance_fence_holder_interruption_failed");
    }
  } finally {
    await terminateOwnedTestChild(
      holder,
      "checkpoint_acceptance_fence_holder_cleanup",
    );
  }

  for (const [index, file] of files.entries()) {
    const marker = path.join(root, `interrupted-${index}`);
    if (
      (await runWriter(
        file,
        `external-disposable-interrupted-${index}`,
        marker,
      )) !== 0
    ) {
      throw new Error("acceptance_fence_interruption_cleanup_failed");
    }
  }
  console.log(
    "Authority checkpoint acceptance fence tests: PASS",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

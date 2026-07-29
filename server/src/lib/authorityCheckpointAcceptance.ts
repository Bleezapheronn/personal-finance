import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const CHECKPOINT_ACCEPTANCE_JOURNAL_VERSION = 1 as const;
export const checkpointAcceptanceJournalPath = (profilePath: string): string =>
  `${path.resolve(profilePath)}.acceptance-journal.json`;

export interface CheckpointAcceptanceJournal {
  version: typeof CHECKPOINT_ACCEPTANCE_JOURNAL_VERSION;
  operationId: string;
  state: "prepared";
  priorProfileHash: string;
  proposedProfileHash: string;
  priorCheckpointId: string;
  priorCheckpointSequence: number;
  proposedCheckpointId: string;
  proposedCheckpointSequence: number;
}

const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export const readCheckpointAcceptanceJournal = (
  profilePath: string,
): CheckpointAcceptanceJournal => {
  let value: unknown;
  try {
    value = JSON.parse(
      readFileSync(checkpointAcceptanceJournalPath(profilePath), "utf8"),
    ) as unknown;
  } catch {
    throw new Error("checkpoint_acceptance_journal_invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) throw new Error("checkpoint_acceptance_journal_invalid");
  const journal = value as Partial<CheckpointAcceptanceJournal>;
  const fields = new Set([
    "version",
    "operationId",
    "state",
    "priorProfileHash",
    "proposedProfileHash",
    "priorCheckpointId",
    "priorCheckpointSequence",
    "proposedCheckpointId",
    "proposedCheckpointSequence",
  ]);
  if (
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((field) => !fields.has(field)) ||
    journal.version !== CHECKPOINT_ACCEPTANCE_JOURNAL_VERSION ||
    journal.state !== "prepared" ||
    typeof journal.operationId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(journal.operationId) ||
    !isHash(journal.priorProfileHash) ||
    !isHash(journal.proposedProfileHash) ||
    typeof journal.priorCheckpointId !== "string" ||
    typeof journal.proposedCheckpointId !== "string" ||
    !Number.isInteger(journal.priorCheckpointSequence) ||
    !Number.isInteger(journal.proposedCheckpointSequence) ||
    Number(journal.priorCheckpointSequence) < 0 ||
    journal.proposedCheckpointSequence !==
      Number(journal.priorCheckpointSequence) + 1
  ) throw new Error("checkpoint_acceptance_journal_invalid");
  return journal as CheckpointAcceptanceJournal;
};

const flushDirectoryWhereSupported = (directory: string): void => {
  let handle: number | undefined;
  try {
    handle = openSync(directory, "r");
    fsyncSync(handle);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== "win32" ||
      !["EACCES", "EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      throw error;
    }
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
};

export const installCheckpointAcceptanceJournal = (
  profilePath: string,
  record: Omit<CheckpointAcceptanceJournal, "version" | "operationId" | "state">,
): CheckpointAcceptanceJournal => {
  const journalPath = checkpointAcceptanceJournalPath(profilePath);
  const temporary = `${journalPath}.tmp-${process.pid}-${Date.now()}`;
  const journal: CheckpointAcceptanceJournal = {
    version: CHECKPOINT_ACCEPTANCE_JOURNAL_VERSION,
    operationId: randomUUID(),
    state: "prepared",
    ...record,
  };
  let handle: number | undefined;
  try {
    handle = openSync(temporary, "wx");
    writeFileSync(handle, `${JSON.stringify(journal)}\n`, "utf8");
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, journalPath);
    const installed = readCheckpointAcceptanceJournal(profilePath);
    if (JSON.stringify(installed) !== JSON.stringify(journal)) {
      throw new Error("checkpoint_acceptance_journal_invalid");
    }
    flushDirectoryWhereSupported(path.dirname(journalPath));
    return journal;
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* preserve category */ }
    if (
      error instanceof Error &&
      error.message === "checkpoint_acceptance_journal_invalid"
    ) throw error;
    throw new Error("checkpoint_acceptance_journal_create_failed");
  }
};

export const removeCheckpointAcceptanceJournal = (
  profilePath: string,
): void => {
  const journalPath = checkpointAcceptanceJournalPath(profilePath);
  try {
    if (existsSync(journalPath)) unlinkSync(journalPath);
    if (existsSync(journalPath)) {
      throw new Error("checkpoint_acceptance_journal_cleanup_failed");
    }
    flushDirectoryWhereSupported(path.dirname(journalPath));
  } catch {
    throw new Error("checkpoint_acceptance_journal_cleanup_failed");
  }
};

export const assertNoCheckpointAcceptanceJournal = (
  profilePath: string,
): void => {
  if (!existsSync(checkpointAcceptanceJournalPath(profilePath))) return;
  readCheckpointAcceptanceJournal(profilePath);
  throw new Error("checkpoint_profile_restore_failed");
};

/**
 * Acquires SQLite RESERVED writer locks in caller-supplied deterministic order.
 * These connections never write application data. Release rolls every
 * transaction back and closes connections in reverse order.
 */
export const acquireCheckpointAcceptanceFences = (
  databasePaths: readonly string[],
): (() => void) => {
  const owned: Database.Database[] = [];
  const releaseOwned = () => {
    for (const db of [...owned].reverse()) {
      try {
        if (db.inTransaction) db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    }
    owned.length = 0;
  };
  try {
    for (const databasePath of databasePaths) {
      const db = new Database(databasePath, { fileMustExist: true });
      try {
        db.pragma("busy_timeout = 5000");
        db.exec("BEGIN IMMEDIATE");
        owned.push(db);
      } catch {
        db.close();
        throw new Error("checkpoint_acceptance_fence_failed");
      }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseOwned();
    };
  } catch {
    releaseOwned();
    throw new Error("checkpoint_acceptance_fence_failed");
  }
};

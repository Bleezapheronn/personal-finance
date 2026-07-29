import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertNoCheckpointAcceptanceJournal,
  checkpointAcceptanceJournalPath,
  installCheckpointAcceptanceJournal,
  readCheckpointAcceptanceJournal,
  removeCheckpointAcceptanceJournal,
} from "./lib/authorityCheckpointAcceptance.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-acceptance-journal-"));
const profilePath = path.join(root, "authority-profile.json");
const record = {
  priorProfileHash: "a".repeat(64),
  proposedProfileHash: "b".repeat(64),
  priorCheckpointId: "checkpoint-prior",
  priorCheckpointSequence: 4,
  proposedCheckpointId: "checkpoint-proposed",
  proposedCheckpointSequence: 5,
};
try {
  const installed = installCheckpointAcceptanceJournal(profilePath, record);
  const journalPath = checkpointAcceptanceJournalPath(profilePath);
  if (!existsSync(journalPath)) throw new Error("journal_not_installed");
  const read = readCheckpointAcceptanceJournal(profilePath);
  if (
    read.operationId !== installed.operationId ||
    read.priorProfileHash !== record.priorProfileHash ||
    read.proposedCheckpointSequence !== 5
  ) throw new Error("journal_roundtrip_failed");
  let blocked = false;
  try { assertNoCheckpointAcceptanceJournal(profilePath); }
  catch (error) {
    blocked = error instanceof Error &&
      error.message === "checkpoint_profile_restore_failed";
  }
  if (!blocked) throw new Error("installed_journal_did_not_block");
  removeCheckpointAcceptanceJournal(profilePath);
  removeCheckpointAcceptanceJournal(profilePath);
  if (existsSync(journalPath)) throw new Error("journal_cleanup_not_idempotent");

  writeFileSync(journalPath, "{}", { encoding: "utf8", flag: "wx" });
  let corruptBlocked = false;
  try { assertNoCheckpointAcceptanceJournal(profilePath); }
  catch (error) {
    corruptBlocked = error instanceof Error &&
      error.message === "checkpoint_acceptance_journal_invalid";
  }
  if (!corruptBlocked) throw new Error("corrupt_journal_not_rejected");
  rmSync(journalPath);

  mkdirSync(journalPath);
  let unreadableBlocked = false;
  try { assertNoCheckpointAcceptanceJournal(profilePath); }
  catch (error) {
    unreadableBlocked = error instanceof Error &&
      error.message === "checkpoint_acceptance_journal_invalid";
  }
  if (!unreadableBlocked) throw new Error("unreadable_journal_not_rejected");
  rmSync(journalPath, { recursive: true, force: true });

  let creationFailed = false;
  try {
    installCheckpointAcceptanceJournal(
      path.join(root, "missing-parent", "profile.json"),
      record,
    );
  } catch (error) {
    creationFailed = error instanceof Error &&
      error.message === "checkpoint_acceptance_journal_create_failed";
  }
  if (!creationFailed) throw new Error("journal_creation_failure_not_stable");
  console.log("Authority checkpoint acceptance journal tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}

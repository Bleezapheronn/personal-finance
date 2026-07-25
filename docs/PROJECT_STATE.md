# Project State

Updated: 2026-07-26

## Authority

The local SQLite API is authoritative for the current main application runtime.
The live authority profile and SQLite database are operational assets outside
this repository. Dexie/IndexedDB remains as a legacy compatibility path and
must not receive new authoritative writes.

SQLite is still a local, controlled runtime. It is not a reason to expose the
API to a network or to treat browser tokens as production credentials.

## Operating workflow

Use the documented profile-specific launcher outside Git. Before starting an
authoritative runtime, verify its profile and checkpoint lineage with the
authority operations `status`, `verify`, and `start --dry-run` commands.

Stop the runtime cleanly before checkpointing. Confirm the authority lock and
SQLite WAL/SHM files are absent before backup, restore, or rotation operations.
Create a fresh verified checkpoint before operational changes. Use disposable
copies for acceptance tests and never open a checkpoint backup as a writable
runtime.

## Current safety model

- Mutations are authenticated, capability-gated, dry-run-first, explicitly confirmed, and exact-targeted.
- Atomic operations must preserve transaction, transfer, budget, and snapshot invariants.
- Budget snapshot generation, pruning, repair, and direction/sign changes remain deliberate lifecycle operations.
- Focused tests are preferred; unrelated refactors and broad data audits are out of scope for ordinary changes.
- Generated databases, backups, manifests, reports, logs, tokens, and financial rows stay outside Git.

## Migration completion definition

The SQLite migration is operationally complete when the authoritative profile,
checkpoint workflow, main-app reads, supported writes, lifecycle operations,
focused tests, safety checks, and accepted browser workflows are all verified
against disposable fixtures or the explicitly approved live checkpoint process.
SQLite authority does not authorize unreviewed new mutation paths.

## Known legacy remnants

Dexie imports, compatibility repository paths, legacy schema fields, and
historical migration terminology may remain in the codebase. They are not
evidence that Dexie is authoritative. New work must use SQLite authority
contracts and must not silently fall back to Dexie for an authoritative write.

## Deferred work

- Verified automatic SQLite backups are operational. Destination and daily time are configurable in Settings, and Windows Task Scheduler runs the standalone worker while the app is closed.
- Retention keeps one verified daily backup for the latest 30 days and one verified monthly backup thereafter. Authority checkpoints remain separate and are never pruned.
- Backups are plain SQLite and are not encrypted. OneDrive manages cloud synchronization; the app does not verify cloud sync.
- Restore has been verified to a disposable database. Automatic live restore remains out of scope.
- Budget model, direction, and sign semantics remain deferred unless separately approved.
- Future Dexie retirement requires a separate plan, compatibility review, and rollback strategy.

## Data handling

Do not place secrets, tokens, financial rows, backup contents, generated
databases, manifests, reports, or logs in the repository or documentation.
Use safe summaries and aggregate counts when documenting verification.

## Related documentation

- `docs/sqlite-main-app-feature-parity-final-report.md` is a historical migration report, not the living project state.
- `docs/local-api-frontend-adapter-notes.md` covers local API and frontend adapter experiments.
- `docs/selected-read-migration-readiness-audit.md` covers selected-read migration gates.

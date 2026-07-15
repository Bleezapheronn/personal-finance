# Recipients Real-Write Readiness Gate

This is a documentation-only gate for any future Recipients real-write
endpoint. It does not implement write endpoints, repository write adapters,
server mutation handlers, UI wiring, Dexie writes, SQLite writes, dual-write,
background sync, delete dry-runs, merge dry-runs, or selected-read behavior.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. The
implemented Recipients dry-run endpoints are validation-only and do not
authorize real writes.

Since this gate was written, recipient activate and deactivate have been
implemented as disabled-by-default, SQLite-only experiments behind separate
approved implementation slices. This gate remains the boundary for create,
update, delete, merge, and any additional real write.

Baseline tag: `recipients-basic-dry-run-review-baseline`

## Current Boundary

Implemented no-mutation dry-run endpoints:

- `POST /prototype/repositories/recipients/dry-run/create`
- `POST /prototype/repositories/recipients/dry-run/update`
- `POST /prototype/repositories/recipients/dry-run/activate`
- `POST /prototype/repositories/recipients/dry-run/deactivate`

These endpoints can validate and summarize proposed changes. They must not be
treated as approval for any endpoint that creates, updates, activates,
deactivates, deletes, merges, syncs, or otherwise mutates data.

Any real write endpoint requires a separate approved implementation plan. Real
writes must start with one operation only, not a batch of operations.

## Required Decisions Before The First Real Write

Before any Recipients real-write endpoint is implemented, these decisions must
be written down and approved:

- Source of truth for the write:
  Whether Dexie remains the only real writer, SQLite becomes an experimental
  write target, or a later authority migration is being proposed.
- SQLite authority boundary:
  Whether a SQLite write is disposable experiment output only or an
  authority-changing step. The default assumption remains disposable.
- Dexie writer boundary:
  Whether normal app writes still happen only through Dexie and whether any
  HTTP write result is ever reflected back into Dexie.
- Rollback strategy:
  How to disable the experiment, restore data, discard disposable SQLite state,
  and identify any partial write.
- Backup-before-write requirement:
  Which fresh full backup must exist before running the write.
- Restore rehearsal requirement:
  How restore has been tested before the first write attempt.
- Audit and logging approach:
  What operation metadata is recorded without exposing recipient names, aliases,
  emails, phone numbers, till numbers, paybill values, account numbers,
  descriptions, token values, or paths.
- Validation source of truth:
  Whether the real write validates against current Dexie, disposable SQLite, or
  both, and how stale SQLite is detected.
- Timestamp behavior:
  Whether the write preserves current Dexie behavior or intentionally changes
  it. Activate/deactivate currently change only `isActive` and do not refresh
  `updatedAt`.
- ID generation strategy:
  Whether IDs remain Dexie-generated, SQLite-generated, reserved by an API, or
  supplied by the caller.
- Duplicate behavior:
  Exact name, phone, paybill/account, alias, and till-number behavior. The
  current till-number duplicate ambiguity must be settled or explicitly
  preserved before create/update writes.
- User confirmation behavior:
  Which user action authorizes the write and what confirmation is required for
  each operation.
- Error handling and retry behavior:
  How validation failures, server failures, retries, and partial failures are
  surfaced without automatic hidden mutation.

## Hard Gates Before Any Real Recipient Write Endpoint

All gates must pass before implementation starts:

- A fresh full app backup is exported.
- Restore path from that backup is verified.
- A disposable SQLite database is imported from the fresh backup.
- `verify:sqlite` passes with backup/sqlite arguments.
- `smoke:api` passes with token/token-file arguments.
- Recipients read diagnostic passes against the fresh matching baseline.
- Create/update/activate/deactivate dry-run smoke tests pass.
- The no-mutation dry-run implementation review remains current.
- An explicit operation-specific real-write plan exists.
- Explicit rollback instructions exist.
- User approval is recorded before implementation.

If any gate is stale, unknown, or skipped, no real write endpoint should be
added.

## Operation Order

Allowed order for future consideration:

1. Activate/deactivate real write:
   First candidate because it changes one boolean and current Dexie behavior
   does not touch `updatedAt`. This still requires an operation-specific plan,
   backup, rollback, and verification.
2. Create real write:
   Only after ID generation, timestamp behavior, validation source of truth,
   and duplicate behavior are locked.
3. Update real write:
   Only after duplicate behavior, alias behavior, and the till-number ambiguity
   are settled.

Deferred:

- Delete remains deferred until transaction-reference usage checks and rollback
  behavior are designed.
- Merge remains deferred until a transaction-reference mutation design exists.

## Not Allowed Yet

- No delete real write.
- No merge real write.
- No transaction recipient-reference mutation.
- No dual-write.
- No background sync.
- No frontend write adapter.
- No UI integration.
- No permanent SQLite authority switch.
- No writes without backup and rollback rehearsal.
- No batch operation that combines create, update, activate, deactivate,
  delete, or merge.
- No production or local-network exposure assumption based on the current local
  token prototype.

## Minimum Verification For A Future Real Write

Each future operation-specific plan must include at least:

- capture pre-write row count
- capture pre-write safe fingerprint
- record the matching dry-run result first
- perform the real write once
- capture post-write row count
- capture post-write safe fingerprint
- verify the expected single-row delta only
- verify the read endpoint reflects the expected change
- verify Dexie app behavior remains unchanged unless explicitly in scope
- verify restore rollback path
- verify no token, path, recipient names, aliases, contact values, descriptions,
  transaction descriptions, or raw rows appear in logs or reports

The verification artifact, if any, must remain outside Git.

## Explicit Non-Approval Statement

Passing dry-run smoke tests, passing `verify:sqlite`, and having this readiness
gate documented are not real-write approval. They are prerequisites for a later
operation-specific implementation plan. A real write endpoint may be added only
after that separate plan is approved.

Operation-specific planning for the first candidate active-state write is in
[recipients-active-state-real-write-plan.md](recipients-active-state-real-write-plan.md).
That document now records the implemented, flag-gated recipient activate and
deactivate endpoints. Create, update, delete, merge, frontend write adapters,
dual-write, and SQLite authority migration remain unapproved.

The implementation review for the completed activate slice is in
[recipient-activate-real-write-implementation-review.md](recipient-activate-real-write-implementation-review.md).

The implementation review for the completed activate/deactivate pair is in
[recipients-active-state-real-write-implementation-review.md](recipients-active-state-real-write-implementation-review.md).

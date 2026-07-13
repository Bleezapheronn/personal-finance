# Recipients Active-State Real-Write Plan

This is the operation-specific plan and status note for the first Recipients
real-write experiment. The first approved implementation slice added recipient
activate, and the second approved implementation slice added recipient
deactivate. It does not implement repository write adapters, UI wiring, Dexie
writes, dual-write, background sync, delete, merge, create writes, update
writes, or selected-read behavior.

Dexie / IndexedDB remains authoritative today. SQLite remains disposable until
a later authority decision is explicitly approved. The implemented activate
write is experimental, local-only, and limited to a disposable SQLite
database.

Baseline tag: `recipients-real-write-readiness-baseline`

Implementation review:
[recipient-activate-real-write-implementation-review.md](recipient-activate-real-write-implementation-review.md)

## Current Boundary

Implemented no-mutation dry-run endpoints:

- `POST /prototype/repositories/recipients/dry-run/activate`
- `POST /prototype/repositories/recipients/dry-run/deactivate`

Implemented experimental real-write endpoints:

- `POST /prototype/repositories/recipients/write/activate`
- `POST /prototype/repositories/recipients/write/deactivate`

The active-state write endpoints are disabled by default behind
`PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true`. They mutate only
disposable SQLite, update only `recipients.isActive`, and do not update
`updatedAt`.

The dry-run endpoints must be called and must pass before any future real
active-state write. A passing dry-run is a prerequisite, not general write
approval.

Future real write endpoints must still handle one operation at a time. Do not
batch activate and deactivate together, and do not combine active-state writes
with create, update, delete, merge, import, sync, or UI wiring.

## Active-State Routes

Current implementation status:

- `POST /prototype/repositories/recipients/write/activate`: implemented as an
  experimental, flag-gated, SQLite-only endpoint.
- `POST /prototype/repositories/recipients/write/deactivate`: implemented as
  an experimental, flag-gated, SQLite-only endpoint.

The implemented active-state routes are protected by the existing token
middleware and origin guard. Browser preflight follows the existing CORS rules,
but actual `POST` requests require the token.

## Implemented Activate Request Shape

Required:

- `id`: positive integer recipient ID
- `expectedIsActive: false`: the caller must assert that the recipient is
  currently inactive before activation
- `dryRunReviewed: true`: the caller must explicitly state that the matching
  dry-run result was reviewed
- `confirmation: "activate recipient in disposable sqlite"`: fixed
  confirmation phrase proving this is the intentional disposable SQLite write
  path

Rejected:

- recipient names
- aliases
- email addresses
- phone numbers
- till numbers
- paybill values
- account numbers
- descriptions
- timestamps
- transaction fields
- delete or merge hints
- raw rows
- arbitrary fields

No name or contact value is required for an active-state change.

Future create, update, delete, and merge writes are not covered by this request
shape and require separate approved implementation slices.

## Implemented Deactivate Request Shape

Required:

- `id`: positive integer recipient ID
- `expectedIsActive: true`: the caller must assert that the recipient is
  currently active before deactivation
- `dryRunReviewed: true`: the caller must explicitly state that the matching
  dry-run result was reviewed
- `confirmation: "deactivate recipient in disposable sqlite"`: fixed
  confirmation phrase proving this is the intentional disposable SQLite write
  path

The same sensitive fields and arbitrary fields rejected by activate are also
rejected by deactivate. No name or contact value is required for an active-state
change.

Future create, update, delete, and merge writes are not covered by this request
shape and require separate approved implementation slices.

## Validation Behavior

The implemented activate endpoint fails safely for:

- missing ID: `id_required`
- malformed, non-integer, or non-positive ID: `id_invalid`
- target recipient not found: `recipient_not_found`
- missing or non-false `expectedIsActive`: `expected_is_active_false_required`
- missing `dryRunReviewed: true`: `dry_run_reviewed_required`
- missing or non-matching confirmation phrase: `matching_dry_run_required`
- activate no-op when already active: `recipient_already_active`
- unexpected payload field: `unexpected_payload_field`
- unsupported action hint: `unsupported_first_write_action`

No-op behavior is explicit. Already-active activate requests do not write to
SQLite, return `rowsChanged: 0`, and include the `recipient_already_active`
warning/result code.

The implemented deactivate endpoint fails safely for the same common cases,
with `expected_is_active_true_required` when `expectedIsActive` is missing or
not true. Already-inactive deactivate requests do not write to SQLite, return
`rowsChanged: 0`, and include the `recipient_already_inactive` warning/result
code.

## Timestamp Behavior

Current Dexie behavior:

- activate/deactivate changes only `isActive`
- activate/deactivate does not explicitly refresh `updatedAt`

Implemented active-state SQLite write behavior:

- match current Dexie behavior exactly
- update only `recipients.isActive`
- leave `createdAt` unchanged
- leave `updatedAt` unchanged

Changing timestamp semantics would require a separate explicit decision before
implementation. Do not silently "improve" active-state timestamps in the first
real write.

## Source-Of-Truth Boundary

The implemented activate and deactivate endpoints mutate only disposable
SQLite. They must not claim to be the app's real write path.

Required boundaries:

- Dexie remains authoritative.
- Frontend app behavior remains Dexie-only unless a later separate UI/write
  adapter plan is approved.
- No Dexie mutation.
- No dual-write.
- No sync back to Dexie.
- No background reconciliation.
- No permanent SQLite authority switch.
- No production or local-network exposure assumption.

Because SQLite is disposable, rollback primarily means deleting/re-importing
the disposable SQLite database from a fresh backup, not trusting a reverse
mutation as the recovery path.

## Write Transaction Requirements

The implemented active-state writes are constrained to:

- one recipient row
- one column: `recipients.isActive`
- a deterministic target by primary key
- no transaction recipient-reference mutation
- no delete or merge behavior
- no changes to recipient names
- no changes to contact fields
- no changes to aliases
- no changes to descriptions
- no changes to `createdAt`
- no changes to `updatedAt`
- no file writes
- no schema creation or migration

The implementation verifies exactly one expected row changed for a real state
transition. For an explicit no-op, it reports zero rows changed.

The normal shared SQLite helpers remain read-only. The activate implementation
uses a deliberately named, narrowly used write-opening path and does not weaken
existing read-only helpers. Future write implementations must preserve that
separation.

## Response Shape

Responses must be redacted and summary-only.

Required fields:

- `ok`
- `mode: "prototype"`
- `action: "activate"` or `"deactivate"`
- `dryRunRequired: true`
- `realWrite: true`
- `sqliteMutated`
- `rowsChanged`
- `targetIdPresent`
- `targetId`
- `previousStateSummary`
- `newStateSummary`
- `timestampBehavior`
- `validationErrors`
- `warnings`
- `safety`
- `resultCodes`

Suggested safe summaries:

```json
{
  "previousStateSummary": {
    "isActive": true
  },
  "newStateSummary": {
    "isActive": false
  },
  "timestampBehavior": {
    "createdAtWouldChange": false,
    "updatedAtWouldChange": false,
    "updatedAtPreservedByCurrentToggleBehavior": true
  },
  "safety": {
    "dexieMutated": false,
    "transactionReferencesMutated": false,
    "rawRowsIncluded": false,
    "filesWritten": false
  }
}
```

Forbidden response detail:

- raw recipient rows
- names
- aliases
- email addresses
- phone numbers
- till numbers
- paybill values
- account numbers
- descriptions
- transaction rows
- transaction descriptions or references
- token values
- SQLite paths
- backup paths
- log file paths

## Rollback Requirements

Before testing any future endpoint:

- export a fresh full backup
- verify or rehearse restore from that backup
- import a disposable SQLite database from that backup
- keep the SQLite file outside Git
- keep any verification reports outside Git

Primary rollback:

- stop the local API
- delete the disposable SQLite database
- re-import from the fresh backup
- restart the API against the re-imported database
- rerun `verify:sqlite` and `smoke:api`

Reverse mutation may be useful for debugging, but it must not be the primary
rollback strategy. No real-write test should run against an un-backed-up or
trusted production-like SQLite file.

## Additional Active-State Implementation Gates

These gates remain required before any additional recipient write
implementation, including create, update, delete, or merge:

- fresh full backup exported
- restore path verified or rehearsed
- disposable SQLite imported from the fresh backup
- `verify:sqlite` passes with backup/sqlite arguments
- `smoke:api` passes with token/token-file arguments
- Recipients read diagnostic passes against the fresh matching baseline
- active-state dry-run smoke tests pass
- matching dry-run request and redacted response are captured for the target
  operation
- `npm run check:local-api-safety` passes
- `npm run check:no-runtime-artifacts` passes
- operation-specific rollback instructions are written
- explicit user approval is recorded before endpoint implementation

If any gate is stale, skipped, or unknown, implementation must not start.

## Smoke Tests

Implemented active-state smoke coverage includes:

- unauthorized write requests fail
- bad origin fails
- missing ID fails safely
- malformed ID fails safely
- unknown ID fails safely
- no-op activate/deactivate behavior is explicit
- missing or wrong `expectedIsActive` fails safely
- dry-run-required gate fails when not satisfied
- one successful activate changes exactly one SQLite row
- one successful deactivate changes exactly one SQLite row
- row count remains unchanged
- only `isActive` changes
- `updatedAt` remains unchanged if matching current Dexie behavior
- existing read endpoint reflects the new active state
- repeated same operation is a no-op or warning, not repeated mutation
- no token, path, recipient names, aliases, contact values, descriptions, raw
  rows, transaction details, or private values appear in logs or responses
- dry-run endpoints still pass
- `verify:sqlite` behavior after intentional disposable SQLite mutation is
  understood and documented

Because an intentional SQLite mutation may make the disposable database diverge
from the original backup, verification should either run against a re-imported
SQLite database or expect/document the deliberate active-state delta.

## Manual Verification

For any future active-state write test, manually verify:

- before/after safe fingerprint of the recipients table
- before/after row count
- before/after target active-state summary
- no changes to names
- no changes to contact fields
- no changes to aliases
- no changes to descriptions
- no changes to `createdAt`
- no changes to `updatedAt`
- no transaction recipient-reference changes
- app frontend remains unaffected unless deliberately using the disposable
  SQLite read experiment
- deleting and re-importing SQLite from the fresh backup restores original
  state

Manual output must remain summary-only and outside Git.

## Explicitly Out Of Scope

- create real write
- update real write
- delete real write
- merge real write
- frontend write adapter
- UI integration
- Dexie mutation
- dual-write
- background sync
- SQLite authority migration
- transaction recipient-reference mutation
- budget, budget snapshot, report, SMS parsing, import, export, or restore
  behavior

## Boundary Statement

The approved implementation scope is limited to recipient activate and
recipient deactivate. It does not approve create, update, delete, merge,
frontend write adapters, dual-write, Dexie mutation, transaction
recipient-reference mutation, or any authority migration. Any additional
real-write endpoint still needs a separate approved implementation slice.

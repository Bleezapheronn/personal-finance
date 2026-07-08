# Recipients Active-State Real-Write Plan

This is the operation-specific plan and status note for the first Recipients
real-write experiment. The first approved implementation slice added only
recipient activate. It does not implement deactivate, repository write
adapters, UI wiring, Dexie writes, dual-write, background sync, delete, merge,
create writes, update writes, or selected-read behavior.

Dexie / IndexedDB remains authoritative today. SQLite remains disposable until
a later authority decision is explicitly approved. Any first real write
described here would be experimental, local-only, and limited to a disposable
SQLite database.

Baseline tag: `recipients-real-write-readiness-baseline`

## Current Boundary

Implemented no-mutation dry-run endpoints:

- `POST /prototype/repositories/recipients/dry-run/activate`
- `POST /prototype/repositories/recipients/dry-run/deactivate`

Implemented experimental real-write endpoint:

- `POST /prototype/repositories/recipients/write/activate`

The activate write endpoint is disabled by default behind
`PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true`. It mutates only
disposable SQLite, updates only `recipients.isActive`, and does not update
`updatedAt`.

The dry-run endpoints must be called and must pass before any future real
active-state write. A passing dry-run is a prerequisite, not general write
approval.

If implemented later, the first real write endpoint must handle one operation
at a time. Do not batch activate and deactivate together, and do not combine
active-state writes with create, update, delete, merge, import, sync, or UI
wiring.

## Active-State Routes

Current implementation status:

- `POST /prototype/repositories/recipients/write/activate`: implemented as an
  experimental, flag-gated, SQLite-only endpoint.
- `POST /prototype/repositories/recipients/write/deactivate`: not implemented.

The implemented activate route is protected by the existing token middleware
and origin guard. Browser preflight follows the existing CORS rules, but actual
`POST` requests require the token.

## Request Shape

Required:

- `id`: positive integer recipient ID

Optional, if approved in the implementation slice:

- `expectedIsActive`: boolean current state expected by the caller; used to
  prevent stale writes
- `confirmation`: short confirmation phrase or nonce proving the caller
  intentionally requested the real write after reviewing dry-run output
- `dryRunResultCode`: redacted code or digest tying the request to the matching
  dry-run result, if a lightweight correlation mechanism is approved

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

## Validation Behavior

The future endpoint must fail safely for:

- missing ID: `id_required`
- malformed, non-integer, or non-positive ID: `id_invalid`
- target recipient not found: `recipient_not_found`
- `expectedIsActive` mismatch: `stale_expected_active_state`
- activate no-op when already active: `recipient_already_active`
- deactivate no-op when already inactive: `recipient_already_inactive`
- missing, stale, or non-matching dry-run evidence: `matching_dry_run_required`
- backup/restore gate not confirmed: `backup_restore_gate_required`
- unexpected payload field: `unexpected_payload_field`
- unsupported action hint: `unsupported_first_write_action`

No-op behavior must be explicit. The recommended first behavior is no SQLite
write for no-op requests, with `rowsChanged: 0` and a warning/result code. A
future implementation must not hide a no-op behind a successful mutation shape.

## Timestamp Behavior

Current Dexie behavior:

- activate/deactivate changes only `isActive`
- activate/deactivate does not explicitly refresh `updatedAt`

Recommended first SQLite write behavior:

- match current Dexie behavior exactly
- update only `recipients.isActive`
- leave `createdAt` unchanged
- leave `updatedAt` unchanged

Changing timestamp semantics would require a separate explicit decision before
implementation. Do not silently "improve" active-state timestamps in the first
real write.

## Source-Of-Truth Boundary

The candidate endpoint would mutate only disposable SQLite. It must not claim to
be the app's real write path.

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

If implemented later, the write must be constrained to:

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

The implementation must verify exactly one expected row changed for a real
state transition. For an explicit no-op, it should verify zero rows changed.

The current shared SQLite helper opens databases read-only. A future real-write
implementation must add a deliberately named, narrowly used write-opening path
and must not weaken existing read-only helpers.

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

## Pre-Implementation Gates

All gates must pass before endpoint implementation starts:

- fresh full backup exported
- restore path verified or rehearsed
- disposable SQLite imported from the fresh backup
- `verify:sqlite` passes with backup/sqlite arguments
- `smoke:api` passes with token/token-file arguments
- Recipients read diagnostic passes against the fresh matching baseline
- active-state dry-run smoke tests pass
- matching activate/deactivate dry-run request and redacted response are
  captured
- `npm run check:local-api-safety` passes
- `npm run check:no-runtime-artifacts` passes
- operation-specific rollback instructions are written
- explicit user approval is recorded before endpoint implementation

If any gate is stale, skipped, or unknown, implementation must not start.

## Future Smoke Tests

A future implementation must add smoke coverage for:

- unauthorized write requests fail
- bad origin fails
- missing ID fails safely
- malformed ID fails safely
- unknown ID fails safely
- no-op activate/deactivate behavior is explicit
- stale `expectedIsActive` mismatch fails safely
- dry-run-required gate fails when not satisfied
- backup/restore gate fails when not confirmed
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

The approved implementation scope is limited to recipient activate. It does not
approve deactivate, create, update, delete, merge, frontend write adapters,
dual-write, Dexie mutation, transaction recipient-reference mutation, or any
authority migration. Any additional real-write endpoint still needs a separate
approved implementation slice.

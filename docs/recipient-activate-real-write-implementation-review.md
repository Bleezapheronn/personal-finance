# Recipient Activate Real-Write Implementation Review

This is a documentation-only review of the implemented recipient activate
real-write endpoint. Recipient deactivate was implemented later as a separate
approved slice; this review remains activate-specific.

Valid baseline tag: `recipient-activate-real-write-complete-baseline`

Important caveat: `recipient-activate-real-write-baseline` is incomplete and
must not be used as the implementation review baseline.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. The
implemented endpoint is a local prototype experiment only, not an app write
path.

## Reviewed Scope

Implemented real-write endpoint:

- `POST /prototype/repositories/recipients/write/activate`

Explicitly not implemented:

- recipient create real write
- recipient update real write
- recipient delete real write
- recipient merge real write
- frontend write adapter
- UI integration
- dual-write
- Dexie mutation
- authority migration

## Implementation Match Summary

| Area | Review result | Notes |
| --- | --- | --- |
| Route exists | Match | `POST /prototype/repositories/recipients/write/activate` is registered on the local API server. |
| Disabled by default | Match | Normal smoke expects no mutation unless the feature flag is explicitly enabled. |
| Env flag required | Match | Real mutation requires `PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true`. |
| Token and origin protection | Match | The route is behind the existing token middleware and origin guard. |
| Request shape | Match | Only `id`, `expectedIsActive`, `dryRunReviewed`, and `confirmation` are accepted. |
| Confirmation phrase | Match | Requires `activate recipient in disposable sqlite`. |
| Expected current state | Match | Requires `expectedIsActive: false`; already-active targets become explicit no-ops. |
| Dry-run-reviewed requirement | Match | Requires `dryRunReviewed: true` before mutation is allowed. |
| No-op behavior | Match | Already-active recipient returns `rowsChanged: 0`, `sqliteMutated: false`, and `recipient_already_active`. |
| Timestamp behavior | Match | Successful activate preserves `createdAt` and `updatedAt`, matching current Dexie active-state toggles. |
| Redacted response shape | Match | Response includes state summaries, flags, warnings, result codes, and safety metadata, not raw recipient values. |
| Normal smoke behavior | Match | Normal `smoke:api` checks the route safely without mutating disposable SQLite. |
| Opt-in write smoke | Match with caveat | `--allow-recipient-activate-write-smoke` intentionally mutates one disposable SQLite row and must be used only against throwaway state. |

## Request Contract

Required request body:

```json
{
  "id": 123,
  "expectedIsActive": false,
  "dryRunReviewed": true,
  "confirmation": "activate recipient in disposable sqlite"
}
```

The endpoint rejects:

- missing, non-integer, or non-positive `id`
- missing or non-false `expectedIsActive`
- missing or non-true `dryRunReviewed`
- missing or non-matching `confirmation`
- delete or merge hints
- unexpected payload fields
- names, aliases, contact fields, descriptions, timestamps, raw rows, or
  transaction fields

Observed validation/error codes include:

- `id_required`
- `id_invalid`
- `payload_must_be_object`
- `expected_is_active_false_required`
- `dry_run_reviewed_required`
- `matching_dry_run_required`
- `unexpected_payload_field`
- `unsupported_first_write_action`
- `recipient_active_state_writes_disabled`
- `recipient_not_found`
- `recipient_activate_write_failed`

## Response Contract

The response is summary-only and may include:

- `ok`
- `mode: "prototype"`
- `action: "activate"`
- `dryRunRequired: true`
- `realWrite: true`
- `sqliteMutated`
- `rowsChanged`
- `targetIdPresent`
- `targetId`
- `previousStateSummary.isActive`
- `newStateSummary.isActive`
- timestamp preservation summary
- validation errors
- warnings
- safety metadata
- result codes

The response must not include:

- recipient names
- aliases
- email addresses
- phone numbers
- till numbers
- paybill values
- account numbers
- descriptions
- raw rows
- transaction descriptions or references
- token values
- SQLite paths
- backup paths
- log paths

## Mutation Boundary

The implemented mutation boundary matches the approved first-slice scope:

- SQLite-only
- disposable database only
- updates only `recipients.isActive`
- changes exactly one row for a real inactive-to-active transition
- changes zero rows for an already-active no-op
- does not update `updatedAt`
- does not update `createdAt`
- does not change recipient names
- does not change contact fields
- does not change aliases
- does not change descriptions
- does not mutate transaction recipient references
- does not perform `INSERT`
- does not perform `DELETE`
- does not implement merge behavior
- does not access Dexie from the server
- does not write files
- does not provide a frontend write adapter
- does not integrate with UI write controls

## Smoke Coverage

Normal `smoke:api` coverage is intentionally non-mutating. It verifies:

- unauthenticated activate write fails
- unexpected origin is rejected
- validation failures are redacted
- default-disabled write path does not mutate SQLite
- delete and merge write routes are not implemented

The opt-in write smoke path is explicit. When run with
`--allow-recipient-activate-write-smoke`, it verifies:

- an inactive recipient can be activated in disposable SQLite
- exactly one row changes
- row count remains stable
- only active state differs on the read endpoint
- repeated activate is an explicit no-op
- sensitive recipient values are not echoed

## Caveats

- Successful opt-in write smoke dirties the disposable SQLite database.
- Re-import SQLite from a fresh backup before using that database as a clean
  read-parity or selected-read baseline.
- The endpoint is not an app write path.
- Dexie remains authoritative.
- SQLite remains disposable.
- No UI should call this endpoint.
- No frontend write adapter exists.
- Deactivate is covered by a separate implementation slice and should not be
  treated as part of this activate-specific review.
- Create, update, delete, and merge remain out of scope.

## Follow-Up Risks

- The activate route is intentionally narrow. Deactivate and any further
  recipient writes must be reviewed separately rather than inheriting approval
  from this activate-specific review.
- Any future frontend write adapter needs a separate design for user
  confirmation, rollback, stale-state handling, and Dexie authority boundaries.
- Any successful opt-in mutation can make `verify:sqlite` differ from the
  original backup unless SQLite is re-imported or the deliberate delta is
  documented.

## Conclusion

The implemented recipient activate endpoint matches the approved narrow
real-write scope: disabled by default, token/origin protected, summary-only,
SQLite-only, and limited to `recipients.isActive`. It does not authorize any
additional write endpoint, frontend write integration, dual-write behavior, or
SQLite authority migration.

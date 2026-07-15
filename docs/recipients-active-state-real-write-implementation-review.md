# Recipients Active-State Real-Write Implementation Review

This is a documentation-only review of the completed Recipients active-state
real-write pair.

Baseline tag: `recipients-active-state-real-write-complete-baseline`

Important caveat: `recipient-activate-real-write-baseline` is incomplete. Use
`recipient-activate-real-write-complete-baseline`,
`recipient-activate-real-write-review-baseline`, or a later baseline such as
`recipients-active-state-real-write-complete-baseline` when reasoning about the
implemented active-state write path.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. These
endpoints are local prototype experiments only, not app write paths.

## Reviewed Scope

Implemented experimental real-write endpoints:

- `POST /prototype/repositories/recipients/write/activate`
- `POST /prototype/repositories/recipients/write/deactivate`

Both endpoints are disabled by default behind:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true
```

Explicitly not implemented:

- recipient create real write, now implemented separately after this review
- recipient update real write, now implemented separately after this review
- recipient delete real write
- recipient merge real write
- frontend write adapter
- UI integration
- dual-write
- Dexie mutation
- authority migration

## Endpoint Review Matrix

| Area | Activate | Deactivate | Review result |
| --- | --- | --- | --- |
| Route | `POST /prototype/repositories/recipients/write/activate` | `POST /prototype/repositories/recipients/write/deactivate` | Match |
| Env flag behavior | Disabled unless `PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true` | Same | Match |
| Request fields | `id`, `expectedIsActive`, `dryRunReviewed`, `confirmation` | Same | Match |
| Confirmation phrase | `activate recipient in disposable sqlite` | `deactivate recipient in disposable sqlite` | Match |
| Expected current state | `expectedIsActive: false` | `expectedIsActive: true` | Match |
| Dry-run-reviewed gate | `dryRunReviewed: true` | `dryRunReviewed: true` | Match |
| Successful mutation | inactive to active | active to inactive | Match |
| No-op behavior | already active -> `recipient_already_active`, `rowsChanged: 0` | already inactive -> `recipient_already_inactive`, `rowsChanged: 0` | Match |
| Timestamp behavior | preserves `createdAt` and `updatedAt` | preserves `createdAt` and `updatedAt` | Match |
| Response redaction | summary-only active-state fields | summary-only active-state fields | Match |
| Smoke coverage | normal non-mutating plus opt-in mutation smoke | normal non-mutating plus opt-in mutation smoke | Match |

No gaps were found against the approved active-state plan for the implemented
activate/deactivate pair. Unknowns and future work remain outside this review:
create/update behavior from its later separate slice, delete/merge behavior,
frontend write adapters, UI integration,
dual-write, and any authority migration.

## Request Contracts

Activate request:

```json
{
  "id": 123,
  "expectedIsActive": false,
  "dryRunReviewed": true,
  "confirmation": "activate recipient in disposable sqlite"
}
```

Deactivate request:

```json
{
  "id": 123,
  "expectedIsActive": true,
  "dryRunReviewed": true,
  "confirmation": "deactivate recipient in disposable sqlite"
}
```

Both endpoints reject:

- missing, non-integer, or non-positive `id`
- wrong or missing `expectedIsActive`
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
- `expected_is_active_true_required`
- `dry_run_reviewed_required`
- `matching_dry_run_required`
- `unexpected_payload_field`
- `unsupported_first_write_action`
- `recipient_active_state_writes_disabled`
- `recipient_not_found`
- `recipient_activate_write_failed`
- `recipient_deactivate_write_failed`

## Response Contract And Redaction

Responses are summary-only and may include:

- `ok`
- `mode: "prototype"`
- `action: "activate"` or `"deactivate"`
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

Responses must not include:

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

The implemented mutation boundary matches the approved active-state scope:

- SQLite-only
- disposable database only
- updates only `recipients.isActive`
- changes exactly one row for a real state transition
- changes zero rows for an already-correct no-op
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
- does not dual-write

The only SQL mutation used by this pair is the constrained active-state update:

```sql
UPDATE recipients SET isActive = @proposedActive
WHERE id = @id AND isActive = @previousActive
```

## Test Coverage

Normal `smoke:api` is intentionally non-mutating. It verifies:

- unauthenticated activate/deactivate write requests fail
- unexpected origins are rejected
- validation failures are redacted
- default-disabled activate/deactivate write paths do not mutate SQLite
- recipient create/update routes are covered by a later separate implementation
  slice; delete/merge write routes remain absent
- dry-run endpoints still pass
- row count and safe list fingerprint remain stable during default-disabled
  write checks

Opt-in mutation smoke is explicit and must be requested with:

```text
--allow-recipient-activate-write-smoke
--allow-recipient-deactivate-write-smoke
```

When the server is also started with
`PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true`, opt-in smoke
verifies:

- activate changes one inactive recipient to active
- deactivate changes one active recipient to inactive
- exactly one SQLite row changes for each real transition
- recipient row count remains unchanged
- only `isActive` changes on the read endpoint
- `createdAt` and `updatedAt` remain unchanged
- repeated same operation returns no-op/warning
- sensitive recipient values are not echoed

Additional guard coverage:

- `npm run check:local-api-safety` covers selected-read import guard, runtime
  artifact guard, root build, and server build
- `npm run check:no-runtime-artifacts` verifies runtime artifacts are not in
  the repo
- `git diff --check` catches whitespace issues before commit

## Caveats

- Successful opt-in write smoke dirties the disposable SQLite database.
- Re-import SQLite from a fresh backup before using that database as a clean
  read-parity, selected-read, or verification baseline.
- These endpoints are not app write paths.
- Dexie remains authoritative.
- SQLite remains disposable.
- No UI should call these endpoints.
- No frontend write adapter exists.
- Create/update real writes are covered by a later separate implementation
  slice. Delete and merge real writes remain deferred.
- Passing this review does not authorize broader writes, UI wiring,
  dual-write, or SQLite authority migration.

## Conclusion

The completed active-state pair matches the approved narrow real-write scope:
disabled by default, token/origin protected, summary-only, SQLite-only, and
limited to `recipients.isActive`. No source-of-truth change is implied. Any
additional Recipients write endpoint still requires a separate approved plan,
implementation, smoke coverage, rollback procedure, and review.

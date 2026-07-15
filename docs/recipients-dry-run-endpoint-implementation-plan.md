# Recipients Dry-Run Endpoint Implementation Plan

This started as a documentation-only implementation plan for the first
Recipients dry-run endpoint slice. The create-recipient, update-recipient,
activate-recipient, and deactivate-recipient dry-run endpoints have now been
implemented. This plan still does not authorize mutation handlers, write
adapters, server-side writes, client write wiring, dual-write, Dexie changes,
SQLite writes, or synchronization.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. HTTP
remains read-only except for validation-only dry-run endpoints that must not
mutate state.

Related documents:

- [write-mutation-architecture-plan.md](write-mutation-architecture-plan.md)
- [recipients-write-dry-run-design.md](recipients-write-dry-run-design.md)
- [recipients-write-dry-run-design-review.md](recipients-write-dry-run-design-review.md)
- [recipients-basic-dry-run-implementation-review.md](recipients-basic-dry-run-implementation-review.md)

## Scope

The first endpoint slice is limited to:

- create recipient dry-run: implemented
- update recipient dry-run: implemented
- activate recipient dry-run: implemented
- deactivate recipient dry-run: implemented

Explicitly deferred:

- delete recipient dry-run
- merge recipients dry-run
- real recipient writes
- transaction recipient-reference mutations
- Dexie / SQLite synchronization
- dual-write

## Route Contracts

The create, update, activate, and deactivate routes exist today. Delete and
merge dry-runs remain deferred.

| Action | Route |
| --- | --- |
| Create | `POST /prototype/repositories/recipients/dry-run/create` implemented |
| Update | `POST /prototype/repositories/recipients/dry-run/update` implemented |
| Activate | `POST /prototype/repositories/recipients/dry-run/activate` implemented |
| Deactivate | `POST /prototype/repositories/recipients/dry-run/deactivate` implemented |

Dry-run routes must be protected by the existing token middleware and origin
guard. Approved local browser preflight may succeed without a token, but actual
POST requests must require the token.

## Shared Request Rules

Requests must be JSON objects. Arrays, raw backup rows, raw Dexie rows, SQL,
transaction objects, audit logs, and arbitrary pass-through payloads are not
valid request bodies.

Unexpected fields should be rejected with `unexpected_payload_field`; they
should not be silently ignored. This keeps the dry-run contract small enough to
trust before any write behavior exists.

Delete and merge action hints sent to first-slice endpoints should be rejected
with `unsupported_first_slice_action`. Do not add delete or merge endpoint
aliases in this slice.

## Create Dry-Run

Route:

`POST /prototype/repositories/recipients/dry-run/create`

Required fields:

- `name`

Optional fields:

- `aliases`
- `email`
- `phone`
- `tillNumber`
- `paybill`
- `accountNumber`
- `description`

Rejected fields:

- `id`
- `isActive`
- `createdAt`
- `updatedAt`
- transaction fields
- delete/merge action fields
- arbitrary audit or raw-row fields

Validation behavior:

- `name` is required after trimming.
- `accountNumber` requires a non-empty `paybill`.
- Optional text fields are trimmed and treated as absent when empty.
- Alias comparison splits on semicolons, lowercases, trims, and ignores empty
  aliases.
- Alias collisions with other recipients are validation errors.
- Duplicate candidate counts are computed by category.
- Create must not reserve, predict, or return a future recipient ID.
- Create dry-run reports that a real Dexie create would set `isActive: true`,
  `createdAt`, and `updatedAt`.

Status behavior:

- `200` for a syntactically valid dry-run request, whether or not validation
  errors are present in the response.
- `400` for invalid JSON shape, unexpected fields, or malformed field types.
- `401` for missing or invalid token.
- `403` for rejected origin.
- `503` when the configured read source needed for validation is unavailable.
- `500` for unexpected dry-run failures with a non-sensitive code.

## Update Dry-Run

Route:

`POST /prototype/repositories/recipients/dry-run/update`

Required fields:

- `id`
- `name`

Optional fields:

- `aliases`
- `email`
- `phone`
- `tillNumber`
- `paybill`
- `accountNumber`
- `description`

Rejected fields:

- `isActive`
- `createdAt`
- `updatedAt`
- transaction fields
- delete/merge action fields
- arbitrary audit or raw-row fields

Validation behavior:

- `id` must be a positive integer.
- Target recipient must exist.
- `name` is required after trimming.
- `accountNumber` requires a non-empty `paybill`.
- Duplicate candidate counts exclude the target recipient ID.
- Alias collision checks exclude the target recipient ID.
- Optional text fields normalize the same way as create.
- Update dry-run reports that a real Dexie update would preserve `createdAt`
  and refresh `updatedAt`.

Status behavior follows the create dry-run status rules. Unknown target ID
should be represented as a validation error code in a redacted response, unless
the later implementation chooses a stricter `404` route-level style and
documents that before code lands.

## Activate Dry-Run

Route:

`POST /prototype/repositories/recipients/dry-run/activate`

Required fields:

- `id`

Optional fields:

- none

Rejected fields:

- recipient content fields
- timestamps
- transaction fields
- delete/merge action fields
- arbitrary audit or raw-row fields

Validation behavior:

- `id` must be a positive integer.
- Target recipient must exist.
- If the target is already active, return a no-op warning.
- If the target is inactive, report that a real Dexie action would change
  `isActive` to `true`.
- Current Dexie activate/toggle behavior does not explicitly refresh
  `updatedAt`; dry-run must report that current timestamp behavior instead of
  inventing a new one.

Status behavior follows the create dry-run status rules.

## Deactivate Dry-Run

Route:

`POST /prototype/repositories/recipients/dry-run/deactivate`

Required fields:

- `id`

Optional fields:

- none

Rejected fields:

- recipient content fields
- timestamps
- transaction fields
- delete/merge action fields
- arbitrary audit or raw-row fields

Validation behavior:

- `id` must be a positive integer.
- Target recipient must exist.
- If the target is already inactive, return a no-op warning.
- If the target is active, report that a real Dexie action would change
  `isActive` to `false`.
- Transaction usage count may be returned as an aggregate count only, because
  deactivation is the current safe fallback for used recipients.
- Current Dexie deactivate behavior does not explicitly refresh `updatedAt`;
  dry-run must report that current timestamp behavior instead of inventing a
  new one.

Status behavior follows the create dry-run status rules.

## Shared Response Shape

Responses must be summary-only and redacted:

```json
{
  "ok": true,
  "mode": "prototype",
  "action": "create",
  "dryRun": true,
  "wouldMutate": false,
  "targetIdPresent": false,
  "targetId": null,
  "validationErrors": [],
  "warnings": [],
  "normalizedFieldPresence": {
    "hasName": true,
    "hasAliases": false,
    "hasEmail": false,
    "hasPhone": true,
    "hasTillNumber": false,
    "hasPaybill": false,
    "hasAccountNumber": false,
    "hasDescription": false,
    "isActive": true
  },
  "duplicateSummary": {
    "duplicateNameCandidates": 0,
    "duplicatePhoneCandidates": 0,
    "duplicatePaybillAccountCandidates": 0,
    "duplicateTillCandidates": null,
    "aliasCollisions": 0
  },
  "timestampBehavior": {
    "createdAtWouldChange": true,
    "updatedAtWouldChange": true,
    "createdAtPreserved": false,
    "updatedAtPreservedByCurrentToggleBehavior": false
  },
  "affectedSummary": {
    "recipientRowsWouldChange": 0,
    "transactionRowsWouldChange": 0,
    "transactionUsageCount": 0
  },
  "safety": {
    "sqliteMutated": false,
    "dexieMutated": false,
    "filesWritten": false,
    "transactionReferencesMutated": false,
    "rawRowsIncluded": false
  },
  "resultCodes": []
}
```

Response fields may be omitted only if the omission is documented in the route
contract before implementation. Do not return raw recipient rows.

Allowed response detail:

- action name
- target ID presence and target ID for update/activate/deactivate
- validation error codes
- warning codes
- normalized field presence booleans
- proposed `isActive`
- duplicate candidate counts by category
- alias collision count
- aggregate transaction usage count for deactivate
- timestamp behavior booleans
- no-mutation safety booleans

Forbidden response detail:

- recipient names
- aliases
- email addresses
- phone numbers
- till numbers
- paybill values
- account numbers
- descriptions
- raw recipient rows
- transaction rows
- transaction descriptions or references
- token values
- SQLite paths
- backup paths

## Validation Code Vocabulary

Validation errors:

- `name_required`
- `id_required`
- `id_invalid`
- `recipient_not_found`
- `account_number_requires_paybill`
- `alias_collision_detected`
- `duplicate_candidate_detected`
- `unexpected_payload_field`
- `unsupported_first_slice_action`
- `payload_must_be_object`
- `payload_json_invalid`

Warnings:

- `recipient_already_active`
- `recipient_already_inactive`
- `ambiguous_till_number_duplicate_behavior`
- `duplicate_name_candidates_present`
- `duplicate_phone_candidates_present`
- `duplicate_paybill_account_candidates_present`
- `duplicate_till_candidates_unknown`
- `alias_collision_count_redacted`
- `toggle_preserves_updated_at_current_behavior`
- `transaction_usage_count_informational`

Result codes:

- `dry_run_valid`
- `dry_run_has_validation_errors`
- `dry_run_has_warnings`
- `no_mutation_performed`
- `delete_dry_run_deferred`
- `merge_dry_run_deferred`

## Duplicate Counts

The first implementation must preserve current create/update semantics unless a
separate behavior change is approved.

Duplicate categories:

- `duplicateNameCandidates`: exact case-insensitive name matches.
- `duplicatePhoneCandidates`: exact trimmed phone matches when proposed phone
  is present.
- `duplicatePaybillAccountCandidates`: exact trimmed paybill plus account
  number matches when both are present.
- `duplicateTillCandidates`: `null` until the ambiguous current till-number
  behavior is resolved or intentionally preserved.
- `aliasCollisions`: exact normalized alias matches against other recipients'
  aliases.

Create checks all recipients. Update excludes the target recipient ID.

Do not include candidate recipient names or contact values. If candidates are
present, return counts and codes only.

## Timestamp Behavior

Create:

- `createdAtWouldChange: true`
- `updatedAtWouldChange: true`
- no exact timestamp value returned

Update:

- `createdAtWouldChange: false`
- `createdAtPreserved: true`
- `updatedAtWouldChange: true`
- no exact timestamp value returned

Activate/deactivate:

- `createdAtWouldChange: false`
- `createdAtPreserved: true`
- `updatedAtWouldChange: false`
- `updatedAtPreservedByCurrentToggleBehavior: true`
- include warning `toggle_preserves_updated_at_current_behavior`

This mirrors current Dexie behavior. A future intentional timestamp behavior
change must be approved separately.

## Route Safety Requirements

Every first-slice dry-run route must guarantee:

- token required for actual POST
- origin guard required
- localhost prototype assumptions remain
- no wildcard CORS
- no SQLite writes
- no Dexie access from the server
- no file writes
- no transaction updates
- no recipient updates, inserts, deletes, deactivations, or activations
- no background work
- no schema creation or migration
- no full paths, token values, or raw rows in responses
- normal logs remain summary-only

The server may read the configured disposable SQLite database in read-only mode
to validate current recipient state. It must not claim SQLite is authoritative.

## Later Implementation Sequence

The create, update, activate, and deactivate dry-run endpoints are implemented
with isolated server-side validation helpers and smoke-test coverage. If any
later dry-run endpoint is explicitly approved, keep each code slice isolated:

1. Add or extend shared recipient dry-run validation helpers under
   `server/src/lib`.
2. Add narrow route request/response TypeScript types.
3. Add only the approved dry-run handler in the existing Fastify server.
4. Keep handlers separate from existing read-only lookup route helpers.
5. Open SQLite read-only through the existing configured path helper.
6. Return redacted summaries only.
7. Add smoke-test coverage for dry-run behavior.
8. Add no-mutation verification around repeated dry-run calls.
9. Update docs with the implemented route behavior.

Do not add frontend write adapters, Recipients write UI wiring, delete/merge
dry-runs, additional real writes, dual-write, or transaction reference mutation
in a dry-run slice.

After this dry-run plan, recipient create/update and activate/deactivate
real-write endpoints were implemented as separate disabled-by-default,
SQLite-only experiments. Delete, merge, frontend write adapters, UI wiring,
dual-write, and transaction recipient-reference mutation remain out of scope.

## Smoke Test Coverage

Implemented create/update/activate/deactivate dry-run smoke coverage includes:

- unauthorized dry-run requests fail
- bad origin fails
- approved origin preflight succeeds without token if browser preflight is
  required
- create dry-run with missing name returns `name_required`
- create dry-run with valid minimal payload returns a redacted summary
- create dry-run rejects client-provided `id`
- update dry-run with missing ID returns `id_required`
- update dry-run with invalid ID returns `id_invalid`
- update dry-run with unknown ID returns `recipient_not_found`
- update dry-run with known ID returns a redacted summary
- update dry-run excludes the target recipient from duplicate candidate counts
- activate dry-run no-op returns `recipient_already_active`
- deactivate dry-run no-op returns `recipient_already_inactive` when an
  inactive recipient exists in the fixture data
- activate/deactivate timestamp behavior reports no `updatedAt` change
- activate/deactivate repeated calls do not change row counts or recipient
  content
- duplicate candidates are reported only as counts and codes
- alias collisions are reported only as counts and codes
- delete and merge endpoints do not exist
- delete/merge action hints are rejected by first-slice endpoints
- repeated dry-run calls do not change row counts
- repeated dry-run calls do not change recipient content
- no token/path/contact details appear in responses

Future delete/merge dry-run implementation, if approved, must add equivalent
authorization, origin, redaction, no-mutation, and reference-safety smoke
coverage.

## Later Manual Verification

Before implementing and again before trusting the implementation:

- export a fresh full backup
- import it into a disposable SQLite database outside the repo
- restart the API against that SQLite database
- run `verify:sqlite` with backup/sqlite arguments
- run `smoke:api` with token/token-file arguments before dry-run calls
- call each dry-run endpoint with safe fixture payloads
- run `smoke:api` again after dry-run calls
- confirm row counts are unchanged after dry-runs
- confirm sampled recipient content is unchanged after dry-runs
- confirm the Recipients read diagnostic still passes
- run `npm run check:local-api-safety`
- run `npm run check:no-runtime-artifacts`
- confirm app behavior remains unchanged

All generated reports, logs, backups, tokens, and SQLite files must remain
outside Git.

## Implementation Blockers

Do not implement the endpoints until these are accepted:

- The ambiguous till-number duplicate behavior is either preserved as unknown
  with `duplicateTillCandidates: null` or corrected by a separate approved UI
  behavior change.
- The implementation agrees that responses remain redacted even though the
  local UI may display recipient values from Dexie.
- The implementation agrees that create dry-run does not reserve or predict an
  ID.
- Delete and merge remain deferred.
- No transaction recipient-reference mutation is included.
- The smoke-test plan includes no-mutation checks before and after dry-run
  calls.

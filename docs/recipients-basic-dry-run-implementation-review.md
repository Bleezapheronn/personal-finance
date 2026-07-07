# Recipients Basic Dry-Run Implementation Review

This is a documentation-only review of the implemented Recipients dry-run
endpoints against the approved first-slice design. It does not add endpoints,
write adapters, UI wiring, Dexie writes, SQLite writes, dual-write, selected
read changes, or real mutation behavior.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. HTTP
remains read-only except for validation-only dry-run endpoints that must not
mutate state.

Baseline tag: `recipients-basic-dry-run-complete-baseline`

## Sources Reviewed

- `server/src/lib/recipientDryRun.ts`
- `server/src/index.ts`
- `server/src/smokeApi.ts`
- `docs/recipients-dry-run-endpoint-implementation-plan.md`
- `docs/recipients-write-dry-run-design.md`
- `docs/recipients-write-dry-run-design-review.md`
- `docs/write-mutation-architecture-plan.md`

## Overall Finding

The implemented basic Recipients dry-run endpoints match the approved first
slice:

- `POST /prototype/repositories/recipients/dry-run/create`
- `POST /prototype/repositories/recipients/dry-run/update`
- `POST /prototype/repositories/recipients/dry-run/activate`
- `POST /prototype/repositories/recipients/dry-run/deactivate`

The implementation is validation-only, summary-only, and redacted. It opens the
configured SQLite database through the existing read-only helper and uses only
read queries for recipient validation, duplicate counts, alias collision counts,
and deactivate transaction usage counts. The reviewed dry-run helper does not
contain `INSERT`, `UPDATE`, `DELETE`, write transactions, file writes, Dexie
access, transaction recipient-reference mutation, delete dry-run behavior, merge
dry-run behavior, frontend write adapters, or UI integration.

No gaps were found that violate the approved first-slice safety boundary. The
remaining risks are known design limitations: ambiguous till-number duplicate
semantics, count-only transaction usage summaries, and the fact that dry-run
smoke coverage is not approval for real writes.

## Endpoint Review

### Create Recipient Dry-Run

Route exists:
`POST /prototype/repositories/recipients/dry-run/create`

Expected request shape:

- accepts `name`, `aliases`, `email`, `phone`, `tillNumber`, `paybill`,
  `accountNumber`, and `description`
- rejects `id`, `isActive`, timestamps, delete/merge hints, and arbitrary
  fields

Expected response shape:

- returns `ok`, `mode: "prototype"`, `action: "create"`, `dryRun: true`,
  `wouldMutate: false`
- reports `targetIdPresent: false` and `targetId: null`
- returns `validationErrors`, `warnings`, `normalizedFieldPresence`,
  `duplicateSummary`, `timestampBehavior`, `affectedSummary`, `safety`, and
  `resultCodes`

Validation and error codes:

- `name_required`
- `account_number_requires_paybill`
- `duplicate_candidate_detected`
- `alias_collision_detected`
- `unexpected_payload_field`
- `unsupported_first_slice_action`
- `payload_must_be_object`
- field-specific `*_invalid` codes for malformed field types

Warning codes:

- `ambiguous_till_number_duplicate_behavior`
- `duplicate_till_candidates_unknown`
- duplicate count warnings by category
- `alias_collision_count_redacted`

Redaction behavior:

- returns presence booleans and counts only
- does not return recipient names, aliases, email, phone, till, paybill,
  account number, description, raw rows, token values, SQLite paths, or file
  paths

Timestamp behavior:

- reports `createdAtWouldChange: true`
- reports `updatedAtWouldChange: true`
- does not return timestamp values

Duplicate behavior:

- counts case-insensitive duplicate names
- counts exact trimmed phone matches
- counts exact trimmed paybill plus account number matches
- reports `duplicateTillCandidates: null` because current till-number behavior
  remains ambiguous
- counts alias collisions from semicolon-separated normalized aliases

No-mutation checks:

- dry-run response always reports `wouldMutate: false`
- `affectedSummary.recipientRowsWouldChange` and
  `affectedSummary.transactionRowsWouldChange` remain `0`
- smoke coverage fingerprints recipient list content before and after repeated
  create dry-runs

Match/gap/unknown:

- Match. The implementation matches the approved create dry-run scope.
- Known limitation: till-number duplicate behavior remains intentionally
  unresolved and represented as unknown/count-null rather than silently fixed.

### Update Recipient Dry-Run

Route exists:
`POST /prototype/repositories/recipients/dry-run/update`

Expected request shape:

- requires `id`
- accepts the same editable content fields as create
- rejects `isActive`, timestamps, delete/merge hints, transaction fields, and
  arbitrary fields

Expected response shape:

- returns `action: "update"`, `dryRun: true`, `wouldMutate: false`
- reports target ID presence and the target ID when the submitted ID is valid
- returns the same redacted summary groups as create

Validation and error codes:

- `id_required`
- `id_invalid`
- `recipient_not_found`
- `name_required`
- `account_number_requires_paybill`
- `duplicate_candidate_detected`
- `alias_collision_detected`
- shared payload shape and unexpected-field codes

Warning codes:

- same duplicate and alias warning families as create
- `ambiguous_till_number_duplicate_behavior` and
  `duplicate_till_candidates_unknown` when a till number is supplied

Redaction behavior:

- does not return existing or proposed recipient content values
- reports duplicate and alias collision counts only

Timestamp behavior:

- reports `createdAtWouldChange: false`
- reports `createdAtPreserved: true`
- reports `updatedAtWouldChange: true`
- does not return timestamp values

Duplicate behavior:

- duplicate and alias checks exclude the target recipient ID
- count categories remain the same as create

No-mutation checks:

- no update SQL is issued by the dry-run helper
- smoke coverage fingerprints recipient list content before and after repeated
  update dry-runs

Match/gap/unknown:

- Match. The implementation matches the approved update dry-run scope.
- Known limitation: this is still validation parity, not real-write approval.

### Activate Recipient Dry-Run

Route exists:
`POST /prototype/repositories/recipients/dry-run/activate`

Expected request shape:

- requires `id`
- accepts no content fields
- rejects names, contact fields, timestamps, delete/merge hints, transaction
  fields, and arbitrary fields

Expected response shape:

- returns `action: "activate"`, `dryRun: true`, `wouldMutate: false`
- reports target ID presence and target ID when supplied
- keeps the shared summary shape with zero duplicate counts
- reports proposed active state through `normalizedFieldPresence.isActive`

Validation and error codes:

- `id_required`
- `id_invalid`
- `recipient_not_found`
- shared payload shape and unexpected-field codes

Warning codes:

- `recipient_already_active` for no-op activation
- `toggle_preserves_updated_at_current_behavior`

Redaction behavior:

- does not return recipient names, contact details, aliases, descriptions, raw
  rows, token values, SQLite paths, or file paths

Timestamp behavior:

- reports `createdAtWouldChange: false`
- reports `updatedAtWouldChange: false`
- reports `createdAtPreserved: true`
- reports `updatedAtPreservedByCurrentToggleBehavior: true`
- reports `isActiveWouldChange: true` only when the target is currently
  inactive

Duplicate behavior:

- not applicable; duplicate counts remain zero/null in the shared shape

No-mutation checks:

- dry-run does not issue SQLite writes
- smoke coverage verifies no-op behavior, timestamp behavior, and unchanged
  recipient count/content after repeated activate/deactivate dry-runs

Match/gap/unknown:

- Match. The implementation reflects current Dexie toggle behavior, including
  no explicit `updatedAt` refresh.

### Deactivate Recipient Dry-Run

Route exists:
`POST /prototype/repositories/recipients/dry-run/deactivate`

Expected request shape:

- requires `id`
- accepts no content fields
- rejects names, contact fields, timestamps, delete/merge hints, transaction
  fields, and arbitrary fields

Expected response shape:

- returns `action: "deactivate"`, `dryRun: true`, `wouldMutate: false`
- reports target ID presence and target ID when supplied
- keeps the shared summary shape with zero duplicate counts
- reports proposed inactive state through `normalizedFieldPresence.isActive`
- reports transaction usage as an aggregate count only

Validation and error codes:

- `id_required`
- `id_invalid`
- `recipient_not_found`
- shared payload shape and unexpected-field codes

Warning codes:

- `recipient_already_inactive` for no-op deactivation
- `transaction_usage_count_informational` when the target exists
- `toggle_preserves_updated_at_current_behavior`

Redaction behavior:

- does not return recipient values or transaction rows
- transaction reference impact is count-only

Timestamp behavior:

- reports `createdAtWouldChange: false`
- reports `updatedAtWouldChange: false`
- reports `createdAtPreserved: true`
- reports `updatedAtPreservedByCurrentToggleBehavior: true`
- reports `isActiveWouldChange: true` only when the target is currently active

Duplicate behavior:

- not applicable; duplicate counts remain zero/null in the shared shape

No-mutation checks:

- dry-run does not issue SQLite writes
- smoke coverage verifies unknown ID behavior, no-op behavior when an inactive
  fixture exists, valid active-state-change summary, timestamp behavior,
  redaction, and unchanged recipient count/content

Match/gap/unknown:

- Match. The implementation matches the approved deactivate dry-run scope.
- Known limitation: transaction usage is intentionally aggregate-only and does
  not imply delete or merge readiness.

## Safety Boundary Review

Reviewed implementation status:

| Boundary | Status | Notes |
| --- | --- | --- |
| No `INSERT` / `UPDATE` / `DELETE` SQL | Pass | Dry-run helper reads recipients and counts transactions only. |
| No write transaction | Pass | No transaction wrapper or write transaction is used. |
| SQLite opened read-only | Pass | Routes use `openConfiguredReadOnlyDatabase`. |
| No file writes | Pass | Dry-run code does not write files or reports. |
| No Dexie access from server | Pass | Server code uses SQLite read-only helpers only. |
| No transaction recipient-reference mutation | Pass | Deactivate reports usage count only; merge remains deferred. |
| No delete/merge routes | Pass | Smoke confirms delete dry-run route is not implemented; no merge route is added. |
| No frontend write adapter | Pass | No frontend write adapter is part of this implementation. |
| No UI integration | Pass | Recipients UI remains Dexie-write-only; HTTP dry-runs are server-side only. |
| No token/path leakage | Pass | Route errors and dry-run responses use non-sensitive codes. |
| No raw recipient/contact/alias values | Pass | Responses expose booleans and counts, not values. |

## Smoke Coverage Summary

`server/src/smokeApi.ts` covers:

- protected route behavior for dry-run endpoints
- bad-origin rejection
- browser preflight behavior for protected local API routes
- create validation, duplicate counts, alias/count redaction, and no mutation
- update validation, target exclusion for duplicate counts, redaction, and no
  mutation
- activate missing ID, no-op warning, timestamp behavior, and no mutation
- deactivate unknown ID, optional inactive no-op warning, active-state-change
  summary, timestamp behavior, count-only transaction usage, redaction, and no
  mutation
- unsupported action hints rejected by first-slice endpoints
- delete dry-run route remains absent

Smoke tests are broad enough for the current dry-run safety boundary, but they
are not a substitute for a future real-write design, backup/restore rehearsal,
or post-write parity tooling.

## Follow-Up Risks And Gaps

- Till-number duplicate behavior remains ambiguous and is intentionally reported
  as unknown rather than silently corrected.
- Activate/deactivate timestamp behavior matches current Dexie behavior by not
  refreshing `updatedAt`; changing that behavior later would need separate
  approval.
- Deactivate transaction usage is count-only and informational. It does not
  authorize delete, merge, or transaction recipient-reference mutation.
- Delete and merge dry-runs remain deferred. Merge is still high risk because a
  real merge would mutate transaction recipient references.
- The implementation validates against disposable SQLite. Dexie remains
  authoritative, so dry-run trust still depends on fresh backup/import parity
  before manual testing.
- Real writes, write adapters, dual-write, UI write wiring, and source-of-truth
  migration remain out of scope.

## Review Conclusion

The implemented create, update, activate, and deactivate Recipients dry-run
endpoints match the approved basic dry-run scope. They preserve the intended
no-mutation and redaction boundaries and leave delete, merge, real writes,
write adapters, UI integration, dual-write, and transaction-reference mutation
deferred.

The next safe step, if write exploration continues, is still documentation and
design for a specific future slice. This review does not authorize any real
mutation endpoint.

The readiness gate before any future real Recipients write endpoint is
[recipients-real-write-readiness-gate.md](recipients-real-write-readiness-gate.md).

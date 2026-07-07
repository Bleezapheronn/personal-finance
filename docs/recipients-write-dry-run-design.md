# Recipients Write Dry-Run Design

This is a documentation-only design for a future Recipients write dry-run
phase. It is not implementation. It does not add endpoints, mutation handlers,
repository write adapters, UI wiring, Dexie writes, SQLite writes, dual-write,
or background sync.

Design review against current Dexie behavior:
[recipients-write-dry-run-design-review.md](recipients-write-dry-run-design-review.md).

Dexie / IndexedDB remains authoritative. SQLite remains disposable. HTTP
remains read-only until a later approved implementation slice. No write
endpoint should be added from this document alone.

## Current Recipients Behavior

The Recipients management screen currently owns the write UX through Dexie:

- create and update happen in `AddRecipientModal`
- activate/deactivate toggles `isActive`
- delete is allowed only for recipients with no transaction usage
- used recipients are deactivated instead of deleted
- merge combines recipient fields, moves transactions from the secondary
  recipient to the primary recipient, then deletes the secondary recipient
- `http-readonly` mode hides or guards write controls

The current recipient model includes:

- `id`
- `name`
- `aliases`
- `email`
- `phone`
- `tillNumber`
- `paybill`
- `accountNumber`
- `description`
- `isActive`
- `createdAt`
- `updatedAt`

Aliases are stored as a semicolon-separated string, not JSON.

## Dry-Run Definition

A dry-run validates and summarizes a proposed mutation without changing state.

A Recipients dry-run may:

- validate the proposed mutation
- compute the would-be normalized recipient row or field-presence summary
- compute affected IDs and counts
- compute duplicate candidate counts
- compute transaction usage counts for delete and merge
- return warnings and validation errors

A Recipients dry-run must not:

- write to SQLite
- write to Dexie
- change files
- mutate server state
- update transaction recipient references
- delete or deactivate recipients
- enqueue background work
- assume SQLite is authoritative

## Future Dry-Run Scope

### Create Recipient Dry-Run

Validate a proposed new recipient. Compute the would-be normalized values,
duplicate candidate count, alias collision count, and timestamp behavior
without reserving an ID or inserting a row.

Create dry-run must not claim an exact future ID unless a separate ID strategy
has been approved.

### Update Recipient Dry-Run

Validate a proposed update for an existing recipient ID. Confirm the target
recipient exists, normalize proposed fields, compute duplicate candidate count
excluding the target ID, compute alias collision count, and report which field
presence booleans would change.

Update dry-run must not mutate `updatedAt`; it may report that `updatedAt`
would be refreshed by a later real write.

### Activate / Deactivate Recipient Dry-Run

Validate that the recipient exists and report the current active state, proposed
active state, and whether the action would be a no-op.

Deactivate dry-run should report transaction usage count as informational, since
deactivation is the current safe fallback for used recipients.

### Delete Recipient Dry-Run

Validate that the recipient exists and compute transaction usage count.

Expected outcomes:

- unused recipient: deletion would be allowed by the current Dexie behavior
- used active recipient: deletion should be blocked and deactivation suggested
- used inactive recipient: deletion should be blocked

Delete dry-run must not delete the recipient and must not expose transaction
rows.

### Merge Recipients Dry-Run

Validate primary and secondary recipient IDs. Confirm both exist and are
different. Compute:

- primary recipient ID
- secondary recipient ID
- transaction count currently referencing the secondary recipient
- whether the primary/secondary choice follows the current "more transactions
  wins" UI convention
- field-presence summary after combining values
- alias collision or alias-deduplication summary

Merge is higher risk than simple lookup writes because the real merge path
moves transaction `recipientId` references and deletes the secondary recipient.
The dry-run must not update transaction recipient references, update recipient
rows, delete recipients, or imply transaction-reference mutation is approved.

## Validation Rules To Preserve

The dry-run design should match current Dexie behavior unless a future approved
plan intentionally changes it.

Required validation:

- `name` is required after trimming.
- `accountNumber` requires a non-empty `paybill`.
- Create duplicate checks compare name case-insensitively, phone, paybill plus
  account number, and current till/phone behavior as implemented.
- Update duplicate checks exclude the current recipient ID.
- Alias input is semicolon-separated, lowercased for comparison, trimmed, and
  ignores empty aliases.
- Alias collisions across other recipients are validation errors.
- Optional text fields trim whitespace and become absent when empty.
- `isActive` defaults to `true` on create.
- `createdAt` is assigned on create.
- `updatedAt` is refreshed on create and update.
- Update, activate, deactivate, delete, and merge require existing IDs.
- Create must not accept a client-provided existing ID unless a later ID
  strategy explicitly allows it.
- Delete safety depends on transaction usage count.
- Merge safety depends on transaction usage count for the secondary recipient
  and must report transaction-reference impact.

Shape validation:

- Email, phone, till number, paybill, and account number should follow the
  current app's practical behavior first. If no strict regex is currently
  enforced, the dry-run should not invent one silently; it may return warnings
  for suspicious shapes only if documented.
- Name and alias comparisons should be deterministic and case-insensitive where
  current behavior is case-insensitive.
- Timestamps should be represented as would-change metadata, not as committed
  mutation timestamps.

## Candidate Endpoint Shapes

These routes are proposed shapes only. Do not implement them without explicit
approval.

- `POST /prototype/repositories/recipients/dry-run/create`
- `POST /prototype/repositories/recipients/dry-run/update`
- `POST /prototype/repositories/recipients/dry-run/deactivate`
- `POST /prototype/repositories/recipients/dry-run/delete`
- `POST /prototype/repositories/recipients/dry-run/merge`

Endpoint requirements if a later slice approves them:

- protected by the existing token middleware
- protected by the existing origin guard
- localhost-only prototype assumptions remain
- no wildcard CORS
- no token values in logs or responses
- no full SQLite paths in logs or responses
- no raw recipient rows unless a later design defines a redacted safe shape
- no transaction rows
- no mutation of SQLite, Dexie, files, or server state

## Request Shape Guidance

Dry-run requests should be explicit and small.

Create/update request fields:

- `name`
- `aliases`
- `email`
- `phone`
- `tillNumber`
- `paybill`
- `accountNumber`
- `description`
- target `id` for update only

Activate/deactivate/delete request fields:

- target `id`

Merge request fields:

- `primaryId`
- `secondaryId`

Do not accept raw backup rows, raw Dexie rows, arbitrary SQL, full transaction
objects, or client-provided audit logs.

## Response Shape Guidance

Responses should be summary-only and safe:

```json
{
  "ok": true,
  "mode": "prototype",
  "dryRun": true,
  "action": "create",
  "targetIds": {
    "recipientId": 123,
    "primaryId": 123,
    "secondaryId": 456
  },
  "validationErrors": [],
  "warnings": [],
  "normalizedSummary": {
    "hasName": true,
    "hasAliases": false,
    "hasEmail": false,
    "hasPhone": true,
    "hasTillNumber": false,
    "hasPaybill": false,
    "hasAccountNumber": false,
    "hasDescription": false,
    "isActive": true,
    "createdAtWouldChange": true,
    "updatedAtWouldChange": true
  },
  "affectedCounts": {
    "transactions": 0,
    "duplicateCandidates": 0,
    "aliasCollisions": 0
  },
  "resultCodes": []
}
```

Allowed detail:

- action name
- target IDs
- validation error codes
- warning codes
- normalized field presence booleans
- `isActive`
- affected transaction count for delete/merge
- duplicate candidate count
- alias collision count

Forbidden detail by default:

- raw recipient rows
- recipient names
- aliases
- email addresses
- phone numbers
- till numbers
- paybill values
- account numbers
- descriptions
- transaction rows
- token values
- SQLite paths

## Future Client Behavior

Any future dry-run UI must be behind a separate dev-only flag. Dry-run results
are informational. Actual writes remain Dexie-only until a later write endpoint
design is approved and implemented.

Client rules:

- no silent dual-write
- no background sync
- no automatic retry that mutates data
- no HTTP write call from normal Recipients controls
- no promotion from dry-run to real write without explicit user confirmation
- real Dexie writes must continue to require the existing user confirmation
  flow where applicable

## Gates Before Implementing Dry-Run Endpoints

- A fresh full backup is exported.
- Restore is tested or rollback instructions are verified.
- A disposable SQLite database is imported from the fresh backup.
- Recipients read experiment diagnostic passes.
- `npm run check:local-api-safety` passes.
- `npm run check:no-runtime-artifacts` passes.
- Server `verify:sqlite` passes with backup/sqlite arguments.
- Server `smoke:api` passes with token/token-file arguments.
- Endpoint implementation is explicitly approved.

## Gates Before Any Real Recipient Write

- Dry-run endpoint is implemented and tested.
- Dry-run behavior agrees with current Dexie validation.
- Restore path is tested.
- Explicit written rollback plan exists.
- Actual write endpoint design is approved separately.
- No transaction, budget, budget snapshot, report, SMS parsing, import, export,
  or restore writes are included.
- Merge transaction-reference mutation has a separate explicit approval if it
  is included.

## Not Allowed Yet

- No actual recipient write endpoint.
- No update/delete/merge mutation through HTTP.
- No Dexie-to-SQLite sync.
- No dual-write.
- No background reconciliation.
- No transaction recipient-reference mutation through HTTP.
- No production or local-network exposure assumptions.
- No repository write adapters.
- No Recipients write UI connected to HTTP.
- No committing `.env`, token, SQLite, backup, export, log, or report files.

## Open Questions For A Later Implementation Plan

- Should a dry-run compare against disposable SQLite only, current Dexie only,
  or both?
- If Dexie remains authoritative, should the dry-run be advisory rather than
  blocking?
- Should duplicate candidate counts follow the add/edit modal duplicate checks,
  the merge duplicate-pair algorithm, or both as separate result categories?
- How should dry-run timestamps be represented to avoid false precision?
- What audit record is needed for real writes without leaking contact details?
- How should merge dry-runs summarize would-be field merging without exposing
  contact values?

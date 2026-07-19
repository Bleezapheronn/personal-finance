# Write / Mutation Architecture Plan

This is a documentation-only plan for a future write and mutation phase. It
does not authorize implementation. It does not add write endpoints, repository
write adapters, schema changes, UI wiring, background sync, or any mutation of
Dexie, SQLite, budgets, transactions, or budget snapshots.

The read-path experiment phase is complete enough to define the next boundary:
read parity is not write approval. Dexie / IndexedDB remains authoritative.
SQLite remains disposable until an explicit authority migration is designed,
approved, implemented, backed up, and verified. Frontend HTTP repositories
remain read-only. The server-side real-write experiments are the flag-gated
recipient operations plus bucket/category and Account create/update operations;
no additional write endpoint should be added without a separate per-domain
design and approval.

Current read baseline:

- Baseline tag: `read-experiments-full-baseline`
- Flag-gated read experiments exist for Recipients, Buckets/Categories,
  Accounts, SMS Import Templates, Transactions, Reports, Budget, and Budget
  History.
- High-risk read paths have parity diagnostics for Transactions, Reports,
  Budget, and Budget History.
- Existing guardrails include the selected-read import guard, runtime artifact
  guard, `npm run check:local-api-safety`, manual parity diagnostics, fresh
  backup/import/API restart requirements, and rollback through env flag/backend
  switch plus Vite restart.

## Non-Negotiable Boundary

Until a future write phase is explicitly approved:

- Dexie remains the source of truth.
- SQLite remains disposable.
- Frontend HTTP repositories remain read-only.
- Read parity diagnostics do not authorize writes.
- Except for the explicitly approved recipient and bucket/category
  create/update experiments, no API route may create, update, delete,
  import, restore, repair, sync, or mutate financial data.
- No frontend repository may silently no-op write methods in HTTP mode.
- No screen may send mutations to HTTP except the explicitly flag-gated,
  dev-only Recipients, Buckets/Categories, and Accounts experiments.
- No budget snapshot lifecycle behavior may move to HTTP.

## Write Domains

Each write domain needs its own plan. Do not combine these into one broad
"enable writes" change.

### Lookup / Management Writes

Covered resources:

- recipients
- buckets/categories
- accounts
- SMS import templates

These are the lowest-risk candidates, but still not safe by default. A future
plan must define validation, duplicate handling, activation/deactivation
semantics, ordering/reorder behavior, account image/blob handling, SMS template
regex validation, and rollback. Buckets/categories need special attention for
display order and category-to-bucket references. Accounts need special
attention for image blobs, credit-account fields, currency handling, and any
transaction-derived usage checks.

The first domain-specific dry-run design is
[recipients-write-dry-run-design.md](recipients-write-dry-run-design.md). It is
documentation only and does not authorize Recipients write endpoints or
transaction recipient-reference mutation.

The first-slice Recipients dry-run endpoint implementation plan is
[recipients-dry-run-endpoint-implementation-plan.md](recipients-dry-run-endpoint-implementation-plan.md).
The create-recipient, update-recipient, activate-recipient, and
deactivate-recipient dry-run endpoints are implemented as validation-only,
non-mutating endpoints. Delete, merge, real writes, write adapters, dual-write,
and transaction recipient-reference mutation remain future work until
explicitly approved.

The Recipients real-write readiness gate is
[recipients-real-write-readiness-gate.md](recipients-real-write-readiness-gate.md).
It defines required decisions and hard gates before any real Recipients write
endpoint can be implemented.

The first operation-specific candidate plan is
[recipients-active-state-real-write-plan.md](recipients-active-state-real-write-plan.md),
covering active-state writes. Recipient activate is implemented as a
flag-gated, SQLite-only experiment. Recipient deactivate is implemented as a
flag-gated, SQLite-only experiment. Recipient create and update are implemented
as a separate flag-gated, SQLite-only experiment behind
`PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES=true`. Recipient
delete, merge, broad frontend write adapters, UI integration outside the
explicit dev-only experiment, dual-write, transaction recipient-reference
mutation, and authority migration remain future work.

The consolidated status for the completed Recipients dry-run and real-write
endpoint layer is
[recipients-real-write-implementation-summary.md](recipients-real-write-implementation-summary.md).

Buckets and Categories now have a separate accelerated, flag-gated experiment:
create/update dry-runs, SQLite-only real writes, and dev-only management UI
wiring. The server flag is
`PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES=true`; the frontend flag is
`VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true`. Both default
off. The HTTP UI path performs dry-run first and never mutates Dexie. Active
state, reorder, delete, cascade, transaction/budget/snapshot reference changes,
dual-write, and authority migration remain outside the approved boundary.

Accounts now have a separate accelerated, flag-gated create/update experiment.
The server flag is `PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES=true`; the frontend
flag is `VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT=true`. Both default
off, and the frontend HTTP path runs dry-run first. Create/update cover only
name, currency, credit classification, and optional credit limit. Account
images, description, active state, delete, merge, transaction/account
references, legacy payment-method links, reconciliation, balances, financial
aggregates, dual-write, and authority migration remain outside the boundary.

SMS Import Templates now have a separate accelerated, flag-gated experiment.
Create, update, activate, deactivate, and reference-safe delete use protected
dry-runs followed by disposable SQLite writes behind
`PERSONAL_FINANCE_ENABLE_SMS_TEMPLATE_WRITES=true`. Dev-only UI wiring is
separately gated by
`VITE_PERSONAL_FINANCE_SMS_TEMPLATES_WRITE_EXPERIMENT=true` and the
`http-readonly` backend. Pattern validation mirrors the current parser's fixed
case-insensitive regex syntax without running real SMS data. No template
priority, parser semantics, transactions, Accounts, Recipients, Dexie,
dual-write, or authority migration are changed.
Currency and `isCredit` changes are surfaced as financially significant but do
not mutate or reinterpret related records.

### Transaction Writes

Phase 1 implements dry-run and disposable SQLite write endpoints plus narrow
dev-only UI wiring for basic single-row income and expense create/update
operations. The server endpoints are disabled by default behind
`PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES=true`. The UI path is
separately disabled by default behind
`VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT=true` and runs only
with the `http-readonly` backend. Every UI write runs the dry-run first,
confirms the result through selected reads, and leaves Dexie authoritative.

Eligible rows have a correctly signed nonzero amount, an existing account,
category, category bucket, and recipient, and no transfer pairing, nonzero
transaction cost, legacy budget link, occurrence link, or budget snapshot
link. Create inserts exactly one transaction. Update changes only the fields
editable by the existing ordinary transaction form and preserves legacy,
transfer, cost, and budget-linkage columns. Transactions have no current
`createdAt` or `updatedAt` fields, so this phase does not invent timestamp
behavior.

Phase 2 extends the same routes and dev-only UI with a second backend and
frontend flag. It supports valid nonpositive `transactionCost` values and
link/change/unlink operations against existing valid budget snapshots only.
Financial effects use `amount + transactionCost`. `budgetSnapshotId` is
canonical; legacy `budgetId` and `occurrenceDate` are derived from the selected
snapshot. No Account, Budget, snapshot, lookup, or related transaction row is
mutated.

Transfers, paired rows, snapshot creation/generation/pruning/repair, transaction
delete, duplicate, bulk writes, CSV/import/export, SMS import, recurring
behavior, broad frontend write adapters, dual-write, and authority migration
remain deferred. The UI does not manually patch account balances, reports,
Budgets, or snapshots; derived values change only through selected transaction
data after refresh.

### Budget Writes

Covered actions:

- create/edit/delete budget
- completion/linking
- snapshot lifecycle
- generation/pruning/repair/dedupe

Budget writes are lifecycle-sensitive. A future plan must decide whether budget
changes can update future snapshots, how linked historical snapshots remain
stable, how completion and linked transaction state are represented, and which
operations are allowed to generate, prune, repair, dedupe, or update snapshots.
Do not expose any budget write endpoint until the snapshot lifecycle model is
specified and tested.

### Budget History / Snapshot Writes

Historical snapshots are sensitive records of budget occurrence state. They
must not be mutated through HTTP without a snapshot-specific plan.

Any future snapshot write plan must define:

- which snapshots are historical versus future/current
- which fields are immutable after transaction linkage
- how linked transactions affect `amountPaid` and completion display
- how repair/dedupe/generation/pruning are invoked, audited, and rolled back
- how accidental historical rewrites are detected before commit

No snapshot mutation, repair, dedupe, generation, pruning, coverage, creation,
or update endpoint is allowed yet.

### Reports

Reports do not need financial write endpoints. Future work may still need
plans for export behavior, chart drilldowns, saved report settings, or
server-side aggregate caching. Those are separate from data mutation and must
not imply transaction, budget, or snapshot writes.

## Required Architecture Decisions

Before any write code is implemented, the project needs explicit decisions for:

- Source of truth:
  Dexie-authoritative with HTTP mirror, SQLite-authoritative, dual-write, or
  a migration cutover.
- Conflict and retry strategy:
  How failed local/API writes are retried, surfaced, or rolled back.
- Backup-before-write requirement:
  What backup must exist before the first write prototype and before each
  high-risk write run.
- Audit/log strategy:
  What mutation metadata is recorded without exposing sensitive details in
  normal logs.
- Rollback strategy:
  How to return to Dexie-only behavior and how to restore data after a failed
  write experiment.
- Transaction and atomicity model:
  Which multi-row changes must commit together, especially transfers and
  budget snapshot linkages.
- ID generation strategy:
  Whether IDs remain Dexie-generated, SQLite-generated, client-provided, or
  reserved through an API.
- Date serialization strategy:
  How instant-like timestamps and local-day budget fields are serialized,
  validated, compared, and displayed.
- Validation strategy:
  Which layer validates required fields, references, amount signs, legacy
  compatibility defaults, and domain invariants.
- Error handling and user messaging:
  How validation failures, partial failures, retries, and rollback notices are
  shown without leaking tokens, paths, or raw sensitive data.
- Offline behavior:
  Whether offline remains Dexie-only, writes are queued, or HTTP write
  experiments require online/local-server availability.

## Not Allowed Yet

- No additional write endpoints beyond the explicitly approved, flag-gated
  recipient operations, bucket/category/Account operations, SMS Import
  Template CRUD/active-state operations, and transaction Phase 1/Phase 2
  create/update and atomic paired-transfer create/update operations.
- No broad repository write adapters.
- No dual-write.
- No background sync.
- No automatic Dexie-to-SQLite mutation sync.
- No budget snapshot lifecycle mutation through HTTP.
- No transfer delete, pair repair, bulk transfer mutation, or conversion
  between ordinary and transfer transactions through HTTP.
- No permanent switch to SQLite authority.
- No writes without a tested restore path.
- No no-op write methods in HTTP mode.
- No write UI connected to HTTP outside the explicit dev-only Recipients,
  Buckets/Categories, Accounts, SMS Import Templates, and Transactions
  experiments.
- No `.env`, token, SQLite, backup, export, log, or report files in Git.

## Proposed Safe Sequence

### Phase 0: Backup / Restore Rehearsal And Rollback Drill

- Export a fresh full backup.
- Confirm restore works in a controlled path before any write prototype.
- Confirm rollback instructions are written down.
- Confirm runtime artifacts remain outside the repo.

### Phase 1: Write API Design Docs Only

- Write per-domain designs before code.
- Define request/response shapes, validation, audit, rollback, and failure
  behavior.
- Keep server and frontend behavior unchanged.

### Phase 2: Validation-Only Dry-Run Endpoints, If Approved

- Add endpoints only after explicit approval.
- Dry-run endpoints may validate proposed mutations but must not write.
- Responses should be summary-only and avoid raw sensitive values where
  practical.
- Dry-run reports must stay outside Git.

### Phase 3: One Low-Risk Lookup Write Prototype

- Pick one low-risk lookup/management domain.
- Keep the prototype behind a dev-only flag.
- Require a fresh backup and rollback drill before testing.
- Do not include transactions, budgets, budget snapshots, reports, imports, or
  exports in this phase.

### Phase 4: Post-Write Parity / Diff Verification

- Compare Dexie, backup, and disposable SQLite after the write.
- Run read parity diagnostics again.
- Add write-specific diff tooling before trusting repeated writes.
- Treat every mismatch as a blocker until explained.

### Phase 5: Broader Writes Only After Evidence

- Expand one domain at a time.
- Transaction writes come much later.
- Budget writes come much later.
- Budget History and snapshot lifecycle writes come last, and only with a
  snapshot-specific plan.

## Gates Before The First Write Prototype

All gates below must be complete before any write prototype code is started:

- A fresh full app backup is exported.
- Restore from that backup is tested.
- A disposable SQLite database is imported from that same fresh backup.
- Read parity diagnostics pass against the fresh matching baseline.
- `verify:sqlite` passes with the backup/sqlite arguments.
- `smoke:api` passes with token/token-file arguments.
- `npm run check:local-api-safety` passes.
- `npm run check:no-runtime-artifacts` passes.
- An explicit per-domain write plan exists.
- Explicit rollback instructions exist.
- User approval is given before implementation.

## Rollback Expectations

Every write experiment must define rollback before implementation:

- how to disable the experiment flag
- how to return all screens to Dexie-only behavior
- how to restore from backup if data changes are wrong
- how to identify partial writes
- how to discard disposable SQLite state
- how to avoid committing generated reports, logs, backups, tokens, or
  databases

If rollback is not tested, the write experiment is not ready.

## Documentation Updates Required Later

When a specific write domain is approved, update this plan with a link to the
domain design. Also update the selected-read migration readiness audit and
local API frontend adapter notes so future agents can see the current phase
boundary without reading source code.

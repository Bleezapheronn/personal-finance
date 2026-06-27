# Data Model Notes

These notes document important invariants for future maintainers and AI coding agents. The active database is browser IndexedDB through Dexie, with table definitions and interfaces in `src/db.ts`.

## Core Tables

Current primary tables:

- `transactions`
- `budgets`
- `budgetSnapshots`
- `buckets`
- `categories`
- `accounts`
- `paymentMethods`
- `recipients`
- `smsImportTemplates`

Application code enforces relationships between records. IndexedDB does not enforce foreign keys.

## Transaction Invariants

- Expenses are stored as negative amounts.
- Income is stored as positive amounts.
- `transactionCost` is separate from `amount` and is usually negative.
- Transfers are represented as two transaction rows linked by `transferPairId`.
- `accountId` is the current account reference.
- `paymentChannelId`, `paymentMethodId`, and the `paymentMethods` table are legacy migration fields.
- `budgetSnapshotId` is canonical for budget linkage when present.
- `transaction.budgetId` is legacy or secondary when `budgetSnapshotId` exists.

## Transfer-Pair Safety

A valid transfer pair has exactly two transaction rows:

- one outgoing row with a negative amount
- one incoming row with a positive amount
- each row has `isTransfer === true`
- each row points to the other row through `transferPairId`

Important invariants:

- `transferPairId` must never equal the row's own `id`.
- Transfer pairs must be reciprocal.
- One side must be negative and one side must be positive.
- Editing a transfer updates both rows and verifies the reciprocal links before and after writing.

The transfer edit/write guard lives in `src/utils/transferPairs.ts` and is used by `src/pages/AddTransaction.tsx`. Keep relationship fields out of generic transfer content payloads; build explicit reciprocal patches at the write boundary.

## Budget Snapshot Caveats

Budget snapshots preserve occurrence details for budget items. They let transactions remain linked to the budget occurrence that existed at the time, even if the budget definition changes later.

Important caveats:

- Historical linked snapshots should not be casually rewritten.
- Future unlinked snapshots may be updated or regenerated only when the specific task allows it.
- `budgetSnapshotId` is the canonical transaction-to-budget link when present.
- The current snapshot model is functional, but it is due for future review.

Budget snapshot generation, pruning, and migration behavior is sensitive. Avoid touching it as part of unrelated changes.

## Backup and Health Assumptions

Full JSON backup and restore depend on preserving:

- all table rows
- primary keys and IDs
- typed dates
- blobs, including account images
- references between tables
- transfer pair consistency

The database health report checks likely integrity problems, including missing references, duplicate snapshots, transfer-pair problems, and orphaned budget snapshots.

## Known Future Work

- Investigate a browser-agnostic local database or backend so the active data store is not tied to one browser profile.
- Design a budget model v2, including clearer snapshot lifecycle rules.
- Review exchange-rate and transaction-cost handling for transfers.
- Continue adding low-risk validation around destructive or data-linking workflows.

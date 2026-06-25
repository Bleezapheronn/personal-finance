# Personal Finance — Agent Instructions

## Project identity

This is a personal finance tracker built as an offline-first Ionic React app. It contains real personal financial data. Treat data safety as the top priority.

## Stack

- Ionic React
- Vite
- TypeScript
- Dexie / IndexedDB
- Capacitor
- React Router
- Recharts

## Common commands

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test.unit`

Prefer running `npm run build` after TypeScript or data-model changes. Run `npm run lint` when practical.

## Current architecture

- The browser IndexedDB database is currently the source of truth.
- The Dexie database is defined in `src/db.ts`.
- The main tables are:
  - `transactions`
  - `budgets`
  - `budgetSnapshots`
  - `buckets`
  - `categories`
  - `accounts`
  - `paymentMethods` legacy/migration table
  - `recipients`
  - `smsImportTemplates`

## Critical data safety rules

- Do not delete, clear, reset, or overwrite user data unless explicitly instructed.
- Do not add destructive restore/import behavior without a dry-run validation step and explicit confirmation.
- Do not make database schema changes unless the migration impact is explained first.
- Do not modify budget snapshot behavior unless the task explicitly asks for it.
- Do not rewrite linked historical budget snapshots casually.
- Prefer read-only diagnostic tools before repair tools.

## Transaction invariants

- Expenses are stored as negative amounts.
- Income is stored as positive amounts.
- `transactionCost` is stored separately and is usually negative.
- Transfers are represented as two paired transactions linked by `transferPairId`.
- A valid transfer pair should have one outgoing negative transaction and one incoming positive transaction.
- `accountId` is the current account field.
- `paymentChannelId`, `paymentMethodId`, and `paymentMethods` are legacy migration fields.

## Budget and snapshot invariants

- `budgetSnapshotId` is the canonical budget linkage when present.
- `transaction.budgetId` is legacy/secondary and should not be treated as the primary linkage when `budgetSnapshotId` exists.
- Budget snapshots preserve budget occurrence details at the time of linkage or occurrence.
- Historical linked snapshots should remain stable after future budget edits.
- Future unlinked snapshots may be updated or regenerated only when the task explicitly allows it.

## Agent behavior

- Work in small, focused changes.
- Before editing, summarize the intended files and approach.
- Avoid unrelated refactors.
- Avoid formatting churn in unrelated files.
- Prefer adding new utilities over deeply rewriting existing logic.
- For safety tooling, start with read-only export/report functionality.
- If a requested change requires touching budget snapshot generation, stop and explain why before proceeding.

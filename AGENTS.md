# Personal Finance Agent Instructions

## Current architecture

- The local SQLite API and its authoritative profile are the current source of truth.
- Dexie/IndexedDB is a legacy compatibility path. Do not add new authoritative writes to Dexie.
- The local API is authenticated, capability-gated, and intended for local use.
- Read and mutation operations must use the existing repository contracts.
- See `docs/PROJECT_STATE.md` for the current project state and operating workflow.

## Critical data safety rules

- Do not delete, clear, reset, or overwrite user data unless explicitly instructed.
- Do not add destructive restore/import behavior without dry-run validation and explicit confirmation.
- Do not change the schema unless the migration impact is explained first.
- Do not modify budget snapshot behavior unless the task explicitly asks for it.
- Do not rewrite linked historical budget snapshots casually.
- Prefer read-only diagnostics before repair tools.
- Use dry-run-first validation, explicit confirmation, and exact-targeted atomic operations for mutations.
- Keep disposable SQLite copies and generated runtime artifacts outside Git.
- Never expose secrets, tokens, financial rows, backup contents, or full local paths in source, docs, logs, or reports.

## Financial invariants

- Expenses are negative; income is positive.
- `transactionCost` is stored separately and is usually negative.
- Transfers remain paired through `transferPairId`, with one outgoing negative and one incoming positive transaction.
- `accountId` is the current account field; payment-method fields are legacy migration fields.
- `budgetSnapshotId` is canonical when present; `transaction.budgetId` is legacy/secondary.
- Historical linked snapshots remain stable after future Budget edits.

## Agent behavior

- Work in small, focused changes and summarize intended files before editing.
- Preserve existing workflows and avoid unrelated refactors or formatting churn.
- Add focused tests for changed workflows and run the relevant root/server checks.
- If a requested change requires unexpected budget snapshot generation, pruning, repair, or schema work, stop and explain why.

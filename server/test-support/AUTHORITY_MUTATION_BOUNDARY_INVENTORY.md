# Authority mutation-boundary inventory

All live API paths whose URL contains `/write/` are fenced by the builder's
single instance-local `AuthorityMutationExecutor` before their handlers run.
The executor is the only production live-database owner permitted to construct
a writable connection or issue `BEGIN IMMEDIATE`.

| Live mutation family | Production helpers executed inside the outer fence |
| --- | --- |
| Ordinary transactions and reciprocal transfers | `transactionBasicWrite`, `transactionTransferWrite`, `transactionDelete` |
| Budget definitions and snapshots | `budgetDefinitionWrite`, `budgetLifecycle`, `budgetSnapshotGenerationWrite`, `budgetSnapshotOccurrence`, `budgetDelete`, `budgetFromTransaction` |
| Accounts | `accountWrite`, `accountLifecycle` |
| Buckets and categories | `bucketCategoryWrite`, `bucketLifecycle`, `categoryLifecycle` |
| Recipients | `recipientWrite`, `recipientLifecycle` |
| SMS import templates | `smsTemplateWrite` |

Helper-local `better-sqlite3` transactions become nested savepoints inside the
executor-owned outer transaction. A multi-table helper call therefore remains
one committed mutation-chain step.

Offline utilities are not live API writers. Import, hydration, cutover,
checkpoint, backup, and restore code runs only on explicit command paths and is
reviewed by `check-authority-write-boundary.mjs` through a small path allowlist.
The guard fails on any new direct `Database` construction, writer transaction,
or unrestricted writable acquisition outside that inventory.

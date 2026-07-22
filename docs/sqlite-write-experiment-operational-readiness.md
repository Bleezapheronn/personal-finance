# SQLite Write Experiment Operational Readiness

Status at `budget-snapshot-generation-phase1-complete-baseline`:
the current local SQLite write experiments are implemented, verified, and
safe to leave committed but disabled. Dexie / IndexedDB remains authoritative.
SQLite remains disposable. No authority migration, dual-write, or automatic
synchronization has occurred.

This document is the operational source of truth for pausing, recovering, and
resuming the current write-experiment phase, including the reversible SQLite
authority rehearsal. Detailed endpoint contracts remain in `server/README.md`
and the domain-specific implementation documents.

## Completed Capabilities

All mutation smoke modes listed below are explicit opt-ins. They passed against
outside-repository disposable SQLite databases. The corresponding browser
experiments also passed with the documented frontend and backend flags enabled.
All flags default off.

| Area | Supported SQLite writes | Unsupported or deferred writes | Backend flag | Frontend flag | Mutation smoke | Browser verification | Recovery boundary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Recipients | Create, update, activate, deactivate | Delete, merge, transaction recipient-reference mutation | `PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES=true`; `PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true` | `VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT=true` | Passed: create/update and active-state opt-in modes | Passed | Discard or re-import SQLite; Dexie recipient and transaction data is unaffected |
| Buckets | Create, update | Delete, reorder, active-state changes, cascade/reference rewrites | `PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES=true` | `VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true` | Passed: bucket/category opt-in mode | Passed | Discard or re-import SQLite; Dexie and related financial rows are unaffected |
| Categories | Create, update, including an existing bucket link | Delete, active-state changes, cascade/reference rewrites | `PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES=true` | `VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true` | Passed: bucket/category opt-in mode | Passed | Discard or re-import SQLite; Dexie and existing transaction/budget links are unaffected |
| Accounts | Create and update non-image fields: name, currency, credit classification, optional credit limit | Delete, merge, active-state changes, images, reference migration, reconciliation | `PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES=true` | `VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT=true` | Passed: Account opt-in mode | Passed, with image/icon omission remaining visible | Discard or re-import SQLite; Dexie, transactions, and derived balances are unaffected |
| Transactions | Ordinary income/expense create/update; nonpositive transaction costs; link/change/unlink existing budget snapshots; atomic paired-transfer create/update; dry-run-first ordinary one-row and verified reciprocal-pair two-row deletion | Duplicate, bulk/import/export writes, transfer-pair repair, one-sided transfer deletion, ordinary/transfer conversion, snapshot creation or repair | `PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES=true`; `PERSONAL_FINANCE_ENABLE_TRANSACTION_COST_BUDGET_WRITES=true`; `PERSONAL_FINANCE_ENABLE_TRANSACTION_TRANSFER_WRITES=true`; `PERSONAL_FINANCE_ENABLE_TRANSACTION_DELETE_WRITES=true` as required by the operation | `VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT=true`; `VITE_PERSONAL_FINANCE_TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT=true`; `VITE_PERSONAL_FINANCE_TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT=true`; `VITE_PERSONAL_FINANCE_TRANSACTIONS_DELETE_WRITE_EXPERIMENT=true` as required | Passed: basic, cost/budget-link, and transfer opt-in modes; deletion mode is an explicit disposable mutation run | Existing transaction experiments passed; deletion requires manual browser verification | Discard or re-import SQLite; Dexie transactions remain unchanged, while SQLite-derived totals must be treated as dirty until re-import |
| SMS Import Templates | Create, update, activate, deactivate, reference-safe delete | Parser priority changes, SMS-history execution/import, transaction mutation | `PERSONAL_FINANCE_ENABLE_SMS_TEMPLATE_WRITES=true` | `VITE_PERSONAL_FINANCE_SMS_TEMPLATES_WRITE_EXPERIMENT=true` | Passed: template CRUD/active-state opt-in mode | Passed | Discard or re-import SQLite; Dexie templates, SMS data, and transactions are unaffected |
| Budget Definitions | Create and update the definition row only | Delete, completion, transaction linking, lookup creation, every snapshot lifecycle mutation | `PERSONAL_FINANCE_ENABLE_BUDGET_DEFINITION_WRITES=true` | `VITE_PERSONAL_FINANCE_BUDGETS_WRITE_EXPERIMENT=true` | Passed: Budget definition opt-in mode | Passed | Discard or re-import SQLite; Dexie budgets, snapshots, Budget History, and transaction links are unaffected |
| Budget Snapshot Generation | Deterministic insert of missing occurrences only | Existing-row update, pruning, delete, repair, dedupe, historical rewrite, transaction relinking, automatic scheduling | `PERSONAL_FINANCE_ENABLE_BUDGET_SNAPSHOT_GENERATION_WRITES=true` | None; protected endpoint/CLI only | Passed: generation and repeated idempotency opt-in mode | Manual UI action intentionally omitted | Discard or re-import SQLite; Dexie snapshots remain unchanged and SQLite Budget History is dirty until re-import |
| Budget Lifecycle Policy v1 | Atomic definition create/update, target-Budget inclusive current/future unlinked cleanup, and one-year active coverage | Global pruning, linked/historical rewrite, page-load migration, dedupe, orphan repair, relinking, delete, automatic checkpoints | `PERSONAL_FINANCE_ENABLE_BUDGET_LIFECYCLE_WRITES=true` | `VITE_PERSONAL_FINANCE_BUDGET_LIFECYCLE_WRITE_EXPERIMENT=true` | Focused active/inactive, immutable-link, conflict, and idempotency checks; explicit opt-in API mutation mode | Manual dry-run and confirmation only | Stop services and rotate the authority checkpoint; otherwise restore the prior checkpoint/native backup or re-import SQLite. Dexie is unchanged |

## Hard Boundaries

- Dexie / IndexedDB remains authoritative.
- SQLite is disposable and must stay outside the repository.
- There is no dual-write.
- There is no automatic Dexie-to-SQLite or SQLite-to-Dexie synchronization.
- The default repository backend remains `dexie`; missing or unknown backend
  configuration falls back to Dexie.
- A narrow write UI requires either its individual frontend flag with the
  `http-readonly` backend or the fully ready `http-sqlite-rehearsal` mode.
- Every real SQLite write endpoint requires its explicit backend flag.
- Successful mutation smoke or browser write testing dirties the configured
  SQLite database.
- Normal `smoke:api` is non-mutating. Mutation smoke must be explicitly
  requested and must use a disposable database.
- No write experiment changes Dexie, makes SQLite authoritative, or proves that
  the current browser-token model is suitable outside local development.

Transaction deletion is a separate optional capability rather than an
authority-baseline requirement. Older cutover and checkpoint manifests retain
their original ten required capabilities and remain structurally valid when
deletion is disabled. An ordinary delete removes one transaction row; a valid
reciprocal transfer delete removes both rows atomically. Malformed pairs fail
closed without repair, and linked Budget snapshots and all lookup rows remain
unchanged. A successful authoritative deletion changes the active logical
fingerprint. Keep services stopped after the write and manually create and
verify the next checkpoint before restart; deletion never rotates a checkpoint
or edits a manifest automatically.

## Reversible Authority Rehearsal

The rehearsal is a controlled local-dev mode, not a permanent migration. It is
disabled unless both of these exact frontend settings are present:

```text
VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-sqlite-rehearsal
VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL=true
```

The protected read-only capability check must also report all ten existing
backend write flags enabled and disposable SQLite available. Any missing flag,
unavailable API, invalid token/origin, malformed response, or unavailable
SQLite keeps every mutation control disabled. Reads may remain on HTTP, but the
app never falls back to Dexie writes or partially enables domains.

When ready, the mode reuses only the existing selected-read repositories and
narrow dry-run-first write helpers. A persistent global banner identifies ready
or blocked status. Dexie startup migrations are skipped, and Dexie-only
Settings and direct Transaction Details routes are blocked for the session.
All known unsupported operations in this document remain unavailable.

The read-only readiness command is:

```powershell
npm run verify:sqlite-rehearsal
```

It calls health, metadata, write capabilities, and row counts using the
existing ignored local Vite API configuration. It performs no mutation and
prints no token, URL, path, filename, row, or raw response.

## Known Gaps

The following work is intentionally unsupported or deferred:

- Recipient delete, merge, and transaction recipient-reference reassignment.
- Bucket or Category delete, bucket reorder, unsupported active-state changes,
  cascades, and reference rewrites.
- Account delete, merge, active-state changes, image writes, reconciliation,
  and transaction/account reference migration.
- Transaction duplicate/bulk/import/export mutation, one-sided transfer
  deletion, transfer-pair repair, and conversion between ordinary and transfer
  transactions. Phase 1 deletion supports only an eligible ordinary row or a
  fully verified reciprocal pair.
- Budget-definition delete, completion, transaction linking, and lookup
  creation from the HTTP write path.
- Budget snapshot update, pruning, dedupe, repair, backfill, editing, deletion,
  historical rewriting/relinking, and automatic scheduling. Phase 1 supports
  only manual deterministic insertion of missing occurrences.
- SMS parsing/import execution and transaction mutation from the template write
  path.
- General-purpose frontend write repositories, offline write queues, conflict
  resolution, background synchronization, and authority migration.

## Clean Recovery Procedure

Use this procedure after any successful write smoke or browser write
experiment, and before trusting parity diagnostics again.

1. Stop Vite and the local API server.
2. Preserve or export a fresh full backup from the Dexie-authoritative app.
3. Delete or archive the disposable SQLite database and its
   `.import-summary.json`. Keep both outside the repository.
4. From `server/`, import that exact backup into a new disposable database:

   ```powershell
   npx tsx src/importBackup.ts --input <backup> --output <sqlite>
   ```

5. From `server/`, verify the exact backup/database pair:

   ```powershell
   npx tsx src/verifySqlitePrototype.ts --backup <backup> --sqlite <sqlite>
   ```

6. Require all six verification groups to pass: row counts, structural
   integrity, financial aggregates, report totals, transaction samples, and
   Budget History parity.
7. Start the local API with `PERSONAL_FINANCE_SQLITE_PATH` pointing to that
   exact SQLite database. Do not enable mutation flags for a clean baseline.
8. Run normal non-mutating smoke:

   ```powershell
   npm run smoke:api -- -- --token-file <token-file>
   ```

9. Confirm the ignored `.env.local` uses
   `VITE_PERSONAL_FINANCE_LOCAL_API_URL` with the local API's matching port.
   Keep the repository backend and experiment flags appropriate for the test.
10. Restart Vite after every `VITE_` environment change.
11. Never commit `.env.local`, tokens, SQLite databases, backups, import
    summaries, exports, logs, or generated reports.

Stale or previously mutated SQLite can produce false parity, ordering, report,
or browser-diagnostic mismatches. A clean import must always come from the same
fresh backup used for verification.

## Rollback Procedure

1. Set `VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie` and disable
   `VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_REHEARSAL`.
2. Disable all individual frontend write-experiment flags:
   - `VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_SMS_TEMPLATES_WRITE_EXPERIMENT`
   - `VITE_PERSONAL_FINANCE_BUDGETS_WRITE_EXPERIMENT`
3. Restart Vite.
4. Stop the local API if it is no longer needed.
5. Delete or re-import disposable SQLite if it was mutated.
6. Use the Git experiment baseline tags as source-code rollback points.

SQLite-only experiment writes do not mutate Dexie. Returning the frontend to
Dexie restores the normal authoritative app path without copying experimental
SQLite changes into IndexedDB.

## SQLite-Native Recovery Rehearsal

SQLite-native backup and restore tooling now provides a bounded recovery
rehearsal for the disposable store. This is recovery evidence for the
prototype, not authority migration approval.

Before backup, stop the local API or ensure every SQLite write capability is
disabled. SQLite's online backup API creates a transactionally consistent
destination, but a logical write concurrent with the operation makes the
source before/after verification fail closed. Raw filesystem copy is not an
approved backup method because journal or WAL state may be required for a
consistent image.

From `server/`, create the native backup and redacted manifest at fresh paths
outside the repository:

```powershell
npm run backup:sqlite -- -- --source <source.sqlite> --output <backup.sqlite>
```

Then restore to another fresh outside-repository path:

```powershell
npm run restore:sqlite-rehearsal -- -- --backup <backup.sqlite> --manifest <backup.sqlite.manifest.json> --output <restored.sqlite>
```

Neither command overwrites an existing file or permits source/output aliases.
The backup verifies source immutability and source-to-backup equivalence. The
restore verifies the backup against its manifest, verifies the backup did not
change during restore, and verifies the restored database against both.
Logical verification covers integrity check, schema and known tables, counts,
content fingerprints, financial aggregates, report totals, Budget History,
transfer integrity, and Budget snapshot linkage. No Budget snapshot lifecycle
helper runs and no source row is mutated.

The manifest intentionally contains only fingerprints, counts, derived
summaries, and timestamps. It has no full paths or raw financial rows, but it
is still a generated runtime artifact and must stay outside Git. The recorded
destination-local SQLite `schema_version` and journal mode are diagnostic
metadata; exact logical equality is based on schema fingerprint,
`user_version`, table content, and derived summaries.

Recovery acceptance requires all of the following:

1. Native backup and restore commands report pass.
2. The original source identity remains unchanged.
3. Normal non-mutating `smoke:api` passes against the restored database.
4. All enabled-capability authority-rehearsal checks pass against the restored
   database when that mode is being rehearsed.
5. `verify:sqlite` passes against the exact matching Dexie full backup when
   available.
6. No SQLite, manifest, report, log, token, backup, or environment artifact
   appears in the repository.

To rehearse rollback with the verified restore: stop the API, preserve the
current disposable database at a separate outside-repository path, point
`PERSONAL_FINANCE_SQLITE_PATH` at the fresh verified restore, start the API on
a unique local port, run normal non-mutating `smoke:api`, then run
`verify:sqlite-rehearsal`. Stop the API after the rehearsal. Do not replace or
rename a configured database underneath a running API process.

The original full JSON backup/import workflow remains an independent clean
bootstrap and parity path from the Dexie-authoritative store. A native SQLite
backup is useful for preserving experimental SQLite mutations, but it does
not replace the Dexie recovery path or transfer authority to SQLite.

If any check fails, discard the incomplete backup/restored outputs, keep Dexie
authoritative, and create a fresh disposable SQLite import before retrying.
Never replace the API's configured database while the API is running.

## Authority Cutover Phase 1

Phase 1 adds an explicit `http-sqlite-authoritative` mode without changing the
default. Missing or unknown frontend backend configuration still resolves to
Dexie. Authority requires both sides to opt in:

```text
VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-sqlite-authoritative
VITE_PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED=true
PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED=true
PERSONAL_FINANCE_SQLITE_CUTOVER_MANIFEST_PATH=<outside-repo manifest>
```

Vite and the API must be restarted after configuration changes. The browser
never receives the configured SQLite or manifest path. Server startup verifies
the active candidate and the mandatory pre-cutover native backup against the
redacted manifest, then verifies every required capability. Any failure leaves
the frontend on HTTP reads in a blocked state, disables all mutation controls,
and prevents server mutation routes from running. There is no fallback to
Dexie writes and no mixed persistence.

Prepare cutover from `server/`:

```powershell
npm run prepare:sqlite-authority-cutover -- -- --backup <matching-full-backup.json> --sqlite <candidate.sqlite> --backup-output <pre-cutover-backup.sqlite> --manifest <cutover-manifest.json>
```

The matching full backup, candidate, backup, and manifest must be different,
outside-repository paths. The native backup and cutover manifest must share a
directory because the manifest records only the backup basename. Outputs must
not exist. Preparation first runs the complete six-part backup-to-SQLite
verification suite, then checks the current prototype schema contract and
zero structural-integrity issue counts. It creates and verifies a native
backup without changing the candidate or any environment file. The manifest
contains parity status, fingerprints, counts, capability and
unsupported-operation names, backup verification, and a rollback instruction
identifier only. It contains no raw rows, names, descriptions, contacts,
tokens, environment values, or full paths.

Run the read-only startup gate against the running API:

```powershell
npm run verify:sqlite-authority -- -- --token-file <token-file>
```

In verified authoritative mode, selected reads and the already implemented
narrow SQLite writes are used without individual frontend experiment flags.
Dexie startup migrations, page-entry snapshot generation/pruning, Settings,
Transaction Details, and Dexie-touching diagnostics remain blocked or bypassed.
Snapshot generation remains only the explicit protected SQLite operation; it
does not run automatically.

All unsupported operations listed above remain unavailable. In particular,
authority does not enable recipient delete/merge, lookup deletion/reorder,
Account reference migration, Transaction deletion or transfer repair, Budget
deletion, snapshot edit/delete/prune/repair/relink, SMS import mutation, or any
fallback to a Dexie implementation.

Rollback remains operator-driven:

1. Stop Vite and the API.
2. Create a native backup and manifest for the current authoritative SQLite.
3. Run `verify:sqlite-authority-rollback` with current SQLite, the cutover
   manifest, and the current backup pair.
4. Set the frontend backend to `dexie` and disable its authority flag.
5. Disable the server authority flag.
6. Restart Vite and confirm Dexie remains unchanged.
7. Preserve authoritative SQLite, the pre-cutover backup, the current-state
   backup, and manifests outside Git for future reconciliation.

Phase 1 is local and reversible, but it is not synchronization. SQLite changes
are not copied into Dexie, and reconciliation remains a separate future
project. The cutover manifest is immutable and content-bound. Once a supported
authoritative write changes SQLite, restarting against that original manifest
fails closed. Before ending the rehearsal session, create and verify the
post-write native backup, then return to Dexie mode. A future long-lived
authority phase needs a separately approved checkpoint or reconciliation
design; Phase 1 does not silently bless changed content.

## Authority Checkpoint Rotation Phase 2

Checkpoint rotation is an explicit offline operator step for preserving and
authorizing supported writes made after a prior authority checkpoint. It does
not edit an old manifest, overwrite an old backup, schedule work, run after
each write, or change the default Dexie backend.

There is no reliable application write-quiescing switch. Use this required
quiet-period procedure:

1. Stop Vite and the API.
2. Confirm the current SQLite, predecessor authority manifest, and predecessor
   backup are preserved outside Git.
3. Create the next checkpoint at fresh output paths:

   ```powershell
   npm run create:sqlite-authority-checkpoint -- -- --sqlite <current.sqlite> --current-manifest <current-authority-manifest.json> --backup-output <next-checkpoint.sqlite> --manifest-output <next-checkpoint.json> [--label <safe-label>]
   ```

4. Verify the new checkpoint and the explicit chain:

   ```powershell
   npm run verify:sqlite-authority-checkpoint -- -- --manifest <next-checkpoint.json> --sqlite <current.sqlite>
   npm run verify:sqlite-authority-checkpoint-chain -- -- --manifest <checkpoint-0.json> --manifest <checkpoint-1.json> [--manifest <checkpoint-n.json>] --sqlite <current.sqlite>
   ```

5. Configure the API with the same current SQLite and the new manifest, start
   it, and run `verify:sqlite-authority`.
6. Start Vite in authoritative mode, confirm the persistent banner and expected
   data, then resume writes.

SQLite online backup captures a transactionally consistent state, but writes
that commit after that snapshot are not represented. That is why the services
must stay stopped until the new checkpoint is the configured, verified startup
state.

The original Phase 1 manifest is checkpoint `0`. Its stable lineage ID and
checkpoint ID are derived from canonical non-sensitive manifest facts without
rewriting it. Later manifests use version 2, retain the lineage, increase the
sequence by one, and reference the prior checkpoint ID without recording its
path. They include logical database and native-backup verification, table and
derived fingerprints, integrity summaries, schema/user versions, capability
contracts, a backup basename, status, and a recovery-note identifier. Optional
labels are restricted to short alphanumeric, dot, underscore, and hyphen text.

The checkpoint creator validates that the supplied predecessor manifest and
its adjacent backup are real members of the stated lineage. Since SQLite does
not contain an embedded lineage marker, it cannot cryptographically prove that
an arbitrarily supplied current database descended from that predecessor once
legitimate writes have changed its fingerprint. The required stopped-service
procedure, explicit predecessor selection, supported schema contract, zero
structural/history conflict counts, immutable files, and subsequent chain and
startup verification are the Phase 2 provenance boundary.

Rollback to a selected SQLite checkpoint remains non-destructive:

1. Stop Vite and the API.
2. Preserve the newer current SQLite with a native backup and manifest when
   possible.
3. Restore the selected checkpoint backup into a fresh database path using its
   matching authority manifest:

   ```powershell
   npm run restore:sqlite-rehearsal -- -- --backup <selected-checkpoint.sqlite> --manifest <selected-checkpoint.json> --output <fresh-restored.sqlite>
   ```

4. Configure the fresh restored path and selected checkpoint manifest.
5. Start the API and run authority verification.
6. Start Vite, confirm expected data, and retain every newer database,
   checkpoint, and backup for possible reconciliation.

Rollback to unchanged Dexie remains the Phase 1 procedure. Phase 2 adds no
automatic backup retention, checkpoint deletion, synchronization, dual-write,
cloud upload, arbitrary filesystem endpoint, UI path picker, schema migration,
snapshot pruning/repair, or new entity mutation route.

## Not Ready For Authority Migration

SQLite must not become authoritative until all of the following are complete:

- Every required everyday mutation has an intentional, supported, tested path.
- Remaining Budget snapshot lifecycle ownership (pruning, repair, historical
  policy, and automatic scheduling) is designed and verified.
- Delete, merge, cascade, reference-migration, and repair decisions are
  resolved.
- A synchronization design or one-time authority migration design exists.
- Full backup and restore are proven for the proposed authoritative store.
- Default-backend cutover and rollback are rehearsed with explicit recovery
  criteria.
- Application-wide end-to-end testing passes for reads, writes, offline
  behavior, failures, retries, and recovery.
- Security is redesigned for the intended deployment context; the current
  browser token is a local-development prototype constraint.

Passing the current smokes and parity checks proves only the bounded disposable
experiments. It does not approve authority migration.

## Safe Pause Point

The current experiments may remain committed while all experiment flags stay
disabled. Normal Dexie application behavior remains available, and the local
API does not need to keep running. Future work can resume from
`sqlite-write-experiments-safe-pause-baseline` after creating a fresh matching
backup/SQLite baseline and rerunning the documented gates.

This is an acceptable stopping point before moving to other projects.

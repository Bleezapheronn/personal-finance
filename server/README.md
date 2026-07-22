# Local API Prototype Server

This is a prototype-only local API skeleton. It currently exposes only:

- `GET /health`
- `GET /metadata`
- `GET /prototype/write-capabilities`
- `GET /prototype/sqlite/row-counts`
- `GET /prototype/sqlite/tables/:tableName`
- `GET /prototype/repositories/transactions`
- `GET /prototype/repositories/transactions/:id`
- `GET /prototype/repositories/transactions/count`
- `GET /prototype/repositories/budgets`
- `GET /prototype/repositories/budgets/:id`
- `GET /prototype/repositories/budgets/:id/snapshots`
- `GET /prototype/repositories/budget-snapshots`
- `GET /prototype/repositories/budget-snapshots/:id`
- `POST /prototype/repositories/budget-snapshots/lifecycle/dry-run/generate`
- `POST /prototype/repositories/budget-snapshots/lifecycle/write/generate` (experimental, disabled by default)
- `GET /prototype/repositories/accounts`
- `GET /prototype/repositories/accounts/:id`
- `POST /prototype/repositories/accounts/dry-run/create`
- `POST /prototype/repositories/accounts/dry-run/update`
- `POST /prototype/repositories/accounts/write/create` (experimental, disabled by default)
- `POST /prototype/repositories/accounts/write/update` (experimental, disabled by default)
- `GET /prototype/repositories/buckets`
- `GET /prototype/repositories/buckets/:id`
- `GET /prototype/repositories/categories`
- `GET /prototype/repositories/categories/:id`
- `GET /prototype/repositories/recipients`
- `GET /prototype/repositories/recipients/:id`
- `POST /prototype/repositories/recipients/write/create` (experimental, disabled by default)
- `POST /prototype/repositories/recipients/write/update` (experimental, disabled by default)
- `POST /prototype/repositories/recipients/write/activate` (experimental, disabled by default)
- `POST /prototype/repositories/recipients/write/deactivate` (experimental, disabled by default)
- `POST /prototype/repositories/buckets/dry-run/create`
- `POST /prototype/repositories/buckets/dry-run/update`
- `POST /prototype/repositories/buckets/write/create` (experimental, disabled by default)
- `POST /prototype/repositories/buckets/write/update` (experimental, disabled by default)
- `POST /prototype/repositories/categories/dry-run/create`
- `POST /prototype/repositories/categories/dry-run/update`
- `POST /prototype/repositories/categories/write/create` (experimental, disabled by default)
- `POST /prototype/repositories/categories/write/update` (experimental, disabled by default)

The backend normally opens configured disposable SQLite read-only for prototype
diagnostics. Explicit writes are narrow, domain-specific, and disabled by
default. The browser IndexedDB database remains authoritative. Snapshot
generation is manual and insert-only; no pruning, repair, rewrite, relinking,
or automatic scheduling exists. There is no broad write repository,
dual-write, or SQLite authority migration.

## Safety

Do not put real finance data, SQLite database files, backups, exports, logs, local tokens, or runtime data in this folder.

Runtime data belongs outside the repository, with `C:\dev\personal-finance-data` as the suggested local folder.

The local API token is stored outside the repository at:

```text
<dataDir>\.server-token
```

By default, `<dataDir>` is `C:\dev\personal-finance-data`. You can override it with `PERSONAL_FINANCE_DATA_DIR`.

The optional disposable SQLite database path is configured with:

```text
PERSONAL_FINANCE_SQLITE_PATH
```

Point this only at a verified disposable SQLite database outside the repository.

## Commands

Install server dependencies from this folder:

```bash
npm install
```

Run the prototype server in development:

```bash
npm run dev
```

Build the server:

```bash
npm run build
```

Start the compiled server:

```bash
npm run start
```

The server binds to `127.0.0.1` only. The default port is `3147`.

## Schema Draft

The future disposable SQLite prototype schema is documented, but no SQLite runtime code or database files exist yet:

- [schema/prototype-schema.sql](schema/prototype-schema.sql)
- [docs/sqlite-schema-notes.md](docs/sqlite-schema-notes.md)

## Import And Comparison Designs

Backup import and comparison tooling are documented here. The importer and row-count comparison CLIs are prototype-only, and no financial API endpoints exist:

- [docs/backup-import-design.md](docs/backup-import-design.md)
- [docs/comparison-report-design.md](docs/comparison-report-design.md)

## Disposable Backup Importer

The prototype importer creates a disposable SQLite database from a full JSON backup. Dexie / IndexedDB remains authoritative, and no API routes expose imported financial data.

Use only backup input and SQLite output paths outside the repository. The generated `<output>.import-summary.json` should also be treated as sensitive and kept outside the repository.

Example:

```bash
npm run import:backup -- -- --input C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --output C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite
```

If the disposable output already exists, replace it explicitly:

```bash
npm run import:backup -- -- --input C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --output C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --overwrite-disposable
```

The importer refuses repo-local output unless `--allow-repo-output-for-tests` is supplied. Do not use that flag for real backups.

## Row-Count Comparison

The first comparison CLI checks only full-backup table lengths, optional backup `integrity.counts`, and row counts in a disposable SQLite database. It opens SQLite read-only and does not expose row-level financial data.

Keep backup files, SQLite databases, and comparison reports outside the repository. Reports contain only counts and basenames, but should still be treated as local data artifacts.

Example:

```bash
npm run compare:counts -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\row-count-comparison.json
```

The comparison report output is optional. If supplied, repo-local output is refused unless `--allow-repo-output-for-tests` is supplied.

## Structural Integrity Comparison

The structural comparison CLI checks transfer-pair integrity and budget snapshot link integrity for a full backup and a disposable SQLite database. It compares count-level issue summaries only; it does not print transaction descriptions, account names, amounts, or raw rows.

Matching issue counts mean the import preserved the same structural state. They do not prove the source data is healthy. If backup and SQLite both contain the same issue count, the comparison can pass while still reporting source issues.

Keep generated reports outside the repository:

```bash
npm run compare:integrity -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\structural-integrity-comparison.json
```

## Financial Aggregate Comparison

The financial aggregate comparison CLI checks monthly transaction totals and account balances between a full backup and disposable SQLite database. It compares aggregate values only; it does not print raw transactions, account names, descriptions, or recipient names.

Monthly totals include transfers, matching the app's normal transaction/report aggregation. Account balances are calculated by account ID as `amount + transactionCost`. Aggregate values are rounded to 2 decimals before exact comparison to match cents-level currency precision.

Financial aggregate reports contain sensitive financial totals and must remain outside the repository:

```bash
npm run compare:financial -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\financial-aggregate-comparison.json
```

## Report Totals Comparison

The report totals comparison CLI checks top-level monthly, quarterly, and yearly report totals between a full backup and disposable SQLite database. It mirrors the current report formula for `totalIncome`, `totalExpense`, and `netTotal`: transactions contribute `amount + transactionCost`, the first bucket with `excludeFromReports` is treated as income, and transfers are included like normal transaction rows.

This slice intentionally does not compare bucket totals, category breakdowns, report labels, chart layout, or raw rows. Report totals are rounded to 2 decimals before exact comparison. Generated reports contain aggregate financial data and must remain outside the repository:

```bash
npm run compare:reports -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\report-totals-comparison.json
```

## Transaction Sample Comparison

The transaction sample comparison CLI checks selected transaction rows from a full backup against a disposable SQLite database. It compares field-level import parity for IDs, dates, numeric fields, references, transfer linkage, and budget snapshot linkage without printing raw transaction rows.

If `--ids` is provided, only those transaction IDs are compared. Without `--ids`, the CLI chooses a deterministic sample from the backup covering representative cases where available, including expense, income, transfer, transaction cost, original currency fields, budget snapshot linkage, oldest transaction, and recent transaction.

Console output is summary-only. JSON reports include transaction IDs and mismatch field names. Raw `description` and `transactionReference` values are never written; those fields are reported only by presence and match status. Reports may still contain sensitive transaction IDs and field-level financial values, so keep them outside the repository:

```bash
npm run compare:transactions -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --sample-size 12 --output C:\dev\personal-finance-data\temp\transaction-sample-comparison.json
```

Explicit IDs:

```bash
npm run compare:transactions -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --ids 1,2,3 --output C:\dev\personal-finance-data\temp\transaction-sample-comparison.json
```

## Budget History Comparison

The Budget History comparison CLI checks read-only occurrence summaries derived from budget snapshots and linked transactions. It compares backup-derived summaries to disposable SQLite-derived summaries without invoking frontend snapshot lifecycle helpers, generating missing snapshots, pruning duplicates, or mutating data.

The comparison mirrors the current Budget History page at the summary level: past snapshots only, live-budget joins by `budgetId`, dedupe by budget and local due date, linked transactions by `budgetSnapshotId`, `amount + transactionCost` totals, and the fixed `goalDirection: null` fallback to amount sign. It does not compare UI grouping labels, layout, styling, names, descriptions, or raw rows.

Budget History reports contain financial aggregates and IDs. Keep reports outside the repository:

```bash
npm run compare:budget-history -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\budget-history-comparison.json
```

## Full SQLite Prototype Verification

The run-all verification CLI executes the existing comparison checks in order: row counts, structural integrity, financial aggregates, report totals, transaction samples, and Budget History parity. It is verification tooling only, not migration approval. Dexie / IndexedDB remains authoritative, and the SQLite database remains disposable.

Generated reports may contain aggregate financial data, transaction IDs, and other local verification details. Keep the output directory outside Git. A recommended location is:

```text
C:\dev\personal-finance-data\temp\verification
```

Example:

```bash
npm run verify:sqlite -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output-dir C:\dev\personal-finance-data\temp\verification
```

The `--sample-size` option applies to transaction sample and Budget History comparison output:

```bash
npm run verify:sqlite -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --sample-size 20 --output-dir C:\dev\personal-finance-data\temp\verification
```

## SQLite-Native Backup And Restore Rehearsal

The native backup CLI uses SQLite's online backup API rather than copying the
database file. This produces a consistent backup even when SQLite journal
files exist. For an operational rehearsal, stop the API first or start it with
all write flags disabled. The tool fails closed if the source's logical
fingerprint changes while the backup is running.

Source, backup, manifest, and restored database paths must remain outside the
repository. Existing outputs are never overwritten, and source/output path
aliases are rejected. Create a backup and redacted verification manifest:

```powershell
npm run backup:sqlite -- -- --source C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\backups\personal-finance-prototype-native.sqlite
```

Restore only to a fresh path and require the matching manifest:

```powershell
npm run restore:sqlite-rehearsal -- -- --backup C:\dev\personal-finance-data\backups\personal-finance-prototype-native.sqlite --manifest C:\dev\personal-finance-data\backups\personal-finance-prototype-native.sqlite.manifest.json --output C:\dev\personal-finance-data\temp\personal-finance-prototype-restored.sqlite
```

Both commands verify `PRAGMA integrity_check`, schema and table identities,
row counts, deterministic table-content fingerprints, financial aggregates,
report totals, Budget History summaries at a fixed local day, transfer and
snapshot-link integrity, and source immutability. The manifest contains
fingerprints, counts, summary data, and timestamps only; it contains no paths,
raw rows, names, descriptions, references, tokens, or SQLite content. It is
still a generated runtime artifact and must remain outside Git.

SQLite assigns a destination-local `schema_version` cookie during native
backup. The manifest records it for diagnostics, while logical equivalence
requires the schema fingerprint and `user_version` to match exactly. Journal
mode is also recorded but is not treated as logical content.

After restore, point a separately started API process at the restored database
and run normal `smoke:api`. Run `verify:sqlite` with the matching Dexie full
backup when one is available. A restored database is still disposable and
does not make SQLite authoritative. Run the focused no-data test suite with:

```powershell
npm run test:sqlite-backup-restore
```

## SQLite Authority Cutover Phase 1

Authority cutover is an explicit local operator workflow. It is disabled by
default, does not edit environment files, does not update Dexie, and does not
add synchronization or dual-write. Prepare a verified candidate only while
the API is stopped or every mutation flag is disabled:

```powershell
npm run prepare:sqlite-authority-cutover -- -- --backup C:\dev\personal-finance-data\backups\matching-full-backup.json --sqlite C:\dev\personal-finance-data\temp\candidate.sqlite --backup-output C:\dev\personal-finance-data\backups\candidate-pre-cutover.sqlite --manifest C:\dev\personal-finance-data\backups\candidate-cutover-manifest.json
```

The command first compares the candidate to the supplied matching Dexie full
backup using all six existing `verify:sqlite` checks. It then verifies zero
structural-integrity issues, the current schema contract and user version, all
known table counts and fingerprints, financial/report/Budget History
summaries, transfer integrity, and transaction-to-snapshot linkage. It creates
and verifies a native pre-cutover backup before writing the redacted manifest.
All paths must be outside the repository and all outputs must be new. The
native backup and cutover manifest must be in the same directory because only
the backup basename is recorded.

To start the server in authoritative mode, configure all ten existing write
capabilities plus:

```text
PERSONAL_FINANCE_SQLITE_PATH=<verified candidate>
PERSONAL_FINANCE_SQLITE_AUTHORITY_ENABLED=true
PERSONAL_FINANCE_SQLITE_CUTOVER_MANIFEST_PATH=<cutover manifest>
```

The server verifies the active database, adjacent pre-cutover backup,
manifest, and capabilities before listening. It exposes protected
`GET /prototype/sqlite/authority-readiness` plus safe status fields in metadata
and write capabilities. Paths, manifest contents, tokens, and raw rows are
never returned. If verification fails, the server still supports protected
reads where possible but centrally rejects every `/write/` route with
`sqlite_authority_not_ready`.

Verify a running authoritative server without mutation:

```powershell
npm run verify:sqlite-authority -- -- --token-file C:\dev\personal-finance-data\.server-token
```

Before rollback, stop Vite and the API, create another native backup of the
current authoritative SQLite, then verify both the original pre-cutover backup
and the current-state backup:

```powershell
npm run verify:sqlite-authority-rollback -- -- --sqlite <current.sqlite> --cutover-manifest <cutover-manifest.json> --current-backup <current-backup.sqlite> --current-backup-manifest <current-backup.sqlite.manifest.json>
```

Rollback configuration is manual: set the frontend backend to `dexie`, disable
the frontend and server authority flags, restart Vite, and retain SQLite and
both manifests outside Git for future reconciliation. Never replace a database
under a running API process. Unsupported delete, merge, repair, reorder,
snapshot-pruning/editing/deletion, import/export mutation, and reference
migration operations remain unavailable and never fall back to Dexie.

The cutover manifest is immutable and content-bound. After a supported write,
the original manifest will intentionally block a later authoritative restart.
Create and verify the post-write native backup before stopping the Phase 1
session, then roll back to Dexie. Continuing authoritative operation across
restarts requires a future approved checkpoint/reconciliation design; the
server never treats changed SQLite content as verified merely because it came
from the configured filename.

## API Smoke Test

The API smoke-test CLI checks a running local API server. Start the server first with `PERSONAL_FINANCE_SQLITE_PATH` pointing at a verified disposable SQLite database outside the repository.

Use a token file so the token is not printed in the command:

```bash
npm run smoke:api -- -- --base-url http://127.0.0.1:3147 --token-file C:\dev\personal-finance-data\.server-token
```

If you want the smoke test to send an allowed browser-style origin for protected success checks:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --origin http://localhost:5173
```

The smoke test checks public, protected, rejected-origin, invalid-table, and invalid-pagination behavior. It does not print tokens, table rows, transaction data, account names, or SQLite paths. The table-read endpoint itself returns sensitive personal finance rows, so keep using it only for local prototype diagnostics. SQLite remains disposable and Dexie / IndexedDB remains authoritative.

Normal smoke also verifies the protected, read-only write-capability endpoint.
It checks token/origin protection, redaction, default-off capability values, and
enabled values during explicit mutation smoke modes. The capability request
does not mutate SQLite or Dexie.

## SQLite Authority Rehearsal Verification

From the repository root, the read-only rehearsal verifier uses the existing
ignored Vite local API URL/token configuration:

```bash
npm run verify:sqlite-rehearsal
```

It calls `/health`, `/metadata`, `/prototype/write-capabilities`, and
`/prototype/sqlite/row-counts`. It requires all ten existing backend write
capabilities, `storageMode: "sqlite-disposable"`, `authoritative: false`, and
an available configured SQLite database. It sends no mutation request and does
not print the token, URL, database path, row data, or raw responses.

## Token Commands

Show the local development token:

```bash
npm run token:show
```

Rotate the local development token:

```bash
npm run token:rotate
```

These commands print the token because they are explicit local developer actions. Server startup does not print the token.

## Endpoints

Health check, no token required:

```bash
curl http://127.0.0.1:3147/health
```

Expected response:

```json
{
  "ok": true,
  "service": "personal-finance-local-api",
  "mode": "prototype"
}
```

Metadata, token required:

```bash
$TOKEN = npm run token:show --silent
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/metadata
```

Expected response:

```json
{
  "service": "personal-finance-local-api",
  "mode": "prototype",
  "apiVersion": "0.1.0",
  "readonly": true
}
```

Write capabilities, token required:

```bash
$TOKEN = npm run token:show --silent
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/write-capabilities
```

The response contains booleans for the ten existing write flags, a fixed
`sqlite-disposable` storage label, `authoritative: false`, safe unsupported
operation codes, and non-sensitive safety booleans. It never returns
environment values, tokens, paths, filenames, or raw configuration. The route
opens configured SQLite read-only only to report whether it is available.

SQLite row counts, token required:

```bash
$env:PERSONAL_FINANCE_SQLITE_PATH = "C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite"
$TOKEN = npm run token:show --silent
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/sqlite/row-counts
```

Expected response shape:

```json
{
  "ok": true,
  "mode": "prototype",
  "readonly": true,
  "tables": {
    "transactions": 0,
    "budgets": 0,
    "budgetSnapshots": 0,
    "buckets": 0,
    "categories": 0,
    "accounts": 0,
    "paymentMethods": 0,
    "recipients": 0,
    "smsImportTemplates": 0
  }
}
```

This endpoint is row-count only. It does not return raw rows, names, descriptions, amounts, transaction references, file paths, tokens, or schema SQL. If `PERSONAL_FINANCE_SQLITE_PATH` is not set, it returns `503 sqlite_not_configured`; if the configured database cannot be opened read-only, it returns `503 sqlite_unavailable`.

SQLite paginated table reads, token required:

```bash
$env:PERSONAL_FINANCE_SQLITE_PATH = "C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite"
$TOKEN = npm run token:show --silent
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/sqlite/tables/transactions?limit=50&offset=0"
```

Expected response shape:

```json
{
  "ok": true,
  "mode": "prototype",
  "readonly": true,
  "table": "transactions",
  "limit": 50,
  "offset": 0,
  "rowCount": 0,
  "rows": []
}
```

Only known prototype tables can be read. Pagination defaults to `limit=50&offset=0`, caps `limit` at 200, and orders rows by `id ASC`. Invalid tables and invalid pagination values are rejected before any rows are returned.

The table-read endpoint returns sensitive personal finance rows for the requested table, including fields such as descriptions, amounts, references, names, and account details where those fields exist. Use it only for local prototype diagnostics with a disposable SQLite database. It does not expose SQLite file paths, tokens, schema SQL, or write operations.

Transaction repository prototype reads, token required:

```bash
$env:PERSONAL_FINANCE_SQLITE_PATH = "C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite"
$TOKEN = Get-Content C:\dev\personal-finance-data\.server-token
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/repositories/transactions?limit=50&offset=0"
```

Expected list response shape:

```json
{
  "ok": true,
  "mode": "prototype",
  "readonly": true,
  "limit": 50,
  "offset": 0,
  "count": 0,
  "rows": []
}
```

Detail and count examples:

```bash
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/transactions/1
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/transactions/count
```

The transaction repository endpoints are prototype-only and read-only. They are shaped for a future repository adapter but are not connected to the frontend. List reads use stable `date DESC, id DESC` ordering and enforce pagination with `limit` capped at 200. Supported filters are `accountId`, `categoryId`, `recipientId`, `budgetSnapshotId`, `isTransfer`, `dateFrom`, and `dateTo`; arbitrary SQL, order strings, and unknown filters are not supported.

These endpoints return sensitive personal finance transaction rows, including amounts, descriptions, and transaction references. Use them only for local diagnostics against disposable SQLite.

Budget repository prototype reads, token required:

```bash
$env:PERSONAL_FINANCE_SQLITE_PATH = "C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite"
$TOKEN = Get-Content C:\dev\personal-finance-data\.server-token
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/repositories/budgets?limit=100&offset=0&activeOnly=true"
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/repositories/budget-snapshots?limit=100&offset=0&isHistorical=true"
```

Expected list response shape:

```json
{
  "ok": true,
  "mode": "prototype",
  "readonly": true,
  "resource": "budgets",
  "limit": 100,
  "offset": 0,
  "count": 0,
  "rows": []
}
```

Detail examples:

```bash
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/budgets/1
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/budgets/1/snapshots
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/budget-snapshots/1
```

Budget endpoints are prototype-only and read-only. They are shaped for future repository adapters but are not connected to the frontend. Pagination defaults to `limit=100&offset=0`, caps `limit` at 500, and uses stable ordering: budgets by `dueDate ASC, id ASC`, budget snapshots by `dueDate DESC, id DESC`. Supported budget filters are `activeOnly`, `categoryId`, `accountId`, `recipientId`, `frequency`, and `isGoal`. Supported budget snapshot filters are `budgetId`, `categoryId`, `accountId`, `recipientId`, `isHistorical`, `dateFrom`, and `dateTo`. Arbitrary SQL, order strings, and unsupported lifecycle operations are not accepted.

Budget and budget snapshot endpoints return sensitive personal finance rows, including descriptions, amounts, dates, category/account/recipient references, and occurrence metadata. Use them only for local diagnostics against disposable SQLite. These endpoints do not generate, prune, repair, dedupe, relink, or mutate budget snapshots.

Lookup repository prototype reads, token required:

```bash
$env:PERSONAL_FINANCE_SQLITE_PATH = "C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite"
$TOKEN = Get-Content C:\dev\personal-finance-data\.server-token
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/repositories/accounts?limit=100&offset=0&activeOnly=true"
curl -H "x-personal-finance-token: $TOKEN" "http://127.0.0.1:3147/prototype/repositories/categories?bucketId=1&activeOnly=true"
```

Expected list response shape:

```json
{
  "ok": true,
  "mode": "prototype",
  "readonly": true,
  "resource": "accounts",
  "limit": 100,
  "offset": 0,
  "count": 0,
  "rows": []
}
```

Detail examples:

```bash
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/accounts/1
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/prototype/repositories/recipients/1
```

Lookup endpoints are prototype-only and read-only. They are shaped for future repository adapters but are not connected to the frontend. Pagination defaults to `limit=100&offset=0`, caps `limit` at 500, and uses stable ordering: accounts/categories/recipients by `name ASC, id ASC`, buckets by `displayOrder ASC, id ASC`. Supported filters are `activeOnly=true|false` for lookup tables and `bucketId` for categories. Arbitrary SQL, order strings, and unsupported filters are not accepted.

Lookup endpoints return sensitive personal finance metadata, especially account and recipient names, descriptions, contact details, and account identifiers. Use them only for local diagnostics against disposable SQLite.

## Experimental Recipient Writes

Four experimental real-write endpoints exist:

```text
POST /prototype/repositories/recipients/write/create
POST /prototype/repositories/recipients/write/update
POST /prototype/repositories/recipients/write/activate
POST /prototype/repositories/recipients/write/deactivate
```

They are disabled by default. Create/update writes require the server process
to be started with:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES=true
```

Activate/deactivate writes require the separate active-state flag:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true
```

The endpoints are protected by the same token and origin guards as the
prototype repository reads. They mutate only the configured disposable SQLite
database. Create inserts a recipient with `isActive: true`, `createdAt`, and
`updatedAt`. Update changes recipient text/contact fields and refreshes
`updatedAt`, while preserving `createdAt` and `isActive`. Activate/deactivate
update only `recipients.isActive` and intentionally do not update `createdAt`
or `updatedAt`. None of these endpoints update transactions, files, or Dexie /
IndexedDB.

Create request shape:

```json
{
  "name": "Example Recipient",
  "aliases": "Optional Alias",
  "email": "optional@example.invalid",
  "phone": "optional",
  "tillNumber": "optional",
  "paybill": "optional",
  "accountNumber": "optional",
  "description": "optional",
  "dryRunReviewed": true,
  "confirmation": "create recipient in disposable sqlite"
}
```

Update request shape:

```json
{
  "id": 123,
  "name": "Example Recipient",
  "aliases": "Optional Alias",
  "email": "optional@example.invalid",
  "phone": "optional",
  "tillNumber": "optional",
  "paybill": "optional",
  "accountNumber": "optional",
  "description": "optional",
  "dryRunReviewed": true,
  "confirmation": "update recipient in disposable sqlite"
}
```

Activate request shape:

```json
{
  "id": 123,
  "expectedIsActive": false,
  "dryRunReviewed": true,
  "confirmation": "activate recipient in disposable sqlite"
}
```

Deactivate request shape:

```json
{
  "id": 123,
  "expectedIsActive": true,
  "dryRunReviewed": true,
  "confirmation": "deactivate recipient in disposable sqlite"
}
```

Responses are redacted summaries only. They do not include raw recipient rows,
names, aliases, contact values, token values, SQLite paths, backup paths, or
transaction details. If the write flag is not exactly `true`, the endpoint
returns a safe disabled response and does not open a writable database.

Normal `smoke:api` remains non-mutating. Successful write smoke is opt-in and
mutates the disposable SQLite database:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-recipient-create-update-write-smoke
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-recipient-activate-write-smoke
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-recipient-deactivate-write-smoke
```

Run that opt-in smoke only against a disposable SQLite database imported from a
fresh backup. After a successful write smoke, delete/re-import the SQLite
database from the backup before using it as a clean parity baseline again.
Delete, merge, broad frontend write adapters, dual-write, and
transaction recipient-reference mutation remain future work.

## Experimental Bucket And Category Writes

Bucket and category create/update dry-runs and real writes are available at:

```text
POST /prototype/repositories/buckets/dry-run/create
POST /prototype/repositories/buckets/dry-run/update
POST /prototype/repositories/buckets/write/create
POST /prototype/repositories/buckets/write/update
POST /prototype/repositories/categories/dry-run/create
POST /prototype/repositories/categories/dry-run/update
POST /prototype/repositories/categories/write/create
POST /prototype/repositories/categories/write/update
```

Dry-runs are non-mutating. Real writes are disabled unless the server process
has this exact flag:

```text
PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES=true
```

All routes use the existing token and origin guards. Requests reject unknown
fields and return redacted summaries. Duplicate names are reported as
informational counts because the current Dexie forms do not block duplicate
bucket or category names.

Bucket create mirrors the management form: trimmed required name, optional
description, percentages defaulting to `0` and `100`, optional non-negative
fixed amount, `isActive: true`, `excludeFromReports: false` by default, and
`displayOrder` equal to the current bucket count. Bucket update changes only
the form-editable fields and `updatedAt`; it preserves `id`, `createdAt`,
`isActive`, and `displayOrder`.

Category create requires an existing bucket, defaults `isActive` to true, and
sets both timestamps. Category update changes only name, bucket link,
description, and `updatedAt`; it preserves `id`, `createdAt`, and `isActive`.
No active-state, reorder, delete, merge, or cascade route is included.

Bucket percentage, fixed-amount, display-order, and `excludeFromReports`
semantics affect reports and budgeting. Category bucket links affect report
grouping and income-bucket classification. The endpoints return informational
warnings for this boundary but never update transactions, budgets, budget
snapshots, or foreign keys.

Normal `smoke:api` remains non-mutating. The mutation smoke is explicit:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-bucket-category-write-smoke
```

Run it only against disposable SQLite with the server write flag enabled. A
successful run creates and updates one bucket and one category and therefore
dirties SQLite. Re-import the database from a fresh backup before parity
verification.

## Experimental Account Writes

Account create/update dry-runs and real writes are available at:

```text
POST /prototype/repositories/accounts/dry-run/create
POST /prototype/repositories/accounts/dry-run/update
POST /prototype/repositories/accounts/write/create
POST /prototype/repositories/accounts/write/update
```

Dry-runs are non-mutating. Real writes are disabled unless the server process
has this exact flag:

```text
PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES=true
```

All routes use the existing token and origin guards, reject unexpected fields,
and return redacted summaries. Create mirrors the current non-image account
form fields: trimmed required name, nonblank currency defaulting to `KES`,
`isCredit: false` by default, optional non-negative credit limit, `isActive:
true`, and matching creation/update timestamps. Update changes only name,
currency, `isCredit`, credit limit, and `updatedAt`; it preserves ID,
`createdAt`, active state, description, and image columns.

Currency and credit-account changes are reported as financially significant
warnings. They do not authorize transaction reinterpretation or related-row
mutation. The endpoints do not insert or update transactions, payment methods,
budgets, budget snapshots, balances, references, images, or any other lookup
table. Delete, merge, active-state writes, image writes, reconciliation, and
reference migration are not implemented for Accounts.

Normal `smoke:api` remains non-mutating. Account mutation smoke is explicit:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-account-write-smoke
```

Run it only against disposable SQLite with the Account write flag enabled,
preferably on a distinct test port. A successful run creates and updates one
Account and dirties SQLite. Re-import from a fresh matching backup before clean
parity checks.

SQLite remains disposable and Dexie / IndexedDB remains authoritative. Do not commit SQLite databases, backups, exports, logs, tokens, import summaries, verification reports, or comparison reports.

## Experimental Paired Transfer Writes

Paired transfer dry-runs and writes use separate protected routes:

```text
POST /prototype/repositories/transactions/transfers/dry-run/create
POST /prototype/repositories/transactions/transfers/dry-run/update
POST /prototype/repositories/transactions/transfers/write/create
POST /prototype/repositories/transactions/transfers/write/update
```

Real writes require both
`PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES=true` and
`PERSONAL_FINANCE_ENABLE_TRANSACTION_TRANSFER_WRITES=true`. The transfer flag
defaults to disabled. Create and update require their matching dry-run,
`dryRunReviewed: true`, and the internal confirmation phrase.

Each transfer is one atomic SQLite transaction containing exactly two
transaction rows. The source amount is negative, the destination amount is the
matching positive magnitude, both rows have reciprocal `transferPairId` values,
and any negative `transactionCost` is stored on the source row only. Both rows
share the current form's date, category, description/reference, and optional
currency metadata. Accounts and recipients may differ. Transfers cannot carry
budget or snapshot linkage.

Update accepts one member ID, validates the complete reciprocal pair and any
inbound references, preserves both IDs and pair links, and updates both rows
atomically. The routes never mutate Account, lookup, Budget, or snapshot rows.
Transfer delete, repair, bulk operations, dual-write, and Dexie writes are not
implemented.

Normal `smoke:api` remains non-mutating. Mutation testing is explicit:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-transaction-transfer-write-smoke
```

Run the server against an outside-repo disposable SQLite database with both
backend flags enabled, preferably on a unique test port. The opt-in smoke
creates and updates a pair and dirties that database. Re-import a separate
SQLite database from the matching fresh backup before parity verification.

Requests with no `Origin` header are allowed for local CLI use when the token is valid. Browser-style requests with an unexpected `Origin` are rejected. Allowed local development origins are:

- `http://localhost:8100`
- `http://127.0.0.1:8100`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Browser diagnostics from Vite use the custom `x-personal-finance-token` header,
so the browser sends an unauthenticated `OPTIONS` preflight before the protected
`GET`. Approved local origins receive narrow CORS headers for preflight and
actual responses:

- `Access-Control-Allow-Origin` is echoed only for the approved origin.
- `Access-Control-Allow-Methods` includes `GET, OPTIONS`.
- `Access-Control-Allow-Headers` includes `x-personal-finance-token` and
  `content-type`.

Preflight does not require the token, but protected `GET` requests still do.
The API does not use wildcard CORS origins or cookies.

## Experimental Transaction Writes

Backend-only Phase 1 endpoints are available for simple single-row income and
expense create/update operations:

```text
POST /prototype/repositories/transactions/dry-run/create
POST /prototype/repositories/transactions/dry-run/update
POST /prototype/repositories/transactions/write/create
POST /prototype/repositories/transactions/write/update
```

Dry-runs are read-only. Real writes are disabled unless this exact server flag
is set:

```text
PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES=true
```

Phase 2 transaction-cost and existing-budget-snapshot writes additionally
require this separate exact flag:

```text
PERSONAL_FINANCE_ENABLE_TRANSACTION_COST_BUDGET_WRITES=true
```

Both flags must be `true` for a real write containing a nonzero transaction
cost or any budget-linkage field. With only the basic flag enabled, Phase 1
behavior and rejection rules are unchanged.

Real-write requests also require `dryRunReviewed: true` and the action-specific
confirmation phrase:

```text
create basic transaction in disposable sqlite
update basic transaction in disposable sqlite
```

Phase 1 requires an explicit `classification` of `income` or `expense`, a
correctly signed nonzero `amount`, valid ISO-compatible `date`, existing
`accountId`, `categoryId`, and `recipientId`, and the existing form-required
description. It accepts the ordinary optional original-currency, exchange-rate,
and reference fields. Responses are redacted summaries and never echo
descriptions or references.

Transfers and pair IDs, nonzero transaction costs, legacy payment-channel
writes, budget links, occurrence links, and budget snapshot links are rejected.
Updates require an existing unpaired, unlinked, zero-cost target. They preserve
the ID and all legacy, transfer, cost, and budget-linkage columns. Transaction
rows have no current creation/update timestamp columns.

The write transaction verifies that exactly one transaction row changes and
that accounts, payment methods, buckets, categories, recipients, budgets,
budget snapshots, and SMS templates remain byte-for-byte unchanged. Account
balances and reports are derived; their totals may change only by the signed
transaction amount.

Phase 2 retains the same single-row routes and dry-run-first contract.
`transactionCost` remains separate from `amount`, and persisted costs must be
zero, null, or negative. Financial effects are always derived from
`amount + transactionCost`; no Account row is updated. A caller may link only
an existing budget snapshot. `budgetSnapshotId` is canonical, while legacy
`budgetId` is derived from the snapshot parent and `occurrenceDate` is derived
from the snapshot due date. Conflicting caller values, missing snapshots,
missing parent budgets, and inconsistent existing links are rejected.

Phase 2 never creates, updates, generates, repairs, prunes, or deletes a Budget
or budget snapshot. Linking, changing, or unlinking modifies only the three
linkage columns on the target transaction. Transfers, paired rows, transaction
delete, and bulk operations remain unavailable.

Normal smoke remains non-mutating. Successful mutation smoke is explicit:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-transaction-basic-write-smoke
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-transaction-cost-budget-write-smoke
```

Run these only against disposable databases with the corresponding server
flags enabled. The Phase 2 mode selects an existing snapshot, creates one
cost-bearing linked transaction, verifies exact financial and Budget History
membership deltas, then updates and unlinks that transaction. The database is
dirty afterward; re-import a separate SQLite database from a fresh matching
backup before clean parity checks. Dexie remains authoritative.

## Experimental SMS Import Template Writes

Protected dry-run and disposable SQLite write routes exist for SMS Import
Template create, update, activate, deactivate, and delete:

```text
POST /prototype/repositories/sms-import-templates/dry-run/{action}
POST /prototype/repositories/sms-import-templates/write/{action}
```

Real writes remain disabled unless the server process has:

```text
PERSONAL_FINANCE_ENABLE_SMS_TEMPLATE_WRITES=true
```

Each write requires its matching successful dry-run, `dryRunReviewed: true`,
and an internal action-specific confirmation. Payloads mirror the existing
management form: trimmed required name, optional description/account, and
optional regex source strings. Regexes are compiled in memory with the
parser's fixed case-insensitive behavior. Malformed syntax and unusable
extraction capture shapes are rejected; duplicate names/signatures and broad
patterns are reported only as redacted counts or warning codes.

Create inserts one active template with matching timestamps. Update changes
only form-editable fields and `updatedAt`, preserving ID, `createdAt`,
`isActive`, and legacy `paymentMethodId`. Active-state writes change only
`isActive` and `updatedAt`. Delete removes exactly one template without a
cascade; inspection found no persisted template-ID references.

These routes do not parse SMS messages, import or mutate transactions, alter
Accounts or Recipients, change template priority, access Dexie, or write
files. Responses exclude raw patterns, sample messages, names, account
details, tokens, paths, and raw rows. Normal smoke remains non-mutating.
Explicit mutation smoke is:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-sms-template-write-smoke
```

Run it only against an outside-repo disposable SQLite database with the
backend flag enabled, preferably on a unique port. It performs synthetic CRUD
and active-state checks and leaves SQLite dirty. Re-import a separate database
from the matching fresh backup before parity verification.

## Experimental Budget Definition Writes

Protected dry-run and disposable SQLite write routes exist for Budget
definition create and update only:

```text
POST /prototype/repositories/budgets/dry-run/create
POST /prototype/repositories/budgets/dry-run/update
POST /prototype/repositories/budgets/write/create
POST /prototype/repositories/budgets/write/update
```

Real writes remain disabled unless the server process has:

```text
PERSONAL_FINANCE_ENABLE_BUDGET_DEFINITION_WRITES=true
```

Each real write requires a successful matching dry-run,
`dryRunReviewed: true`, and its internal action confirmation. Create inserts
one active definition. Update changes only form-editable definition fields and
`updatedAt`, preserving ID, `createdAt`, legacy `paymentChannelId`, and
`isActive`.

Explicit `goalDirection` values (`expense` or `income`) are authoritative.
Null or missing direction uses the current amount-sign fallback. Recurrence
details are validated for the selected frequency, but recurrence edits affect
the definition only and may influence the separately invoked snapshot
generation process documented below.

These routes do not create, update, generate, prune, delete, backfill, or
repair budget snapshots. They do not relink transactions, change Budget
History, run report calculations, access Dexie, or write files. Existing
snapshots and transaction linkage are fingerprint-checked as unchanged inside
the SQLite write transaction. Budget delete and snapshot mutation from these
definition routes remain absent.

Normal smoke remains non-mutating. Explicit mutation smoke is:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-budget-definition-write-smoke
```

Run it only against an outside-repo disposable SQLite database with the
backend flag enabled, preferably on a unique port. It creates and updates a
synthetic definition and leaves SQLite dirty. Re-import a separate database
from the matching fresh backup before parity verification. Dexie remains
authoritative.

## Experimental Budget Snapshot Generation

Budget snapshot lifecycle Phase 1 exposes generation-only protected routes:

```text
POST /prototype/repositories/budget-snapshots/lifecycle/dry-run/generate
POST /prototype/repositories/budget-snapshots/lifecycle/write/generate
```

The dry-run is read-only. The write route is disabled unless the server process
has this separate exact flag:

```text
PERSONAL_FINANCE_ENABLE_BUDGET_SNAPSHOT_GENERATION_WRITES=true
```

Both routes accept an optional ISO date or datetime `asOf`; omitted values use
the current local day. Date-only values and recurrence calculations use the
app's local JavaScript calendar semantics. The write additionally requires
`dryRunReviewed: true` and the internal confirmation phrase. Responses contain
counts, recurrence/goal-direction summaries, warnings, and safety metadata
only. They do not return Budget descriptions, amounts, raw rows, generated
IDs, paths, tokens, or environment values.

The generator shares the app's pure occurrence calculation. It includes the
due date when it falls on the horizon, covers inactive definitions through
`asOf`, and covers active definitions through one local calendar year after
`asOf`. Supported recurrence behavior is unchanged: once; daily; weekly;
monthly using `dayOfMonth` clamped to the target month's final day; yearly;
and custom positive `intervalDays`. Finite `remainingCyclesTotal` and the
existing 5,000-advance guard still apply.

Every new snapshot copies the current Budget definition's persisted snapshot
fields. Explicit `goalDirection` values win; null/missing direction retains
the amount-sign fallback used for classification summaries. Missing/null
legacy `isFlexible` is copied as `false`. SQLite generates the ID and one
runtime timestamp is used for both `createdAt` and `updatedAt` on new rows.

Identity is `budgetId` plus the local occurrence day, matching the Dexie
compound occurrence lookup. Existing occurrences are skipped. Duplicate or
disagreeing occurrence/due-date identities block generation; they are not
repaired. The write recalculates inside one SQLite transaction, inserts only
missing rows, verifies all pre-existing snapshots and every other table are
unchanged, then verifies a second plan is empty. Repeating the same request is
a safe zero-row no-op and never refreshes timestamps on existing snapshots.

This phase does not update, prune, delete, edit, regenerate, dedupe, or repair
snapshots. It does not mutate Budget definitions, relink Transactions, change
`budgetSnapshotId` or legacy `budgetId`, access Dexie, write files, run at
startup, or schedule background work. No frontend action was added; invoke the
protected endpoint manually only against disposable SQLite.

The read-only deterministic parity command is:

```powershell
npm run compare:budget-snapshot-generation -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --as-of 2026-07-22
```

It compares the backup-derived Dexie-equivalent plan with the SQLite dry-run
plan. Generated IDs and runtime timestamps are the only tolerated differences;
all other generated fields are compared exactly. Optional reports must remain
outside Git.

Normal `smoke:api` remains non-mutating. Explicit generation smoke is:

```powershell
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-budget-snapshot-generation-write-smoke
```

Run it only with the generation flag enabled against a copied, outside-repo
disposable database on a distinct port. It inserts missing occurrences and
then proves the repeated request is a no-op. The database is dirty afterward;
re-import from the matching fresh backup before any clean parity work.

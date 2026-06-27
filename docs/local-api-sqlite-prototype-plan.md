# Local API + SQLite Prototype Plan

This document plans a future desktop prototype only. It does not approve a production migration, add dependencies, create backend files, create SQLite files, or replace Dexie / IndexedDB.

Dexie remains the authoritative source of truth until a separate migration plan is approved, implemented, compared, and backed up.

## Prototype Goal

The prototype should prove that:

- a local backend can serve finance data from a SQLite file through `localhost`
- browser-agnostic desktop access is feasible from any browser on the same machine
- backup and comparison tooling can make a future migration safer
- repository/data-access adapters can eventually point at an HTTP API

The prototype must not replace Dexie yet. It should use exported backup data in a disposable SQLite database and never write back to Dexie.

## Provisional Stack

Use the provisional desktop stack from `docs/database-architecture-options.md`:

- Node
- TypeScript
- Fastify
- `better-sqlite3`
- local SQLite file

Backend code may eventually live inside this repo, likely under `server/`, but real runtime data must live outside Git.

## Proposed Folder Layout

Runtime data should live outside the repository, for example:

```text
C:\dev\personal-finance-data
```

Suggested subdirectories:

```text
C:\dev\personal-finance-data\
  live\
    personal-finance.sqlite
  backups\
    daily\
    pre-migration\
    pre-restore\
  exports\
  logs\
  temp\
```

Rules:

- Do not commit real SQLite databases.
- Do not commit backups.
- Do not commit exports containing real financial data.
- Do not commit sensitive logs.
- Keep local API tokens outside the repo.

Repository guardrails:

- Real runtime data must live outside this repo, with `C:\dev\personal-finance-data` as the suggested local folder.
- SQLite files, backups, exports, logs, and local API tokens must never be committed.
- `.gitignore` includes defensive patterns for common local data files, but it is not a substitute for checking `git status` carefully before every commit.

## Non-Goals

- No production migration.
- No Dexie replacement.
- No cloud sync.
- No auth or user accounts.
- No mobile implementation.
- No budget model rewrite.
- No automatic destructive migration.
- No real financial data committed to Git.
- No write endpoints in the first prototype.
- No connection from the live app to the prototype until comparison tooling exists.

## Security Baseline

Even on localhost, treat the API as sensitive because it exposes financial data.

Baseline requirements:

- bind only to `127.0.0.1`
- require a local API token for all non-health endpoints
- store the token outside the repo
- restrict CORS/origins to known local frontend origins
- avoid sensitive logs
- never expose the database path through broad endpoints
- never expose backup file contents through broad endpoints
- do not add directory browsing endpoints
- log request IDs and high-level timing, not transaction descriptions, amounts, account names, or raw backup content

`GET /health` can be unauthenticated if it only returns process status and no financial data.

## First Prototype API Scope

The first API should be read-only.

Candidate endpoints:

- `GET /health`
- `GET /metadata`
- `GET /transactions`
- `GET /accounts`
- `GET /categories`
- `GET /buckets`
- `GET /recipients`
- `GET /budgets`
- `GET /budget-snapshots`
- `GET /reports/monthly-summary` if practical

Initial endpoint behavior should be boring:

- return complete table rows or simple filtered lists
- preserve IDs
- use predictable JSON
- avoid server-side mutations
- avoid clever report rewrites in the first pass

## Write Endpoints Out Of Scope

The first prototype must not include write endpoints.

Out of scope:

- creating transactions
- editing transactions
- deleting transactions
- transfer pair creation or editing
- budget create/update/delete/deactivate
- snapshot create/update/delete
- snapshot coverage/generation/pruning
- CSV import
- restore/import into the active Dexie database
- any endpoint that mutates SQLite after the initial disposable import

Writes should be considered only after read-only import, API serving, and comparison reports are reliable.

## SQLite Schema Approach

Start from the existing Dexie models in `src/db.ts`.

The prototype schema should preserve:

- table coverage for all full-backup tables
- primary keys and IDs
- transaction signs: expenses negative, income positive
- `transactionCost` as separate from `amount`
- `transferPairId` semantics
- `budgetSnapshotId` semantics
- legacy `budgetId` on transactions where present
- account/category/bucket/recipient references
- SMS import template references

Design questions to answer before implementation:

- Dates need an explicit storage format. Candidate: ISO 8601 UTC text, with documented local-date handling where the app currently uses local days.
- Blobs need a plan, especially account images. Candidate: store image bytes in SQLite BLOB columns with MIME type metadata, or store images as files under the data folder with SQLite references.
- JSON-ish fields such as `frequencyDetails` need a clear representation. Candidate: JSON text with validation.
- Optional fields may contain `null` or be absent in backups. Import should handle both intentionally.

Do not normalize or redesign the model in the first prototype unless needed to preserve existing behavior. A normalized schema can be considered later, after parity is proven.

## Data Loading Approach

Use a full JSON backup as the seed input.

Prototype flow:

1. Export a full JSON backup from the current Dexie app.
2. Validate the backup with the existing dry-run validator.
3. Import the backup into a disposable SQLite prototype database under `C:\dev\personal-finance-data\temp` or another clearly disposable path.
4. Preserve table rows and IDs.
5. Serve the imported data through the read-only API.
6. Compare SQLite results against Dexie/backup outputs.

Do not:

- connect the live app to the prototype yet
- write imported data back to Dexie
- use the prototype database as the user's real database
- import unvalidated backups
- use real data in committed fixtures

## Comparison Reports

Before trusting SQLite, comparison tooling must show that SQLite and Dexie/backup-derived data match.

Required comparisons:

- row counts by table
- transaction totals by month
- account balances
- transfer-pair integrity
- budget snapshot link integrity
- monthly report totals
- quarterly report totals
- yearly report totals
- sample transaction detail comparisons
- sample Budget History comparisons

Budget History comparison should be cautious because it depends on snapshots, linked transactions, occurrence dates, expense/income classification, and historical preservation rules.

Suggested comparison outputs:

- JSON report for AI/code review
- concise console summary
- mismatch details with table, record ID, field name, Dexie value, and SQLite value
- no sensitive data in logs unless the user explicitly exports a local comparison artifact outside Git

## Backup Expectations

For the prototype:

- document the backup design
- do not require a full scheduler in the first pass
- never overwrite a prototype database without a clear disposable-path warning

For a real backend later:

- create at least one backup every 24 hours
- create a backup before migration
- create a backup before restore
- keep backups outside the repo
- record backup metadata: created time, source database path, row counts, schema version, and integrity summary

## Phased Implementation Plan

### Phase 0: Documentation And Safety Checklist

- Keep Dexie authoritative.
- Define the prototype scope and non-goals.
- Confirm data folder rules and `.gitignore` expectations.
- Define token/origin/logging safety rules.
- Define comparison criteria before writing prototype code.

### Phase 1: Create Server Skeleton

- Add `server/` only in a future implementation task.
- Configure Node + TypeScript + Fastify.
- Bind to `127.0.0.1`.
- Add `GET /health`.
- Add local token middleware for non-health endpoints.
- Add minimal structured logging without sensitive payloads.

### Phase 2: Create Disposable SQLite Schema

- Build schema from current Dexie models.
- Preserve IDs and reference fields.
- Decide date, blob, and JSON field storage formats.
- Use a disposable database path outside the repo.

### Phase 3: Import Full JSON Backup Into SQLite

- Accept a validated backup export as seed input.
- Deserialize typed dates and blobs intentionally.
- Insert rows preserving IDs.
- Produce row-count and import summary reports.
- Treat any mismatch as a failed import.

### Phase 4: Expose Read-Only API Endpoints

- Implement table read endpoints.
- Add `GET /metadata`.
- Add simple pagination or filtering only if needed.
- Add `GET /reports/monthly-summary` if the report calculation can be preserved clearly.
- Keep all write endpoints out of scope.

### Phase 5: Create Comparison Scripts And Reports

- Compare row counts.
- Compare monthly transaction totals.
- Compare account balances.
- Compare transfer pair integrity.
- Compare budget snapshot link integrity.
- Compare report totals.
- Compare selected transaction details and Budget History examples.

### Phase 6: Consider Frontend `HttpRepository` Adapter

- Only after comparison reports are reliable.
- Keep Dexie as the default adapter.
- Add the HTTP adapter behind existing repository interfaces.
- Do not make HTTP/SQLite authoritative without a separate migration approval.

## Open Questions

- What exact SQLite date format should be used?
- How should local-day budget dates be represented without UTC drift?
- Should account images live as SQLite BLOBs or files referenced by SQLite?
- How should API tokens be generated, stored, and rotated?
- Should reports be calculated by the frontend or backend long term?
- Should the SQLite schema mirror Dexie exactly or normalize further after parity is proven?
- Should the prototype live on a branch?
- How should Budget History be compared safely?
- How should logs stay useful while avoiding sensitive financial data?
- Should app-level encryption at rest be evaluated early, or should OS/user-profile permissions be the first baseline?

## Safety Checklist For Future Implementation Prompts

Before any implementation:

- confirm the task is prototype-only
- confirm no real runtime data is committed
- confirm the data folder is outside the repo
- confirm Dexie remains authoritative
- confirm all first-pass endpoints are read-only
- confirm no budget snapshot lifecycle behavior is touched
- run `npm run build`

Before any future migration:

- export a full JSON backup
- validate the backup
- run the database health check
- import into disposable SQLite
- run comparison reports
- review mismatches manually
- keep a rollback path to Dexie backup

## Practical Recommendation

Build the local API + SQLite prototype only after the repository read/write boundaries are stable enough to support an alternate adapter. Start with a disposable, read-only server seeded from a full JSON backup. Do not connect the live app to it until row counts, reports, transaction details, transfer integrity, budget snapshot links, and Budget History examples match the current Dexie app.

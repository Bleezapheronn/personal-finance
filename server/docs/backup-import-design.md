# Backup Import Design

This document designs a future full JSON backup to disposable SQLite import flow. It is documentation only. It does not implement an importer, add SQLite runtime code, create a database file, or make SQLite authoritative.

Dexie / IndexedDB remains the source of truth.

## Goals

The future importer should:

- accept a full JSON backup exported by the app
- require validation before import
- import into a disposable SQLite database outside the repo
- preserve every table row and every existing ID
- produce an import summary that can feed comparison tooling
- fail closed when anything is uncertain

It must not import into Dexie, replace Dexie, or connect the live app to SQLite.

## Input Expectations

Input must be a full JSON backup exported by the app's full backup feature.

Expected backup metadata:

- `backupFormatVersion: 1`
- `appName: "personal-finance"`
- `dbName: "FinanceDB"`
- `exportedAt`
- `tables`
- `integrity.counts`

The backup must be validated first using the existing backup validation logic from `src/utils/fullBackupRestore.ts` or an equivalent future server-side validator.

Input path rules:

- the backup path must be supplied explicitly by the user
- do not scan broad directories for backups
- do not commit backup files to Git
- do not log backup paths by default
- do not import unvalidated backups

## Output Expectations

Output should be a disposable SQLite database outside the repo.

Suggested output location:

```text
C:\dev\personal-finance-data\temp\<timestamp>-prototype.sqlite
```

Output rules:

- never overwrite live data silently
- require explicit output path or generate a clearly disposable temp path
- refuse output paths inside the Git repo
- preserve all IDs from the backup
- write an import summary outside the repo
- mark or delete failed disposable databases

The future importer should not write to `C:\dev\personal-finance-data\live` until a separate migration is approved.

## Tables To Import

The importer must cover every full-backup table:

- `transactions`
- `budgets`
- `budgetSnapshots`
- `buckets`
- `categories`
- `accounts`
- `paymentMethods`
- `recipients`
- `smsImportTemplates`

Skipping a table should be treated as import failure, even if the table is empty.

## Serialization Handling

### Typed Dates

The backup exports dates as:

```json
{
  "__type": "Date",
  "value": "2026-06-28T00:00:00.000Z"
}
```

Importer behavior:

- validate that `value` is parseable
- store as SQLite `TEXT`
- use an explicit ISO 8601 convention
- preserve local-day semantics where the app expects local days

Budget date fields need special care:

- `budgets.dueDate`
- `budgetSnapshots.dueDate`
- `budgetSnapshots.occurrenceDate`
- `transactions.occurrenceDate`

These fields can affect Budget and Budget History grouping. The importer must avoid UTC/local-day drift and the comparison reports must include Budget History samples.

### Blobs And Account Images

The backup exports blobs as:

```json
{
  "__type": "Blob",
  "mimeType": "image/png",
  "size": 12345,
  "base64": "..."
}
```

Importer behavior:

- validate `base64`, `mimeType`, and `size`
- decode base64 into SQLite `BLOB`
- write MIME metadata into `accounts.imageMimeType` when available
- preserve `null` image values as `NULL`

Open question: the current Dexie `Account` model has `imageBlob` but no explicit MIME field, so MIME handling depends on backup typed blob metadata.

### JSON-ish Fields

Draft schema stores JSON-ish fields as `TEXT`.

Fields:

- `budgets.frequencyDetails`
- `budgetSnapshots.frequencyDetails`

Importer behavior:

- if the backup value is an object, stringify it as JSON text
- if missing or null, store `NULL`
- validate JSON only in importer/application logic, not through schema constraints yet

`recipients.aliases` is not JSON in the current Dexie model. It is a semicolon-separated string and should be imported as text.

### Null Versus Missing Optional Fields

The backup serializer converts `undefined` to `null`. Older/restored records may also contain explicit `null` for optional fields.

Importer behavior:

- treat missing and `null` optional fields intentionally
- store optional missing/null values as SQLite `NULL`
- do not coerce `null` into false, zero, or empty string unless the field requires that behavior
- preserve important null behavior such as `goalDirection: null` falling back to amount sign in Budget/Budget History logic

### Numbers And Booleans

SQLite draft convention:

- numbers store as `INTEGER` or `REAL` depending on field
- booleans store as `INTEGER` values `0` or `1`

Importer behavior:

- reject non-numeric values for numeric fields unless the field is optional and null
- reject non-boolean values for required boolean fields unless a compatibility rule is explicitly documented
- legacy account rows with missing or `null` `accounts.isCredit` import as `false`
  and record a non-sensitive `legacy_defaulted_boolean` warning with table, field,
  default value, and count
- legacy budget and budget snapshot rows with missing or `null`
  `budgets.isFlexible` or `budgetSnapshots.isFlexible` import as `false` and
  record separate aggregated `legacy_defaulted_boolean` warnings
- preserve transaction signs exactly
- preserve `transactionCost` separately from `amount`

## Import Order

The first prototype does not rely on strict foreign keys, but import order should still preserve relationship clarity.

Suggested order:

1. `accounts`
2. `buckets`
3. `categories`
4. `recipients`
5. `paymentMethods`
6. `budgets`
7. `budgetSnapshots`
8. `smsImportTemplates`
9. `transactions`

Rationale:

- lookup/reference tables first
- budget snapshots after budgets
- transactions last because they reference categories, accounts, recipients, budgets, snapshots, and transfer pairs

Transfer pairs can reference rows within the same table, so transfer validation should run after all transactions are inserted.

## ID Preservation

The importer must insert the backup `id` values explicitly.

Do not:

- use auto-generated SQLite IDs during import
- remap IDs unless a separate comparison and remapping design exists
- import partial rows and repair IDs later

If ID preservation fails, the import fails.

## Failure Behavior

The importer should fail closed.

Required failure behavior:

- validate backup before opening/importing into SQLite
- run import inside a SQLite transaction if possible
- roll back all rows on failure
- do not trust partial successful imports
- write an import summary outside the repo
- delete the disposable database or mark it failed if import fails
- report the failing table, row ID, field, and reason when possible

Import summary should include:

- import started/finished timestamps
- backup exported timestamp
- backup format version
- output SQLite path, redacted or omitted in normal logs
- row counts by table
- validation error/warning counts
- success boolean
- failure reason if any

Normal logs should not include transaction descriptions, account names, backup contents, or token values.

## Post-Import Checks

After import:

- compare row counts against `integrity.counts`
- verify table row counts in SQLite
- verify transfer pair integrity
- verify budget snapshot link integrity
- verify no unexpected orphaned references were introduced
- generate a comparison report before any API read endpoints are trusted

## Out Of Scope

Out of scope for the first importer design:

- importing into Dexie
- making SQLite authoritative
- connecting the frontend to SQLite
- write API endpoints
- automatic migration
- cloud sync
- budget model rewrite
- budget snapshot lifecycle redesign
- automatic restore into a live database
- committing backup, database, export, log, or token files

## Future CLI Sketch

Possible future commands:

```bash
npm run import:backup -- --input <backup.json> --output <temp.sqlite>
npm run import:backup -- --input <backup.json> --output-dir C:\dev\personal-finance-data\temp
```

These are sketches only. Do not add scripts until importer code exists.

## Safety Checklist For Future Implementation

Before implementation:

- confirm the task is still prototype-only
- confirm `better-sqlite3` dependency is approved for that slice
- confirm input backup path is explicit
- confirm output database path is outside repo
- validate the backup first
- reject paths inside the repo
- use a disposable SQLite output path
- preserve IDs
- run comparison reports
- run `git status` and verify no real data files are staged

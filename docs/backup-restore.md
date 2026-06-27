# Backup and Restore

This app stores the active finance database in browser IndexedDB. A full JSON backup is the main disaster-recovery format for moving or protecting the complete local database.

## Full JSON Backup

The full JSON backup captures every current Dexie table, not just transaction CSV data.

Included tables:

- `transactions`
- `budgets`
- `budgetSnapshots`
- `buckets`
- `categories`
- `accounts`
- `paymentMethods`
- `recipients`
- `smsImportTemplates`

The backup also includes metadata such as the backup format version, app name, database name, export timestamp, and row counts for each table.

Serialized values are preserved for later restore:

- `Date` values are exported with a typed representation.
- `Blob` values, including account image blobs, are exported with base64 data and MIME metadata.
- Plain objects and arrays are handled recursively.

## Backup Validation

Backup validation is a dry run. It reads a selected JSON file and reports whether the backup appears structurally restorable. It does not write to IndexedDB and does not perform a restore.

Validation checks include:

- expected top-level metadata
- required table presence
- table values are arrays
- row counts match backup integrity counts
- typed `Date` and `Blob` values are structurally valid
- obvious references between tables resolve
- transfer pairs are reciprocal and not self-referenced

Invalid or suspicious files should not be restored until the issue is understood.

## Guarded Restore

Full restore imports a valid full JSON backup into the active browser IndexedDB database. It is destructive because it replaces the current local database contents in that browser.

Restore guardrails:

- The selected backup is validated first.
- Restore is allowed only when validation has zero errors.
- The UI warns that the current local database will be cleared and replaced.
- The user must type the exact confirmation phrase `RESTORE MY FINANCE DATABASE`.
- All required tables are restored, preserving primary keys and IDs from the backup.
- Dates and blobs are deserialized back into restorable app values.

If restore fails, treat the active browser database as suspect until the failure is understood and a known-good backup is available.

## Recommended Safety Workflow

1. Export a full JSON backup of the current browser before destructive actions.
2. Store the backup somewhere outside the browser profile.
3. Validate the backup JSON before restoring it.
4. Restore only after reading the confirmation dialog and entering the required phrase.
5. Run the database health check after restore.
6. Spot-check Transactions, Budget, and Reports.
7. Keep the original backup until the restored database has been verified.

## CSV Is Not a Full Backup

CSV export/import is useful for transaction review, spreadsheet work, and some migration workflows. It is not a complete disaster-recovery backup.

CSV does not capture the full app database model, including all budget snapshots, accounts, buckets, categories, recipients, SMS import templates, typed dates, blobs, and internal IDs. Use full JSON backup for complete recovery.

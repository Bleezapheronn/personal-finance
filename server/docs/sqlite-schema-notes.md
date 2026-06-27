# SQLite Schema Notes

This note describes `server/schema/prototype-schema.sql`. It is a prototype draft only. It is not production migration approval, and it does not replace the Dexie / IndexedDB database.

Dexie remains authoritative until a separate migration is approved, implemented, compared, backed up, and verified.

## Scope

The schema draft mirrors the full JSON backup tables:

- `transactions`
- `budgets`
- `budgetSnapshots`
- `buckets`
- `categories`
- `accounts`
- `paymentMethods`
- `recipients`
- `smsImportTemplates`

The first SQLite prototype should import a validated full JSON backup into a disposable database outside the repo. No database file should ever be committed.

## Design Direction

The draft mirrors the Dexie model first rather than normalizing aggressively. This keeps the first prototype focused on parity and comparison:

- preserve primary keys and IDs from backup
- preserve transaction signs
- preserve legacy fields such as `paymentChannelId`, `paymentMethodId`, and transaction `budgetId`
- preserve `transferPairId` semantics
- preserve `budgetSnapshotId` as the canonical budget linkage where present
- preserve budget snapshot rows without redesigning snapshot lifecycle

Normalization can be revisited later only after importer and comparison tooling proves equivalence.

## ID Preservation

Every table uses `INTEGER PRIMARY KEY` to accept existing Dexie IDs during import. A future importer must insert the backup IDs explicitly.

Do not rely on SQLite-generated IDs during backup import. If IDs drift, references such as `transferPairId`, `budgetSnapshotId`, category references, account references, and recipient references will no longer match.

## Dates

Draft convention:

- timestamp-like fields use `TEXT`
- values should be ISO 8601 strings
- importer should preserve the intended time semantics from the typed backup values

Budget dates need extra care. Fields such as `dueDate`, `occurrenceDate`, and budget snapshot dates often behave like local-day values in the UI. The importer and comparison scripts must avoid UTC/local-day drift.

Recommended future importer behavior:

- decode typed backup Date objects intentionally
- write explicit ISO strings
- document whether each field is treated as instant-like or local-day-like
- compare Budget and Budget History examples after import

## JSON-ish Fields

Fields such as `frequencyDetails` are stored as `TEXT` containing JSON in the draft schema.

Validation is a future importer responsibility. The schema intentionally does not rely on SQLite JSON constraints yet because the first goal is to preserve restored backup data and compare behavior.

`recipients.aliases` remains a semicolon-separated string because that is the current Dexie model.

## Blobs And Account Images

The current Dexie model stores `accounts.imageBlob` as a `Blob | null`. The full JSON backup preserves blob values with base64 data and MIME metadata.

Draft SQLite convention:

- `accounts.imageBlob` stores image bytes as `BLOB`
- `accounts.imageMimeType` stores MIME metadata when available

Open question: the current Dexie `Account` interface does not expose a separate MIME field, so the future importer must decide whether MIME type is recovered from backup typed blob metadata, defaulted, or stored elsewhere.

## Relationships And Constraints

The schema uses relationship comments rather than strict foreign-key constraints for the first draft.

Reason: legacy/restored data may include optional, missing, or temporarily orphaned references that the existing health check can report. A strict SQLite schema could reject a backup before comparison tooling can explain the mismatch.

Future migration steps can harden constraints only after:

- importer validation is reliable
- row counts match
- health-check-equivalent reports are clean
- legacy data behavior is understood

## Indexes

The draft includes read-focused indexes for expected prototype queries:

- `transactions.date`
- `transactions.accountId`
- `transactions.categoryId`
- `transactions.recipientId`
- `transactions.budgetSnapshotId`
- `transactions.transferPairId`
- `budgetSnapshots.budgetId`
- `budgetSnapshots.dueDate`
- `categories.bucketId`
- `smsImportTemplates.accountId`

Additional indexes should be added only when a real read endpoint or comparison report needs them.

## Importer Responsibilities

A future importer must:

- validate the full JSON backup first
- preserve all IDs
- preserve all rows from all backup tables
- intentionally handle `null`, missing, and optional fields
- convert booleans to SQLite integer values predictably
- convert typed dates predictably
- decode blobs intentionally
- write JSON text for JSON-ish fields
- compare row counts by table after import
- run transfer-pair integrity comparison
- run budget snapshot link comparison
- compare reports and sample screens before trusting SQLite

## Budget Snapshot Caution

This schema does not redesign budget snapshots.

Budget snapshots preserve occurrence details and historical linkage behavior. Generation, pruning, coverage, edits, and cleanup remain owned by the current Dexie app until a separate budget snapshot migration is planned and verified.

Do not combine SQLite schema work with budget model v2.

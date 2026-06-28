# Comparison Report Design

This document designs future comparison reports for a disposable SQLite prototype imported from a full JSON backup. It is documentation only. It does not implement comparison scripts, add SQLite runtime code, create database files, or expose financial API endpoints.

Dexie / IndexedDB and validated full JSON backups remain the source of truth.

## Goals

Comparison reports should prove whether a disposable SQLite import matches the current app data and behavior closely enough to continue prototype work.

The reports should:

- catch row-count mismatches
- catch financial total mismatches
- catch reference/integrity problems
- catch transfer-pair problems
- catch budget snapshot linkage problems
- compare representative app views before SQLite is trusted
- produce AI-agent-friendly JSON without writing sensitive data to normal logs

## Source Of Truth

Accepted expected sources:

- validated full JSON backup
- current Dexie-derived logic and reports
- existing database health-check logic where appropriate

Dexie remains authoritative. SQLite comparison failures should be treated as SQLite/importer defects unless a human review proves the backup or Dexie data is invalid.

## Required Comparison Categories

### Row Counts By Table

Compare every full-backup table:

- `transactions`
- `budgets`
- `budgetSnapshots`
- `buckets`
- `categories`
- `accounts`
- `paymentMethods`
- `recipients`
- `smsImportTemplates`

Expected source:

- `integrity.counts` from the backup
- actual backup table lengths

SQLite source:

- `SELECT COUNT(*)` from each imported table

Pass criteria: exact match for every table.

### Transaction Totals By Month

Group transactions by month using the same date interpretation as the app.

Compare:

- total `amount`
- total `transactionCost`
- net total `amount + transactionCost`
- income total
- expense total
- transaction count

Pass criteria: exact match, or a documented rounding tolerance only if floating point differences appear. Start with exact matching.

### Account Balances

Calculate account balances from transactions by `accountId`.

Compare:

- account ID
- transaction count
- amount total
- transactionCost total
- net balance

Open question: if credit accounts require different display semantics, document whether comparison is raw ledger balance or UI display balance.

### Transfer-Pair Integrity

Compare transfer checks equivalent to the current health report:

- transfer transaction has `transferPairId`
- `transferPairId` references an existing transaction
- no self-referenced `transferPairId`
- pair points back reciprocally
- one side negative and one side positive

Pass criteria:

- no new transfer-pair issues introduced by import
- issue counts and affected IDs match expected backup/Dexie health output

### Budget Snapshot Link Integrity

Compare:

- transaction `budgetSnapshotId` references an existing snapshot where present
- snapshot `budgetId` references an existing budget where present
- transaction legacy `budgetId` does not conflict with linked snapshot budget where both exist
- orphaned snapshot counts match expected health output

Pass criteria:

- no unexpected missing snapshot links
- no unexpected orphaned references
- mismatch details identify transaction or snapshot IDs

### Monthly, Quarterly, And Yearly Report Totals

Compare report outputs derived from the existing report formulas:

- `totalIncome`
- `totalExpense`
- `netTotal`
- bucket totals
- category breakdown totals where applicable
- report period labels and boundaries

The initial comparison can use current frontend/Dexie report logic as expected output and SQLite-derived calculations as actual output.

Pass criteria:

- financial totals match exactly, or within an explicitly documented rounding tolerance
- bucket/category ordering matches where ordering affects UI

### Sample Transaction Detail Comparisons

Select representative transaction IDs from the backup:

- normal expense
- income
- transfer outgoing side
- transfer incoming side
- transaction with `transactionCost`
- transaction with `originalAmount`, `originalCurrency`, and `exchangeRate`
- transaction linked to `budgetSnapshotId`

Compare:

- raw fields
- account/category/bucket/recipient labels
- transfer pair ID and counterpart
- budget snapshot/budget labels where present

Pass criteria: all sampled fields and labels match expected output.

### Sample Budget History Comparisons

Budget History is sensitive because it depends on snapshots and linked transactions.

Compare representative occurrences:

- completed historical expense
- incomplete overdue expense
- income budget
- budget snapshot with linked transactions
- budget snapshot with `goalDirection: null`
- recurring historical occurrence

Compare:

- occurrence date
- due date
- effective target
- amount paid
- completion status
- expense/income classification
- linked transaction IDs
- category/bucket/recipient/account labels

Explicitly check that `goalDirection: null` falls back to amount sign, matching the fixed Budget and Budget History logic.

Pass criteria:

- completed negative-amount expenses with `goalDirection: null` are treated as expenses
- completion status matches
- linked transaction IDs match
- no historical snapshot preservation behavior changes

## Report Output Formats

### JSON Report

Primary artifact should be JSON for AI-agent and human review.

Suggested shape:

```json
{
  "generatedAt": "2026-06-28T00:00:00.000Z",
  "backupExportedAt": "2026-06-28T00:00:00.000Z",
  "sqliteDatabaseLabel": "redacted-or-basename",
  "overallStatus": "pass",
  "summary": {
    "errors": 0,
    "warnings": 0,
    "info": 0
  },
  "sections": {
    "rowCounts": {},
    "transactionTotalsByMonth": {},
    "accountBalances": {},
    "transferPairIntegrity": {},
    "budgetSnapshotLinkIntegrity": {},
    "reportTotals": {},
    "transactionDetails": {},
    "budgetHistory": {}
  },
  "mismatches": []
}
```

Mismatch detail shape:

```json
{
  "severity": "error",
  "category": "row_counts",
  "table": "transactions",
  "recordId": 123,
  "field": "amount",
  "expectedValue": -150,
  "actualValue": 150,
  "message": "Imported transaction amount does not match backup."
}
```

### Console Summary

Console output should be concise:

- overall pass/fail
- section status counts
- row-count summary
- mismatch count
- path to JSON report, if generated

Do not print transaction descriptions, account names, backup contents, token values, or full database paths by default.

### Sensitive Details

Comparison artifacts may contain sensitive data. By default:

- write artifacts outside the repo
- avoid sensitive normal logs
- include only IDs and field names in console
- require explicit local output path for detailed JSON reports

## Pass/Fail Criteria

Fail when:

- any row count differs
- required tables are missing
- IDs differ
- financial totals differ beyond tolerance
- transfer pairs are not reciprocal
- self-referenced transfer pairs appear unexpectedly
- transaction-to-budgetSnapshot links do not resolve where expected
- orphaned references are introduced by import
- Budget History sample classification or completion differs

Warning candidates:

- expected legacy fields are present
- optional fields are missing but expected by current data
- blob MIME type has to be defaulted because backup metadata was incomplete

Info candidates:

- report generated successfully
- sections skipped intentionally with reason
- exact rounding tolerance used

## Future CLI Sketch

Possible future commands:

```bash
npm run compare:backup-sqlite -- --backup <backup.json> --sqlite <temp.sqlite>
npm run compare:backup-sqlite -- --backup <backup.json> --sqlite <temp.sqlite> --out C:\dev\personal-finance-data\exports\comparison.json
```

Possible paired flow:

```bash
npm run import:backup -- --input <backup.json> --output <temp.sqlite>
npm run compare:backup-sqlite -- --backup <backup.json> --sqlite <temp.sqlite>
```

These are sketches only. Do not add scripts until implementation is approved.

## Security And Data Safety

Rules:

- no real fixtures committed
- no backup files committed
- no SQLite files committed
- no comparison artifacts committed
- no token values in logs
- no backup paths in normal logs
- no transaction details in normal logs
- default outputs outside repo

Comparison JSON can contain sensitive financial values. Treat it like a backup artifact.

## Relationship To Existing Tools

Useful existing references:

- full backup table list and serialization in `src/utils/fullBackup.ts`
- backup validation in `src/utils/fullBackupRestore.ts`
- health checks in `src/utils/dbHealth.ts`
- period report calculations in `src/utils/reportService.ts`
- Budget History occurrence logic in `src/pages/BudgetHistory.tsx`

The first comparison implementation should reuse behavior carefully or port formulas line-by-line. Do not rewrite report or Budget History semantics while creating comparison tooling.

## Out Of Scope

Out of scope:

- importer implementation
- SQLite runtime dependency
- financial API endpoints
- frontend HTTP adapter
- write endpoints
- Dexie restore
- production migration
- budget model v2
- budget snapshot lifecycle redesign

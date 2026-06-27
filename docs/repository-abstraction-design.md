# Repository Abstraction Design

This document sketches a repository/data-access layer for the personal finance app. It is planning documentation only. It does not approve a database migration, schema change, backend implementation, or rewrite of budget snapshot behavior.

## Purpose

The repository layer exists to reduce migration risk before any move away from Dexie / IndexedDB. The app currently mixes UI behavior, domain decisions, and direct Dexie calls across pages, components, and utilities. That works today, but it makes a future local API + SQLite backend harder to introduce safely.

The first repository pass should separate app operations from the storage implementation while preserving current behavior. Dexie should remain the source of truth and the only writer during this phase. The goal is not to make the app database-agnostic overnight; the goal is to create a bridge that lets one feature area at a time move behind stable operation-shaped interfaces.

## Current Direct Data-Access Areas

Direct Dexie access currently appears across these domains:

- **Transactions**: transaction list loading, filtering support data, add/edit/delete flows, transfer pair creation/editing, CSV import/export, transaction details, completion from budget flows, recipient merge updates, and some legacy migration actions.
- **Budgets**: budget create/edit/delete/deactivate flows, visible occurrence loading, linked transaction checks, budget history, CSV import/export, and transaction-to-budget linking.
- **Budget snapshots**: snapshot coverage, snapshot lookup by budget, pruning of future unlinked snapshots, snapshot edits, budget history, cleanup utilities, backup/restore, and health checks.
- **Accounts**: account management, account images, transaction lookup helpers, SMS template account references, reports, Settings counts, backup/restore, and health checks.
- **Buckets and categories**: bucket/category management, ordering, active/deactivated handling, report breakdowns, budget and transaction forms, CSV import/export, and health checks.
- **Recipients**: recipient management, duplicate/merge workflows, add/edit forms, transaction/budget references, CSV import/export, backup/restore, and health checks.
- **SMS import templates**: template management, account references, transaction form template loading, backup/restore, and health checks.
- **Reports**: period reports, monthly chart data, bucket/category breakdowns, and spending charts currently read directly from Dexie-backed tables.
- **Backup/restore**: full backup export, dry-run validation, and guarded restore intentionally operate over all current Dexie tables.
- **Health checks**: database health reporting and guarded repair/cleanup actions intentionally inspect current Dexie state.

This map is a starting point. Before migrating a specific area, use `rg "db\\." src` and review the relevant page, component, and utility files.

## Proposed Repository Modules

The repository boundary should be based on app operations, not raw table access. The module names below are provisional and can be adjusted as implementation reveals better seams.

- `TransactionRepository`
- `BudgetRepository`
- `AccountRepository`
- `CategoryRepository`
- `RecipientRepository`
- `SmsImportTemplateRepository`
- `ReportRepository`
- `BackupRepository`
- `HealthRepository`

`BucketRepository` may be separate from `CategoryRepository` if bucket ordering and category lifecycle logic remain complex enough to justify it. Otherwise, a combined category/bucket repository may be easier for the current UI.

## Design Principles

- Define interfaces around app operations, not direct table methods.
- Avoid exposing Dexie-specific query mechanics such as `where`, `between`, `Table`, `Collection`, or Dexie transactions through public repository interfaces.
- Preserve current behavior first. The first pass should be boring by design.
- Migrate one feature area at a time.
- Do not change schema during the first abstraction pass.
- Do not change behavior without tests or manual verification.
- Keep full backup, dry-run validation, guarded restore, and health checks working throughout.
- Keep Dexie as the only writer until a later migration plan explicitly changes that.
- Avoid mixing repository introduction with budget model redesign.
- Prefer explicit operation names for dangerous workflows, such as transfer pair updates and budget snapshot coverage.
- Return enough data for existing screens without forcing UI components to reconstruct storage-specific relationships.

## TransactionRepository Sketch

Likely operations:

```ts
interface TransactionRepository {
  listTransactions(filters: TransactionListFilters): Promise<TransactionListResult>;
  getTransactionById(id: number): Promise<Transaction | undefined>;
  createTransaction(input: CreateTransactionInput): Promise<Transaction>;
  updateTransaction(id: number, patch: UpdateTransactionInput): Promise<Transaction>;
  deleteTransaction(id: number): Promise<DeleteTransactionResult>;
  createTransferPair(input: CreateTransferPairInput): Promise<TransferPairResult>;
  updateTransferPair(input: UpdateTransferPairInput): Promise<TransferPairResult>;
  getDuplicatePrefillData(id: number): Promise<TransactionPrefillData>;
  exportTransactionsCsv(input: TransactionExportInput): Promise<string>;
  importTransactionsCsv(input: TransactionImportInput): Promise<TransactionImportResult>;
}
```

`listTransactions` should support the current filters and visible-window behavior without leaking Dexie queries. The result can include transactions plus lookup data if that avoids repeated direct reads in the screen:

- categories
- buckets
- recipients
- accounts
- visible window metadata
- all-loaded or more-available flags

Transfer invariants must remain explicit:

- `transferPairId` must never equal the transaction row's own `id`.
- Transfer pairs must be reciprocal.
- One side must be negative and one side must be positive.
- New transfer creation should add both rows and then set reciprocal IDs after both primary keys are known.
- Transfer editing should update both rows consistently and verify the links before and after writing.

The existing transfer safety helpers in `src/utils/transferPairs.ts` should remain part of the write boundary. If a repository is added, it should call those helpers rather than reimplementing the same assertions in the UI.

Open point: CSV import/export can remain utility-based in the first pass if moving it would make the transaction repository too broad. It should eventually depend on repository operations or a purpose-built import/export service rather than raw Dexie tables.

## BudgetRepository Sketch

Likely operations:

```ts
interface BudgetRepository {
  listBudgets(input?: BudgetListInput): Promise<BudgetListResult>;
  getBudgetById(id: number): Promise<Budget | undefined>;
  createBudget(input: CreateBudgetInput): Promise<Budget>;
  updateBudget(id: number, patch: UpdateBudgetInput): Promise<Budget>;
  deleteOrDeactivateBudget(id: number): Promise<BudgetDeleteResult>;
  listBudgetSnapshots(input: BudgetSnapshotListInput): Promise<BudgetSnapshot[]>;
  ensureBudgetSnapshotForOccurrence(input: EnsureSnapshotInput): Promise<BudgetSnapshot>;
  ensureBudgetSnapshotCoverage(input: EnsureSnapshotCoverageInput): Promise<BudgetSnapshotCoverageResult>;
  linkTransactionsToBudgetOccurrence(input: LinkTransactionsToBudgetInput): Promise<LinkTransactionsToBudgetResult>;
}
```

Budget snapshot logic is risky and should not be rewritten during the first repository abstraction pass. The first implementation should wrap the current behavior and keep the existing semantics intact:

- `budgetSnapshotId` remains canonical where present.
- historical linked snapshots should not be casually rewritten.
- future unlinked snapshot generation/pruning rules should not change.
- visible horizon expansion should stay aligned with current 30-day batch behavior.
- completed/incomplete occurrence classification should keep existing expense/income rules, including treating `goalDirection: null` as absent.

Budget work should happen after transaction repository work is stable because budgets depend heavily on transactions, categories, recipients, accounts, and snapshots.

## AccountRepository Sketch

Likely operations:

```ts
interface AccountRepository {
  listAccounts(input?: AccountListInput): Promise<Account[]>;
  getAccountById(id: number): Promise<Account | undefined>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(id: number, patch: UpdateAccountInput): Promise<Account>;
  deleteOrDeactivateAccount(id: number): Promise<AccountDeleteResult>;
  accountHasTransactions(id: number): Promise<boolean>;
}
```

Account images may contain `Blob` values. Repository methods should preserve those values and avoid forcing image serialization concerns into UI components. Full backup remains responsible for durable JSON serialization of blobs.

## CategoryRepository Sketch

Likely operations:

```ts
interface CategoryRepository {
  listBuckets(): Promise<Bucket[]>;
  listCategories(input?: CategoryListInput): Promise<Category[]>;
  createBucket(input: CreateBucketInput): Promise<Bucket>;
  updateBucket(id: number, patch: UpdateBucketInput): Promise<Bucket>;
  deleteOrDeactivateBucket(id: number): Promise<BucketDeleteResult>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  updateCategory(id: number, patch: UpdateCategoryInput): Promise<Category>;
  deleteOrDeactivateCategory(id: number): Promise<CategoryDeleteResult>;
  reorderBuckets(input: ReorderBucketsInput): Promise<Bucket[]>;
}
```

This repository should preserve current active/deactivated behavior and current safeguards around deleting categories or buckets that have transaction history.

## RecipientRepository Sketch

Likely operations:

```ts
interface RecipientRepository {
  listRecipients(input?: RecipientListInput): Promise<Recipient[]>;
  getRecipientById(id: number): Promise<Recipient | undefined>;
  createRecipient(input: CreateRecipientInput): Promise<Recipient>;
  updateRecipient(id: number, patch: UpdateRecipientInput): Promise<Recipient>;
  deleteOrDeactivateRecipient(id: number): Promise<RecipientDeleteResult>;
  findDuplicateRecipients(): Promise<RecipientDuplicateGroup[]>;
  mergeRecipients(input: MergeRecipientsInput): Promise<MergeRecipientsResult>;
}
```

Recipient merge is a high-impact write because it updates transactions and deletes or changes recipient records. Move simpler recipient reads and edits first, then merge after repository error handling and verification patterns are settled.

## SmsImportTemplateRepository Sketch

Likely operations:

```ts
interface SmsImportTemplateRepository {
  listTemplates(input?: SmsTemplateListInput): Promise<SmsImportTemplate[]>;
  getTemplateById(id: number): Promise<SmsImportTemplate | undefined>;
  createTemplate(input: CreateSmsTemplateInput): Promise<SmsImportTemplate>;
  updateTemplate(id: number, patch: UpdateSmsTemplateInput): Promise<SmsImportTemplate>;
  deleteTemplate(id: number): Promise<void>;
}
```

Templates should continue to reference `accountId`. Legacy `paymentMethod` and `paymentChannel` names should not leak into new repository APIs unless needed for compatibility work.

## ReportRepository Sketch

Likely operations:

```ts
interface ReportRepository {
  generatePeriodReport(input: PeriodReportInput): Promise<PeriodReport>;
  getMonthlyChartData(input: MonthlyChartInput): Promise<MonthlyChartData>;
  getBucketCategoryBreakdowns(input: BreakdownInput): Promise<BucketCategoryBreakdown[]>;
  getSpendingChartData(input: SpendingChartInput): Promise<SpendingChartData>;
}
```

Reports may be better modeled as services that consume repositories rather than as a repository that hides calculations. The important rule is that report calculations should eventually stop reaching directly into `db.transactions`, `db.categories`, and `db.buckets` from many locations.

During migration, reports are useful comparison targets. If a future SQLite adapter produces the same row counts but different report totals, the migration is not equivalent yet.

## BackupRepository and HealthRepository

Backup/restore and health checks should remain directly tied to Dexie for now. They are safety tools for the current source of truth, and moving them too early would make it harder to tell whether the repository abstraction changed behavior.

Recommended staging:

- Keep full JSON backup export, dry-run validation, guarded restore, and database health checks direct-to-Dexie while core app reads and writes move behind repositories.
- Later, after the main repositories settle, consider wrappers such as `BackupRepository` and `HealthRepository`.
- Use backup and health outputs as comparison tools between Dexie and a future SQLite prototype.
- Do not let a new repository abstraction weaken restore validation, restore confirmation, or health-check coverage.

If a future backend becomes authoritative, backup and health may need separate adapters for Dexie and SQLite so the app can compare both stores during migration.

## Migration Sequence

Use a conservative order:

1. Start with read-only lookup repositories, such as accounts, buckets, categories, and recipients.
2. Move transaction list/read paths behind `TransactionRepository`.
3. Move transaction write paths, including single transactions and transfer pairs.
4. Move reports after transaction reads are stable.
5. Move budget reads only after transaction abstraction is stable.
6. Move budget writes and snapshot-related operations last among core app features.
7. Leave backup/restore/health direct as safety tools until late.

Each step should be small enough that failures are obvious and reversible in code. Avoid combining a repository move with UI redesign, schema changes, or behavior changes.

## Testing And Verification Plan

For each migrated area:

- Run `npm run build`.
- Run relevant unit tests if available.
- Add focused unit tests for extracted domain helpers when practical.
- Manually smoke test the affected screen.
- Run the database health check after risky write-path changes.
- Validate a full backup after risky data-model or restore-adjacent changes.
- Compare before/after row counts when a write path is touched.
- For reports, compare key totals and chart data before and after migration.
- For transfer work, create and edit a test transfer from both sides and confirm the health check remains clean.
- For budget work, verify historical completed items, overdue items, linked transactions, and snapshot behavior.

Manual smoke tests should be written down in the implementation prompt or PR notes so future agents know what was actually checked.

## Error Handling

Repository methods should return domain-meaningful failures rather than leaking low-level Dexie errors into UI copy. For example:

- `not_found`
- `validation_failed`
- `conflict`
- `blocked_by_usage`
- `integrity_check_failed`
- `storage_failure`

The first implementation can throw typed errors if that fits existing code better. The key is to keep error mapping close to the repository boundary so a future API adapter can use the same UI behavior.

## Open Questions

- How much should repositories return raw model objects versus view models tailored to screens?
- Should transfer-pair operations live in `TransactionRepository` or a separate `TransferRepository`?
- Should reports use repository data or remain service-based with repositories injected into report services?
- How should repository errors be represented in the UI?
- Should repository interfaces be synchronous-looking async methods only?
- Should repositories own lookup aggregation for screens, or should screens compose multiple repositories?
- How should repository transaction boundaries be expressed without exposing Dexie-specific mechanics?
- Where should CSV import/export live once transaction and budget repositories exist?
- How should future SQLite comparison tests invoke the same domain operations against two adapters?
- Which repository should own legacy `paymentMethods` compatibility during migration?

## Practical Recommendation

Do not implement a backend yet. Start by designing and introducing a thin Dexie-backed repository layer around the least risky read paths. Keep the interfaces operation-focused, keep Dexie as the only writer, and use the existing backup/restore/health tooling as guardrails.

The first implementation milestone should prove that a screen can move behind a repository without changing behavior. Only after that pattern is boring should transaction writes, transfer pairs, reports, and eventually budget snapshot behavior be moved behind the abstraction.

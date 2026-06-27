# Repository Adoption Audit

This audit captures remaining direct Dexie usage after the first repository milestones. It is planning documentation only. It does not approve schema changes, backend work, data migrations, or behavior changes.

Searches run:

- `rg "db\\." src`
- `rg 'from "\\.\\./db"' src`
- `rg 'from "\\.\\./\\.\\./db"' src`
- `rg -l "db\\." src`
- targeted table-method searches for `toArray`, `get`, `where`, `count`, `add`, `update`, `delete`, `clear`, and `modify`

Current repository coverage:

- `accountRepository`
- `categoryRepository` for buckets and categories
- `recipientRepository`
- `transactionRepository` for read/list paths
- `reportRepository` wrapping report operations and report lookup reads

Current UI adoption:

- `AddTransaction.tsx` lookup loading uses repositories for accounts, buckets, categories, and recipients.
- `Transactions.tsx` main loading path uses repositories for transactions and lookup data.
- `Reports.tsx`, `SpendingChart.tsx`, and `BucketCategoryPieModal.tsx` use `reportRepository`.

## Domain Summary

| Domain | Remaining direct usage | Overall risk | Recommended direction |
| --- | --- | --- | --- |
| Transactions read paths | `AddTransaction.tsx`, `TransactionDetails.tsx`, `Transactions.tsx`, budget screens, import/export utilities | Low to medium | Move simple reads behind existing `transactionRepository`; leave write-adjacent reads with write paths until those paths are migrated. |
| Transaction writes | `AddTransaction.tsx`, `Transactions.tsx`, `CompleteBudgetModal.tsx`, `Budget.tsx`, `BudgetHistory.tsx`, imports, merge tools, Settings migrations | High | Defer because write path risky. Do not touch outside transfer- or transaction-write-specific tasks. |
| Transfer pair writes | `AddTransaction.tsx`, `Transactions.tsx`, health repair tools | High | Leave until a specifically transfer-focused repository/write milestone. Preserve current transfer safeguards. |
| Budgets | `AddBudget.tsx`, `Budget.tsx`, `BudgetHistory.tsx`, CSV import/export, Settings migrations | High | Create `BudgetRepository` later. Start with reads only; writes and lifecycle behavior later. |
| Budget snapshots | `Budget.tsx`, `BudgetHistory.tsx`, `AddBudget.tsx`, `budgetSnapshots.ts`, `EditSnapshotModal.tsx`, health cleanup | High | Defer because budget snapshot sensitive. Leave direct for now. |
| Accounts | `AccountsManagement.tsx`, `AddAccountModal.tsx`, budget/transaction forms, imports/exports, Settings | Low to medium | Move simple read-only management/list loads behind existing repository first; defer account writes until management write milestone. |
| Buckets/categories | `BucketsManagement.tsx`, `AddCategoryModal.tsx`, budget screens, import/export, report service internals | Low to high | Move low-risk reads behind existing repository. Defer bucket/category writes and cascade deletes. |
| Recipients | `RecipientsManagement.tsx`, `AddRecipientModal.tsx`, `useSmsParser.ts`, imports, merge utility | Low to high | Move simple reads behind existing repository. Defer merges/deletes/writes. |
| SMS import templates | `SmsImportTemplatesManagement.tsx`, `AddTransaction.tsx`, `Settings.tsx`, SMS parser-related UI | Low to medium | Create `SmsImportTemplateRepository`; start with read-only list/get methods. |
| Reports | `reportService.ts` still reads Dexie internally | Medium | Accept for now. It is wrapped by `reportRepository`; later inject repository reads into the service if report comparison tests exist. |
| Backup/restore | `fullBackup.ts`, `fullBackupRestore.ts` | High | Leave direct for now because these are safety tools. |
| Health checks and repairs | `dbHealth.ts` | High | Leave direct for now because it intentionally inspects and repairs current Dexie state. |
| Migrations/repair/debug utilities | `db.ts`, `migrations.ts`, Settings migration buttons, import utilities | High | Leave direct unless a task specifically migrates or retires the tool. |

## File-Level Audit

| File | Purpose of direct db access | Access type | Risk | Recommended action |
| --- | --- | --- | --- | --- |
| `src/repositories/accountRepository.ts` | Dexie-backed account read repository | Read-only | Low | Expected direct Dexie adapter usage. Leave direct. |
| `src/repositories/categoryRepository.ts` | Dexie-backed bucket/category read repository | Read-only | Low | Expected direct Dexie adapter usage. Leave direct. |
| `src/repositories/recipientRepository.ts` | Dexie-backed recipient read repository | Read-only | Low | Expected direct Dexie adapter usage. Leave direct. |
| `src/repositories/transactionRepository.ts` | Dexie-backed transaction read repository | Read-only | Low | Expected direct Dexie adapter usage. Leave direct. |
| `src/repositories/reportRepository.ts` | Report boundary and lookup helpers | Read-only | Low | Expected repository boundary. Leave direct service wrapping. |
| `src/pages/AddTransaction.tsx` | SMS template read, description/category frequency reads, edit reads, paired transfer reads, transaction create/update and transfer pair writes | Read and write | High | Defer write paths. Consider moving SMS template read behind a new repository; leave transfer and submit logic untouched. |
| `src/pages/Transactions.tsx` | Duplicate paired transaction read, transfer detection read, delete transaction/pair writes | Read and destructive write | High | Leave delete/write paths direct until transaction write repository milestone. Optional: move duplicate/read helpers later. |
| `src/pages/TransactionDetails.tsx` | Load transaction and lookup details; update budget linkage | Read and write | Medium/high | Move read-only detail loading behind existing repositories first; defer update/link write. |
| `src/pages/AddBudget.tsx` | Lookup reads, budgets reads/writes, transaction reads, budget snapshot reads, linked transaction checks | Read and write | High | Defer. Budget repository should come later and start with reads. |
| `src/pages/Budget.tsx` | Budget, transaction, lookup, snapshot reads; snapshot cleanup; budget delete/deactivate; transaction budget-link updates | Read and write/destructive | High | Defer because budget snapshot sensitive. Do not migrate casually. |
| `src/pages/BudgetHistory.tsx` | Snapshot/budget/transaction/lookup reads; budget deactivate/delete; snapshot delete; transaction unlink/update | Read and write/destructive | High | Defer because budget snapshot sensitive. |
| `src/pages/AccountsManagement.tsx` | Account list, transaction usage checks, deactivate/delete/toggle active | Read and write/destructive | Medium | Next low-risk slice can move list and usage-check reads behind repositories; defer writes. |
| `src/components/AddAccountModal.tsx` | Create/update accounts and re-read saved account | Write | Medium | Defer until account write repository milestone. |
| `src/pages/BucketsManagement.tsx` | Bucket/category list reads, usage checks, add/update/delete/reorder/cascade delete | Read and write/destructive | Medium/high | Move read-only list/usage checks after account/recipient management; defer writes and cascade deletes. |
| `src/components/AddCategoryModal.tsx` | Create/update category and re-read saved category | Write | Medium | Defer until category write repository milestone. |
| `src/pages/RecipientsManagement.tsx` | Recipient list, transaction usage checks, deactivate/delete/toggle active, duplicate reads | Read and write/destructive | Medium | Move list/usage reads behind repositories soon; defer writes/deletes. |
| `src/components/AddRecipientModal.tsx` | Duplicate alias read and create/update recipient | Read and write | Medium | Move duplicate-read later; defer writes. |
| `src/utils/recipientMerge.ts` | Recipient merge updates recipients, updates transactions, deletes secondary recipient | Write/destructive | High | Defer because write path risky. |
| `src/pages/SmsImportTemplatesManagement.tsx` | Template/account reads and template create/update/delete | Read and write | Medium | Create `SmsImportTemplateRepository`; move list/account reads first. Defer writes. |
| `src/hooks/useSmsParser.ts` | Recipient read for SMS parsing | Read-only | Low | Move behind existing `recipientRepository`. Good next slice. |
| `src/components/CompleteBudgetModal.tsx` | Lookup and transaction reads; add/update transaction for budget completion | Read and write | High | Defer writes; possibly move lookup reads only if scoped carefully. |
| `src/components/EditSnapshotModal.tsx` | Update budget snapshot | Write | High | Defer because budget snapshot sensitive. |
| `src/utils/budgetSnapshots.ts` | Snapshot lookup, creation, pruning, dedupe, and migration linkage | Read and write/destructive | High | Leave direct for now. Budget snapshot generation/pruning is explicitly sensitive. |
| `src/utils/reportService.ts` | Report calculation reads for transactions, buckets, categories | Read-only | Medium | Leave direct for now behind `reportRepository`; later refactor only with report comparison tests. |
| `src/utils/csvExport.ts` | Transaction CSV export reads transactions and lookup tables | Read-only | Low/medium | Could move behind repositories, but CSV behavior is user-facing. Do after management read adoption. |
| `src/utils/csvImport.ts` | CSV import reads lookups/budgets, creates recipients and transactions | Read and write | High | Defer because import writes transaction records. |
| `src/utils/budgetCsvExport.ts` | Budget CSV export reads budgets and lookup tables | Read-only | Medium | Move behind repositories after budget read repository exists. |
| `src/utils/budgetCsvImport.ts` | Budget CSV import reads lookups, creates recipients and budgets | Read and write | High | Defer because budget import writes. |
| `src/utils/fullBackup.ts` | Full JSON backup export over all tables | Read-only safety tool | High | Leave direct for now. It must inspect all Dexie tables exactly. |
| `src/utils/fullBackupRestore.ts` | Restore validation/deserialization and guarded restore transaction over all tables | Destructive safety tool | High | Leave direct for now. Restore is intentionally table-level. |
| `src/utils/dbHealth.ts` | Health check reads all tables; guarded transfer repair and orphan cleanup writes | Read and repair/destructive | High | Leave direct for now. It is a safety/repair tool. |
| `src/utils/migrations.ts` | Generic migration table metadata | Migration/debug | High | Leave direct. |
| `src/pages/Settings.tsx` | Counts, migrations, exports, backups, restore, health, repair/cleanup actions | Read and write/destructive | High | Leave direct for now except future low-risk count reads. Safety tools should stay direct until late. |
| `src/db.ts` | Dexie schema, legacy migrations, budget snapshot migration helpers | Read and write/destructive | High | Leave direct. This is the current adapter/source of truth. |

Files that import model types from `../db` but do not directly call `db.` are not migration targets by themselves. Examples include `SmsImportModal.tsx`, `LinkPastTransactionsModal.tsx`, `MergeRecipientsModal.tsx`, `transactionMatching.ts`, and `transferPairs.ts`.

## Explicit Leave-Direct Areas

Leave these direct-to-Dexie unless there is a task specifically focused on them:

- full backup export
- restore validation
- guarded restore
- database health check
- health repair and cleanup tools
- budget snapshot generation, pruning, dedupe, and migration logic
- transfer pair write guards and transactional transfer writes
- legacy migration and debug utilities

These areas exist to protect or repair the current Dexie database. Abstracting them too early would make it harder to verify whether the repository layer changed behavior.

## Recommended Next Implementation Order

1. **Low-risk read-only management/list screens**
   - Move `AccountsManagement.tsx` initial account list and transaction usage reads behind `accountRepository` and `transactionRepository`.
   - Move `RecipientsManagement.tsx` initial recipient list, duplicate reads, and transaction usage reads behind `recipientRepository` and `transactionRepository`.
   - Keep all deactivate/delete/toggle writes direct in the first pass.

2. **SMS template read paths**
   - Create `smsImportTemplateRepository` with `listTemplates`, `listActiveTemplates`, and `getTemplateById`.
   - Move `AddTransaction.tsx` SMS template lookup loading and `SmsImportTemplatesManagement.tsx` read loading behind it.
   - Move `useSmsParser.ts` recipient lookup behind `recipientRepository`.
   - Leave template create/update/delete direct until a write milestone.

3. **Transaction detail and duplicate read helpers**
   - Move `TransactionDetails.tsx` read-only detail loading behind existing repositories.
   - Consider moving `Transactions.tsx` duplicate pair reads and transfer detection reads behind `transactionRepository`.
   - Leave delete and budget-link update writes direct.

4. **CSV export read paths**
   - Move `csvExport.ts` to repository reads for transactions and lookups.
   - Keep CSV import direct until transaction write repository work exists.
   - Move budget CSV export only after a budget read repository exists.

5. **Budget read repository design and first read-only adoption**
   - Create `BudgetRepository` with read-only `listBudgets`, `getBudgetById`, and snapshot list helpers only.
   - Start outside the most sensitive occurrence-generation paths.
   - Do not move snapshot generation/pruning in this slice.

Later sequence:

- Transaction writes only after read adoption is boring and covered by manual smoke tests.
- Transfer writes only in a transfer-focused task.
- Budget writes and budget snapshot logic last.
- Backup/restore/health direct until late, then use them as comparison tools for any future adapter.

## Warnings For Future Prompts

- Do not combine repository migration with schema changes.
- Do not combine repository migration with UI redesign.
- Do not touch transfer writes unless the task is specifically transfer-focused.
- Do not touch budget snapshots unless the task is specifically budget-snapshot-focused.
- Do not move backup/restore/health behind repositories while they are still the primary safety net for Dexie.
- Do not migrate import/write flows before the equivalent read paths are stable and boring.

## Verification Expectations

For each future slice:

- Run `npm run build`.
- Run relevant unit tests if they exist.
- Manually smoke test the affected screen.
- For risky read-path changes, compare before/after visible row counts and totals.
- For write-adjacent changes, run the database health check afterward.
- For backup/import/restore-adjacent changes, validate a full JSON backup afterward.

# Budget Repository Read Design

This is a planning note for a future read-only `BudgetRepository` slice. It does not approve a schema change, backend migration, budget model rewrite, or any change to budget snapshot lifecycle behavior.

The current source of truth remains Dexie / IndexedDB. Budget snapshots are sensitive because they preserve occurrence-specific history and are used as the canonical transaction-to-budget linkage when `transaction.budgetSnapshotId` is present.

## Files Inspected

- `src/pages/Budget.tsx`
- `src/pages/BudgetHistory.tsx`
- `src/pages/AddBudget.tsx`
- `src/utils/budgetSnapshots.ts`
- `src/utils/budgetCsvExport.ts`
- `src/utils/budgetCsvImport.ts`
- `src/components/EditSnapshotModal.tsx`
- `src/components/CompleteBudgetModal.tsx`
- `docs/data-model-notes.md`
- `docs/repository-adoption-audit.md`
- `docs/repository-abstraction-design.md`

## Current Direct Dexie Usage By Area

### Budget List And Read

Current budget reads appear in:

- `Budget.tsx`: reads all budgets while building the active budget view, visible occurrences, overdue/current/upcoming groups, goal carousel data, delete analysis, and link-to-budget flows.
- `BudgetHistory.tsx`: reads all budgets for historical occurrence views, filtering, labels, delete/deactivate decisions, and link-to-budget flows.
- `AddBudget.tsx`: reads budgets for duplicate/related checks, edit-mode loading, and write-adjacent validation.
- `budgetCsvExport.ts`: reads all budgets for CSV export.
- `budgetCsvImport.ts`: reads lookup data and writes new budgets.

Risk: medium to high. Simple list/get reads are reasonable future repository candidates, but many budget reads are next to writes, snapshot coverage, transaction linking, and occurrence classification.

### Budget Create, Update, Delete, And Deactivate

Current write paths appear in:

- `AddBudget.tsx`: creates and updates budgets, then may update unlocked snapshots, delete future unlinked snapshots, and ensure future snapshot coverage.
- `Budget.tsx`: deletes budgets, deactivates budgets, and deletes unlinked snapshots as part of budget deletion decisions.
- `BudgetHistory.tsx`: deactivates budgets and deletes budgets from historical views.
- `budgetCsvImport.ts`: creates budgets from CSV import.

Risk: high. These paths must remain off-limits for the first read-only repository slice.

### BudgetSnapshot List And Read

Current snapshot reads appear in:

- `Budget.tsx`: reads snapshots for occurrence rendering, duplicate/stale snapshot handling, completed/overdue classification, goal carousel data, delete analysis, and transaction linking.
- `BudgetHistory.tsx`: reads snapshots for historical occurrence construction, filtering, linked transaction display, occurrence deletion, and transaction linking.
- `AddBudget.tsx`: reads snapshots for edit-mode linked transaction checks and post-update lifecycle work.
- `budgetSnapshots.ts`: reads snapshots for coverage, pruning, and update helpers.
- `EditSnapshotModal.tsx`: receives a snapshot object and updates it.

Risk: high. Basic snapshot list/get helpers are possible, but snapshot reads often drive lifecycle writes.

### BudgetSnapshot Create, Update, And Delete

Current snapshot writes appear in:

- `budgetSnapshots.ts`: ensures snapshot coverage, deletes future unlinked snapshots, and updates unlocked future snapshots.
- `Budget.tsx`: deletes stale or unlinked snapshots and calls coverage helpers.
- `BudgetHistory.tsx`: deletes occurrence snapshots and calls `ensureBudgetSnapshotForOccurrence` before linking transactions.
- `AddBudget.tsx`: calls snapshot update/prune/coverage helpers after budget edits.
- `EditSnapshotModal.tsx`: updates one occurrence's amount, transaction cost, and flexibility.
- `CompleteBudgetModal.tsx`: calls `ensureBudgetSnapshotForOccurrence` before adding a completion transaction.

Risk: high. Do not move or rewrite these in the first repository pass.

### Snapshot Coverage, Generation, And Pruning

The most sensitive lifecycle behavior is in:

- `src/utils/budgetSnapshots.ts`
  - `ensureBudgetSnapshotCoverage`
  - `deleteFutureUnlinkedSnapshotsForBudget`
  - `updateUnlockedSnapshotsForBudget`
- `src/db.ts`
  - `ensureBudgetSnapshotForOccurrence`
  - migration and dedupe helpers
- `Budget.tsx`
  - horizon expansion and coverage refresh
  - stale duplicate snapshot cleanup
- `AddBudget.tsx`
  - post-edit coverage, update, and prune flow

Risk: very high. These reads and writes should remain direct until a specific budget snapshot lifecycle task exists.

### Transaction-To-Budget Linking And Unlinking

Current transaction linkage writes appear in:

- `Budget.tsx`: updates transactions with `budgetId`, `budgetSnapshotId`, and `occurrenceDate`.
- `BudgetHistory.tsx`: updates transactions when linking them to a budget occurrence.
- `TransactionDetails.tsx`: unlinks a transaction from a budget occurrence.
- `CompleteBudgetModal.tsx`: adds or updates transactions tied to a budget snapshot.

Risk: high. These are transaction writes with budget semantics and should not be moved during a read-only budget repository slice.

### Budget History

`BudgetHistory.tsx` is a possible future read-only adoption target because it has many label/detail reads, but it also contains budget deactivation, budget deletion, snapshot deletion, and transaction-linking actions.

Risk: mixed. Read-only load composition can be considered, but write-adjacent paths should stay direct.

### Budget CSV Export And Import

- `budgetCsvExport.ts` reads budgets plus category, recipient, and account lookup data.
- `budgetCsvImport.ts` reads lookup data and writes recipients and budgets.

Risk:

- export: medium, read-only but user-facing output must remain byte-for-byte compatible where practical.
- import: high, because it writes recipients and budgets.

Budget CSV export is a reasonable later read-only candidate after a `BudgetRepository` exists. Budget CSV import should stay direct until budget writes are intentionally migrated.

### Complete Budget Modal

`CompleteBudgetModal.tsx` reads categories, buckets, accounts, and transactions, then creates or updates a transaction and may ensure a snapshot exists.

Risk: high. Lookup reads could eventually move behind existing repositories, but the modal is write-adjacent and snapshot-adjacent, so it is not a good first `BudgetRepository` consumer.

## Safe Candidates For A First Read-Only Slice

The first `BudgetRepository` should be deliberately small and read-only. Good candidates:

- `listBudgets()`
- `listActiveBudgets()`
- `getBudgetById(id)`
- `listBudgetSnapshots()`
- `getBudgetSnapshotById(id)`
- `listSnapshotsForBudget(budgetId)`
- `listTransactionsLinkedToBudgetSnapshot(snapshotId)` only if implemented through the existing `transactionRepository` or kept out of the first pass

Initial consumers should prefer low-risk display or export reads:

- `BudgetHistory.tsx` loading of budget/snapshot labels and detail data, if the write paths can remain untouched.
- `budgetCsvExport.ts` budget reads after CSV output comparison is available.
- Possibly non-mutating lookup portions of Budget History filters.

## Reads To Leave Direct For Now

Leave these direct because the read is part of lifecycle or write behavior:

- reads used by `ensureBudgetSnapshotCoverage`
- reads used by `ensureBudgetSnapshotForOccurrence`
- reads used by `deleteFutureUnlinkedSnapshotsForBudget`
- reads used by `updateUnlockedSnapshotsForBudget`
- reads used to detect stale/duplicate snapshots before deletion
- reads used to decide whether a snapshot is linked before deleting it
- reads used immediately before budget create/update/delete/deactivate
- reads used immediately before transaction budget link/unlink updates
- reads used inside budget CSV import
- reads inside backup, restore, health check, and repair/cleanup tools

These flows need a separate, explicitly budget-snapshot-focused migration plan.

## Write Paths Off-Limits

Do not move these in the first read-only `BudgetRepository` slice:

- budget create
- budget update
- budget delete
- budget deactivate
- snapshot create
- snapshot update
- snapshot delete
- future snapshot generation
- future unlinked snapshot pruning
- unlocked snapshot updates after budget edits
- transaction budget link/unlink updates
- complete-budget transaction create/update
- budget CSV import
- health cleanup or repair tools

## Minimal Future Interface Sketch

Keep the first interface raw-model and read-only:

```ts
interface BudgetRepository {
  listBudgets(): Promise<Budget[]>;
  listActiveBudgets(): Promise<Budget[]>;
  getBudgetById(id: number): Promise<Budget | undefined>;
  listBudgetSnapshots(): Promise<BudgetSnapshot[]>;
  getBudgetSnapshotById(id: number): Promise<BudgetSnapshot | undefined>;
  listSnapshotsForBudget(budgetId: number): Promise<BudgetSnapshot[]>;
}
```

Optional later read helpers, after the basics are stable:

```ts
interface BudgetRepository {
  listSnapshotsByIds(ids: number[]): Promise<BudgetSnapshot[]>;
  listBudgetsByIds(ids: number[]): Promise<Budget[]>;
  listBudgetHistoryReadModel(): Promise<BudgetHistoryReadModel>;
}
```

Avoid exposing Dexie `Table`, `Collection`, `where`, `filter`, or transaction mechanics through the interface. Also avoid adding write-shaped names such as `ensure`, `sync`, `prune`, `repair`, or `link` in the read-only pass.

## Suggested Implementation Order

1. Create `src/repositories/budgetRepository.ts` with only raw read methods.
2. Export it from `src/repositories/index.ts`.
3. Use it in a narrow, display-only Budget History load path if the surrounding writes can remain unchanged.
4. Run a manual before/after comparison of Budget History counts, labels, linked transaction displays, filters, and occurrence details.
5. Consider `budgetCsvExport.ts` after Budget History is stable, with a before/after CSV comparison.
6. Avoid `Budget.tsx` occurrence generation at first. It mixes visible horizon, coverage generation, stale snapshot cleanup, grouping, goal carousel behavior, delete analysis, and transaction linking.
7. Avoid `AddBudget.tsx` at first. It is write-adjacent and runs snapshot update/prune/coverage logic after saving.
8. Keep backup, restore, health, and cleanup tools direct until late.

## Manual Verification Requirements

For any future budget read repository adoption:

- `npm run build` passes.
- Budget page still loads.
- Overdue, current, upcoming, and future grouping is unchanged.
- Completed historical items stay hidden.
- Incomplete overdue expenses still appear.
- Goal carousel behavior is unchanged.
- Budget History loads unchanged.
- Budget History filters and labels still match previous behavior.
- Linked transaction displays still match previous behavior.
- Budget CSV export output is unchanged if touched.
- Database Health Check remains clean after any write-adjacent manual smoke test.
- Full backup validation still passes after risky budget-adjacent changes.

## Explicit Warnings

- Do not combine budget repository work with budget model v2.
- Do not rewrite snapshot lifecycle during repository adoption.
- Do not change expense/income classification.
- Do not change linked transaction semantics.
- Do not change historical snapshot preservation.
- Do not change visible horizon or 30-day load behavior.
- Do not move budget writes as part of a read-only repository slice.
- Do not move backup/restore/health tools behind repositories while they are still the safety net for Dexie.

## Recommendation

The safest first budget repository milestone is a thin read-only adapter with `list/get` methods for budgets and snapshots, followed by one narrow consumer that only displays existing data. Budget History is a better first candidate than the main Budget page because the main page mixes read rendering with snapshot coverage, pruning, occurrence grouping, delete analysis, goal carousel logic, and transaction linking.

Treat any method that creates, ensures, prunes, repairs, links, unlinks, updates, or deletes as out of scope until a later budget-specific write milestone exists.

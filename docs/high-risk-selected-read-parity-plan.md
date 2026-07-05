# High-Risk Selected-Read Parity Plan

This plan covers future `http-readonly` experiments for workflow-critical
areas: Transactions, Reports, Budget, and Budget History. It is documentation
only. It does not authorize code changes, screen switches, write endpoints, or
budget snapshot lifecycle changes.

The current management-read baseline is intentionally narrow. Recipients,
Buckets/Categories, Accounts, and SMS Import Templates have off-by-default,
flag-gated read experiments and diagnostics. Transactions, Reports, and Budget
also have separate off-by-default, high-risk read experiments after passing
screen-specific parity diagnostics. These experiments do not make HTTP
authoritative and do not approve write or lifecycle migration.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. HTTP
remains read-only. No write methods or write endpoints exist.

## Shared Gates

Every high-risk read experiment must satisfy these gates before any real screen
can use `http-readonly`:

- Export a fresh full app backup.
- Import that exact backup into a matching disposable SQLite database.
- Restart the local API server against that disposable SQLite database.
- Run `verify:sqlite` with the backup and SQLite arguments.
- Run `smoke:api` with the token or token-file argument.
- Run `npm run check:local-api-safety`.
- Confirm the selected-read ordering diagnostic shows all resources as
  `Match`.
- Create a target-specific parity diagnostic and confirm it passes.
- Run manual browser checks in both `dexie` and `http-readonly` modes.
- Put the experiment behind its own per-screen flag.
- Keep default behavior as Dexie.
- Document rollback before enabling the experiment.

Stale SQLite can produce false mismatches or false confidence. Do not trust a
Dexie-vs-HTTP comparison unless SQLite was seeded from the same fresh backup as
the browser Dexie data being compared.

## Transactions

### Why High Risk

Transactions are the central workflow and participate in many invariants:
amount signs, transaction costs, transfer pairs, budget snapshot links, CSV
export, filtering, search, sorting, details, edit/delete actions, and downstream
reports.

### Dexie Behavior To Preserve

- Expense amounts remain negative and income amounts remain positive.
- `transactionCost` remains separate and is included where the current app
  includes it.
- Transfer pairs remain reciprocal and must preserve `transferPairId` and
  `isTransfer` semantics.
- `budgetSnapshotId` remains the canonical budget linkage when present.
- Filters, search, paging/windowing, and sort semantics match the live
  Transactions page.
- CSV/export behavior does not change silently.
- Detail views and lookup labels continue to render the same data.

### Required Parity Before Experiment

- Transaction list count parity for the same filters.
- First-page and sampled-page ID order parity for all supported filters.
- Search result parity.
- Sort parity, including same-date tie-breakers.
- Amount sign and `transactionCost` aggregate spot checks.
- Transfer-pair integrity parity.
- Budget snapshot linkage parity.
- CSV/export output comparison or an explicit decision to keep export on Dexie.

### Required Diagnostics

- A Transactions screen-specific parity diagnostic that compares Dexie and
  `http-readonly` for list/filter/search/order/detail behavior.
- The initial manual Transactions read parity diagnostic in Local API
  Diagnostics may be used as an early gate for count, ID, ordering, selected
  field, amount-sign, transaction-cost, transfer-linkage, and budgetSnapshotId
  parity. It paginates Dexie and `http-readonly` selected-read results before
  comparison and reports stale-baseline/count mismatches separately from row
  parity mismatches. Passing this diagnostic is not approval to switch the real
  Transactions screen.
- A transfer-pair diagnostic that treats reciprocal mismatch, self-links, and
  inconsistent transfer flags as hard failures.
- A budget snapshot linkage diagnostic for transaction rows displayed on the
  Transactions page.

### Forbidden Without Separate Plan

- Migrating edit, delete, duplicate, transfer creation, or transfer editing.
- Changing CSV export/import behavior.
- Changing amount sign conventions.
- Changing `transactionCost` handling.
- Changing budget linkage semantics.
- Adding transaction write endpoints or no-op writes.

### Rollback Expectations

The experiment must be behind a Transactions-specific flag. Turning the flag
off or setting the backend to `dexie`, followed by a Vite restart, must restore
the current Dexie page behavior.

### Current Experiment

`VITE_PERSONAL_FINANCE_TRANSACTIONS_READ_EXPERIMENT=true` enables the
Transactions list read experiment. In `http-readonly` mode the list is loaded
through the selected-read facade with paginated, capped reads. Detail
navigation, edit, delete, duplicate, transfer, import, and CSV export controls
remain disabled because no detail/write/export workflow has migrated. This
experiment remains local-dev only and requires a fresh matching SQLite baseline
before its HTTP results are trusted. Account/payment icons may show placeholders
in `http-readonly` because account image/icon data is intentionally omitted
from the read-only HTTP path. Passing read parity does not authorize
transaction writes, exports, transfers, detail workflow migration, or any change
to Dexie as the authoritative store.

## Reports

### Why High Risk

Reports depend on aggregate semantics rather than just row shape. Small
differences in date grouping, amount signs, transfer handling, bucket
exclusions, or rounding can silently change charts and totals.

### Dexie Behavior To Preserve

- Aggregates use the same current app behavior for `amount + transactionCost`.
- Income and expense classification remains unchanged.
- Exclude-from-reports bucket behavior remains unchanged.
- Transfer handling remains unchanged.
- Local JavaScript date grouping remains unchanged.
- Monthly, quarterly, and yearly grouping remain unchanged.
- Aggregate rounding remains at the current 2-decimal behavior.
- Charts, totals, period selectors, and bucket/category breakdowns do not
  silently change.

### Required Parity Before Experiment

- Monthly, quarterly, and yearly total parity.
- Income, expense, transfer, and net total parity.
- Bucket/category breakdown parity, including excluded buckets.
- Date-boundary samples across month, quarter, and year edges.
- Rounding parity at 2 decimals.
- Chart input data parity, not just final visible labels.

### Required Diagnostics

- A Reports-specific parity diagnostic that compares the same report periods
  and breakdowns the live page renders.
- The initial manual Reports parity diagnostic in Local API Diagnostics may be
  used as an early gate for monthly, quarterly, and yearly period key/order
  parity, `totalIncome`, `totalExpense`, `netTotal`, contributing transaction
  count, stale-baseline detection, and truncation detection. It uses paginated
  selected-read transaction reads and follows the current report semantics for
  `amount + transactionCost`, `excludeFromReports` income-bucket
  classification, signed expense totals, transfer inclusion through normal
  category/bucket semantics, local JavaScript date grouping, and 2-decimal
  rounding. It is summary-only and does not expose raw rows or individual
  amount values. Passing it is not approval to migrate chart, drilldown, export,
  or write behavior.
- A date grouping diagnostic that confirms local JS grouping matches current
  Dexie behavior.
- A rounding diagnostic that catches cent-level aggregate drift.

### Forbidden Without Separate Plan

- Expanding the Reports experiment based only on the structural Reports
  preview.
- Expanding the Reports experiment based only on the aggregate Reports parity
  diagnostic without chart input, bucket/category breakdown, and UI period
  behavior parity.
- Changing chart or aggregate formulas.
- Changing transfer inclusion/exclusion semantics.
- Changing bucket exclusion behavior.
- Adding financial aggregate endpoints intended for production use.

### Rollback Expectations

The experiment must be behind a Reports-specific flag. Rollback must restore
all Reports calculations to the current Dexie/report-service path immediately
after disabling the flag and restarting Vite.

### Current Experiment

`VITE_PERSONAL_FINANCE_REPORTS_READ_EXPERIMENT=true` enables a narrow Reports
read experiment. When the flag is off, Reports uses the existing Dexie report
path. When the flag is on with backend `dexie`, Reports still uses the existing
Dexie path. In `http-readonly` mode, the main period report loads transaction,
category, and bucket inputs through selected-read paginated reads capped at
5,000 transaction inputs for the selected period, then applies the same local
report calculation semantics. Truncated selected-read loads show an on-page
warning and must not be treated as full-confidence totals. The monthly chart
and bucket/category drilldown modal remain disabled in `http-readonly` because
those paths still rely on Dexie-backed report helpers. This remains local-dev
only and does not authorize report writes, export behavior, server-side
aggregate endpoints, chart migration, drilldown migration, or any change to
Dexie as the authoritative store.

## Budget

### Why High Risk

The Budget page is lifecycle-sensitive. It mixes reads with occurrence display,
budget snapshot coverage, pruning, current/recurring behavior, goals, linked
transactions, and write actions.

### Dexie Behavior To Preserve

- Budget ordering and current/recurring occurrence behavior match the live page.
- Amount and `goalDirection` semantics match current app behavior.
- Snapshot coverage, generation, pruning, and lifecycle helpers are not called
  accidentally.
- Linked transaction and budget occurrence display remains unchanged.
- Create, edit, delete, completion, linking, and goal behavior remain on Dexie
  until a separate write/lifecycle plan exists.

### Required Parity Before Experiment

- Budget list and occurrence order parity.
- Active/inactive and recurring/current display parity.
- Goal budget display parity, including `goalDirection` handling.
- Linked transaction count and amount-paid display parity.
- Snapshot coverage read parity without generating, pruning, or repairing
  snapshots.

### Required Diagnostics

- A Budget page-specific read diagnostic that compares display groups, ordering,
  IDs, and lifecycle-sensitive derived flags.
- The initial manual Budget read parity diagnostic in Local API Diagnostics may
  be used as an early gate for budget count, sampled ID membership, selected-read
  display order, active/inactive counts, frequency distribution,
  `goalDirection` distribution, `isFlexible` distribution, reference-ID
  distributions, amount sign distribution, due-date day-key distribution,
  target/amount field presence, current/recurring classification, and
  snapshot-to-budget linkage counts. Budget-row parity and snapshot-linkage
  parity are reported separately. Snapshot linkage uses paginated selected-read
  budget snapshot reads, with a larger diagnostic cap than the budget-row cap,
  and reports truncation as `budget_snapshot_linkage_truncated` instead of
  treating a capped sample as parity evidence. It is summary-only and does not
  expose budget descriptions, amount values, target values,
  account/category/recipient names, raw budget rows, raw snapshot rows, token
  values, or SQLite paths. It does not call budget snapshot lifecycle helpers.
  Passing it is not approval to switch the real Budget page by itself.
- A goal semantics diagnostic covering `goalDirection`, amount signs, and
  target display.
- A linked-transaction diagnostic that confirms displayed paid/progress values
  match Dexie without mutating snapshots.

### Forbidden Without Separate Plan

- Calling snapshot generation, pruning, coverage, dedupe, repair, creation, or
  update helpers from a read experiment.
- Migrating budget writes.
- Changing budget amount or goal semantics.
- Changing transaction linkage behavior.
- Adding write endpoints or no-op write methods.

### Rollback Expectations

The experiment must be behind a Budget-specific flag. Rollback must restore the
current Dexie read and lifecycle path by disabling the flag and restarting Vite.

### Current Experiment

`VITE_PERSONAL_FINANCE_BUDGET_READ_EXPERIMENT=true` enables a narrow Budget
read experiment. When the flag is off, Budget uses the existing Dexie read and
lifecycle path. When the flag is on with backend `dexie`, Budget still uses the
existing Dexie path. In `http-readonly` mode, Budget inputs are loaded through
the selected-read facade with bounded paginated reads for budgets, budget
snapshots, transactions, categories, buckets, recipients, and accounts.

This experiment remains local-dev, read-only, and capped. It bypasses snapshot
lifecycle helpers and disables add, edit, delete, completion, transaction
linking, import, export, and load-more lifecycle actions. Truncated
selected-read inputs show an on-page warning and must not be treated as
full-confidence Budget results. Passing the Budget read parity diagnostic does
not authorize budget writes, transaction linking migration, snapshot
generation, pruning, dedupe, repair, coverage, Budget History migration, or any
change to Dexie as the authoritative store.

## Budget History

### Why High Risk

Budget History depends on historical snapshots and linked transactions. It must
preserve historical records and derived completion/linking behavior. Selected
read snapshot ordering is already normalized, but ordering parity alone is not
enough for a real screen switch.

### Dexie Behavior To Preserve

- Historical snapshots are never mutated by read experiments.
- Grouping, filtering, completion, linking, and visible occurrence behavior
  match the current page.
- Transaction-linked `amountPaid` and effective target semantics match before
  switching.
- Snapshot ordering remains date descending with deterministic ID tie-breakers
  where the selected-read path is used.
- Budget History reads do not call generation, pruning, dedupe, repair, or
  lifecycle helpers.

### Required Parity Before Experiment

- Budget History occurrence count parity.
- Grouping and filtering parity.
- Completion-state parity.
- Linked transaction parity for sampled snapshots.
- `amountPaid`, effective target, and goal-direction parity.
- Historical/current snapshot classification parity.

### Required Diagnostics

- A Budget History page-specific parity diagnostic that compares displayed
  occurrence summaries, filters, completion flags, and linked transaction
  summaries.
- The initial manual Budget History read parity diagnostic in Local API
  Diagnostics may be used as an early gate for budget snapshot count and ID
  membership parity, default display ordering, deduped occurrence keys,
  snapshot budgetId/due-date/goalDirection/isFlexible distributions, linked
  budget presence, transaction budgetSnapshotId linkage, rounded `amountPaid`
  and effective-target mismatch counts, and completion mismatch counts. It uses
  bounded paginated selected-read inputs and reports truncation instead of
  claiming full parity from capped data. It is summary-only and does not expose
  budget descriptions, names, amount values, target values, transaction details,
  raw snapshot rows, raw transaction rows, token values, or SQLite paths. It
  does not call budget snapshot generation, pruning, dedupe, repair, coverage,
  creation, or update helpers. Passing it is not approval to switch the real
  Budget History page by itself.
- A transaction-linked amount diagnostic for `amountPaid` and effective target.
- A historical stability check confirming no read experiment mutates snapshot
  rows.

### Forbidden Without Separate Plan

- Mutating historical snapshots.
- Running repair, dedupe, generation, pruning, or coverage helpers.
- Changing completion or linking semantics.
- Changing transaction-linked amount calculations.
- Migrating Budget History writes or lifecycle actions.

### Rollback Expectations

The experiment must be behind a Budget History-specific flag. Rollback must
restore the current Dexie path and leave all historical snapshots unchanged.

## Not Yet Allowed

- No write endpoints.
- No HTTP-backed creates, updates, or deletes.
- No transaction mutation.
- No Transactions write, export, transfer, or detail workflow migration based
  only on the read experiment.
- No budget snapshot generation, pruning, dedupe, or repair.
- No Reports page switch based only on the structural sample preview.
- No high-risk screen experiment based on stale SQLite comparisons.
- No production or local-network safety assumptions from the current
  browser-token prototype.

## Baseline Reference

The management-read baseline tag is `read-experiments-management-baseline`.
That tag marks the point where management/lookup read experiments exist and
diagnostics are available. It is not approval to migrate Transactions, Reports,
Budget, or Budget History.

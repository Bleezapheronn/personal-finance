# Local API Frontend Adapter Notes

This is prototype scaffolding only. The live Ionic app still uses Dexie /
IndexedDB through the existing repositories, and IndexedDB remains the
authoritative data store.

Migration readiness gates are summarized in
[selected-read-migration-readiness-audit.md](selected-read-migration-readiness-audit.md).
Future write/mutation architecture is intentionally separate and documented in
[write-mutation-architecture-plan.md](write-mutation-architecture-plan.md).

The HTTP adapters under `src/repositories/http/` are not imported by existing
pages or by `src/repositories/index.ts`. They are intentionally kept behind
explicit imports so they cannot change app behavior by accident.

## Configuration

Manual prototype calls require Vite environment variables:

```text
VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie
VITE_PERSONAL_FINANCE_LOCAL_API_URL=http://127.0.0.1:3147
VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN=<local prototype token>
VITE_PERSONAL_FINANCE_SHOW_LOCAL_API_DIAGNOSTICS=true
VITE_PERSONAL_FINANCE_SHOW_SELECTED_READ_PREVIEWS=true
VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT=true
VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true
VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT=true
```

`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND` supports:

- `dexie` - default, authoritative, normal app behavior
- `http-readonly` - experimental local API read-only mode for future manual
  adapter experiments

Missing or unknown backend values fall back to `dexie`. Existing pages still use
the Dexie repository exports by default; the adapter selection scaffold does not
switch any live page or route to HTTP.

`VITE_PERSONAL_FINANCE_SHOW_LOCAL_API_DIAGNOSTICS=true` enables the dev-only
Local API Diagnostics screen. The screen is hidden by default and should remain
off for normal app use. Restart Vite after changing any `VITE_` environment
value.

`VITE_PERSONAL_FINANCE_SHOW_SELECTED_READ_PREVIEWS=true` enables opt-in
selected-read preview sections on real workflow screens. These previews are
hidden by default, read-only, and experimental. They do not replace the real
screen data source or write behavior. Restart Vite after changing this flag.

Do not commit `.env` files or token values. The local API client fails closed
when its URL or token is missing, and it does not include token values in thrown
errors.

`VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT=true` enables the dev-only
Recipients SQLite write UI experiment only when
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly` is also selected.
Restart Vite after changing this flag. The API server must separately be
started with the backend write flags for the actions being tested:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES=true
PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true
```

The Recipients write experiment is SQLite-only and disposable. Dexie remains
authoritative, no dual-write occurs, and delete/merge remain unavailable.
Successful writes dirty the disposable SQLite database; re-import SQLite from a
fresh backup before clean parity checks.

`VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true` enables the
dev-only Buckets/Categories SQLite create/update experiment only when the
selected backend is `http-readonly`. The server independently requires:

```text
PERSONAL_FINANCE_ENABLE_BUCKET_CATEGORY_WRITES=true
```

The page submits a non-mutating dry-run before each write and refreshes from
the selected HTTP read source after server-confirmed success. Bucket/category
active-state controls, delete, cascade, and bucket reorder remain unavailable
in HTTP mode. No Dexie write or dual-write occurs. Restart Vite after changing
the frontend flag, and re-import disposable SQLite after successful writes
before clean parity checks.

`VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT=true` enables the dev-only
Accounts SQLite create/update experiment only when the selected backend is
`http-readonly`. The write flag also activates the Account list's selected HTTP
read source so successful writes can be refreshed. The server independently
requires:

```text
PERSONAL_FINANCE_ENABLE_ACCOUNT_WRITES=true
```

The page runs the matching dry-run before each real write, waits for
server-confirmed mutation, and then reloads Accounts from the HTTP selected-read
source. Default Dexie behavior is unchanged. HTTP mode supports only the
current non-image create/update fields: name, currency, `isCredit`, and optional
credit limit. Images are omitted and preserved on update; active-state,
delete, merge, reference reassignment, transactions, balances, and payment
methods remain unavailable and unchanged. Changes to currency, `isCredit`, or
credit limit are financially significant for display/interpretation but do not
trigger transaction or aggregate recalculation.

No Dexie write or dual-write occurs. Successful writes dirty disposable
SQLite, so re-import from a fresh matching backup before parity checks. Restart
Vite after changing the frontend flag, and use a distinct test port to avoid a
stale API process.

Browser calls use the custom `x-personal-finance-token` header, which triggers a
CORS preflight request. The local API server must be running with the Vite dev
origin allowed. The prototype server allows these common Vite origins by
default:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

Unexpected browser origins are rejected. The token is exposed to the browser in
this prototype, so keep it local/dev-only.

## Read-Only Scope

The scaffold uses `fetch` and sends the token with the server's existing
`x-personal-finance-token` header. Only read methods are present:

- transactions: list, detail, count
- lookups: accounts, buckets, categories, recipients, SMS import templates
  list/detail reads
- budgets: budget and budget snapshot list/detail reads
- budget snapshots for a budget

No broad write adapter is implemented. Normal app behavior still defaults to
Dexie; local API use is limited to diagnostics, explicit flag-gated read
experiments, and the explicit dev-only Recipients, Buckets/Categories, and
Accounts SQLite write experiments.

The selected-read `http-readonly` facade has no write support. Future consumers
must not silently no-op writes; write attempts through the selected-read facade
in HTTP-readonly mode should fail loudly. Each dev-only write experiment uses a
separate, narrow helper and is not a broad write repository. Dexie remains
authoritative.

## Selected Read Facade

`src/repositories/selectedReadRepositories.ts` exposes an opt-in read-only
facade named `selectedReadRepositories`. It is imported only by approved
diagnostic and explicit flag-gated experiment paths, and does not change default
live app behavior. With no backend environment variable, or with
an unknown value, it selects Dexie readers. With
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, it can select the
HTTP read-only adapters for manual experiments.

The facade exposes read groups for transactions, accounts, buckets, categories,
recipients, SMS import templates, budgets, and budget snapshots. It does not
expose create, update, or delete methods.

Dexie reads return existing app models, including `Date` objects. HTTP reads
return explicit DTOs with serialized date strings and paginated list response
shapes. Treat facade return types as backend-specific until a future reviewed
adapter layer performs explicit conversion.

## Manual Backend Selection Diagnostic

`src/repositories/backendSelectionDiagnostics.ts` verifies the adapter selection
scaffold and selected read facade without switching the app backend. It checks
fallback behavior, `http-readonly` recognition, facade mapping, and the read-only
write guard. It does not access finance rows and does not mutate data.

Run it manually from the Vite dev console:

```ts
const diagnostics = await import(
  "/src/repositories/backendSelectionDiagnostics.ts"
);
diagnostics.runRepositoryBackendSelectionDiagnostics({ logSummary: true });
```

The diagnostic is not imported by the app, is not auto-run, and does not change
the selected backend. Dexie remains authoritative.

## Manual Selected Read Facade Diagnostic

`src/repositories/selectedReadRepositoryDiagnostics.ts` exercises the selected
read facade through representative reads. It uses the currently selected backend:
Dexie by default, or HTTP read-only when Vite is started with:

```text
VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly
```

Restart Vite after changing environment variables. For HTTP mode, the local API
server must already be running with the local API URL and token configured in the
Vite environment.

Run the diagnostic manually from the Vite dev console:

```ts
const diagnostics = await import(
  "/src/repositories/selectedReadRepositoryDiagnostics.ts"
);
await diagnostics.runSelectedReadRepositoryDiagnostics({ logSummary: true });
```

The diagnostic checks transaction count/list/detail reads plus representative
list/detail reads for accounts, buckets, categories, recipients, budgets, and
budget snapshots, plus SMS import template list/detail reads. Console output is
summary-only and uses sampled IDs only. It does not print finance rows, account
names, recipient names, SMS template names, regex/pattern values, budget
descriptions, transaction descriptions, transaction references, or token values.
It does not mutate data and does not switch the app backend. Dexie remains
authoritative.

## Dev-Only Diagnostics Screen

When `VITE_PERSONAL_FINANCE_SHOW_LOCAL_API_DIAGNOSTICS=true` is set before Vite
starts, the side menu shows a Local API Diagnostics entry. The route is
diagnostic-only, read-only, and default hidden. If the flag is not enabled,
direct navigation to the route shows a safe disabled message.

The screen displays the current repository backend and selected source, then
lets you manually run:

- backend selection diagnostics
- selected read repository diagnostics
- selected-read ordering diagnostics
- Dexie-vs-HTTP parity diagnostics
- Transactions read parity diagnostics
- Reports parity diagnostics
- selected read preview
- Categories preview
- Reports diagnostic preview

Diagnostics do not run on page load. Results are summary-only: pass/fail,
compared checks, failed checks, mismatch totals where available, safe error
codes, and sampled IDs. The screen must not render raw finance rows, account
names, recipient names, budget descriptions, transaction descriptions,
transaction references, token values, or SQLite paths.

The selected-read ordering diagnostic compares capped Dexie and HTTP read-only
ID samples for transactions, budgets, budget snapshots, accounts, buckets,
categories, recipients, and SMS import templates. It normalizes sampled IDs
before comparing them, so numeric and string forms such as `16` and `"16"` are
treated as the same ID. It reports resource names, sampled IDs, exact normalized
ordering match status, and counts when available. Count availability is
informational and is not itself an ordering mismatch. Ordering differences are
expected to be surfaced before any real screen migration because pagination,
previews, and first-page UI behavior depend on stable ordering. This diagnostic
does not expose raw rows or sensitive fields.

Selected-read lookup/management ordering has been normalized for accounts,
buckets, categories, recipients, and SMS import templates. Those selected-read
Dexie paths now use deterministic ordering before paging to match the read-only
HTTP lookup endpoints: buckets by display order then ID, and the other lookup
resources by name then ID. This does not change the real management page data
sources or write behavior.

Selected-read transaction ordering has also been normalized between Dexie and
HTTP read-only paths. It follows the existing live Transactions page semantics:
date descending, incoming combined totals before outgoing combined totals for
the same date, combined total ascending within the same sign, and ID ascending
as a deterministic tie-breaker. Sorting happens before selected-read
limit/offset pagination, and transaction filters remain applied before sorting.
The real Transactions page still uses its existing Dexie loading, filtering,
edit/delete/transfer, and export behavior.

Local API Diagnostics also includes a manual Transactions read parity
diagnostic. It compares selected-read Dexie transactions with selected-read
`http-readonly` transactions using paginated reads. The diagnostic uses a small
page size that respects the server limit and continues until it reaches the
reported count, the diagnostic maximum, or an empty page. Output is
summary-only: counts, page size, pages loaded, truncation status, sampled IDs,
order match, field mismatch counts by field name, amount-sign mismatch count,
transaction-cost presence/sign mismatch counts, transfer-linkage mismatch
count, and budgetSnapshotId mismatch count. It does not render transaction
descriptions, transaction references, account/category/recipient names, amount
values, transactionCost values, original currency/exchange-rate values, raw row
data, tokens, or SQLite paths. It is a diagnostic gate only and does not
authorize a real Transactions screen switch by itself. If Dexie and HTTP
reported counts differ, the diagnostic reports a baseline/count mismatch;
that usually means SQLite was not imported from a fresh backup matching current
Dexie data. Trust results only after exporting a fresh backup, importing it into
matching disposable SQLite, restarting the API, and rerunning `verify:sqlite`,
`smoke:api`, and `npm run check:local-api-safety`.

Local API Diagnostics also includes a manual Reports parity diagnostic. It
compares Dexie-derived report aggregates with selected-read `http-readonly`
transaction-derived aggregates using paginated reads. The diagnostic covers
monthly, quarterly, and yearly period keys/order, `totalIncome`, `totalExpense`,
`netTotal`, and contributing transaction count. It follows the current report
semantics for `amount + transactionCost`, income-bucket classification through
`excludeFromReports`, signed expense totals, transfer inclusion through normal
category/bucket semantics, local JavaScript date grouping, and 2-decimal
aggregate rounding. Output is summary-only: loaded/reported counts, page size,
pages loaded, truncation flags, period counts, mismatch counts by aggregate
field, first few mismatching period keys, safe result codes, and the fresh
backup/import reminder. It does not render raw rows, descriptions, references,
names, individual amount values, tokens, or SQLite paths. This diagnostic must
pass against a fresh matching SQLite baseline before trusting the Reports read
experiment.

Local API Diagnostics also includes a manual Budget read parity diagnostic. It
compares selected-read Dexie budget reads with selected-read `http-readonly`
budget reads using bounded paginated reads. Budget-row parity and optional
snapshot-linkage parity are reported separately. Snapshot linkage reads page
through selected-read budget snapshots with the same safe page size and a
larger diagnostic cap, currently 5,000 rows, so linkage distribution is not
judged from the first 500 rows. If snapshots are still capped, the diagnostic
reports `budget_snapshot_linkage_truncated`; if snapshot counts differ, it
reports `budget_snapshot_baseline_count_mismatch`; if fully loaded linkage
distribution differs, it reports
`budget_snapshot_linkage_distribution_mismatch`. Output is summary-only: budget
loaded/reported counts, page size, truncation flags, sampled budget IDs, loaded
ID match, display-order match, safe field mismatch counts by field name,
distribution match flags, distribution mismatch counts, snapshot loaded/reported
counts, snapshot page counts, snapshot truncation flags, snapshot budget-id
linkage match flag, safe result codes, and the fresh backup/import reminder. It
does not render budget descriptions, amount values, target values,
account/category/recipient names, raw budget rows, raw snapshot rows, token
values, or SQLite paths. It does not call budget snapshot generation, pruning,
dedupe, repair, coverage, creation, or update helpers. This diagnostic is an
early gate only and does not authorize a real Budget screen switch by itself.
Trust results only after exporting a fresh backup, importing it into matching
disposable SQLite, restarting the API, and rerunning `verify:sqlite`,
`smoke:api`, and `npm run check:local-api-safety`.

Local API Diagnostics also includes a manual Budget History read parity
diagnostic. It compares selected-read Dexie Budget History inputs with
selected-read `http-readonly` inputs using bounded paginated reads: budget
snapshots up to 5,000 rows, transactions up to 5,000 rows, and budgets up to
500 rows. It reproduces the Budget History read derivation for past snapshot
occurrences, deduped occurrence keys, linked transaction counts, rounded
`amountPaid`/effective-target parity, completion status, display order, and
safe distributions. Output is summary-only: loaded/reported counts, page
counts, truncation flags, sampled snapshot IDs, match flags, mismatch counts by
field/distribution name, safe result codes, and the fresh backup/import
reminder. It does not render budget descriptions, names, amount values, target
values, transaction details, raw rows, tokens, or SQLite paths. It does not
call budget snapshot generation, pruning, dedupe, repair, coverage, creation,
or update helpers. This diagnostic is an early gate only and does not authorize
a real Budget History screen switch by itself. Trust results only after
exporting a fresh backup, importing it into matching disposable SQLite,
restarting the API, and rerunning `verify:sqlite`, `smoke:api`, and
`npm run check:local-api-safety`.

## Reports Read Experiment

`VITE_PERSONAL_FINANCE_REPORTS_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for Reports. The flag is off by default
and is separate from preview/diagnostic flags. Restart Vite after changing it.

When the flag is off, Reports uses the existing Dexie report repository path.
When the flag is on with `VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`,
Reports still uses the existing Dexie report path. When the flag is on with
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, the main period
report loads transaction, category, and bucket inputs through the selected-read
facade with paginated reads and then applies the same local report calculation
semantics. The current cap is 5,000 transaction inputs per selected period. If
the selected-read transaction load is truncated, the page shows a warning and
the rendered totals must not be treated as full-confidence report totals.

In `http-readonly` experiment mode, the monthly spending chart and
bucket/category drilldown modal are disabled because those paths still call
Dexie-backed report helpers. No report writes, export paths, server-side report
calculation endpoints, or aggregate API endpoints are added. Roll back by
turning `VITE_PERSONAL_FINANCE_REPORTS_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

## Transactions Read Experiment

`VITE_PERSONAL_FINANCE_TRANSACTIONS_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for the Transactions list. The flag is off
by default and is separate from the redacted preview flag. Restart Vite after
changing it.

When the flag is off, the Transactions page uses the existing Dexie read,
filter, edit, delete, duplicate, transfer, import, and export behavior. When
the flag is on with `VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, behavior
remains on the existing Dexie path. When the flag is on with
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, the list is loaded
through the selected-read facade in paginated batches capped for the experiment.
The page shows a local-dev banner with the backend, loaded count, page count,
and any truncation warning.

In `http-readonly` mode, detail navigation, create, edit, delete, duplicate,
transfer, import, and CSV export controls are hidden or guarded. No transaction
write, transfer, detail workflow, or export path is migrated. Before enabling
the experiment, use a fresh backup, matching SQLite import, restarted API
server, passing Transactions read parity diagnostic, `verify:sqlite`,
`smoke:api`, and `npm run check:local-api-safety`. Roll back by turning
`VITE_PERSONAL_FINANCE_TRANSACTIONS_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

This experiment is read-only and local-dev only. Passing Transactions read
parity does not authorize writes, exports, transfers, or making SQLite
authoritative. Account/payment icons may fall back to placeholders in
`http-readonly` because account image/icon data is omitted from the read-only
HTTP path.

Selected-read budget ordering has also been normalized between Dexie and HTTP
read-only paths. It uses due date ascending with ID ascending as the
deterministic tie-breaker, matching the existing read-only HTTP budget endpoint
and the Budget page's primary due-date-oriented occurrence display. Sorting
happens before selected-read limit/offset pagination, and budget filters remain
applied before sorting. The real Budget page still uses its existing Dexie
loading, snapshot migration/coverage helpers, create/edit/delete behavior, and
Budget History behavior.

Selected-read budget snapshot ordering has been normalized between Dexie and
HTTP read-only paths. It follows Budget History's date-descending display
semantics with ID ascending as the deterministic tie-breaker, preserving the
Dexie primary-key order that the live page effectively keeps for same-date
snapshot rows. Sorting happens before selected-read limit/offset pagination,
and snapshot filters remain applied before sorting. The real Budget History and
Budget pages still use their existing Dexie loading, grouping, filtering,
completion, linking, editing, delete behavior, and snapshot lifecycle helpers.
No snapshot generation, pruning, dedupe, repair, creation, or update behavior is
changed. With this normalization, all selected-read ordering diagnostic
resources should match when Dexie and the disposable SQLite database are seeded
from the same backup.

The selected read preview is also manual and dev-only. It intentionally caps
loaded preview rows to a tiny sample and does not load or display full tables.
It requests a small page from each representative selected-read resource through
`selectedReadRepositories` and displays only resource name, backend/source, total
count when available, preview loaded row count, sampled IDs, pass/fail status,
and safe error code. It does not switch any real workflow page to HTTP and does
not render raw rows.

Shared dev-only preview helpers live in `src/utils/devPreview.ts`, and the
common read-only preview card shell lives in
`src/components/dev/SelectedReadPreviewCard.tsx`. Page-specific preview mapping
should stay close to each page so sensitive-field redaction remains easy to
review.

Run `npm run check:selected-read-imports` before changing preview or repository
adapter wiring. The guard scans frontend source files and fails if selected-read
or local API HTTP imports appear outside the approved adapter, diagnostic, and
explicitly gated preview files.

Run `npm run check:no-runtime-artifacts` before committing local API or SQLite
prototype work. The guard checks the git worktree for artifact-like paths such
as `.env` files, local tokens, SQLite databases, generated backups, exports,
logs, import summaries, and report JSON files without reading or printing file
contents.

Run `npm run check:local-api-safety` before selected-read or local API commits
when you want the browser-independent safety bundle. It runs the selected-read
import guard, runtime artifact guard, root build, and server build in sequence,
stopping on the first failure. It does not require backup, SQLite, token, or
browser configuration.

`verify:sqlite` and `smoke:api` are still separate runtime checks. Run them
with their required backup/sqlite/token arguments when importer, comparison,
server, or API behavior changes. Browser diagnostics and preview checks also
remain manual Vite checks when UI, selected-read behavior, or browser CORS
behavior changes.

The Categories preview is a separate dev-only read experiment on the same
screen. It uses `selectedReadRepositories` to load categories and buckets through
the currently selected backend, then renders only structural fields such as IDs,
bucket linkage, active state, and bucket display order. It is not the real
Categories/Buckets management screen, has no edit/delete/reorder actions, and
does not switch any normal workflow page to HTTP.

The Reports diagnostic preview also lives only in Local API Diagnostics. It uses
`selectedReadRepositories.transactions` to load a capped transaction sample and
shows backend/source, the limited sample window, loaded/count values,
income/expense/transfer counts, and rounded sample totals derived from
`amount + transactionCost`. It is a structural report-style preview, not full
Reports parity: it does not apply the real Reports page period selection,
bucket exclusion, chart, or bucket/category breakdown semantics. The real
Reports page has a separate flag-gated read experiment described above; with
the flag off, it remains on the existing Dexie report path. Use the separate
manual Reports parity diagnostic when comparing aggregate report totals; the
structural preview is not a parity gate.

Do not commit `.env.local`. Dexie remains authoritative and SQLite remains
disposable.

## Real-Screen Selected Read Previews

The Categories/Buckets management page can show an experimental selected-read
preview when `VITE_PERSONAL_FINANCE_SHOW_SELECTED_READ_PREVIEWS=true` is set.
The Recipients management page can also show an experimental selected-read
recipients preview with the same flag. The Accounts management page can show an
experimental selected-read accounts preview with the same flag. The SMS Import
Templates management page can show an experimental selected-read SMS templates
preview with the same flag. The Budget History page can show an experimental
selected-read budget snapshot preview with the same flag. The Transactions page
can show an experimental selected-read transactions preview with the same flag.
These sections are hidden by default. Restart Vite after changing this flag. They use
`selectedReadRepositories` to manually load small read-only previews through the
currently selected backend, but the real management lists, search,
create/edit/delete actions, merge actions, activation actions, import/test-parse
behavior, transaction loading/filtering/edit/delete/transfer/export behavior,
Budget History grouping/filtering/completion/linking behavior, and reorder
behavior continue to use the existing Dexie paths unless a separate per-screen
experiment flag explicitly says otherwise.

The previews are structural-summary-only: backend/source, counts when available,
loaded counts, sampled IDs, category id, category bucketId, category active
state, bucket id, bucket display order, bucket active state, recipient id,
recipient active state, contact-field presence booleans, account id, account
active state, account credit flag, account currency, image presence boolean, and
credit-limit presence boolean. The SMS template preview adds template id,
template active state, account/payment-method ids, and regex/pattern presence
booleans only. The Budget History preview adds budget snapshot id, budget id,
category/account/recipient ids, due-date day key, frequency, boolean flags, and
amount sign only. The Transactions preview adds transaction id, date day key,
amount sign only, transaction-cost presence, transfer flag, category/account/
recipient ids, and budget snapshot id. It does not call budget snapshot
migration, generation, pruning, dedupe, repair, or lifecycle helpers. The previews do not render
category names, bucket names, recipient names, contact values, aliases, account
names, account descriptions, credit-limit values, image data, SMS template
names, SMS template descriptions, regex/pattern strings, budget descriptions,
amount values, transaction descriptions, transaction references, raw SMS
examples, raw rows, token values, or SQLite paths. `http-readonly` remains
experimental and Dexie remains authoritative.

See `docs/selected-read-migration-readiness-audit.md` for the current
read-experiment status matrix, including diagnostic status, known limitations,
and rollback notes.

## Buckets/Categories Read Experiment

`VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT=true` enables a
real-screen selected-read experiment for the Buckets/Categories management
list. The flag is off by default and is separate from the redacted preview
flag. Restart Vite after changing it.

When the flag is off, Buckets/Categories management uses the existing Dexie
read/write/reorder paths exactly as before. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the page remains on Dexie and
keeps the normal write and reorder controls. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, buckets and
categories are loaded through `selectedReadRepositories`; create, edit,
activate/deactivate, delete, and bucket reorder controls are hidden/disabled
because HTTP remains read-only.

The `http-readonly` experiment preserves the visible Buckets/Categories list
and bucket grouping as much as practical. Buckets remain sorted by display
order. The HTTP lookup endpoints use bounded pages, and the page labels the
result if the loaded bucket/category count is lower than the reported total.
Before trusting HTTP results, export a fresh backup, import it into disposable
SQLite, restart the API against that database, and rerun the verification
gates. Roll back by turning
`VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

Local API Diagnostics includes a manual Buckets/Categories read experiment
diagnostic. It compares the existing Dexie Buckets/Categories read path to the
selected-read `http-readonly` path with the same bounded limit used by the
experiment. The output is summary-only: bucket/category counts, normalized
sampled IDs, grouping/count match flags, active-state count match flags,
truncation status, and safe result codes. It does not render bucket names,
category names, descriptions, raw rows, tokens, or SQLite paths. This
diagnostic does not replace the normal gates: use a fresh backup, matching
SQLite import, restarted API server, `verify:sqlite`, `smoke:api`, and
`npm run check:local-api-safety` before trusting Dexie-vs-HTTP results.

The separate
`VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT=true` flag enables
create/update controls only when the selected backend is `http-readonly`.
Every operation runs its matching dry-run first, then the confirmed SQLite
write, then reloads the selected HTTP lists. A strong banner states that
SQLite is disposable and Dexie remains authoritative. The experiment includes
bucket and category create/update only; active-state actions, delete, cascade,
foreign-key rewrites, and bucket reorder stay unavailable. Bucket report
settings and category bucket links can affect report and budget interpretation,
but no existing transaction, budget, or budget snapshot is rewritten.

## Recipients Read Experiment

`VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT=true` enables the first
real-screen selected-read experiment for the Recipients management list. The
flag is off by default and is separate from the redacted preview flag. Restart
Vite after changing it.

When the flag is off, Recipients management uses the existing Dexie read/write
paths exactly as before. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the page remains on Dexie and
keeps the normal write controls. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, the list is loaded
through `selectedReadRepositories.recipients`; create, edit, activate,
deactivate, delete, and merge controls are hidden/disabled because HTTP remains
read-only.

The `http-readonly` experiment preserves the visible Recipients list, local
search, and local sorting as much as practical. The HTTP lookup endpoint is
capped to a bounded page, and the page labels the result if the loaded
recipient count is lower than the reported total. Before trusting the HTTP
result, export a fresh backup, import it into disposable SQLite, restart the
API against that database, and rerun the verification gates. Roll back by
turning `VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

Local API Diagnostics includes a manual Recipients read experiment diagnostic.
It compares the existing Dexie Recipients read path to the selected-read
`http-readonly` path with the same bounded limit used by the experiment. The
output is summary-only: counts, normalized sampled IDs, match flags,
truncation status, and safe result codes. It does not render recipient names,
aliases, contact fields, payment metadata values, descriptions, raw rows,
tokens, or SQLite paths. This diagnostic does not replace the normal gates:
use a fresh backup, matching SQLite import, restarted API server,
`verify:sqlite`, `smoke:api`, and `npm run check:local-api-safety` before
trusting Dexie-vs-HTTP results.

## Accounts Read Experiment

`VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for the Accounts management list. The flag
is off by default and is separate from the redacted preview flag. Restart Vite
after changing it.

When the flag is off, Accounts management uses the existing Dexie read/write
paths exactly as before. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the page remains on Dexie and
keeps the normal create, edit, activate/deactivate, and delete controls. When
the flag is on and `VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`,
the list is loaded through `selectedReadRepositories.accounts`; create, edit,
activate/deactivate, and delete controls are hidden/disabled because HTTP
remains read-only.

The `http-readonly` experiment is list-only. The Accounts page does not migrate
transaction reads or account-balance calculations in this slice; transaction
usage checks remain on the existing Dexie path and writes stay disabled in
HTTP mode. Account images/icons are intentionally omitted because Dexie stores
account images as blobs and the disposable SQLite import/API selected-read path
does not carry account image blobs in this prototype. Full Accounts visual
parity needs a separate image/blob handling plan if it becomes necessary. The
selected-read lookup endpoint is capped to a bounded page, and the page applies
the existing Accounts screen display order after loading so the visible list
matches the Dexie page as closely as practical. The page labels the result if
the loaded account count is lower than the reported total. Roll back by turning
`VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

Local API Diagnostics includes a manual Accounts read experiment diagnostic.
It compares the existing Dexie Accounts read path to the selected-read
`http-readonly` path with the same bounded limit used by the experiment. The
output is summary-only: counts, normalized sampled IDs, display-order match,
active/credit count match, currency distribution match, image-presence count
match, credit-limit-presence count match, truncation status, and safe result
codes. It does not render account names, descriptions, balances,
credit-limit values, image URLs, image data, raw rows, tokens, or SQLite paths.
Because account images/icons are intentionally omitted in `http-readonly`, the
diagnostic reports image-presence mismatches as a visible limitation/warning
rather than a hard failure when the remaining read-path checks pass.
This diagnostic does not replace the normal gates: use a fresh backup,
matching SQLite import, restarted API server, `verify:sqlite`, `smoke:api`,
and `npm run check:local-api-safety` before trusting Dexie-vs-HTTP results.

## SMS Templates Read Experiment

`VITE_PERSONAL_FINANCE_SMS_TEMPLATES_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for the SMS Import Templates management
list. The flag is off by default and is separate from the redacted preview
flag. Restart Vite after changing it.

When the flag is off, SMS Import Templates management uses the existing Dexie
read/write paths exactly as before. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the page remains on Dexie and
keeps the normal create, edit, activate/deactivate, delete, import, and
test-parse behavior. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, the list is loaded
through `selectedReadRepositories.smsImportTemplates`; create, edit,
activate/deactivate, delete, import, and test-parse actions are hidden or
disabled because HTTP remains read-only.

The `http-readonly` experiment is list-only. The visible list continues to show
template names and linked account names where available, matching the existing
management list shape as closely as practical. Regex and pattern strings are
not shown in the `http-readonly` list experiment because the edit/test
workflows remain Dexie-only. The selected-read lookup endpoint is capped to a
bounded page, and the page labels the result if the loaded SMS template count
is lower than the reported total. Roll back by turning
`VITE_PERSONAL_FINANCE_SMS_TEMPLATES_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite. Before
trusting HTTP results, use a fresh backup, matching SQLite import, restarted
API server, `verify:sqlite`, `smoke:api`, and
`npm run check:local-api-safety`.

Local API Diagnostics includes a manual SMS Templates read experiment
diagnostic. It compares Dexie and selected-read `http-readonly` SMS template
counts, normalized IDs, display-pipeline ordering, active-state counts,
account ID distribution, pattern-presence distribution, row normalization, and
truncation status. It is summary-only and does not render template names,
account names, regex/pattern strings, raw SMS examples, descriptions, or raw
rows. It does not replace the normal gates: use a fresh backup, matching
SQLite import, restarted API server, `verify:sqlite`, `smoke:api`, and
`npm run check:local-api-safety` before trusting Dexie-vs-HTTP results.

## Budget Read Experiment

`VITE_PERSONAL_FINANCE_BUDGET_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for the Budget page. The flag is off by
default. Restart Vite after changing it.

When the flag is off, Budget uses the existing Dexie read and lifecycle path.
When the flag is on and `VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the
page remains on the existing Dexie path. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, Budget inputs load
through `selectedReadRepositories` with bounded paginated reads for budgets,
budget snapshots, transactions, and lookup tables.

The `http-readonly` experiment is local-dev and read-only. It bypasses the
Budget page's snapshot lifecycle helpers and disables budget add/edit/delete,
completion, transaction linking, import, export, and load-more lifecycle
actions. It also shows an on-page warning if selected-read inputs are capped,
because capped inputs are not full-confidence Budget results. This experiment
does not authorize budget writes, snapshot generation, pruning, dedupe, repair,
coverage, or any change to Dexie as the authoritative store. Roll back by
turning `VITE_PERSONAL_FINANCE_BUDGET_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

Before trusting HTTP results, use a fresh backup, matching SQLite import,
restarted API server, passing Budget read parity diagnostic, `verify:sqlite`,
`smoke:api`, and `npm run check:local-api-safety`.

## Budget History Read Experiment

`VITE_PERSONAL_FINANCE_BUDGET_HISTORY_READ_EXPERIMENT=true` enables a narrow
real-screen selected-read experiment for Budget History. The flag is off by
default. Restart Vite after changing it.

When the flag is off, Budget History uses the existing Dexie read and
lifecycle path. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, the page remains on the
existing Dexie path. When the flag is on and
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=http-readonly`, Budget History inputs
load through `selectedReadRepositories` with bounded paginated reads for budget
snapshots, transactions, budgets, and lookup tables. Current caps are 5,000
budget snapshots, 5,000 transactions, and 500 budgets. If selected-read inputs
are capped, the page shows a warning because capped inputs are not
full-confidence Budget History results.

The `http-readonly` experiment is local-dev and read-only. It bypasses
`migrateBudgetSnapshots` and snapshot lifecycle helpers, and disables snapshot
edit/delete, budget activate/deactivate/delete, completion, and transaction
linking actions. It does not authorize historical snapshot mutation, snapshot
generation, pruning, dedupe, repair, coverage, creation, update behavior,
transaction linking migration, or any change to Dexie as the authoritative
store. Roll back by turning
`VITE_PERSONAL_FINANCE_BUDGET_HISTORY_READ_EXPERIMENT` off or setting
`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND=dexie`, then restarting Vite.

Before trusting HTTP results, use a fresh backup, matching SQLite import,
restarted API server, passing Budget History read parity diagnostic,
`verify:sqlite`, `smoke:api`, and `npm run check:local-api-safety`.

## Manual Parity Diagnostic

`src/repositories/http/localApiParityDiagnostics.ts` contains a manual
diagnostic for comparing selected Dexie reads with local API HTTP adapter reads.
It is not imported by the app, is not auto-run, and does not switch any page or
repository to HTTP.

To run it manually, start the local API server with a disposable SQLite database,
start Vite with the prototype environment variables configured, then use the
browser dev console:

```ts
const diagnostics = await import(
  "/src/repositories/http/localApiParityDiagnostics.ts"
);
await diagnostics.runLocalApiReadParityDiagnostics({ logSummary: true });
```

You can reduce or increase sampled detail checks:

```ts
await diagnostics.runLocalApiReadParityDiagnostics({
  sampleSize: 3,
  logSummary: true,
});
```

The diagnostic returns a structured summary with check names, pass/fail status,
mismatch counts, and sampled IDs. Console output is summary-only. It does not
print raw rows, transaction descriptions, account names, recipient names,
transaction references, or token values.

For parity only, the diagnostic treats the same documented legacy booleans as
the disposable SQLite importer does: missing `accounts.isCredit`,
`budgets.isFlexible`, and `budgetSnapshots.isFlexible` compare as `false`. This
normalization is not applied to other booleans, does not mutate Dexie, and does
not change live app behavior.

The browser token environment variable is exposed to the Vite client bundle in
this prototype. Use it only for local development against the local prototype
server. Do not use a durable or shared token, and do not commit `.env` files.

## Date Handling

The local API returns serialized SQLite values. The HTTP DTOs keep date fields
as strings instead of converting them into `Date` objects. This keeps the
prototype contract separate from the existing Dexie repository contract, where
many fields are live `Date` objects.

Any future adapter that is wired into the app should make date conversion an
explicit, reviewed step.

The manual parity diagnostic normalizes date values only inside the diagnostic
comparison. It does not alter HTTP DTO behavior or Dexie repository behavior.

## Safety

The local API can return sensitive personal finance rows. Do not log returned
rows during manual experiments. SQLite databases, backups, exports, logs,
tokens, import summaries, verification reports, and comparison reports must stay
outside Git.

## Basic Transaction Write Phase 1

The backend exposes protected dry-run and experimental SQLite write endpoints:

```text
POST /prototype/repositories/transactions/dry-run/create
POST /prototype/repositories/transactions/dry-run/update
POST /prototype/repositories/transactions/write/create
POST /prototype/repositories/transactions/write/update
```

Real writes remain disabled unless the server process has
`PERSONAL_FINANCE_ENABLE_TRANSACTION_BASIC_WRITES=true`. The frontend has no
transaction write adapter or UI wiring. Existing pages continue to use Dexie
for writes.

Phase 1 accepts only one ordinary income or expense row with a nonzero,
correctly signed amount and existing account, category, category bucket, and
recipient. It rejects transfers, pair links, nonzero transaction costs, legacy
payment-channel writes, budget links, occurrence links, and budget snapshot
links. Updates require an already eligible target and preserve all excluded
columns. Transaction rows do not currently have creation/update timestamp
fields.

Balances and report totals remain derived values. A successful write changes
them only by the signed transaction amount because Phase 1 costs are null or
zero. The endpoints do not mutate accounts, lookups, budgets, snapshots,
related transactions, Dexie, or files.

Normal `smoke:api` remains non-mutating. Successful transaction mutation smoke
is explicit:

```bash
npm run smoke:api -- -- --token-file C:\dev\personal-finance-data\.server-token --allow-transaction-basic-write-smoke
```

That mode creates and updates one expense and one income in disposable SQLite,
checks exact account/month aggregate deltas, and leaves the database dirty.
Re-import from a fresh matching backup before parity verification. Transfers,
costs, budget linkage, delete, bulk operations, frontend writes, dual-write,
and authority migration remain deferred.

# Local API Frontend Adapter Notes

This is prototype scaffolding only. The live Ionic app still uses Dexie /
IndexedDB through the existing repositories, and IndexedDB remains the
authoritative data store.

Migration readiness gates are summarized in
[selected-read-migration-readiness-audit.md](selected-read-migration-readiness-audit.md).

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

No write calls are implemented, and no frontend route, page, or live repository
is connected to the local API.

The `http-readonly` backend has no write support. Future consumers must not
silently no-op writes; write attempts in HTTP-readonly mode should fail loudly.
Dexie remains authoritative.

## Selected Read Facade

`src/repositories/selectedReadRepositories.ts` exposes an opt-in read-only
facade named `selectedReadRepositories`. It is not imported by existing pages and
does not change live app behavior. With no backend environment variable, or with
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
Reports page remains unchanged and does not import selected-read or HTTP
repositories.

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

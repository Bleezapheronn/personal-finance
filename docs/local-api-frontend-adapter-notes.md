# Local API Frontend Adapter Notes

This is prototype scaffolding only. The live Ionic app still uses Dexie /
IndexedDB through the existing repositories, and IndexedDB remains the
authoritative data store.

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
sources or write behavior. Transactions, budgets, and budget snapshots remain
intentionally unnormalized in this pass and may still show ordering mismatches
until their higher-risk ordering semantics are reviewed separately.

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
behavior continue to use the existing Dexie paths.

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

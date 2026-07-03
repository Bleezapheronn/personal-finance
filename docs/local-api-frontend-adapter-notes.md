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
```

`VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND` supports:

- `dexie` - default, authoritative, normal app behavior
- `http-readonly` - experimental local API read-only mode for future manual
  adapter experiments

Missing or unknown backend values fall back to `dexie`. Existing pages still use
the Dexie repository exports by default; the adapter selection scaffold does not
switch any live page or route to HTTP.

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
- lookups: accounts, buckets, categories, recipients list/detail reads
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
recipients, budgets, and budget snapshots. It does not expose create, update, or
delete methods.

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
budget snapshots. Console output is summary-only and uses sampled IDs only. It
does not print finance rows, account names, recipient names, budget
descriptions, transaction descriptions, transaction references, or token values.
It does not mutate data and does not switch the app backend. Dexie remains
authoritative.

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

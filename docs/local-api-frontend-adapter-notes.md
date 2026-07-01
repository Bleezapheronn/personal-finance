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
VITE_PERSONAL_FINANCE_LOCAL_API_URL=http://127.0.0.1:3147
VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN=<local prototype token>
```

Do not commit `.env` files or token values. The client fails closed when either
value is missing, and it does not include token values in thrown errors.

## Read-Only Scope

The scaffold uses `fetch` and sends the token with the server's existing
`x-personal-finance-token` header. Only read methods are present:

- transactions: list, detail, count
- lookups: accounts, buckets, categories, recipients list/detail reads
- budgets: budget and budget snapshot list/detail reads
- budget snapshots for a budget

No write calls are implemented, and no frontend route, page, or live repository
is connected to the local API.

## Date Handling

The local API returns serialized SQLite values. The HTTP DTOs keep date fields
as strings instead of converting them into `Date` objects. This keeps the
prototype contract separate from the existing Dexie repository contract, where
many fields are live `Date` objects.

Any future adapter that is wired into the app should make date conversion an
explicit, reviewed step.

## Safety

The local API can return sensitive personal finance rows. Do not log returned
rows during manual experiments. SQLite databases, backups, exports, logs,
tokens, import summaries, verification reports, and comparison reports must stay
outside Git.

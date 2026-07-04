# Selected-Read Migration Readiness Audit

Status: prototype-ready for diagnostics only. No real workflow screen is
switched to HTTP.

Dexie / IndexedDB remains authoritative. SQLite remains disposable and must be
seeded from a full backup before comparison. The local API and HTTP repository
adapters are read-only. No write methods or write endpoints exist.

## Implemented

- Local Fastify prototype server with token and origin guards.
- Disposable SQLite importer and `verify:sqlite` comparison suite.
- Protected read-only SQLite and repository-shaped endpoints.
- HTTP read-only repository adapters.
- Opt-in selected read facade with `dexie` default and `http-readonly`
  experimental mode.
- Dev-only Local API diagnostics screen and selected-read previews.
- Selected-read import guard, runtime artifact guard, and
  `npm run check:local-api-safety`.
- Selected-read ordering diagnostic for:
  - transactions
  - budgets
  - budget snapshots
  - accounts
  - buckets
  - categories
  - recipients
  - SMS import templates

## Experimental Or Not Implemented

- `http-readonly` is experimental and local-dev only.
- No real workflow page uses HTTP as its data source.
- No create, update, delete, import, restore, or repair HTTP paths exist.
- No write no-ops exist; future HTTP write attempts must fail loudly.
- Browser token exposure is accepted only for this local prototype, never for
  production or shared environments.
- The selected-read facade still returns backend-specific shapes: Dexie models
  may contain `Date` objects, while HTTP DTOs contain serialized date strings.

## Ordering Baseline

When Dexie and the disposable SQLite database are based on the same fresh full
backup, all eight selected-read ordering diagnostic resources should match.

Canonical selected-read ordering:

- transactions: live Transactions page semantics, then deterministic ID
  tie-breaker
- budgets: `dueDate ASC, id ASC`
- budget snapshots: `dueDate DESC, id ASC`
- accounts: name, then ID
- buckets: display order, then ID
- categories: name, then ID
- recipients: name, then ID
- SMS import templates: name, then ID

Stale SQLite can produce false parity or ordering mismatches. Export a fresh
full backup and import it into a new disposable SQLite database before trusting
Dexie-vs-SQLite diagnostics.

## Safety Guardrails

- Keep `.env`, token, SQLite, backup, export, log, report, and import-summary
  files outside Git.
- Keep SQLite read-only in the API server.
- Keep Dexie as the default backend.
- Keep any real-screen experiment behind a flag with a clear rollback path.
- Do not run snapshot generation, pruning, dedupe, repair, creation, or update
  logic from selected-read checks or HTTP repository adapters.
- Do not print raw rows, account names, recipient names, budget descriptions,
  transaction descriptions, transaction references, amount values, token values,
  or SQLite paths in diagnostics.

## Available Diagnostics

Browser-independent:

- `npm run check:local-api-safety`
- `npm run check:selected-read-imports`
- `npm run check:no-runtime-artifacts`
- root `npm run build`
- server `npm run build`

Runtime server checks, run separately with required arguments:

- server `npm run verify:sqlite -- -- --backup <fresh-backup.json> --sqlite <disposable.sqlite>`
- server `npm run smoke:api -- -- --token-file <token-file>`

Manual Vite/browser checks:

- backend selection diagnostic
- selected-read repository diagnostic
- selected-read ordering diagnostic
- Dexie-vs-HTTP parity diagnostic
- target screen selected-read preview in both `dexie` and `http-readonly`

## Migration Gates

Before any real screen can switch to `http-readonly`, all gates below must pass:

- A fresh full app backup is exported.
- The fresh backup is imported into a new disposable SQLite database.
- `verify:sqlite` passes against that exact backup/database pair.
- `smoke:api` passes against the configured disposable SQLite database.
- `npm run check:local-api-safety` passes.
- Selected-read diagnostics pass in Dexie mode.
- Selected-read diagnostics pass in `http-readonly` mode.
- Selected-read ordering diagnostic shows all resources as `Match`.
- Dexie-vs-HTTP parity diagnostic passes against the fresh backup-generated
  SQLite database.
- The target screen preview has loaded successfully in both modes.
- The change is behind an explicit flag and defaults to Dexie.
- A rollback path exists and has been written down before the switch.

## First-Candidate Guidance

Prefer low-risk read-only or management-summary screens for the first real
switch. Avoid Transactions, Reports, Budget, and Budget History as first real
HTTP-backed screens unless additional screen-specific parity checks are added
and reviewed.

No writes should be added until a separate migration plan is approved.

## Known Limitations

- SQLite is disposable and may lag Dexie if not regenerated from a fresh backup.
- Browser diagnostics depend on local Vite env vars and the local API server.
- Aggregate and sample comparison reports can still contain sensitive local
  financial data and must remain outside the repo.
- Read parity is not migration approval; each real screen still needs
  screen-specific review, preview, fallback, and rollback handling.

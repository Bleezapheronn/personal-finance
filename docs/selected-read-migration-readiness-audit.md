# Selected-Read Migration Readiness Audit

Status: prototype-ready with diagnostics and narrow, off-by-default read-path
experiments for Recipients, Buckets/Categories, and Accounts. No real workflow
screen is switched to HTTP unless an explicit per-screen experiment flag is
enabled.

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
- No real workflow page uses HTTP as its data source by default.
- Recipients management has one flag-gated read experiment; it remains
  read-only and disables write controls in `http-readonly` mode.
- Buckets/Categories management has one flag-gated read experiment; it remains
  read-only and disables create, edit, activate/deactivate, delete, and bucket
  reorder controls in `http-readonly` mode.
- Accounts management has one flag-gated read experiment; it remains read-only
  and disables create, edit, activate/deactivate, and delete controls in
  `http-readonly` mode.
- Local API Diagnostics includes a manual Buckets/Categories read experiment
  diagnostic that compares Dexie and selected-read `http-readonly` counts,
  normalized IDs, bucket display ordering, category grouping, active-state
  counts, row normalization, and truncation status without rendering names,
  descriptions, or raw rows.
- Local API Diagnostics includes a manual Recipients read experiment
  diagnostic that compares Dexie and selected-read `http-readonly` counts,
  normalized IDs, default display ordering, row normalization, and truncation
  status without rendering recipient details.
- Local API Diagnostics includes a manual Accounts read experiment diagnostic
  that compares Dexie and selected-read `http-readonly` counts, normalized IDs,
  page display ordering, row normalization, active/credit counts, currency
  distribution, image-presence counts, credit-limit-presence counts, and
  truncation status without rendering account details. Account image/icon
  mismatches are reported as a visible limitation/warning because the current
  `http-readonly` prototype intentionally omits account image blobs.
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
- Buckets/Categories read experiment diagnostic
- Recipients read experiment diagnostic
- Accounts read experiment diagnostic
- Dexie-vs-HTTP parity diagnostic
- target screen selected-read preview in both `dexie` and `http-readonly`

## Current Real Read Experiment Status

These are local-dev read experiments only. They do not make HTTP
authoritative, do not imply writes are safe to migrate, and do not replace the
fresh-backup verification gates. Before trusting a fresh diagnostic run, export
a fresh backup, import that backup into matching disposable SQLite, and restart
the API against that SQLite. Stale SQLite can cause false mismatches.

| Screen / area | Experiment flag | Default behavior | `http-readonly` behavior | Write behavior | Diagnostic status | Known limitations | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Recipients | `VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT=true` | Dexie | Loads through selected-read | Create, edit, activate/deactivate, delete, and merge disabled in `http-readonly` | Passes | No known current read-path limitation | Turn flag off or set backend to `dexie`, then restart Vite |
| Buckets/Categories | `VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT=true` | Dexie | Loads through selected-read | Create, edit, activate/deactivate, delete, and reorder disabled in `http-readonly` | Passes | No known current read-path limitation | Turn flag off or set backend to `dexie`, then restart Vite |
| Accounts | `VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT=true` | Dexie | Loads through selected-read | Create, edit, activate/deactivate, and delete disabled in `http-readonly` | Passes with warning | Account images/icons intentionally omitted; transaction-derived usage checks remain on the Dexie path and are not migrated | Turn flag off or set backend to `dexie`, then restart Vite |

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

## Manual Migration Candidate Checklist

Evaluate one candidate screen at a time. Do not treat a passing global
diagnostic as approval for a real screen switch.

Candidate screen questions:

- Is the screen read-only, management-summary, or workflow-critical?
- Does the screen display sensitive values such as names, descriptions,
  references, amounts, or account/recipient details?
- Does it depend on writes, deletes, transfers, exports, imports, restore flows,
  merge actions, activation toggles, or lifecycle helpers?
- Does it depend on aggregate, report, chart, bucket/category breakdown, or
  period-selection semantics?
- Does it depend on budget snapshot generation, pruning, dedupe, repair,
  coverage, completion, linking, or historical snapshot stability?
- Does it already have a selected-read preview?
- Has that preview passed in both `dexie` and `http-readonly` modes?
- Is the result acceptable with HTTP DTO date strings, or does the screen need
  an explicit conversion layer?
- Is there a clear rollback path to Dexie-only behavior?

Required baseline checks before evaluating the candidate:

- Export a fresh full app backup.
- Import that exact backup into a new disposable SQLite database.
- Restart the API server against that disposable SQLite database.
- Run `verify:sqlite` with the backup and SQLite arguments.
- Run `smoke:api` with the token or token-file argument.
- Run `npm run check:local-api-safety`.
- Run selected-read diagnostics in Dexie mode.
- Run selected-read diagnostics in `http-readonly` mode.
- Confirm the selected-read ordering diagnostic shows all resources as `Match`.
- Confirm stale SQLite is not being used as the comparison source.

Approval rules:

- Default behavior must remain Dexie.
- Any real screen experiment must be behind an explicit flag.
- The first migration should avoid Transactions, Reports, Budget, and Budget
  History unless stronger screen-specific parity checks exist.
- No write path migration is allowed without a separate written plan.
- Do not infer production or local-network safety from the current browser-token
  prototype. Browser token exposure is local-dev only.

Recommended first candidates:

- Prefer low-risk, read-only, non-aggregate, non-lifecycle screens.
- Prefer management list previews over workflow-heavy pages.
- Diagnostics-only is an acceptable outcome if no screen is safe enough yet.

Current narrow experiments:

- Buckets/Categories management has a per-screen read experiment flag:
  `VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT=true`.
- Default Buckets/Categories behavior remains Dexie.
- In `http-readonly` mode, buckets and categories may load through the
  selected read facade, but create, edit, activate/deactivate, delete, and
  bucket reorder actions remain disabled because writes have not migrated.

- Recipients management has a per-screen read experiment flag:
  `VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT=true`.
- Default behavior remains Dexie.
- In `http-readonly` mode, the Recipients list may load through the selected
  read facade, but create, edit, activate/deactivate, delete, and merge actions
  remain disabled because writes have not migrated.

- Accounts management has a per-screen read experiment flag:
  `VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT=true`.
- Default behavior remains Dexie.
- In `http-readonly` mode, the Accounts list may load through the selected read
  facade, but create, edit, activate/deactivate, and delete actions remain
  disabled because writes have not migrated.
- The Accounts experiment is list-only. It does not migrate transaction reads or
  account-balance semantics; transaction-derived usage checks remain on the
  existing Dexie path.
- The Accounts experiment applies the existing Accounts screen display order
  after loading selected-read rows. This is a page-level display alignment and
  does not change the global selected-read ordering diagnostic baseline.
- The Accounts experiment intentionally omits account images/icons in
  `http-readonly` mode. Full visual parity requires a separate image/blob
  handling plan if needed.
- Rollback is switching the relevant experiment flag off or setting the repository
  backend back to `dexie`, then restarting Vite.

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
- Accounts `http-readonly` visual parity is incomplete because account
  images/icons are omitted.
- Read parity is not migration approval; each real screen still needs
  screen-specific review, preview, fallback, and rollback handling.

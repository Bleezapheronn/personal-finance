# Recipients Real-Write Implementation Summary

This is a concise status summary for the completed Recipients write endpoint
layer at baseline tag `recipients-create-update-real-write-baseline`.

Dexie / IndexedDB remains authoritative. SQLite remains disposable. The
implemented write endpoints are local prototype experiments only and are not
connected to the frontend.

## Implemented Endpoints

Dry-run endpoints are implemented and remain non-mutating:

- `POST /prototype/repositories/recipients/dry-run/create`
- `POST /prototype/repositories/recipients/dry-run/update`
- `POST /prototype/repositories/recipients/dry-run/activate`
- `POST /prototype/repositories/recipients/dry-run/deactivate`

Experimental real-write endpoints are implemented for disposable SQLite only:

- `POST /prototype/repositories/recipients/write/create`
- `POST /prototype/repositories/recipients/write/update`
- `POST /prototype/repositories/recipients/write/activate`
- `POST /prototype/repositories/recipients/write/deactivate`

## Environment Flags

All real-write endpoints are disabled by default.

Create/update writes require:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_CREATE_UPDATE_WRITES=true
```

Activate/deactivate writes require:

```text
PERSONAL_FINANCE_ENABLE_RECIPIENT_ACTIVE_STATE_WRITES=true
```

These flags are server-side prototype flags. They do not connect the app UI to
HTTP writes.

## Safety Boundaries

- SQLite-only.
- Disposable database only.
- Dexie / IndexedDB remains authoritative.
- No frontend write adapter exists.
- No UI integration exists.
- No dual-write exists.
- No authority migration exists.
- Normal `smoke:api` remains non-mutating.
- Opt-in write smoke is explicit and dirties disposable SQLite.
- Re-import SQLite from a fresh backup before clean parity checks after any
  successful opt-in write smoke.
- Responses are summary-only and must not include raw recipient rows, names,
  aliases, contact values, descriptions, token values, full paths, or raw
  transaction details.

## Deferred Work

The following remain unimplemented and require separate review, planning, and
approval:

- recipient delete real write
- recipient merge real write
- transaction recipient-reference mutation
- frontend write adapters
- UI write integration outside a dev-only experiment
- dual-write
- background sync
- SQLite authority migration

## Next Intended Milestone

The next intended milestone is dev-only Recipients UI wiring against the
disposable SQLite write endpoints, not more endpoint work.

That milestone should be:

- behind an explicit frontend flag
- visibly marked with a local-dev warning banner
- usable only when the required backend write flags are enabled
- disabled by default
- limited to Recipients create/update/activate/deactivate
- separate from delete and merge
- reversible by turning off the frontend flag or returning the backend to
  Dexie/default mode
- clear that Dexie remains authoritative and SQLite remains disposable

No default app behavior should change. No Dexie write path should be replaced
unless that is explicitly approved in a later slice.

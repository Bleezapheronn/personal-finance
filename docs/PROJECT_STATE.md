# Project State

Personal Finance is a single-user local application. Its local SQLite database
is the runtime source of truth; Dexie/IndexedDB remains legacy compatibility
only and receives no new authoritative writes.

## Normal use

Start the application by double-clicking the Personal Finance shortcut. One
terminal opens and owns the local API and frontend processes. The shortcut does
not open a browser. Closing that terminal, ending its processes, or restarting
the computer does not require cleanup before the next launch.

The launcher reads the runtime configuration only to locate the SQLite database,
local token file, and loopback ports. It does not perform API health, database
integrity, logical verification, or readiness checks before starting the
frontend. Runtime failures are shown by the application or reported in the
terminal.

## Data safety

- The local API is loopback-only and requires its local token for requests.
- Existing repository write contracts validate input and preserve transaction,
  transfer, budget, and snapshot invariants.
- Expenses are negative; income is positive. Transfers remain paired through
  `transferPairId`. `budgetSnapshotId` is canonical when present.
- Do not modify the SQLite schema, budget snapshot history, or live financial
  data without a separately reviewed change.

## Backups and restore

Automatic backups are configured in Settings and run independently through
Windows Task Scheduler. Each run creates a native SQLite backup, verifies it,
verifies a disposable restore, and publishes only the verified pair. Retention
keeps one verified daily backup for the latest 30 days and one verified monthly
backup thereafter.

The standalone backup and restore commands operate on explicit paths. Restore
always targets a fresh SQLite output path. The user-facing Settings & Status
restore card can arm a separate guarded live cutover only after current
verification and a disposable rehearsal. The authenticated API persists a
one-shot operational request; the existing launcher stops its owned services,
creates and verifies a rollback, performs the exact replacement, verifies the
result, and restarts the runtime. A failed immediate or startup verification
automatically restores the verified rollback. Keep backup and rollback files
outside the repository and protect them as financial data.

The retained rollback remains explicitly selectable after restored-state
acceptance through the same typed, launcher-owned handoff. Before replacing the
accepted state, that rollback path creates and verifies a separate pre-rollback
safety artifact. Neither retained artifact is removed by automatic-backup
retention or by restored-state acceptance.

Restore-control API writes are narrowly limited to operational rehearsal,
handoff, status, and acceptance state. They do not add general financial-data
write capabilities or a new authentication mechanism.

## Development

Use focused tests and TypeScript checks for changed workflows. Generated
databases, tokens, backups, logs, and financial rows must remain outside Git.
Account images support display, selection, replacement, and removal through
the authenticated local SQLite API. Account fields save first; a separate
dry-run-confirmed image mutation can be retried without repeating that Account
save. A missing image is a normal read result. SMS parsing/import remains a
separate, deliberately incomplete feature; SMS template CRUD is supported.

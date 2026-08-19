# Personal Finance

Personal Finance is a private, local-first finance tracker. The local SQLite
database and authenticated loopback API are the runtime source of truth; Dexie
is retained only for legacy compatibility.

## Normal use

Double-click the Personal Finance shortcut. It opens one terminal that starts
the API and frontend together. It does not open a browser automatically. You
can close the terminal, end its processes, or restart the computer and launch
again normally.

The launcher uses runtime configuration for the SQLite path, token file, and
loopback ports. It deliberately does not run health, integrity, readiness, or
recovery gates before opening the frontend.

## Backups and restore

Configure automatic backups in Settings. Windows Task Scheduler runs the
independent worker even while the application is closed. Each published backup
is verified together with a disposable restore. Restore tooling requires an
explicit backup, manifest, and fresh output path.

Settings & Status also provides a guarded Restore from Backup workflow for
verified scheduled backups. It requires deliberate selection, a disposable
rehearsal, typed confirmation, and a verified pre-cutover rollback. The existing
launcher temporarily stops and restarts its owned API/frontend services for the
one-shot handoff. Restore-control endpoints mutate only operational handoff and
status state; they are not general financial-data write APIs. The verified
rollback remains available after acceptance. A guarded rollback first creates a
verified safety artifact of the state it is replacing, and both artifacts remain
outside normal automatic-backup retention until separately cleaned up.

## Development

```bash
npm install
npm run build
npm run test.unit
```

The server has focused SQLite, backup, and write-workflow checks under
`server/package.json`. Keep generated databases, tokens, backups, logs, and
financial data outside Git.

## Data invariants

- Expenses are negative and income is positive.
- Transfers are paired through `transferPairId`.
- `accountId` is the current account field.
- `budgetSnapshotId` is canonical when present; historical linked snapshots
  remain stable after later Budget edits.

See [Project State](docs/PROJECT_STATE.md) for the operating model and safety
constraints.

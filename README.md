# Personal Finance

An offline-first personal finance tracker built from a spreadsheet-based accounting and budget workflow. The app is local-first and private by default: the browser IndexedDB database is currently the source of truth, and no cloud sync is required for normal use.

This project tracks transactions, budgets, budget snapshots, accounts, recipients, categories, SMS import templates, reports, and safety/debug tooling in one Ionic React app.

## Stack

- Ionic React 8
- React 19
- React Router 5
- Vite 5
- TypeScript
- Dexie / IndexedDB
- Capacitor
- Recharts
- Vitest and Cypress

## Main App Areas

- **Transactions**: add, edit, delete, filter, import/export CSV, and manage expenses, income, and transfers.
- **Budget**: manage recurring and one-time budget items, budget occurrences, completion state, and historical budget snapshots.
- **Reports**: review spending and income summaries from local transaction data.
- **Accounts**: manage accounts and currencies. `accountId` is the current account reference used by transactions, budgets, and SMS import templates.
- **Buckets/Categories**: organize categories inside buckets for reporting and filtering.
- **Recipients**: manage payees, payers, aliases, and recipient history.
- **SMS Import Templates**: define local templates for parsing imported SMS transaction text.
- **Settings & Debug**: CSV tools, full JSON backup export, backup dry-run validation, guarded full restore, database health checks, and narrowly scoped repair/cleanup actions.

## Data Safety

The app stores financial data locally in browser IndexedDB through Dexie. That keeps the app private by default, but it also means the browser profile is the active database location.

Backups are essential:

- Full JSON backup captures every current Dexie table, including `transactions`, `budgets`, `budgetSnapshots`, `accounts`, `categories`, `recipients`, and SMS import templates.
- Full restore always runs dry-run validation first.
- Restore is destructive and requires the explicit confirmation phrase `RESTORE MY FINANCE DATABASE`.
- The database health check can be run after restore to verify references, transfer pairs, row counts, and known integrity issues.
- CSV export/import is useful for transaction workflows, but it is not a full disaster-recovery backup.

See [Backup and Restore](docs/backup-restore.md) for the recommended safety workflow.

## Architecture Notes

- Browser IndexedDB is currently the source of truth.
- Dexie table definitions and data interfaces live in [src/db.ts](src/db.ts).
- Application code enforces relationships and integrity rules; IndexedDB does not enforce foreign keys.
- Expenses are stored as negative amounts. Income is stored as positive amounts.
- Transfers are stored as two transaction rows linked reciprocally by `transferPairId`.
- `paymentChannelId`, `paymentMethodId`, and the `paymentMethods` table are legacy migration fields. Newer logic should prefer `accountId`.
- `budgetSnapshotId` is the canonical budget linkage when present.

See [Data Model Notes](docs/data-model-notes.md) for invariants and caveats that matter when changing code.

## Development

### Install

```bash
npm install
```

For a clean dependency install from `package-lock.json`:

```bash
npm ci
```

### Commands

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test.unit
npm run test.e2e
```

Command details:

- `npm run dev`: start the Vite development server.
- `npm run build`: run TypeScript checking and create a production Vite build.
- `npm run preview`: preview the production build locally.
- `npm run lint`: run ESLint.
- `npm run test.unit`: run Vitest.
- `npm run test.e2e`: run Cypress tests.

Run `npm run build` after TypeScript, data-model, backup/restore, or safety-tooling changes.

## Project Structure

```text
src/
  components/          Reusable Ionic/React components
  hooks/               Custom hooks
  pages/               Routed app screens
  styles/              Shared styles
  theme/               Ionic theme variables
  utils/               Import/export, reports, validation, health, and safety helpers
  db.ts                Dexie schema, interfaces, migrations, and snapshot helpers
  App.tsx              Routing and app shell
```

Important utility areas:

- `src/utils/fullBackup.ts`: full JSON backup export.
- `src/utils/fullBackupRestore.ts`: backup dry-run validation and guarded restore.
- `src/utils/dbHealth.ts`: read-only health report plus narrowly scoped guarded repairs.
- `src/utils/transferPairs.ts`: transfer-pair edit and write invariants.
- `src/utils/budgetSnapshots.ts`: budget snapshot helper logic.

## Current Constraints

- The active database is browser-specific. Moving to a browser-agnostic local database or backend is under consideration.
- Full JSON backups should be taken before destructive actions, browser changes, or major code changes.
- Budget snapshots preserve occurrence details and should not be casually rewritten.
- The budget model is functional but due for a future model-v2 review.
- Transfer exchange-rate and transaction-cost handling has known complexity and should be changed carefully.

## Privacy

- Local-first storage in the browser via IndexedDB.
- No required cloud account.
- No server-side database in the current architecture.
- Backup files can contain complete financial history and should be stored carefully.

## License

Released under the MIT License. See [LICENSE](LICENSE).

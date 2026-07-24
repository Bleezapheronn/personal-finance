# SQLite Main-App Feature Parity Final Report

Date: 2026-07-24

Baseline commit: `7642d5c`

Baseline tag: `sqlite-authority-usability-images-phase1-complete-baseline`

## Classification

`READY FOR MAIN-APP LIVE TEST`

This classification authorizes a focused live test after the source and profile
rollout steps below. It does not authorize either of the two approved
deferrals: user-facing backup/restore redesign or Budget direction/sign
repair.

The live authority profile and live SQLite database were not modified during
implementation or acceptance.

## Scope completed

The inherited, uncommitted main-app parity work was preserved and completed.
The approved Budget Snapshot occurrence lifecycle was added without a schema
change:

- delete one eligible, unlinked occurrence;
- refuse deletion of a linked or ambiguous occurrence;
- link a transaction to an existing occurrence;
- change an existing transaction link;
- unlink a transaction;
- explicitly create one missing occurrence;
- atomically create or reuse an occurrence and link a transaction;
- atomically create a Budget definition, occurrence, and optional originating
  transaction link.

No page-load generation, global pruning, automatic deduplication, orphan
repair, historical relinking, recurrence change, or Budget amount/sign change
was added.

## Parity matrix

| Area | SQLite authority result | Acceptance status |
| --- | --- | --- |
| Transactions | Expense/income reads and writes, costs, original currency, exchange rate, duplicate, edit, delete, transfer flows, snapshot links, and details use controlled SQLite paths | Accepted baseline plus focused lifecycle acceptance |
| SMS transaction entry | Existing-template parsing, prefill, missing-recipient creation, and description helpers use SQLite paths | Restored in inherited parity work |
| Inline lookups | Recipient and Category creation use capability-gated SQLite writes | Restored in inherited parity work |
| Transaction details | Read, link, change link, unlink, and Create Budget from Transaction are available | Browser accepted |
| Budget definitions | Existing controlled definition lifecycle remains in place | Existing suites passed |
| Budget occurrences | Explicit create, delete, link, change link, unlink, and create-and-link are available | New focused suite and browser acceptance passed |
| Budget History | Selected reads, navigation, explicit occurrence actions, and safe refusal paths are available | Browser accepted with 1,526 occurrences |
| Reports | Selected SQLite inputs drive totals, charts, and drilldowns; healthy authority mode no longer shows migration messaging | Build and inherited parity tests passed |
| Accounts | Management and currently supported image operations remain available | Existing lifecycle and image suites passed |
| Recipients | Management, active state, delete, and merge behavior remain available through approved routes | Existing lifecycle suite passed |
| Categories and Buckets | Management, ordering, lifecycle, and safe dependency refusals remain available | Existing lifecycle suites passed |
| SMS templates | Supported management and parsing flows remain available | Existing smoke and parity coverage passed |
| Settings | Authority status route is available in the main app | Browser accepted |
| Backup/restore controls | Existing controls remain visibly deferred with a safe explanation | Approved deferral |
| Budget direction/sign | Existing semantics are unchanged | Approved deferral |

No additional parity difference was identified outside the two approved
deferrals.

## Occurrence lifecycle policy

All occurrence mutations are authenticated, capability-gated, dry-run-first,
exact-targeted, and atomic.

Deletion:

- targets one numeric snapshot ID;
- refuses linked snapshots;
- conservatively refuses ambiguous legacy references;
- deletes no Budget definition and changes no transaction.

Linking:

- validates the transaction, snapshot, and parent Budget;
- refuses transfers and unsafe existing links;
- updates only `budgetSnapshotId`, `budgetId`, and `occurrenceDate`.

Unlinking:

- clears only `budgetSnapshotId`, `budgetId`, and `occurrenceDate`;
- preserves the occurrence and all other transaction fields.

Creation:

- is always explicit;
- normalizes one requested occurrence date;
- reuses an existing valid occurrence;
- creates at most one occurrence using the shared deterministic generator;
- does not rewrite historical or linked occurrences.

Atomic combined operations roll back the entire transaction if any validation,
creation, or link step fails.

## Capability

The optional capability is:

`budgetSnapshotOccurrenceWrites`

The backend environment variable is:

`PERSONAL_FINANCE_ENABLE_BUDGET_SNAPSHOT_OCCURRENCE_WRITES`

Profiles and manifests containing the original 17 capabilities remain valid.
The new capability is not retroactively required. Occurrence mutation controls
are available only when authoritative readiness and this capability are both
true; otherwise the server refuses safely and there is no Dexie fallback.

## Endpoints

Occurrence lifecycle routes are under:

`/prototype/repositories/budget-snapshot-occurrences/{dry-run|write}/:action`

Supported actions:

- `create`
- `delete`
- `link`
- `changeLink`
- `unlink`
- `createAndLink`

Create Budget from Transaction routes:

- `POST /prototype/repositories/budgets/from-transaction/dry-run`
- `POST /prototype/repositories/budgets/from-transaction/write`

Responses contain bounded summaries, affected counts, safe codes, and
`dexieMutated: false`; they do not expose raw financial rows, paths, tokens,
SQL, or internal confirmation phrases.

## Automated acceptance

The following checks passed against disposable fixtures only:

- root and server builds;
- 50 frontend tests;
- Budget Snapshot occurrence suite, including create, reuse, deletion
  refusals, ambiguous-reference refusal, exact link/unlink fields,
  create-and-link rollback, and Create Budget from Transaction;
- authority operations: 21/21;
- checkpoint rotation: 13/13;
- Budget lifecycle: 22/22;
- Budget deletion: 21/21;
- transaction deletion: 14/14;
- recipient lifecycle: 18/18;
- account lifecycle: 20/20;
- category lifecycle: 14/14;
- bucket lifecycle: 15/15;
- account image checks;
- non-mutating API smoke: 133/133;
- SQLite comparison verification: 6/6 with zero mismatches;
- selected-read import guard;
- runtime artifact guard;
- local API safety command;
- `git diff --check` other than repository line-ending notices.

The original 17-capability profile compatibility case and the enabled/disabled
optional capability paths are covered. No test used the live runtime database.

## Disposable browser acceptance

Acceptance directory:

`C:\dev\personal-finance-data\temp\sqlite-main-parity-final-20260724-182409`

The clean runtime was restored from live checkpoint sequence 3 into an isolated
database, profile, backup directory, token configuration, and ports.

Focused browser acceptance confirmed:

- Transactions rendered 2,722 rows and the expected net total;
- Budget History rendered 1,526 occurrences, 2,722 transactions, and 49
  Budget definitions;
- explicit occurrence creation;
- atomic Create Budget from Transaction;
- visible transaction-to-occurrence linkage;
- unlink through the main UI;
- deletion of one eligible unlinked occurrence;
- safe cleanup and restoration of all synthetic records;
- healthy authority messaging on Transactions, Budget, Budget History, and
  Reports;
- Settings and authority status navigation.

The broader Transactions, management, Reports, Settings, and usability
behavior rests on the previously accepted browser baseline plus the inherited
50-test parity suite. This run specifically re-exercised the newly approved
occurrence lifecycle and its affected main-app screens.

## Before and after

| Measure | Before | After cleanup |
| --- | ---: | ---: |
| Transactions | 2,722 | 2,722 |
| Budgets | 49 | 49 |
| Budget snapshots | 1,526 | 1,526 |
| Accounts | 6 | 6 |
| Net total | 15,145.76 | 15,145.76 |

Linked historical occurrence verification:

- linked historical rows before: 411;
- linked historical rows after: 411;
- before and after SHA-256:
  `1684dd6bf0de65f24a2e86a471de09b0368bfc01e7008adb2733a3ec6e223ead`.

The logical database fingerprint changed only because the explicitly restored
occurrence received a new internal ID. The cleaned disposable state was
checkpointed as sequence 4 with fingerprint:

`3ece428be1f1c59b3951ddba305e3e4774ac1ebe5ad4057291c9aade210603b7`

The sequence 4 manifest matches, lineage verifies, services are stopped, ports
are free, and no lock, WAL, or SHM file remains.

## Daily-use launchers

Version-controlled helpers:

- `C:\dev\personal-finance\scripts\Start-PersonalFinance.ps1`
- `C:\dev\personal-finance\scripts\Checkpoint-PersonalFinance.ps1`

Profile-specific wrappers outside Git:

- `C:\dev\personal-finance-data\launchers\Start-PersonalFinance.cmd`
- `C:\dev\personal-finance-data\launchers\Checkpoint-PersonalFinance.cmd`

Desktop shortcuts:

- `C:\Users\Jeff\Desktop\Personal Finance.lnk`
- `C:\Users\Jeff\Desktop\Checkpoint Personal Finance.lnk`

Both launchers passed disposable-profile start, checkpoint-required,
checkpoint, verification, and restart checks. Token contents are not embedded.
The live-profile shortcuts were not run during acceptance.

## Screenshots

Screenshots are outside the repository:

- `C:\Users\Jeff\.codex\visualizations\2026\06\28\019f0dd7-41d9-7913-bd2b-623fc10c4128\sqlite-parity-transactions.png`
- `C:\Users\Jeff\.codex\visualizations\2026\06\28\019f0dd7-41d9-7913-bd2b-623fc10c4128\sqlite-parity-budget-history.png`

## Repository state

- Branch: `master`
- Starting commit: `7642d5c`
- Worktree: intentionally modified with the inherited parity work and this
  lifecycle slice
- Schema changes: none
- Runtime artifacts in Git worktree: none
- Live profile changes: none
- Live database mutations: none
- Commit created: no
- Tag created: no

Proposed commit:

`Complete SQLite main-app feature parity`

Proposed tag:

`sqlite-main-app-feature-parity-complete-baseline`

## Exact live rollout

1. Review and commit the complete worktree, then tag the accepted source.
2. Stop the API and Vite and confirm no authority lock, WAL, or SHM remains.
3. Create and verify a fresh live checkpoint before changing the profile.
4. Back up the current profile outside Git.
5. Reinitialize the same profile with `--replace`, preserving every current
   path, port, and capability and appending
   `--capability budgetSnapshotOccurrenceWrites`. The exact current values are:

```powershell
Set-Location C:\dev\personal-finance\server
npm run authority:ops -- --profile "C:\dev\personal-finance-data\activation-20260723-160032\profiles\authoritative-profile.json" init --mode authoritative --sqlite "C:\dev\personal-finance-data\activation-20260723-160032\runtime\authority-active-0.sqlite" --manifest "C:\dev\personal-finance-data\activation-20260723-160032\backups\authority-checkpoint-20260723170851063.manifest.json" --token-file "C:\dev\personal-finance-data\.server-token" --backup-directory "C:\dev\personal-finance-data\activation-20260723-160032\backups" --api-port 3180 --vite-port 5200 --capability recipientActiveStateWrites --capability recipientCreateUpdateWrites --capability bucketCategoryWrites --capability accountWrites --capability transactionBasicWrites --capability transactionCostBudgetWrites --capability transactionTransferWrites --capability smsTemplateWrites --capability budgetDefinitionWrites --capability budgetSnapshotGenerationWrites --capability transactionDeleteWrites --capability budgetLifecycleWrites --capability recipientDeleteMergeWrites --capability accountDeleteMergeWrites --capability categoryDeleteMergeWrites --capability bucketDeleteMergeWrites --capability budgetDeleteWrites --capability budgetSnapshotOccurrenceWrites --replace
```

6. Verify before first startup:

```powershell
npm run authority:ops -- --profile "C:\dev\personal-finance-data\activation-20260723-160032\profiles\authoritative-profile.json" status
npm run authority:ops -- --profile "C:\dev\personal-finance-data\activation-20260723-160032\profiles\authoritative-profile.json" verify
npm run authority:ops -- --profile "C:\dev\personal-finance-data\activation-20260723-160032\profiles\authoritative-profile.json" start --dry-run
```

7. Start with the `Personal Finance` shortcut. Confirm readiness before entering
   any live data.

The profile update is an operator action. It was deliberately not performed by
this implementation/acceptance run.

## Focused live test

Use recent real transactions only:

1. Open Transactions and confirm count, balances, and recent rows.
2. Enter one ordinary Expense and one ordinary Income.
3. Enter one transaction with a transaction cost.
4. Enter one transaction with original currency and exchange rate.
5. Parse one known SMS template and confirm prefill before saving.
6. Open one recent transaction in Transaction Details.
7. Link it to an existing matching Budget occurrence, verify, then unlink it.
8. If genuinely needed, explicitly create one missing occurrence and link the
   transaction after reviewing the dry run.
9. Create a Budget from one appropriate recent transaction only after reviewing
   the definition, occurrence, and link summary.
10. Confirm Budget History and Reports totals remain coherent.
11. Stop the app and run `Checkpoint Personal Finance`.
12. Verify the new checkpoint before the next startup.

Stop immediately on a readiness refusal, unexpected count/total change,
ambiguous legacy-reference refusal, unintended occurrence creation, historical
occurrence change, or any Dexie fallback indication.

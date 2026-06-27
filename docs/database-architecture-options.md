# Database Architecture Options

This note compares realistic future paths for the app's data layer. It is planning documentation only; it is not an implementation decision, migration plan approval, or schema rewrite.

## Current State

The app is currently:

- an Ionic React frontend
- backed by Dexie / IndexedDB
- storing primary data in browser-specific storage
- local-first and private by default
- protected by full JSON backup/restore tooling
- protected by dry-run backup validation before restore
- protected by a database health check for likely integrity problems

CSV export/import exists for transaction-oriented workflows, but it is not a full backup. Complete recovery depends on full JSON backup because the app data model includes budgets, budget snapshots, accounts, buckets, categories, recipients, SMS import templates, typed dates, blobs, internal IDs, and references between tables.

The current setup is safer than it was before backup validation, guarded restore, and health checks. The long-term concern remains that the active database lives inside one browser profile's IndexedDB.

## Provisional Decisions

These decisions reflect the latest planning discussion. They are direction-setting, not permission to implement a migration without a separate plan, tests, backup path, and user approval.

- **Desktop target**: local API server plus local SQLite database file.
- **Migration bridge**: repository/data-access abstraction first.
- **Preferred backend stack**: Node + TypeScript + Fastify + `better-sqlite3`.
- **Data folder**: sibling local folder outside the repo, for example `C:\dev\personal-finance-data`.
- **Repo boundary**: backend code may live in this repo; real SQLite databases, backup files, exports, logs with sensitive data, and local runtime data must not be committed to Git.
- **Backup cadence**: at least every 24 hours, plus immediately before migrations and restores.
- **Mobile**: deferred. Preserve the path through repository adapters, but do not design the desktop local server as the mobile answer.
- **Security baseline**: bind to `127.0.0.1` only, require a local API token, restrict CORS/origins, and keep sensitive financial data out of the repo and logs.
- **At rest definition**: financial data stored on disk in SQLite files, backup files, exported reports, and logs.
- **Starting/stopping**: use development scripts first. Consider a packaged launcher or tray app later. Do not start with a Windows service.

## Main Goals

Future data-layer work should aim for:

- browser-agnostic local access from `localhost`
- easier database inspection and debugging
- AI-agent-friendly access to database state
- lower risk of accidental data loss
- future mobile compatibility
- preservation of the local-first/private-by-default philosophy
- no forced cloud account or remote database

## Option A: Stay On Dexie / IndexedDB With Stronger Backup Discipline

### Summary

Keep the current architecture and continue improving safety tools around it: full backups, validation, health checks, clearer documentation, and more guardrails before destructive operations.

### Pros

- Lowest implementation risk.
- No migration needed.
- Works with the current Ionic React app.
- Keeps the app fully local and private.
- Existing backup/restore/health-check tooling already targets this model.
- Good short-term fit while the product model is still changing.

### Cons

- Database remains browser-profile-specific.
- Inspecting IndexedDB is less convenient than inspecting a SQLite file.
- AI agents cannot safely inspect data without browser tooling or exported reports.
- Moving between browsers still requires backup/restore.
- Browser storage cleanup, profile corruption, or user error can still be catastrophic without backups.

### Data-Loss Risk

Medium. Recent safety tooling reduces recovery risk, but the primary database is still tied to one browser profile.

### Debuggability

Moderate. Browser DevTools can inspect IndexedDB, but it is not as simple as querying a local database file.

### Browser-Agnostic Suitability

Weak. Each browser has its own IndexedDB store.

### Mobile Suitability

Moderate. IndexedDB can work in web/mobile web contexts, but native mobile persistence may need a stronger path.

### Migration Complexity

None for staying put. Continued improvements should be small and incremental.

### Fit For This App

Best short-term option. The current system is working and now has better backup, validation, restore, and health-check support.

## Option B: SQLite In Browser / WASM / OPFS-Style Storage

### Summary

Use SQLite compiled to WebAssembly, with browser storage such as OPFS where available. The app would still run in the browser but use a SQLite-like data model.

### Pros

- SQL queries and relational modeling are a better conceptual fit for financial records.
- A SQLite-compatible layer may improve reporting and integrity checks.
- Could keep the app browser-only and local-first.
- Potentially easier to port some logic to native SQLite later.

### Cons

- Browser support and persistence details are more complex than Dexie.
- OPFS availability and behavior vary by browser and environment.
- The database may still be browser-specific unless the file can be exported/imported or accessed consistently.
- Adds implementation complexity without fully solving `localhost` browser-agnostic access.
- Debugging WASM/OPFS data can still be awkward.

### Data-Loss Risk

Medium. SQLite semantics may help consistency, but browser storage remains a risk unless backup/export discipline is excellent.

### Debuggability

Moderate. SQL is better for inspection, but browser-hosted SQLite files can still be harder to reach than normal files.

### Browser-Agnostic Suitability

Moderate to weak. It improves the data model but may not solve cross-browser access cleanly.

### Mobile Suitability

Moderate. Concepts may align with native SQLite, but the exact browser/WASM implementation may not transfer directly.

### Migration Complexity

High. The app would need an export/import migration, type mapping, date/blob handling, and query rewrites or an adapter layer.

### Fit For This App

Interesting but not the cleanest answer to the main desktop goal. It may be useful for experiments, but it should not be the first migration target.

## Option C: Capacitor SQLite For Mobile / Native Path

### Summary

Use a Capacitor SQLite plugin or native SQLite storage for mobile builds, while the web app may continue using Dexie or another adapter.

### Pros

- Strong fit for mobile persistence.
- SQLite files are durable and well-understood.
- Better native inspection/debugging options than browser IndexedDB.
- Can support a future mobile app without relying only on browser storage.

### Cons

- Primarily solves native/mobile, not desktop browser access.
- Plugin choice, platform support, and migration behavior must be evaluated carefully.
- May require separate web and mobile adapters.
- Adds native build and testing complexity.

### Data-Loss Risk

Low to medium if implemented carefully with backups, transactions, and tested migrations. Plugin quality and backup handling matter.

### Debuggability

Good on native platforms when the SQLite file can be accessed. Less helpful for current browser-only development.

### Browser-Agnostic Suitability

Weak for desktop browser use. It does not by itself let any browser connect to the same local database through `localhost`.

### Mobile Suitability

Strong. This is likely the best long-term mobile persistence family.

### Migration Complexity

High. The app would need a clear data-access abstraction and platform-specific adapter behavior.

### Fit For This App

Good long-term mobile candidate, but it should be evaluated separately from the desktop browser-agnostic goal.

## Option D: Local API Server Plus Local SQLite Database File For Desktop

### Summary

Run a local backend on `localhost` and store data in a local SQLite database file. The Ionic React frontend talks to the local API instead of directly reading/writing IndexedDB.

The provisional preferred desktop stack is Node + TypeScript + Fastify + `better-sqlite3`. The SQLite database file should live outside the Git repo in a sibling local data folder such as `C:\dev\personal-finance-data`.

### Pros

- Best match for browser-agnostic local desktop access.
- Any browser on the same machine can use the same `localhost` API and database file.
- SQLite database files are easier to inspect, back up, diff, and query.
- AI coding agents can inspect reports or database state through controlled local tools.
- Backend can enforce invariants consistently.
- Keeps data local and private by default.
- Creates a clearer path for scheduled backups and diagnostic tooling.

### Cons

- Requires designing and maintaining a backend.
- Requires API contracts, local process management, and error handling.
- Desktop packaging and startup become more complex.
- Security still matters even on localhost.
- Mobile would likely need a separate adapter or sync/import story.
- A separate data folder and strict `.gitignore`/logging discipline are required to avoid committing real financial data.

### Data-Loss Risk

Low to medium if implemented with tested migrations, transactions, backups, and comparison tools. Risk is highest during migration.

### Debuggability

Strong. SQLite files and API logs are much easier to inspect than browser IndexedDB.

### Browser-Agnostic Suitability

Strong. This is the chosen desktop target for using the same local data from different browsers on the same machine.

### Mobile Suitability

Moderate to weak directly. Mobile likely needs a native SQLite adapter or a different local-server approach.

### Migration Complexity

High. Requires repository abstraction, API design, SQLite schema design, migration tooling, comparison tooling, and extensive verification.

### Fit For This App

Best current desktop target because it directly addresses browser-agnostic local access and inspectability while preserving local-first operation.

## Option E: Hybrid Repository Abstraction With Multiple Adapters

### Summary

Introduce a data-access/repository interface and place Dexie behind an adapter first. Later, add a local API/SQLite desktop adapter and possibly a Capacitor SQLite mobile adapter.

### Pros

- Reduces migration risk by separating app behavior from storage implementation.
- Allows Dexie to remain the short-term source of truth.
- Lets new backends be prototyped without rewriting the whole UI at once.
- Supports platform-specific persistence strategies.
- Makes comparison testing more practical.

### Cons

- Adds abstraction work before visible user benefits.
- Poorly designed repositories can hide important Dexie/query behavior or create leaky abstractions.
- Existing code may have many direct Dexie dependencies.
- Requires discipline to avoid changing behavior while moving access behind interfaces.

### Data-Loss Risk

Low in the abstraction phase if Dexie remains the only writer. Medium during adapter migration unless comparison tooling is strong.

### Debuggability

Moderate at first, stronger later. It does not improve database inspection immediately, but it creates a safer route to a more inspectable backend.

### Browser-Agnostic Suitability

Strong as an enabling step, not as a final storage choice.

### Mobile Suitability

Strong as an enabling step because different adapters can target web, desktop, and native mobile.

### Migration Complexity

Medium to high. It should be phased by feature area and protected by tests, health checks, and report comparisons.

### Fit For This App

Best medium-term architecture move. It prepares for local API/SQLite without forcing a risky direct migration.

## Recommended Direction

Short term: keep Dexie / IndexedDB. The app now has full JSON backup, dry-run validation, guarded restore, and health checks. That makes the current architecture acceptable while the app stabilizes.

Medium term: introduce a data-access/repository abstraction before any backend migration. The first adapter should still be Dexie, so behavior can be preserved while direct database access is gradually reduced.

Desktop long term: local API server plus a local SQLite database file is the provisional target for browser-agnostic `localhost` access, easier inspection/debugging, and AI-agent-friendly diagnostics. The preferred stack is Node + TypeScript + Fastify + `better-sqlite3`.

Mobile long term: defer mobile storage decisions and evaluate Capacitor/native SQLite separately. Mobile should not be treated as automatically solved by the desktop local server design.

Do not move directly from Dexie to a new database without a tested export/restore, health-check, row-count, and comparison strategy. The safest migration is one that can prove the old and new data layers produce the same transactions, budgets, reports, and integrity results before the new layer becomes authoritative.

## Suggested Phased Migration Plan

### Phase 1: Stabilize Current Dexie App And Safety Tools

- Keep Dexie as the source of truth.
- Continue using full JSON backups before destructive actions.
- Keep backup validation, guarded restore, and health checks healthy.
- Add focused tests around risky data-linking workflows.

### Phase 2: Define Repository / Data-Access Interface

- Identify core app operations by domain: transactions, budgets, reports, accounts, categories, recipients, settings, backup, and health.
- Define interfaces around app needs rather than around Dexie table mechanics.
- Avoid changing data behavior in this phase.

### Phase 3: Implement Dexie Adapter Behind The Interface

- Move direct Dexie access behind the repository interface incrementally.
- Keep Dexie as the only writer.
- Verify that row counts, health checks, and app behavior remain unchanged.

### Phase 4: Prototype Local API + SQLite Separately

- Build a proof-of-concept in a separate branch or small prototype.
- Use the provisional stack: Node + TypeScript + Fastify + `better-sqlite3`.
- Store runtime data in a sibling folder such as `C:\dev\personal-finance-data`, not in the app repo.
- Bind the API to `127.0.0.1`, use a local API token, and restrict CORS/origins from the first prototype.
- Start and stop the backend with development scripts first.
- Do not connect the main app to the prototype until comparison tooling exists.

### Phase 5: Build Data Comparison Tools

- Compare row counts per table.
- Compare key reports and totals.
- Compare transactions, budgets, budget snapshots, and transfer-pair integrity.
- Reuse full backup and health-check outputs where practical.

### Phase 6: Migrate Desktop Only After Matches Are Proven

- Require matching row counts.
- Require clean health checks.
- Require matching Transactions, Budget, and Reports behavior.
- Require restore tests and backup tests.
- Keep a rollback path to the Dexie backup.
- Require at least one pre-migration backup and one successful post-migration backup.

### Phase 7: Revisit Mobile Adapter Separately

- Evaluate Capacitor/native SQLite.
- Decide whether mobile uses its own adapter, import/export flow, or a later sync model.
- Keep desktop and mobile data concepts aligned even if storage adapters differ.

## Non-Goals

- No cloud sync for now.
- No auth or user accounts for now.
- No remote database for now.
- No automatic destructive migration.
- No schema rewrite bundled with a budget model rewrite.
- No backend implementation in the planning/documentation phase.
- No Windows service as the initial local backend runtime.
- No real database, backup, export, or sensitive log files committed to Git.

## Open Questions

- What exact subdirectory layout should `C:\dev\personal-finance-data` use for the live database, backups, exports, and logs?
- What should the API token generation, storage, and rotation flow look like?
- Which localhost origins should be allowed during development and packaged use?
- How should the "at least every 24 hours" backup cadence be implemented and monitored?
- How should mobile and desktop data stay conceptually aligned if they use different adapters?
- Should sensitive data at rest be protected only by OS/user-profile permissions at first, or should app-level encryption be evaluated early?
- How should the local server be updated and recovered if it fails?
- How should logs stay useful while guaranteeing no sensitive financial data is written to them?
- What comparison reports are sufficient before declaring the SQLite backend equivalent to Dexie?

## Practical Decision For Now

Do not migrate yet. Keep the Dexie app stable, use full JSON backups, and treat the next architecture step as an adapter/repository design exercise. The provisional desktop target is a local API server with a local SQLite database file, using Node + TypeScript + Fastify + `better-sqlite3`, but that must be proven through a prototype and comparison tooling before it touches real finance data.

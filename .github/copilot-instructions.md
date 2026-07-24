# Repository Instructions

- SQLite through the local API is authoritative; Dexie/IndexedDB is legacy and must not receive new authoritative writes.
- Preserve financial invariants: expenses are negative, income is positive, transfers remain paired, and budget snapshot links remain stable.
- Use authenticated, capability-gated, dry-run-first, explicitly confirmed mutation paths.
- Preserve existing workflows and schema; avoid unrelated refactors or budget lifecycle changes.
- Keep generated databases, backups, manifests, reports, logs, tokens, and financial data outside Git.
- Run focused tests plus the relevant root/server safety checks for changes.
- Read `docs/PROJECT_STATE.md` for current architecture, launch, checkpoint, and migration status.

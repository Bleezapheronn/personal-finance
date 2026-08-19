# Personal Finance Local API

The local API serves the SQLite-backed Personal Finance application on a
loopback address. Requests require the local token. The ordinary launcher
starts this API and Vite together from one terminal without opening a browser
or requiring operational cleanup on the next launch.

Runtime configuration supplies the SQLite path, token file, and loopback ports.
The API exposes normal repository reads and supported writes. It reports actual
SQLite errors through its normal responses; no profile, lock, checkpoint,
readiness, or supervisor state participates in startup.

Automatic backups are configured through the frontend Settings page. The
independent scheduled worker reads the same runtime configuration, creates a
native SQLite backup, verifies it and a disposable restore, then publishes only
the verified result. The restore command requires explicit backup, manifest,
and fresh output paths.

The authenticated restore-control routes support the Settings & Status restore
card. They inventory verified scheduled pairs, create a disposable rehearsal,
and arm a versioned one-shot request after typed confirmation. The existing
runtime launcher claims that request only after its API exits, stops the owned
frontend, creates and verifies a rollback, applies the exact SQLite cutover, and
restarts the normal runtime. The retained rollback remains available after
acceptance; invoking it through the same typed handoff first creates and verifies
a pre-rollback safety artifact. These routes mutate operational restore state
only; they are not general financial-data write endpoints.

Run focused checks with the scripts in `package.json`. Keep SQLite files,
tokens, backups, logs, and financial data outside this repository.

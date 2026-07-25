# Verified SQLite backup operations

The `backup:ops` command manages plain, verified SQLite backups from an existing authority profile. It uses SQLite native backup, logical verification, SHA-256 publication checks, and a disposable verified restore before it publishes a database and matching manifest. The SQLite API is authoritative; Dexie is legacy compatibility only.

Configuration is external to Git and SQLite, at `<personal-finance-data-root>\config\backup-settings.json` (by default derived from the profile location). Initialize it explicitly, which also creates and verifies write access to the destination and staging directories:

The Settings page can browse and validate a destination and save the daily time. Saving while disabled only writes the external configuration; enabling separately installs and verifies the current-user scheduled task. Reading the Settings state does not create configuration.

```
npm run backup:ops -- --profile <authority-profile.json> config init
npm run backup:ops -- --profile <authority-profile.json> config set-destination --destination <outside-repo-directory> --initialize
npm run backup:ops -- --profile <authority-profile.json> config enable
npm run backup:ops -- --profile <authority-profile.json> backup run
```

The default destination is the user’s OneDrive Documents `Personal Finance Backups` folder when OneDrive is configured. A successful run only means verified files were placed there; it does not claim cloud synchronization completed. Staging is outside OneDrive.

Use `backup list`, `backup verify-latest`, and `backup status` for safe summaries. Every usable backup has both a SQLite file and a scheduled-backup manifest. Partial, missing, corrupt, checksum-mismatched, and logically mismatched pairs are invalid. Checkpoints use different manifests and are ignored.

Retention is deliberately two-step:

```
npm run backup:ops -- --profile <authority-profile.json> retention dry-run
npm run backup:ops -- --profile <authority-profile.json> retention apply --plan <returned-plan-id> --confirm
```

It keeps one newest verified backup per day for 30 days, then one newest verified backup per older month forever. It refuses ambiguous inventory changes and does not touch checkpoint backups, partial files, configuration, or unrelated files.

On Windows, `scheduler install`, `scheduler update`, `scheduler status`, and `scheduler remove` use the current user’s Task Scheduler context. They run the standalone worker without Vite or a browser. Install only the reviewed production task after a disposable-profile/task rehearsal. Restore always goes to a fresh disposable database through the existing verified restore operation; never overwrite the active SQLite file directly.

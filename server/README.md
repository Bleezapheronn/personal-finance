# Local API Prototype Server

This is a prototype-only local API skeleton. It currently exposes only:

- `GET /health`
- `GET /metadata`

The backend does not connect to SQLite yet, does not read real finance data, and does not replace Dexie / IndexedDB. The browser IndexedDB database remains authoritative. No financial data endpoints exist yet.

## Safety

Do not put real finance data, SQLite database files, backups, exports, logs, local tokens, or runtime data in this folder.

Runtime data belongs outside the repository, with `C:\dev\personal-finance-data` as the suggested local folder.

The local API token is stored outside the repository at:

```text
<dataDir>\.server-token
```

By default, `<dataDir>` is `C:\dev\personal-finance-data`. You can override it with `PERSONAL_FINANCE_DATA_DIR`.

## Commands

Install server dependencies from this folder:

```bash
npm install
```

Run the prototype server in development:

```bash
npm run dev
```

Build the server:

```bash
npm run build
```

Start the compiled server:

```bash
npm run start
```

The server binds to `127.0.0.1` only. The default port is `3147`.

## Schema Draft

The future disposable SQLite prototype schema is documented, but no SQLite runtime code or database files exist yet:

- [schema/prototype-schema.sql](schema/prototype-schema.sql)
- [docs/sqlite-schema-notes.md](docs/sqlite-schema-notes.md)

## Import And Comparison Designs

Backup import and comparison tooling are documented here. The importer and row-count comparison CLIs are prototype-only, and no financial API endpoints exist:

- [docs/backup-import-design.md](docs/backup-import-design.md)
- [docs/comparison-report-design.md](docs/comparison-report-design.md)

## Disposable Backup Importer

The prototype importer creates a disposable SQLite database from a full JSON backup. Dexie / IndexedDB remains authoritative, and no API routes expose imported financial data.

Use only backup input and SQLite output paths outside the repository. The generated `<output>.import-summary.json` should also be treated as sensitive and kept outside the repository.

Example:

```bash
npm run import:backup -- -- --input C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --output C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite
```

If the disposable output already exists, replace it explicitly:

```bash
npm run import:backup -- -- --input C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --output C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --overwrite-disposable
```

The importer refuses repo-local output unless `--allow-repo-output-for-tests` is supplied. Do not use that flag for real backups.

## Row-Count Comparison

The first comparison CLI checks only full-backup table lengths, optional backup `integrity.counts`, and row counts in a disposable SQLite database. It opens SQLite read-only and does not expose row-level financial data.

Keep backup files, SQLite databases, and comparison reports outside the repository. Reports contain only counts and basenames, but should still be treated as local data artifacts.

Example:

```bash
npm run compare:counts -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\row-count-comparison.json
```

The comparison report output is optional. If supplied, repo-local output is refused unless `--allow-repo-output-for-tests` is supplied.

## Structural Integrity Comparison

The structural comparison CLI checks transfer-pair integrity and budget snapshot link integrity for a full backup and a disposable SQLite database. It compares count-level issue summaries only; it does not print transaction descriptions, account names, amounts, or raw rows.

Matching issue counts mean the import preserved the same structural state. They do not prove the source data is healthy. If backup and SQLite both contain the same issue count, the comparison can pass while still reporting source issues.

Keep generated reports outside the repository:

```bash
npm run compare:integrity -- -- --backup C:\dev\personal-finance-data\exports\personal-finance-full-backup.json --sqlite C:\dev\personal-finance-data\temp\personal-finance-prototype.sqlite --output C:\dev\personal-finance-data\temp\structural-integrity-comparison.json
```

## Token Commands

Show the local development token:

```bash
npm run token:show
```

Rotate the local development token:

```bash
npm run token:rotate
```

These commands print the token because they are explicit local developer actions. Server startup does not print the token.

## Endpoints

Health check, no token required:

```bash
curl http://127.0.0.1:3147/health
```

Expected response:

```json
{
  "ok": true,
  "service": "personal-finance-local-api",
  "mode": "prototype"
}
```

Metadata, token required:

```bash
$TOKEN = npm run token:show --silent
curl -H "x-personal-finance-token: $TOKEN" http://127.0.0.1:3147/metadata
```

Expected response:

```json
{
  "service": "personal-finance-local-api",
  "mode": "prototype",
  "apiVersion": "0.1.0",
  "readonly": true
}
```

Requests with no `Origin` header are allowed for local CLI use when the token is valid. Browser-style requests with an unexpected `Origin` are rejected. Allowed local development origins are:

- `http://localhost:8100`
- `http://127.0.0.1:8100`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

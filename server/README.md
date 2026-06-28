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

Future backup import and comparison tooling is documented only. No importer, SQLite runtime code, database files, or financial API endpoints exist yet:

- [docs/backup-import-design.md](docs/backup-import-design.md)
- [docs/comparison-report-design.md](docs/comparison-report-design.md)

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

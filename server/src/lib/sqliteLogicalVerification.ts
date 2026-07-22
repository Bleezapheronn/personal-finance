import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  readSqliteFinancialAggregateSummary,
} from "../compareFinancialAggregates.js";
import { readSqliteIntegritySummary } from "../compareIntegrity.js";
import { readSqliteReportTotalsSummary } from "../compareReportTotals.js";
import { readSqliteBudgetHistorySummary } from "../compareBudgetHistory.js";
import {
  FULL_BACKUP_TABLE_NAMES,
  type FullBackupTableName,
} from "./backup.js";
import { localDayKey, normalizeToLocalDay } from "./dates.js";
import { assertRequiredTablesExist } from "./sqlite.js";
import { openReadOnlyDatabase } from "./sqlite.js";

const JSON_TEXT_FIELDS = new Set([
  "budgets.frequencyDetails",
  "budgetSnapshots.frequencyDetails",
]);

export type TableNumberMap = Record<FullBackupTableName, number>;
export type TableStringMap = Record<FullBackupTableName, string>;

export interface SqliteLogicalVerification {
  verificationVersion: 1;
  normalizedAsOf: string;
  integrityCheck: "ok";
  userVersion: number;
  schemaVersion: number;
  journalMode: string;
  tableNames: string[];
  schemaFingerprint: string;
  rowCounts: TableNumberMap;
  tableContentFingerprints: TableStringMap;
  financialAggregateFingerprint: string;
  reportTotalsFingerprint: string;
  budgetHistoryFingerprint: string;
  transactionLinkageFingerprint: string;
  integritySummary: Record<string, number>;
  databaseIdentityFingerprint: string;
}

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_sqlite_number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Buffer.isBuffer(value)) {
    return { blobBytes: value.length, blobSha256: sha256(value) };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  throw new Error("unsupported_sqlite_value");
};

export const stableJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const fingerprintLogicalValue = (value: unknown): string =>
  sha256(stableJson(value));

const normalizeField = (
  table: FullBackupTableName,
  field: string,
  value: unknown,
): unknown => {
  if (
    typeof value === "string" &&
    JSON_TEXT_FIELDS.has(`${table}.${field}`)
  ) {
    try {
      return canonicalize(JSON.parse(value) as unknown);
    } catch {
      throw new Error(`${table}_${field}_json_invalid`);
    }
  }
  return canonicalize(value);
};

const readTableVerification = (
  db: Database.Database,
  table: FullBackupTableName,
): { rowCount: number; fingerprint: string } => {
  const columns = (
    db.pragma(`table_info(${table})`) as Array<{ name: string; cid: number }>
  )
    .sort((left, right) => left.cid - right.cid)
    .map((column) => column.name);
  if (columns.length === 0 || !columns.includes("id")) {
    throw new Error(`${table}_schema_invalid`);
  }
  const rows = db
    .prepare(`SELECT * FROM ${table} ORDER BY id ASC`)
    .all() as Record<string, unknown>[];
  const hash = createHash("sha256");
  for (const row of rows) {
    const normalized = columns.map((field) => [
      field,
      normalizeField(table, field, row[field]),
    ]);
    hash.update(stableJson(normalized));
    hash.update("\n");
  }
  return { rowCount: rows.length, fingerprint: hash.digest("hex") };
};

const readSchemaFingerprint = (db: Database.Database): string => {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type ASC, name ASC`,
    )
    .all();
  return fingerprintLogicalValue(rows);
};

const readTableNames = (db: Database.Database): string[] =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

const readIntegrityCheck = (db: Database.Database): "ok" => {
  const rows = db.pragma("integrity_check") as Array<Record<string, unknown>>;
  const results = rows.flatMap((row) => Object.values(row).map(String));
  if (results.length !== 1 || results[0].toLowerCase() !== "ok") {
    throw new Error("sqlite_integrity_check_failed");
  }
  return "ok";
};

const readTransactionLinkageFingerprint = (
  db: Database.Database,
): string =>
  fingerprintLogicalValue(
    db
      .prepare(
        `SELECT id, budgetId, occurrenceDate, budgetSnapshotId
         FROM transactions ORDER BY id ASC`,
      )
      .all(),
  );

export const readSqliteLogicalVerification = (
  db: Database.Database,
  asOfInput: Date = new Date(),
): SqliteLogicalVerification => {
  assertRequiredTablesExist(db);
  const integrityCheck = readIntegrityCheck(db);
  const normalizedAsOfDate = normalizeToLocalDay(asOfInput);
  const normalizedAsOf = localDayKey(normalizedAsOfDate);
  const tableRows = FULL_BACKUP_TABLE_NAMES.map((table) => [
    table,
    readTableVerification(db, table),
  ] as const);
  const rowCounts = Object.fromEntries(
    tableRows.map(([table, value]) => [table, value.rowCount]),
  ) as TableNumberMap;
  const tableContentFingerprints = Object.fromEntries(
    tableRows.map(([table, value]) => [table, value.fingerprint]),
  ) as TableStringMap;
  const integritySummary = readSqliteIntegritySummary(db);
  const tableNames = readTableNames(db);
  for (const table of FULL_BACKUP_TABLE_NAMES) {
    if (!tableNames.includes(table)) throw new Error(`${table}_missing`);
  }
  const logicalCore = {
    verificationVersion: 1 as const,
    normalizedAsOf,
    integrityCheck,
    userVersion: Number(db.pragma("user_version", { simple: true })),
    schemaVersion: Number(db.pragma("schema_version", { simple: true })),
    tableNames,
    schemaFingerprint: readSchemaFingerprint(db),
    rowCounts,
    tableContentFingerprints,
    financialAggregateFingerprint: fingerprintLogicalValue(
      readSqliteFinancialAggregateSummary(db),
    ),
    reportTotalsFingerprint: fingerprintLogicalValue(
      readSqliteReportTotalsSummary(db),
    ),
    budgetHistoryFingerprint: fingerprintLogicalValue(
      readSqliteBudgetHistorySummary(db, normalizedAsOfDate),
    ),
    transactionLinkageFingerprint: readTransactionLinkageFingerprint(db),
    integritySummary,
  };
  const {
    schemaVersion: _destinationSchemaCookie,
    ...databaseIdentityCore
  } = logicalCore;
  return {
    ...logicalCore,
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    databaseIdentityFingerprint: fingerprintLogicalValue(databaseIdentityCore),
  };
};

export const logicalVerificationsMatch = (
  left: SqliteLogicalVerification,
  right: SqliteLogicalVerification,
): boolean => {
  const { journalMode: _leftJournalMode, ...leftLogical } = left;
  const { journalMode: _rightJournalMode, ...rightLogical } = right;
  const {
    schemaVersion: _leftSchemaCookie,
    ...leftComparable
  } = leftLogical;
  const {
    schemaVersion: _rightSchemaCookie,
    ...rightComparable
  } = rightLogical;
  return (
    left.databaseIdentityFingerprint === right.databaseIdentityFingerprint &&
    stableJson(leftComparable) === stableJson(rightComparable)
  );
};

export const readSqliteLogicalVerificationAtPath = (
  databasePath: string,
  asOf: Date = new Date(),
): SqliteLogicalVerification => {
  const db = openReadOnlyDatabase(databasePath);
  try {
    return readSqliteLogicalVerification(db, asOf);
  } finally {
    db.close();
  }
};

import Database from "better-sqlite3";
import { FULL_BACKUP_TABLE_NAMES, FullBackupTableName } from "./backup.js";

export const openReadOnlyDatabase = (sqlitePath: string): Database.Database =>
  new Database(sqlitePath, { readonly: true, fileMustExist: true });

export const tableExists = (db: Database.Database, tableName: FullBackupTableName): boolean => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return row !== undefined;
};

export const assertRequiredTablesExist = (db: Database.Database): void => {
  for (const tableName of FULL_BACKUP_TABLE_NAMES) {
    if (!tableExists(db, tableName)) {
      throw new Error(`SQLite table ${tableName} is missing.`);
    }
  }
};

export const readKnownTableRowCounts = (
  db: Database.Database,
): Record<FullBackupTableName, number> => {
  assertRequiredTablesExist(db);

  return Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((tableName) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
        | { count: number }
        | undefined;

      if (!row || typeof row.count !== "number") {
        throw new Error(`Could not read SQLite count for ${tableName}.`);
      }

      return [tableName, row.count];
    }),
  ) as Record<FullBackupTableName, number>;
};

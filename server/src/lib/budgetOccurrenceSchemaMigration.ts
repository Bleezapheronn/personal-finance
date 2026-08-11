import Database from "better-sqlite3";

export const BUDGET_OCCURRENCE_SCHEMA_MIGRATION_CONFIRMATION =
  "apply additive budget occurrence schema migration in sqlite" as const;

const columns = (db: Database.Database, table: string) =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));

export const budgetOccurrenceSchemaMigrationDryRun = (db: Database.Database) => {
  const budgetColumns = columns(db, "budgets");
  const snapshotColumns = columns(db, "budgetSnapshots");
  const additions = [
    ...(!budgetColumns.has("predecessorBudgetId") ? ["budgets.predecessorBudgetId"] : []),
    ...(!budgetColumns.has("projectionStartsOn") ? ["budgets.projectionStartsOn"] : []),
    ...(!snapshotColumns.has("isActive") ? ["budgetSnapshots.isActive"] : []),
    ...(!snapshotColumns.has("resolvedTarget") ? ["budgetSnapshots.resolvedTarget"] : []),
  ];
  return { ok: true, dryRun: true, wouldMutate: additions.length > 0, additions };
};

export const budgetOccurrenceSchemaMigrationWrite = (db: Database.Database, payload: unknown) => {
  if (!payload || typeof payload !== "object" ||
    (payload as Record<string, unknown>).dryRunReviewed !== true ||
    (payload as Record<string, unknown>).confirmation !== BUDGET_OCCURRENCE_SCHEMA_MIGRATION_CONFIRMATION) {
    throw new Error("budget_occurrence_schema_migration_review_required");
  }
  return db.transaction(() => {
    const before = budgetOccurrenceSchemaMigrationDryRun(db);
    if (!before.wouldMutate) return { ...before, dryRun: false, sqliteMutated: false };
    const budgetColumns = columns(db, "budgets");
    const snapshotColumns = columns(db, "budgetSnapshots");
    if (!budgetColumns.has("predecessorBudgetId")) db.exec("ALTER TABLE budgets ADD COLUMN predecessorBudgetId INTEGER");
    if (!budgetColumns.has("projectionStartsOn")) {
      db.exec("ALTER TABLE budgets ADD COLUMN projectionStartsOn TEXT");
      db.exec("UPDATE budgets SET projectionStartsOn = dueDate WHERE projectionStartsOn IS NULL");
    }
    if (!snapshotColumns.has("isActive")) db.exec("ALTER TABLE budgetSnapshots ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1");
    if (!snapshotColumns.has("resolvedTarget")) db.exec("ALTER TABLE budgetSnapshots ADD COLUMN resolvedTarget REAL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_budgets_predecessorBudgetId ON budgets(predecessorBudgetId)");
    return { ok: true, dryRun: false, sqliteMutated: true, additions: before.additions };
  }).immediate();
};

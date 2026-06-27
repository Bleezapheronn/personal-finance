import { Budget, BudgetSnapshot, db } from "../db";

export const listBudgets = async (): Promise<Budget[]> => {
  return db.budgets.toArray();
};

export const listActiveBudgets = async (): Promise<Budget[]> => {
  const budgets = await listBudgets();
  return budgets.filter((budget) => budget.isActive !== false);
};

export const getBudgetById = async (
  id: number,
): Promise<Budget | undefined> => {
  return db.budgets.get(id);
};

export const listBudgetSnapshots = async (): Promise<BudgetSnapshot[]> => {
  return db.budgetSnapshots.toArray();
};

export const getBudgetSnapshotById = async (
  id: number,
): Promise<BudgetSnapshot | undefined> => {
  return db.budgetSnapshots.get(id);
};

export const listSnapshotsForBudget = async (
  budgetId: number,
): Promise<BudgetSnapshot[]> => {
  return db.budgetSnapshots.where("budgetId").equals(budgetId).toArray();
};

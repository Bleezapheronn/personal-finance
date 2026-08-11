import type { Bucket, Category, Transaction } from "../db";

type TransactionRow = Record<string, unknown>;

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const date = (value: unknown): Date | undefined => {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
};

/** Converts SQLite HTTP rows into the app's Date-bearing Transaction shape. */
export const normalizeBudgetDefinitionTransaction = (value: unknown): Transaction | undefined => {
  const row = value as TransactionRow;
  const categoryId = number(row.categoryId);
  const recipientId = number(row.recipientId);
  const amount = number(row.amount);
  const transactionDate = date(row.date);
  if (categoryId === undefined || recipientId === undefined || amount === undefined || !transactionDate) return undefined;
  return {
    id: number(row.id), categoryId, recipientId, amount, date: transactionDate,
    accountId: number(row.accountId), transactionCost: number(row.transactionCost),
    budgetId: number(row.budgetId), budgetSnapshotId: number(row.budgetSnapshotId),
    occurrenceDate: date(row.occurrenceDate), description: typeof row.description === "string" ? row.description : undefined,
    transactionReference: typeof row.transactionReference === "string" ? row.transactionReference : undefined,
    isTransfer: row.isTransfer === true || row.isTransfer === 1,
  };
};

export const budgetDefinitionIncomeForYear = (
  transactions: Transaction[],
  categories: Category[],
  buckets: Bucket[],
  year: number,
): number => {
  const incomeBucketIds = new Set(buckets.filter((bucket) => bucket.excludeFromReports).map((bucket) => bucket.id));
  const incomeCategoryIds = new Set(categories.filter((category) => incomeBucketIds.has(category.bucketId)).map((category) => category.id));
  return transactions
    .filter((transaction) => transaction.date.getFullYear() === year && incomeCategoryIds.has(transaction.categoryId))
    .reduce((total, transaction) => total + transaction.amount + (transaction.transactionCost ?? 0), 0);
};

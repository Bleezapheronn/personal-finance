import { db, Transaction } from "../db";

export const listTransactions = async (): Promise<Transaction[]> => {
  return db.transactions.toArray();
};

export const getTransactionById = async (
  id: number,
): Promise<Transaction | undefined> => {
  return db.transactions.get(id);
};

export const listTransactionsInDateRange = async (
  startDate: Date,
  endDate: Date,
): Promise<Transaction[]> => {
  return db.transactions
    .where("date")
    .between(startDate, endDate, true, true)
    .toArray();
};

export const listTransactionsBeforeDate = async (
  date: Date,
): Promise<Transaction[]> => {
  return db.transactions.where("date").below(date).toArray();
};

export const listTransactionsAfterDate = async (
  date: Date,
): Promise<Transaction[]> => {
  return db.transactions.where("date").above(date).toArray();
};

export const getTransactionCount = async (): Promise<number> => {
  return db.transactions.count();
};

export const accountHasTransactions = async (
  accountId: number,
): Promise<boolean> => {
  const transactions = await listTransactions();
  return transactions.some((transaction) => transaction.accountId === accountId);
};

export const recipientHasTransactions = async (
  recipientId: number,
): Promise<boolean> => {
  const transactions = await listTransactions();
  return transactions.some(
    (transaction) => transaction.recipientId === recipientId,
  );
};

export const countTransactionsForRecipient = async (
  recipientId: number,
): Promise<number> => {
  const transactions = await listTransactions();
  return transactions.filter(
    (transaction) => transaction.recipientId === recipientId,
  ).length;
};

export const listTransactionsForRecipient = async (
  recipientId: number,
): Promise<Transaction[]> => {
  return db.transactions
    .where("recipientId")
    .equals(recipientId)
    .reverse()
    .sortBy("date");
};

export const getLatestTransactions = async (
  limit: number,
): Promise<Transaction[]> => {
  const transactions = await listTransactions();
  return transactions
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
};

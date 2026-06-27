import { Account, db } from "../db";

export const listAccounts = async (): Promise<Account[]> => {
  return db.accounts.toArray();
};

export const listActiveAccounts = async (): Promise<Account[]> => {
  const accounts = await listAccounts();
  return accounts.filter((account) => account.isActive !== false);
};

export const getAccountById = async (
  id: number,
): Promise<Account | undefined> => {
  return db.accounts.get(id);
};

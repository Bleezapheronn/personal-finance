import type { Transaction } from "../db";
import { resolveTransferPairEditLinks } from "./transferPairs";

export interface DuplicateTransactionPrefill {
  transactionType: "expense" | "income" | "transfer";
  amount: string;
  transactionCost: string;
  originalAmount: string;
  originalCurrency: string;
  exchangeRate: string;
  exchangeRateOverride: boolean;
  categoryId: number | undefined;
  accountId: number | undefined;
  recipientId: number | undefined;
  transferToAccountId: number | undefined;
  transferRecipientId: number | undefined;
  description: string;
}

const absoluteString = (value: number | undefined): string =>
  value ? Math.abs(value).toString() : "";

const ordinaryPrefill = (
  transaction: Transaction,
): DuplicateTransactionPrefill => ({
  transactionType: transaction.amount < 0 ? "expense" : "income",
  amount: Math.abs(transaction.amount).toString(),
  transactionCost: absoluteString(transaction.transactionCost),
  originalAmount: absoluteString(transaction.originalAmount),
  originalCurrency: transaction.originalCurrency || "",
  exchangeRate: transaction.exchangeRate?.toString() || "",
  exchangeRateOverride: !!transaction.exchangeRate,
  categoryId: transaction.categoryId,
  accountId: transaction.accountId,
  recipientId: transaction.recipientId,
  transferToAccountId: undefined,
  transferRecipientId: undefined,
  description: transaction.description || "",
});

export const buildDuplicateTransactionPrefill = (
  transaction: Transaction,
  pairedTransaction?: Transaction,
): DuplicateTransactionPrefill | undefined => {
  if (!transaction.isTransfer) {
    return ordinaryPrefill(transaction);
  }

  try {
    resolveTransferPairEditLinks(transaction, pairedTransaction);
  } catch {
    return undefined;
  }

  const outgoing =
    transaction.amount < 0 ? transaction : pairedTransaction as Transaction;
  const incoming =
    transaction.amount > 0 ? transaction : pairedTransaction as Transaction;

  return {
    transactionType: "transfer",
    amount: Math.abs(outgoing.amount).toString(),
    transactionCost: absoluteString(outgoing.transactionCost),
    originalAmount: absoluteString(outgoing.originalAmount),
    originalCurrency: outgoing.originalCurrency || "",
    exchangeRate: outgoing.exchangeRate?.toString() || "",
    exchangeRateOverride: !!outgoing.exchangeRate,
    categoryId: outgoing.categoryId,
    accountId: outgoing.accountId,
    recipientId: outgoing.recipientId,
    transferToAccountId: incoming.accountId,
    transferRecipientId: incoming.recipientId,
    description: outgoing.description || "",
  };
};

export type TransactionActionKey = "duplicate" | "edit" | "delete";

export const transactionActionKeys = (options: {
  editAvailable: boolean;
  deleteAvailable: boolean;
}): TransactionActionKey[] => [
  "duplicate",
  ...(options.editAvailable ? ["edit" as const] : []),
  ...(options.deleteAvailable ? ["delete" as const] : []),
];

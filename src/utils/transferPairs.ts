import type { Transaction } from "../db";

type TransferPairTransaction = Pick<
  Transaction,
  "id" | "amount" | "transferPairId"
>;

export interface TransferPairEditLinks {
  outgoingTransactionId: number;
  incomingTransactionId: number;
  outgoingTransferPairId: number;
  incomingTransferPairId: number;
}

const hasDefinedId = (
  transaction: TransferPairTransaction,
): transaction is TransferPairTransaction & { id: number } =>
  typeof transaction.id === "number";

export const resolveTransferPairEditLinks = (
  editingTransaction: TransferPairTransaction,
  pairedTransaction: TransferPairTransaction | undefined,
): TransferPairEditLinks => {
  if (!hasDefinedId(editingTransaction)) {
    throw new Error(
      "Transfer edit failed: the edited transaction is missing an id.",
    );
  }

  const editingTransferPairId = editingTransaction.transferPairId;
  if (typeof editingTransferPairId !== "number") {
    throw new Error(
      "Transfer edit failed: the edited transaction is missing its transfer pair link.",
    );
  }

  if (editingTransferPairId === editingTransaction.id) {
    throw new Error(
      "Transfer edit blocked: the edited transaction points to itself as its transfer pair.",
    );
  }

  if (!pairedTransaction || !hasDefinedId(pairedTransaction)) {
    throw new Error(
      "Transfer edit failed: the paired transaction could not be found.",
    );
  }

  if (pairedTransaction.id !== editingTransferPairId) {
    throw new Error(
      "Transfer edit failed: the paired transaction id does not match the saved transfer link.",
    );
  }

  const pairedTransferPairId = pairedTransaction.transferPairId;
  if (pairedTransferPairId === pairedTransaction.id) {
    throw new Error(
      "Transfer edit blocked: the paired transaction points to itself as its transfer pair.",
    );
  }

  if (pairedTransferPairId !== editingTransaction.id) {
    throw new Error(
      "Transfer edit failed: the transfer pair is not reciprocal.",
    );
  }

  const editingIsOutgoing = editingTransaction.amount < 0;
  const pairedIsOutgoing = pairedTransaction.amount < 0;

  if (editingIsOutgoing === pairedIsOutgoing) {
    throw new Error(
      "Transfer edit failed: the transfer pair must have one outgoing and one incoming transaction.",
    );
  }

  const outgoingTransactionId = editingIsOutgoing
    ? editingTransaction.id
    : pairedTransaction.id;
  const incomingTransactionId = editingIsOutgoing
    ? pairedTransaction.id
    : editingTransaction.id;

  return {
    outgoingTransactionId,
    incomingTransactionId,
    outgoingTransferPairId: incomingTransactionId,
    incomingTransferPairId: outgoingTransactionId,
  };
};

import type { Transaction } from "../db";

type TransferPairTransaction = Pick<
  Transaction,
  "id" | "amount" | "transferPairId"
>;

type TransferPairPatch = Pick<Transaction, "amount" | "transferPairId">;

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

const assertNumber = (value: number | undefined, message: string) => {
  if (typeof value !== "number") {
    throw new Error(message);
  }
};

export const assertValidTransferPairPatches = (
  outgoingId: number,
  outgoingPatch: TransferPairPatch,
  incomingId: number,
  incomingPatch: TransferPairPatch,
) => {
  assertNumber(
    outgoingPatch.transferPairId,
    "Transfer write blocked: outgoing patch is missing transferPairId.",
  );
  assertNumber(
    incomingPatch.transferPairId,
    "Transfer write blocked: incoming patch is missing transferPairId.",
  );

  if (outgoingId === outgoingPatch.transferPairId) {
    throw new Error(
      "Transfer write blocked: outgoing transaction would point to itself.",
    );
  }

  if (incomingId === incomingPatch.transferPairId) {
    throw new Error(
      "Transfer write blocked: incoming transaction would point to itself.",
    );
  }

  if (outgoingPatch.transferPairId !== incomingId) {
    throw new Error(
      "Transfer write blocked: outgoing transaction would not point to the incoming transaction.",
    );
  }

  if (incomingPatch.transferPairId !== outgoingId) {
    throw new Error(
      "Transfer write blocked: incoming transaction would not point to the outgoing transaction.",
    );
  }

  if (outgoingPatch.amount >= 0) {
    throw new Error(
      "Transfer write blocked: outgoing transaction amount must be negative.",
    );
  }

  if (incomingPatch.amount <= 0) {
    throw new Error(
      "Transfer write blocked: incoming transaction amount must be positive.",
    );
  }
};

export const assertValidTransferPairRows = (
  outgoingId: number,
  outgoingTransaction: TransferPairTransaction | undefined,
  incomingId: number,
  incomingTransaction: TransferPairTransaction | undefined,
) => {
  if (!outgoingTransaction || !incomingTransaction) {
    throw new Error(
      "Transfer write verification failed: one or both transfer rows could not be read.",
    );
  }

  if (outgoingTransaction.id !== outgoingId) {
    throw new Error(
      "Transfer write verification failed: outgoing row id does not match.",
    );
  }

  if (incomingTransaction.id !== incomingId) {
    throw new Error(
      "Transfer write verification failed: incoming row id does not match.",
    );
  }

  assertValidTransferPairPatches(
    outgoingId,
    outgoingTransaction,
    incomingId,
    incomingTransaction,
  );
};

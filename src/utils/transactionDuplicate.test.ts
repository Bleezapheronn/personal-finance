import { describe, expect, test } from "vitest";
import type { Transaction } from "../db";
import {
  buildDuplicateTransactionPrefill,
  transactionActionKeys,
} from "./transactionDuplicate";

const ordinary: Transaction = {
  id: 11,
  categoryId: 2,
  accountId: 3,
  recipientId: 4,
  date: new Date("2026-07-23T10:00:00Z"),
  amount: -25,
  transactionCost: -1,
  description: "Example",
  transferPairId: undefined,
  isTransfer: false,
  budgetId: 8,
  occurrenceDate: new Date("2026-07-01"),
  budgetSnapshotId: 9,
};

describe("transaction duplication", () => {
  test("copies intended ordinary fields and excludes identifiers and linkage", () => {
    expect(buildDuplicateTransactionPrefill(ordinary)).toEqual({
      transactionType: "expense",
      amount: "25",
      transactionCost: "1",
      originalAmount: "",
      originalCurrency: "",
      exchangeRate: "",
      exchangeRateOverride: false,
      categoryId: 2,
      accountId: 3,
      recipientId: 4,
      transferToAccountId: undefined,
      transferRecipientId: undefined,
      description: "Example",
    });
  });

  test("builds a transfer prefill only for a reciprocal safe pair", () => {
    const outgoing = {
      ...ordinary,
      id: 20,
      amount: -40,
      transferPairId: 21,
      isTransfer: true,
    };
    const incoming = {
      ...ordinary,
      id: 21,
      amount: 40,
      accountId: 6,
      recipientId: 7,
      transferPairId: 20,
      isTransfer: true,
    };

    expect(buildDuplicateTransactionPrefill(outgoing, incoming)).toMatchObject({
      transactionType: "transfer",
      amount: "40",
      accountId: 3,
      transferToAccountId: 6,
      transferRecipientId: 7,
    });
    expect(
      buildDuplicateTransactionPrefill(outgoing, {
        ...incoming,
        transferPairId: 999,
      }),
    ).toBeUndefined();
  });

  test("keeps action order stable as optional actions disappear", () => {
    expect(
      transactionActionKeys({ editAvailable: true, deleteAvailable: true }),
    ).toEqual(["duplicate", "edit", "delete"]);
    expect(
      transactionActionKeys({ editAvailable: false, deleteAvailable: true }),
    ).toEqual(["duplicate", "delete"]);
    expect(
      transactionActionKeys({ editAvailable: true, deleteAvailable: false }),
    ).toEqual(["duplicate", "edit"]);
    expect(
      transactionActionKeys({ editAvailable: false, deleteAvailable: false }),
    ).toEqual(["duplicate"]);
  });
});

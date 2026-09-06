import { describe, expect, test } from "vitest";
import type { Category, Recipient, Transaction } from "../db";
import {
  buildRecipientFilterOptions,
  buildRecipientTransactionCounts,
  buildTransactionDateDisplays,
  buildTransactionFilterIndex,
} from "./transactionDerivedData";

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 1,
  categoryId: 10,
  accountId: 20,
  recipientId: 30,
  date: new Date("2026-09-06T00:30:00.000Z"),
  amount: -10,
  ...overrides,
});

const category = (overrides: Partial<Category> = {}): Category => ({
  id: 10,
  name: "Category",
  bucketId: 40,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const recipient = (id: number, name: string): Recipient => ({
  id,
  name,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("Transaction derived data", () => {
  test("builds filter membership once from loaded transactions", () => {
    const index = buildTransactionFilterIndex(
      [transaction(), transaction({ id: 2, accountId: 21, recipientId: 31, categoryId: 11 })],
      [category(), category({ id: 11, bucketId: 41 })],
    );

    expect([...index.accountIds]).toEqual([20, 21]);
    expect([...index.bucketIds]).toEqual([40, 41]);
    expect([...index.categoryIds]).toEqual([10, 11]);
    expect([...index.recipientIds]).toEqual([30, 31]);
  });

  test("keeps recipient membership while ranking from filtered counts", () => {
    const recipients = [recipient(30, "First tie"), recipient(31, "Most"), recipient(32, "Second tie"), recipient(33, "Absent")];
    const membership = new Set([30, 31, 32]);
    const counts = buildRecipientTransactionCounts([
      transaction({ recipientId: 30 }),
      transaction({ id: 2, recipientId: 31 }),
      transaction({ id: 3, recipientId: 31 }),
      transaction({ id: 4, recipientId: 32 }),
    ]);

    expect(buildRecipientFilterOptions(recipients, membership, counts)).toEqual([
      { id: 31, name: "Most" },
      { id: 30, name: "First tie" },
      { id: 32, name: "Second tie" },
    ]);
  });

  test("matches the existing row date and time formatter semantics", () => {
    const row = transaction({ date: new Date("2026-09-06T23:30:00.000Z") });
    const timeZone = "America/Los_Angeles";
    const display = buildTransactionDateDisplays([row], undefined, timeZone).get(row)!;
    const date = new Date(row.date);

    expect(display).toEqual({
      weekday: date
        .toLocaleDateString("en-US", { weekday: "short", timeZone })
        .toUpperCase(),
      day: date.toLocaleDateString("en-US", { day: "2-digit", timeZone }),
      month: date
        .toLocaleDateString("en-US", { month: "short", timeZone })
        .toUpperCase(),
      time: date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      }),
    });
  });
});

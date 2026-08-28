import { describe, expect, test } from "vitest";
import type { Budget, BudgetSnapshot } from "../db";
import { selectBudgetOccurrences } from "./budgetOccurrenceSelector";

const date = (value: string) => new Date(`${value}T00:00:00`);
const baseBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 1,
  description: "Recurring expense",
  categoryId: 1,
  accountId: 1,
  recipientId: 1,
  amount: -100,
  frequency: "weekly",
  isGoal: false,
  isFlexible: false,
  isActive: true,
  remainingCyclesTotal: null,
  dueDate: date("2026-08-01"),
  projectionStartsOn: date("2026-08-01"),
  createdAt: date("2026-07-01"),
  updatedAt: date("2026-07-01"),
  ...overrides,
});

const snapshot = (overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot => ({
  id: 9,
  budgetId: 1,
  occurrenceDate: date("2026-08-08"),
  dueDate: date("2026-08-08"),
  cycleIndex: 2,
  description: "Frozen expense",
  categoryId: 1,
  accountId: 1,
  recipientId: 1,
  amount: -90,
  frequency: "weekly",
  isGoal: false,
  isFlexible: false,
  isHistorical: true,
  sourceBudgetUpdatedAt: date("2026-08-08"),
  createdAt: date("2026-08-08"),
  updatedAt: date("2026-08-08"),
  ...overrides,
});

describe("Budget occurrence selector", () => {
  test("retains a frozen snapshot and derives missing overdue dates", () => {
    const rows = selectBudgetOccurrences({
      budgets: [baseBudget()],
      snapshots: [snapshot()],
      through: date("2026-08-22"),
    });

    expect(rows.map((row) => [row.dueDate.getDate(), row.source])).toEqual([
      [22, "projected"],
      [15, "projected"],
      [8, "snapshot"],
      [1, "projected"],
    ]);
    expect(rows.find((row) => row.source === "snapshot")?.budget.description).toBe(
      "Frozen expense",
    );
  });

  test("does not project before activation, after a finite schedule, or for inactive definitions", () => {
    const rows = selectBudgetOccurrences({
      budgets: [
        baseBudget({ projectionStartsOn: date("2026-08-08"), remainingCyclesTotal: 3 }),
        baseBudget({ id: 2, isActive: false, dueDate: date("2026-08-01") }),
      ],
      snapshots: [snapshot({ budgetId: 2 })],
      through: date("2026-08-29"),
    });

    expect(rows.map((row) => [row.budgetId, row.dueDate.getDate(), row.source])).toEqual([
      [1, 15, "projected"],
      [2, 8, "snapshot"],
      [1, 8, "projected"],
    ]);
  });

  test("limits historical history to pre-today dates while retaining snapshot authority", () => {
    const rows = selectBudgetOccurrences({
      budgets: [baseBudget({ isFlexible: true })],
      snapshots: [snapshot()],
      through: date("2026-08-20"),
      historicalOnly: true,
    });

    expect(rows.map((row) => [row.dueDate.getDate(), row.source])).toEqual([
      [15, "projected"],
      [8, "snapshot"],
      [1, "projected"],
    ]);
  });
});

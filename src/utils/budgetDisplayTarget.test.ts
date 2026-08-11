import { describe, expect, it } from "vitest";
import { definitionDisplayTarget, occurrenceDisplayTarget } from "./budgetDisplayTarget";

const base = { amount: -100, transactionCost: -10, goalPercentage: 10 };

describe("Budget display target", () => {
it("uses occurrence-year income while percentage occurrence is prospective", () => {
  expect(occurrenceDisplayTarget({ ...base, dueDate: new Date("2027-12-31T00:00:00") }, 4_000, new Date("2027-06-01T00:00:00"))).toBe(400);
  expect(definitionDisplayTarget(base, 4_000)).toBe(400);
});

it("never recomputes a frozen percentage occurrence from current income", () => {
  expect(occurrenceDisplayTarget({ ...base, dueDate: new Date("2026-12-31T00:00:00"), resolvedTarget: 250 }, 9_000, new Date("2027-01-01T00:00:00"))).toBe(250);
  expect(occurrenceDisplayTarget({ ...base, dueDate: new Date("2026-12-31T00:00:00") }, 9_000, new Date("2027-01-01T00:00:00"))).toBeNull();
});
});

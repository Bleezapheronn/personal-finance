import {
  budgetActiveStateForEdit,
  budgetActiveStateForSubmission,
  shouldShowBudgetLifecycleActiveControl,
} from "./budgetLifecycleForm";

describe("SQLite Budget lifecycle active-state form", () => {
  test("defaults new lifecycle Budgets to active", () => {
    expect(budgetActiveStateForSubmission(true, true)).toBe(true);
  });

  test("submits an explicitly inactive lifecycle Budget", () => {
    expect(budgetActiveStateForSubmission(true, false)).toBe(false);
  });

  test("preserves the stored active state during edit", () => {
    expect(budgetActiveStateForEdit(true)).toBe(true);
    expect(budgetActiveStateForEdit(false)).toBe(false);
  });

  test("does not alter the existing Dexie submission behavior", () => {
    expect(budgetActiveStateForSubmission(false, false)).toBe(true);
    expect(shouldShowBudgetLifecycleActiveControl(false)).toBe(false);
  });

  test("shows the control only for the SQLite lifecycle path", () => {
    expect(shouldShowBudgetLifecycleActiveControl(true)).toBe(true);
  });
});

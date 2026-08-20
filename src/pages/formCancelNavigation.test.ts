import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("form Cancel navigation", () => {
  const transactionForm = source("src/pages/AddTransaction.tsx");
  const budgetForm = source("src/pages/AddBudget.tsx");

  it("returns both add and edit Transaction forms to Transactions without submitting", () => {
    expect(transactionForm).toContain('history.push("/transactions")');
    expect(transactionForm).toContain('type="button" fill="outline" onClick={handleCancel}');
    expect(transactionForm).toContain('type="submit"');
  });

  it("returns add and edit Budget forms to Budget without submitting", () => {
    expect(budgetForm).toContain('history.push("/budget")');
    expect(budgetForm).toContain('type="button" fill="outline" onClick={handleCancel}');
    expect(budgetForm).toContain('type="submit"');
  });
});

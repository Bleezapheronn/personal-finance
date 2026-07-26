import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${name}.tsx`), "utf8");

describe("description autocomplete surfaces", () => {
  it.each(["Transactions", "BudgetHistory"]) (
    "renders fuzzy filter suggestions on %s",
    (name) => {
      const source = page(name);
      expect(source).toContain("visibleDescriptionSuggestions");
      expect(source).toContain("description-suggestion-list");
      expect(source).toContain("listDescriptionSuggestions(100)");
    },
  );

  it("keeps Add Budget authoritative suggestions and selection", () => {
    const source = page("AddBudget");
    expect(source).toContain("repositories.transactions.listDescriptionSuggestions(100)");
    expect(source).toContain("selectSuggestion");
    expect(source).toContain("visibleDescriptionSuggestions");
  });

  it.each(["AddTransaction", "AddBudget", "Transactions", "BudgetHistory"])(
    "raises the open description wrapper and uses the shared menu on %s",
    (name) => {
      const source = page(name);
      expect(source).toContain("autocomplete-open");
      expect(source).toContain('className="description-suggestion-list"');
    },
  );
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFor = (page: string): string =>
  readFileSync(resolve(process.cwd(), `src/pages/${page}.tsx`), "utf8");

describe("recipient lookup pagination", () => {
  it("loads every recipient for the goal carousel and retains a missing goal recipient by id", () => {
    const source = sourceFor("Budget");

    expect(source).toMatch(
      /loadAllPages<unknown>\(repositories\.recipients\.list\)/,
    );
    expect(source).toContain("appendMissingRowsById(");
    expect(source).toContain("goalRecipientIds");
    expect(source).toContain("recipientTruncated: false");
  });

  it("does not leave the same capped recipient lookup in Budget History", () => {
    const source = sourceFor("BudgetHistory");

    expect(source).toMatch(
      /loadAllPages<unknown>\(repositories\.recipients\.list\)/,
    );
    expect(source).not.toMatch(
      /loadPagedRows<unknown>\(\s*repositories\.recipients\.list/,
    );
  });
});

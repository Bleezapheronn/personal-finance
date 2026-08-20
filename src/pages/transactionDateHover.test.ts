import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Transaction date-block time hover", () => {
  const page = source("src/pages/Transactions.tsx");
  const styles = source("src/pages/Transactions.css");

  it("keeps the time affordance scoped to the date block", () => {
    expect(page).toContain('className="transaction-date-block"');
    expect(page).toContain('className="transaction-date-time"');
    expect(page).toContain('tabIndex={0}');
    expect(page).toContain("Transaction time:");
  });

  it("reveals the label only when its date block is hovered or focused", () => {
    expect(page).toContain('className="transaction-row"');
    expect(page).toContain('className="transaction-list"');
    expect(styles).toContain(".transaction-row {\n  overflow: visible;");
    expect(styles).toContain(".transaction-list {\n  contain: layout style;");
    expect(styles).toContain(
      ".transaction-row:has(.transaction-date-block:hover)",
    );
    expect(styles).toContain(
      ".transaction-date-block:hover .transaction-date-time",
    );
    expect(styles).toContain(
      ".transaction-date-block:focus-visible .transaction-date-time",
    );
    expect(styles).toContain("pointer-events: none;");
    expect(styles).toContain("background: #3a3a3a;");
    expect(styles).toContain("color: #d6d6d6;");
  });
});

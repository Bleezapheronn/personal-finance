import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("SQLite main-app workflow parity cleanup", () => {
  it("keeps transaction title navigation available to every selected backend", () => {
    const transactions = source("src/pages/Transactions.tsx");
    expect(transactions).toContain("history.push(`/transaction-details/${id}`)");
    expect(transactions).not.toContain(
      "Transactions HTTP experiment is active. This action remains available only in Dexie.",
    );
  });

  it("keeps Budget History occurrence completion contextual", () => {
    const budgetHistory = source("src/pages/BudgetHistory.tsx");
    expect(budgetHistory).toContain("handleCompleteOccurrenceInSqlite");
    expect(budgetHistory).toContain("onCompleteInSqlite");
    expect(budgetHistory).not.toContain("Create occurrence");
    expect(budgetHistory).not.toContain("placeholder=\"Budget ID\"");
  });

  it("keeps authoritative Budget occurrences clickable with isolated controls", () => {
    const budget = source("src/pages/Budget.tsx");
    expect(budget).toContain("handleCompleteOccurrenceInSqlite");
    expect(budget).toContain("onCompleteInSqlite");
    expect(budget).toContain("cursor: \"pointer\"");
    expect(budget).not.toContain("if (budgetHttpReadonlyExperimentActive) {\n                              return;");
    expect(budget).toContain("e.stopPropagation();");
  });

  it("does not expose snapshot selection in Add Transaction", () => {
    const addTransaction = source("src/pages/AddTransaction.tsx");
    expect(addTransaction).not.toContain("Existing Budget Snapshot (optional)");
    expect(addTransaction).not.toContain("Existing snapshots only.");
    expect(addTransaction).toContain("Manage\n                        the link from Transaction Details.");
  });

  it("opens a browser only when the launcher is explicitly asked", () => {
    const launcher = source("scripts/Start-PersonalFinance.ps1");
    expect(launcher).toContain("[switch]$OpenBrowser");
    expect(launcher).toContain("[string]$BrowserPath");
    expect(launcher).toContain("if ($OpenBrowser) {");
    expect(launcher).toContain("Start-Process -FilePath $BrowserPath -ArgumentList $viteUrl");
  });
});

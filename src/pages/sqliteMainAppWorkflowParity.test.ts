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

  it("routes linked-payment removal through the shared SQLite unlink path", () => {
    const modal = source("src/components/CompleteBudgetModal.tsx");
    const budget = source("src/pages/Budget.tsx");
    const history = source("src/pages/BudgetHistory.tsx");
    expect(modal).toContain("onUnlinkInSqlite");
    expect(modal).toContain("budgetSnapshotId: undefined");
    expect(modal).toContain("budgetId: undefined");
    expect(modal).toContain("occurrenceDate: undefined");
    expect(budget).toContain('dryRunBudgetSnapshotOccurrence("unlink"');
    expect(history).toContain('dryRunBudgetSnapshotOccurrence("unlink"');
  });

  it("uses the originating transaction date as the first Budget occurrence", () => {
    const addBudget = source("src/pages/AddBudget.tsx");
    expect(addBudget).toContain("First occurrence date");
    expect(addBudget).toContain("transactionLocalDate.getFullYear()");
    expect(addBudget).not.toContain("setDueDate(nextMonthDate)");
  });

  it("does not write when authoritative Budget Load More extends the horizon", () => {
    const budget = source("src/pages/Budget.tsx");
    expect(budget).toContain("setVisibleBudgetHorizonDays(nextHorizon)");
    expect(budget).toContain("Load 30 More Days");
    expect(budget).not.toContain(
      "Load more budget items is disabled in the read-only Budget experiment.",
    );
    expect(budget).not.toContain("ensureBudgetSnapshotCoverage(budget, horizonDate)");
    expect(budget).not.toContain(
      "Budget read experiment is read-only. Load more budget items is disabled.",
    );
  });

  it("keeps Budget reads free of snapshot generation and makes History occurrence-only", () => {
    const budget = source("src/pages/Budget.tsx");
    const history = source("src/pages/BudgetHistory.tsx");
    expect(budget).not.toContain("migrateBudgetSnapshots()");
    expect(history).not.toContain("migrateBudgetSnapshots()");
    expect(history).not.toContain("handleToggleBudgetActive");
    expect(history).toContain("occurrenceStateSupported");
  });

  it("uses a snapshot linkage index instead of scanning all Transactions per occurrence", () => {
    const budget = source("src/pages/Budget.tsx");
    const history = source("src/pages/BudgetHistory.tsx");
    expect(budget).toContain("transactionsBySnapshotId");
    expect(history).toContain("transactionsBySnapshotId");
    expect(budget).toContain("transactionsBySnapshotId.get(numericSnapshotId)");
    expect(history).toContain("transactionsBySnapshotId.get(Number(snapshotId))");
  });

  it("initializes Add Payment once per open occurrence", () => {
    const modal = source("src/components/CompleteBudgetModal.tsx");
    const budget = source("src/pages/Budget.tsx");
    const history = source("src/pages/BudgetHistory.tsx");
    expect(modal).toContain("initializedOccurrenceRef");
    expect(modal).toContain("if (initializedOccurrenceRef.current === occurrenceKey) return;");
    expect(modal).toContain("so lookup renders cannot overwrite values the user can see");
    expect(budget).toContain("<CompleteBudgetModal");
    expect(history).toContain("<CompleteBudgetModal");
  });

  it("does not expose snapshot selection in Add Transaction", () => {
    const addTransaction = source("src/pages/AddTransaction.tsx");
    expect(addTransaction).not.toContain("Existing Budget Snapshot (optional)");
    expect(addTransaction).not.toContain("Existing snapshots only.");
    expect(addTransaction).toContain("Manage\n                        the link from Transaction Details.");
  });

  it("opens a browser only when the launcher is explicitly asked", () => {
    const launcher = source("scripts/Start-PersonalFinance.ps1");
    expect(launcher).not.toContain("OpenBrowser");
    expect(launcher).not.toContain("BrowserPath");
  });
});

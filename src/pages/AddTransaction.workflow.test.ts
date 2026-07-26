import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/pages/AddTransaction.tsx"), "utf8");

describe("authoritative transaction entry workflow", () => {
  it("uses user-facing authority-neutral success messages and keeps edit routes open", () => {
    expect(source).not.toContain("Disposable SQLite transfer pair updated.");
    expect(source).not.toContain("Disposable SQLite transaction updated.");
    expect(source).toContain('"Transfer updated."');
    expect(source).toContain('"Transaction updated."');
    expect(source).toContain("const resetAddForm = () =>");
    expect(source).toContain("getDescriptionPrefill");
    expect(source).toContain("if (!isEditMode)");
  });

  it("refreshes selected values without issuing a second write", () => {
    expect(source).toContain("transaction_write_refresh_failed");
    expect(source).toContain("setEditingTransaction(confirmed)");
    expect(source).not.toContain("updateBasicTransactionInDisposableSqlite(refreshed");
  });

  it("keeps the shared suggestion workflow on transaction entry", () => {
    expect(source).toContain("visibleDescriptionSuggestions");
    expect(source).toContain("selectSuggestion");
    expect(source).toContain("getDescriptionPrefill");
  });
});

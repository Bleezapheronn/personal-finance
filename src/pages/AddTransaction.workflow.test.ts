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

  it("keeps exchange-rate persistence unchanged while exposing derived/manual controls", () => {
    expect(source).toContain("exchangeRate: numericExchangeRate");
    expect(source).toContain('useState<ExchangeRateMode>("derived")');
    expect(source).toContain('aria-label="Recalculate exchange rate"');
  });

  it("resolves only safe Transaction Amount expressions before existing save paths", () => {
    expect(source).toContain('type="text"');
    expect(source).toContain("resolvedTransactionAmount(amount)");
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("validateTransactionAmountInput(amount)");
  });

  it("uses the current Ionic input value for the first blur or Enter, not stale Amount state", () => {
    expect(source).toContain('onIonInput={(e) => {\n                      setAmount(e.detail.value ?? "");');
    expect(source).toContain("onIonBlur={(event) =>\n                      resolveAmountExpression(");
    expect(source).toContain("(event.target as HTMLIonInputElement).value ?? amount");
    expect(source).toContain("(event.target as HTMLInputElement).value");
  });
});

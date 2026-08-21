import { describe, expect, it } from "vitest";
import {
  deriveExchangeRate,
  derivedExchangeRateState,
  exchangeRateModeForStoredRate,
  exchangeRateStateForInput,
} from "./transactionExchangeRate";

describe("transaction exchange-rate state", () => {
  it("derives and rounds the absolute amount ratio", () => {
    expect(deriveExchangeRate("100", "3")).toBe("33.3333");
    expect(deriveExchangeRate("-120", "20")).toBe("6.0000");
  });

  it("clears instead of retaining a stale derived value for empty, invalid, or zero source values", () => {
    for (const [amount, originalAmount] of [
      ["", "20"],
      ["100", ""],
      ["invalid", "20"],
      ["100", "invalid"],
      ["0", "20"],
      ["100", "0"],
    ]) {
      expect(deriveExchangeRate(amount, originalAmount)).toBe("");
    }
  });

  it("preserves every stored rate, including zero, as manual because provenance is unavailable", () => {
    expect(exchangeRateModeForStoredRate(undefined)).toBe("derived");
    expect(exchangeRateModeForStoredRate(null)).toBe("derived");
    expect(exchangeRateModeForStoredRate(0)).toBe("manual");
    expect(exchangeRateModeForStoredRate(1.25)).toBe("manual");
  });

  it("preserves user-entered rates and returns cleared or refreshed rates to derived mode", () => {
    expect(exchangeRateStateForInput("7.5", "120", "20")).toEqual({
      mode: "manual",
      value: "7.5",
    });
    expect(exchangeRateStateForInput("", "120", "20")).toEqual({
      mode: "derived",
      value: "6.0000",
    });
    expect(derivedExchangeRateState("120", "0")).toEqual({
      mode: "derived",
      value: "",
    });
  });
});

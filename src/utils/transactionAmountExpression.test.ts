import { describe, expect, it } from "vitest";
import {
  parseTransactionAmountExpression,
  resolvedExpressionDisplayValue,
  resolvedTransactionAmount,
  validateTransactionAmountInput,
} from "./transactionAmountExpression";

describe("Transaction Amount expressions", () => {
  it("evaluates decimal addition and subtraction left to right", () => {
    expect(resolvedTransactionAmount("100 + 50 - 25.5")).toBe(124.5);
    expect(resolvedTransactionAmount("3000-270+5")).toBe(2735);
    expect(resolvedTransactionAmount(".5 + .25")).toBe(0.75);
  });

  it("only replaces complete valid expressions with their ordinary numeric value", () => {
    expect(resolvedExpressionDisplayValue("100 + 50")).toBe("150");
    expect(resolvedExpressionDisplayValue("100")).toBeUndefined();
    expect(resolvedExpressionDisplayValue("100+")).toBeUndefined();
    expect(resolvedExpressionDisplayValue("100-150")).toBeUndefined();
  });

  it("rejects incomplete, unsupported, and unsafe syntax", () => {
    for (const input of ["", "100+", "100--50", "-100", "100*2", "100/2", "(100+50)", "100abc"]) {
      expect(validateTransactionAmountInput(input).isValid).toBe(false);
    }
    expect(parseTransactionAmountExpression("100+").kind).toBe("incomplete");
  });

  it("retains current positive and maximum Amount semantics", () => {
    expect(validateTransactionAmountInput("0").errorMessage).toBe(
      "Amount must be greater than 0.",
    );
    expect(validateTransactionAmountInput("100-150").isValid).toBe(false);
    expect(validateTransactionAmountInput("999999999.99").isValid).toBe(true);
    expect(validateTransactionAmountInput("1000000000").errorMessage).toBe(
      "Amount is too large.",
    );
  });
});

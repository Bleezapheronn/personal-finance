import { describe, expect, it } from "vitest";
import {
  normalizeRecipientName,
  recipientNameMatchKey,
} from "../../server/shared/recipientName.js";

describe("Recipient name normalization", () => {
  it("trims edges and collapses internal whitespace runs", () => {
    expect(normalizeRecipientName("  EVANS\t \nONG'ENI\u00a0 ")).toBe(
      "EVANS ONG'ENI",
    );
  });

  it("preserves capitalization, apostrophes, hyphens, and punctuation", () => {
    expect(normalizeRecipientName("  Mary-Jane  O'Neil, Jr.  ")).toBe(
      "Mary-Jane O'Neil, Jr.",
    );
  });

  it("uses the same whitespace and case semantics for matching", () => {
    expect(recipientNameMatchKey(" EVANS  ONG'ENI ")).toBe(
      recipientNameMatchKey("evans ong'eni"),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  shouldInitializeOccurrencePaymentForm,
  unpaidOccurrenceTargetAmount,
} from "./budgetPaymentPrefill";

describe("Budget payment prefill", () => {
  it("uses the unpaid portion of a percentage target after linked progress", () => {
    expect(unpaidOccurrenceTargetAmount(133_965.48, 128_023.6)).toBeCloseTo(
      5_941.88,
    );
  });

  it("uses the unpaid portion of a fixed target after linked progress", () => {
    expect(unpaidOccurrenceTargetAmount(1_000, -400)).toBe(600);
  });

  it("never suggests a positive payment for fully funded or overfunded occurrences", () => {
    expect(unpaidOccurrenceTargetAmount(1_000, -1_000)).toBe(0);
    expect(unpaidOccurrenceTargetAmount(1_000, -1_250)).toBe(0);
  });

  it("waits for the active occurrence lookup data and preserves user edits", () => {
    const occurrenceKey = "42:1767139200000";

    expect(
      shouldInitializeOccurrencePaymentForm({
        occurrenceKey,
        lookupDataOccurrenceKey: null,
        initializedOccurrenceKey: null,
        userEditedOccurrenceKey: null,
      }),
    ).toBe(false);
    expect(
      shouldInitializeOccurrencePaymentForm({
        occurrenceKey,
        lookupDataOccurrenceKey: occurrenceKey,
        initializedOccurrenceKey: null,
        userEditedOccurrenceKey: null,
      }),
    ).toBe(true);
    expect(
      shouldInitializeOccurrencePaymentForm({
        occurrenceKey,
        lookupDataOccurrenceKey: occurrenceKey,
        initializedOccurrenceKey: null,
        userEditedOccurrenceKey: occurrenceKey,
      }),
    ).toBe(false);
  });
});

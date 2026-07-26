import { describe, expect, it } from "vitest";
import {
  fuzzyMatchDescription,
  visibleDescriptionSuggestions,
} from "./descriptionAutocomplete";

describe("description autocomplete", () => {
  it("matches ordered characters case-insensitively and rejects empty/nonmatches", () => {
    expect(fuzzyMatchDescription("zd", "ZiiDi - M-Pesa Transfer")).toBe(true);
    expect(fuzzyMatchDescription("mptr", "ZiiDi - M-Pesa Transfer")).toBe(true);
    expect(fuzzyMatchDescription("rent", "Monthly Rent")).toBe(true);
    expect(fuzzyMatchDescription("", "Monthly Rent")).toBe(false);
    expect(fuzzyMatchDescription("rz", "Monthly Rent")).toBe(false);
  });

  it("ranks by count, then recency, then stable text and limits to five", () => {
    const suggestions = Array.from({ length: 7 }, (_, index) => ({
      text: `Rent ${index}`,
      count: index === 0 ? 10 : 1,
      latest: index === 1 ? "2026-07-02" : "2026-07-01",
    }));
    expect(visibleDescriptionSuggestions("r", suggestions)).toHaveLength(5);
    expect(visibleDescriptionSuggestions("r", suggestions)[0].text).toBe("Rent 0");
    expect(visibleDescriptionSuggestions("r", suggestions)[1].text).toBe("Rent 1");
  });
});

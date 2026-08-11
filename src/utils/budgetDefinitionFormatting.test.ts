import { describe, expect, it } from "vitest";
import { formatBudgetDefinitionOrdinal } from "./budgetDefinitionFormatting";

describe("formatBudgetDefinitionOrdinal", () => {
  it("formats general monthly ordinals including teen exceptions", () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22, 23, 27, 31].map(formatBudgetDefinitionOrdinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "8th", "11th", "12th", "13th",
      "21st", "22nd", "23rd", "27th", "31st",
    ]);
  });
});

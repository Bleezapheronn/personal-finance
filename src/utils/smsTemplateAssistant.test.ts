import { describe, expect, it } from "vitest";
import {
  flexibleLiteralPattern,
  smsTemplateSelection,
  suggestSmsTemplatePattern,
} from "./smsTemplateAssistant";

describe("SMS template pattern assistant", () => {
  it("escapes literal syntax and makes whitespace flexible", () => {
    expect(flexibleLiteralPattern("paid (via)  Ksh.")).toBe(
      "paid\\s+\\(via\\)\\s+Ksh\\.",
    );
  });

  it("captures the selected text with editable nearby anchors", () => {
    const sample = "Confirmed payment of Ksh1,250.00 sent today";
    const start = sample.indexOf("1,250.00");
    const selection = smsTemplateSelection(sample, start, start + 8);

    expect(selection.text).toBe("1,250.00");
    expect(selection.beforeAnchor).toBe("payment of Ksh");
    expect(selection.afterAnchor).toBe("sent today");
  });

  it("generates a bounded amount pattern", () => {
    const result = suggestSmsTemplatePattern({
      field: "amountPattern",
      selectedText: "1,250.00",
      beforeAnchor: "Ksh",
      afterAnchor: "sent to",
    });

    expect(result).toEqual({
      ok: true,
      pattern:
        "Ksh\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*sent\\s+to",
    });
  });

  it("requires a trailing anchor for a free-text recipient name", () => {
    const result = suggestSmsTemplatePattern({
      field: "recipientNamePattern",
      selectedText: "JANE DOE",
      beforeAnchor: "sent to",
      afterAnchor: "",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/require stable text after/i);
  });

  it("creates indicator patterns without capture groups", () => {
    expect(
      suggestSmsTemplatePattern({
        field: "incomePattern",
        selectedText: "You have received",
        beforeAnchor: "",
        afterAnchor: "",
      }),
    ).toEqual({ ok: true, pattern: "You\\s+have\\s+received" });
  });

  it("generates only the two existing date/time capture shapes", () => {
    const dayFirst = suggestSmsTemplatePattern({
      field: "dateTimePattern",
      selectedText: "20/08/26 at 6:48 PM",
      beforeAnchor: "on",
      afterAnchor: ".",
    });
    const yearFirst = suggestSmsTemplatePattern({
      field: "dateTimePattern",
      selectedText: "2026-08-20 18:48:33",
      beforeAnchor: "on",
      afterAnchor: "",
    });
    const unsupported = suggestSmsTemplatePattern({
      field: "dateTimePattern",
      selectedText: "August 20, 2026 at 6:48 PM",
      beforeAnchor: "on",
      afterAnchor: "",
    });

    expect(dayFirst.ok).toBe(true);
    expect(yearFirst.ok).toBe(true);
    expect(unsupported).toMatchObject({ ok: false });
  });

  it("refuses unsupported or unanchored extraction guesses", () => {
    expect(
      suggestSmsTemplatePattern({
        field: "referencePattern",
        selectedText: "AB-12",
        beforeAnchor: "Ref",
        afterAnchor: "",
      }).ok,
    ).toBe(false);
    expect(
      suggestSmsTemplatePattern({
        field: "amountPattern",
        selectedText: "10",
        beforeAnchor: "",
        afterAnchor: "",
      }).ok,
    ).toBe(false);
  });
});

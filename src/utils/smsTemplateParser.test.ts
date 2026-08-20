import { describe, expect, it } from "vitest";
import type { SmsImportTemplate } from "../db";
import { evaluateSmsTemplate } from "./smsTemplateParser";

const template = (
  overrides: Partial<SmsImportTemplate> = {},
): SmsImportTemplate => ({
  id: 7,
  name: "Synthetic provider template",
  referencePattern: "^([A-Z0-9]+)\\s+Confirmed",
  amountPattern: "Ksh([\\d,]+(?:\\.\\d{1,2})?)\\s+sent",
  recipientNamePattern: "sent to\\s+([A-Z\\s]+?)\\s+\\d",
  recipientPhonePattern: "([0-9]{10})",
  dateTimePattern:
    "on\\s+(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2})\\s+at\\s+(\\d{1,2}):(\\d{2})\\s+([AP]M)",
  costPattern: "Transaction cost,\\s*Ksh([\\d,]+(?:\\.\\d{1,2})?)",
  expensePattern: "sent to",
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("SMS template evaluator", () => {
  it("preserves current extraction and normalization semantics", () => {
    const result = evaluateSmsTemplate(
      "AB12CD34 Confirmed. Ksh1,234.50 sent to JANE DOE 0712345678 on 20/08/26 at 6:48 PM. Transaction cost, Ksh10.00",
      template(),
    );

    expect(result.parsed).toEqual({
      reference: "AB12CD34",
      amount: "1234.50",
      recipientName: "Jane Doe",
      recipientPhone: "0712345678",
      date: "08-20-2026",
      time: "18:48",
      cost: "10.00",
      isIncome: false,
      templateId: 7,
    });
    expect(result.diagnostics.amountPattern.status).toBe("matched");
    expect(result.diagnostics.amountPattern.extractedValue).toBe("1,234.50");
  });

  it("reports blank, invalid, missing-capture, and no-match patterns separately", () => {
    const result = evaluateSmsTemplate(
      "paid Ksh10",
      template({
        referencePattern: "",
        amountPattern: "Ksh",
        recipientNamePattern: "(",
        recipientPhonePattern: "phone\\s+(\\d+)",
        dateTimePattern: "",
        costPattern: "",
        expensePattern: "paid",
      }),
    );

    expect(result.diagnostics.referencePattern.status).toBe("not-configured");
    expect(result.diagnostics.amountPattern.status).toBe(
      "matched-without-capture",
    );
    expect(result.diagnostics.recipientNamePattern.status).toBe("invalid");
    expect(result.diagnostics.recipientPhonePattern.status).toBe("no-match");
    expect(result.parsed).toMatchObject({ isIncome: false });
  });

  it("shows multiple matches while preserving the first extracted value", () => {
    const result = evaluateSmsTemplate(
      "paid Ksh10 and fee Ksh2",
      template({
        referencePattern: "",
        amountPattern: "Ksh([\\d,]+)",
        recipientNamePattern: "",
        recipientPhonePattern: "",
        dateTimePattern: "",
        costPattern: "",
        expensePattern: "paid",
      }),
    );

    expect(result.diagnostics.amountPattern.status).toBe("ambiguous");
    expect(result.diagnostics.amountPattern.matchCount).toBe(2);
    expect(result.parsed?.amount).toBe("10");
  });

  it("reports conflicting type indicators but preserves income precedence", () => {
    const result = evaluateSmsTemplate(
      "confirmed Ksh10",
      template({
        referencePattern: "",
        amountPattern: "Ksh([\\d,]+)",
        recipientNamePattern: "",
        recipientPhonePattern: "",
        dateTimePattern: "",
        costPattern: "",
        incomePattern: "confirmed",
        expensePattern: "confirmed",
      }),
    );

    expect(result.parsed?.isIncome).toBe(true);
    expect(result.warnings).toContain(
      "Both income and expense patterns match; the current parser uses income.",
    );
  });

  it("supports the current year-first 24-hour six-capture date form", () => {
    const result = evaluateSmsTemplate(
      "received Ksh10 on 2026-08-20 18:48:33",
      template({
        referencePattern: "",
        amountPattern: "Ksh([\\d,]+)",
        recipientNamePattern: "",
        recipientPhonePattern: "",
        dateTimePattern:
          "on\\s+(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(\\d{1,2}):(\\d{2}):(\\d{2})",
        costPattern: "",
        incomePattern: "received",
        expensePattern: "",
      }),
    );

    expect(result.parsed).toMatchObject({ date: "08-20-2026", time: "18:48" });
  });

  it("preserves fatal invalid type and date/time pattern behavior", () => {
    const invalidType = evaluateSmsTemplate(
      "received Ksh10",
      template({ amountPattern: "Ksh([\\d,]+)", incomePattern: "(" }),
    );
    const invalidDate = evaluateSmsTemplate(
      "received Ksh10",
      template({ amountPattern: "Ksh([\\d,]+)", dateTimePattern: "(" }),
    );

    expect(invalidType.parsed).toBeNull();
    expect(invalidDate.parsed).toBeNull();
  });
});

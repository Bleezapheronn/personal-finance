import type { SmsTemplatePatternField } from "./smsTemplateParser";

export interface SmsTemplateSelection {
  text: string;
  start: number;
  end: number;
  beforeAnchor: string;
  afterAnchor: string;
}

export interface SmsTemplatePatternSuggestion {
  ok: boolean;
  pattern?: string;
  error?: string;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const flexibleLiteralPattern = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join("\\s+");

const nearestWords = (
  value: string,
  side: "before" | "after",
): string => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const selected = side === "before" ? words.slice(-3) : words.slice(0, 3);
  return selected.join(" ");
};

export const smsTemplateSelection = (
  sample: string,
  start: number,
  end: number,
): SmsTemplateSelection => ({
  text: sample.slice(start, end),
  start,
  end,
  beforeAnchor: nearestWords(sample.slice(0, start), "before"),
  afterAnchor: nearestWords(sample.slice(end), "after"),
});

const extractionPattern = (
  field: SmsTemplatePatternField,
  selectedText: string,
): SmsTemplatePatternSuggestion => {
  switch (field) {
    case "referencePattern":
      return /^[A-Z0-9]+$/i.test(selectedText.trim())
        ? { ok: true, pattern: "([A-Z0-9]+)" }
        : { ok: false, error: "Select an alphanumeric reference value." };
    case "amountPattern":
    case "costPattern":
      return /^[\d,]+(?:\.\d{1,2})?$/.test(selectedText.trim())
        ? { ok: true, pattern: "([\\d,]+(?:\\.\\d{1,2})?)" }
        : { ok: false, error: "Select a numeric amount or cost value." };
    case "recipientPhonePattern":
      return /^\+?[\d\s-]{7,}$/.test(selectedText.trim())
        ? { ok: true, pattern: "(\\+?\\d(?:[\\d\\s-]*\\d)?)" }
        : { ok: false, error: "Select a phone-number value." };
    case "recipientNamePattern":
      return selectedText.trim()
        ? { ok: true, pattern: "(.+?)" }
        : { ok: false, error: "Select a recipient or sender name." };
    default:
      return { ok: false, error: "This field is not an extraction field." };
  }
};

const dateTimePattern = (selectedText: string): SmsTemplatePatternSuggestion => {
  const value = selectedText.trim();
  if (
    /^\d{4}-\d{1,2}-\d{1,2}\s+(?:at\s+)?\d{1,2}:\d{2}:\d{2}$/i.test(
      value,
    )
  ) {
    return {
      ok: true,
      pattern:
        "(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2}):(\\d{2})",
    };
  }
  if (
    /^\d{1,2}\/\d{1,2}\/\d{2}\s+(?:at\s+)?\d{1,2}:\d{2}\s*[AP]M$/i.test(
      value,
    )
  ) {
    return {
      ok: true,
      pattern:
        "(\\d{1,2})/(\\d{1,2})/(\\d{2})\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2})\\s*([AP]M)",
    };
  }
  return {
    ok: false,
    error:
      "The selected date/time is not one of the current parser's supported six-capture formats.",
  };
};

export const suggestSmsTemplatePattern = (input: {
  field: SmsTemplatePatternField;
  selectedText: string;
  beforeAnchor: string;
  afterAnchor: string;
}): SmsTemplatePatternSuggestion => {
  const selectedText = input.selectedText.trim();
  if (!selectedText) return { ok: false, error: "Select text from the sample." };

  if (input.field === "incomePattern" || input.field === "expensePattern") {
    return { ok: true, pattern: flexibleLiteralPattern(selectedText) };
  }

  const valuePattern =
    input.field === "dateTimePattern"
      ? dateTimePattern(selectedText)
      : extractionPattern(input.field, selectedText);
  if (!valuePattern.ok || !valuePattern.pattern) return valuePattern;

  const before = flexibleLiteralPattern(input.beforeAnchor);
  const after = flexibleLiteralPattern(input.afterAnchor);
  if (!before && !after) {
    return {
      ok: false,
      error: "Keep stable text before or after the selected value as an anchor.",
    };
  }
  if (input.field === "recipientNamePattern" && !after) {
    return {
      ok: false,
      error: "Recipient names require stable text after the name to bound the match.",
    };
  }

  return {
    ok: true,
    pattern: `${before ? `${before}\\s*` : ""}${valuePattern.pattern}${
      after ? `\\s*${after}` : ""
    }`,
  };
};

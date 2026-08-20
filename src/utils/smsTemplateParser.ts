import type { SmsImportTemplate } from "../db";

export const SMS_TEMPLATE_PATTERN_FIELDS = [
  "referencePattern",
  "amountPattern",
  "recipientNamePattern",
  "recipientPhonePattern",
  "dateTimePattern",
  "costPattern",
  "incomePattern",
  "expensePattern",
] as const;

export type SmsTemplatePatternField =
  (typeof SMS_TEMPLATE_PATTERN_FIELDS)[number];

export interface ParsedSmsData {
  reference?: string;
  amount?: string;
  recipientName?: string;
  recipientPhone?: string;
  date?: string;
  time?: string;
  cost?: string;
  isIncome?: boolean;
  templateId?: number;
  recipientId?: number;
}

export type SmsPatternDiagnosticStatus =
  | "not-configured"
  | "invalid"
  | "no-match"
  | "matched"
  | "matched-without-capture"
  | "unsupported"
  | "ambiguous";

export interface SmsPatternDiagnostic {
  field: SmsTemplatePatternField;
  pattern: string;
  status: SmsPatternDiagnosticStatus;
  fullMatch?: string;
  extractedValue?: string;
  matchStart?: number;
  matchEnd?: number;
  matchCount: number;
  additionalCaptureCount: number;
  message?: string;
}

export interface SmsTemplateEvaluation {
  parsed: ParsedSmsData | null;
  diagnostics: Record<SmsTemplatePatternField, SmsPatternDiagnostic>;
  warnings: string[];
}

const extractionFields = new Set<SmsTemplatePatternField>([
  "referencePattern",
  "amountPattern",
  "recipientNamePattern",
  "recipientPhonePattern",
  "costPattern",
]);

const toTitleCase = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const countMatches = (sample: string, pattern: string): number => {
  const regex = new RegExp(pattern, "gi");
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sample)) !== null && count < 100) {
    count += 1;
    if (match[0] === "") regex.lastIndex += 1;
  }
  return count;
};

const diagnosticForPattern = (
  sample: string,
  field: SmsTemplatePatternField,
  pattern?: string,
): SmsPatternDiagnostic => {
  const source = pattern ?? "";
  if (!source) {
    return {
      field,
      pattern: source,
      status: "not-configured",
      matchCount: 0,
      additionalCaptureCount: 0,
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(source, "i");
  } catch {
    return {
      field,
      pattern: source,
      status: "invalid",
      matchCount: 0,
      additionalCaptureCount: 0,
      message: "Invalid regular expression.",
    };
  }

  const match = regex.exec(sample);
  if (!match) {
    return {
      field,
      pattern: source,
      status: "no-match",
      matchCount: 0,
      additionalCaptureCount: 0,
    };
  }

  const matchCount = countMatches(sample, source);
  const needsCapture = extractionFields.has(field);
  const extractedValue = needsCapture ? match[1] : undefined;
  let status: SmsPatternDiagnosticStatus =
    matchCount > 1 ? "ambiguous" : "matched";
  let message: string | undefined;
  if (needsCapture && extractedValue === undefined) {
    status = "matched-without-capture";
    message = "The current parser reads capture group 1, but none was produced.";
  } else if (matchCount > 1) {
    message = "More than one match was found; the current parser uses the first.";
  }

  return {
    field,
    pattern: source,
    status,
    fullMatch: match[0],
    extractedValue,
    matchStart: match.index,
    matchEnd: match.index + match[0].length,
    matchCount,
    additionalCaptureCount: Math.max(0, match.length - 2),
    message,
  };
};

const emptyDiagnostics = (
  sample: string,
  template: SmsImportTemplate,
): Record<SmsTemplatePatternField, SmsPatternDiagnostic> =>
  Object.fromEntries(
    SMS_TEMPLATE_PATTERN_FIELDS.map((field) => [
      field,
      diagnosticForPattern(sample, field, template[field]),
    ]),
  ) as Record<SmsTemplatePatternField, SmsPatternDiagnostic>;

export const evaluateSmsTemplate = (
  sample: string,
  template: SmsImportTemplate,
): SmsTemplateEvaluation => {
  const diagnostics = emptyDiagnostics(sample, template);
  const warnings: string[] = [];
  const result: ParsedSmsData = {};

  const income = diagnostics.incomePattern;
  const expense = diagnostics.expensePattern;
  const incomeMatched =
    income.status === "matched" || income.status === "ambiguous";
  const expenseMatched =
    expense.status === "matched" || expense.status === "ambiguous";

  if (incomeMatched && expenseMatched) {
    warnings.push(
      "Both income and expense patterns match; the current parser uses income.",
    );
  }

  let fatalPatternError = income.status === "invalid";
  if (incomeMatched) {
    result.isIncome = true;
  } else if (expense.status === "invalid") {
    fatalPatternError = true;
  } else if (expenseMatched) {
    result.isIncome = false;
  }

  const reference = diagnostics.referencePattern.extractedValue;
  if (reference) result.reference = reference;

  const amount = diagnostics.amountPattern.extractedValue;
  if (amount) result.amount = amount.replace(/,/g, "");

  const recipientName = diagnostics.recipientNamePattern.extractedValue;
  if (recipientName) result.recipientName = toTitleCase(recipientName);

  const recipientPhone = diagnostics.recipientPhonePattern.extractedValue;
  if (recipientPhone) result.recipientPhone = recipientPhone;

  const cost = diagnostics.costPattern.extractedValue;
  if (cost) result.cost = cost.replace(/,/g, "");

  const dateTime = diagnostics.dateTimePattern;
  if (dateTime.status === "invalid") {
    fatalPatternError = true;
  } else if (
    dateTime.status === "matched" ||
    dateTime.status === "ambiguous"
  ) {
    const match = new RegExp(template.dateTimePattern!, "i").exec(sample);
    if (match && match.length >= 7) {
      let day: string;
      let month: string;
      let year: string;

      if (match[1].length === 4) {
        year = match[1];
        month = match[2].padStart(2, "0");
        day = match[3].padStart(2, "0");
      } else {
        day = match[1].padStart(2, "0");
        month = match[2].padStart(2, "0");
        year = "20" + match[3];
      }

      result.date = `${month}-${day}-${year}`;
      let hours = parseInt(match[4]);
      const minutes = match[5];
      const period = match[6]?.toUpperCase();
      if (period) {
        if (period === "PM" && hours !== 12) hours += 12;
        if (period === "AM" && hours === 12) hours = 0;
      }
      result.time = `${hours.toString().padStart(2, "0")}:${minutes}`;
    } else if (match) {
      diagnostics.dateTimePattern = {
        ...dateTime,
        status: "unsupported",
        message:
          "The current parser requires six date/time capture groups.",
      };
    }
  }

  result.templateId = template.id;
  const parsed =
    !fatalPatternError && Object.keys(result).length > 1 ? result : null;
  if (!parsed) warnings.push("The current parser would not produce parsed data.");

  return { parsed, diagnostics, warnings };
};

export const parseSmsWithTemplate = (
  sample: string,
  template: SmsImportTemplate,
): ParsedSmsData | null => evaluateSmsTemplate(sample, template).parsed;

import { useState } from "react";
import { SmsImportTemplate } from "../db";

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
}

export const useSmsParser = (
  smsTemplates: SmsImportTemplate[],
  paymentMethodId?: number
) => {
  const [parsedPreview, setParsedPreview] = useState<ParsedSmsData | null>(
    null
  );
  const [parseError, setParseError] = useState("");

  // Helper function to apply a regex pattern from template
  const applyPattern = (
    sms: string,
    pattern?: string,
    captureGroup: number = 1
  ): string | undefined => {
    if (!pattern) return undefined;
    try {
      const regex = new RegExp(pattern, "i");
      const match = sms.match(regex);
      return match?.[captureGroup];
    } catch (err) {
      console.error(`Invalid regex pattern: ${pattern}`, err);
      return undefined;
    }
  };

  // Helper function to convert text to title case
  const toTitleCase = (text: string): string => {
    return text
      .trim()
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Try to parse SMS with a specific template
  const tryParseWithTemplate = (
    sms: string,
    template: SmsImportTemplate
  ): ParsedSmsData | null => {
    try {
      const result: ParsedSmsData = {};

      // Determine transaction type
      if (
        template.incomePattern &&
        sms.match(new RegExp(template.incomePattern, "i"))
      ) {
        result.isIncome = true;
      } else if (
        template.expensePattern &&
        sms.match(new RegExp(template.expensePattern, "i"))
      ) {
        result.isIncome = false;
      }

      // Extract reference
      const reference = applyPattern(sms, template.referencePattern);
      if (reference) result.reference = reference;

      // Extract amount (remove commas)
      const amount = applyPattern(sms, template.amountPattern);
      if (amount) result.amount = amount.replace(/,/g, "");

      // Extract recipient/sender name (convert to title case)
      const recipientName = applyPattern(sms, template.recipientNamePattern);
      if (recipientName) result.recipientName = toTitleCase(recipientName);

      // Extract phone number
      const recipientPhone = applyPattern(sms, template.recipientPhonePattern);
      if (recipientPhone) result.recipientPhone = recipientPhone;

      // Extract cost (remove commas)
      const cost = applyPattern(sms, template.costPattern);
      if (cost) result.cost = cost.replace(/,/g, "");

      // Extract date and time
      if (template.dateTimePattern) {
        const dateTimeMatch = sms.match(
          new RegExp(template.dateTimePattern, "i")
        );
        if (dateTimeMatch && dateTimeMatch.length >= 7) {
          const day = dateTimeMatch[1].padStart(2, "0");
          const month = dateTimeMatch[2].padStart(2, "0");
          const year = "20" + dateTimeMatch[3];
          result.date = `${year}-${month}-${day}`;

          let hours = parseInt(dateTimeMatch[4]);
          const minutes = dateTimeMatch[5];
          const period = dateTimeMatch[6].toUpperCase();

          if (period === "PM" && hours !== 12) hours += 12;
          if (period === "AM" && hours === 12) hours = 0;

          result.time = `${hours.toString().padStart(2, "0")}:${minutes}`;
        }
      }

      // Add template ID
      result.templateId = template.id;

      // Only return if we extracted at least some data (more than just templateId)
      return Object.keys(result).length > 1 ? result : null;
    } catch (err) {
      console.error("Error parsing with template:", template.name, err);
      return null;
    }
  };

  // Parse SMS using database templates
  const parseSms = async (sms: string): Promise<ParsedSmsData | null> => {
    try {
      // If we have a selected payment method, try its template first
      if (paymentMethodId) {
        const pmTemplate = smsTemplates.find(
          (t) => t.paymentMethodId === paymentMethodId
        );
        if (pmTemplate) {
          const result = tryParseWithTemplate(sms, pmTemplate);
          if (result) return { ...result, templateId: pmTemplate.id };
        }
      }

      // Try all active templates
      for (const template of smsTemplates) {
        // Skip if this is a payment-method-specific template and doesn't match
        if (
          template.paymentMethodId &&
          template.paymentMethodId !== paymentMethodId
        ) {
          continue;
        }

        const result = tryParseWithTemplate(sms, template);
        if (result) return { ...result, templateId: template.id };
      }

      // No template matched
      return null;
    } catch (err) {
      console.error("Error parsing SMS:", err);
      return null;
    }
  };

  // Preview SMS parsing with selected template
  const previewParse = async (smsText: string, selectedTemplateId?: number) => {
    setParseError("");
    setParsedPreview(null);

    if (!smsText.trim()) {
      setParseError("Please paste an SMS message");
      return;
    }

    let result = null;

    // If a template is selected, use only that template
    if (selectedTemplateId) {
      const template = smsTemplates.find((t) => t.id === selectedTemplateId);
      if (template) {
        result = tryParseWithTemplate(smsText, template);
      }
    } else {
      // Try all templates (existing behavior)
      result = await parseSms(smsText);
    }

    if (result) {
      setParsedPreview(result);
    } else {
      setParseError(
        selectedTemplateId
          ? "Selected template could not parse this SMS."
          : "Could not parse SMS with any available template."
      );
    }
  };

  // Clear parsed data
  const clearParsedData = () => {
    setParsedPreview(null);
    setParseError("");
  };

  return {
    parsedPreview,
    parseError,
    parseSms,
    previewParse,
    clearParsedData,
  };
};

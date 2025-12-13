import { useState } from "react";
import { SmsImportTemplate, db, Recipient } from "../db";

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
  recipientId?: number; // NEW: Resolved recipient ID if matched by name/alias
}

export const useSmsParser = (
  smsTemplates: SmsImportTemplate[],
  accountId?: number
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

  // NEW: Find recipient by name or alias (case-insensitive)
  const findRecipientByNameOrAlias = async (
    recipientName: string
  ): Promise<Recipient | null> => {
    if (!recipientName) return null;

    try {
      const allRecipients = await db.recipients.toArray();
      const searchName = recipientName.toLowerCase().trim();

      // First check exact name match
      const exactMatch = allRecipients.find(
        (r) => r.name.toLowerCase() === searchName
      );
      if (exactMatch) return exactMatch;

      // Then check aliases
      for (const recipient of allRecipients) {
        if (recipient.aliases) {
          const aliasesList = recipient.aliases
            .split(";")
            .map((alias) => alias.toLowerCase().trim());
          if (aliasesList.includes(searchName)) {
            return recipient;
          }
        }
      }

      return null;
    } catch (err) {
      console.error("Error finding recipient by name/alias:", err);
      return null;
    }
  };

  // Try to parse SMS with a specific template
  const tryParseWithTemplate = async (
    sms: string,
    template: SmsImportTemplate
  ): Promise<ParsedSmsData | null> => {
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
      if (recipientName) {
        const titleCaseRecipientName = toTitleCase(recipientName);
        result.recipientName = titleCaseRecipientName;

        // NEW: Try to match against existing recipients and aliases
        const matchedRecipient = await findRecipientByNameOrAlias(
          titleCaseRecipientName
        );
        if (matchedRecipient) {
          result.recipientId = matchedRecipient.id;
        }
      }

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
          // Check if the first capture group is a 4-digit year (YYYY-MM-DD format)
          // or a 1-2 digit day (DD/MM/YY format)
          let day: string;
          let month: string;
          let year: string;

          if (dateTimeMatch[1].length === 4) {
            // Format: YYYY-MM-DD HH:MM:SS
            year = dateTimeMatch[1];
            month = dateTimeMatch[2].padStart(2, "0");
            day = dateTimeMatch[3].padStart(2, "0");
          } else {
            // Format: DD/MM/YY HH:MM:SS
            day = dateTimeMatch[1].padStart(2, "0");
            month = dateTimeMatch[2].padStart(2, "0");
            year = "20" + dateTimeMatch[3];
          }

          result.date = `${month}-${day}-${year}`;

          let hours = parseInt(dateTimeMatch[4]);
          const minutes = dateTimeMatch[5];
          const period = dateTimeMatch[6]?.toUpperCase();

          // Handle 12-hour to 24-hour conversion
          if (period) {
            if (period === "PM" && hours !== 12) hours += 12;
            if (period === "AM" && hours === 12) hours = 0;
          }

          result.time = `${hours.toString().padStart(2, "0")}:${minutes}`;
        }
      }

      // Add template ID
      result.templateId = template.id;

      // Add logging for debugging
      console.log(`[${template.name}] Parsed:`, {
        isIncome: result.isIncome,
        reference: result.reference,
        amount: result.amount,
        recipientName: result.recipientName,
        recipientPhone: result.recipientPhone,
        cost: result.cost,
        date: result.date,
        time: result.time,
        fieldCount: Object.keys(result).length - 1, // Exclude templateId
      });

      // Only return if we extracted at least some data (more than just templateId)
      const hasData = Object.keys(result).length > 1;
      if (!hasData) {
        console.log(`[${template.name}] Rejected: No fields parsed`);
      }
      return hasData ? result : null;
    } catch (err) {
      console.error("Error parsing with template:", template.name, err);
      return null;
    }
  };

  // Parse SMS using database templates with scoring
  const parseSms = async (sms: string): Promise<ParsedSmsData | null> => {
    try {
      let bestResult: (ParsedSmsData & { score: number }) | null = null;

      // If we have a selected account, try its template first
      if (accountId) {
        const accountTemplate = smsTemplates.find(
          (t) => t.accountId === accountId
        );
        if (accountTemplate) {
          const result = await tryParseWithTemplate(sms, accountTemplate);
          if (result && result.amount) {
            // Amount is required to be considered a valid match
            return { ...result, templateId: accountTemplate.id };
          }
        }
      }

      // Try all templates and score each one
      for (const template of smsTemplates) {
        const result = await tryParseWithTemplate(sms, template);

        // Amount is required - skip if not present
        if (!result || !result.amount) {
          continue;
        }

        // Calculate score based on number of parsed fields
        let score = 0;
        if (result.isIncome !== undefined) score++;
        if (result.reference) score++;
        if (result.amount) score++;
        if (result.cost) score++;
        if (result.recipientName) score++;
        if (result.recipientPhone) score++;
        if (result.date) score++;
        if (result.time) score++;

        // Keep track of the best result (first one wins on tie)
        if (bestResult === null || score > bestResult.score) {
          bestResult = { ...result, templateId: template.id, score };
        }
      }

      // Return best result without the score property
      if (bestResult) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { score, ...resultWithoutScore } = bestResult;
        return resultWithoutScore;
      }

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
        result = await tryParseWithTemplate(smsText, template);
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

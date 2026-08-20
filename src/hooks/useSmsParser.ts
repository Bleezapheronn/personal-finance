import { useState } from "react";
import type { Recipient, SmsImportTemplate } from "../db";
import { recipientRepository } from "../repositories";
import {
  parseSmsWithTemplate,
  type ParsedSmsData,
} from "../utils/smsTemplateParser";

export type { ParsedSmsData } from "../utils/smsTemplateParser";

export const useSmsParser = (
  smsTemplates: SmsImportTemplate[],
  accountId?: number,
  recipientCandidates?: Recipient[],
) => {
  const [parsedPreview, setParsedPreview] = useState<ParsedSmsData | null>(null);
  const [parseError, setParseError] = useState("");

  const findRecipientByNameOrAlias = async (
    recipientName: string,
  ): Promise<Recipient | null> => {
    if (!recipientName) return null;

    try {
      const allRecipients =
        recipientCandidates ?? (await recipientRepository.listRecipients());
      const searchName = recipientName.toLowerCase().trim();
      const exactMatch = allRecipients.find(
        (recipient) => recipient.name.toLowerCase() === searchName,
      );
      if (exactMatch) return exactMatch;

      for (const recipient of allRecipients) {
        if (!recipient.aliases) continue;
        const aliases = recipient.aliases
          .split(";")
          .map((alias) => alias.toLowerCase().trim());
        if (aliases.includes(searchName)) return recipient;
      }
      return null;
    } catch (error) {
      console.error("Error finding recipient by name/alias:", error);
      return null;
    }
  };

  const tryParseWithTemplate = async (
    sms: string,
    template: SmsImportTemplate,
  ): Promise<ParsedSmsData | null> => {
    const result = parseSmsWithTemplate(sms, template);
    if (!result?.recipientName) return result;

    const matchedRecipient = await findRecipientByNameOrAlias(
      result.recipientName,
    );
    return matchedRecipient ? { ...result, recipientId: matchedRecipient.id } : result;
  };

  const parseSms = async (sms: string): Promise<ParsedSmsData | null> => {
    try {
      let bestResult: (ParsedSmsData & { score: number }) | null = null;

      if (accountId) {
        const accountTemplate = smsTemplates.find(
          (template) => template.accountId === accountId,
        );
        if (accountTemplate) {
          const result = await tryParseWithTemplate(sms, accountTemplate);
          if (result?.amount) {
            return { ...result, templateId: accountTemplate.id };
          }
        }
      }

      for (const template of smsTemplates) {
        const result = await tryParseWithTemplate(sms, template);
        if (!result?.amount) continue;

        let score = 0;
        if (result.isIncome !== undefined) score += 1;
        if (result.reference) score += 1;
        if (result.amount) score += 1;
        if (result.cost) score += 1;
        if (result.recipientName) score += 1;
        if (result.recipientPhone) score += 1;
        if (result.date) score += 1;
        if (result.time) score += 1;

        if (bestResult === null || score > bestResult.score) {
          bestResult = { ...result, templateId: template.id, score };
        }
      }

      if (!bestResult) return null;
      const { score: _score, ...resultWithoutScore } = bestResult;
      void _score;
      return resultWithoutScore;
    } catch (error) {
      console.error("Error parsing SMS:", error);
      return null;
    }
  };

  const previewParse = async (smsText: string, selectedTemplateId?: number) => {
    setParseError("");
    setParsedPreview(null);

    if (!smsText.trim()) {
      setParseError("Please paste an SMS message");
      return;
    }

    let result: ParsedSmsData | null = null;
    if (selectedTemplateId) {
      const template = smsTemplates.find(
        (candidate) => candidate.id === selectedTemplateId,
      );
      if (template) result = await tryParseWithTemplate(smsText, template);
    } else {
      result = await parseSms(smsText);
    }

    if (result) {
      setParsedPreview(result);
    } else {
      setParseError(
        selectedTemplateId
          ? "Selected template could not parse this SMS."
          : "Could not parse SMS with any available template.",
      );
    }
  };

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

import { db, Recipient } from "../db";

export interface MergeResult {
  success: boolean;
  primaryRecipient: Recipient;
  mergedRecipient: Recipient;
  transactionsUpdated: number;
  error?: string;
}

/**
 * mergeRecipients - Merges a secondary recipient into a primary recipient
 * Updates all transactions to use the primary recipient
 * Combines data from both recipients
 * Deletes the secondary recipient
 */
export const mergeRecipients = async (
  primaryId: number,
  secondaryId: number
): Promise<MergeResult> => {
  try {
    // Fetch both recipients
    const primary = await db.recipients.get(primaryId);
    const secondary = await db.recipients.get(secondaryId);

    if (!primary || !secondary) {
      return {
        success: false,
        primaryRecipient: primary!,
        mergedRecipient: secondary!,
        transactionsUpdated: 0,
        error: "One or both recipients not found",
      };
    }

    // Combine data: use primary's data, fill in missing fields from secondary
    const mergedData = {
      name: primary.name, // Keep primary name
      email: primary.email || secondary.email,
      phone: primary.phone || secondary.phone,
      tillNumber: primary.tillNumber || secondary.tillNumber,
      paybill: primary.paybill || secondary.paybill,
      accountNumber: primary.accountNumber || secondary.accountNumber,
      description: primary.description || secondary.description,
      aliases: combinedAliases(primary, secondary), // Combine aliases
      isActive: primary.isActive,
      updatedAt: new Date(),
    };

    // Update primary recipient with merged data
    await db.recipients.update(primaryId, mergedData);

    // Update all transactions that use the secondary recipient
    const transactions = await db.transactions.toArray();
    const transactionsToUpdate = transactions.filter(
      (txn) => txn.recipientId === secondaryId
    );

    for (const txn of transactionsToUpdate) {
      await db.transactions.update(txn.id!, {
        ...txn,
        recipientId: primaryId,
      });
    }

    // Delete the secondary recipient
    await db.recipients.delete(secondaryId);

    // Fetch updated primary recipient
    const updatedPrimary = await db.recipients.get(primaryId);

    return {
      success: true,
      primaryRecipient: updatedPrimary!,
      mergedRecipient: secondary,
      transactionsUpdated: transactionsToUpdate.length,
    };
  } catch (error) {
    console.error("Error merging recipients:", error);
    return {
      success: false,
      primaryRecipient: (await db.recipients.get(primaryId))!,
      mergedRecipient: (await db.recipients.get(secondaryId))!,
      transactionsUpdated: 0,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
};

/**
 * combinedAliases - Merges aliases from both recipients, avoiding duplicates
 */
const combinedAliases = (primary: Recipient, secondary: Recipient): string => {
  const primaryAliases = primary.aliases
    ? primary.aliases.split(";").map((a) => a.trim().toLowerCase())
    : [];
  const secondaryAliases = secondary.aliases
    ? secondary.aliases.split(";").map((a) => a.trim().toLowerCase())
    : [];

  // Combine and deduplicate
  const combined = [...primaryAliases];
  for (const alias of secondaryAliases) {
    if (!combined.includes(alias)) {
      combined.push(alias);
    }
  }

  return combined.filter((a) => a.length > 0).join("; ");
};

/**
 * isSimilarName - Checks if two names are similar enough to be duplicates
 * Uses STRICT name-only matching:
 * 1. Exact case-insensitive match (e.g., "PayPal Account" = "paypal account")
 * 2. Levenshtein distance for typos (e.g., "Paypal" vs "PayPal")
 *
 * NOTE: Does NOT check phone, till, paybill, or email
 * Multiple recipients can legitimately share contact details
 */
const isSimilarName = (name1: string, name2: string): boolean => {
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  // Exact match (case-insensitive)
  if (n1 === n2) {
    return true;
  }

  // Levenshtein distance for typos (e.g., "paypal" vs "paypal" with different casing)
  // Allow up to 2 character differences for names under 15 chars
  const distance = levenshteinDistance(n1, n2);
  if (distance <= 2 && Math.max(n1.length, n2.length) <= 15) {
    return true;
  }

  return false;
};

/**
 * levenshteinDistance - Calculate edit distance between two strings
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[len2][len1];
};

/**
 * findAllDuplicatePairs - Finds all duplicate recipient pairs
 * Uses STRICT matching criteria - NAME ONLY:
 * - Similar names (exact or slight typo variations via Levenshtein distance)
 *
 * Does NOT match on:
 * - Phone numbers (multiple recipients can share)
 * - Paybill numbers (multiple recipients can share)
 * - Till numbers (multiple recipients can share)
 * - Email addresses (multiple recipients can share)
 */
export const findAllDuplicatePairs = (
  recipients: Recipient[]
): Array<[Recipient, Recipient]> => {
  const pairs: Array<[Recipient, Recipient]> = [];
  const processed = new Set<number>();

  for (const recipient of recipients) {
    if (processed.has(recipient.id!)) continue;

    // Find duplicates of this recipient (by name only)
    const duplicates = recipients.filter((other) => {
      if (
        other.id === recipient.id ||
        processed.has(other.id!) ||
        processed.has(recipient.id!)
      ) {
        return false;
      }

      // Check for similar names ONLY
      return isSimilarName(recipient.name, other.name);
    });

    for (const duplicate of duplicates) {
      pairs.push([recipient, duplicate]);
      processed.add(duplicate.id!);
    }

    processed.add(recipient.id!);
  }

  return pairs;
};

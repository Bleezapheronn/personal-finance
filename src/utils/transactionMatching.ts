import { Transaction } from "../db";

/**
 * Simple fuzzy match - checks if pattern is contained in text (case-insensitive)
 */
export const fuzzyMatch = (pattern: string, text: string): boolean => {
  const patternLower = pattern.toLowerCase().trim();
  const textLower = text.toLowerCase().trim();
  return textLower.includes(patternLower) || patternLower.includes(textLower);
};

/**
 * Find unlinked transactions that match a budget
 */
export const findMatchingTransactions = (
  allTransactions: Transaction[],
  budgetDescription: string,
  budgetCategoryId: number,
  budgetRecipientId: number | undefined
): Transaction[] => {
  // Filter unlinked transactions only
  const unlinkedTransactions = allTransactions.filter(
    (txn) => txn.budgetId === null || txn.budgetId === undefined
  );

  // Score and sort by relevance
  const scored = unlinkedTransactions
    .map((txn) => {
      let score = 0;

      // Exact recipient match: +100
      if (budgetRecipientId && txn.recipientId === budgetRecipientId) {
        score += 100;
      }

      // Exact category match: +50
      if (txn.categoryId === budgetCategoryId) {
        score += 50;
      }

      // Description fuzzy match: +25
      if (fuzzyMatch(budgetDescription, txn.description || "")) {
        score += 25;
      }

      return { transaction: txn, score };
    })
    .filter((item) => item.score > 0) // Only return matches
    .sort((a, b) => b.score - a.score) // Sort by score descending
    .map((item) => item.transaction);

  return scored;
};

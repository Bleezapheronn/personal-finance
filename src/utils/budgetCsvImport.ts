import { db, Budget, Recipient } from "../db";

export interface BudgetImportResult {
  success: number;
  failed: number;
  errors: BudgetImportError[];
  budgetIdMap: Map<number, number>; // Maps old budget IDs to new ones
}

export interface BudgetImportError {
  row: number;
  reason: string;
}

export const parseCSV = (csvContent: string): string[][] => {
  const lines = csvContent.split("\n");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const nextChar = line[j + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          j++; // Skip next quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else {
        currentField += char;
      }
    }

    // End of line
    if (!insideQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some((field) => field.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += "\n";
    }
  }

  return rows;
};

// FIXED: Type for frequency details
interface FrequencyDetails {
  [key: string]: string | number | boolean;
}

export const importBudgetsFromCSV = async (
  csvContent: string
): Promise<BudgetImportResult> => {
  const result: BudgetImportResult = {
    success: 0,
    failed: 0,
    errors: [],
    budgetIdMap: new Map(),
  };

  try {
    const rows = parseCSV(csvContent);

    // Skip header row
    if (rows.length < 2) {
      result.errors.push({ row: 1, reason: "No data rows found" });
      return result;
    }

    // Fetch lookup data
    const [categories, recipients, accounts] = await Promise.all([
      db.categories.toArray(),
      db.recipients.toArray(),
      db.accounts.toArray(),
    ]);

    // Process each data row
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];

      try {
        // Map CSV columns
        const [
          oldBudgetId,
          description,
          amountStr,
          categoryName,
          recipientName,
          accountName,
          dueDateStr,
          frequency,
          frequencyDetailsStr,
          isGoalStr,
          isFlexibleStr,
          isActiveStr,
          transactionCostStr,
        ] = row;

        // Validation
        if (!description || !amountStr || !categoryName || !dueDateStr) {
          result.errors.push({
            row: rowIndex,
            reason:
              "Missing required fields (Description, Amount, Category, Due Date)",
          });
          result.failed++;
          continue;
        }

        // Find category
        const category = categories.find(
          (c) => c.name?.toLowerCase() === categoryName.toLowerCase()
        );
        if (!category) {
          result.errors.push({
            row: rowIndex,
            reason: `Category not found: ${categoryName}`,
          });
          result.failed++;
          continue;
        }

        // Find or create recipient if provided
        let recipientId: number | undefined;
        if (recipientName) {
          const existingRecipient = recipients.find(
            (r) => r.name?.toLowerCase() === recipientName.toLowerCase()
          );
          if (!existingRecipient) {
            const now = new Date();
            const newRecipientId = await db.recipients.add({
              name: recipientName,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            } as Omit<Recipient, "id">);
            recipientId = newRecipientId;
          } else {
            recipientId = existingRecipient.id;
          }
        }

        // Find account if provided
        let accountId: number | undefined;
        if (accountName) {
          const account = accounts.find(
            (a) => a.name?.toLowerCase() === accountName.toLowerCase()
          );
          if (account) {
            accountId = account.id;
          }
        }

        // Parse amount
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) {
          result.errors.push({
            row: rowIndex,
            reason: `Invalid amount: ${amountStr}`,
          });
          result.failed++;
          continue;
        }

        // Parse due date
        const dueDate = new Date(`${dueDateStr}T00:00:00`);
        if (isNaN(dueDate.getTime())) {
          result.errors.push({
            row: rowIndex,
            reason: `Invalid date: ${dueDateStr}`,
          });
          result.failed++;
          continue;
        }

        // FIXED: Type frequency details properly
        let frequencyDetails: FrequencyDetails | undefined;
        if (frequencyDetailsStr) {
          try {
            frequencyDetails = JSON.parse(
              frequencyDetailsStr
            ) as FrequencyDetails;
          } catch {
            frequencyDetails = undefined;
          }
        }

        // Parse boolean flags
        const isGoal = isGoalStr?.toLowerCase() === "yes";
        const isFlexible = isFlexibleStr?.toLowerCase() === "yes";
        const isActive = isActiveStr?.toLowerCase() !== "no";

        // Parse transaction cost
        const transactionCost = transactionCostStr
          ? parseFloat(transactionCostStr)
          : 0;

        // Create budget
        const now = new Date();
        const budget: Omit<Budget, "id"> = {
          description,
          amount,
          categoryId: category.id!,
          recipientId,
          accountId,
          dueDate,
          frequency:
            (frequency as
              | "once"
              | "daily"
              | "weekly"
              | "monthly"
              | "yearly"
              | "custom") || "once",
          frequencyDetails,
          isGoal,
          isFlexible,
          isActive,
          transactionCost: isNaN(transactionCost) ? 0 : transactionCost,
          createdAt: now,
          updatedAt: now,
        };

        // Add budget and map old ID to new ID
        const newBudgetId = await db.budgets.add(budget);
        if (oldBudgetId) {
          const oldId = parseInt(oldBudgetId);
          if (!isNaN(oldId)) {
            result.budgetIdMap.set(oldId, newBudgetId);
          }
        }

        result.success++;
      } catch (err) {
        result.errors.push({
          row: rowIndex,
          reason: `Error: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        });
        result.failed++;
      }
    }

    return result;
  } catch (err) {
    result.errors.push({
      row: 0,
      reason: `Import failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    });
    return result;
  }
};

/**
 * Updates transaction budgetIds after importing budgets
 * Maps old budget IDs to new ones
 */
export const remapTransactionBudgetIds = async (
  budgetIdMap: Map<number, number>
): Promise<void> => {
  if (budgetIdMap.size === 0) return;

  const transactions = await db.transactions.toArray();

  for (const txn of transactions) {
    if (txn.budgetId && budgetIdMap.has(txn.budgetId)) {
      const newBudgetId = budgetIdMap.get(txn.budgetId)!;
      await db.transactions.update(txn.id!, {
        budgetId: newBudgetId,
      });
    }
  }
};

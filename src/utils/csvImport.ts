import { db, Transaction, Recipient } from "../db";

export interface ImportResult {
  success: number;
  failed: number;
  errors: ImportError[];
}

export interface ImportError {
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

export const importTransactionsFromCSV = async (
  csvContent: string
): Promise<ImportResult> => {
  const result: ImportResult = { success: 0, failed: 0, errors: [] };

  try {
    const rows = parseCSV(csvContent);

    // Skip header row
    if (rows.length < 2) {
      result.errors.push({ row: 1, reason: "No data rows found" });
      return result;
    }

    // Fetch lookup data
    const [categories, recipients, accounts, budgets] = await Promise.all([
      db.categories.toArray(),
      db.recipients.toArray(),
      db.accounts.toArray(),
      db.budgets.toArray(),
    ]);

    // Process each data row
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];

      try {
        // Map CSV columns - CHANGED: Added budgetDescription and occurrenceDate
        const [
          ,
          date,
          time,
          description,
          amount,
          ,
          recipientName,
          categoryName,
          ,
          accountName,
          budgetDescription, // NEW: Budget description for linking
          occurrenceDateStr, // NEW: Occurrence date
        ] = row;

        // Validation
        if (
          !date ||
          !amount ||
          !recipientName ||
          !categoryName ||
          !accountName
        ) {
          result.errors.push({
            row: rowIndex,
            reason:
              "Missing required fields (Date, Amount, Recipient, Category, Account)",
          });
          result.failed++;
          continue;
        }

        // Find or create recipient
        let recipient = recipients.find(
          (r) => r.name?.toLowerCase() === recipientName.toLowerCase()
        );
        if (!recipient) {
          const now = new Date();
          const newRecipientId = await db.recipients.add({
            name: recipientName,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          } as Omit<Recipient, "id">);
          recipient = {
            id: newRecipientId,
            name: recipientName,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          recipients.push(recipient);
        }

        // Validate recipient exists
        if (!recipient) {
          result.errors.push({
            row: rowIndex,
            reason: "Failed to create or find recipient",
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

        // Find account
        const account = accounts.find(
          (a) => a.name?.toLowerCase() === accountName.toLowerCase()
        );
        if (!account) {
          result.errors.push({
            row: rowIndex,
            reason: `Account not found: ${accountName}`,
          });
          result.failed++;
          continue;
        }

        // Combine date and time
        const dateTime = `${date}T${time || "00:00:00"}`;
        const parsedDate = new Date(dateTime);

        if (isNaN(parsedDate.getTime())) {
          result.errors.push({
            row: rowIndex,
            reason: `Invalid date/time: ${date} ${time}`,
          });
          result.failed++;
          continue;
        }

        const parsedAmount = parseFloat(amount);
        const recipientId = recipient.id;
        const categoryId = category.id;
        const accountId = account.id;

        if (
          typeof recipientId !== "number" ||
          typeof categoryId !== "number" ||
          typeof accountId !== "number"
        ) {
          result.errors.push({
            row: rowIndex,
            reason: "Invalid recipient, category, or account ID",
          });
          result.failed++;
          continue;
        }

        // NEW: Find budget by description if provided
        let budgetId: number | undefined;
        let occurrenceDate: Date | undefined;

        if (budgetDescription) {
          const budget = budgets.find(
            (b) =>
              b.description?.toLowerCase() === budgetDescription.toLowerCase()
          );
          if (budget) {
            budgetId = budget.id;

            // Parse occurrence date if provided
            if (occurrenceDateStr) {
              occurrenceDate = new Date(`${occurrenceDateStr}T00:00:00`);
              if (isNaN(occurrenceDate.getTime())) {
                occurrenceDate = undefined;
              }
            }
          }
        }

        // Create transaction
        const transaction: Omit<Transaction, "id"> = {
          date: parsedDate,
          description,
          amount: parsedAmount,
          recipientId,
          categoryId,
          accountId,
          transactionCost: 0,
          budgetId, // NEW: Include budgetId
          occurrenceDate, // NEW: Include occurrenceDate
        };

        // Check if transaction already exists (by date, amount, recipient, description)
        const exists = await db.transactions
          .where("date")
          .equals(transaction.date)
          .and((txn) => txn.amount === transaction.amount)
          .and((txn) => txn.recipientId === transaction.recipientId)
          .and((txn) => txn.description === transaction.description)
          .count();

        if (exists > 0) {
          result.errors.push({
            row: rowIndex,
            reason: "Duplicate transaction (skipped)",
          });
          result.failed++;
          continue;
        }

        // Add transaction
        await db.transactions.add(transaction);
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

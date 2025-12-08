import { db } from "../db";

export const exportTransactionsToCSV = async (): Promise<string> => {
  try {
    // Fetch all data
    const [transactions, categories, recipients, accounts, buckets, budgets] =
      await Promise.all([
        db.transactions.toArray(),
        db.categories.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
        db.buckets.toArray(),
        db.budgets.toArray(),
      ]);

    // CSV Header - CHANGED: Added budgetId and occurrenceDate
    const headers = [
      "Transaction ID",
      "Date",
      "Time",
      "Description",
      "Amount",
      "Type",
      "Recipient",
      "Category",
      "Bucket",
      "Account",
      "Budget ID",
      "Occurrence Date",
    ];

    // Helper function to escape CSV values (handle commas, quotes, newlines)
    const escapeCSV = (value: string | number | undefined | null): string => {
      if (value === null || value === undefined) return "";
      const stringValue = String(value);
      if (
        stringValue.includes(",") ||
        stringValue.includes('"') ||
        stringValue.includes("\n")
      ) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    // Build rows
    const rows = transactions.map((txn) => {
      const recipient = recipients.find((r) => r.id === txn.recipientId);
      const category = categories.find((c) => c.id === txn.categoryId);
      const bucket = buckets.find((b) => b.id === category?.bucketId);
      const account = accounts.find((a) => a.id === txn.accountId);
      const budget = txn.budgetId
        ? budgets.find((b) => b.id === txn.budgetId)
        : null;

      // Split date and time
      const dateObj = new Date(txn.date);
      const date = dateObj.toISOString().split("T")[0]; // YYYY-MM-DD
      const time = dateObj.toTimeString().split(" ")[0]; // HH:MM:SS

      // Determine transaction type based on amount
      const type = txn.amount > 0 ? "Income" : "Expense";

      // CHANGED: Added budgetId and occurrenceDate
      const occurrenceDateStr = txn.occurrenceDate
        ? new Date(txn.occurrenceDate).toISOString().split("T")[0]
        : "";

      return [
        escapeCSV(txn.id),
        escapeCSV(date),
        escapeCSV(time),
        escapeCSV(txn.description),
        escapeCSV(txn.amount),
        escapeCSV(type),
        escapeCSV(recipient?.name),
        escapeCSV(category?.name),
        escapeCSV(bucket?.name),
        escapeCSV(account?.name),
        escapeCSV(budget?.description), // Use budget description instead of ID for export
        escapeCSV(occurrenceDateStr),
      ]
        .map((v) => v)
        .join(",");
    });

    // Combine header + rows
    const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n");

    return csv;
  } catch (err) {
    console.error("Error exporting CSV:", err);
    throw err;
  }
};

// Helper to download file
export const downloadCSV = (
  csvContent: string,
  filename: string = "transactions.csv"
): void => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

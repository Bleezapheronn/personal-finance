import { db } from "../db";

export const exportBudgetsToCSV = async (): Promise<string> => {
  try {
    // Fetch all data
    const [budgets, categories, recipients, accounts] = await Promise.all([
      db.budgets.toArray(),
      db.categories.toArray(),
      db.recipients.toArray(),
      db.accounts.toArray(),
    ]);

    // CSV Header
    const headers = [
      "Budget ID",
      "Description",
      "Amount",
      "Category",
      "Recipient",
      "Account",
      "Due Date",
      "Frequency",
      "Frequency Details",
      "Is Goal",
      "Is Flexible",
      "Is Active",
      "Transaction Cost",
    ];

    // Helper function to escape CSV values
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
    const rows = budgets.map((budget) => {
      const category = categories.find((c) => c.id === budget.categoryId);
      const recipient = recipients.find((r) => r.id === budget.recipientId);
      const account = accounts.find((a) => a.id === budget.accountId);

      const dueDate = new Date(budget.dueDate).toISOString().split("T")[0];

      const frequencyDetails = budget.frequencyDetails
        ? JSON.stringify(budget.frequencyDetails)
        : "";

      return [
        escapeCSV(budget.id),
        escapeCSV(budget.description),
        escapeCSV(budget.amount),
        escapeCSV(category?.name),
        escapeCSV(recipient?.name),
        escapeCSV(account?.name),
        escapeCSV(dueDate),
        escapeCSV(budget.frequency),
        escapeCSV(frequencyDetails),
        escapeCSV(budget.isGoal ? "Yes" : "No"),
        escapeCSV(budget.isFlexible ? "Yes" : "No"),
        escapeCSV(budget.isActive ? "Yes" : "No"),
        escapeCSV(budget.transactionCost),
      ]
        .map((v) => v)
        .join(",");
    });

    // Combine header + rows
    const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n");

    return csv;
  } catch (err) {
    console.error("Error exporting budgets CSV:", err);
    throw err;
  }
};

// Helper to download file
export const downloadBudgetsCSV = (
  csvContent: string,
  filename: string = "budgets.csv"
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

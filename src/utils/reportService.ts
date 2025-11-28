import { db } from "../db";

export interface BucketReport {
  bucketId: number;
  bucketName: string;
  totalAmount: number;
  minPercentage: number;
  maxPercentage: number;
  minFixedAmount?: number;
  actualPercentage: number;
  status:
    | "on-target"
    | "below-min-fixed"
    | "below-min-percentage"
    | "above-max";
  income: number;
  expense: number;
  netAmount: number;
}

export interface PeriodReport {
  periodLabel: string;
  startDate: Date;
  endDate: Date;
  totalIncome: number;
  totalExpense: number;
  netTotal: number;
  bucketReports: BucketReport[];
}

export type PeriodType = "month" | "quarter" | "year";

// Get date range for a specific period
export const getDateRangeForPeriod = (
  periodType: PeriodType,
  date: Date = new Date()
): { start: Date; end: Date; label: string } => {
  const year = date.getFullYear();
  const month = date.getMonth();

  switch (periodType) {
    case "month": {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const label = date.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      return { start, end, label };
    }

    case "quarter": {
      const quarter = Math.floor(month / 3);
      const start = new Date(year, quarter * 3, 1);
      const end = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);
      const label = `Q${quarter + 1} ${year}`;
      return { start, end, label };
    }

    case "year": {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      const label = year.toString();
      return { start, end, label };
    }
  }
};

// Generate report for a specific period
export const generatePeriodReport = async (
  periodType: PeriodType,
  date: Date = new Date()
): Promise<PeriodReport> => {
  const { start, end, label } = getDateRangeForPeriod(periodType, date);

  // Fetch all transactions in the date range
  const allTransactions = await db.transactions
    .where("date")
    .between(start, end)
    .toArray();

  console.log("=== REPORT DEBUG ===");
  console.log(`Period: ${label}`);
  console.log(`Date range: ${start.toISOString()} to ${end.toISOString()}`);
  console.log(`Total transactions found: ${allTransactions.length}`);

  // Fetch buckets and categories
  const buckets = await db.buckets.toArray();
  const categories = await db.categories.toArray();

  // Find the income bucket (excluded from reports)
  const incomeBucket = buckets.find((b) => b.excludeFromReports);

  // Calculate totals
  let totalIncome = 0;
  let totalExpense = 0;

  const bucketTotalsMap = new Map<
    number,
    { income: number; expense: number; netAmount: number }
  >();

  // Initialize bucket totals
  buckets.forEach((bucket) => {
    if (bucket.isActive) {
      bucketTotalsMap.set(bucket.id!, {
        income: 0,
        expense: 0,
        netAmount: 0,
      });
    }
  });

  // Aggregate transactions by bucket
  allTransactions.forEach((txn) => {
    // Calculate net amount (amount + transaction cost)
    const netAmount = txn.amount + (txn.transactionCost || 0);

    // Find category and bucket for this transaction
    const category = categories.find((c) => c.id === txn.categoryId);
    if (!category) return;

    const bucketId = category.bucketId;
    if (!bucketId) return;

    const isIncomeBucket = bucketId === incomeBucket?.id;

    if (isIncomeBucket) {
      // Income bucket: add to total income
      totalIncome += netAmount;
    } else {
      // Expense bucket: add signed netAmount (negative expenses cancel positive transfers)
      totalExpense += netAmount;
    }

    // Update bucket totals
    const current = bucketTotalsMap.get(bucketId) || {
      income: 0,
      expense: 0,
      netAmount: 0,
    };

    if (isIncomeBucket) {
      bucketTotalsMap.set(bucketId, {
        ...current,
        income: current.income + netAmount,
        netAmount: current.netAmount + netAmount,
      });
    } else {
      bucketTotalsMap.set(bucketId, {
        ...current,
        expense: current.expense + netAmount,
        netAmount: current.netAmount + netAmount,
      });
    }
  });

  console.log(`Total Income: ${totalIncome}`);
  console.log(`Total Expense: ${totalExpense}`);
  console.log("=== END DEBUG ===");

  const netTotal = totalIncome + totalExpense;

  // Generate bucket reports
  const bucketReports: BucketReport[] = buckets
    .filter((b) => b.isActive && !b.excludeFromReports)
    .map((bucket) => {
      const totals = bucketTotalsMap.get(bucket.id!) || {
        income: 0,
        expense: 0,
        netAmount: 0,
      };

      // For reporting, use the net amount (negative for expenses)
      const totalAmount = totals.netAmount;

      // Calculate actual percentage based on total expense
      const absoluteAmount = Math.abs(totalAmount);
      const actualPercentage =
        totalIncome !== 0 ? (absoluteAmount / Math.abs(totalIncome)) * 100 : 0;

      // Determine status
      let status: BucketReport["status"] = "on-target";

      if (bucket.minFixedAmount && absoluteAmount < bucket.minFixedAmount) {
        status = "below-min-fixed";
      } else if (actualPercentage < bucket.minPercentage) {
        status = "below-min-percentage";
      } else if (actualPercentage > bucket.maxPercentage) {
        status = "above-max";
      }

      return {
        bucketId: bucket.id!,
        bucketName: bucket.name || "Unnamed",
        totalAmount: totalAmount,
        minPercentage: bucket.minPercentage,
        maxPercentage: bucket.maxPercentage,
        minFixedAmount: bucket.minFixedAmount,
        actualPercentage,
        status,
        income: totals.income,
        expense: totals.expense,
        netAmount: totalAmount,
      };
    })
    .sort((a, b) => {
      const bucketA = buckets.find((bucket) => bucket.id === a.bucketId);
      const bucketB = buckets.find((bucket) => bucket.id === b.bucketId);
      const orderA = bucketA?.displayOrder ?? 999;
      const orderB = bucketB?.displayOrder ?? 999;
      return orderA - orderB;
    });

  return {
    periodLabel: label,
    startDate: start,
    endDate: end,
    totalIncome,
    totalExpense,
    netTotal,
    bucketReports,
  };
};

// Navigate to previous period
export const getPreviousPeriod = (periodType: PeriodType, date: Date): Date => {
  const newDate = new Date(date);

  switch (periodType) {
    case "month":
      newDate.setMonth(newDate.getMonth() - 1);
      break;
    case "quarter":
      newDate.setMonth(newDate.getMonth() - 3);
      break;
    case "year":
      newDate.setFullYear(newDate.getFullYear() - 1);
      break;
  }

  return newDate;
};

// Navigate to next period
export const getNextPeriod = (periodType: PeriodType, date: Date): Date => {
  const newDate = new Date(date);

  switch (periodType) {
    case "month":
      newDate.setMonth(newDate.getMonth() + 1);
      break;
    case "quarter":
      newDate.setMonth(newDate.getMonth() + 3);
      break;
    case "year":
      newDate.setFullYear(newDate.getFullYear() + 1);
      break;
  }

  return newDate;
};

// Format number as comma-separated value
export const formatCurrency = (value: number): string => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

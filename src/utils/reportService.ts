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

export interface MonthlyChartDataOptions {
  bucketId: number;
  categoryIds: number[];
  startMonth: string;
  endMonth: string;
}

export interface MonthlyChartRow {
  month: string;
  monthKey: string;
  [seriesKey: string]: string | number;
}

export interface MonthlyChartDataResult {
  rows: MonthlyChartRow[];
  seriesKeys: string[];
}

export interface BucketCategoryBreakdownItem {
  categoryId: number;
  categoryName: string;
  amount: number;
  percentage: number;
}

export interface BucketCategoryBreakdownResult {
  bucketId: number;
  bucketName: string;
  periodLabel: string;
  totalAmount: number;
  items: BucketCategoryBreakdownItem[];
}

export type PeriodType = "month" | "quarter" | "year";

// Get date range for a specific period
export const getDateRangeForPeriod = (
  periodType: PeriodType,
  date: Date = new Date(),
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
  date: Date = new Date(),
): Promise<PeriodReport> => {
  const { start, end, label } = getDateRangeForPeriod(periodType, date);

  // Fetch all transactions in the date range
  const allTransactions = await db.transactions
    .where("date")
    .between(start, end)
    .toArray();

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

const parseMonthInput = (
  monthValue: string,
): { year: number; monthIndex: number } | null => {
  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return { year, monthIndex: month - 1 };
};

const getMonthLabel = (date: Date): string => {
  return date.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
};

const getMonthKey = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};

const getMonthSequence = (start: Date, end: Date): Date[] => {
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endMonth) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
};

export const getMonthlyChartData = async (
  options: MonthlyChartDataOptions,
): Promise<MonthlyChartDataResult> => {
  const parsedStart = parseMonthInput(options.startMonth);
  const parsedEnd = parseMonthInput(options.endMonth);

  if (!parsedStart || !parsedEnd) {
    return { rows: [], seriesKeys: [] };
  }

  const startDate = new Date(parsedStart.year, parsedStart.monthIndex, 1);
  const endDate = new Date(
    parsedEnd.year,
    parsedEnd.monthIndex + 1,
    0,
    23,
    59,
    59,
    999,
  );

  if (startDate > endDate) {
    return { rows: [], seriesKeys: [] };
  }

  const [transactions, categories] = await Promise.all([
    db.transactions.where("date").between(startDate, endDate).toArray(),
    db.categories.toArray(),
  ]);

  const categoriesById = new Map<number, { bucketId: number; name: string }>();
  categories.forEach((category) => {
    if (!category.id) {
      return;
    }

    categoriesById.set(category.id, {
      bucketId: category.bucketId,
      name: category.name || `Category ${category.id}`,
    });
  });

  const selectedCategoryIds = options.categoryIds.filter((id) =>
    Number.isFinite(id),
  );
  const selectedSet = new Set<number>(selectedCategoryIds);

  const seriesKeys =
    selectedCategoryIds.length === 0
      ? ["Total"]
      : selectedCategoryIds
          .map((categoryId) => categoriesById.get(categoryId)?.name)
          .filter((name): name is string => Boolean(name));

  const monthDates = getMonthSequence(startDate, endDate);
  const rows = monthDates.map((monthDate) => {
    const row: MonthlyChartRow = {
      month: getMonthLabel(monthDate),
      monthKey: getMonthKey(monthDate),
    };

    seriesKeys.forEach((key) => {
      row[key] = 0;
    });

    return row;
  });

  const rowByMonthKey = new Map(
    rows.map((row) => [row.monthKey as string, row]),
  );

  transactions.forEach((txn) => {
    const categoryMeta = categoriesById.get(txn.categoryId);
    if (!categoryMeta || categoryMeta.bucketId !== options.bucketId) {
      return;
    }

    if (selectedSet.size > 0 && !selectedSet.has(txn.categoryId)) {
      return;
    }

    const monthKey = getMonthKey(new Date(txn.date));
    const row = rowByMonthKey.get(monthKey);
    if (!row) {
      return;
    }

    const amount = txn.amount + (txn.transactionCost || 0);
    const seriesKey = selectedSet.size > 0 ? categoryMeta.name : "Total";
    const currentValue =
      typeof row[seriesKey] === "number" ? (row[seriesKey] as number) : 0;
    row[seriesKey] = currentValue + amount;
  });

  rows.forEach((row) => {
    seriesKeys.forEach((key) => {
      const value = row[key];
      if (typeof value === "number") {
        row[key] = Math.abs(value);
      }
    });
  });

  return { rows, seriesKeys };
};

export const getCategoryBreakdownForBucket = async (
  periodType: PeriodType,
  date: Date,
  bucketId: number,
): Promise<BucketCategoryBreakdownResult> => {
  const { start, end, label } = getDateRangeForPeriod(periodType, date);

  const [transactions, categories, buckets] = await Promise.all([
    db.transactions.where("date").between(start, end).toArray(),
    db.categories.toArray(),
    db.buckets.toArray(),
  ]);

  const bucket = buckets.find(
    (item) => item.id === bucketId && item.isActive && !item.excludeFromReports,
  );

  const bucketCategories = categories.filter(
    (category) =>
      category.id && category.bucketId === bucketId && category.isActive,
  );

  const categoryLookup = new Map(
    bucketCategories.map((category) => [category.id as number, category]),
  );
  const totalsByCategory = new Map<number, number>();

  transactions.forEach((txn) => {
    const category = categoryLookup.get(txn.categoryId);
    if (!category) {
      return;
    }

    const netAmount = txn.amount + (txn.transactionCost || 0);
    const current = totalsByCategory.get(category.id as number) || 0;
    totalsByCategory.set(category.id as number, current + netAmount);
  });

  const items = bucketCategories
    .map((category) => {
      const signedTotal = totalsByCategory.get(category.id as number) || 0;
      const amount = Math.abs(signedTotal);

      return {
        categoryId: category.id as number,
        categoryName: category.name || `Category ${category.id}`,
        amount,
      };
    })
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const itemsWithPercentages =
    totalAmount > 0
      ? items.map((item) => ({
          ...item,
          percentage: (item.amount / totalAmount) * 100,
        }))
      : [];

  return {
    bucketId,
    bucketName: bucket?.name || `Bucket ${bucketId}`,
    periodLabel: label,
    totalAmount,
    items: itemsWithPercentages,
  };
};

// Format number as comma-separated value
export const formatCurrency = (value: number): string => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

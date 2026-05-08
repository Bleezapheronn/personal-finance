import Dexie from "dexie";

// Define TypeScript interfaces for each table

export interface Transaction {
  id?: number;
  categoryId: number;
  paymentChannelId?: number; // UPDATED: Make optional (will be removed)
  accountId?: number; // NEW: Will replace paymentChannelId
  recipientId: number;
  date: Date;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  transactionReference?: string;
  transactionCost?: number;
  description?: string;
  transferPairId?: number;
  isTransfer?: boolean;
  budgetId?: number;
  occurrenceDate?: Date;
  budgetSnapshotId?: number;
}

export interface Budget {
  id?: number;
  description: string;
  categoryId: number;
  paymentChannelId?: number; // UPDATED: Make optional (will be removed)
  accountId?: number; // NEW: Will replace paymentChannelId
  recipientId?: number;
  amount: number;
  transactionCost?: number;
  frequency: "once" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
  frequencyDetails?: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalDays?: number;
  };
  isGoal: boolean;
  isFlexible: boolean;
  isActive: boolean;
  remainingCyclesTotal?: number | null;
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetSnapshot {
  id?: number;
  budgetId: number;
  occurrenceDate: Date;
  dueDate: Date;
  cycleIndex: number;
  description: string;
  categoryId: number;
  accountId?: number;
  recipientId?: number;
  amount: number;
  transactionCost?: number;
  frequency: "once" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
  frequencyDetails?: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalDays?: number;
  };
  isGoal: boolean;
  isFlexible: boolean;
  remainingCyclesTotal?: number | null;
  isHistorical: boolean;
  sourceBudgetUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Bucket {
  id?: number;
  name?: string;
  description?: string;
  minPercentage: number;
  maxPercentage: number;
  minFixedAmount?: number;
  isActive: boolean;
  displayOrder: number;
  excludeFromReports: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id?: number;
  name?: string;
  bucketId: number;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id?: number;
  name: string;
  description?: string;
  currency?: string;
  imageBlob?: Blob | null;
  isActive: boolean;
  isCredit: boolean;
  creditLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethod {
  id?: number;
  accountId: number;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Recipient {
  id?: number;
  name: string;
  aliases?: string; // NEW: Semi-colon separated list of aliases
  email?: string;
  phone?: string;
  tillNumber?: string;
  paybill?: string;
  accountNumber?: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsImportTemplate {
  id?: number;
  name: string;
  description?: string;
  paymentMethodId?: number; // UPDATED: Make optional (will be removed)
  accountId?: number; // NEW: Will replace paymentMethodId
  referencePattern?: string;
  amountPattern?: string;
  recipientNamePattern?: string;
  recipientPhonePattern?: string;
  dateTimePattern?: string;
  costPattern?: string;
  incomePattern?: string;
  expensePattern?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Define your database class with all tables

export class FinanceDB extends Dexie {
  transactions: Dexie.Table<Transaction, number>;
  budgets: Dexie.Table<Budget, number>;
  budgetSnapshots: Dexie.Table<BudgetSnapshot, number>;
  buckets: Dexie.Table<Bucket, number>;
  categories: Dexie.Table<Category, number>;
  accounts: Dexie.Table<Account, number>;
  paymentMethods: Dexie.Table<PaymentMethod, number>;
  recipients: Dexie.Table<Recipient, number>;
  smsImportTemplates: Dexie.Table<SmsImportTemplate, number>;

  constructor() {
    super("FinanceDB");

    this.version(12).stores({
      transactions:
        "++id, categoryId, paymentChannelId, recipientId, date, amount, originalAmount, originalCurrency, exchangeRate, transactionReference, description, transferPairId, isTransfer, budgetId, occurrenceDate",
      budgets:
        "++id, description, categoryId, paymentChannelId, dueDate, isGoal, isFlexible, isActive, frequency, createdAt, updatedAt",
      buckets:
        "++id, name, description, minPercentage, maxPercentage, minFixedAmount, isActive, displayOrder, excludeFromReports, createdAt, updatedAt",
      categories:
        "++id, name, bucketId, description, isActive, createdAt, updatedAt",
      accounts:
        "++id, name, currency, description, isActive, isCredit, creditLimit, createdAt, updatedAt",
      paymentMethods:
        "++id, accountId, name, description, isActive, createdAt, updatedAt",
      recipients:
        "++id, name, email, phone, tillNumber, paybill, accountNumber, isActive, createdAt, updatedAt",
      smsImportTemplates:
        "++id, name, paymentMethodId, description, isActive, createdAt, updatedAt",
    });

    this.version(13).stores({
      transactions:
        "++id, categoryId, paymentChannelId, recipientId, date, amount, originalAmount, originalCurrency, exchangeRate, transactionReference, description, transferPairId, isTransfer, budgetId, occurrenceDate, budgetSnapshotId",
      budgets:
        "++id, description, categoryId, paymentChannelId, dueDate, isGoal, isFlexible, isActive, frequency, remainingCyclesTotal, createdAt, updatedAt",
      budgetSnapshots:
        "++id, budgetId, occurrenceDate, dueDate, cycleIndex, [budgetId+occurrenceDate], isHistorical, createdAt, updatedAt",
      buckets:
        "++id, name, description, minPercentage, maxPercentage, minFixedAmount, isActive, displayOrder, excludeFromReports, createdAt, updatedAt",
      categories:
        "++id, name, bucketId, description, isActive, createdAt, updatedAt",
      accounts:
        "++id, name, currency, description, isActive, isCredit, creditLimit, createdAt, updatedAt",
      paymentMethods:
        "++id, accountId, name, description, isActive, createdAt, updatedAt",
      recipients:
        "++id, name, email, phone, tillNumber, paybill, accountNumber, isActive, createdAt, updatedAt",
      smsImportTemplates:
        "++id, name, paymentMethodId, description, isActive, createdAt, updatedAt",
    });

    this.transactions = this.table("transactions");
    this.budgets = this.table("budgets");
    this.budgetSnapshots = this.table("budgetSnapshots");
    this.buckets = this.table("buckets");
    this.categories = this.table("categories");
    this.accounts = this.table("accounts");
    this.paymentMethods = this.table("paymentMethods");
    this.recipients = this.table("recipients");
    this.smsImportTemplates = this.table("smsImportTemplates");
  }
}

// NEW: Migration function to convert PaymentMethods to AccountIds
export const migratePaymentMethodsToAccounts = async (): Promise<{
  transactionsMigrated: number;
  transactionsOrphaned: number;
  budgetsMigrated: number;
  budgetsOrphaned: number;
  smsTemplatesMigrated: number;
  smsTemplatesOrphaned: number;
  paymentMethodsDeleted: number;
  totalMigrated: number;
}> => {
  const results = {
    transactionsMigrated: 0,
    transactionsOrphaned: 0,
    budgetsMigrated: 0,
    budgetsOrphaned: 0,
    smsTemplatesMigrated: 0,
    smsTemplatesOrphaned: 0,
    paymentMethodsDeleted: 0,
    totalMigrated: 0,
  };

  try {
    console.log(
      "🚀 Starting Payment Methods to Accounts migration (Phase 7)...",
    );

    // Step 1: Migrate Transactions
    console.log("📋 Migrating Transactions...");
    const allTransactions = await db.transactions.toArray();
    const paymentMethods = await db.paymentMethods.toArray();

    for (const transaction of allTransactions) {
      if (transaction.paymentChannelId && !transaction.accountId) {
        const paymentMethod = paymentMethods.find(
          (pm) => pm.id === transaction.paymentChannelId,
        );

        if (paymentMethod && paymentMethod.accountId) {
          // Update transaction: add accountId
          await db.transactions.update(transaction.id!, {
            accountId: paymentMethod.accountId,
          });
          results.transactionsMigrated++;
        } else {
          console.warn(
            `⚠️ Orphaned transaction ${transaction.id}: PaymentMethod ${transaction.paymentChannelId} not found`,
          );
          results.transactionsOrphaned++;
        }
      }
    }
    console.log(
      `✅ Migrated ${results.transactionsMigrated} transactions (${results.transactionsOrphaned} orphaned)`,
    );

    // Step 2: Migrate Budgets
    console.log("📋 Migrating Budgets...");
    const allBudgets = await db.budgets.toArray();

    for (const budget of allBudgets) {
      if (budget.paymentChannelId && !budget.accountId) {
        const paymentMethod = paymentMethods.find(
          (pm) => pm.id === budget.paymentChannelId,
        );

        if (paymentMethod && paymentMethod.accountId) {
          // Update budget: add accountId
          await db.budgets.update(budget.id!, {
            accountId: paymentMethod.accountId,
          });
          results.budgetsMigrated++;
        } else {
          console.warn(
            `⚠️ Orphaned budget ${budget.id}: PaymentMethod ${budget.paymentChannelId} not found`,
          );
          results.budgetsOrphaned++;
        }
      }
    }
    console.log(
      `✅ Migrated ${results.budgetsMigrated} budgets (${results.budgetsOrphaned} orphaned)`,
    );

    // Step 3: Migrate SMS Import Templates
    console.log("📋 Migrating SMS Import Templates...");
    const allSmsTemplates = await db.smsImportTemplates.toArray();

    for (const template of allSmsTemplates) {
      if (template.paymentMethodId && !template.accountId) {
        const paymentMethod = paymentMethods.find(
          (pm) => pm.id === template.paymentMethodId,
        );

        if (paymentMethod && paymentMethod.accountId) {
          // Update template: add accountId
          await db.smsImportTemplates.update(template.id!, {
            accountId: paymentMethod.accountId,
          });
          results.smsTemplatesMigrated++;
        } else {
          console.warn(
            `⚠️ Orphaned SMS template ${template.id}: PaymentMethod ${template.paymentMethodId} not found`,
          );
          results.smsTemplatesOrphaned++;
        }
      }
    }
    console.log(
      `✅ Migrated ${results.smsTemplatesMigrated} SMS templates (${results.smsTemplatesOrphaned} orphaned)`,
    );

    // Step 4: Delete all PaymentMethod records
    console.log("🗑️ Deleting PaymentMethod records...");
    results.paymentMethodsDeleted = await db.paymentMethods.count();
    await db.paymentMethods.clear();
    console.log(`✅ Deleted ${results.paymentMethodsDeleted} payment methods`);

    results.totalMigrated =
      results.transactionsMigrated +
      results.budgetsMigrated +
      results.smsTemplatesMigrated;

    console.log("🎉 Payment Methods migration complete!");
    console.log(
      `📊 Summary: ${results.totalMigrated} records migrated, ${
        results.transactionsOrphaned +
        results.budgetsOrphaned +
        results.smsTemplatesOrphaned
      } orphaned`,
    );

    return results;
  } catch (error) {
    console.error("❌ Error during Payment Methods migration:", error);
    throw error;
  }
};

const normalizeToDay = (value: Date): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getNextOccurrenceDate = (currentDate: Date, budget: Budget): Date => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const day = currentDate.getDate();

  let nextYear = year;
  let nextMonth = month;
  let nextDay = day;

  switch (budget.frequency) {
    case "daily":
      nextDay += 1;
      break;
    case "weekly":
      nextDay += 7;
      break;
    case "monthly":
      if (budget.frequencyDetails?.dayOfMonth) {
        const requestedDay = budget.frequencyDetails.dayOfMonth;
        nextMonth += 1;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear += 1;
        }
        const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
        nextDay = Math.min(requestedDay, lastDayOfMonth);
      }
      break;
    case "yearly":
      nextYear += 1;
      break;
    case "custom":
      if (budget.frequencyDetails?.intervalDays) {
        nextDay += budget.frequencyDetails.intervalDays;
      }
      break;
    default:
      break;
  }

  return new Date(nextYear, nextMonth, nextDay);
};

const getFiniteCycles = (budget: Budget): number => {
  if (
    budget.remainingCyclesTotal === null ||
    budget.remainingCyclesTotal === undefined
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (budget.remainingCyclesTotal < 1) {
    return 0;
  }

  return budget.remainingCyclesTotal;
};

export const ensureBudgetSnapshotForOccurrence = async (
  budget: Budget,
  occurrenceDateInput: Date,
  options?: {
    cycleIndex?: number;
    isHistorical?: boolean;
  },
): Promise<BudgetSnapshot> => {
  if (!budget.id) {
    throw new Error("Cannot create snapshot for budget without id");
  }

  const occurrenceDate = normalizeToDay(occurrenceDateInput);

  const existing = await db.budgetSnapshots
    .where("[budgetId+occurrenceDate]")
    .equals([budget.id, occurrenceDate])
    .first();

  if (existing) {
    return existing;
  }

  const now = new Date();
  const snapshot: Omit<BudgetSnapshot, "id"> = {
    budgetId: budget.id,
    occurrenceDate,
    dueDate: occurrenceDate,
    cycleIndex: options?.cycleIndex ?? 0,
    description: budget.description,
    categoryId: budget.categoryId,
    accountId: budget.accountId,
    recipientId: budget.recipientId,
    amount: budget.amount,
    transactionCost: budget.transactionCost,
    frequency: budget.frequency,
    frequencyDetails: budget.frequencyDetails,
    isGoal: budget.isGoal,
    isFlexible: budget.isFlexible,
    remainingCyclesTotal: budget.remainingCyclesTotal ?? null,
    isHistorical: options?.isHistorical ?? occurrenceDate < normalizeToDay(now),
    sourceBudgetUpdatedAt: budget.updatedAt,
    createdAt: now,
    updatedAt: now,
  };

  const id = await db.budgetSnapshots.add(snapshot);
  return {
    ...snapshot,
    id,
  };
};

const getClosestOccurrenceAtOrBefore = (
  budget: Budget,
  targetDateInput: Date,
): { occurrenceDate: Date; cycleIndex: number } => {
  const start = normalizeToDay(budget.dueDate);
  const targetDate = normalizeToDay(targetDateInput);
  const maxCycles = getFiniteCycles(budget);

  if (budget.frequency === "once" || maxCycles <= 1) {
    return { occurrenceDate: start, cycleIndex: 1 };
  }

  let occurrenceDate = new Date(start);
  let cycleIndex = 1;
  let guard = 0;

  while (occurrenceDate <= targetDate && cycleIndex < maxCycles) {
    guard += 1;
    const nextOccurrence = normalizeToDay(
      getNextOccurrenceDate(occurrenceDate, budget),
    );

    if (nextOccurrence > targetDate) {
      break;
    }

    occurrenceDate = nextOccurrence;
    cycleIndex += 1;

    if (guard > 5000) {
      break;
    }
  }

  return { occurrenceDate, cycleIndex };
};

export const migrateBudgetSnapshots = async (): Promise<{
  budgetsProcessed: number;
  snapshotsCreated: number;
  transactionsLinked: number;
}> => {
  const summary = {
    budgetsProcessed: 0,
    snapshotsCreated: 0,
    transactionsLinked: 0,
  };

  try {
    const allBudgets = await db.budgets.toArray();
    const today = normalizeToDay(new Date());

    for (const budget of allBudgets) {
      if (!budget.id) {
        continue;
      }

      summary.budgetsProcessed += 1;

      const maxCycles = getFiniteCycles(budget);
      if (maxCycles === 0) {
        continue;
      }

      let occurrenceDate = normalizeToDay(budget.dueDate);
      let cycleIndex = 1;
      let guard = 0;

      while (occurrenceDate <= today && cycleIndex <= maxCycles) {
        const existing = await db.budgetSnapshots
          .where("[budgetId+occurrenceDate]")
          .equals([budget.id, occurrenceDate])
          .first();

        if (!existing) {
          await ensureBudgetSnapshotForOccurrence(budget, occurrenceDate, {
            cycleIndex,
            isHistorical: true,
          });
          summary.snapshotsCreated += 1;
        }

        if (budget.frequency === "once") {
          break;
        }

        occurrenceDate = normalizeToDay(
          getNextOccurrenceDate(occurrenceDate, budget),
        );
        cycleIndex += 1;

        guard += 1;
        if (guard > 5000) {
          break;
        }
      }
    }

    const budgetMap = new Map<number, Budget>();
    allBudgets.forEach((b) => {
      if (b.id) {
        budgetMap.set(b.id, b);
      }
    });

    const transactionsNeedingSnapshot = await db.transactions
      .filter((txn) => !!txn.budgetId && !txn.budgetSnapshotId)
      .toArray();

    for (const txn of transactionsNeedingSnapshot) {
      if (!txn.id || !txn.budgetId) {
        continue;
      }

      const budget = budgetMap.get(txn.budgetId);
      if (!budget) {
        continue;
      }

      const target = txn.occurrenceDate
        ? getClosestOccurrenceAtOrBefore(budget, txn.occurrenceDate)
        : getClosestOccurrenceAtOrBefore(budget, txn.date);

      const snapshot = await ensureBudgetSnapshotForOccurrence(
        budget,
        target.occurrenceDate,
        {
          cycleIndex: target.cycleIndex,
          isHistorical: target.occurrenceDate < today,
        },
      );

      await db.transactions.update(txn.id, {
        budgetSnapshotId: snapshot.id,
        occurrenceDate: target.occurrenceDate,
      });

      summary.transactionsLinked += 1;
    }

    return summary;
  } catch (error) {
    console.error("❌ Error during budget snapshot migration:", error);
    throw error;
  }
};

// NEW: Migration function to fix undefined isActive states
export const migrateIsActiveStates = async (): Promise<{
  accountsUpdated: number;
  recipientsUpdated: number;
  categoriesUpdated: number;
  bucketsUpdated: number;
  paymentMethodsUpdated: number;
  smsTemplatesUpdated: number;
  totalUpdated: number;
}> => {
  const results = {
    accountsUpdated: 0,
    recipientsUpdated: 0,
    categoriesUpdated: 0,
    bucketsUpdated: 0,
    paymentMethodsUpdated: 0,
    smsTemplatesUpdated: 0,
    totalUpdated: 0,
  };

  try {
    console.log("🔄 Starting isActive migration...");

    // Migrate Accounts
    const allAccounts = await db.accounts.toArray();
    const accountsWithUndefinedActive = allAccounts.filter(
      (acc) => acc.isActive === undefined,
    );

    if (accountsWithUndefinedActive.length > 0) {
      for (const account of accountsWithUndefinedActive) {
        await db.accounts.update(account.id!, { isActive: true });
      }
      results.accountsUpdated = accountsWithUndefinedActive.length;
      console.log(
        `✅ Updated ${accountsWithUndefinedActive.length} accounts with isActive = true`,
      );
    }

    // Migrate Recipients
    const allRecipients = await db.recipients.toArray();
    const recipientsWithUndefinedActive = allRecipients.filter(
      (rec) => rec.isActive === undefined,
    );

    if (recipientsWithUndefinedActive.length > 0) {
      for (const recipient of recipientsWithUndefinedActive) {
        await db.recipients.update(recipient.id!, { isActive: true });
      }
      results.recipientsUpdated = recipientsWithUndefinedActive.length;
      console.log(
        `✅ Updated ${recipientsWithUndefinedActive.length} recipients with isActive = true`,
      );
    }

    // Migrate Categories
    const allCategories = await db.categories.toArray();
    const categoriesWithUndefinedActive = allCategories.filter(
      (cat) => cat.isActive === undefined,
    );

    if (categoriesWithUndefinedActive.length > 0) {
      for (const category of categoriesWithUndefinedActive) {
        await db.categories.update(category.id!, { isActive: true });
      }
      results.categoriesUpdated = categoriesWithUndefinedActive.length;
      console.log(
        `✅ Updated ${categoriesWithUndefinedActive.length} categories with isActive = true`,
      );
    }

    // Migrate Buckets
    const allBuckets = await db.buckets.toArray();
    const bucketsWithUndefinedActive = allBuckets.filter(
      (bkt) => bkt.isActive === undefined,
    );

    if (bucketsWithUndefinedActive.length > 0) {
      for (const bucket of bucketsWithUndefinedActive) {
        await db.buckets.update(bucket.id!, { isActive: true });
      }
      results.bucketsUpdated = bucketsWithUndefinedActive.length;
      console.log(
        `✅ Updated ${bucketsWithUndefinedActive.length} buckets with isActive = true`,
      );
    }

    // Migrate Payment Methods
    const allPaymentMethods = await db.paymentMethods.toArray();
    const paymentMethodsWithUndefinedActive = allPaymentMethods.filter(
      (pm) => pm.isActive === undefined,
    );

    if (paymentMethodsWithUndefinedActive.length > 0) {
      for (const method of paymentMethodsWithUndefinedActive) {
        await db.paymentMethods.update(method.id!, { isActive: true });
      }
      results.paymentMethodsUpdated = paymentMethodsWithUndefinedActive.length;
      console.log(
        `✅ Updated ${paymentMethodsWithUndefinedActive.length} payment methods with isActive = true`,
      );
    }

    // Migrate SMS Import Templates
    const allSmsTemplates = await db.smsImportTemplates.toArray();
    const smsTemplatesWithUndefinedActive = allSmsTemplates.filter(
      (tpl) => tpl.isActive === undefined,
    );

    if (smsTemplatesWithUndefinedActive.length > 0) {
      for (const template of smsTemplatesWithUndefinedActive) {
        await db.smsImportTemplates.update(template.id!, { isActive: true });
      }
      results.smsTemplatesUpdated = smsTemplatesWithUndefinedActive.length;
      console.log(
        `✅ Updated ${smsTemplatesWithUndefinedActive.length} SMS templates with isActive = true`,
      );
    }

    results.totalUpdated =
      results.accountsUpdated +
      results.recipientsUpdated +
      results.categoriesUpdated +
      results.bucketsUpdated +
      results.paymentMethodsUpdated +
      results.smsTemplatesUpdated;

    if (results.totalUpdated === 0) {
      console.log("✨ No undefined isActive states found. Database is clean!");
    } else {
      console.log(
        `🎉 Migration complete! Fixed ${results.totalUpdated} records with undefined isActive states.`,
      );
    }

    return results;
  } catch (error) {
    console.error("❌ Error during isActive migration:", error);
    throw error;
  }
};

// Export a singleton db instance
export const db = new FinanceDB();

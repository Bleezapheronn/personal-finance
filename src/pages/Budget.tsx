import React, { useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonIcon,
  useIonViewWillEnter,
  IonCard,
  IonCardContent,
  IonGrid,
  IonRow,
  IonCol,
  IonText,
  IonSpinner,
  IonProgressBar,
  IonAlert,
  IonToast,
  IonList,
  IonItem,
  IonChip,
  IonLabel,
  IonFab,
  IonFabButton,
  IonButton,
  IonAvatar,
  IonImg,
} from "@ionic/react";
import {
  addOutline,
  checkmarkCircle,
  createOutline,
  trashOutline,
  arrowUpCircle,
  arrowDownCircle,
  linkOutline,
  bag,
  chevronBack,
  chevronForward,
  downloadOutline,
  cloudUploadOutline,
} from "ionicons/icons";
import {
  db,
  Budget,
  Category,
  Bucket,
  Recipient,
  Transaction,
  Account,
} from "../db";
import { CompleteBudgetModal } from "../components/CompleteBudgetModal";
import { LinkPastTransactionsModal } from "../components/LinkPastTransactionsModal";
import { findMatchingTransactions } from "../utils/transactionMatching";
import {
  exportBudgetsToCSV,
  downloadBudgetsCSV,
} from "../utils/budgetCsvExport";
import { ImportModal } from "../components/ImportModal";
import "./Budget.css";

interface BudgetOccurrence {
  budgetId: number;
  budget: Budget;
  dueDate: Date;
  amountPaid: number;
  isCompleted: boolean;
  timeGroup: string;
  linkedTransactions: Transaction[];
}

const BudgetPage: React.FC = () => {
  const history = useHistory();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountImages, setAccountImages] = useState<Map<number, string>>(
    new Map()
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<number | undefined>(
    undefined
  );
  const [budgetDeleteHasTransactions, setBudgetDeleteHasTransactions] =
    useState(false);

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedBudgetForCompletion, setSelectedBudgetForCompletion] =
    useState<BudgetOccurrence | null>(null);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [matchingTransactionsForLink, setMatchingTransactionsForLink] =
    useState<Transaction[]>([]);
  const [budgetIdForLinking, setBudgetIdForLinking] = useState<
    number | undefined
  >(undefined);
  const [budgetOccurrenceDateForLinking, setBudgetOccurrenceDateForLinking] =
    useState<Date | undefined>(undefined);

  // New state variables for budget period
  const [budgetSummaryPeriod, setBudgetSummaryPeriod] = useState<
    "month" | "quarter" | "year"
  >("month");

  // Add this state near the top with other state variables
  const [currentGoalIndex, setCurrentGoalIndex] = useState(0);

  // Load all data
  useIonViewWillEnter(() => {
    loadData();
  });

  // Migrate existing transactions to populate occurrenceDate
  const migrateTransactionOccurrenceDates = async () => {
    try {
      const allTransactions = await db.transactions.toArray();
      const allBudgets = await db.budgets.toArray();

      for (const txn of allTransactions) {
        // Skip if already has occurrenceDate
        if (txn.budgetId && !txn.occurrenceDate) {
          const budget = allBudgets.find((b) => b.id === txn.budgetId);
          if (budget) {
            // Find which occurrence this transaction belongs to
            // Default: match to the nearest due date at or before the transaction date
            let occurrenceDate = new Date(budget.dueDate);
            occurrenceDate.setHours(0, 0, 0, 0);

            const txnDate = new Date(txn.date);
            txnDate.setHours(0, 0, 0, 0);

            if (budget.frequency === "once") {
              // Single occurrence - use the budget's due date
              occurrenceDate = new Date(budget.dueDate);
              occurrenceDate.setHours(0, 0, 0, 0);
            } else {
              // Recurring budget - find the occurrence this transaction belongs to
              // Use the nearest occurrence at or before the transaction date
              let currentDueDate = new Date(budget.dueDate);
              currentDueDate.setHours(0, 0, 0, 0);

              let occurrenceCount = 0;
              while (currentDueDate <= txnDate) {
                occurrenceCount++;

                occurrenceDate = new Date(currentDueDate);
                currentDueDate = getNextOccurrence(currentDueDate, budget);

                // Safety check to prevent infinite loops
                if (occurrenceCount > 50) {
                  break;
                }
              }
            }

            // Update transaction with occurrence date
            await db.transactions.update(txn.id!, {
              occurrenceDate,
            });
          }
        }
      }
    } catch (err) {
      console.error("Error during migration:", err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // Run migration on first load
      await migrateTransactionOccurrenceDates();

      const [b, txns, cats, bkts, recs, accs] = await Promise.all([
        db.budgets.toArray(),
        db.transactions.toArray(),
        db.categories.toArray(),
        db.buckets.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
      ]);

      setBudgets(b);
      setTransactions(txns);
      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);

      // Convert account image blobs to URLs
      const imageMap = new Map<number, string>();
      for (const acc of accs) {
        if (acc.id && acc.imageBlob) {
          const url = URL.createObjectURL(acc.imageBlob);
          imageMap.set(acc.id, url);
        }
      }
      setAccountImages(imageMap);

      setError("");
    } catch (err) {
      console.error("Failed to load budget data:", err);
      setError("Failed to load budgets");
    } finally {
      setLoading(false);
    }
  };

  // Calculate amount paid for a specific budget occurrence
  const getAmountPaidForOccurrence = (
    budgetId: number,
    occurrenceDate: Date
  ): number => {
    return transactions
      .filter(
        (txn) =>
          txn.budgetId === budgetId &&
          txn.occurrenceDate &&
          new Date(txn.occurrenceDate).getTime() === occurrenceDate.getTime()
      )
      .reduce((sum, txn) => sum + txn.amount + (txn.transactionCost || 0), 0);
  };

  // Get linked transactions for a specific occurrence
  const getLinkedTransactionsForOccurrence = (
    budgetId: number,
    occurrenceDate: Date
  ): Transaction[] => {
    return transactions.filter(
      (txn) =>
        txn.budgetId === budgetId &&
        txn.occurrenceDate &&
        new Date(txn.occurrenceDate).getTime() === occurrenceDate.getTime()
    );
  };

  // Generate budget occurrences for next 12 months
  const generateBudgetOccurrences = (): BudgetOccurrence[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneYearFromNow = new Date(today);
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const occurrences: BudgetOccurrence[] = [];

    budgets
      .filter((budget) => budget.isActive)
      .forEach((budget) => {
        if (budget.frequency === "once") {
          // Single occurrence
          const dueDate = new Date(budget.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          const amountPaid = getAmountPaidForOccurrence(budget.id!, dueDate);
          const isCompleted =
            budget.amount < 0
              ? amountPaid <= budget.amount
              : amountPaid >= budget.amount;

          occurrences.push({
            budgetId: budget.id!,
            budget,
            dueDate,
            amountPaid,
            isCompleted,
            timeGroup: getTimeGroup(dueDate),
            linkedTransactions: getLinkedTransactionsForOccurrence(
              budget.id!,
              dueDate
            ),
          });
        } else {
          // Recurring budget - generate all occurrences
          let currentDueDate = new Date(budget.dueDate);
          currentDueDate.setHours(0, 0, 0, 0);

          let occurrenceCount = 0;
          while (currentDueDate <= oneYearFromNow) {
            occurrenceCount++;

            const amountPaid = getAmountPaidForOccurrence(
              budget.id!,
              currentDueDate
            );
            const isCompleted =
              budget.amount < 0
                ? amountPaid <= budget.amount
                : amountPaid >= budget.amount;

            occurrences.push({
              budgetId: budget.id!,
              budget,
              dueDate: new Date(currentDueDate),
              amountPaid,
              isCompleted,
              timeGroup: getTimeGroup(currentDueDate),
              linkedTransactions: getLinkedTransactionsForOccurrence(
                budget.id!,
                currentDueDate
              ),
            });

            // Calculate next occurrence
            currentDueDate = getNextOccurrence(currentDueDate, budget);

            // Safety check to prevent infinite loops
            if (occurrenceCount > 50) {
              break;
            }
          }
        }
      });

    return occurrences;
  };

  // Calculate next occurrence based on frequency with intelligent month boundary handling
  const getNextOccurrence = (currentDate: Date, budget: Budget): Date => {
    // Extract date parts in UTC to avoid timezone issues
    const year = currentDate.getUTCFullYear();
    const month = currentDate.getUTCMonth();
    const day = currentDate.getUTCDate();

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

          // Move to next month
          nextMonth += 1;
          if (nextMonth > 11) {
            nextMonth = 0;
            nextYear += 1;
          }

          // Get the last day of the new month
          const lastDayOfMonth = new Date(
            Date.UTC(nextYear, nextMonth + 1, 0)
          ).getUTCDate();

          // Use the requested day or last day of month, whichever is smaller
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
    }

    // Create new date using UTC to avoid timezone issues
    const next = new Date(Date.UTC(nextYear, nextMonth, nextDay));

    return next;
  };

  // Group occurrences by time period
  const getTimeGroup = (dateObj: Date): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayDay = today.getDay();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - todayDay);

    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setDate(thisWeekStart.getDate() + 7);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Overdue
    if (dateObj < today) {
      return "Overdue";
    }
    // This Week
    else if (dateObj >= thisWeekStart && dateObj < nextWeekStart) {
      return "This Week";
    }
    // Next Week
    else if (dateObj >= nextWeekStart) {
      const weekAfterNext = new Date(nextWeekStart);
      weekAfterNext.setDate(nextWeekStart.getDate() + 7);
      if (dateObj < weekAfterNext) {
        return "Next Week";
      }
    }
    // This Month
    if (
      dateObj >= monthStart &&
      dateObj <= monthEnd &&
      dateObj.getMonth() === today.getMonth()
    ) {
      return "This Month";
    }

    // Future months
    return dateObj.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  // Filter and group occurrences with proper sorting
  const groupedOccurrences = () => {
    const occurrences = generateBudgetOccurrences();
    const groups = new Map<string, BudgetOccurrence[]>();
    const groupOrder = ["Overdue", "This Week", "Next Week", "This Month"];

    occurrences.forEach((occ) => {
      // Skip completed occurrences in the Overdue group
      if (occ.timeGroup === "Overdue" && occ.isCompleted) {
        return;
      }

      // Skip flexible budgets in the Overdue group
      if (occ.timeGroup === "Overdue" && occ.budget.isFlexible) {
        return;
      }

      if (!groups.has(occ.timeGroup)) {
        groups.set(occ.timeGroup, []);
      }
      groups.get(occ.timeGroup)!.push(occ);
    });

    // Sort occurrences within each group
    const sortOccurrences = (occs: BudgetOccurrence[]): BudgetOccurrence[] => {
      return occs.sort((a, b) => {
        // 1. Primary sort: Date ascending (earliest first)
        const dateCompare = a.dueDate.getTime() - b.dueDate.getTime();
        if (dateCompare !== 0) return dateCompare;

        // 2. Secondary sort: Budget amount
        // Income first (positive amounts, ascending by absolute value)
        // Then expenses (negative amounts, ascending by absolute value)
        const aIsIncome = a.budget.amount >= 0;
        const bIsIncome = b.budget.amount >= 0;

        // If one is income and one is expense, income comes first
        if (aIsIncome !== bIsIncome) {
          return aIsIncome ? -1 : 1;
        }

        // Both income or both expense - sort by absolute value ascending
        const aAbsAmount = Math.abs(a.budget.amount);
        const bAbsAmount = Math.abs(b.budget.amount);
        const amountCompare = aAbsAmount - bAbsAmount;
        if (amountCompare !== 0) return amountCompare;

        // 3. Tertiary sort: Description (A-Z)
        return a.budget.description.localeCompare(b.budget.description);
      });
    };

    const sortedGroups: Array<[string, BudgetOccurrence[]]> = [];

    // Add fixed groups in order
    groupOrder.forEach((group) => {
      if (groups.has(group)) {
        const sortedOccs = sortOccurrences(groups.get(group)!);
        sortedGroups.push([group, sortedOccs]);
      }
    });

    // Add future months in chronological order
    const futureGroups = Array.from(groups.entries())
      .filter(([group]) => !groupOrder.includes(group))
      .sort((a, b) => {
        const dateA = new Date(a[0] + " 1");
        const dateB = new Date(b[0] + " 1");
        return dateA.getTime() - dateB.getTime();
      })
      .map(
        ([group, occs]) =>
          [group, sortOccurrences(occs)] as [string, BudgetOccurrence[]]
      );

    sortedGroups.push(...futureGroups);

    return sortedGroups;
  };

  // Get active goals
  const getActiveGoals = (): BudgetOccurrence[] => {
    const occurrences = generateBudgetOccurrences();
    return occurrences
      .filter((occ) => occ.budget.isGoal && !occ.isCompleted)
      .slice(0, 2); // Show max 2 goals
  };

  // Get most recent completed goal
  const getMostRecentCompletedGoal = (): BudgetOccurrence | null => {
    const occurrences = generateBudgetOccurrences();
    const completedGoals = occurrences
      .filter((occ) => occ.budget.isGoal && occ.isCompleted)
      .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());

    return completedGoals.length > 0 ? completedGoals[0] : null;
  };

  // Handle delete click
  const handleDeleteClick = (budgetId: number) => {
    const linkedTxns = transactions.filter((txn) => txn.budgetId === budgetId);
    setBudgetDeleteHasTransactions(linkedTxns.length > 0);
    setBudgetToDelete(budgetId);
    setShowDeleteConfirm(true);
  };

  // Handle delete confirmation
  const handleConfirmDelete = async () => {
    if (budgetToDelete === undefined) return;

    try {
      if (budgetDeleteHasTransactions) {
        // Has linked transactions - deactivate instead
        const budget = budgets.find((b) => b.id === budgetToDelete);
        if (budget) {
          await db.budgets.update(budgetToDelete, { isActive: false });
          setSuccessMsg("Budget deactivated (has linked transactions)");
        }
      } else {
        // No linked transactions - delete
        await db.budgets.delete(budgetToDelete);
        setSuccessMsg("Budget deleted successfully");
      }

      setShowSuccessToast(true);
      loadData();
      setShowDeleteConfirm(false);
      setBudgetToDelete(undefined);
    } catch (err) {
      console.error("Error deleting budget:", err);
      setError("Failed to delete budget");
    }
  };

  // Handle link past transactions
  const handleOpenLinkModal = (budgetOccurrence: BudgetOccurrence) => {
    const budget = budgets.find((b) => b.id === budgetOccurrence.budgetId);
    if (!budget) return;

    const matching = findMatchingTransactions(
      transactions,
      budget.description,
      budget.categoryId,
      budget.recipientId
    );

    if (matching.length === 0) {
      setError("No unlinked transactions found matching this budget");
      return;
    }

    setMatchingTransactionsForLink(matching);
    setBudgetIdForLinking(budgetOccurrence.budgetId);
    setBudgetOccurrenceDateForLinking(budgetOccurrence.dueDate);
    setShowLinkModal(true);
  };

  const handleLinkTransactions = async (
    transactionIds: number[],
    occurrenceDate: Date
  ) => {
    if (budgetIdForLinking === undefined) return;

    try {
      // Update all selected transactions with the budgetId and occurrenceDate
      for (const txnId of transactionIds) {
        await db.transactions.update(txnId, {
          budgetId: budgetIdForLinking,
          occurrenceDate,
        });
      }

      setSuccessMsg(
        `Successfully linked ${transactionIds.length} transaction${
          transactionIds.length !== 1 ? "s" : ""
        } to budget`
      );
      setShowSuccessToast(true);
      loadData();
      setShowLinkModal(false);
      setBudgetIdForLinking(undefined);
      setBudgetOccurrenceDateForLinking(undefined);
      setMatchingTransactionsForLink([]);
    } catch (err) {
      console.error("Error linking transactions:", err);
      setError("Failed to link transactions");
    }
  };

  // Helper functions
  const getCategoryName = (categoryId: number) =>
    categories.find((c) => c.id === categoryId)?.name || "—";

  const getBucketName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    return buckets.find((b) => b.id === cat?.bucketId)?.name || "";
  };

  // CHANGED: Simplified to get account directly from accountId
  const getAccountName = (accountId: number | undefined): string => {
    if (!accountId) return "—";
    return accounts.find((a) => a.id === accountId)?.name || "—";
  };

  // CHANGED: Simplified to get account image directly from accountId
  const getAccountImage = (
    accountId: number | undefined
  ): string | undefined => {
    if (!accountId || !accountImages.has(accountId)) {
      return undefined;
    }
    return accountImages.get(accountId);
  };

  const getRecipientName = (recipientId?: number) =>
    recipientId
      ? recipients.find((r) => r.id === recipientId)?.name || "—"
      : "—";

  const getProgressPercentage = (occ: BudgetOccurrence): number => {
    const budget = occ.budget;
    const totalBudgetAmount = budget.amount + (budget.transactionCost || 0);

    if (totalBudgetAmount === 0) return 0;

    if (totalBudgetAmount < 0) {
      // Expense: progress toward negative goal
      return Math.min(
        100,
        Math.abs((occ.amountPaid / totalBudgetAmount) * 100)
      );
    } else {
      // Income: progress toward positive goal
      return Math.min(100, (occ.amountPaid / totalBudgetAmount) * 100);
    }
  };

  const getBudgetPeriodBoundaries = (
    period: "month" | "quarter" | "year"
  ): { start: Date; end: Date; label: string } => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    switch (period) {
      case "month": {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        const label = today.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });
        return { start, end, label };
      }
      case "quarter": {
        const quarterMonth = Math.floor(month / 3) * 3;
        const start = new Date(year, quarterMonth, 1);
        const end = new Date(year, quarterMonth + 3, 0);
        const quarterNum = Math.floor(month / 3) + 1;
        const label = `Q${quarterNum} ${year}`;
        return { start, end, label };
      }
      case "year": {
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        const label = year.toString();
        return { start, end, label };
      }
    }
  };

  const calculateBudgetedAmounts = (
    period: "month" | "quarter" | "year"
  ): {
    totalExpense: number;
    totalIncome: number;
    expensePaid: number;
    incomePaid: number;
  } => {
    const { start, end } = getBudgetPeriodBoundaries(period);

    let totalExpense = 0;
    let totalIncome = 0;
    let expensePaid = 0;
    let incomePaid = 0;

    // Get all occurrences for this period
    const occurrences = generateBudgetOccurrences();

    occurrences.forEach((occ) => {
      const occDate = new Date(occ.dueDate);
      occDate.setHours(0, 0, 0, 0);

      // Check if occurrence falls within the period
      if (occDate >= start && occDate <= end) {
        const budgetAmount =
          occ.budget.amount + (occ.budget.transactionCost || 0);

        if (budgetAmount < 0) {
          // Expense
          totalExpense += Math.abs(budgetAmount);
          expensePaid += Math.abs(occ.amountPaid);
        } else {
          // Income
          totalIncome += budgetAmount;
          incomePaid += occ.amountPaid;
        }
      }
    });

    return { totalExpense, totalIncome, expensePaid, incomePaid };
  };

  const handleBudgetPeriodPrevious = () => {
    if (budgetSummaryPeriod === "quarter") {
      setBudgetSummaryPeriod("month");
    } else if (budgetSummaryPeriod === "year") {
      setBudgetSummaryPeriod("quarter");
    }
  };

  const handleBudgetPeriodNext = () => {
    if (budgetSummaryPeriod === "month") {
      setBudgetSummaryPeriod("quarter");
    } else if (budgetSummaryPeriod === "quarter") {
      setBudgetSummaryPeriod("year");
    }
  };

  const BudgetSummaryCard = () => {
    const { label } = getBudgetPeriodBoundaries(budgetSummaryPeriod);
    const { totalExpense, totalIncome, expensePaid, incomePaid } =
      calculateBudgetedAmounts(budgetSummaryPeriod);

    const netBudgeted = totalIncome - totalExpense;
    const netPaid = incomePaid - expensePaid;

    const expensePercentage =
      totalExpense > 0 ? Math.min((expensePaid / totalExpense) * 100, 100) : 0;
    const incomePercentage =
      totalIncome > 0 ? Math.min((incomePaid / totalIncome) * 100, 100) : 0;

    const netColor =
      netBudgeted > 0 ? "positive" : netBudgeted < 0 ? "negative" : "neutral";

    const isAtStart = budgetSummaryPeriod === "month";
    const isAtEnd = budgetSummaryPeriod === "year";

    return (
      <IonCard className="budget-summary-card">
        <IonCardContent>
          {/* Period Selector - Three Option Progression */}
          <div className="period-selector">
            <IonButton
              fill="clear"
              size="small"
              onClick={handleBudgetPeriodPrevious}
              disabled={isAtStart}
            >
              <IonIcon icon={chevronBack} />
            </IonButton>

            <div className="period-label">{label}</div>

            <IonButton
              fill="clear"
              size="small"
              onClick={handleBudgetPeriodNext}
              disabled={isAtEnd}
            >
              <IonIcon icon={chevronForward} />
            </IonButton>
          </div>

          {/* Net Total Display + Labels and Amounts (Combined) */}
          <IonGrid style={{ marginBottom: "1.5rem" }}>
            <IonRow>
              {/* Expense Column */}
              <IonCol size="4">
                <div className="metric">
                  <IonText color="medium" className="metric-label">
                    Expenses
                  </IonText>
                  <IonText className="metric-value expense">
                    {expensePaid.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                  <IonText color="medium" className="metric-subtext">
                    of{" "}
                    {totalExpense.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                </div>
              </IonCol>

              {/* Net Total Column */}
              <IonCol size="4">
                <div className="metric" style={{ textAlign: "center" }}>
                  <IonText color="medium" className="metric-label">
                    Net Total
                  </IonText>
                  <IonText className={`metric-value ${netColor}`}>
                    {Math.abs(netPaid).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                  <IonText color="medium" className="metric-subtext">
                    of{" "}
                    {Math.abs(netBudgeted).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                </div>
              </IonCol>

              {/* Income Column */}
              <IonCol size="4">
                <div className="metric" style={{ textAlign: "right" }}>
                  <IonText color="medium" className="metric-label">
                    Income
                  </IonText>
                  <IonText className="metric-value income">
                    {incomePaid.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                  <IonText color="medium" className="metric-subtext">
                    of{" "}
                    {totalIncome.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </IonText>
                </div>
              </IonCol>
            </IonRow>
          </IonGrid>

          {/* Bidirectional Progress Bar */}
          <div className="bidirectional-bar">
            {/* Expense Section */}
            <div className="expense-section">
              <div className="expense-bar">
                <div
                  className="expense-bar-fill"
                  style={{
                    width: `${expensePercentage}%`,
                  }}
                />
              </div>
            </div>

            {/* Divider */}
            <div className="divider" />

            {/* Income Section */}
            <div className="income-section">
              <div className="income-bar">
                <div
                  className="income-bar-fill"
                  style={{
                    width: `${incomePercentage}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Progress Labels (Below Bars) */}
          <div className="progress-labels">
            <span className="min-label">{Math.round(expensePercentage)}%</span>
            <span className="max-label">{Math.round(incomePercentage)}%</span>
          </div>
        </IonCardContent>
      </IonCard>
    );
  };

  const getInitialGoalIndex = (): number => {
    const allGoals = getAllGoals();
    const firstIncompleteIndex = allGoals.findIndex(
      (goal) => !goal.isCompleted
    );

    return firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0;
  };

  useEffect(() => {
    setCurrentGoalIndex(getInitialGoalIndex());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const getAllGoals = (): BudgetOccurrence[] => {
    const occurrences = generateBudgetOccurrences();

    // Get all goals (active and completed)
    const allGoals = occurrences.filter((occ) => occ.budget.isGoal);

    // Sort by due date ascending (earliest first)
    return allGoals.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  };

  const handleGoalPrevious = () => {
    setCurrentGoalIndex((prev) => Math.max(0, prev - 1));
  };

  const handleGoalNext = () => {
    const allGoals = getAllGoals();
    setCurrentGoalIndex((prev) => Math.min(prev + 1, allGoals.length - 1));
  };

  const activeGoals = getActiveGoals();
  const mostRecentCompletedGoal = getMostRecentCompletedGoal();
  const groupedBudgets = groupedOccurrences();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Budget</IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={async () => {
                try {
                  const csv = await exportBudgetsToCSV();
                  const filename = `budgets-${
                    new Date().toISOString().split("T")[0]
                  }.csv`;
                  downloadBudgetsCSV(csv, filename);
                  setSuccessMsg("Budgets exported successfully!");
                  setShowSuccessToast(true);
                } catch (err) {
                  console.error("Export failed:", err);
                  setError("Failed to export budgets");
                }
              }}
              title="Export Budgets to CSV"
            >
              <IonIcon icon={downloadOutline} />
            </IonButton>
            <IonButton
              onClick={() => setShowImportModal(true)}
              title="Import budgets from CSV"
            >
              <IonIcon icon={cloudUploadOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Delete Confirmation */}
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => setShowDeleteConfirm(false)}
          header="Delete Budget"
          message={
            budgetDeleteHasTransactions
              ? "This budget has linked transactions. It will be deactivated instead of deleted. You can reactivate it later if needed."
              : "Are you sure you want to delete this budget? This action cannot be undone."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => setShowDeleteConfirm(false),
            },
            {
              text: budgetDeleteHasTransactions ? "Deactivate" : "Delete",
              role: "destructive",
              handler: handleConfirmDelete,
            },
          ]}
        />

        {/* Success Toast */}
        <IonToast
          isOpen={showSuccessToast}
          onDidDismiss={() => setShowSuccessToast(false)}
          message={successMsg}
          duration={2000}
          position="top"
          color="success"
        />

        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}

        {!loading && (
          <>
            {/* Active Goals Section - Scrollable */}
            {getAllGoals().length > 0 && (
              <div style={{ marginBottom: "24px" }}>
                <h2
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: "bold",
                    color: "#999",
                    marginBottom: "12px",
                    textTransform: "uppercase",
                  }}
                >
                  Goals
                </h2>

                {(() => {
                  const allGoals = getAllGoals();
                  if (allGoals.length === 0) return null;

                  const currentGoal = allGoals[currentGoalIndex];
                  const isAtStart = currentGoalIndex === 0;
                  const isAtEnd = currentGoalIndex === allGoals.length - 1;

                  return (
                    <IonCard
                      onClick={() => {
                        setSelectedBudgetForCompletion(currentGoal);
                        setShowCompleteModal(true);
                      }}
                      style={{ cursor: "pointer", margin: "0" }}
                    >
                      <IonCardContent>
                        {/* Goal Navigation Header */}
                        <div
                          className="period-selector"
                          style={{ marginBottom: "1rem" }}
                        >
                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGoalPrevious();
                            }}
                            disabled={isAtStart}
                          >
                            <IonIcon icon={chevronBack} />
                          </IonButton>

                          <div
                            className="period-label"
                            style={{
                              wordWrap: "break-word",
                              overflowWrap: "break-word",
                              whiteSpace: "normal",
                              lineHeight: "1.4",
                            }}
                          >
                            {currentGoal.budget.description}
                          </div>

                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGoalNext();
                            }}
                            disabled={isAtEnd}
                          >
                            <IonIcon icon={chevronForward} />
                          </IonButton>
                        </div>

                        {/* Goal Details */}
                        <IonGrid>
                          <IonRow>
                            <IonCol size="4">
                              <p
                                style={{
                                  color: "var(--ion-color-medium)",
                                  fontSize: "0.85rem",
                                  fontWeight: "500",
                                  margin: "0",
                                }}
                              >
                                {getRecipientName(
                                  currentGoal.budget.recipientId
                                )}
                              </p>
                              <p
                                style={{
                                  color: "var(--ion-color-medium)",
                                  fontSize: "0.85rem",
                                  fontWeight: "500",
                                  margin: "0",
                                }}
                              >
                                {getBucketName(currentGoal.budget.categoryId)} •{" "}
                                {getCategoryName(currentGoal.budget.categoryId)}
                              </p>
                            </IonCol>
                            {/* Goal Counter */}
                            <IonCol size="4" style={{ textAlign: "center" }}>
                              <p
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#999",
                                }}
                              >
                                Goal {currentGoalIndex + 1} of {allGoals.length}
                              </p>
                              <p
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#999",
                                }}
                              >
                                {currentGoal.dueDate.toLocaleDateString(
                                  "en-US",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  }
                                )}
                              </p>
                            </IonCol>
                            <IonCol size="4" style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  fontSize: "1.2rem",
                                  fontWeight: "bold",
                                  color:
                                    currentGoal.budget.amount < 0
                                      ? "#eb445c"
                                      : "#009688",
                                }}
                              >
                                {Math.abs(
                                  currentGoal.amountPaid
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                              <div
                                style={{ fontSize: "0.85rem", color: "#999" }}
                              >
                                of{" "}
                                {Math.abs(
                                  currentGoal.budget.amount +
                                    (currentGoal.budget.transactionCost || 0)
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                            </IonCol>
                          </IonRow>

                          {/* Enhanced Progress Bar - Reports Style */}
                          <IonRow style={{ marginTop: "12px" }}>
                            <IonCol>
                              <div className="progress-bar">
                                <div className="progress-bar-wrapper">
                                  <div
                                    className="progress-bar-fill"
                                    style={{
                                      backgroundColor:
                                        getProgressPercentage(currentGoal) ===
                                        100
                                          ? "#2dd36f"
                                          : "rgb(68, 124, 224)",
                                      width: `${getProgressPercentage(
                                        currentGoal
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <div className="progress-percentage">
                                  {Math.round(
                                    getProgressPercentage(currentGoal)
                                  )}
                                  %
                                </div>
                              </div>
                            </IonCol>
                          </IonRow>

                          {/* Status Badge */}
                          {currentGoal.isCompleted && (
                            <IonRow style={{ marginTop: "8px" }}>
                              <IonCol>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    color: "#2dd36f",
                                    fontSize: "0.9rem",
                                    fontWeight: "600",
                                  }}
                                >
                                  <IonIcon icon={checkmarkCircle} />
                                  Completed
                                </div>
                              </IonCol>
                            </IonRow>
                          )}

                          {/* Edit/Delete/Link buttons */}
                          <IonRow style={{ marginTop: "12px", gap: "8px" }}>
                            <IonCol
                              style={{ paddingRight: 0, textAlign: "right" }}
                            >
                              <IonButton
                                fill="clear"
                                size="small"
                                style={{ marginRight: "0" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenLinkModal(currentGoal);
                                }}
                                title="Link Transaction"
                              >
                                <IonIcon icon={linkOutline} slot="end" />
                              </IonButton>
                              <IonButton
                                fill="clear"
                                size="small"
                                style={{ marginRight: "0" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  history.push(
                                    `/budget/edit/${currentGoal.budget.id}`
                                  );
                                }}
                                title="Edit Goal"
                              >
                                <IonIcon icon={createOutline} slot="end" />
                              </IonButton>
                              <IonButton
                                fill="clear"
                                size="small"
                                color="danger"
                                style={{ marginRight: "0" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteClick(currentGoal.budget.id!);
                                }}
                                title="Delete Goal"
                              >
                                <IonIcon icon={trashOutline} slot="end" />
                              </IonButton>
                            </IonCol>
                          </IonRow>
                        </IonGrid>
                      </IonCardContent>
                    </IonCard>
                  );
                })()}
              </div>
            )}

            {/* Budget Summary Card */}
            {activeGoals.length > 0 || mostRecentCompletedGoal ? (
              <BudgetSummaryCard />
            ) : null}

            {/* Budget Items by Time Group */}
            {groupedBudgets.length === 0 ? (
              <IonText>
                <p>No active budgets. Click the + button to add one.</p>
              </IonText>
            ) : (
              groupedBudgets.map(([timeGroup, occurrences]) => (
                <div key={timeGroup} style={{ marginBottom: "24px" }}>
                  <h3
                    className={`time-group-header ${
                      timeGroup === "Overdue" ? "overdue" : ""
                    }`}
                  >
                    {timeGroup}
                  </h3>

                  <IonList style={{ borderRadius: "4px" }}>
                    {occurrences.map((occ) => (
                      <IonItem
                        key={`${occ.budgetId}-${occ.dueDate.getTime()}`}
                        onClick={() => {
                          setSelectedBudgetForCompletion(occ);
                          setShowCompleteModal(true);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <IonGrid style={{ width: "100%" }}>
                          <IonRow>
                            <IonCol size="1" className="date-column">
                              <h2>
                                <div className="date-column-weekday">
                                  {occ.dueDate
                                    .toLocaleDateString("en-US", {
                                      weekday: "short",
                                    })
                                    .toUpperCase()}
                                </div>
                                <div className="date-column-day">
                                  {occ.dueDate.toLocaleDateString("en-US", {
                                    day: "2-digit",
                                  })}
                                </div>
                                <div className="date-column-month">
                                  {occ.dueDate
                                    .toLocaleDateString("en-US", {
                                      month: "short",
                                    })
                                    .toUpperCase()}
                                </div>
                              </h2>
                            </IonCol>

                            <IonCol size="7">
                              <IonRow>
                                <h3 className="item-description">
                                  {occ.budget.description}
                                  {!occ.budget.isFlexible && (
                                    <IonIcon
                                      icon={bag}
                                      style={{
                                        marginLeft: "8px",
                                        fontSize: "1rem",
                                        color: "var(--ion-color-warning)",
                                        verticalAlign: "middle",
                                      }}
                                      title="Strict Budget"
                                    />
                                  )}
                                </h3>
                              </IonRow>
                              <IonRow>
                                <IonCol size="1.5">
                                  <IonAvatar
                                    style={{
                                      width: "40px",
                                      height: "40px",
                                    }}
                                    title={getAccountName(occ.budget.accountId)}
                                  >
                                    {getAccountImage(occ.budget.accountId) ? (
                                      <IonImg
                                        src={getAccountImage(
                                          occ.budget.accountId
                                        )}
                                        alt={getAccountName(
                                          occ.budget.accountId
                                        )}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          backgroundColor: "#ccc",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "0.8rem",
                                        }}
                                      >
                                        {getAccountName(
                                          occ.budget.accountId
                                        ).charAt(0)}
                                      </div>
                                    )}
                                  </IonAvatar>
                                </IonCol>
                                <IonCol>
                                  <div className="item-metadata">
                                    <IonIcon
                                      icon={
                                        occ.budget.amount < 0
                                          ? arrowUpCircle
                                          : arrowDownCircle
                                      }
                                      className={`item-metadata-icon ${
                                        occ.budget.amount < 0
                                          ? "expense"
                                          : "income"
                                      }`}
                                    />
                                    {getRecipientName(occ.budget.recipientId)}
                                  </div>
                                  <div style={{ marginTop: "4px" }}>
                                    {getBucketName(occ.budget.categoryId) && (
                                      <IonChip
                                        color="secondary"
                                        style={{
                                          fontSize: "0.75rem",
                                          height: "20px",
                                        }}
                                      >
                                        <IonLabel>
                                          {getBucketName(occ.budget.categoryId)}
                                        </IonLabel>
                                      </IonChip>
                                    )}
                                    <IonChip
                                      color="primary"
                                      style={{
                                        fontSize: "0.75rem",
                                        height: "20px",
                                      }}
                                    >
                                      <IonLabel>
                                        {getCategoryName(occ.budget.categoryId)}
                                      </IonLabel>
                                    </IonChip>
                                  </div>
                                </IonCol>
                              </IonRow>
                            </IonCol>

                            <IonCol size="4" style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  fontSize: "1.2rem",
                                  fontWeight: "bold",
                                  color:
                                    occ.budget.amount < 0
                                      ? "#eb445c"
                                      : "#009688",
                                }}
                              >
                                {Math.abs(occ.amountPaid).toLocaleString(
                                  undefined,
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                              </div>
                              <div
                                style={{ fontSize: "0.85rem", color: "#999" }}
                              >
                                of{" "}
                                {Math.abs(
                                  occ.budget.amount +
                                    (occ.budget.transactionCost || 0)
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                              <IonProgressBar
                                value={getProgressPercentage(occ) / 100}
                                color={occ.isCompleted ? "success" : "primary"}
                                style={{ marginTop: "4px" }}
                              />

                              {/* Edit/Delete/Link buttons below progress bar */}
                              <IonRow className="item-actions">
                                <IonCol className="item-actions-container">
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenLinkModal(occ);
                                    }}
                                    title="Link Transaction"
                                  >
                                    <IonIcon icon={linkOutline} slot="end" />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      history.push(
                                        `/budget/edit/${occ.budget.id}`
                                      );
                                    }}
                                    title="Edit Budget Item"
                                  >
                                    <IonIcon icon={createOutline} slot="end" />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    color="danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteClick(occ.budget.id!);
                                    }}
                                    title="Delete Budget Item"
                                  >
                                    <IonIcon icon={trashOutline} slot="end" />
                                  </IonButton>
                                </IonCol>
                              </IonRow>
                            </IonCol>
                          </IonRow>
                        </IonGrid>
                      </IonItem>
                    ))}
                  </IonList>
                </div>
              ))
            )}
          </>
        )}
      </IonContent>

      {/* FAB BUTTON FOR ADDING BUDGETS */}
      <IonFab vertical="bottom" horizontal="end" slot="fixed">
        <IonFabButton
          onClick={() => history.push("/budget/add")}
          title="Add Budget"
        >
          <IonIcon icon={addOutline} />
        </IonFabButton>
      </IonFab>

      {/* Complete Budget Modal */}
      {selectedBudgetForCompletion && (
        <CompleteBudgetModal
          isOpen={showCompleteModal}
          onClose={() => {
            setShowCompleteModal(false);
            setSelectedBudgetForCompletion(null);
          }}
          budgetOccurrence={selectedBudgetForCompletion}
          onComplete={() => {
            loadData();
            setShowCompleteModal(false);
            setSelectedBudgetForCompletion(null);
          }}
        />
      )}

      {/* Link Past Transactions Modal */}
      <LinkPastTransactionsModal
        isOpen={showLinkModal}
        onClose={() => {
          setShowLinkModal(false);
          setBudgetIdForLinking(undefined);
          setBudgetOccurrenceDateForLinking(undefined);
          setMatchingTransactionsForLink([]);
        }}
        matchingTransactions={matchingTransactionsForLink}
        onLinkTransactions={handleLinkTransactions}
        categories={categories}
        recipients={recipients}
        occurrenceDate={budgetOccurrenceDateForLinking || new Date()}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onDidDismiss={() => setShowImportModal(false)}
        onImportComplete={() => {
          setShowImportModal(false);
          // Reload budgets
          window.location.reload();
        }}
      />
    </IonPage>
  );
};

export default BudgetPage;

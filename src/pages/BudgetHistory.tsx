import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IonAccordion,
  IonAccordionGroup,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonSpinner,
  IonText,
  IonItem,
  IonList,
  IonAlert,
  IonToast,
  IonProgressBar,
  IonGrid,
  IonRow,
  IonCol,
  IonAvatar,
  IonImg,
  IonButton,
  IonIcon,
  IonChip,
  IonInput,
  IonLabel,
  useIonViewWillEnter,
} from "@ionic/react";
import {
  createOutline,
  trashOutline,
  linkOutline,
  arrowUpCircle,
  arrowDownCircle,
  bag,
  checkmarkCircleOutline,
  closeCircle,
  closeCircleOutline,
} from "ionicons/icons";
import {
  Account,
  Bucket,
  Budget,
  BudgetSnapshot,
  Category,
  Recipient,
  Transaction,
  db,
  migrateBudgetSnapshots,
  ensureBudgetSnapshotForOccurrence,
} from "../db";
import { CompleteBudgetModal } from "../components/CompleteBudgetModal";
import { EditSnapshotModal } from "../components/EditSnapshotModal";
import { LinkPastTransactionsModal } from "../components/LinkPastTransactionsModal";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import { budgetRepository } from "../repositories";
import { findMatchingTransactions } from "../utils/transactionMatching";
import "./Budget.css";

interface BudgetOccurrence {
  budgetSnapshotId?: number;
  budgetId: number;
  budget: Budget;
  dueDate: Date;
  amountPaid: number;
  isCompleted: boolean;
  timeGroup: string;
  linkedTransactions: Transaction[];
}

interface SnapshotCandidate {
  snapshot: BudgetSnapshot;
  dueDate: Date;
  amountPaid: number;
  linkedTransactions: Transaction[];
}

const frequencyOptions: Array<{
  value: Budget["frequency"];
  label: string;
}> = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly (Fixed Day)" },
  { value: "custom", label: "Custom (Every N Days)" },
  { value: "yearly", label: "Yearly" },
];

const parseDateInputToLocalDay = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const BudgetHistory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountImages, setAccountImages] = useState<Map<number, string>>(
    new Map(),
  );

  const [selectedAccountId, setSelectedAccountId] = useState<
    number | undefined
  >(undefined);
  const [selectedRecipientId, setSelectedRecipientId] = useState<
    number | undefined
  >(undefined);
  const [selectedBucketId, setSelectedBucketId] = useState<number | undefined>(
    undefined,
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    number | undefined
  >(undefined);
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>("");
  const [selectedDateTo, setSelectedDateTo] = useState<string>("");
  const [selectedDescription, setSelectedDescription] = useState<string>("");
  const [selectedFrequency, setSelectedFrequency] = useState<
    Budget["frequency"] | undefined
  >(undefined);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<number | undefined>(
    undefined,
  );
  const [budgetDeleteHasTransactions, setBudgetDeleteHasTransactions] =
    useState(false);
  const [snapshotToDeleteId, setSnapshotToDeleteId] = useState<
    number | undefined
  >(undefined);
  const [occurrenceHasLinkedTransactions, setOccurrenceHasLinkedTransactions] =
    useState(false);

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedOccurrenceForCompletion, setSelectedOccurrenceForCompletion] =
    useState<BudgetOccurrence | null>(null);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [matchingTransactionsForLink, setMatchingTransactionsForLink] =
    useState<Transaction[]>([]);
  const [budgetIdForLinking, setBudgetIdForLinking] = useState<
    number | undefined
  >(undefined);
  const [budgetSnapshotIdForLinking, setBudgetSnapshotIdForLinking] = useState<
    number | undefined
  >(undefined);
  const [budgetOccurrenceDateForLinking, setBudgetOccurrenceDateForLinking] =
    useState<Date | undefined>(undefined);

  const [showEditSnapshotModal, setShowEditSnapshotModal] = useState(false);
  const [snapshotToEdit, setSnapshotToEdit] = useState<BudgetSnapshot | null>(
    null,
  );
  const [budgetDueDateForEdit, setBudgetDueDateForEdit] = useState<
    Date | undefined
  >(undefined);

  const [successMsg, setSuccessMsg] = useState("");
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const snapshotBudgetIdBySnapshotId = useMemo(() => {
    const bySnapshotId = new Map<number, number>();
    snapshots.forEach((snapshot) => {
      if (snapshot.id !== undefined) {
        bySnapshotId.set(snapshot.id, snapshot.budgetId);
      }
    });
    return bySnapshotId;
  }, [snapshots]);

  const loadData = async () => {
    setLoading(true);
    try {
      await migrateBudgetSnapshots();

      const [
        allSnapshots,
        allBudgets,
        allTransactions,
        cats,
        bkts,
        recs,
        accs,
      ] = await Promise.all([
        budgetRepository.listBudgetSnapshots(),
        budgetRepository.listBudgets(),
        db.transactions.toArray(),
        db.categories.toArray(),
        db.buckets.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
      ]);

      const imageMap = new Map<number, string>();
      for (const acc of accs) {
        if (acc.id && acc.imageBlob) {
          const url = URL.createObjectURL(acc.imageBlob);
          imageMap.set(acc.id, url);
        }
      }

      setSnapshots(allSnapshots);
      setBudgets(allBudgets);
      setTransactions(allTransactions);
      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);
      setAccountImages(imageMap);
      setError("");
    } catch (err) {
      console.error("Failed to load budget history:", err);
      setError("Failed to load budget history");
    } finally {
      setLoading(false);
    }
  };

  useIonViewWillEnter(() => {
    loadData();
  });

  const normalizeToLocalDay = (value: string | Date): Date => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const getTimeGroup = useCallback((dateValue: string | Date): string => {
    const budgetDate = normalizeToLocalDay(dateValue);
    const today = normalizeToLocalDay(new Date());

    const todayDay = today.getDay();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - todayDay);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setDate(thisWeekStart.getDate() + 7);

    if (budgetDate >= thisWeekStart && budgetDate < nextWeekStart) {
      return "This Week";
    }

    if (budgetDate >= lastWeekStart && budgetDate < thisWeekStart) {
      return "Last Week";
    }

    if (
      budgetDate.getMonth() === today.getMonth() &&
      budgetDate.getFullYear() === today.getFullYear()
    ) {
      return "This Month";
    }

    return budgetDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  }, []);

  const getLinkedTransactions = useCallback(
    (snapshotId: number | undefined, _budgetId: number, targetDate: Date) => {
      if (snapshotId !== undefined) {
        return transactions.filter(
          (txn) => Number(txn.budgetSnapshotId) === snapshotId,
        );
      }

      // Legacy fallback: rows without snapshot linkage, matched by occurrence date.
      const targetTime = normalizeToLocalDay(targetDate).getTime();
      return transactions.filter(
        (txn) =>
          txn.budgetSnapshotId === undefined &&
          txn.occurrenceDate &&
          normalizeToLocalDay(txn.occurrenceDate).getTime() === targetTime,
      );
    },
    [transactions],
  );

  const isExpenseBudget = (
    budget: Pick<Budget, "goalDirection" | "amount">,
  ): boolean => {
    if (budget.goalDirection === "expense") {
      return true;
    }

    if (budget.goalDirection === "income") {
      return false;
    }

    // Some older/restored records may contain null for optional fields.
    return budget.amount < 0;
  };

  const getEffectiveBudgetTarget = (budget: Budget): number => {
    return Math.abs(budget.amount + (budget.transactionCost || 0));
  };

  const getProgressPercentage = (occ: BudgetOccurrence): number => {
    const effectiveTarget = getEffectiveBudgetTarget(occ.budget);

    if (effectiveTarget === 0) return 0;

    if (isExpenseBudget(occ.budget)) {
      return Math.min(100, (Math.abs(occ.amountPaid) / effectiveTarget) * 100);
    }

    return Math.min(100, (occ.amountPaid / effectiveTarget) * 100);
  };

  const getCategoryName = (categoryId: number) =>
    categories.find((c) => c.id === categoryId)?.name || "—";

  const getBucketName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    return buckets.find((b) => b.id === cat?.bucketId)?.name || "";
  };

  const getRecipientName = (recipientId?: number) =>
    recipientId
      ? recipients.find((r) => r.id === recipientId)?.name || "—"
      : "—";

  const getAccountName = (accountId: number | undefined): string => {
    if (!accountId) return "—";
    return accounts.find((a) => a.id === accountId)?.name || "—";
  };

  const getAccountImage = (
    accountId: number | undefined,
  ): string | undefined => {
    if (!accountId || !accountImages.has(accountId)) {
      return undefined;
    }

    return accountImages.get(accountId);
  };

  const clearFilters = () => {
    setSelectedAccountId(undefined);
    setSelectedRecipientId(undefined);
    setSelectedBucketId(undefined);
    setSelectedCategoryId(undefined);
    setSelectedDateFrom("");
    setSelectedDateTo("");
    setSelectedDescription("");
    setSelectedFrequency(undefined);
  };

  const clearIndividualFilter = (filterName: string) => {
    switch (filterName) {
      case "account":
        setSelectedAccountId(undefined);
        break;
      case "recipient":
        setSelectedRecipientId(undefined);
        break;
      case "bucket":
        setSelectedBucketId(undefined);
        break;
      case "category":
        setSelectedCategoryId(undefined);
        break;
      case "dateFrom":
        setSelectedDateFrom("");
        break;
      case "dateTo":
        setSelectedDateTo("");
        break;
      case "description":
        setSelectedDescription("");
        break;
      case "frequency":
        setSelectedFrequency(undefined);
        break;
    }
  };

  const hasActiveFilters = () => {
    return (
      selectedAccountId !== undefined ||
      selectedRecipientId !== undefined ||
      selectedBucketId !== undefined ||
      selectedCategoryId !== undefined ||
      selectedDateFrom !== "" ||
      selectedDateTo !== "" ||
      selectedDescription !== "" ||
      selectedFrequency !== undefined
    );
  };

  const pastOccurrences = useMemo(() => {
    const budgetById = new Map<number, Budget>();
    budgets.forEach((budget) => {
      if (budget.id) {
        budgetById.set(budget.id, budget);
      }
    });

    const today = normalizeToLocalDay(new Date());
    const dedupedByDueDate = new Map<string, SnapshotCandidate>();

    snapshots.forEach((snapshot) => {
      const dueDate = normalizeToLocalDay(snapshot.dueDate);
      if (dueDate >= today) {
        return;
      }

      const linkedTransactions = getLinkedTransactions(
        snapshot.id,
        snapshot.budgetId,
        dueDate,
      );

      const amountPaid = linkedTransactions.reduce(
        (sum, txn) => sum + txn.amount + (txn.transactionCost || 0),
        0,
      );

      const key = `${snapshot.budgetId}:${dueDate.getTime()}`;
      const existing = dedupedByDueDate.get(key);

      if (!existing) {
        dedupedByDueDate.set(key, {
          snapshot,
          dueDate,
          amountPaid,
          linkedTransactions,
        });
        return;
      }

      const existingScore = Math.abs(existing.amountPaid);
      const candidateScore = Math.abs(amountPaid);

      if (candidateScore > existingScore) {
        dedupedByDueDate.set(key, {
          snapshot,
          dueDate,
          amountPaid,
          linkedTransactions,
        });
        return;
      }

      if (
        candidateScore === existingScore &&
        linkedTransactions.length > existing.linkedTransactions.length
      ) {
        dedupedByDueDate.set(key, {
          snapshot,
          dueDate,
          amountPaid,
          linkedTransactions,
        });
        return;
      }

      if (
        candidateScore === existingScore &&
        linkedTransactions.length === existing.linkedTransactions.length &&
        new Date(snapshot.updatedAt).getTime() >=
          new Date(existing.snapshot.updatedAt).getTime()
      ) {
        dedupedByDueDate.set(key, {
          snapshot,
          dueDate,
          amountPaid,
          linkedTransactions,
        });
      }
    });

    return Array.from(dedupedByDueDate.values())
      .map(
        ({
          snapshot,
          dueDate,
          amountPaid,
          linkedTransactions,
        }): BudgetOccurrence | null => {
          const liveBudget = budgetById.get(snapshot.budgetId);
          if (!liveBudget) {
            return null;
          }

          const snapshotBudget: Budget = {
            ...liveBudget,
            description: snapshot.description,
            categoryId: snapshot.categoryId,
            accountId: snapshot.accountId,
            recipientId: snapshot.recipientId,
            amount: snapshot.amount,
            transactionCost: snapshot.transactionCost,
            frequency: snapshot.frequency,
            frequencyDetails: snapshot.frequencyDetails,
            isGoal: snapshot.isGoal,
            isFlexible: snapshot.isFlexible,
            goalPercentage: snapshot.goalPercentage,
            goalDirection: snapshot.goalDirection,
            remainingCyclesTotal: snapshot.remainingCyclesTotal,
            dueDate,
            updatedAt: snapshot.sourceBudgetUpdatedAt,
          };

          const effectiveTarget = getEffectiveBudgetTarget(snapshotBudget);
          const isExpense = isExpenseBudget(snapshotBudget);

          return {
            budgetSnapshotId: snapshot.id,
            budgetId: snapshot.budgetId,
            budget: snapshotBudget,
            dueDate,
            amountPaid,
            isCompleted: isExpense
              ? amountPaid <= -effectiveTarget
              : amountPaid >= effectiveTarget,
            timeGroup: getTimeGroup(dueDate),
            linkedTransactions,
          };
        },
      )
      .filter((occ): occ is BudgetOccurrence => occ !== null)
      .filter((occ) => occ.budget.isActive || occ.amountPaid !== 0)
      .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
  }, [snapshots, budgets, getLinkedTransactions, getTimeGroup]);

  const getActiveFilterChips = (): Array<{
    label: string;
    displayLabel: string;
    tooltip: string;
    filterName: string;
  }> => {
    const chips: Array<{
      label: string;
      displayLabel: string;
      tooltip: string;
      filterName: string;
    }> = [];

    if (selectedAccountId !== undefined) {
      const account = accounts.find((a) => a.id === selectedAccountId);
      chips.push({
        label: `Account: ${account?.name}`,
        displayLabel: account?.name || "Account",
        tooltip: "Clear Account filter",
        filterName: "account",
      });
    }

    if (selectedRecipientId !== undefined) {
      const recipient = recipients.find((r) => r.id === selectedRecipientId);
      chips.push({
        label: `Recipient: ${recipient?.name}`,
        displayLabel: recipient?.name || "Recipient",
        tooltip: "Clear Recipient filter",
        filterName: "recipient",
      });
    }

    if (selectedBucketId !== undefined) {
      const bucket = buckets.find((b) => b.id === selectedBucketId);
      chips.push({
        label: `Bucket: ${bucket?.name}`,
        displayLabel: bucket?.name || "Bucket",
        tooltip: "Clear Bucket filter",
        filterName: "bucket",
      });
    }

    if (selectedCategoryId !== undefined) {
      const category = categories.find((c) => c.id === selectedCategoryId);
      chips.push({
        label: `Category: ${category?.name}`,
        displayLabel: category?.name || "Category",
        tooltip: "Clear Category filter",
        filterName: "category",
      });
    }

    if (selectedDateFrom) {
      chips.push({
        label: `From: ${selectedDateFrom}`,
        displayLabel: selectedDateFrom,
        tooltip: "Clear From Date filter",
        filterName: "dateFrom",
      });
    }

    if (selectedDateTo) {
      chips.push({
        label: `To: ${selectedDateTo}`,
        displayLabel: selectedDateTo,
        tooltip: "Clear To Date filter",
        filterName: "dateTo",
      });
    }

    if (selectedDescription) {
      chips.push({
        label: `"${selectedDescription}"`,
        displayLabel: selectedDescription,
        tooltip: "Clear Description filter",
        filterName: "description",
      });
    }

    if (selectedFrequency) {
      const frequencyLabel =
        frequencyOptions.find((f) => f.value === selectedFrequency)?.label ||
        "Frequency";
      chips.push({
        label: `Frequency: ${frequencyLabel}`,
        displayLabel: frequencyLabel,
        tooltip: "Clear Frequency filter",
        filterName: "frequency",
      });
    }

    return chips;
  };

  const getAccountsInOccurrences = (): number[] => {
    const accountIds = new Set<number>();
    pastOccurrences.forEach((occ) => {
      if (occ.budget.accountId) {
        accountIds.add(occ.budget.accountId);
      }
    });
    return Array.from(accountIds);
  };

  const getRecipientsInOccurrences = (): number[] => {
    const recipientIds = new Set<number>();
    pastOccurrences.forEach((occ) => {
      if (occ.budget.recipientId) {
        recipientIds.add(occ.budget.recipientId);
      }
    });
    return Array.from(recipientIds);
  };

  const getBucketsInOccurrences = (): number[] => {
    const bucketIds = new Set<number>();
    pastOccurrences.forEach((occ) => {
      const category = categories.find((c) => c.id === occ.budget.categoryId);
      if (category?.bucketId) {
        bucketIds.add(category.bucketId);
      }
    });
    return Array.from(bucketIds);
  };

  const getCategoriesInOccurrences = (): number[] => {
    const categoryIds = new Set<number>();
    pastOccurrences.forEach((occ) => {
      categoryIds.add(occ.budget.categoryId);
    });
    return Array.from(categoryIds);
  };

  const getFrequenciesInOccurrences = (): Budget["frequency"][] => {
    const frequencies = new Set<Budget["frequency"]>();
    pastOccurrences.forEach((occ) => {
      frequencies.add(occ.budget.frequency);
    });
    return Array.from(frequencies);
  };

  const getRecipientOccurrenceCount = (recipientId: number): number => {
    return pastOccurrences.filter(
      (occ) => occ.budget.recipientId === recipientId,
    ).length;
  };

  const filteredOccurrences = useMemo(() => {
    return pastOccurrences.filter((occ) => {
      if (
        selectedAccountId !== undefined &&
        occ.budget.accountId !== selectedAccountId
      ) {
        return false;
      }

      if (
        selectedRecipientId !== undefined &&
        occ.budget.recipientId !== selectedRecipientId
      ) {
        return false;
      }

      if (selectedBucketId !== undefined) {
        const category = categories.find((c) => c.id === occ.budget.categoryId);
        if (category?.bucketId !== selectedBucketId) {
          return false;
        }
      }

      if (
        selectedCategoryId !== undefined &&
        occ.budget.categoryId !== selectedCategoryId
      ) {
        return false;
      }

      if (selectedDateFrom) {
        const occurrenceDate = normalizeToLocalDay(occ.dueDate);
        const fromDate = parseDateInputToLocalDay(selectedDateFrom);
        if (occurrenceDate < fromDate) {
          return false;
        }
      }

      if (selectedDateTo) {
        const occurrenceDate = normalizeToLocalDay(occ.dueDate);
        const toDate = parseDateInputToLocalDay(selectedDateTo);
        if (occurrenceDate > toDate) {
          return false;
        }
      }

      if (
        selectedDescription &&
        !occ.budget.description
          .toLowerCase()
          .includes(selectedDescription.toLowerCase())
      ) {
        return false;
      }

      if (
        selectedFrequency !== undefined &&
        occ.budget.frequency !== selectedFrequency
      ) {
        return false;
      }

      return true;
    });
  }, [
    pastOccurrences,
    selectedAccountId,
    selectedRecipientId,
    selectedBucketId,
    selectedCategoryId,
    selectedDateFrom,
    selectedDateTo,
    selectedDescription,
    selectedFrequency,
    categories,
  ]);

  const groupedOccurrences = useMemo(() => {
    const groups = new Map<string, BudgetOccurrence[]>();

    filteredOccurrences.forEach((occurrence) => {
      const group = occurrence.timeGroup;
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(occurrence);
    });

    const orderedGroups: Array<[string, BudgetOccurrence[]]> = [];
    const fixedOrder = ["This Week", "Last Week", "This Month"];

    fixedOrder.forEach((group) => {
      if (groups.has(group)) {
        orderedGroups.push([group, groups.get(group)!]);
      }
    });

    const monthYearGroups = Array.from(groups.entries())
      .filter(([group]) => !fixedOrder.includes(group))
      .sort((a, b) => {
        const dateA = new Date(`${a[0]} 1`);
        const dateB = new Date(`${b[0]} 1`);
        return dateB.getTime() - dateA.getTime();
      });

    orderedGroups.push(...monthYearGroups);

    return orderedGroups.map(([group, occurrences]) => [
      group,
      [...occurrences].sort(
        (a, b) => b.dueDate.getTime() - a.dueDate.getTime(),
      ),
    ]) as Array<[string, BudgetOccurrence[]]>;
  }, [filteredOccurrences]);

  useEffect(() => {
    if (selectedBucketId !== undefined) {
      setSelectedCategoryId(undefined);
    }
  }, [selectedBucketId]);

  const handleDeleteClick = (occ: BudgetOccurrence) => {
    const hasSnapshotLinkedTransactions = transactions.some((txn) => {
      if (txn.budgetSnapshotId === undefined) {
        return false;
      }
      // Use type-safe numeric comparison to check if this transaction is linked
      const snapshotId = Number(txn.budgetSnapshotId);
      return snapshotBudgetIdBySnapshotId.get(snapshotId) === occ.budgetId;
    });

    setBudgetDeleteHasTransactions(hasSnapshotLinkedTransactions);
    setBudgetToDelete(occ.budgetId);
    setSnapshotToDeleteId(occ.budgetSnapshotId);
    setOccurrenceHasLinkedTransactions(occ.linkedTransactions.length > 0);
    setShowDeleteConfirm(true);
  };

  const handleToggleBudgetActive = async (budget: Budget) => {
    if (!budget.id) {
      return;
    }

    try {
      await db.budgets.update(budget.id, {
        isActive: !budget.isActive,
        updatedAt: new Date(),
      });

      setSuccessMsg(
        `Budget ${budget.isActive ? "deactivated" : "activated"} successfully`,
      );
      setShowSuccessToast(true);
      await loadData();
    } catch (err) {
      console.error("Error toggling budget active state:", err);
      setError("Failed to update budget active state");
    }
  };

  const handleConfirmDelete = async () => {
    if (budgetToDelete === undefined) return;

    try {
      if (budgetDeleteHasTransactions) {
        const budget = budgets.find((b) => b.id === budgetToDelete);
        if (budget) {
          await db.budgets.update(budgetToDelete, { isActive: false });
          setSuccessMsg("Budget deactivated (has linked transactions)");
        }
      } else {
        await db.budgets.delete(budgetToDelete);
        setSuccessMsg("Budget deleted successfully");
      }

      setShowSuccessToast(true);
      setShowDeleteConfirm(false);
      setBudgetToDelete(undefined);
      setSnapshotToDeleteId(undefined);
      setOccurrenceHasLinkedTransactions(false);
      await loadData();
    } catch (err) {
      console.error("Error deleting budget:", err);
      setError("Failed to delete budget");
    }
  };

  const handleConfirmDeleteOccurrence = async () => {
    if (snapshotToDeleteId === undefined) {
      setError("This occurrence cannot be deleted because no snapshot exists.");
      return;
    }

    if (occurrenceHasLinkedTransactions) {
      setError(
        "This occurrence has linked transactions. Delink them first, then delete the occurrence.",
      );
      return;
    }

    try {
      await db.budgetSnapshots.delete(snapshotToDeleteId);
      setSuccessMsg("Budget occurrence deleted successfully");
      setShowSuccessToast(true);
      setShowDeleteConfirm(false);
      setSnapshotToDeleteId(undefined);
      setOccurrenceHasLinkedTransactions(false);
      setBudgetToDelete(undefined);
      await loadData();
    } catch (err) {
      console.error("Error deleting budget occurrence:", err);
      setError("Failed to delete budget occurrence");
    }
  };

  const handleOpenLinkModal = (budgetOccurrence: BudgetOccurrence) => {
    const budget = budgetOccurrence.budget;

    const matching = findMatchingTransactions(
      transactions,
      budget.description,
      budget.categoryId,
      budget.recipientId,
    );

    if (matching.length === 0) {
      setError("No unlinked transactions found matching this budget");
      return;
    }

    setMatchingTransactionsForLink(matching);
    setBudgetIdForLinking(budgetOccurrence.budgetId);
    setBudgetSnapshotIdForLinking(budgetOccurrence.budgetSnapshotId);
    setBudgetOccurrenceDateForLinking(budgetOccurrence.dueDate);
    setShowLinkModal(true);
  };

  const handleLinkTransactions = async (
    transactionIds: number[],
    occurrenceDate: Date,
  ) => {
    if (budgetIdForLinking === undefined) return;

    try {
      const budget = budgets.find((b) => b.id === budgetIdForLinking);
      if (!budget) {
        setError("Budget was not found");
        return;
      }

      const snapshot = await ensureBudgetSnapshotForOccurrence(
        budget,
        occurrenceDate,
      );

      const targetSnapshotId =
        budgetSnapshotIdForLinking !== undefined
          ? budgetSnapshotIdForLinking
          : snapshot.id;

      for (const txnId of transactionIds) {
        await db.transactions.update(txnId, {
          budgetId: budgetIdForLinking,
          occurrenceDate,
          budgetSnapshotId: targetSnapshotId,
        });
      }

      setSuccessMsg(
        `Successfully linked ${transactionIds.length} transaction${
          transactionIds.length !== 1 ? "s" : ""
        } to budget`,
      );
      setShowSuccessToast(true);
      setShowLinkModal(false);
      setBudgetIdForLinking(undefined);
      setBudgetSnapshotIdForLinking(undefined);
      setBudgetOccurrenceDateForLinking(undefined);
      setMatchingTransactionsForLink([]);
      await loadData();
    } catch (err) {
      console.error("Error linking transactions:", err);
      setError("Failed to link transactions");
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/budget" />
          </IonButtons>
          <IonTitle>Budget History</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => {
            setShowDeleteConfirm(false);
            setSnapshotToDeleteId(undefined);
            setOccurrenceHasLinkedTransactions(false);
            setBudgetToDelete(undefined);
          }}
          header="Delete Options"
          message={
            occurrenceHasLinkedTransactions
              ? "This occurrence has linked transactions. You can deactivate/delete the full budget below, or cancel."
              : snapshotToDeleteId !== undefined
                ? "Delete this occurrence only, or delete/deactivate the full budget?"
                : "This occurrence has no snapshot row to delete. You can still delete/deactivate the full budget."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => {
                setShowDeleteConfirm(false);
                setSnapshotToDeleteId(undefined);
                setOccurrenceHasLinkedTransactions(false);
                setBudgetToDelete(undefined);
              },
            },
            ...(!occurrenceHasLinkedTransactions &&
            snapshotToDeleteId !== undefined
              ? [
                  {
                    text: "Delete Occurrence",
                    role: "destructive" as const,
                    handler: handleConfirmDeleteOccurrence,
                  },
                ]
              : []),
            {
              text: budgetDeleteHasTransactions
                ? "Deactivate Budget"
                : "Delete Budget",
              role: "destructive",
              handler: handleConfirmDelete,
            },
          ]}
        />

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

        {!loading && !error && pastOccurrences.length > 0 && (
          <IonAccordionGroup style={{ marginBottom: "16px" }}>
            <IonAccordion value="filters">
              <IonItem
                slot="header"
                color="light"
                style={{
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                    flex: 1,
                  }}
                >
                  <IonLabel>Filters</IonLabel>
                  {hasActiveFilters() &&
                    getActiveFilterChips().map((chip) => (
                      <div
                        key={chip.filterName}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearIndividualFilter(chip.filterName);
                        }}
                      >
                        <IonChip
                          color="primary"
                          style={{
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            height: "24px",
                            margin: "0",
                            flexShrink: 0,
                          }}
                          title={chip.tooltip}
                        >
                          <IonLabel style={{ padding: "0 4px" }}>
                            {chip.displayLabel}
                          </IonLabel>
                          <IonIcon icon={closeCircle} />
                        </IonChip>
                      </div>
                    ))}
                </div>
              </IonItem>

              <div slot="content" style={{ padding: "16px" }}>
                <IonGrid>
                  <IonRow>
                    <IonCol size="12">
                      <div className="form-input-wrapper">
                        <label className="form-label">Description</label>
                        <div
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <IonInput
                            className="form-input"
                            type="text"
                            placeholder="Search Description..."
                            value={selectedDescription}
                            onIonInput={(e: CustomEvent) => {
                              setSelectedDescription(
                                (e.detail.value as string) || "",
                              );
                            }}
                            style={{
                              width: "100%",
                              paddingRight: selectedDescription
                                ? "44px"
                                : "12px",
                            }}
                          />
                          {selectedDescription && (
                            <button
                              onClick={(e: React.MouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedDescription("");
                              }}
                              style={{
                                position: "absolute",
                                right: "8px",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--ion-color-medium)",
                                fontSize: "1.2rem",
                                opacity: 0.7,
                                transition: "opacity 0.2s",
                                padding: "4px",
                                width: "32px",
                                height: "32px",
                              }}
                              onMouseEnter={(e: React.MouseEvent) => {
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.opacity = "1";
                              }}
                              onMouseLeave={(e: React.MouseEvent) => {
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.opacity = "0.7";
                              }}
                              title="Clear description filter"
                            >
                              <IonIcon icon={closeCircleOutline} />
                            </button>
                          )}
                        </div>
                      </div>
                    </IonCol>
                  </IonRow>

                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Account
                      </div>
                      <SearchableFilterSelect
                        label="Account"
                        placeholder="All Accounts"
                        value={selectedAccountId}
                        options={accounts
                          .filter((a) => {
                            const accountsInHistory =
                              getAccountsInOccurrences();
                            return (
                              a.name && accountsInHistory.includes(a.id || 0)
                            );
                          })
                          .map((a) => ({
                            id: a.id,
                            name: a.name as string,
                          }))}
                        onIonChange={setSelectedAccountId}
                      />
                    </IonCol>

                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Recipient
                      </div>
                      <SearchableFilterSelect
                        label="Recipient"
                        placeholder="All Recipients"
                        value={selectedRecipientId}
                        options={recipients
                          .filter((r) => {
                            const recipientsInHistory =
                              getRecipientsInOccurrences();
                            return (
                              r.name && recipientsInHistory.includes(r.id || 0)
                            );
                          })
                          .map((r) => ({
                            id: r.id,
                            name: r.name,
                          }))
                          .sort((a, b) => {
                            const countA = getRecipientOccurrenceCount(
                              a.id || 0,
                            );
                            const countB = getRecipientOccurrenceCount(
                              b.id || 0,
                            );
                            return countB - countA;
                          })}
                        onIonChange={setSelectedRecipientId}
                      />
                    </IonCol>
                  </IonRow>

                  <IonRow>
                    <IonCol size="12" sizeMd="4">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Bucket
                      </div>
                      <SearchableFilterSelect
                        label="Bucket"
                        placeholder="All Buckets"
                        value={selectedBucketId}
                        options={buckets
                          .filter((b) => {
                            const bucketsInHistory = getBucketsInOccurrences();
                            return (
                              b.name && bucketsInHistory.includes(b.id || 0)
                            );
                          })
                          .map((b) => ({
                            id: b.id,
                            name: b.name as string,
                          }))}
                        onIonChange={setSelectedBucketId}
                      />
                    </IonCol>

                    <IonCol size="12" sizeMd="4">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Category
                      </div>
                      <SearchableFilterSelect
                        label="Category"
                        placeholder="All Categories"
                        value={selectedCategoryId}
                        options={categories
                          .filter((c) => {
                            const categoriesInHistory =
                              getCategoriesInOccurrences();

                            if (selectedBucketId !== undefined) {
                              return (
                                c.bucketId === selectedBucketId &&
                                categoriesInHistory.includes(c.id || 0)
                              );
                            }

                            return (
                              c.name && categoriesInHistory.includes(c.id || 0)
                            );
                          })
                          .map((c) => {
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId,
                            );
                            return {
                              id: c.id,
                              name: `${c.name} - ${bucket?.name || "Unknown"}`,
                            };
                          })}
                        onIonChange={setSelectedCategoryId}
                      />
                    </IonCol>

                    <IonCol size="12" sizeMd="4">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Frequency
                      </div>
                      <SearchableFilterSelect
                        label="Frequency"
                        placeholder="All Frequencies"
                        value={
                          selectedFrequency
                            ? frequencyOptions.findIndex(
                                (opt) => opt.value === selectedFrequency,
                              )
                            : undefined
                        }
                        options={frequencyOptions
                          .map((opt, index) => ({
                            id: index,
                            value: opt.value,
                            name: opt.label,
                          }))
                          .filter((opt) =>
                            getFrequenciesInOccurrences().includes(opt.value),
                          )
                          .map(({ id, name }) => ({ id, name }))}
                        onIonChange={(selectedId) => {
                          if (selectedId === undefined) {
                            setSelectedFrequency(undefined);
                            return;
                          }

                          const frequencyOption = frequencyOptions[selectedId];
                          setSelectedFrequency(frequencyOption?.value);
                        }}
                      />
                    </IonCol>
                  </IonRow>

                  <IonRow>
                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Date From
                      </div>
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="date"
                          value={selectedDateFrom}
                          onChange={(e) => setSelectedDateFrom(e.target.value)}
                          max={selectedDateTo || undefined}
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid var(--ion-color-medium)",
                            borderRadius: "4px",
                            backgroundColor: "transparent",
                            color: "inherit",
                          }}
                        />
                        {selectedDateFrom && (
                          <button
                            onClick={(e: React.MouseEvent) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDateFrom("");
                            }}
                            style={{
                              position: "absolute",
                              right: "32px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ion-color-dark)",
                              fontSize: "1.2rem",
                              opacity: 0.7,
                              transition: "opacity 0.2s",
                              width: "18px",
                              height: "18px",
                              padding: "0",
                            }}
                            onMouseEnter={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "1";
                            }}
                            onMouseLeave={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "0.7";
                            }}
                            title="Clear Date From filter"
                          >
                            <IonIcon icon={closeCircle} />
                          </button>
                        )}
                      </div>
                    </IonCol>

                    <IonCol size="12" sizeMd="6">
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: "500",
                          opacity: 0.7,
                          marginBottom: "8px",
                        }}
                      >
                        Date To
                      </div>
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="date"
                          value={selectedDateTo}
                          onChange={(e) => setSelectedDateTo(e.target.value)}
                          min={selectedDateFrom || undefined}
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid var(--ion-color-medium)",
                            borderRadius: "4px",
                            backgroundColor: "transparent",
                            color: "inherit",
                          }}
                        />
                        {selectedDateTo && (
                          <button
                            onClick={(e: React.MouseEvent) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDateTo("");
                            }}
                            style={{
                              position: "absolute",
                              right: "32px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ion-color-dark)",
                              fontSize: "1.2rem",
                              opacity: 0.7,
                              transition: "opacity 0.2s",
                              width: "18px",
                              height: "18px",
                              padding: "0",
                            }}
                            onMouseEnter={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "1";
                            }}
                            onMouseLeave={(e) => {
                              (
                                e.currentTarget as HTMLButtonElement
                              ).style.opacity = "0.7";
                            }}
                            title="Clear Date To filter"
                          >
                            <IonIcon icon={closeCircle} />
                          </button>
                        )}
                      </div>
                    </IonCol>
                  </IonRow>

                  {hasActiveFilters() && (
                    <IonRow>
                      <IonCol size="12">
                        <IonButton
                          expand="block"
                          fill="outline"
                          color="medium"
                          onClick={clearFilters}
                        >
                          <IonIcon icon={closeCircleOutline} />
                          Clear All Filters
                        </IonButton>
                      </IonCol>
                    </IonRow>
                  )}
                </IonGrid>
              </div>
            </IonAccordion>
          </IonAccordionGroup>
        )}

        {!loading && !error && pastOccurrences.length === 0 && (
          <IonText>
            <p>No budget history found yet.</p>
          </IonText>
        )}

        {!loading &&
          !error &&
          pastOccurrences.length > 0 &&
          filteredOccurrences.length === 0 && (
            <IonText>
              <p>No budget history entries match the selected filters.</p>
            </IonText>
          )}

        {!loading && !error && groupedOccurrences.length > 0 && (
          <>
            {groupedOccurrences.map(([timeGroup, occurrences]) => (
              <div key={timeGroup} style={{ marginBottom: "24px" }}>
                <h3 className="time-group-header">{timeGroup}</h3>
                <IonList style={{ borderRadius: "4px" }}>
                  {occurrences.map((occ) => (
                    <IonItem
                      key={`${occ.budgetSnapshotId ?? "legacy"}-${occ.budgetId}-${occ.dueDate.getTime()}`}
                      onClick={() => {
                        setSelectedOccurrenceForCompletion(occ);
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
                                        occ.budget.accountId,
                                      )}
                                      alt={getAccountName(occ.budget.accountId)}
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
                                      {getAccountName(occ.budget.accountId)
                                        .charAt(0)
                                        .toUpperCase()}
                                    </div>
                                  )}
                                </IonAvatar>
                              </IonCol>
                              <IonCol>
                                <div className="item-metadata">
                                  <IonIcon
                                    icon={
                                      isExpenseBudget(occ.budget)
                                        ? arrowUpCircle
                                        : arrowDownCircle
                                    }
                                    className={`item-metadata-icon ${
                                      isExpenseBudget(occ.budget)
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
                                color: isExpenseBudget(occ.budget)
                                  ? "#eb445c"
                                  : "#009688",
                              }}
                            >
                              {Math.abs(occ.amountPaid).toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </div>
                            <div style={{ fontSize: "0.85rem", color: "#999" }}>
                              of{" "}
                              {getEffectiveBudgetTarget(
                                occ.budget,
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
                                    const snap = snapshots.find(
                                      (s) => s.id === occ.budgetSnapshotId,
                                    );
                                    if (snap) {
                                      const liveBudget = budgets.find(
                                        (b) => b.id === occ.budgetId,
                                      );
                                      setSnapshotToEdit(snap);
                                      setBudgetDueDateForEdit(
                                        liveBudget?.dueDate,
                                      );
                                      setShowEditSnapshotModal(true);
                                    }
                                  }}
                                  title="Edit This Occurrence"
                                >
                                  <IonIcon icon={createOutline} slot="end" />
                                </IonButton>
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  style={{ marginRight: "0" }}
                                  color={
                                    occ.budget.isActive ? "success" : "medium"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBudgetActive(occ.budget);
                                  }}
                                  title={
                                    occ.budget.isActive
                                      ? "Active (click to deactivate)"
                                      : "Inactive (click to activate)"
                                  }
                                >
                                  <IonIcon
                                    icon={
                                      occ.budget.isActive
                                        ? checkmarkCircleOutline
                                        : closeCircleOutline
                                    }
                                    slot="end"
                                  />
                                </IonButton>
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  style={{ marginRight: "0" }}
                                  color="danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick(occ);
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
            ))}
          </>
        )}

        <EditSnapshotModal
          snapshot={snapshotToEdit}
          budgetDueDate={budgetDueDateForEdit}
          isOpen={showEditSnapshotModal}
          onDismiss={() => {
            setShowEditSnapshotModal(false);
            setSnapshotToEdit(null);
            setBudgetDueDateForEdit(undefined);
          }}
          onSaved={() => {
            setShowEditSnapshotModal(false);
            setSnapshotToEdit(null);
            setBudgetDueDateForEdit(undefined);
            loadData();
          }}
        />

        {selectedOccurrenceForCompletion && (
          <CompleteBudgetModal
            isOpen={showCompleteModal}
            onClose={() => {
              setShowCompleteModal(false);
              setSelectedOccurrenceForCompletion(null);
            }}
            budgetOccurrence={selectedOccurrenceForCompletion}
            onComplete={() => {
              setShowCompleteModal(false);
              setSelectedOccurrenceForCompletion(null);
              loadData();
            }}
          />
        )}

        <LinkPastTransactionsModal
          isOpen={showLinkModal}
          onClose={() => {
            setShowLinkModal(false);
            setBudgetIdForLinking(undefined);
            setBudgetSnapshotIdForLinking(undefined);
            setBudgetOccurrenceDateForLinking(undefined);
            setMatchingTransactionsForLink([]);
          }}
          matchingTransactions={matchingTransactionsForLink}
          onLinkTransactions={handleLinkTransactions}
          categories={categories}
          recipients={recipients}
          occurrenceDate={budgetOccurrenceDateForLinking || new Date()}
        />
      </IonContent>
    </IonPage>
  );
};

export default BudgetHistory;

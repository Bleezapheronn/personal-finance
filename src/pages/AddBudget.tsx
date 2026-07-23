import React, { useEffect, useState, useRef } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonLabel,
  IonInput,
  IonButton,
  IonText,
  IonGrid,
  IonRow,
  IonCol,
  IonSegment,
  IonSegmentButton,
  IonItem,
  IonIcon,
  useIonViewWillEnter,
  IonToast,
  IonCheckbox,
  IonCard,
  IonCardContent,
} from "@ionic/react";
import { db, Budget, Category, Bucket, Account, Recipient } from "../db";
import { addOutline } from "ionicons/icons";
import {
  validateBudgetForm,
  validateAmount,
  validateDescription,
  ValidationErrors,
} from "../utils/budgetValidation";
import {
  deleteFutureUnlinkedSnapshotsForBudget,
  ensureBudgetSnapshotCoverage,
  updateUnlockedSnapshotsForBudget,
} from "../utils/budgetSnapshots";
import { AddRecipientModal } from "../components/AddRecipientModal";
import { AddCategoryModal } from "../components/AddCategoryModal";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import {
  getRepositoryBackend,
  isHttpSelectedReadRepositoryBackend,
  isSqliteAuthorityControlledBackend,
} from "../repositories/adapterSelection";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  budgetDefinitionWriteErrorCode,
  createBudgetDefinitionInDisposableSqlite,
  isBudgetsWriteExperimentEnabled,
  updateBudgetDefinitionInDisposableSqlite,
  type BudgetDefinitionWriteInput,
} from "../repositories/http/budgetDefinitionWriteExperiment";
import {
  budgetLifecycleWriteErrorCode,
  dryRunBudgetLifecycle,
  isBudgetLifecycleWriteExperimentEnabled,
  writeBudgetLifecycle,
} from "../repositories/http/budgetLifecycleWriteExperiment";
import {
  budgetActiveStateForEdit,
  budgetActiveStateForSubmission,
  shouldShowBudgetLifecycleActiveControl,
} from "./budgetLifecycleForm";

type BudgetType = "expense" | "income";

const selectedRows = <Row,>(
  result: Row[] | { rows: Row[] },
): Row[] => (Array.isArray(result) ? result : result.rows);

const apiBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean"
    ? value
    : typeof value === "number"
      ? value === 1
      : fallback;

const apiDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));

const normalizeSelectedBudget = (row: unknown): Budget => {
  const source = row as Record<string, unknown>;
  return {
    ...source,
    id: Number(source.id),
    description: String(source.description),
    categoryId: Number(source.categoryId),
    accountId:
      source.accountId === null || source.accountId === undefined
        ? undefined
        : Number(source.accountId),
    recipientId:
      source.recipientId === null || source.recipientId === undefined
        ? undefined
        : Number(source.recipientId),
    amount: Number(source.amount),
    transactionCost:
      source.transactionCost === null || source.transactionCost === undefined
        ? undefined
        : Number(source.transactionCost),
    frequency: source.frequency as Budget["frequency"],
    frequencyDetails:
      typeof source.frequencyDetails === "string"
        ? JSON.parse(source.frequencyDetails)
        : (source.frequencyDetails as Budget["frequencyDetails"]),
    isGoal: apiBoolean(source.isGoal),
    isFlexible: apiBoolean(source.isFlexible),
    goalPercentage:
      source.goalPercentage === null || source.goalPercentage === undefined
        ? undefined
        : Number(source.goalPercentage),
    goalDirection:
      source.goalDirection === "income" || source.goalDirection === "expense"
        ? source.goalDirection
        : undefined,
    isActive: apiBoolean(source.isActive, true),
    remainingCyclesTotal:
      source.remainingCyclesTotal === null ||
      source.remainingCyclesTotal === undefined
        ? null
        : Number(source.remainingCyclesTotal),
    dueDate: apiDate(source.dueDate),
    createdAt: apiDate(source.createdAt),
    updatedAt: apiDate(source.updatedAt),
  } as Budget;
};

const AddBudget: React.FC = () => {
  const history = useHistory();
  const { id, transactionId } = useParams<{
    id?: string;
    transactionId?: string;
  }>();
  const isEditMode = Boolean(id);
  const isFromTransaction = Boolean(transactionId);
  const repositoryBackend = getRepositoryBackend();
  const rehearsal = useSqliteAuthorityRehearsal();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(repositoryBackend);
  const budgetDefinitionHttpMode =
    isHttpSelectedReadRepositoryBackend(repositoryBackend);
  const budgetDefinitionWriteExperimentActive =
    (repositoryBackend === "http-readonly" &&
      isBudgetsWriteExperimentEnabled());
  const budgetLifecycleWriteExperimentActive =
    rehearsalSelected &&
    rehearsal.ready &&
    rehearsal.budgetLifecycleWritesAvailable &&
    isBudgetLifecycleWriteExperimentEnabled();

  // Budget fields
  const [budgetType, setBudgetType] = useState<BudgetType>("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [recipientId, setRecipientId] = useState<number | undefined>(undefined);
  const [dueDate, setDueDate] = useState<string>("");
  const [frequency, setFrequency] = useState<
    "once" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
  >("once");
  const [dayOfMonth, setDayOfMonth] = useState<string>("");
  const [intervalDays, setIntervalDays] = useState<string>("");
  const [remainingCyclesTotal, setRemainingCyclesTotal] = useState<string>("");
  const [isGoal, setIsGoal] = useState(false);
  const [isFlexible, setIsFlexible] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [amountMode, setAmountMode] = useState<"fixed" | "percentage">("fixed");
  const [goalPercentage, setGoalPercentage] = useState<string>("");

  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [sortedCategories, setSortedCategories] = useState<Category[]>([]);
  const [sortedAccounts, setSortedAccounts] = useState<Account[]>([]);
  const [sortedRecipients, setSortedRecipients] = useState<Recipient[]>([]);

  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  // REMOVED: showPaymentMethodModal

  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [successToastMessage, setSuccessToastMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});

  // Description autocomplete state
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<
    Array<{ text: string; count: number }>
  >([]);
  const [showDescriptionSuggestions, setShowDescriptionSuggestions] =
    useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const descriptionInputRef = useRef<HTMLIonInputElement>(null);

  const [hasLinkedTransactions, setHasLinkedTransactions] = useState(false);

  // Clear messages when entering page
  useIonViewWillEnter(() => {
    setErrorMsg("");
    setFieldErrors({});
  });

  // Load lookup data
  useIonViewWillEnter(() => {
    loadLookupData();
  });

  const loadLookupData = async () => {
    try {
      let b: Bucket[];
      let c: Category[];
      let a: Account[];
      let r: Recipient[];
      let budgets: Budget[];
      let transactions: Array<{ description?: string }>;

      if (budgetDefinitionHttpMode) {
        const repositories = getSelectedReadRepositories(repositoryBackend);
        const [bucketRows, categoryRows, accountRows, recipientRows, budgetRows] =
          await Promise.all([
            repositories.buckets.list({ limit: 500 }),
            repositories.categories.list({ limit: 500 }),
            repositories.accounts.list({ limit: 500 }),
            repositories.recipients.list({ limit: 500 }),
            repositories.budgets.list({ limit: 500 }),
          ]);
        b = selectedRows(
          bucketRows as unknown as Bucket[] | { rows: Bucket[] },
        ).map((row) => ({
          ...row,
          id: Number(row.id),
          isActive: apiBoolean(row.isActive),
        }));
        c = selectedRows(
          categoryRows as unknown as Category[] | { rows: Category[] },
        ).map((row) => ({
          ...row,
          id: Number(row.id),
          bucketId: Number(row.bucketId),
          isActive: apiBoolean(row.isActive),
        }));
        a = selectedRows(
          accountRows as unknown as Account[] | { rows: Account[] },
        ).map((row) => ({
          ...row,
          id: Number(row.id),
          isActive: apiBoolean(row.isActive),
          isCredit: apiBoolean(row.isCredit),
        }));
        r = selectedRows(
          recipientRows as unknown as Recipient[] | { rows: Recipient[] },
        ).map((row) => ({
          ...row,
          id: Number(row.id),
          isActive: apiBoolean(row.isActive),
        }));
        budgets = selectedRows(
          budgetRows as unknown as Budget[] | { rows: Budget[] },
        ).map(normalizeSelectedBudget);
        // Transaction-derived autocomplete is intentionally not loaded by the
        // definition-only HTTP write experiment.
        transactions = [];
      } else {
        [b, c, a, r, budgets, transactions] = await Promise.all([
          db.buckets.toArray(),
          db.categories.toArray(),
          db.accounts.toArray(),
          db.recipients.toArray(),
          db.budgets.toArray(),
          db.transactions.toArray(),
        ]);
      }

      // Show active items only in add mode, all items in edit mode
      const activeAccounts =
        isEditMode || isFromTransaction
          ? a
          : a.filter((acc) => acc.isActive !== false);

      const activeBuckets =
        isEditMode || isFromTransaction
          ? b
          : b.filter((bkt) => bkt.isActive !== false);

      const activeCategories =
        isEditMode || isFromTransaction
          ? c
          : c.filter((cat) => {
              const bucket = b.find((bucket) => bucket.id === cat.bucketId);
              return cat.isActive !== false && bucket?.isActive !== false;
            });

      const activeRecipients =
        isEditMode || isFromTransaction
          ? r
          : r.filter((rec) => rec.isActive !== false);

      setBuckets(activeBuckets);
      setSortedAccounts(activeAccounts); // CHANGED

      const recipientCounts = new Map<number, number>();
      budgets.forEach((budget) => {
        if (budget.recipientId) {
          const count = recipientCounts.get(budget.recipientId) || 0;
          recipientCounts.set(budget.recipientId, count + 1);
        }
      });
      const sortedRecips = [...activeRecipients].sort((a, b) => {
        const countA = recipientCounts.get(a.id!) || 0;
        const countB = recipientCounts.get(b.id!) || 0;
        return countB - countA;
      });
      setSortedRecipients(sortedRecips);

      const categoryCounts = new Map<number, number>();
      budgets.forEach((budget) => {
        const count = categoryCounts.get(budget.categoryId) || 0;
        categoryCounts.set(budget.categoryId, count + 1);
      });
      const sortedCats = [...activeCategories].sort((a, b) => {
        const countA = categoryCounts.get(a.id!) || 0;
        const countB = categoryCounts.get(b.id!) || 0;
        return countB - countA;
      });
      setSortedCategories(sortedCats);

      // REMOVED: account count logic for payment methods

      // Count occurrences of each description from transactions
      const descriptionCounts = new Map<string, number>();
      transactions.forEach((txn) => {
        if (txn.description) {
          const count = descriptionCounts.get(txn.description) || 0;
          descriptionCounts.set(txn.description, count + 1);
        }
      });

      // Convert to array and sort by count (descending)
      const sortedDescriptions = Array.from(descriptionCounts.entries())
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count);

      setDescriptionSuggestions(sortedDescriptions);
    } catch (err) {
      console.error("Failed to load lookup data:", err);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const suggestionsBox = document.getElementById("description-suggestions");
      const input = descriptionInputRef.current;

      if (
        suggestionsBox &&
        !suggestionsBox.contains(target) &&
        input &&
        !input.contains(target)
      ) {
        setShowDescriptionSuggestions(false);
        setSelectedSuggestionIndex(-1);
      }
    };

    if (showDescriptionSuggestions) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDescriptionSuggestions]);

  // Fuzzy match function
  const fuzzyMatch = (query: string, target: string): boolean => {
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();

    let queryIndex = 0;
    for (
      let i = 0;
      i < targetLower.length && queryIndex < queryLower.length;
      i++
    ) {
      if (targetLower[i] === queryLower[queryIndex]) {
        queryIndex++;
      }
    }

    return queryIndex === queryLower.length;
  };

  // Filter suggestions based on input with fuzzy matching
  const MAX_SUGGESTIONS = 5;
  const filteredDescriptions = React.useMemo(
    () =>
      descriptionSuggestions
        .filter((item) => fuzzyMatch(description, item.text))
        .slice(0, MAX_SUGGESTIONS),
    [descriptionSuggestions, description],
  );

  // Handle keyboard navigation
  const handleDescriptionKeyDown = async (e: React.KeyboardEvent) => {
    if (!showDescriptionSuggestions || filteredDescriptions.length === 0)
      return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < filteredDescriptions.length - 1 ? prev + 1 : prev,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedSuggestionIndex >= 0) {
          await selectSuggestion(
            filteredDescriptions[selectedSuggestionIndex].text,
          );
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowDescriptionSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };

  const handleDescriptionChange = (value: string) => {
    try {
      setDescription(value);
      setShowDescriptionSuggestions(true);
      setSelectedSuggestionIndex(-1);
    } catch (err) {
      console.error("Error updating description:", err);
    }
  };

  const selectSuggestion = async (text: string) => {
    setDescription(text);
    setShowDescriptionSuggestions(false);
    setSelectedSuggestionIndex(-1);

    try {
      await populateFromLastTransaction(text);
    } catch (err) {
      console.error("Failed to populate from last transaction:", err);
    }
  };

  // Helper to populate fields from the most recent transaction for a description
  const populateFromLastTransaction = async (description: string) => {
    if (!description || !description.trim()) return;
    if (budgetDefinitionHttpMode) return;
    try {
      const txs = await db.transactions
        .where("description")
        .equals(description)
        .toArray();

      if (!txs || txs.length === 0) return;

      // Pick the most recent by date
      const latest = txs.reduce((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return ta >= tb ? a : b;
      });

      // Only populate if the destination fields are currently empty
      if (recipientId == null && latest.recipientId != null) {
        setRecipientId(latest.recipientId);
        setFieldErrors((prev) => ({ ...prev, recipient: false }));
      }
      if (categoryId == null && latest.categoryId != null) {
        setCategoryId(latest.categoryId);
        setFieldErrors((prev) => ({ ...prev, category: false }));
      }
      if (accountId == null && latest.accountId != null) {
        setAccountId(latest.accountId); // CHANGED from paymentChannelId
        setFieldErrors((prev) => ({ ...prev, account: false }));
      }
    } catch (err) {
      console.error("Failed to load last transaction for description:", err);
    }
  };

  // Helper function to calculate next month's due date intelligently
  const getNextMonthDueDate = (txnDate: Date): string => {
    const nextMonth = new Date(txnDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const originalDay = txnDate.getDate();
    const lastDayOfNextMonth = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
      0,
    ).getDate();

    if (originalDay > lastDayOfNextMonth) {
      nextMonth.setDate(lastDayOfNextMonth);
    } else {
      nextMonth.setDate(originalDay);
    }

    const year = nextMonth.getFullYear();
    const month = String(nextMonth.getMonth() + 1).padStart(2, "0");
    const day = String(nextMonth.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Load budget data in edit mode or from transaction
  useEffect(() => {
    if (isEditMode && id) {
      const loadBudget = async () => {
        try {
          const selectedBudget = budgetDefinitionHttpMode
            ? await getSelectedReadRepositories(
                repositoryBackend,
              ).budgets.getById(Number(id))
            : undefined;
          const budget = budgetDefinitionHttpMode
            ? selectedBudget
              ? normalizeSelectedBudget(selectedBudget)
              : undefined
            : await db.budgets.get(Number(id));

          if (budget) {
            setEditingBudget(budget);
            setBudgetType(budget.amount < 0 ? "expense" : "income");
            setDescription(budget.description);
            setAmount(Math.abs(budget.amount).toString());
            setTransactionCost(
              budget.transactionCost
                ? Math.abs(budget.transactionCost).toString()
                : "",
            );
            setCategoryId(budget.categoryId);
            setAccountId(budget.accountId); // CHANGED from paymentChannelId
            setRecipientId(budget.recipientId);
            setIsGoal(budget.isGoal);
            setIsFlexible(budget.isFlexible ?? false);
            setIsActive(budgetActiveStateForEdit(budget.isActive));
            if (budget.goalPercentage) {
              setAmountMode("percentage");
              setGoalPercentage(String(budget.goalPercentage));
              // Set budgetType based on goalDirection for percentage budgets
              if (budget.goalDirection === "income") {
                setBudgetType("income");
              } else if (budget.goalDirection === "expense") {
                setBudgetType("expense");
              }
            } else {
              setAmountMode("fixed");
              setGoalPercentage("");
            }

            const dueDateObj = new Date(budget.dueDate);
            const year = dueDateObj.getFullYear();
            const month = String(dueDateObj.getMonth() + 1).padStart(2, "0");
            const day = String(dueDateObj.getDate()).padStart(2, "0");
            setDueDate(`${year}-${month}-${day}`);

            setFrequency(budget.frequency);
            setRemainingCyclesTotal(
              budget.remainingCyclesTotal
                ? budget.remainingCyclesTotal.toString()
                : "",
            );
            if (budget.frequencyDetails?.dayOfMonth) {
              setDayOfMonth(budget.frequencyDetails.dayOfMonth.toString());
            }
            if (budget.frequencyDetails?.intervalDays) {
              setIntervalDays(budget.frequencyDetails.intervalDays.toString());
            }
          }
        } catch (err) {
          console.error("Failed to load budget:", err);
          setErrorMsg("Failed to load budget for editing");
        }
      };

      loadBudget();
    } else if (isFromTransaction && transactionId) {
      const loadTransactionData = async () => {
        try {
          if (budgetDefinitionHttpMode) {
            setErrorMsg(
              "Creating a Budget definition from a transaction is not available in the SQLite write experiment.",
            );
            return;
          }
          const transaction = await db.transactions.get(Number(transactionId));

          if (transaction) {
            setBudgetType(transaction.amount < 0 ? "expense" : "income");
            setDescription(transaction.description || "");
            setAmount(Math.abs(transaction.amount).toString());

            if (transaction.transactionCost) {
              setTransactionCost(
                Math.abs(transaction.transactionCost).toString(),
              );
            }

            setCategoryId(transaction.categoryId);
            setAccountId(transaction.accountId); // CHANGED from paymentChannelId
            setRecipientId(transaction.recipientId);

            setFrequency("monthly");
            const nextMonthDate = getNextMonthDueDate(
              new Date(transaction.date),
            );
            setDueDate(nextMonthDate);

            const dayOfMonthValue = new Date(transaction.date).getDate();
            setDayOfMonth(dayOfMonthValue.toString());

            setIsGoal(false);
            setIsFlexible(false);
            setIsActive(true);
          }
        } catch (err) {
          console.error("Failed to load transaction:", err);
          setErrorMsg("Failed to load transaction data");
        }
      };

      loadTransactionData();
    } else {
      resetForm();
    }
  }, [id, transactionId, isEditMode, isFromTransaction]);

  // Check for linked transactions when loading a budget for editing
  useEffect(() => {
    if (isEditMode && id) {
      const checkLinkedTransactions = async () => {
        try {
          if (budgetDefinitionHttpMode) {
            const repositories = getSelectedReadRepositories(repositoryBackend);
            const snapshotResult = await repositories.budgetSnapshots.listForBudget(
              Number(id),
              { limit: 500 },
            );
            const snapshots = selectedRows(
              snapshotResult as unknown as Array<{ id?: number }> | {
                rows: Array<{ id?: number }>;
              },
            );
            const linkedCounts = await Promise.all(
              snapshots
                .map((snapshot) => Number(snapshot.id))
                .filter((snapshotId) => Number.isInteger(snapshotId))
                .map((budgetSnapshotId) =>
                  repositories.transactions.count({ budgetSnapshotId }),
                ),
            );
            setHasLinkedTransactions(
              linkedCounts.some((linkedCount) => linkedCount > 0),
            );
            return;
          }
          const [allSnapshots, allTransactions] = await Promise.all([
            db.budgetSnapshots.where("budgetId").equals(Number(id)).toArray(),
            db.transactions.toArray(),
          ]);

          const snapshotIds = new Set(
            allSnapshots
              .map((snapshot) => snapshot.id)
              .filter(
                (snapshotId): snapshotId is number => snapshotId !== undefined,
              ),
          );

          const linkedTxns = allTransactions.filter(
            (txn) =>
              txn.budgetSnapshotId !== undefined &&
              snapshotIds.has(txn.budgetSnapshotId),
          );

          setHasLinkedTransactions(linkedTxns.length > 0);
        } catch (err) {
          console.error("Failed to check linked transactions:", err);
        }
      };

      checkLinkedTransactions();
    }
  }, [id, isEditMode]);

  const resetForm = () => {
    setBudgetType("expense");
    setDescription("");
    setAmount("");
    setTransactionCost("");
    setCategoryId(undefined);
    setAccountId(undefined); // CHANGED
    setRecipientId(undefined);
    setDueDate("");
    setFrequency("once");
    setDayOfMonth("");
    setIntervalDays("");
    setRemainingCyclesTotal("");
    setIsGoal(false);
    setIsFlexible(false);
    setIsActive(true);
    setAmountMode("fixed");
    setGoalPercentage("");
    setEditingBudget(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setShowSuccessToast(false);
    setFieldErrors({});

    if (
      budgetDefinitionHttpMode &&
      !budgetDefinitionWriteExperimentActive &&
      !budgetLifecycleWriteExperimentActive
    ) {
      setErrorMsg(
        rehearsalSelected
          ? "Safe Budget lifecycle writes are unavailable. No definition-only fallback was attempted."
          : "Budget definition HTTP writes are disabled. Enable the dev write experiment or switch back to Dexie.",
      );
      return;
    }

    // Validate form - CHANGED validation to use accountId
    const formValidation = validateBudgetForm({
      description,
      amount,
      dueDate,
      categoryId,
      accountId, // CHANGED from paymentMethodId
      recipientId,
      remainingCyclesTotal,
      frequency,
      dayOfMonth: frequency === "monthly" ? dayOfMonth : undefined,
      intervalDays: frequency === "custom" ? intervalDays : undefined,
      goalPercentage: amountMode === "percentage" ? goalPercentage : undefined,
    });

    if (!formValidation.isValid) {
      setFieldErrors(formValidation.errors);
      setErrorMsg(
        formValidation.errorMessage || "Please fill in all required fields.",
      );
      return;
    }

    // Validate amount — skip when a valid percentage is provided instead
    const hasValidPercentage =
      amountMode === "percentage" &&
      goalPercentage.trim() !== "" &&
      !isNaN(parseFloat(goalPercentage)) &&
      parseFloat(goalPercentage) > 0;

    if (!hasValidPercentage) {
      const amountValidation = validateAmount(amount);
      if (!amountValidation.isValid) {
        setFieldErrors(amountValidation.errors);
        setErrorMsg(amountValidation.errorMessage || "Invalid amount.");
        return;
      }
    } else if (parseFloat(goalPercentage) > 100) {
      setFieldErrors((prev) => ({ ...prev, amount: true }));
      setErrorMsg("Percentage cannot exceed 100.");
      return;
    }

    // Validate description
    const descriptionValidation = validateDescription(description);
    if (!descriptionValidation.isValid) {
      setFieldErrors(descriptionValidation.errors);
      setErrorMsg(descriptionValidation.errorMessage || "Invalid description.");
      return;
    }

    let sqliteWriteConfirmed = false;
    try {
      const dueDateObj = new Date(dueDate);
      const numericAmountRaw = amount.trim() ? parseFloat(amount) : 0;
      const numericAmount =
        budgetType === "expense"
          ? -Math.abs(numericAmountRaw)
          : Math.abs(numericAmountRaw);

      const parsedCost = transactionCost ? parseFloat(transactionCost) : NaN;
      const numericCost = !isNaN(parsedCost)
        ? -Math.abs(parsedCost)
        : undefined;

      const frequencyDetails: Budget["frequencyDetails"] = {};
      if (frequency === "monthly" && dayOfMonth) {
        frequencyDetails.dayOfMonth = parseInt(dayOfMonth, 10);
      }
      if (frequency === "custom" && intervalDays) {
        frequencyDetails.intervalDays = parseInt(intervalDays, 10);
      }

      const parsedRemainingCycles = remainingCyclesTotal.trim()
        ? parseInt(remainingCyclesTotal, 10)
        : null;

      const budgetData: Omit<Budget, "id"> = {
        description: description.trim(),
        amount: numericAmount,
        transactionCost: numericCost,
        categoryId: categoryId!,
        accountId: accountId!, // CHANGED from paymentChannelId
        recipientId: recipientId,
        dueDate: dueDateObj,
        frequency: frequency,
        frequencyDetails:
          Object.keys(frequencyDetails).length > 0
            ? frequencyDetails
            : undefined,
        isGoal: isGoal,
        isFlexible: isFlexible,
        goalPercentage:
          amountMode === "percentage" && goalPercentage.trim()
            ? parseFloat(goalPercentage)
            : undefined,
        goalDirection:
          amountMode === "percentage"
            ? budgetType === "income"
              ? "income"
              : "expense"
            : undefined,
        isActive: budgetActiveStateForSubmission(
          budgetLifecycleWriteExperimentActive,
          isActive,
        ),
        remainingCyclesTotal:
          parsedRemainingCycles && parsedRemainingCycles > 0
            ? parsedRemainingCycles
            : null,
        createdAt: editingBudget?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      if (budgetLifecycleWriteExperimentActive) {
        if (isFromTransaction) {
          setErrorMsg(
            "Creating a Budget from a transaction is not available in the SQLite lifecycle experiment.",
          );
          return;
        }
        const action = isEditMode && id ? "update" : "create";
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const localAsOf = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const lifecycleInput = {
          ...(action === "update" ? { id: Number(id) } : {}),
          description: budgetData.description,
          categoryId: budgetData.categoryId,
          accountId: budgetData.accountId!,
          recipientId: budgetData.recipientId ?? null,
          amount: budgetData.amount,
          transactionCost: budgetData.transactionCost ?? null,
          frequency: budgetData.frequency,
          frequencyDetails: budgetData.frequencyDetails ?? null,
          isGoal: budgetData.isGoal,
          isFlexible: budgetData.isFlexible,
          goalPercentage: budgetData.goalPercentage ?? null,
          goalDirection: budgetData.goalDirection ?? null,
          remainingCyclesTotal: budgetData.remainingCyclesTotal ?? null,
          dueDate: budgetData.dueDate.toISOString(),
          isActive: budgetData.isActive,
          asOf: localAsOf,
        };
        const dryRun = await dryRunBudgetLifecycle(action, lifecycleInput);
        const confirmed = window.confirm(
          `Apply safer SQLite Budget lifecycle?\n\n` +
            `Unlinked current/future snapshots to remove: ${dryRun.unlinkedFutureSnapshotsProposedForCleanup}\n` +
            `Linked snapshots protected: ${dryRun.linkedSnapshotsProtected}\n` +
            `Out-of-schedule linked snapshots retained: ${dryRun.outOfScheduleLinkedSnapshotsRetained}\n` +
            `Snapshots to generate: ${dryRun.snapshotsProposedForGeneration}\n\n` +
            "This changes SQLite only. Rotate the authority checkpoint before restarting the API.",
        );
        if (!confirmed) return;
        const writeResponse = await writeBudgetLifecycle(
          action,
          lifecycleInput,
          dryRun.planFingerprint!,
        );
        sqliteWriteConfirmed = true;
        const writtenId = Number(writeResponse.targetId ?? id);
        const refreshed = await getSelectedReadRepositories(
          repositoryBackend,
        ).budgets.getById(writtenId);
        if (!refreshed) throw new Error("budget_lifecycle_refresh_failed");
        setSuccessToastMessage(
          rehearsal.authoritativeMode
            ? "Budget lifecycle updated authoritative SQLite. Rotate the checkpoint before API restart."
            : "Budget lifecycle updated disposable SQLite. Dexie was not changed.",
        );
        setShowSuccessToast(true);
        setTimeout(() => history.push("/budget"), 500);
      } else if (budgetDefinitionWriteExperimentActive) {
        if (isFromTransaction) {
          setErrorMsg(
            "Creating a Budget definition from a transaction is not available in the SQLite write experiment.",
          );
          return;
        }
        const writeInput: BudgetDefinitionWriteInput = {
          description: budgetData.description,
          categoryId: budgetData.categoryId,
          accountId: budgetData.accountId!,
          recipientId: budgetData.recipientId ?? null,
          amount: budgetData.amount,
          transactionCost: budgetData.transactionCost ?? null,
          frequency: budgetData.frequency,
          frequencyDetails: budgetData.frequencyDetails ?? null,
          isGoal: budgetData.isGoal,
          isFlexible: budgetData.isFlexible,
          goalPercentage: budgetData.goalPercentage ?? null,
          goalDirection: budgetData.goalDirection ?? null,
          remainingCyclesTotal: budgetData.remainingCyclesTotal ?? null,
          dueDate: budgetData.dueDate.toISOString(),
        };
        let writtenId: number;
        if (isEditMode && id) {
          const writeResponse =
            await updateBudgetDefinitionInDisposableSqlite(
            Number(id),
            writeInput,
          );
          sqliteWriteConfirmed = true;
          writtenId = Number(writeResponse.targetId);
          setSuccessToastMessage(
            rehearsal.authoritativeMode
              ? "Budget definition updated in authoritative SQLite. Existing snapshots and Budget History were not changed."
              : "Budget definition updated in disposable SQLite. Existing snapshots and Budget History were not changed.",
          );
        } else {
          const writeResponse =
            await createBudgetDefinitionInDisposableSqlite(writeInput);
          sqliteWriteConfirmed = true;
          writtenId = Number(writeResponse.targetId);
          setSuccessToastMessage(
            rehearsal.authoritativeMode
              ? "Budget definition created in authoritative SQLite. No snapshot or Budget History occurrence was generated."
              : "Budget definition created in disposable SQLite. No snapshot or Budget History occurrence was generated.",
          );
        }
        const refreshed = await getSelectedReadRepositories(
          repositoryBackend,
        ).budgets.getById(writtenId);
        if (!refreshed) {
          throw new Error("budget_definition_refresh_failed");
        }
        setShowSuccessToast(true);
        setTimeout(() => {
          history.push("/budget");
        }, 500);
      } else if (isEditMode && id) {
        await db.budgets.update(Number(id), budgetData);

        let unlockedSnapshotsUpdated = 0;
        const updatedBudget = await db.budgets.get(Number(id));
        if (updatedBudget) {
          // Keep historical snapshots immutable, but sync upcoming snapshot values.
          unlockedSnapshotsUpdated = await updateUnlockedSnapshotsForBudget(
            updatedBudget,
            new Date(),
          );
        }

        // Preserve immutable history by only pruning future snapshots that have no linked transactions.
        await deleteFutureUnlinkedSnapshotsForBudget(Number(id), new Date());
        if (updatedBudget) {
          const oneYearFromNow = new Date();
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
          await ensureBudgetSnapshotCoverage(updatedBudget, oneYearFromNow);
        }

        setSuccessToastMessage(
          `Budget updated successfully (${unlockedSnapshotsUpdated} upcoming snapshot${
            unlockedSnapshotsUpdated === 1 ? "" : "s"
          } updated).`,
        );
        setShowSuccessToast(true);
      } else {
        await db.budgets.add(budgetData);
        setSuccessToastMessage(
          isFromTransaction
            ? "Budget created from transaction successfully!"
            : "Budget added successfully!",
        );
        setShowSuccessToast(true);
      }

      if (!isEditMode) {
        resetForm();
        setTimeout(() => {
          history.push("/budget");
        }, 500);
      }
    } catch (error) {
      console.error("Error saving budget:", error);
      if (budgetLifecycleWriteExperimentActive) {
        if (sqliteWriteConfirmed) {
          setErrorMsg(
            "SQLite may have changed, but the selected-read refresh failed. Reload before retrying; do not repeat the write automatically.",
          );
          return;
        }
        setErrorMsg(
          `Budget lifecycle SQLite write failed: ${budgetLifecycleWriteErrorCode(error)}`,
        );
        return;
      }
      if (budgetDefinitionWriteExperimentActive) {
        if (sqliteWriteConfirmed) {
          setErrorMsg(
            "SQLite changed, but the selected-read refresh failed. Reload before retrying; do not repeat the write automatically.",
          );
          return;
        }
        setErrorMsg(
          `Budget definition SQLite write failed: ${budgetDefinitionWriteErrorCode(
            error,
          )}`,
        );
        return;
      }
      setErrorMsg(
        `Failed to ${isEditMode ? "update" : "add"} budget. Please try again.`,
      );
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>
            {isEditMode
              ? "Edit Budget"
              : isFromTransaction
                ? "Create Budget from Transaction"
                : "Add Budget"}
          </IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {budgetDefinitionHttpMode && (
          <IonCard color="warning">
            <IonCardContent>
              <IonText>
                <h3>
                  {rehearsalSelected
                    ? "Safer SQLite Budget lifecycle"
                    : "Budget Definitions SQLite write experiment"}
                </h3>
                <p>
                  {budgetLifecycleWriteExperimentActive
                    ? rehearsal.authoritativeMode
                      ? "SQLite authoritative mode is active. Create/update uses atomic target-Budget cleanup and coverage generation. Linked and historical snapshots remain unchanged."
                      : "Writes use the safer disposable SQLite lifecycle policy. Dexie remains unchanged; linked and historical snapshots are preserved."
                    : budgetDefinitionWriteExperimentActive
                    ? rehearsal.authoritativeMode
                      ? "SQLite authoritative mode is active. Supported Budget definition writes use the verified local SQLite database. This form does not generate, prune, delete, or relink Budget snapshots."
                      : "Writes go to disposable local SQLite only. Dexie remains authoritative. Creating or editing a definition does not generate, update, prune, delete, or relink budget snapshots."
                    : rehearsalSelected
                      ? "Safe Budget lifecycle support is unavailable. Definition-only fallback is disabled."
                      : "The HTTP backend is selected, but Budget definition writes are disabled. No write will be attempted."}
                </p>
                <p>
                  {budgetLifecycleWriteExperimentActive
                    ? "Dry-run and confirmation are required. No global pruning, repair, relinking, or automatic checkpoint is performed."
                    : "Create/update definitions only. Existing Budget History remains unchanged, delete is unavailable, and SQLite must be re-imported before clean parity checks."}
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        )}
        <form onSubmit={handleSubmit}>
          <IonGrid>
            {/* Budget Type: Income/Expense */}
            <IonRow>
              <IonCol>
                <IonItem lines="none">
                  <IonSegment
                    value={budgetType}
                    onIonChange={(e) =>
                      setBudgetType(e.detail.value as BudgetType)
                    }
                  >
                    <IonSegmentButton value="income">
                      <IonLabel>Income</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="expense">
                      <IonLabel>Expense</IonLabel>
                    </IonSegmentButton>
                  </IonSegment>
                </IonItem>
              </IonCol>
            </IonRow>

            {/* Error message */}
            <IonRow>
              <IonCol>
                {errorMsg && <IonText color="danger">{errorMsg}</IonText>}
              </IonCol>
            </IonRow>

            {/* Description - WITH AUTOCOMPLETE */}
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Description</label>
                  <IonInput
                    ref={descriptionInputRef}
                    className="form-input"
                    type="text"
                    placeholder="e.g. Monthly rent, Electricity bill"
                    value={description}
                    onIonInput={(e) => {
                      handleDescriptionChange(e.detail.value!);
                      setFieldErrors((prev) => ({
                        ...prev,
                        description: false,
                      }));
                    }}
                    onIonFocus={() => setShowDescriptionSuggestions(true)}
                    onKeyDown={handleDescriptionKeyDown}
                  />
                  {fieldErrors.description && (
                    <span className="error-message">Required field</span>
                  )}
                  {showDescriptionSuggestions &&
                    filteredDescriptions.length > 0 &&
                    description && (
                      <div
                        id="description-suggestions"
                        style={{
                          position: "absolute",
                          backgroundColor: "var(--ion-background-color)",
                          border: "1px solid var(--ion-color-medium)",
                          borderRadius: "4px",
                          marginTop: "64px",
                          maxHeight: "200px",
                          overflowY: "auto",
                          zIndex: 1000,
                          width: "100%",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                        }}
                      >
                        {filteredDescriptions.map((item, idx) => (
                          <div
                            key={idx}
                            onClick={() => selectSuggestion(item.text)}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              backgroundColor:
                                idx === selectedSuggestionIndex
                                  ? "var(--ion-color-primary)"
                                  : "transparent",
                              color:
                                idx === selectedSuggestionIndex
                                  ? "var(--ion-color-primary-contrast)"
                                  : "inherit",
                              borderBottom:
                                idx < filteredDescriptions.length - 1
                                  ? "1px solid var(--ion-color-light)"
                                  : "none",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                            onMouseEnter={(e) => {
                              if (idx !== selectedSuggestionIndex) {
                                e.currentTarget.style.backgroundColor =
                                  "var(--ion-color-light)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (idx !== selectedSuggestionIndex) {
                                e.currentTarget.style.backgroundColor =
                                  "transparent";
                              }
                            }}
                          >
                            <span>{item.text}</span>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                opacity: 0.7,
                                marginLeft: "8px",
                              }}
                            >
                              {item.count}x
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </IonCol>
            </IonRow>

            {/* Category */}
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Category</label>
                  <SearchableFilterSelect
                    label=""
                    placeholder="Select category"
                    value={categoryId}
                    options={sortedCategories
                      .filter((c) => c.name)
                      .map((c) => {
                        const bucket = buckets.find((b) => b.id === c.bucketId);
                        return {
                          id: c.id,
                          name: `${c.name} - ${bucket?.name || "Unknown"}`,
                        };
                      })}
                    onIonChange={(v) => {
                      setCategoryId(v);
                      setFieldErrors((prev) => ({
                        ...prev,
                        category: false,
                      }));
                    }}
                  />
                  {fieldErrors.category && (
                    <IonText
                      color="danger"
                      style={{
                        fontSize: "0.75rem",
                        display: "block",
                        marginTop: "4px",
                      }}
                    >
                      Required field
                    </IonText>
                  )}
                </div>
              </IonCol>
              {!budgetDefinitionHttpMode && (
                <IonCol size="1">
                  <IonButton
                    style={{ marginTop: "23px" }}
                    color="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCategoryModal(true);
                    }}
                    aria-label="Add Category"
                    title="Add Category"
                  >
                    <IonIcon icon={addOutline} />
                  </IonButton>
                </IonCol>
              )}
            </IonRow>

            {/* Account - CHANGED from Payment Method */}
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Account</label>
                  <SearchableFilterSelect
                    label=""
                    placeholder="Select account"
                    value={accountId}
                    options={sortedAccounts
                      .filter((a) => a.name)
                      .map((a) => {
                        const currency = a.currency ? `(${a.currency})` : "(—)";
                        return {
                          id: a.id,
                          name: `${a.name} ${currency}`,
                        };
                      })}
                    onIonChange={(v) => {
                      setAccountId(v);
                      setFieldErrors((prev) => ({
                        ...prev,
                        account: false,
                      }));
                    }}
                  />
                  {fieldErrors.account && (
                    <IonText
                      color="danger"
                      style={{
                        fontSize: "0.75rem",
                        display: "block",
                        marginTop: "4px",
                      }}
                    >
                      Required field
                    </IonText>
                  )}
                </div>
              </IonCol>
            </IonRow>

            {/* Recipient */}
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Recipient (optional)</label>
                  <SearchableFilterSelect
                    label=""
                    placeholder="Select recipient"
                    value={recipientId}
                    options={sortedRecipients
                      .filter((r) => r.name)
                      .map((r) => ({
                        id: r.id,
                        name: r.name as string,
                      }))}
                    onIonChange={(v) => {
                      setRecipientId(v);
                      setFieldErrors((prev) => ({
                        ...prev,
                        recipient: false,
                      }));
                    }}
                  />
                </div>
              </IonCol>
              {!budgetDefinitionHttpMode && (
                <IonCol size="1">
                  <IonButton
                    style={{ marginTop: "23px" }}
                    color="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRecipientModal(true);
                    }}
                    aria-label="Add Recipient"
                    title="Add Recipient"
                  >
                    <IonIcon icon={addOutline} />
                  </IonButton>
                </IonCol>
              )}
            </IonRow>

            {/* Amount Mode Toggle */}
            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Amount Type</label>
                  <IonSegment
                    value={amountMode}
                    onIonChange={(e) =>
                      setAmountMode(e.detail.value as "fixed" | "percentage")
                    }
                  >
                    <IonSegmentButton value="fixed">
                      <IonLabel>Fixed Amount</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="percentage">
                      <IonLabel>% of Income</IonLabel>
                    </IonSegmentButton>
                  </IonSegment>
                </div>
              </IonCol>
            </IonRow>

            {/* Amount and Transaction Cost */}
            <IonRow>
              {amountMode === "percentage" && (
                <IonCol size="3">
                  <div className="form-input-wrapper">
                    <label className="form-label">
                      % of Year-to-Date Income
                    </label>
                    <IonInput
                      className="form-input"
                      placeholder="e.g. 5"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={goalPercentage}
                      onIonChange={(e) => {
                        setGoalPercentage(e.detail.value ?? "");
                        setFieldErrors((prev) => ({ ...prev, amount: false }));
                      }}
                      inputMode="decimal"
                    />
                    {fieldErrors.amount && (
                      <span className="error-message">Required field</span>
                    )}
                  </div>
                </IonCol>
              )}
              <IonCol size={amountMode === "percentage" ? "5" : "8"}>
                <div className="form-input-wrapper">
                  <label className="form-label">
                    {amountMode === "percentage"
                      ? "Minimum Floor (optional)"
                      : "Amount"}
                  </label>
                  <IonInput
                    className="form-input"
                    placeholder="e.g. 1,000.00"
                    type="number"
                    step="0.01"
                    value={amount}
                    onIonChange={(e) => {
                      setAmount(e.detail.value ?? "");
                      setFieldErrors((prev) => ({ ...prev, amount: false }));
                    }}
                    inputMode="decimal"
                  />
                  {fieldErrors.amount && amountMode === "fixed" && (
                    <span className="error-message">Required field</span>
                  )}
                </div>
              </IonCol>

              <IonCol size="3">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Transaction Cost (optional)
                  </label>
                  <IonInput
                    className="form-input"
                    placeholder="e.g. 13.00"
                    type="number"
                    value={transactionCost}
                    onIonChange={(e) =>
                      setTransactionCost(e.detail.value ?? "")
                    }
                    inputMode="decimal"
                    step="0.01"
                  />
                </div>
              </IonCol>
            </IonRow>

            {/* Due Date and Frequency */}
            <IonRow>
              <IonCol size="2">
                <div className="form-input-wrapper">
                  <label className="form-label">Due Date</label>
                  <IonInput
                    className="form-input"
                    type="date"
                    value={dueDate}
                    onIonChange={(e) => {
                      setDueDate(e.detail.value ?? "");
                      setFieldErrors((prev) => ({ ...prev, dueDate: false }));
                    }}
                  />
                  {fieldErrors.dueDate && (
                    <span className="error-message">Required field</span>
                  )}
                </div>
              </IonCol>

              {/* Frequency */}
              <IonCol size="4">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Frequency
                    {hasLinkedTransactions && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "#999",
                          marginLeft: "4px",
                        }}
                      >
                        (locked - has linked transactions)
                      </span>
                    )}
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => {
                      if (!hasLinkedTransactions) {
                        setFrequency(
                          e.target.value as
                            | "once"
                            | "daily"
                            | "weekly"
                            | "monthly"
                            | "yearly"
                            | "custom",
                        );
                        setDayOfMonth("");
                        setIntervalDays("");
                      }
                    }}
                    disabled={hasLinkedTransactions}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                      opacity: hasLinkedTransactions ? 0.5 : 1,
                      cursor: hasLinkedTransactions ? "not-allowed" : "pointer",
                    }}
                  >
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly (Fixed Day)</option>
                    <option value="custom">Custom (Every N Days)</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  {hasLinkedTransactions && (
                    <IonText
                      color="medium"
                      style={{
                        fontSize: "0.75rem",
                        display: "block",
                        marginTop: "4px",
                      }}
                    >
                      You can only change the day of month or interval days, not
                      the frequency type.
                    </IonText>
                  )}
                </div>
              </IonCol>

              {/* Day of Month (for monthly) */}
              {frequency === "monthly" && (
                <IonCol size="2">
                  <div className="form-input-wrapper">
                    <label className="form-label">Day of Month (1-31)</label>
                    <IonInput
                      className="form-input"
                      type="number"
                      placeholder="e.g. 5"
                      value={dayOfMonth}
                      onIonChange={(e) => setDayOfMonth(e.detail.value ?? "")}
                      min="1"
                      max="31"
                      inputMode="numeric"
                    />
                  </div>
                </IonCol>
              )}

              <IonCol size="3">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Remaining Cycles (optional)
                  </label>
                  <IonInput
                    className="form-input"
                    type="number"
                    placeholder="Empty = Infinite"
                    value={remainingCyclesTotal}
                    onIonChange={(e) => {
                      setRemainingCyclesTotal(e.detail.value ?? "");
                      setFieldErrors((prev) => ({
                        ...prev,
                        remainingCyclesTotal: false,
                      }));
                    }}
                    min="1"
                    inputMode="numeric"
                  />
                  {fieldErrors.remainingCyclesTotal && (
                    <IonText
                      color="danger"
                      style={{
                        fontSize: "0.75rem",
                        display: "block",
                        marginTop: "4px",
                      }}
                    >
                      Must be a positive whole number
                    </IonText>
                  )}
                </div>
              </IonCol>

              {/* Interval Days (for custom) */}
              {frequency === "custom" && (
                <IonCol size="2">
                  <div className="form-input-wrapper">
                    <label className="form-label">Repeat Every (N Days)</label>
                    <IonInput
                      className="form-input"
                      type="number"
                      placeholder="e.g. 28"
                      value={intervalDays}
                      onIonChange={(e) => setIntervalDays(e.detail.value ?? "")}
                      min="1"
                      inputMode="numeric"
                    />
                  </div>
                </IonCol>
              )}
            </IonRow>

            {/* Is Goal and Is Flexible Checkboxes */}
            <IonRow>
              <IonCol>
                <IonCheckbox
                  checked={isGoal}
                  onIonChange={(e) => setIsGoal(e.detail.checked)}
                  style={{ width: "18px", height: "18px" }}
                />
                <label style={{ cursor: "pointer", marginBottom: 0 }}>
                  This is a Goal (long-term budget)
                </label>
              </IonCol>
              <IonCol>
                <IonCheckbox
                  checked={isFlexible}
                  onIonChange={(e) => setIsFlexible(e.detail.checked)}
                  style={{ width: "18px", height: "18px" }}
                />
                <label style={{ cursor: "pointer", marginBottom: 0 }}>
                  This is Flexible (partial payment acceptable)
                </label>
              </IonCol>
              {shouldShowBudgetLifecycleActiveControl(
                budgetLifecycleWriteExperimentActive,
              ) && (
                <IonCol>
                  <IonCheckbox
                    checked={isActive}
                    onIonChange={(e) => setIsActive(e.detail.checked)}
                    style={{ width: "18px", height: "18px" }}
                  />
                  <label style={{ cursor: "pointer", marginBottom: 0 }}>
                    Active (generate scheduled snapshots)
                  </label>
                </IonCol>
              )}
            </IonRow>

            {/* Submit Button */}
            <IonRow>
              <IonCol size="11">
                <IonButton
                  type="submit"
                  expand="block"
                  color="primary"
                  disabled={
                    budgetDefinitionHttpMode &&
                    !budgetDefinitionWriteExperimentActive &&
                    !budgetLifecycleWriteExperimentActive
                  }
                >
                  {isEditMode
                    ? "Update Budget"
                    : isFromTransaction
                      ? "Create Budget"
                      : "Add Budget"}
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </form>
      </IonContent>

      {/* Modals */}
      {!budgetDefinitionHttpMode && (
        <>
          <AddRecipientModal
            isOpen={showRecipientModal}
            onClose={() => setShowRecipientModal(false)}
            onRecipientAdded={(recipient) => {
              setSortedRecipients((prev) => [recipient, ...prev]);
              setRecipientId(recipient.id);
            }}
          />

          <AddCategoryModal
            isOpen={showCategoryModal}
            onClose={() => setShowCategoryModal(false)}
            onCategoryAdded={(category) => {
              setSortedCategories((prev) => [category, ...prev]);
              setCategoryId(category.id);
            }}
            buckets={buckets}
          />
        </>
      )}

      {/* REMOVED: AddPaymentMethodModal */}

      {/* Toast */}
      <IonToast
        isOpen={showSuccessToast}
        onDidDismiss={() => setShowSuccessToast(false)}
        message={successToastMessage}
        duration={2000}
        position="top"
        color="success"
      />
    </IonPage>
  );
};

export default AddBudget;

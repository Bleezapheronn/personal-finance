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
} from "@ionic/react";
import {
  db,
  Budget,
  Category,
  Bucket,
  Account,
  PaymentMethod,
  Recipient,
} from "../db";
import { addOutline } from "ionicons/icons";
import {
  validateBudgetForm,
  validateAmount,
  validateDescription,
  ValidationErrors,
} from "../utils/budgetValidation";
import { AddRecipientModal } from "../components/AddRecipientModal";
import { AddCategoryModal } from "../components/AddCategoryModal";
import { AddPaymentMethodModal } from "../components/AddPaymentMethodModal";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import { SelectableDropdown } from "../components/SelectableDropdown";

type BudgetType = "expense" | "income";

const AddBudget: React.FC = () => {
  const history = useHistory();
  const { id, transactionId } = useParams<{
    id?: string;
    transactionId?: string;
  }>();
  const isEditMode = Boolean(id);
  const isFromTransaction = Boolean(transactionId);

  // Budget fields
  const [budgetType, setBudgetType] = useState<BudgetType>("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [paymentMethodId, setPaymentMethodId] = useState<number | undefined>(
    undefined
  );
  const [recipientId, setRecipientId] = useState<number | undefined>(undefined);
  const [dueDate, setDueDate] = useState<string>("");
  const [frequency, setFrequency] = useState<
    "once" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
  >("once");
  const [dayOfMonth, setDayOfMonth] = useState<string>("");
  const [intervalDays, setIntervalDays] = useState<string>("");
  const [isGoal, setIsGoal] = useState(false);
  const [isFlexible, setIsFlexible] = useState(false); // NEW: Default to false (strict)

  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [sortedCategories, setSortedCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sortedPaymentMethods, setSortedPaymentMethods] = useState<
    PaymentMethod[]
  >([]);
  const [sortedRecipients, setSortedRecipients] = useState<Recipient[]>([]);

  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);

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
      const [b, c, a, pm, r] = await Promise.all([
        db.buckets.toArray(),
        db.categories.toArray(),
        db.accounts.toArray(),
        db.paymentMethods.toArray(),
        db.recipients.toArray(),
      ]);

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

      const activePaymentMethods = (
        isEditMode || isFromTransaction
          ? pm
          : pm.filter((pmeth) => pmeth.isActive !== false)
      ).filter((pmeth) => {
        const accountExists = activeAccounts.some(
          (acc) => acc.id === pmeth.accountId
        );
        return accountExists;
      });

      const activeRecipients =
        isEditMode || isFromTransaction
          ? r
          : r.filter((rec) => rec.isActive !== false);

      setBuckets(activeBuckets);
      setAccounts(activeAccounts);

      // Sort by usage frequency
      const budgets = await db.budgets.toArray();

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

      const paymentMethodCounts = new Map<number, number>();
      budgets.forEach((budget) => {
        const count = paymentMethodCounts.get(budget.paymentChannelId) || 0;
        paymentMethodCounts.set(budget.paymentChannelId, count + 1);
      });
      const sortedPMs = [...activePaymentMethods].sort((a, b) => {
        const countA = paymentMethodCounts.get(a.id!) || 0;
        const countB = paymentMethodCounts.get(b.id!) || 0;
        return countB - countA;
      });
      setSortedPaymentMethods(sortedPMs);

      // Load descriptions sorted by frequency from TRANSACTIONS
      const transactions = await db.transactions.toArray();

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

  // Fuzzy match function - matches if all characters from query appear in order in the target
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
    [descriptionSuggestions, description]
  );

  // Handle keyboard navigation
  const handleDescriptionKeyDown = async (e: React.KeyboardEvent) => {
    if (!showDescriptionSuggestions || filteredDescriptions.length === 0)
      return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < filteredDescriptions.length - 1 ? prev + 1 : prev
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
            filteredDescriptions[selectedSuggestionIndex].text
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
      // Populate fields from the most recent transaction with this description
      await populateFromLastTransaction(text);
    } catch (err) {
      console.error("Failed to populate from last transaction:", err);
    }
  };

  // Helper to populate fields from the most recent transaction for a description
  const populateFromLastTransaction = async (description: string) => {
    if (!description || !description.trim()) return;
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
      if (paymentMethodId == null && latest.paymentChannelId != null) {
        setPaymentMethodId(latest.paymentChannelId);
        setFieldErrors((prev) => ({ ...prev, paymentMethod: false }));
      }
    } catch (err) {
      console.error("Failed to load last transaction for description:", err);
    }
  };

  // Helper function to calculate next month's due date intelligently
  const getNextMonthDueDate = (txnDate: Date): string => {
    const nextMonth = new Date(txnDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    // Get the original day
    const originalDay = txnDate.getDate();

    // Get the last day of the next month
    const lastDayOfNextMonth = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
      0
    ).getDate();

    // If original day is greater than last day of next month, use last day
    if (originalDay > lastDayOfNextMonth) {
      nextMonth.setDate(lastDayOfNextMonth);
    } else {
      nextMonth.setDate(originalDay);
    }

    // Format as YYYY-MM-DD
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
          const budget = await db.budgets.get(Number(id));

          if (budget) {
            setEditingBudget(budget);
            setBudgetType(budget.amount < 0 ? "expense" : "income");
            setDescription(budget.description);
            setAmount(Math.abs(budget.amount).toString());
            setTransactionCost(
              budget.transactionCost
                ? Math.abs(budget.transactionCost).toString()
                : ""
            );
            setCategoryId(budget.categoryId);
            setPaymentMethodId(budget.paymentChannelId);
            setRecipientId(budget.recipientId);
            setIsGoal(budget.isGoal);
            setIsFlexible(budget.isFlexible ?? false); // NEW: Load isFlexible, default to false

            // Format due date as YYYY-MM-DD
            const dueDateObj = new Date(budget.dueDate);
            const year = dueDateObj.getFullYear();
            const month = String(dueDateObj.getMonth() + 1).padStart(2, "0");
            const day = String(dueDateObj.getDate()).padStart(2, "0");
            setDueDate(`${year}-${month}-${day}`);

            setFrequency(budget.frequency);
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
          const transaction = await db.transactions.get(Number(transactionId));

          if (transaction) {
            // Pre-populate from transaction
            setBudgetType(transaction.amount < 0 ? "expense" : "income");
            setDescription(transaction.description || "");
            setAmount(Math.abs(transaction.amount).toString());

            // Include transaction cost if it exists
            if (transaction.transactionCost) {
              setTransactionCost(
                Math.abs(transaction.transactionCost).toString()
              );
            }

            setCategoryId(transaction.categoryId);
            setPaymentMethodId(transaction.paymentChannelId);
            setRecipientId(transaction.recipientId);

            // Set frequency to monthly with next month's due date
            setFrequency("monthly");
            const nextMonthDate = getNextMonthDueDate(
              new Date(transaction.date)
            );
            setDueDate(nextMonthDate);

            // Set day of month for recurring monthly budget
            const dayOfMonthValue = new Date(transaction.date).getDate();
            setDayOfMonth(dayOfMonthValue.toString());

            setIsGoal(false);
            setIsFlexible(false); // NEW: Default to strict for new budgets
          }
        } catch (err) {
          console.error("Failed to load transaction:", err);
          setErrorMsg("Failed to load transaction data");
        }
      };

      loadTransactionData();
    } else {
      // Clear form in add mode
      resetForm();
    }
  }, [id, transactionId, isEditMode, isFromTransaction]);

  const resetForm = () => {
    setBudgetType("expense");
    setDescription("");
    setAmount("");
    setTransactionCost("");
    setCategoryId(undefined);
    setPaymentMethodId(undefined);
    setRecipientId(undefined);
    setDueDate("");
    setFrequency("once");
    setDayOfMonth("");
    setIntervalDays("");
    setIsGoal(false);
    setIsFlexible(false); // NEW: Reset to false (strict)
    setEditingBudget(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setShowSuccessToast(false);
    setFieldErrors({});

    // Validate form
    const formValidation = validateBudgetForm({
      description,
      amount,
      dueDate,
      categoryId,
      paymentMethodId,
      recipientId,
      frequency,
      dayOfMonth: frequency === "monthly" ? dayOfMonth : undefined,
      intervalDays: frequency === "custom" ? intervalDays : undefined,
    });

    if (!formValidation.isValid) {
      setFieldErrors(formValidation.errors);
      setErrorMsg(
        formValidation.errorMessage || "Please fill in all required fields."
      );
      return;
    }

    // Validate amount
    const amountValidation = validateAmount(amount);
    if (!amountValidation.isValid) {
      setFieldErrors(amountValidation.errors);
      setErrorMsg(amountValidation.errorMessage || "Invalid amount.");
      return;
    }

    // Validate description
    const descriptionValidation = validateDescription(description);
    if (!descriptionValidation.isValid) {
      setFieldErrors(descriptionValidation.errors);
      setErrorMsg(descriptionValidation.errorMessage || "Invalid description.");
      return;
    }

    try {
      const dueDateObj = new Date(dueDate);
      const numericAmountRaw = parseFloat(amount);
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

      const budgetData: Omit<Budget, "id"> = {
        description: description.trim(),
        amount: numericAmount,
        transactionCost: numericCost,
        categoryId: categoryId!,
        paymentChannelId: paymentMethodId!,
        recipientId: recipientId,
        dueDate: dueDateObj,
        frequency: frequency,
        frequencyDetails:
          Object.keys(frequencyDetails).length > 0
            ? frequencyDetails
            : undefined,
        isGoal: isGoal,
        isFlexible: isFlexible, // NEW: Include isFlexible
        isActive: true,
        createdAt: editingBudget?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      if (isEditMode && id) {
        await db.budgets.update(Number(id), budgetData);
        setSuccessToastMessage("Budget updated successfully!");
        setShowSuccessToast(true);
      } else {
        await db.budgets.add(budgetData);
        setSuccessToastMessage(
          isFromTransaction
            ? "Budget created from transaction successfully!"
            : "Budget added successfully!"
        );
        setShowSuccessToast(true);
      }

      // Reset form (add mode only)
      if (!isEditMode) {
        resetForm();
        setTimeout(() => {
          history.push("/budget");
        }, 500);
      }
    } catch (error) {
      console.error("Error saving budget:", error);
      setErrorMsg(
        `Failed to ${isEditMode ? "update" : "add"} budget. Please try again.`
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
            </IonRow>

            {/* Payment Method */}
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Payment Method</label>
                  <SearchableFilterSelect
                    label=""
                    placeholder="Select payment method"
                    value={paymentMethodId}
                    options={sortedPaymentMethods
                      .filter((pm) => pm.name)
                      .map((pm) => {
                        const account = accounts.find(
                          (a) => a.id === pm.accountId
                        );
                        const currency = account?.currency
                          ? `(${account.currency})`
                          : "(—)";
                        return {
                          id: pm.id,
                          name: `${account?.name || "Unknown"} - ${
                            pm.name as string
                          } ${currency}`,
                        };
                      })}
                    onIonChange={(v) => {
                      setPaymentMethodId(v);
                      setFieldErrors((prev) => ({
                        ...prev,
                        paymentMethod: false,
                      }));
                    }}
                  />
                  {fieldErrors.paymentMethod && (
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
              <IonCol size="1">
                <IonButton
                  style={{ marginTop: "23px" }}
                  color="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPaymentMethodModal(true);
                  }}
                  aria-label="Add Payment Method"
                  title="Add Payment Method"
                >
                  <IonIcon icon={addOutline} />
                </IonButton>
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
            </IonRow>

            {/* Amount and Transaction Cost */}
            <IonRow>
              <IonCol size="8">
                <div className="form-input-wrapper">
                  <label className="form-label">Amount</label>
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
                  {fieldErrors.amount && (
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

            {/* Due Date */}
            <IonRow>
              <IonCol size="3">
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
              <IonCol size="5">
                <div className="form-input-wrapper">
                  <label className="form-label">Frequency</label>
                  <SelectableDropdown
                    label="Frequency"
                    placeholder="Select frequency"
                    value={frequency}
                    options={[
                      { value: "once", label: "Once" },
                      { value: "daily", label: "Daily" },
                      { value: "weekly", label: "Weekly" },
                      { value: "monthly", label: "Monthly (Fixed Day)" },
                      { value: "custom", label: "Custom (Every N Days)" },
                      { value: "yearly", label: "Yearly" },
                    ]}
                    onValueChange={(freqValue) => {
                      setFrequency(
                        freqValue as
                          | "once"
                          | "daily"
                          | "weekly"
                          | "monthly"
                          | "yearly"
                          | "custom"
                      );
                      setDayOfMonth("");
                      setIntervalDays("");
                    }}
                  />
                </div>
              </IonCol>

              {/* Day of Month (for monthly) */}
              {frequency === "monthly" && (
                <IonCol size="3">
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

              {/* Interval Days (for custom) */}
              {frequency === "custom" && (
                <IonCol size="3">
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
            </IonRow>

            {/* Submit Button */}
            <IonRow>
              <IonCol size="11">
                <IonButton type="submit" expand="block" color="primary">
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

      <AddPaymentMethodModal
        isOpen={showPaymentMethodModal}
        onClose={() => setShowPaymentMethodModal(false)}
        onPaymentMethodAdded={(paymentMethod) => {
          setSortedPaymentMethods((prev) => [paymentMethod, ...prev]);
          setPaymentMethodId(paymentMethod.id);
        }}
        accounts={accounts}
      />

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

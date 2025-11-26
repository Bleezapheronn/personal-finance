import React, { useEffect, useState } from "react";
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
  IonSelect,
  IonSelectOption,
  IonButton,
  IonText,
  IonGrid,
  IonRow,
  IonCol,
  IonSegment,
  IonSegmentButton,
  IonItem,
  IonIcon,
  IonModal,
  useIonViewWillEnter,
} from "@ionic/react";
import {
  db,
  Transaction,
  Category,
  Bucket,
  Account,
  PaymentMethod,
  Recipient,
  SmsImportTemplate,
} from "../db";
import { closeCircleOutline } from "ionicons/icons";
import { addOutline } from "ionicons/icons";
import { documentTextOutline } from "ionicons/icons";
import { useSmsParser } from "../hooks/useSmsParser";
import {
  validateTransactionForm,
  validateDateTime,
  validateAmount,
  ValidationErrors,
} from "../utils/transactionValidation";
import { AddRecipientModal } from "../components/AddRecipientModal";
import { AddCategoryModal } from "../components/AddCategoryModal";
import { AddPaymentMethodModal } from "../components/AddPaymentMethodModal";

const AddTransaction: React.FC = () => {
  const history = useHistory();
  const { id } = useParams<{ id?: string }>();
  const isEditMode = Boolean(id);

  // Separate date and time states
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");

  // transaction type: true = expense, false = income
  const [transactionType, setTransactionType] = useState<
    "expense" | "income" | "transfer"
  >("expense");

  const [amount, setAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [transactionReference, setTransactionReference] = useState("");
  const [originalAmount, setOriginalAmount] = useState("");
  const [originalCurrency, setOriginalCurrency] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [exchangeRateOverride, setExchangeRateOverride] = useState(false);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [paymentMethodId, setPaymentMethodId] = useState<number | undefined>(
    undefined
  );
  const [recipientId, setRecipientId] = useState<number | undefined>(undefined);
  const [description, setDescription] = useState("");

  // Transfer-specific state
  const [transferToPaymentMethodId, setTransferToPaymentMethodId] = useState<
    number | undefined
  >(undefined);
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [sortedCategories, setSortedCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sortedPaymentMethods, setSortedPaymentMethods] = useState<
    PaymentMethod[]
  >([]);
  const [sortedRecipients, setSortedRecipients] = useState<Recipient[]>([]);
  const [smsTemplates, setSmsTemplates] = useState<SmsImportTemplate[]>([]);
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});

  // Description autocomplete state
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<
    Array<{ text: string; count: number }>
  >([]);
  const [showDescriptionSuggestions, setShowDescriptionSuggestions] =
    useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const descriptionInputRef = React.useRef<HTMLIonInputElement>(null);

  // SMS Import state
  const [showSmsImportModal, setShowSmsImportModal] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    number | undefined
  >(undefined);
  const {
    parsedPreview,
    parseError: smsParseError,
    previewParse,
    clearParsedData,
  } = useSmsParser(smsTemplates, paymentMethodId);
  // derive list of currencies available from accounts
  const currencies = Array.from(
    new Set(
      accounts.map((a) => a.currency).filter((c): c is string => Boolean(c))
    )
  );

  // Clear messages and reset form when entering the page
  useIonViewWillEnter(() => {
    setErrorMsg("");
    setSuccessMsg("");
    setFieldErrors({});
  });

  // Auto-calculate exchange rate when amount and original amount change
  useEffect(() => {
    if (exchangeRateOverride) return; // user has manually set the rate

    const numAmount = parseFloat(amount);
    const numOriginal = parseFloat(originalAmount);

    if (!isNaN(numAmount) && !isNaN(numOriginal) && numOriginal !== 0) {
      const calculated = Math.abs(numAmount / numOriginal);
      setExchangeRate(calculated.toFixed(4));
    } else if (!originalAmount || !amount) {
      // clear rate if either field is empty
      setExchangeRate("");
    }
  }, [amount, originalAmount, exchangeRateOverride]);

  // Load lookup data on mount
  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const [b, c, a, pm, r, allTemplates] = await Promise.all([
          db.buckets.toArray(),
          db.categories.toArray(),
          db.accounts.toArray(),
          db.paymentMethods.toArray(),
          db.recipients.toArray(),
          db.smsImportTemplates.toArray(),
        ]);

        if (!isMounted) return;

        setBuckets(b);
        setAccounts(a);
        // Filter to only active templates
        setSmsTemplates(allTemplates.filter((t) => t.isActive));

        // Count transactions per recipient
        const transactions = await db.transactions.toArray();

        if (!isMounted) return;

        // Count transactions per recipient
        const recipientCounts = new Map<number, number>();

        transactions.forEach((txn) => {
          const count = recipientCounts.get(txn.recipientId) || 0;
          recipientCounts.set(txn.recipientId, count + 1);
        });
        const sortedRecips = [...r].sort((a, b) => {
          const countA = recipientCounts.get(a.id!) || 0;
          const countB = recipientCounts.get(b.id!) || 0;
          return countB - countA; // Most transactions first
        });
        setSortedRecipients(sortedRecips);

        // Count transactions per category
        const categoryCounts = new Map<number, number>();
        transactions.forEach((txn) => {
          const count = categoryCounts.get(txn.categoryId) || 0;
          categoryCounts.set(txn.categoryId, count + 1);
        });
        const sortedCats = [...c].sort((a, b) => {
          const countA = categoryCounts.get(a.id!) || 0;
          const countB = categoryCounts.get(b.id!) || 0;
          return countB - countA; // Most transactions first
        });
        setSortedCategories(sortedCats);

        // Count transactions per payment method
        const paymentMethodCounts = new Map<number, number>();
        transactions.forEach((txn) => {
          const count = paymentMethodCounts.get(txn.paymentChannelId) || 0;
          paymentMethodCounts.set(txn.paymentChannelId, count + 1);
        });
        const sortedPMs = [...pm].sort((a, b) => {
          const countA = paymentMethodCounts.get(a.id!) || 0;
          const countB = paymentMethodCounts.get(b.id!) || 0;
          return countB - countA; // Most transactions first
        });
        setSortedPaymentMethods(sortedPMs);
      } catch (err) {
        console.error("Failed to load lookup data:", err);
      }
    };
    load();

    return () => {
      isMounted = false;
    };
  }, []);

  // Load transaction data in edit mode OR clear form in add mode when id changes
  useEffect(() => {
    if (isEditMode && id) {
      // EDIT MODE: Load transaction
      const loadTransaction = async () => {
        try {
          const txn = await db.transactions.get(Number(id));

          if (txn) {
            setEditingTransaction(txn);

            // Check if this is a transfer transaction
            if (txn.isTransfer && txn.transferPairId) {
              setTransactionType("transfer");
              const pairedTxn = await db.transactions.get(txn.transferPairId);

              // Determine which is outgoing and which is incoming
              if (txn.amount < 0) {
                // This is the outgoing transaction
                setPaymentMethodId(txn.paymentChannelId);
                setTransferToPaymentMethodId(pairedTxn?.paymentChannelId);
              } else {
                // This is the incoming transaction
                setPaymentMethodId(pairedTxn?.paymentChannelId);
                setTransferToPaymentMethodId(txn.paymentChannelId);
              }
            } else {
              setTransactionType(txn.amount < 0 ? "expense" : "income");
            }

            // Format date as YYYY-MM-DD
            const txnDate = new Date(txn.date);
            const year = txnDate.getFullYear();
            const month = String(txnDate.getMonth() + 1).padStart(2, "0");
            const day = String(txnDate.getDate()).padStart(2, "0");
            setSelectedDate(`${year}-${month}-${day}`);

            // Format time as HH:mm
            const hours = String(txnDate.getHours()).padStart(2, "0");
            const minutes = String(txnDate.getMinutes()).padStart(2, "0");
            setSelectedTime(`${hours}:${minutes}`);

            setAmount(Math.abs(txn.amount).toString());
            setTransactionCost(
              txn.transactionCost
                ? Math.abs(txn.transactionCost).toString()
                : ""
            );
            setTransactionReference(txn.transactionReference || "");
            setOriginalAmount(
              txn.originalAmount ? Math.abs(txn.originalAmount).toString() : ""
            );
            setOriginalCurrency(txn.originalCurrency || "");
            setExchangeRate(txn.exchangeRate?.toString() || "");
            setExchangeRateOverride(!!txn.exchangeRate);

            // Only set these for non-transfer transactions
            if (!txn.isTransfer) {
              setCategoryId(txn.categoryId);
              setPaymentMethodId(txn.paymentChannelId);
              setRecipientId(txn.recipientId);
            }
            setDescription(txn.description || "");
          }
        } catch (err) {
          console.error("Failed to load transaction:", err);
          setErrorMsg("Failed to load transaction for editing");
        }
      };

      loadTransaction();
    } else {
      // ADD MODE: Clear form
      setSelectedDate("");
      setSelectedTime("");
      setTransactionType("expense");
      setAmount("");
      setTransactionCost("");
      setTransactionReference("");
      setOriginalAmount("");
      setOriginalCurrency("");
      setExchangeRate("");
      setExchangeRateOverride(false);
      setCategoryId(undefined);
      setPaymentMethodId(undefined);
      setRecipientId(undefined);
      setTransferToPaymentMethodId(undefined);
      setDescription("");
      setEditingTransaction(null);
    }
  }, [id, isEditMode]); // dateTime intentionally excluded to avoid infinite loop

  // Load descriptions sorted by frequency when component mounts
  useEffect(() => {
    let isMounted = true;

    const loadDescriptions = async () => {
      const transactions = await db.transactions.toArray();

      // Count occurrences of each description
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

      if (isMounted) {
        setDescriptionSuggestions(sortedDescriptions);
      }
    };
    loadDescriptions();

    return () => {
      isMounted = false;
    };
  }, []); // No cleanup, could set state on unmounted component

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setFieldErrors({});

    // Validate form using utility function
    const formValidation = validateTransactionForm({
      selectedDate,
      selectedTime,
      amount,
      description,
      categoryId,
      paymentMethodId,
      recipientId,
      transferToPaymentMethodId,
      transactionType,
    });

    if (!formValidation.isValid) {
      setFieldErrors(formValidation.errors);
      setErrorMsg(
        formValidation.errorMessage || "Please fill in all required fields."
      );
      return;
    }

    // Validate date/time
    const dateTimeString = `${selectedDate}T${selectedTime}`;
    const dateTimeValidation = validateDateTime(dateTimeString);

    if (!dateTimeValidation.isValid) {
      setErrorMsg(dateTimeValidation.errorMessage || "Invalid date/time.");
      return;
    }

    const selectedDateTime = new Date(dateTimeString);

    // Validate amount
    const amountValidation = validateAmount(amount);

    if (!amountValidation.isValid) {
      setErrorMsg(amountValidation.errorMessage || "Invalid amount.");
      return;
    }

    const numericAmountRaw = parseFloat(amount);
    // save negative values for expenses
    const numericAmount =
      transactionType === "expense"
        ? -Math.abs(numericAmountRaw)
        : Math.abs(numericAmountRaw);

    const parsedCost = transactionCost ? parseFloat(transactionCost) : NaN;
    const numericCost = !isNaN(parsedCost)
      ? -Math.abs(parsedCost) // always store as outgoing (negative)
      : undefined;

    const numericOriginalAmountRaw = originalAmount
      ? parseFloat(originalAmount)
      : undefined;
    const numericOriginalAmount =
      numericOriginalAmountRaw == null
        ? undefined
        : transactionType === "expense"
        ? -Math.abs(numericOriginalAmountRaw)
        : Math.abs(numericOriginalAmountRaw);

    const txReference = transactionReference.trim() || undefined;
    const origCurrency = originalCurrency.trim() || undefined;

    const numericExchangeRate = exchangeRate
      ? parseFloat(exchangeRate)
      : undefined;

    const tx: Omit<Transaction, "id"> = {
      date: selectedDateTime,
      amount: numericAmount,
      transactionCost: numericCost,
      originalAmount: numericOriginalAmount,
      originalCurrency: origCurrency,
      exchangeRate: numericExchangeRate,
      transactionReference: txReference,
      categoryId: categoryId!,
      paymentChannelId: paymentMethodId!,
      recipientId: recipientId!,
      description: description || undefined,
      isTransfer: false, // Add this field
      transferPairId: undefined, // Add this field
    };

    try {
      if (isEditMode && id) {
        // Update existing transaction
        await db.transactions.update(Number(id), tx);
        setSuccessMsg("Transaction updated successfully!");
      } else {
        // Add new transaction
        await db.transactions.add(tx);
        setSuccessMsg("Transaction added successfully!");
      }
      // reset
      setSelectedDate("");
      setSelectedTime("");
      setFieldErrors({});
      setAmount("");
      setTransactionCost("");
      setTransactionReference("");
      setOriginalAmount("");
      setOriginalCurrency("");
      setExchangeRate("");
      setExchangeRateOverride(false);
      setCategoryId(undefined);
      setPaymentMethodId(undefined);
      setRecipientId(undefined);
      setDescription("");
      // navigate to transactions list
      history.push("/transactions");
    } catch (error) {
      console.error("Error adding transaction:", error);
      setErrorMsg(
        `Failed to ${
          isEditMode ? "update" : "add"
        } transaction. Please try again.`
      );
    }
  };

  // add helper to populate fields from the most recent transaction for a description
  const populateFromLastTransaction = async (description: string) => {
    if (!description || !description.trim()) return;
    try {
      const txs = await db.transactions
        .where("description")
        .equals(description)
        .toArray();
      if (!txs || txs.length === 0) return;
      // pick the most recent by date
      const latest = txs.reduce((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return ta >= tb ? a : b;
      });

      // only populate if the destination fields are currently empty
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

  // Handle SMS import
  const handleSmsImport = async () => {
    if (!parsedPreview) {
      setErrorMsg("Please preview parse the SMS first");
      return;
    }

    // Populate fields from parsed data
    if (parsedPreview.date) {
      setSelectedDate(parsedPreview.date);
    }
    if (parsedPreview.time) {
      setSelectedTime(parsedPreview.time);
    }
    if (parsedPreview.amount) {
      setAmount(parsedPreview.amount);
    }
    if (parsedPreview.reference) {
      setTransactionReference(parsedPreview.reference);
    }
    if (parsedPreview.cost) {
      setTransactionCost(parsedPreview.cost);
    }

    // Set transaction type based on parsed data
    if (parsedPreview.isIncome !== undefined) {
      setTransactionType(parsedPreview.isIncome ? "income" : "expense");
    }

    // Auto-populate payment method from the template that was used
    const usedTemplateId = selectedTemplateId || parsedPreview.templateId;
    if (usedTemplateId) {
      const template = smsTemplates.find((t) => t.id === usedTemplateId);
      if (template?.paymentMethodId) {
        setPaymentMethodId(template.paymentMethodId);
      }
    }

    // Handle recipient
    if (parsedPreview.recipientName) {
      let recipient = sortedRecipients.find(
        (r) =>
          r.name?.toLowerCase() === parsedPreview.recipientName?.toLowerCase()
      );

      if (!recipient && parsedPreview.recipientName) {
        try {
          const now = new Date();
          const recId = await db.recipients.add({
            name: parsedPreview.recipientName,
            phone: parsedPreview.recipientPhone,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });
          recipient = await db.recipients.get(recId);
          if (recipient) {
            setSortedRecipients((prev) => [recipient!, ...prev]);
          }
        } catch (err) {
          console.error("Failed to create recipient:", err);
        }
      }

      if (recipient) {
        setRecipientId(recipient.id);
      }
    }

    // Close modal and clear SMS text
    setShowSmsImportModal(false);
    setSmsText("");
    clearParsedData();
  };

  // Clear error message when all required fields are filled
  useEffect(() => {
    if (errorMsg && errorMsg === "Please fill in all required fields.") {
      // Re-validate to check if all fields are now filled
      const formValidation = validateTransactionForm({
        selectedDate,
        selectedTime,
        amount,
        description,
        categoryId,
        paymentMethodId,
        recipientId,
        transferToPaymentMethodId,
        transactionType,
      });

      // Only clear the error if validation passes
      if (formValidation.isValid) {
        setErrorMsg("");
        setFieldErrors({});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedDate,
    selectedTime,
    amount,
    description,
    categoryId,
    paymentMethodId,
    recipientId,
    transferToPaymentMethodId,
    transactionType,
  ]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>
            {isEditMode ? "Edit Transaction" : "Add Transaction"}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setShowSmsImportModal(true)}>
              <IonIcon icon={documentTextOutline} />
              Import SMS
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {isEditMode && editingTransaction?.isTransfer && (
          <IonText color="warning">
            <p
              style={{
                padding: "12px",
                backgroundColor: "var(--ion-color-warning-tint)",
                borderRadius: "4px",
                marginBottom: "16px",
              }}
            >
              <strong>Note:</strong> This is a transfer transaction. Editing
              will update both the outgoing and incoming transactions.
            </p>
          </IonText>
        )}
        <form onSubmit={handleSubmit}>
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonItem lines="none">
                  <IonSegment
                    value={transactionType}
                    onIonChange={(e) =>
                      setTransactionType(
                        e.detail.value as "expense" | "income" | "transfer"
                      )
                    }
                    disabled={isEditMode && editingTransaction?.isTransfer}
                  >
                    <IonSegmentButton value="income">
                      <IonLabel>Income</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="expense">
                      <IonLabel>Expense</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="transfer">
                      <IonLabel>Transfer</IonLabel>
                    </IonSegmentButton>
                  </IonSegment>
                </IonItem>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                {errorMsg && <IonText color="danger">{errorMsg}</IonText>}
                {successMsg && <IonText color="success">{successMsg}</IonText>}
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol size="2">
                <IonInput
                  label="Date"
                  labelPlacement="stacked"
                  fill="outline"
                  type="date"
                  color={fieldErrors.date ? "danger" : undefined}
                  value={selectedDate}
                  onIonChange={(e) => {
                    setSelectedDate(e.detail.value ?? "");
                    setFieldErrors((prev) => ({ ...prev, date: false }));
                  }}
                />
                {fieldErrors.date && (
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
              </IonCol>
              <IonCol size="2">
                <IonInput
                  label="Time"
                  labelPlacement="stacked"
                  fill="outline"
                  type="time"
                  color={fieldErrors.time ? "danger" : undefined}
                  value={selectedTime}
                  onIonChange={(e) => {
                    setSelectedTime(e.detail.value ?? "");
                    setFieldErrors((prev) => ({ ...prev, time: false }));
                  }}
                />
                {fieldErrors.time && (
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
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol size="7">
                <IonInput
                  ref={descriptionInputRef}
                  label="Description"
                  labelPlacement="stacked"
                  fill="outline"
                  color={fieldErrors.description ? "danger" : undefined}
                  type="text"
                  placeholder="e.g. Grocery shopping"
                  value={description}
                  onIonInput={(e) => {
                    handleDescriptionChange(e.detail.value!);
                    setFieldErrors((prev) => ({ ...prev, description: false }));
                  }}
                  onIonFocus={() => setShowDescriptionSuggestions(true)}
                  onKeyDown={handleDescriptionKeyDown}
                />
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
                        marginTop: "4px",
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
              </IonCol>
              <IonCol size="3">
                <IonInput
                  label="Transaction Reference (optional)"
                  fill="outline"
                  labelPlacement="stacked"
                  placeholder="e.g. ABCD123XYZ"
                  type="text"
                  value={transactionReference}
                  onIonChange={(e) =>
                    setTransactionReference(e.detail.value ?? "")
                  }
                />
              </IonCol>
            </IonRow>

            {transactionType === "transfer" ? (
              <>
                {/* FROM Payment Method */}
                <IonRow>
                  <IonCol size="10">
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
                    <IonSelect
                      label="From Payment Method"
                      labelPlacement="stacked"
                      fill="outline"
                      interface="popover"
                      placeholder="Select source payment method"
                      value={paymentMethodId}
                      onIonChange={(e) => {
                        const v = e.detail.value as string | number | undefined;
                        setPaymentMethodId(v == null ? undefined : Number(v));
                        setFieldErrors((prev) => ({
                          ...prev,
                          paymentMethod: false,
                        }));
                      }}
                    >
                      {accounts.map((a) => {
                        const methods = sortedPaymentMethods.filter(
                          (pm) => pm.accountId === a.id
                        );
                        if (methods.length === 0) return null;
                        return (
                          <React.Fragment key={a.id}>
                            <IonSelectOption
                              value={-1}
                              disabled
                              style={{ fontWeight: 700, opacity: 0.9 }}
                            >
                              {a.name}
                            </IonSelectOption>
                            {methods.map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {sortedPaymentMethods.filter((pm) => pm.accountId == null)
                        .length > 0 && (
                        <>
                          <IonSelectOption
                            value={-1}
                            disabled
                            style={{ fontWeight: 700, opacity: 0.9 }}
                          >
                            Unlinked
                          </IonSelectOption>
                          {sortedPaymentMethods
                            .filter((pm) => pm.accountId == null)
                            .map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                        </>
                      )}
                    </IonSelect>
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPaymentMethodModal(true);
                      }}
                    >
                      <IonIcon icon={addOutline} />
                      Add
                    </IonButton>
                  </IonCol>
                </IonRow>

                {/* TO Payment Method */}
                <IonRow>
                  <IonCol size="10">
                    {fieldErrors.recipient && (
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
                    <IonSelect
                      label="To Payment Method"
                      labelPlacement="stacked"
                      fill="outline"
                      interface="popover"
                      placeholder="Select destination payment method"
                      value={transferToPaymentMethodId}
                      onIonChange={(e) => {
                        const v = e.detail.value as string | number | undefined;
                        setTransferToPaymentMethodId(
                          v == null ? undefined : Number(v)
                        );
                        setFieldErrors((prev) => ({
                          ...prev,
                          recipient: false,
                        }));
                      }}
                    >
                      {accounts.map((a) => {
                        const methods = sortedPaymentMethods.filter(
                          (pm) => pm.accountId === a.id
                        );
                        if (methods.length === 0) return null;
                        return (
                          <React.Fragment key={a.id}>
                            <IonSelectOption
                              value={-1}
                              disabled
                              style={{ fontWeight: 700, opacity: 0.9 }}
                            >
                              {a.name}
                            </IonSelectOption>
                            {methods.map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {sortedPaymentMethods.filter((pm) => pm.accountId == null)
                        .length > 0 && (
                        <>
                          <IonSelectOption
                            value={-1}
                            disabled
                            style={{ fontWeight: 700, opacity: 0.9 }}
                          >
                            Unlinked
                          </IonSelectOption>
                          {sortedPaymentMethods
                            .filter((pm) => pm.accountId == null)
                            .map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                        </>
                      )}
                    </IonSelect>
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPaymentMethodModal(true);
                      }}
                    >
                      <IonIcon icon={addOutline} />
                      Add
                    </IonButton>
                  </IonCol>
                </IonRow>
              </>
            ) : (
              <>
                {/* Existing Recipient field */}
                <IonRow>
                  <IonCol size="10">
                    {fieldErrors.recipient && (
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
                    <IonSelect
                      label={
                        transactionType === "expense" ? "Recipient" : "Payer"
                      }
                      fill="outline"
                      color={fieldErrors.recipient ? "danger" : undefined}
                      labelPlacement="stacked"
                      interface="popover"
                      placeholder={
                        transactionType === "expense"
                          ? "Select recipient"
                          : "Select payer"
                      }
                      value={recipientId}
                      onIonChange={(e) => {
                        const v = e.detail.value as string | number | undefined;
                        const id =
                          v == null
                            ? undefined
                            : typeof v === "number"
                            ? v
                            : Number(v);
                        setRecipientId(id);
                        setFieldErrors((prev) => ({
                          ...prev,
                          recipient: false,
                        }));
                      }}
                    >
                      {sortedRecipients.map((r) => (
                        <IonSelectOption key={r.id} value={r.id}>
                          {r.name}
                        </IonSelectOption>
                      ))}
                      <IonButton
                        slot="end"
                        fill="clear"
                        size="small"
                        color="medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRecipientId(undefined);
                        }}
                        aria-label="Clear recipient"
                        title="Clear recipient"
                      >
                        <IonIcon icon={closeCircleOutline} />
                      </IonButton>
                    </IonSelect>
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRecipientModal(true);
                      }}
                      aria-label={
                        transactionType === "expense"
                          ? "Add recipient"
                          : "Add payer"
                      }
                      title={
                        transactionType === "expense"
                          ? "Add recipient"
                          : "Add payer"
                      }
                    >
                      <IonIcon icon={addOutline} />
                      {transactionType === "expense"
                        ? "Add recipient"
                        : "Add payer"}
                    </IonButton>
                  </IonCol>
                </IonRow>

                {/* Existing Category field */}
                <IonRow>
                  <IonCol size="10">
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
                    <IonSelect
                      label="Category"
                      fill="outline"
                      color={fieldErrors.category ? "danger" : undefined}
                      labelPlacement="stacked"
                      interface="popover"
                      placeholder="Select category"
                      value={categoryId}
                      onIonChange={(e) => {
                        const v = e.detail.value as string | number | undefined;
                        setCategoryId(v == null ? undefined : Number(v));
                        setFieldErrors((prev) => ({
                          ...prev,
                          category: false,
                        }));
                      }}
                    >
                      {buckets.map((b) => {
                        const cats = sortedCategories.filter(
                          (c) => c.bucketId === b.id
                        );
                        if (cats.length === 0) return null;
                        return (
                          <React.Fragment key={b.id}>
                            <IonSelectOption
                              value={-1}
                              disabled
                              style={{ fontWeight: 900, opacity: 0.9 }}
                            >
                              {b.name}
                            </IonSelectOption>
                            {cats.map((c) => (
                              <IonSelectOption key={c.id} value={c.id}>
                                {c.name}
                              </IonSelectOption>
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {sortedCategories.filter((c) => !c.bucketId).length >
                        0 && (
                        <>
                          <IonSelectOption
                            value={-1}
                            disabled
                            style={{ fontWeight: 700, opacity: 0.9 }}
                          >
                            Unbucketed
                          </IonSelectOption>
                          {sortedCategories
                            .filter((c) => !c.bucketId)
                            .map((c) => (
                              <IonSelectOption key={c.id} value={c.id}>
                                {c.name}
                              </IonSelectOption>
                            ))}
                        </>
                      )}
                      <IonButton
                        slot="end"
                        fill="clear"
                        size="small"
                        color="medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryId(undefined);
                        }}
                        aria-label="Clear category"
                        title="Clear category"
                      >
                        <IonIcon icon={closeCircleOutline} />
                      </IonButton>
                    </IonSelect>
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCategoryModal(true);
                      }}
                      aria-label="Add category"
                      title="Add category"
                    >
                      <IonIcon icon={addOutline} />
                      Add category
                    </IonButton>
                  </IonCol>
                </IonRow>

                {/* Existing Payment Method field */}
                <IonRow>
                  <IonCol size="10">
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
                    <IonSelect
                      label="Payment Method"
                      labelPlacement="stacked"
                      fill="outline"
                      interface="popover"
                      placeholder="Select payment method"
                      value={paymentMethodId}
                      onIonChange={(e) => {
                        const v = e.detail.value as string | number | undefined;
                        setPaymentMethodId(v == null ? undefined : Number(v));
                        setFieldErrors((prev) => ({
                          ...prev,
                          paymentMethod: false,
                        }));
                      }}
                    >
                      {accounts.map((a) => {
                        const methods = sortedPaymentMethods.filter(
                          (pm) => pm.accountId === a.id
                        );
                        if (methods.length === 0) return null;
                        return (
                          <React.Fragment key={a.id}>
                            <IonSelectOption
                              value={-1}
                              disabled
                              style={{ fontWeight: 700, opacity: 0.9 }}
                            >
                              {a.name}
                            </IonSelectOption>
                            {methods.map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {sortedPaymentMethods.filter((pm) => pm.accountId == null)
                        .length > 0 && (
                        <>
                          <IonSelectOption
                            value={-1}
                            disabled
                            style={{ fontWeight: 700, opacity: 0.9 }}
                          >
                            Unlinked
                          </IonSelectOption>
                          {sortedPaymentMethods
                            .filter((pm) => pm.accountId == null)
                            .map((pm) => (
                              <IonSelectOption key={pm.id} value={pm.id}>
                                {pm.name}
                              </IonSelectOption>
                            ))}
                        </>
                      )}
                      <IonButton
                        slot="end"
                        fill="clear"
                        size="small"
                        color="medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPaymentMethodId(undefined);
                        }}
                        aria-label="Clear payment method"
                        title="Clear payment method"
                      >
                        <IonIcon icon={closeCircleOutline} />
                      </IonButton>
                    </IonSelect>
                  </IonCol>
                  <IonCol size="2">
                    <IonButton
                      color="primary"
                      expand="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPaymentMethodModal(true);
                      }}
                      aria-label="Add payment method"
                      title="Add payment method"
                    >
                      <IonIcon icon={addOutline} />
                      Add payment method
                    </IonButton>
                  </IonCol>
                </IonRow>
              </>
            )}

            <IonRow>
              <IonCol size="7">
                <IonInput
                  label="Amount"
                  placeholder="e.g. 1,000"
                  labelPlacement="stacked"
                  fill="outline"
                  color={fieldErrors.amount ? "danger" : undefined}
                  type="number"
                  step="0.01"
                  value={amount}
                  onIonChange={(e) => {
                    setAmount(e.detail.value!);
                    setFieldErrors((prev) => ({ ...prev, amount: false }));
                  }}
                  inputMode="decimal"
                />
                {fieldErrors.amount && (
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
              </IonCol>

              <IonCol size="3">
                <IonInput
                  label="Transaction Cost"
                  labelPlacement="stacked"
                  placeholder="e.g. 13.00"
                  fill="outline"
                  type="number"
                  value={transactionCost}
                  onIonChange={(e) => setTransactionCost(e.detail.value!)}
                  inputMode="decimal"
                  step="0.01"
                />
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol size="6">
                <IonInput
                  placeholder="Amount in original currency, e.g. 100.00"
                  fill="outline"
                  type="number"
                  label="Original Amount"
                  labelPlacement="stacked"
                  value={originalAmount}
                  onIonChange={(e) => setOriginalAmount(e.detail.value ?? "")}
                  inputMode="decimal"
                  step="0.01"
                />
              </IonCol>

              <IonCol size="2">
                <IonSelect
                  label="Currency"
                  labelPlacement="stacked"
                  placeholder="e.g. USD"
                  interface="popover"
                  value={originalCurrency || undefined}
                  onIonChange={(e) =>
                    setOriginalCurrency((e.detail.value as string) ?? "")
                  }
                  fill="outline"
                >
                  {currencies.map((cur) => (
                    <IonSelectOption key={cur} value={cur}>
                      {cur}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonCol>

              <IonCol size="2">
                <IonInput
                  label="Exchange Rate"
                  labelPlacement="stacked"
                  placeholder="e.g. 125.00"
                  fill="outline"
                  type="number"
                  step="0.0001"
                  value={exchangeRate}
                  onIonChange={(e) => {
                    setExchangeRate(e.detail.value ?? "");
                    setExchangeRateOverride(true);
                  }}
                  onIonFocus={() => setExchangeRateOverride(true)}
                  inputMode="decimal"
                />
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <IonButton
                  type="submit"
                  expand="block"
                  color="primary"
                  className="ion-margin-top"
                >
                  {isEditMode ? "Update Transaction" : "Add Transaction"}
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </form>
      </IonContent>

      {/* Modal: Add Recipient */}
      <AddRecipientModal
        isOpen={showRecipientModal}
        onClose={() => setShowRecipientModal(false)}
        onRecipientAdded={(recipient) => {
          setSortedRecipients((prev) => [recipient, ...prev]);
          setRecipientId(recipient.id);
        }}
        initialName=""
        initialPhone=""
      />

      {/* Modal: Add Category */}
      <AddCategoryModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onCategoryAdded={(category) => {
          setSortedCategories((prev) => [category, ...prev]);
          setCategoryId(category.id);
        }}
        buckets={buckets}
      />

      {/* Modal: Add Payment Method */}
      <AddPaymentMethodModal
        isOpen={showPaymentMethodModal}
        onClose={() => setShowPaymentMethodModal(false)}
        onPaymentMethodAdded={(paymentMethod) => {
          setSortedPaymentMethods((prev) => [paymentMethod, ...prev]);
          setPaymentMethodId(paymentMethod.id);
        }}
        accounts={accounts}
      />

      {/* Modal: Import SMS */}
      <IonModal
        isOpen={showSmsImportModal}
        onDidDismiss={() => {
          setShowSmsImportModal(false);
          setSmsText("");
          clearParsedData();
          setSelectedTemplateId(undefined);
          clearParsedData();
        }}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Import from SMS</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setShowSmsImportModal(false)}>
                Close
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {smsParseError && (
            <IonText color="danger">
              <p>{smsParseError}</p>
            </IonText>
          )}
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonSelect
                  label="Select Template (optional)"
                  labelPlacement="stacked"
                  fill="outline"
                  interface="popover"
                  placeholder="Auto-detect from all templates"
                  value={selectedTemplateId}
                  onIonChange={(e) => {
                    setSelectedTemplateId(e.detail.value);
                    clearParsedData(); // Clear preview when template changes
                  }}
                >
                  <IonSelectOption value={undefined}>
                    Auto-detect from all templates
                  </IonSelectOption>
                  {smsTemplates.map((template) => (
                    <IonSelectOption key={template.id} value={template.id}>
                      {template.name}
                      {template.paymentMethodId && (
                        <>
                          {" "}
                          (
                          {
                            sortedPaymentMethods.find(
                              (pm) => pm.id === template.paymentMethodId
                            )?.name
                          }
                          )
                        </>
                      )}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonLabel position="stacked">Paste SMS Message</IonLabel>
                <textarea
                  rows={8}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "8px",
                    borderRadius: "4px",
                    border: "1px solid var(--ion-color-medium)",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                  }}
                  placeholder="Paste your transaction SMS here..."
                  value={smsText}
                  onChange={(e) => {
                    setSmsText(e.target.value);
                    clearParsedData(); // Clear preview when text changes
                  }}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={() => previewParse(smsText, selectedTemplateId)}
                  disabled={!smsText.trim()}
                >
                  Preview Parse
                </IonButton>
              </IonCol>
            </IonRow>

            {/* Preview Section */}
            {parsedPreview && (
              <>
                <IonRow>
                  <IonCol>
                    <div
                      style={{
                        backgroundColor: "var(--ion-color-light)",
                        padding: "12px",
                        borderRadius: "8px",
                        marginTop: "8px",
                      }}
                    >
                      <h3
                        style={{
                          marginTop: 0,
                          fontSize: "1rem",
                          fontWeight: "bold",
                        }}
                      >
                        Parsed Information
                      </h3>
                      <div style={{ fontSize: "0.9rem" }}>
                        {parsedPreview.isIncome !== undefined && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Type:</strong>{" "}
                            <IonText
                              color={
                                parsedPreview.isIncome ? "success" : "danger"
                              }
                            >
                              {parsedPreview.isIncome ? "Income" : "Expense"}
                            </IonText>
                          </div>
                        )}
                        {parsedPreview.reference && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Reference:</strong>{" "}
                            {parsedPreview.reference}
                          </div>
                        )}
                        {parsedPreview.amount && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Amount:</strong> {parsedPreview.amount}
                          </div>
                        )}
                        {parsedPreview.cost && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Transaction Cost:</strong>{" "}
                            {parsedPreview.cost}
                          </div>
                        )}
                        {parsedPreview.recipientName && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>
                              {parsedPreview.isIncome ? "Sender" : "Recipient"}:
                            </strong>{" "}
                            {parsedPreview.recipientName}
                            {parsedPreview.recipientPhone && (
                              <> ({parsedPreview.recipientPhone})</>
                            )}
                          </div>
                        )}
                        {parsedPreview.date && (
                          <div style={{ marginBottom: "8px" }}>
                            <strong>Date:</strong> {parsedPreview.date}
                            {parsedPreview.time && (
                              <> at {parsedPreview.time}</>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </IonCol>
                </IonRow>
              </>
            )}

            <IonRow>
              <IonCol>
                <IonButton
                  expand="block"
                  onClick={handleSmsImport}
                  disabled={!parsedPreview}
                  color="primary"
                >
                  Parse & Import
                </IonButton>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    <strong>How to use:</strong>
                  </p>
                  <ol style={{ fontSize: "0.85rem", paddingLeft: "20px" }}>
                    <li>Paste your SMS message above</li>
                    <li>
                      Optionally select a specific template or let the system
                      auto-detect
                    </li>
                    <li>Click "Preview Parse" to see what will be extracted</li>
                    <li>Review the parsed information</li>
                    <li>Click "Parse & Import" to add the transaction</li>
                  </ol>
                  <p style={{ fontSize: "0.85rem" }}>
                    If parsing fails, you may need to add or update SMS import
                    templates in the management page.
                  </p>
                </IonText>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonContent>
      </IonModal>
    </IonPage>
  );
};

export default AddTransaction;

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
import { addOutline } from "ionicons/icons";
import { documentTextOutline } from "ionicons/icons";
import {
  validateTransactionForm,
  validateDateTime,
  validateAmount,
  validateDescription,
  validateTransactionCost,
  ValidationErrors,
} from "../utils/transactionValidation";
import { AddRecipientModal } from "../components/AddRecipientModal";
import { AddCategoryModal } from "../components/AddCategoryModal";
import { AddPaymentMethodModal } from "../components/AddPaymentMethodModal";
import { SmsImportModal } from "../components/SmsImportModal";
import { ParsedSmsData } from "../hooks/useSmsParser";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";

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
  const [transferRecipientId, setTransferRecipientId] = useState<
    number | undefined
  >(undefined);

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
  const descriptionInputRef = React.useRef<HTMLIonInputElement>(null);

  // SMS Import state
  const [showSmsImportModal, setShowSmsImportModal] = useState(false);

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

  // Load lookup data on mount AND when page is visited
  useIonViewWillEnter(() => {
    loadLookupData();
  });

  // Helper function to load all lookup data
  const loadLookupData = async () => {
    try {
      const [b, c, a, pm, r, allTemplates] = await Promise.all([
        db.buckets.toArray(),
        db.categories.toArray(),
        db.accounts.toArray(),
        db.paymentMethods.toArray(),
        db.recipients.toArray(),
        db.smsImportTemplates.toArray(),
      ]);

      // When in EDIT MODE: Include deactivated items
      // When in ADD MODE: Only show active items
      const activeAccounts = isEditMode
        ? a
        : a.filter((acc) => acc.isActive !== false);

      const activeBuckets = isEditMode
        ? b
        : b.filter((bkt) => bkt.isActive !== false);

      const activeCategories = isEditMode
        ? c
        : c.filter((cat) => cat.isActive !== false);

      // Filter payment methods: active AND account exists
      const activePaymentMethods = (
        isEditMode ? pm : pm.filter((pmeth) => pmeth.isActive !== false)
      ).filter((pmeth) => {
        const accountExists = activeAccounts.some(
          (acc) => acc.id === pmeth.accountId
        );
        return accountExists;
      });

      const activeRecipients = isEditMode
        ? r
        : r.filter((rec) => rec.isActive !== false);

      setBuckets(activeBuckets);
      setAccounts(activeAccounts);
      setSmsTemplates(allTemplates.filter((t) => t.isActive !== false));

      const transactions = await db.transactions.toArray();

      // Count transactions per recipient (use only active for sorting)
      const recipientCounts = new Map<number, number>();
      transactions.forEach((txn) => {
        const count = recipientCounts.get(txn.recipientId) || 0;
        recipientCounts.set(txn.recipientId, count + 1);
      });
      const sortedRecips = [...activeRecipients].sort((a, b) => {
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
      const sortedCats = [...activeCategories].sort((a, b) => {
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
      const sortedPMs = [...activePaymentMethods].sort((a, b) => {
        const countA = paymentMethodCounts.get(a.id!) || 0;
        const countB = paymentMethodCounts.get(b.id!) || 0;
        return countB - countA; // Most transactions first
      });
      setSortedPaymentMethods(sortedPMs);
    } catch (err) {
      console.error("Failed to load lookup data:", err);
    }
  };

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
                setRecipientId(txn.recipientId); // Payer (source)
                setTransferRecipientId(pairedTxn?.recipientId); // Recipient (destination)
              } else {
                // This is the incoming transaction
                setPaymentMethodId(pairedTxn?.paymentChannelId);
                setTransferToPaymentMethodId(txn.paymentChannelId);
                setRecipientId(pairedTxn?.recipientId); // Payer (source)
                setTransferRecipientId(txn.recipientId); // Recipient (destination)
              }

              // Set category from the transaction (both should have same category)
              setCategoryId(txn.categoryId);
            } else {
              setTransactionType(txn.amount < 0 ? "expense" : "income");
              setCategoryId(txn.categoryId);
              setPaymentMethodId(txn.paymentChannelId);
              setRecipientId(txn.recipientId);
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
      setTransferRecipientId(undefined);
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
    setShowSuccessToast(false);
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
      transferRecipientId,
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
      setFieldErrors(dateTimeValidation.errors);
      setErrorMsg(dateTimeValidation.errorMessage || "Invalid date/time.");
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

    // Validate transaction cost (if provided)
    if (transactionCost) {
      const costValidation = validateTransactionCost(transactionCost);
      if (!costValidation.isValid) {
        setErrorMsg(costValidation.errorMessage || "Invalid transaction cost.");
        return;
      }
    }

    // Rest of your submit logic continues...
    const selectedDateTime = new Date(dateTimeString);
    const numericAmountRaw = parseFloat(amount);

    const parsedCost = transactionCost ? parseFloat(transactionCost) : NaN;
    const numericCost = !isNaN(parsedCost)
      ? -Math.abs(parsedCost) // always store as outgoing (negative)
      : undefined;

    const numericOriginalAmountRaw = originalAmount
      ? parseFloat(originalAmount)
      : undefined;

    const txReference = transactionReference.trim() || undefined;
    const origCurrency = originalCurrency.trim() || undefined;

    const numericExchangeRate = exchangeRate
      ? parseFloat(exchangeRate)
      : undefined;

    try {
      if (transactionType === "transfer") {
        // Outgoing transaction (negative amount from source payment method)
        const outgoingTx: Omit<Transaction, "id"> = {
          date: selectedDateTime,
          amount: -Math.abs(numericAmountRaw), // negative (outgoing)
          transactionCost: numericCost,
          originalAmount: numericOriginalAmountRaw
            ? -Math.abs(numericOriginalAmountRaw)
            : undefined,
          originalCurrency: origCurrency,
          exchangeRate: numericExchangeRate,
          transactionReference: txReference,
          categoryId: categoryId!,
          paymentChannelId: paymentMethodId!, // FROM payment method
          recipientId: recipientId!, // Payer
          description: description || undefined,
          isTransfer: true,
          transferPairId: editingTransaction?.transferPairId || undefined,
        };

        // Incoming transaction (positive amount to destination payment method)
        const incomingTx: Omit<Transaction, "id"> = {
          date: selectedDateTime,
          amount: Math.abs(numericAmountRaw), // positive (incoming)
          transactionCost: undefined, // costs only on outgoing
          originalAmount: numericOriginalAmountRaw
            ? Math.abs(numericOriginalAmountRaw)
            : undefined,
          originalCurrency: origCurrency,
          exchangeRate: numericExchangeRate,
          transactionReference: txReference,
          categoryId: categoryId!,
          paymentChannelId: transferToPaymentMethodId!, // TO payment method
          recipientId: transferRecipientId!, // Recipient
          description: description || undefined,
          isTransfer: true,
          transferPairId: editingTransaction?.id || undefined,
        };

        if (
          isEditMode &&
          editingTransaction?.id &&
          editingTransaction?.transferPairId
        ) {
          // UPDATE MODE: Update both transactions in the pair
          const outgoingTxId =
            editingTransaction.amount < 0
              ? editingTransaction.id
              : editingTransaction.transferPairId;

          const incomingTxId =
            editingTransaction.amount < 0
              ? editingTransaction.transferPairId
              : editingTransaction.id;

          await db.transactions.update(outgoingTxId, outgoingTx);
          await db.transactions.update(incomingTxId, incomingTx);

          setSuccessToastMessage("Transfer transaction updated successfully!");
          setShowSuccessToast(true);
        } else {
          // CREATE MODE: Create new pair of transactions
          const outgoingId = await db.transactions.add(outgoingTx);
          const incomingId = await db.transactions.add(incomingTx);

          // Update both transactions to reference each other
          await db.transactions.update(outgoingId, {
            transferPairId: incomingId,
          });
          await db.transactions.update(incomingId, {
            transferPairId: outgoingId,
          });

          setSuccessToastMessage("Transfer transaction added successfully!");
          setShowSuccessToast(true);
        }
      } else {
        // REGULAR TRANSACTION (income/expense)
        const numericAmount =
          transactionType === "expense"
            ? -Math.abs(numericAmountRaw)
            : Math.abs(numericAmountRaw);

        const numericOriginalAmount =
          numericOriginalAmountRaw == null
            ? undefined
            : transactionType === "expense"
            ? -Math.abs(numericOriginalAmountRaw)
            : Math.abs(numericOriginalAmountRaw);

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
          isTransfer: false,
          transferPairId: undefined,
        };

        if (isEditMode && id) {
          await db.transactions.update(Number(id), tx);
          setSuccessToastMessage("Transaction updated successfully!");
          setShowSuccessToast(true);
        } else {
          await db.transactions.add(tx);
          setSuccessToastMessage("Transaction added successfully!");
          setShowSuccessToast(true);
        }
      }

      // Reset form (ONLY for add mode, not edit mode)
      if (!isEditMode) {
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
        setTransferRecipientId(undefined);
        setTransferToPaymentMethodId(undefined);
        setDescription("");

        // Redirect to transactions list after successful add (with brief delay for toast)
        setTimeout(() => {
          history.push("/transactions");
        }, 500);
      }
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
  const handleSmsImport = async (parsedData: ParsedSmsData) => {
    // Populate fields from parsed data
    if (parsedData.date) {
      // Convert MM-DD-YYYY to YYYY-MM-DD format for the date input
      const dateParts = parsedData.date.split("-");
      if (dateParts.length === 3) {
        const formattedDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
        setSelectedDate(formattedDate);
      } else {
        setSelectedDate(parsedData.date);
      }
    }
    if (parsedData.time) {
      setSelectedTime(parsedData.time);
    }
    if (parsedData.amount) {
      setAmount(parsedData.amount);
    }
    if (parsedData.reference) {
      setTransactionReference(parsedData.reference);
    }
    if (parsedData.cost) {
      setTransactionCost(parsedData.cost);
    }

    // Set transaction type based on parsed data
    if (parsedData.isIncome !== undefined) {
      setTransactionType(parsedData.isIncome ? "income" : "expense");
    }

    // Auto-populate payment method from the template that was used
    const usedTemplateId = parsedData.templateId;
    if (usedTemplateId) {
      const template = smsTemplates.find((t) => t.id === usedTemplateId);
      if (template?.paymentMethodId) {
        setPaymentMethodId(template.paymentMethodId);
      }
    }

    // Handle recipient
    if (parsedData.recipientName) {
      let recipient = sortedRecipients.find(
        (r) => r.name?.toLowerCase() === parsedData.recipientName?.toLowerCase()
      );

      if (!recipient && parsedData.recipientName) {
        try {
          const now = new Date();
          const recId = await db.recipients.add({
            name: parsedData.recipientName,
            phone: parsedData.recipientPhone,
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
        transferRecipientId,
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
    transferRecipientId,
    transferToPaymentMethodId,
    transactionType,
  ]);

  // Real-time validation feedback
  useEffect(() => {
    if (fieldErrors.amount && amount) {
      const validation = validateAmount(amount);
      if (validation.isValid) {
        setFieldErrors((prev) => ({ ...prev, amount: false }));
      }
    }
  }, [amount, fieldErrors.amount]);

  useEffect(() => {
    if (fieldErrors.description && description) {
      const validation = validateDescription(description);
      if (validation.isValid) {
        setFieldErrors((prev) => ({ ...prev, description: false }));
      }
    }
  }, [description, fieldErrors.description]);

  useEffect(() => {
    if (fieldErrors.date && selectedDate) {
      setFieldErrors((prev) => ({ ...prev, date: false }));
    }
  }, [selectedDate, fieldErrors.date]);

  useEffect(() => {
    if (fieldErrors.time && selectedTime) {
      setFieldErrors((prev) => ({ ...prev, time: false }));
    }
  }, [selectedTime, fieldErrors.time]);

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
                color: "#1a1a1a",
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
              <IonCol size="3">
                <div className="form-input-wrapper">
                  <label className="form-label">Date</label>
                  <IonInput
                    className="form-input"
                    type="date"
                    value={selectedDate}
                    onIonChange={(e) => {
                      setSelectedDate(e.detail.value ?? "");
                      setFieldErrors((prev) => ({ ...prev, date: false }));
                    }}
                  />
                  {fieldErrors.date && (
                    <span className="error-message">Required field</span>
                  )}
                </div>
              </IonCol>
              <IonCol size="2">
                <div className="form-input-wrapper">
                  <label className="form-label">Time</label>
                  <IonInput
                    className="form-input"
                    type="time"
                    value={selectedTime}
                    onIonChange={(e) => {
                      setSelectedTime(e.detail.value ?? "");
                      setFieldErrors((prev) => ({ ...prev, time: false }));
                    }}
                  />
                  {fieldErrors.time && (
                    <span className="error-message">Required field</span>
                  )}
                </div>
              </IonCol>
              <IonCol size="6">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Transaction Reference (optional)
                  </label>
                  <IonInput
                    className="form-input"
                    placeholder="e.g. ABCD123XYZ"
                    type="text"
                    value={transactionReference}
                    onIonChange={(e) =>
                      setTransactionReference(e.detail.value ?? "")
                    }
                  />
                </div>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol size="11">
                <div className="form-input-wrapper">
                  <label className="form-label">Description</label>
                  <IonInput
                    ref={descriptionInputRef}
                    className="form-input"
                    type="text"
                    placeholder="e.g. Grocery shopping"
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

            {transactionType === "transfer" ? (
              <>
                {/* Payer (Source) - Using SearchableFilterSelect */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">Payer</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select the source of the transfer"
                        value={transferRecipientId}
                        options={sortedRecipients
                          .filter((r) => r.name)
                          .map((r) => ({
                            id: r.id,
                            name: r.name as string,
                          }))}
                        onIonChange={(v) => {
                          setTransferRecipientId(v);
                          setFieldErrors((prev) => ({
                            ...prev,
                            transferRecipient: false,
                          }));
                        }}
                      />
                      {fieldErrors.transferRecipient && (
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
                        setShowRecipientModal(true);
                      }}
                      aria-label="Add Payer"
                      title="Add Payer"
                    >
                      <IonIcon icon={addOutline} />
                    </IonButton>
                  </IonCol>
                </IonRow>

                {/* Recipient (Destination) - Using SearchableFilterSelect */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">Recipient</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select destination of the transfer"
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

                {/* Category - Using SearchableFilterSelect */}
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
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId
                            );
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

                {/* FROM Payment Method - Using SearchableFilterSelect */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">From Payment Method</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select source payment method"
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

                {/* TO Payment Method - Using SearchableFilterSelect */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">To Payment Method</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select destination payment method"
                        value={transferToPaymentMethodId}
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
                          setTransferToPaymentMethodId(v);
                          setFieldErrors((prev) => ({
                            ...prev,
                            transferToPaymentMethod: false,
                          }));
                        }}
                      />
                      {fieldErrors.transferToPaymentMethod && (
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
              </>
            ) : (
              <>
                {/* Existing Recipient field */}
                <IonRow>
                  <IonCol size="11">
                    <label className="form-label">
                      {transactionType === "expense" ? "Recipient" : "Payer"}
                    </label>
                    <SearchableFilterSelect
                      label=""
                      placeholder={
                        transactionType === "expense"
                          ? "Select recipient"
                          : "Select payer"
                      }
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
                  </IonCol>
                  <IonCol size="1">
                    <IonButton
                      style={{ marginTop: "23px" }}
                      color="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowRecipientModal(true);
                      }}
                      aria-label={
                        transactionType === "expense"
                          ? "Add Recipient"
                          : "Add Payer"
                      }
                      title={
                        transactionType === "expense"
                          ? "Add Recipient"
                          : "Add Payer"
                      }
                    >
                      <IonIcon icon={addOutline} />
                    </IonButton>
                  </IonCol>
                </IonRow>

                {/* Existing Category field */}
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
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId
                            );
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
                {/* Existing Payment Method field - using new component */}
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
              </>
            )}

            <IonRow>
              <IonCol size="8">
                <div className="form-input-wrapper">
                  <label className="form-label">Amount</label>
                  <IonInput
                    className="form-input"
                    placeholder="e.g. 1,000"
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
                    onIonChange={(e) => setTransactionCost(e.detail.value!)}
                    inputMode="decimal"
                    step="0.01"
                  />
                </div>
              </IonCol>
            </IonRow>

            {/* Original Amount, Currency, Exchange Rate */}
            <IonRow>
              <IonCol size="5">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Original Amount (optional)
                  </label>
                  <IonInput
                    className="form-input"
                    placeholder="Amount in original currency, e.g. 100.00"
                    type="number"
                    value={originalAmount}
                    onIonChange={(e) => setOriginalAmount(e.detail.value ?? "")}
                    inputMode="decimal"
                    step="0.01"
                  />
                </div>
              </IonCol>

              <IonCol size="3">
                <div className="form-input-wrapper">
                  <label className="form-label">Currency (optional)</label>
                  <SearchableFilterSelect
                    label=""
                    placeholder="Select currency"
                    value={
                      originalCurrency
                        ? currencies.indexOf(originalCurrency)
                        : undefined
                    }
                    options={currencies.map((cur, index) => ({
                      id: index,
                      name: cur,
                    }))}
                    onIonChange={(v) => {
                      if (v !== undefined) {
                        setOriginalCurrency(currencies[v]);
                      }
                    }}
                  />
                </div>
              </IonCol>

              <IonCol size="3">
                <div className="form-input-wrapper">
                  <label className="form-label">Exchange Rate (optional)</label>
                  <IonInput
                    className="form-input"
                    placeholder="e.g. 125.00"
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
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol size="11">
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
      <SmsImportModal
        isOpen={showSmsImportModal}
        onClose={() => setShowSmsImportModal(false)}
        onImport={handleSmsImport}
        smsTemplates={smsTemplates}
        paymentMethods={sortedPaymentMethods}
        paymentMethodId={paymentMethodId}
      />

      {/* TOAST NOTIFICATIONS */}
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

export default AddTransaction;

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
  IonAlert,
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
} from "../db";
import { closeCircleOutline } from "ionicons/icons";
import { addOutline } from "ionicons/icons";
import { documentTextOutline } from "ionicons/icons";

const AddTransaction: React.FC = () => {
  const history = useHistory();
  const { id } = useParams<{ id?: string }>();
  const isEditMode = Boolean(id);

  // Separate date and time states
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");

  // transaction type: true = expense, false = income
  const [isExpense, setIsExpense] = useState<boolean>(true);

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
  const [modalCategoryName, setModalCategoryName] = useState("");
  const [modalCategoryDescription, setModalCategoryDescription] = useState("");
  const [modalCategoryBucketId, setModalCategoryBucketId] = useState<
    number | undefined
  >(undefined);
  const [modalCategoryIsActive, setModalCategoryIsActive] = useState(true);
  const [modalCategoryAlertMessage, setModalCategoryAlertMessage] =
    useState("");
  const [modalName, setModalName] = useState("");
  const [modalEmail, setModalEmail] = useState("");
  const [modalPhone, setModalPhone] = useState("");
  const [modalTill, setModalTill] = useState("");
  const [modalPaybill, setModalPaybill] = useState("");
  const [modalAccountNumber, setModalAccountNumber] = useState("");
  const [modalAlertMessage, setModalAlertMessage] = useState("");

  const [modalPaymentMethodName, setModalPaymentMethodName] = useState("");
  const [modalPaymentMethodAccountId, setModalPaymentMethodAccountId] =
    useState<number | undefined>(undefined);
  const [modalPaymentMethodAlertMessage, setModalPaymentMethodAlertMessage] =
    useState("");

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    date?: boolean;
    time?: boolean;
    amount?: boolean;
    category?: boolean;
    paymentMethod?: boolean;
    recipient?: boolean;
  }>({});

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
  const [smsParseError, setSmsParseError] = useState("");

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
    const load = async () => {
      try {
        const [b, c, a, pm, r] = await Promise.all([
          db.buckets.toArray(),
          db.categories.toArray(),
          db.accounts.toArray(),
          db.paymentMethods.toArray(),
          db.recipients.toArray(),
        ]);
        setBuckets(b);
        setAccounts(a);

        // Count transactions per recipient
        const transactions = await db.transactions.toArray();

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
  }, []);

  // Load transaction data in edit mode OR clear form in add mode when id changes
  useEffect(() => {
    if (isEditMode && id) {
      // EDIT MODE: Load transaction
      const loadTransaction = async () => {
        try {
          const txn = await db.transactions.get(Number(id));

          if (txn) {
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

            setIsExpense(txn.amount < 0);
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
            setCategoryId(txn.categoryId);
            setPaymentMethodId(txn.paymentChannelId);
            setRecipientId(txn.recipientId);
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
      setIsExpense(true);
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
    }
  }, [id, isEditMode]); // dateTime intentionally excluded to avoid infinite loop

  // Load descriptions sorted by frequency when component mounts
  useEffect(() => {
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

      setDescriptionSuggestions(sortedDescriptions);
    };
    loadDescriptions();
  }, []);

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
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
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
  const filteredDescriptions = descriptionSuggestions
    .filter((item) => fuzzyMatch(description, item.text))
    .slice(0, 5); // Limit to 5 suggestions

  // Handle keyboard navigation
  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
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
          setDescription(filteredDescriptions[selectedSuggestionIndex].text);
          setShowDescriptionSuggestions(false);
          setSelectedSuggestionIndex(-1);
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
    setDescription(value);
    setShowDescriptionSuggestions(true);
    setSelectedSuggestionIndex(-1);
  };

  const selectSuggestion = async (text: string) => {
    setDescription(text);
    setShowDescriptionSuggestions(false);
    setSelectedSuggestionIndex(-1);
    // Populate fields from the most recent transaction with this description
    await populateFromLastTransaction(text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setFieldErrors({});

    const errors: typeof fieldErrors = {};
    if (!selectedDate) errors.date = true;
    if (!selectedTime) errors.time = true;
    if (!amount) errors.amount = true;
    if (categoryId == null) errors.category = true;
    if (paymentMethodId == null) errors.paymentMethod = true;
    if (recipientId == null) errors.recipient = true;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    // Combine date and time
    const dateTimeString = `${selectedDate}T${selectedTime}`;
    const selectedDateTime = new Date(dateTimeString);
    const now = new Date();

    if (selectedDateTime > now) {
      setErrorMsg("Date and time cannot be in the future.");
      return;
    }

    const numericAmountRaw = parseFloat(amount);
    if (isNaN(numericAmountRaw) || numericAmountRaw <= 0) {
      setErrorMsg("Amount must be a positive number.");
      return;
    }
    // save negative values for expenses
    const numericAmount = isExpense
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
        : isExpense
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
      }
      if (categoryId == null && latest.categoryId != null) {
        setCategoryId(latest.categoryId);
      }
      if (paymentMethodId == null && latest.paymentChannelId != null) {
        setPaymentMethodId(latest.paymentChannelId);
      }
    } catch (err) {
      console.error("Failed to load last transaction for description:", err);
    }
  };

  // add helper to reset modal form
  const resetRecipientModalForm = () => {
    setModalName("");
    setModalEmail("");
    setModalPhone("");
    setModalTill("");
    setModalPaybill("");
    setModalAccountNumber("");
    setModalAlertMessage("");
  };

  const handleSaveRecipientFromModal = async () => {
    if (!modalName.trim()) {
      setModalAlertMessage("Recipient name is required");
      return;
    }
    if (modalAccountNumber.trim() && !modalPaybill.trim()) {
      setModalAlertMessage(
        "Enter a Paybill number before providing an Account Number"
      );
      return;
    }
    try {
      const now = new Date();
      const newRec = {
        name: modalName.trim(),
        email: modalEmail.trim() || undefined,
        phone: modalPhone.trim() || undefined,
        tillNumber: modalTill.trim() || undefined,
        paybill: modalPaybill.trim() || undefined,
        accountNumber: modalAccountNumber.trim() || undefined,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      } as Omit<Recipient, "id">;

      const id = await db.recipients.add(newRec);
      const saved = await db.recipients.get(id);
      if (saved) {
        // Add new recipient to the top (no transactions yet)
        setSortedRecipients((prev) => [saved, ...prev]);
      }
      setRecipientId(id);
      resetRecipientModalForm();
      setShowRecipientModal(false);
    } catch (err) {
      console.error(err);
      setModalAlertMessage("Failed to add recipient");
    }
  };

  // add helper to reset category modal form
  const resetCategoryModalForm = () => {
    setModalCategoryName("");
    setModalCategoryDescription("");
    setModalCategoryBucketId(undefined);
    setModalCategoryIsActive(true);
    setModalCategoryAlertMessage("");
  };

  const handleSaveCategoryFromModal = async () => {
    if (!modalCategoryName.trim()) {
      setModalCategoryAlertMessage("Category name is required");
      return;
    }
    if (modalCategoryBucketId == null) {
      setModalCategoryAlertMessage("Bucket is required");
      return;
    }
    try {
      const now = new Date();
      const newCat = {
        name: modalCategoryName.trim(),
        bucketId: modalCategoryBucketId,
        description: modalCategoryDescription.trim() || undefined,
        isActive: modalCategoryIsActive,
        createdAt: now,
        updatedAt: now,
      } as Omit<Category, "id">;

      const id = await db.categories.add(newCat);
      const saved = await db.categories.get(id);
      if (saved) {
        // Add new category to the top (no transactions yet)
        setSortedCategories((prev) => [saved, ...prev]);
      }
      setCategoryId(id);
      resetCategoryModalForm();
      setShowCategoryModal(false);
    } catch (err) {
      console.error(err);
      setModalCategoryAlertMessage("Failed to add category");
    }
  };

  // add helper to reset payment method modal form
  const resetPaymentMethodModalForm = () => {
    setModalPaymentMethodName("");
    setModalPaymentMethodAccountId(undefined);
    setModalPaymentMethodAlertMessage("");
  };

  const handleSavePaymentMethodFromModal = async () => {
    if (!modalPaymentMethodName.trim()) {
      setModalPaymentMethodAlertMessage("Payment method name is required");
      return;
    }
    if (!modalPaymentMethodAccountId) {
      setModalPaymentMethodAlertMessage("Please select an account");
      return;
    }
    try {
      const now = new Date();
      const newPM = {
        accountId: modalPaymentMethodAccountId,
        name: modalPaymentMethodName.trim(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      } as Omit<PaymentMethod, "id">;

      const id = await db.paymentMethods.add(newPM);
      const saved = await db.paymentMethods.get(id);
      if (saved) {
        // Add new payment method to the top (no transactions yet)
        setSortedPaymentMethods((prev) => [saved, ...prev]);
      }
      setPaymentMethodId(id);
      resetPaymentMethodModalForm();
      setShowPaymentMethodModal(false);
    } catch (err) {
      console.error(err);
      setModalPaymentMethodAlertMessage("Failed to add payment method");
    }
  };

  // Parse M-PESA SMS message
  const parseMpesaSms = (
    sms: string
  ): {
    reference?: string;
    amount?: string;
    recipientName?: string;
    recipientPhone?: string;
    date?: string;
    time?: string;
    cost?: string;
    isIncome?: boolean;
  } | null => {
    try {
      const result: {
        reference?: string;
        amount?: string;
        recipientName?: string;
        recipientPhone?: string;
        date?: string;
        time?: string;
        cost?: string;
        isIncome?: boolean;
      } = {};

      // Transaction reference (e.g., TK7M69J6QU)
      const refMatch = sms.match(/^([A-Z0-9]{10})/);
      if (refMatch) result.reference = refMatch[1];

      // Check if this is an income (received) or expense (sent) transaction
      const isReceived = sms.match(/You have received/i);
      const isSent = sms.match(/sent to/i);

      if (isReceived) {
        result.isIncome = true;

        // Amount received (e.g., Ksh15.00)
        const amountMatch = sms.match(/received\s+Ksh([\d,]+\.?\d*)/i);
        if (amountMatch) {
          result.amount = amountMatch[1].replace(/,/g, "");
        }

        // Sender name (e.g., ZIIDI)
        const senderMatch = sms.match(/from\s+([A-Z\s]+?)(?:\s+on|\s+\d)/i);
        if (senderMatch) {
          // Convert to title case
          result.recipientName = senderMatch[1]
            .trim()
            .toLowerCase()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        }
      } else if (isSent) {
        result.isIncome = false;

        // Amount sent (e.g., Ksh1,000.00)
        const amountMatch = sms.match(/Ksh([\d,]+\.?\d*)\s+sent/i);
        if (amountMatch) {
          result.amount = amountMatch[1].replace(/,/g, "");
        }

        // Recipient name and optional phone (e.g., PHILLIP KARANJA 0721930371 or Patrick  Mbaluka)
        const recipientWithPhoneMatch = sms.match(
          /sent to\s+([A-Z\s]+?)\s+(\d{10})/i
        );
        const recipientWithoutPhoneMatch = sms.match(
          /sent to\s+([A-Z\s]+?)\s+on\s+/i
        );

        if (recipientWithPhoneMatch) {
          // Has phone number
          result.recipientName = recipientWithPhoneMatch[1]
            .trim()
            .toLowerCase()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
          result.recipientPhone = recipientWithPhoneMatch[2];
        } else if (recipientWithoutPhoneMatch) {
          // No phone number
          result.recipientName = recipientWithoutPhoneMatch[1]
            .trim()
            .toLowerCase()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        }
      }

      // Date and time (e.g., 7/11/25 at 4:23 PM or 7/11/25 4:22 PM)
      const dateTimeMatch = sms.match(
        /(?:on\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s+(AM|PM)/i
      );
      if (dateTimeMatch) {
        const day = dateTimeMatch[1].padStart(2, "0");
        const month = dateTimeMatch[2].padStart(2, "0");
        const year = "20" + dateTimeMatch[3];
        result.date = `${year}-${month}-${day}`;

        let hours = parseInt(dateTimeMatch[4]);
        const minutes = dateTimeMatch[5];
        const period = dateTimeMatch[6].toUpperCase();

        if (period === "PM" && hours !== 12) hours += 12;
        if (period === "AM" && hours === 12) hours = 0;

        result.time = `${hours.toString().padStart(2, "0")}:${minutes}`;
      }

      // Transaction cost (e.g., Ksh13.00)
      const costMatch = sms.match(/Transaction cost,?\s*Ksh([\d,]+\.?\d*)/i);
      if (costMatch) {
        result.cost = costMatch[1].replace(/,/g, "");
      }

      return Object.keys(result).length > 0 ? result : null;
    } catch (err) {
      console.error("Error parsing SMS:", err);
      return null;
    }
  };

  // Handle SMS import
  const handleSmsImport = async () => {
    setSmsParseError("");

    if (!smsText.trim()) {
      setSmsParseError("Please paste an SMS message");
      return;
    }

    const parsed = parseMpesaSms(smsText);

    if (!parsed) {
      setSmsParseError("Could not parse SMS. Please check the format.");
      return;
    }

    // Populate form fields
    if (parsed.reference) setTransactionReference(parsed.reference);
    if (parsed.amount) setAmount(parsed.amount);
    if (parsed.date) setSelectedDate(parsed.date);
    if (parsed.time) setSelectedTime(parsed.time);
    if (parsed.cost) setTransactionCost(parsed.cost);

    // Set transaction type based on parsed data
    if (parsed.isIncome !== undefined) {
      setIsExpense(!parsed.isIncome);
    }

    // Handle recipient
    if (parsed.recipientName && parsed.recipientPhone) {
      // Search for existing recipient by phone
      const existingRecipient = sortedRecipients.find(
        (r) => r.phone === parsed.recipientPhone
      );

      if (existingRecipient) {
        setRecipientId(existingRecipient.id);
        setSmsText("");
        setShowSmsImportModal(false);
      } else {
        // Prompt to create new recipient
        setModalName(parsed.recipientName);
        setModalPhone(parsed.recipientPhone);
        setSmsText("");
        setShowSmsImportModal(false);
        setShowRecipientModal(true);
      }
    } else if (parsed.recipientName) {
      // No phone number (e.g., received from ZIIDI), search by name
      const existingRecipient = sortedRecipients.find(
        (r) => r.name.toLowerCase() === parsed.recipientName!.toLowerCase()
      );

      if (existingRecipient) {
        setRecipientId(existingRecipient.id);
      } else {
        // Prompt to create new recipient without phone
        setModalName(parsed.recipientName);
        setShowRecipientModal(true);
      }
      setSmsText("");
      setShowSmsImportModal(false);
    } else {
      setSmsText("");
      setShowSmsImportModal(false);
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
        <form onSubmit={handleSubmit}>
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonItem lines="none">
                  <IonSegment
                    value={isExpense ? "expense" : "income"}
                    onIonChange={(e) =>
                      setIsExpense((e.detail.value as string) === "expense")
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
            <IonRow>
              <IonCol>
                {errorMsg && <IonText color="danger">{errorMsg}</IonText>}
                {successMsg && <IonText color="success">{successMsg}</IonText>}
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol size="6">
                {fieldErrors.date && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
                    Required field
                  </IonText>
                )}
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
              </IonCol>
              <IonCol size="6">
                {fieldErrors.time && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
                    Required field
                  </IonText>
                )}
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
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol size="10">
                {fieldErrors.recipient && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
                    Required field
                  </IonText>
                )}
                <IonSelect
                  label={isExpense ? "Recipient" : "Payer"}
                  fill="outline"
                  color={fieldErrors.recipient ? "danger" : undefined}
                  labelPlacement="stacked"
                  interface="popover"
                  placeholder={isExpense ? "Select recipient" : "Select payer"}
                  value={recipientId}
                  onIonChange={(e) => {
                    const v = e.detail.value as string | number | undefined;
                    const id = v == null ? undefined : Number(v);
                    setRecipientId(id);
                    setFieldErrors((prev) => ({ ...prev, recipient: false }));
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
                    resetRecipientModalForm();
                    setShowRecipientModal(true);
                  }}
                  aria-label={isExpense ? "Add recipient" : "Add payer"}
                  title={isExpense ? "Add recipient" : "Add payer"}
                >
                  <IonIcon icon={addOutline} />
                  {isExpense ? "Add recipient" : "Add payer"}
                </IonButton>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol size="10">
                {fieldErrors.category && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
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
                    setFieldErrors((prev) => ({ ...prev, category: false }));
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

                  {sortedCategories.filter((c) => !c.bucketId).length > 0 && (
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
                    resetCategoryModalForm();
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

            <IonRow>
              <IonCol size="10">
                {fieldErrors.paymentMethod && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
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
                    resetPaymentMethodModalForm();
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

            <IonRow>
              <IonCol size="6">
                {fieldErrors.amount && (
                  <IonText color="danger" style={{ fontSize: "0.85rem" }}>
                    Required field
                  </IonText>
                )}
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
              </IonCol>

              <IonCol size="6">
                <IonItem>
                  <IonLabel position="stacked">Cost</IonLabel>
                  <IonInput
                    placeholder="Enter cost"
                    fill="outline"
                    type="number"
                    value={transactionCost}
                    onIonChange={(e) => setTransactionCost(e.detail.value!)}
                    inputMode="decimal"
                    step="0.01"
                  />
                </IonItem>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol size="7">
                <IonInput
                  ref={descriptionInputRef}
                  label="Description"
                  labelPlacement="stacked"
                  fill="outline"
                  type="text"
                  placeholder="e.g. Grocery shopping"
                  value={description}
                  onIonInput={(e) => {
                    handleDescriptionChange(e.detail.value!);
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

            <IonRow>
              <IonCol size="6">
                <IonLabel position="stacked">Original Amount</IonLabel>
                <IonInput
                  placeholder="Amount in original currency"
                  fill="outline"
                  type="number"
                  value={originalAmount}
                  onIonChange={(e) => setOriginalAmount(e.detail.value ?? "")}
                  inputMode="decimal"
                  step="0.01"
                />
              </IonCol>

              <IonCol size="3">
                <IonLabel position="stacked">Currency</IonLabel>
                <IonSelect
                  placeholder="Select currency"
                  interface="popover"
                  value={originalCurrency || undefined}
                  onIonChange={(e) =>
                    setOriginalCurrency((e.detail.value as string) ?? "")
                  }
                  labelPlacement="stacked"
                  fill="outline"
                >
                  {currencies.map((cur) => (
                    <IonSelectOption key={cur} value={cur}>
                      {cur}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonCol>

              <IonCol size="3">
                <IonLabel position="stacked">Exchange Rate</IonLabel>
                <IonInput
                  label="Exchange Rate"
                  labelPlacement="stacked"
                  placeholder="e.g. 1.2"
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
      <IonModal
        isOpen={showRecipientModal}
        onDidDismiss={() => setShowRecipientModal(false)}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Add Recipient</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {modalAlertMessage && (
            <IonAlert
              isOpen={!!modalAlertMessage}
              onDidDismiss={() => setModalAlertMessage("")}
              header={"Alert"}
              message={modalAlertMessage}
              buttons={["OK"]}
            />
          )}
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Recipient Name"
                  labelPlacement="stacked"
                  placeholder="e.g., John Doe"
                  value={modalName}
                  onIonChange={(e) => setModalName(e.detail.value ?? "")}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Phone (optional)"
                  labelPlacement="stacked"
                  type="tel"
                  placeholder="e.g., 0712345678"
                  value={modalPhone}
                  onIonChange={(e) => setModalPhone(e.detail.value ?? "")}
                />
              </IonCol>
              <IonCol>
                <IonInput
                  label="Email (optional)"
                  labelPlacement="stacked"
                  type="email"
                  placeholder="e.g., john@example.com"
                  value={modalEmail}
                  onIonChange={(e) => setModalEmail(e.detail.value ?? "")}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Till Number (optional)"
                  labelPlacement="stacked"
                  placeholder="e.g., 123456"
                  value={modalTill}
                  onIonChange={(e) => setModalTill(e.detail.value ?? "")}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Paybill (optional)"
                  labelPlacement="stacked"
                  placeholder="e.g., 400200"
                  value={modalPaybill}
                  onIonChange={(e) => setModalPaybill(e.detail.value ?? "")}
                />
              </IonCol>
              <IonCol>
                <IonInput
                  label="Account Number (optional)"
                  labelPlacement="stacked"
                  placeholder="e.g., 1234567890"
                  value={modalAccountNumber}
                  onIonChange={(e) =>
                    setModalAccountNumber(e.detail.value ?? "")
                  }
                  disabled={!modalPaybill.trim()}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonButton
                  expand="block"
                  onClick={handleSaveRecipientFromModal}
                >
                  Add Recipient
                </IonButton>
              </IonCol>
              <IonCol>
                <IonButton
                  expand="block"
                  color="medium"
                  onClick={() => setShowRecipientModal(false)}
                >
                  Cancel
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonContent>
      </IonModal>

      {/* Modal: Add Category */}
      <IonModal
        isOpen={showCategoryModal}
        onDidDismiss={() => setShowCategoryModal(false)}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Add Category</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {modalCategoryAlertMessage && (
            <IonAlert
              isOpen={!!modalCategoryAlertMessage}
              onDidDismiss={() => setModalCategoryAlertMessage("")}
              header={"Alert"}
              message={modalCategoryAlertMessage}
              buttons={["OK"]}
            />
          )}
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Category Name"
                  labelPlacement="stacked"
                  fill="outline"
                  placeholder="e.g., Groceries"
                  value={modalCategoryName}
                  onIonChange={(e) =>
                    setModalCategoryName(e.detail.value ?? "")
                  }
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Description (optional)"
                  labelPlacement="stacked"
                  fill="outline"
                  placeholder="Category description"
                  value={modalCategoryDescription}
                  onIonChange={(e) =>
                    setModalCategoryDescription(e.detail.value ?? "")
                  }
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonSelect
                  label="Bucket"
                  placeholder="Select bucket"
                  interface="popover"
                  value={modalCategoryBucketId}
                  onIonChange={(e) =>
                    setModalCategoryBucketId(
                      e.detail.value as number | undefined
                    )
                  }
                  labelPlacement="stacked"
                  fill="outline"
                >
                  {buckets.map((b) => (
                    <IonSelectOption key={b.id} value={b.id}>
                      {b.name}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonButton expand="block" onClick={handleSaveCategoryFromModal}>
                  Add Category
                </IonButton>
              </IonCol>
              <IonCol>
                <IonButton
                  expand="block"
                  color="medium"
                  onClick={() => setShowCategoryModal(false)}
                >
                  Cancel
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonContent>
      </IonModal>

      {/* Modal: Add Payment Method */}
      <IonModal
        isOpen={showPaymentMethodModal}
        onDidDismiss={() => setShowPaymentMethodModal(false)}
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Add Payment Method</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {modalPaymentMethodAlertMessage && (
            <IonAlert
              isOpen={!!modalPaymentMethodAlertMessage}
              onDidDismiss={() => setModalPaymentMethodAlertMessage("")}
              header={"Alert"}
              message={modalPaymentMethodAlertMessage}
              buttons={["OK"]}
            />
          )}
          <IonGrid>
            <IonRow>
              <IonCol>
                <IonSelect
                  label="Account"
                  placeholder="Select account"
                  interface="popover"
                  value={modalPaymentMethodAccountId}
                  onIonChange={(e) =>
                    setModalPaymentMethodAccountId(
                      e.detail.value as number | undefined
                    )
                  }
                  labelPlacement="stacked"
                  fill="outline"
                >
                  {accounts.map((a) => (
                    <IonSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonInput
                  label="Payment Method Name"
                  labelPlacement="stacked"
                  fill="outline"
                  placeholder="e.g., Visa, Mastercard"
                  value={modalPaymentMethodName}
                  onIonChange={(e) =>
                    setModalPaymentMethodName(e.detail.value ?? "")
                  }
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonButton
                  expand="block"
                  onClick={handleSavePaymentMethodFromModal}
                >
                  Add Payment Method
                </IonButton>
              </IonCol>
              <IonCol>
                <IonButton
                  expand="block"
                  color="medium"
                  onClick={() => setShowPaymentMethodModal(false)}
                >
                  Cancel
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonContent>
      </IonModal>

      {/* Modal: Import SMS */}
      <IonModal
        isOpen={showSmsImportModal}
        onDidDismiss={() => {
          setShowSmsImportModal(false);
          setSmsText("");
          setSmsParseError("");
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
                <IonLabel position="stacked">Paste M-PESA SMS Message</IonLabel>
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
                  placeholder="TK7M69J6QU Confirmed. Ksh1,000.00 sent to..."
                  value={smsText}
                  onChange={(e) => setSmsText(e.target.value)}
                />
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonButton expand="block" onClick={handleSmsImport}>
                  Parse & Import
                </IonButton>
              </IonCol>
            </IonRow>
            <IonRow>
              <IonCol>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    <strong>Supported format:</strong>
                    <br />
                    M-PESA confirmation messages (sent to recipient)
                    <br />
                    <br />
                    <strong>Example:</strong>
                    <br />
                    TK7M69J6QU Confirmed. Ksh1,000.00 sent to PHILLIP KARANJA
                    0721930371 on 7/11/25 at 4:23 PM. New M-PESA balance is
                    Ksh2.51. Transaction cost, Ksh13.00.
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

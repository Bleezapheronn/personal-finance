import React, { useState, useEffect, useMemo } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonList,
  IonItem,
  IonText,
  IonSpinner,
  IonButton,
  IonIcon,
  useIonViewWillEnter,
  IonGrid,
  IonRow,
  IonCol,
  IonAvatar,
  IonImg,
  IonChip,
  IonLabel,
  IonCard,
  IonCardContent,
  IonAlert,
  IonAccordion,
  IonAccordionGroup,
  IonInput,
  IonFab,
  IonFabButton,
  IonToast,
  IonBadge,
} from "@ionic/react";

import { useHistory } from "react-router-dom";
import {
  createOutline,
  copyOutline,
  addOutline,
  trashOutline,
  arrowUpCircle,
  arrowDownCircle,
  closeCircle,
  closeCircleOutline,
  downloadOutline,
  cloudUploadOutline,
} from "ionicons/icons";
import { db, Transaction, Category, Recipient, Bucket, Account } from "../db";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import { exportTransactionsToCSV, downloadCSV } from "../utils/csvExport";
import { ImportModal } from "../components/ImportModal";
import {
  accountRepository,
  categoryRepository,
  recipientRepository,
  transactionRepository,
} from "../repositories";
import { SelectedReadPreviewCard } from "../components/dev/SelectedReadPreviewCard";
import {
  booleanValue,
  type DevPreviewListResult,
  envFlagEnabled,
  isSelectedReadPreviewsEnabled,
  numberValue,
  previewCount,
  previewRows,
  safePreviewErrorCode,
  sampledIds,
} from "../utils/devPreview";
import {
  getRepositoryBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import "./Transactions.css";

const TRANSACTION_BATCH_DAYS = 30;
const SELECTED_READ_PREVIEW_LIMIT = 20;
const TRANSACTIONS_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_READ_EXPERIMENT";
const TRANSACTIONS_READ_EXPERIMENT_LIMIT = 5000;
const TRANSACTIONS_READ_EXPERIMENT_PAGE_SIZE = 200;
const LOOKUP_READ_EXPERIMENT_LIMIT = 5000;

const isTransactionsReadExperimentEnabled = (): boolean =>
  envFlagEnabled(TRANSACTIONS_READ_EXPERIMENT_FLAG);

const normalizeToLocalDay = (value: string | Date): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const parseDateInputToLocalDay = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

interface DuplicateTransactionPrefill {
  transactionType: "expense" | "income" | "transfer";
  amount: string;
  transactionCost: string;
  originalAmount: string;
  originalCurrency: string;
  exchangeRate: string;
  exchangeRateOverride: boolean;
  categoryId: number | undefined;
  accountId: number | undefined;
  recipientId: number | undefined;
  transferToAccountId: number | undefined;
  transferRecipientId: number | undefined;
  description: string;
}

type AmountSign = "negative" | "positive" | "zero" | "unknown";

interface SelectedReadTransactionPreviewRow {
  id?: number;
  dateDayKey?: string;
  amountSign: AmountSign;
  hasTransactionCost: boolean;
  isTransfer?: boolean | null;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  budgetSnapshotId?: number;
}

interface SelectedReadTransactionsPreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  rows: SelectedReadTransactionPreviewRow[];
  errorCode?: string;
}

interface TransactionsReadExperimentLoadResult {
  transactions: Transaction[];
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
}

const dateValue = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date(0);
};

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return numberValue(value);
};

const optionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return typeof value === "string" ? value : undefined;
};

const optionalBoolean = (value: unknown): boolean | undefined => {
  const normalized = booleanValue(value);
  return normalized === null ? undefined : normalized;
};

const selectedReadRowToTransaction = (row: { id?: unknown }): Transaction => {
  const source = row as Record<string, unknown>;

  return {
    id: optionalNumber(source.id),
    categoryId: numberValue(source.categoryId) ?? 0,
    paymentChannelId: optionalNumber(source.paymentChannelId),
    accountId: optionalNumber(source.accountId),
    recipientId: numberValue(source.recipientId) ?? 0,
    date: dateValue(source.date),
    amount: numberValue(source.amount) ?? 0,
    originalAmount: optionalNumber(source.originalAmount),
    originalCurrency: optionalString(source.originalCurrency),
    exchangeRate: optionalNumber(source.exchangeRate),
    transactionReference: optionalString(source.transactionReference),
    transactionCost: optionalNumber(source.transactionCost),
    description: optionalString(source.description),
    transferPairId: optionalNumber(source.transferPairId),
    isTransfer: optionalBoolean(source.isTransfer),
    budgetId: optionalNumber(source.budgetId),
    occurrenceDate:
      source.occurrenceDate === null || source.occurrenceDate === undefined
        ? undefined
        : dateValue(source.occurrenceDate),
    budgetSnapshotId: optionalNumber(source.budgetSnapshotId),
  };
};

const selectedReadRowToAccount = (row: { id?: unknown }): Account => {
  const source = row as Record<string, unknown>;

  return {
    id: optionalNumber(source.id),
    name: optionalString(source.name) ?? "",
    description: optionalString(source.description),
    currency: optionalString(source.currency),
    isActive: optionalBoolean(source.isActive) ?? true,
    isCredit: optionalBoolean(source.isCredit) ?? false,
    creditLimit: optionalNumber(source.creditLimit),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const selectedReadRowToBucket = (row: { id?: unknown }): Bucket => {
  const source = row as Record<string, unknown>;

  return {
    id: optionalNumber(source.id),
    name: optionalString(source.name) ?? "",
    description: optionalString(source.description),
    minPercentage: numberValue(source.minPercentage) ?? 0,
    maxPercentage: numberValue(source.maxPercentage) ?? 0,
    minFixedAmount: optionalNumber(source.minFixedAmount),
    isActive: optionalBoolean(source.isActive) ?? true,
    displayOrder: numberValue(source.displayOrder) ?? 0,
    excludeFromReports: optionalBoolean(source.excludeFromReports) ?? false,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const selectedReadRowToCategory = (row: { id?: unknown }): Category => {
  const source = row as Record<string, unknown>;

  return {
    id: optionalNumber(source.id),
    name: optionalString(source.name) ?? "",
    bucketId: numberValue(source.bucketId) ?? 0,
    description: optionalString(source.description),
    isActive: optionalBoolean(source.isActive) ?? true,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const selectedReadRowToRecipient = (row: { id?: unknown }): Recipient => {
  const source = row as Record<string, unknown>;

  return {
    id: optionalNumber(source.id),
    name: optionalString(source.name) ?? "",
    aliases: optionalString(source.aliases),
    email: optionalString(source.email),
    phone: optionalString(source.phone),
    tillNumber: optionalString(source.tillNumber),
    paybill: optionalString(source.paybill),
    accountNumber: optionalString(source.accountNumber),
    description: optionalString(source.description),
    isActive: optionalBoolean(source.isActive) ?? true,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const selectedReadListRows = (
  result: DevPreviewListResult,
  errorCode: string,
): Array<{ id?: unknown }> => {
  const rows = previewRows(result);
  if (!rows) {
    throw new Error(errorCode);
  }

  return rows;
};

const loadSelectedReadTransactionExperimentRows = async (
  repositories: ReturnType<typeof getSelectedReadRepositories>,
): Promise<TransactionsReadExperimentLoadResult> => {
  const transactions: Transaction[] = [];
  let reportedCount: number | undefined;
  let pagesLoaded = 0;

  while (transactions.length < TRANSACTIONS_READ_EXPERIMENT_LIMIT) {
    const limit = Math.min(
      TRANSACTIONS_READ_EXPERIMENT_PAGE_SIZE,
      TRANSACTIONS_READ_EXPERIMENT_LIMIT - transactions.length,
    );
    const result = await repositories.transactions.list({
      limit,
      offset: transactions.length,
    });
    const rows = selectedReadListRows(
      result as DevPreviewListResult,
      "invalid_transactions_read_experiment_response",
    );

    reportedCount ??= previewCount(result as DevPreviewListResult);
    pagesLoaded += 1;
    transactions.push(...rows.map(selectedReadRowToTransaction));

    if (rows.length === 0) {
      break;
    }

    if (reportedCount !== undefined && transactions.length >= reportedCount) {
      break;
    }

    if (rows.length < limit) {
      break;
    }
  }

  return {
    transactions,
    reportedCount,
    pagesLoaded,
    truncated:
      reportedCount !== undefined ? transactions.length < reportedCount : false,
  };
};

const loadSelectedReadLookupRows = async (
  repositories: ReturnType<typeof getSelectedReadRepositories>,
): Promise<{
  accounts: Account[];
  buckets: Bucket[];
  categories: Category[];
  recipients: Recipient[];
}> => {
  const [accountsResult, bucketsResult, categoriesResult, recipientsResult] =
    await Promise.all([
      repositories.accounts.list({
        limit: LOOKUP_READ_EXPERIMENT_LIMIT,
        offset: 0,
      }),
      repositories.buckets.list({
        limit: LOOKUP_READ_EXPERIMENT_LIMIT,
        offset: 0,
      }),
      repositories.categories.list({
        limit: LOOKUP_READ_EXPERIMENT_LIMIT,
        offset: 0,
      }),
      repositories.recipients.list({
        limit: LOOKUP_READ_EXPERIMENT_LIMIT,
        offset: 0,
      }),
    ]);

  return {
    accounts: selectedReadListRows(
      accountsResult as DevPreviewListResult,
      "invalid_transactions_read_experiment_accounts_response",
    ).map(selectedReadRowToAccount),
    buckets: selectedReadListRows(
      bucketsResult as DevPreviewListResult,
      "invalid_transactions_read_experiment_buckets_response",
    ).map(selectedReadRowToBucket),
    categories: selectedReadListRows(
      categoriesResult as DevPreviewListResult,
      "invalid_transactions_read_experiment_categories_response",
    ).map(selectedReadRowToCategory),
    recipients: selectedReadListRows(
      recipientsResult as DevPreviewListResult,
      "invalid_transactions_read_experiment_recipients_response",
    ).map(selectedReadRowToRecipient),
  };
};

const toDayKey = (value: unknown): string | undefined => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
};

const amountSign = (value: unknown): AmountSign => {
  const amount = numberValue(value);
  if (amount === undefined) {
    return "unknown";
  }

  if (amount < 0) {
    return "negative";
  }

  if (amount > 0) {
    return "positive";
  }

  return "zero";
};

const hasTransactionCost = (value: unknown): boolean => {
  const cost = numberValue(value);
  return cost !== undefined && cost !== 0;
};

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountImages, setAccountImages] = useState<Map<number, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<
    number | undefined
  >(undefined);
  const [isTransferDelete, setIsTransferDelete] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [visibleTransactionWindowDays, setVisibleTransactionWindowDays] =
    useState(TRANSACTION_BATCH_DAYS);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const [
    transactionsReadExperimentLoad,
    setTransactionsReadExperimentLoad,
  ] = useState<TransactionsReadExperimentLoadResult | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadTransactionsPreview | null>(null);

  // Filter states - CHANGED: accountId instead of paymentMethodId
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
  // REMOVED: selectedPaymentMethodId
  const [selectedDescription, setSelectedDescription] = useState<string>("");

  const history = useHistory();
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const selectedBackend = getRepositoryBackend();
  const transactionsReadExperimentEnabled =
    isTransactionsReadExperimentEnabled();
  const transactionsReadExperimentHttpReadonly =
    transactionsReadExperimentEnabled && selectedBackend === "http-readonly";

  const fetchTransactions = async () => {
    setLoading(true);

    try {
      let allTransactions: Transaction[];
      let cats: Category[];
      let bkts: Bucket[];
      let recs: Recipient[];
      let accs: Account[];
      let experimentLoad: TransactionsReadExperimentLoadResult | null = null;

      if (transactionsReadExperimentHttpReadonly) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const [transactionLoad, lookupRows] = await Promise.all([
          loadSelectedReadTransactionExperimentRows(repositories),
          loadSelectedReadLookupRows(repositories),
        ]);

        allTransactions = transactionLoad.transactions;
        cats = lookupRows.categories;
        bkts = lookupRows.buckets;
        recs = lookupRows.recipients;
        accs = lookupRows.accounts;
        experimentLoad = transactionLoad;
      } else {
        [allTransactions, cats, bkts, recs, accs] = await Promise.all([
          transactionRepository.listTransactions(),
          categoryRepository.listCategories(),
          categoryRepository.listBuckets(),
          recipientRepository.listRecipients(),
          accountRepository.listAccounts(),
        ]);
      }

      // REMOVED: paymentMethods fetch - no longer needed

      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);
      setTransactionsReadExperimentLoad(experimentLoad);

      // Convert account image blobs to URLs
      const imageMap = new Map<number, string>();
      for (const acc of accs) {
        if (acc.id && acc.imageBlob) {
          const url = URL.createObjectURL(acc.imageBlob);
          imageMap.set(acc.id, url);
        }
      }
      setAccountImages(imageMap);

      // Sort descending by date and time, then by total amount (lowest to highest)
      const sortedTransactions = allTransactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateB !== dateA) {
          return dateB - dateA;
        }
        const totalA = a.amount + (a.transactionCost || 0);
        const totalB = b.amount + (b.transactionCost || 0);

        const isAIncoming = totalA >= 0;
        const isBIncoming = totalB >= 0;

        if (isAIncoming && !isBIncoming) return -1;
        if (!isAIncoming && isBIncoming) return 1;

        return totalA - totalB;
      });

      setTransactions(sortedTransactions);
      setVisibleTransactionWindowDays(TRANSACTION_BATCH_DAYS);
      setError("");
    } catch (err) {
      setError("Failed to load transactions.");
      setTransactionsReadExperimentLoad(null);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // This hook runs every time the page is about to enter and become active
  useIonViewWillEnter(() => {
    fetchTransactions();
  });

  const showTransactionsReadExperimentActionDisabled = () => {
    setError(
      "Transactions read experiment is active. Switch back to Dexie to manage transactions.",
    );
  };

  // Handler to navigate to Transaction Details page with transaction ID
  const handleView = (id?: number) => {
    if (transactionsReadExperimentHttpReadonly) {
      showTransactionsReadExperimentActionDisabled();
      return;
    }

    if (id !== undefined) {
      history.push(`/transaction-details/${id}`);
    }
  };

  // Handler to navigate to Edit Transaction page
  const handleEdit = (id?: number) => {
    if (transactionsReadExperimentHttpReadonly) {
      showTransactionsReadExperimentActionDisabled();
      return;
    }

    if (id !== undefined) {
      history.push(`/edit/${id}`);
    }
  };

  const handleDuplicate = async (txn: Transaction) => {
    if (transactionsReadExperimentHttpReadonly) {
      showTransactionsReadExperimentActionDisabled();
      return;
    }

    if (!txn.id) {
      return;
    }

    const basePrefill: DuplicateTransactionPrefill = {
      transactionType: txn.amount < 0 ? "expense" : "income",
      amount: Math.abs(txn.amount).toString(),
      transactionCost: txn.transactionCost
        ? Math.abs(txn.transactionCost).toString()
        : "",
      originalAmount: txn.originalAmount
        ? Math.abs(txn.originalAmount).toString()
        : "",
      originalCurrency: txn.originalCurrency || "",
      exchangeRate: txn.exchangeRate?.toString() || "",
      exchangeRateOverride: !!txn.exchangeRate,
      categoryId: txn.categoryId,
      accountId: txn.accountId,
      recipientId: txn.recipientId,
      transferToAccountId: undefined,
      transferRecipientId: undefined,
      description: txn.description || "",
    };

    if (txn.isTransfer && txn.transferPairId) {
      const pairedTxn = await transactionRepository.getPairedTransaction(txn);
      const outgoingTxn = txn.amount < 0 ? txn : pairedTxn;
      const incomingTxn = txn.amount < 0 ? pairedTxn : txn;

      const transferPrefill: DuplicateTransactionPrefill = {
        transactionType: "transfer",
        amount: Math.abs(outgoingTxn?.amount ?? txn.amount).toString(),
        transactionCost: outgoingTxn?.transactionCost
          ? Math.abs(outgoingTxn.transactionCost).toString()
          : "",
        originalAmount: outgoingTxn?.originalAmount
          ? Math.abs(outgoingTxn.originalAmount).toString()
          : "",
        originalCurrency: outgoingTxn?.originalCurrency || "",
        exchangeRate: outgoingTxn?.exchangeRate?.toString() || "",
        exchangeRateOverride: !!outgoingTxn?.exchangeRate,
        categoryId: txn.categoryId,
        accountId: outgoingTxn?.accountId,
        recipientId: outgoingTxn?.recipientId,
        transferToAccountId: incomingTxn?.accountId,
        transferRecipientId: incomingTxn?.recipientId,
        description: outgoingTxn?.description || txn.description || "",
      };

      history.push("/add", { duplicatePrefill: transferPrefill });
      return;
    }

    history.push("/add", { duplicatePrefill: basePrefill });
  };

  // Handler to delete a transaction with confirmation
  const handleDeleteClick = async (id?: number) => {
    if (id === undefined) return;
    if (transactionsReadExperimentHttpReadonly) {
      showTransactionsReadExperimentActionDisabled();
      return;
    }

    const isTransfer = await transactionRepository.isTransferTransaction(id);
    setIsTransferDelete(isTransfer);
    setTransactionToDelete(id);
    setShowDeleteConfirm(true);
  };

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const [count, result] = await Promise.all([
        repositories.transactions.count(),
        repositories.transactions.list({
          limit: SELECTED_READ_PREVIEW_LIMIT,
          offset: 0,
        }),
      ]);
      const rows = previewRows(result as DevPreviewListResult);

      if (!rows) {
        setSelectedReadPreview({
          status: "fail",
          backend,
          source,
          rows: [],
          errorCode: "invalid_selected_read_transactions_preview_response",
        });
        return;
      }

      const visibleRows = rows.slice(0, SELECTED_READ_PREVIEW_LIMIT);

      setSelectedReadPreview({
        status: "pass",
        backend,
        source,
        count,
        loadedRowCount: visibleRows.length,
        sampledIds: sampledIds(visibleRows, SELECTED_READ_PREVIEW_LIMIT),
        rows: visibleRows.map((row) => ({
          id: numberValue(row.id),
          dateDayKey: toDayKey((row as { date?: unknown }).date),
          amountSign: amountSign((row as { amount?: unknown }).amount),
          hasTransactionCost: hasTransactionCost(
            (row as { transactionCost?: unknown }).transactionCost,
          ),
          isTransfer: booleanValue((row as { isTransfer?: unknown }).isTransfer),
          categoryId: numberValue((row as { categoryId?: unknown }).categoryId),
          accountId: numberValue((row as { accountId?: unknown }).accountId),
          recipientId: numberValue((row as { recipientId?: unknown }).recipientId),
          budgetSnapshotId: numberValue(
            (row as { budgetSnapshotId?: unknown }).budgetSnapshotId,
          ),
        })),
      });
    } catch (err) {
      setSelectedReadPreview({
        status: "fail",
        backend,
        source,
        rows: [],
        errorCode: safePreviewErrorCode(
          err,
          "selected_read_transactions_preview_failed",
        ),
      });
    } finally {
      setSelectedReadPreviewLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (transactionToDelete === undefined) return;
    if (transactionsReadExperimentHttpReadonly) {
      showTransactionsReadExperimentActionDisabled();
      setShowDeleteConfirm(false);
      setTransactionToDelete(undefined);
      setIsTransferDelete(false);
      return;
    }

    try {
      // Get the transaction to check if it's a transfer
      const txnToDelete = await db.transactions.get(transactionToDelete);

      if (txnToDelete?.isTransfer && txnToDelete?.transferPairId) {
        // Delete both transactions in the pair
        await db.transactions.delete(transactionToDelete);
        await db.transactions.delete(txnToDelete.transferPairId);

        setSuccessMsg(
          "Transfer transaction deleted successfully! Both paired transactions were removed.",
        );
      } else {
        // Delete single transaction
        await db.transactions.delete(transactionToDelete);
        setSuccessMsg("Transaction deleted successfully!");
        setShowSuccessToast(true);
      }

      fetchTransactions(); // refresh after delete
      setShowDeleteConfirm(false);
      setTransactionToDelete(undefined);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error("Error deleting transaction:", err);
      setError("Error deleting transaction.");
      setShowDeleteConfirm(false);
    }
  };

  // Helper to get category name
  const getCategoryName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.name || "—";
  };

  // Helper to get bucket name from category
  const getBucketName = (categoryId: number) => {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat?.bucketId) {
      const bucket = buckets.find((b) => b.id === cat.bucketId);
      return bucket?.name || "";
    }
    return "";
  };

  // Helper to get recipient name
  const getRecipientName = (recipientId: number) => {
    const rec = recipients.find((r) => r.id === recipientId);
    return rec?.name || "—";
  };

  // CHANGED: Get account image and name directly from accountId
  const getAccountImage = (
    accountId: number | undefined,
  ): string | undefined => {
    if (!accountId || !accountImages.has(accountId)) {
      return undefined;
    }
    return accountImages.get(accountId);
  };

  const getAccountName = (accountId: number | undefined): string => {
    if (!accountId) return "—";
    const account = accounts.find((a) => a.id === accountId);
    return account?.name || "—";
  };

  const clearFilters = () => {
    setSelectedAccountId(undefined);
    // REMOVED: setSelectedPaymentMethodId(undefined);
    setSelectedRecipientId(undefined);
    setSelectedBucketId(undefined);
    setSelectedCategoryId(undefined);
    setSelectedDateFrom("");
    setSelectedDateTo("");
    setSelectedDescription("");
  };

  const clearIndividualFilter = (filterName: string) => {
    switch (filterName) {
      case "account":
        setSelectedAccountId(undefined);
        break;
      // REMOVED: paymentMethod case
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
    }
  };

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

    // REMOVED: Payment Method chip

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

    return chips;
  };

  const hasActiveFilters = () => {
    return (
      selectedAccountId !== undefined ||
      selectedRecipientId !== undefined ||
      selectedBucketId !== undefined ||
      selectedCategoryId !== undefined ||
      selectedDateFrom !== "" ||
      selectedDateTo !== "" ||
      selectedDescription !== ""
    );
  };

  // Add this helper function before the return statement
  const getTimeGroup = (dateValue: string | Date): string => {
    const txnDate = new Date(dateValue);
    const today = normalizeToLocalDay(new Date());

    const txnDateOnly = normalizeToLocalDay(dateValue);

    // Get the day of week for today
    const todayDay = today.getDay();

    // Calculate start of this week (Sunday)
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - todayDay);
    thisWeekStart.setHours(0, 0, 0, 0);

    // Calculate start of last week
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    const nextWeekStart = new Date(thisWeekStart);
    nextWeekStart.setDate(thisWeekStart.getDate() + 7);

    const nextMonthStart = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1,
    );
    const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    const weekAfterNextStart = new Date(nextWeekStart);
    weekAfterNextStart.setDate(nextWeekStart.getDate() + 7);

    // Check which group the transaction belongs to
    if (txnDateOnly >= thisWeekStart && txnDateOnly < nextWeekStart) {
      return "This Week";
    } else if (
      txnDateOnly >= nextWeekStart &&
      txnDateOnly < weekAfterNextStart
    ) {
      return "Next Week";
    } else if (txnDateOnly >= nextMonthStart && txnDateOnly <= nextMonthEnd) {
      return "Next Month";
    } else if (txnDateOnly >= lastWeekStart && txnDateOnly < thisWeekStart) {
      return "Last Week";
    } else if (
      txnDate.getMonth() === today.getMonth() &&
      txnDate.getFullYear() === today.getFullYear()
    ) {
      return txnDateOnly > today ? "Later This Month" : "This Month (Past)";
    } else {
      // Return month and year for out-of-band months (both future and past)
      return txnDate.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
    }
  };

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((txn) => {
      if (
        selectedAccountId !== undefined &&
        txn.accountId !== selectedAccountId
      ) {
        return false;
      }

      if (
        selectedRecipientId !== undefined &&
        txn.recipientId !== selectedRecipientId
      ) {
        return false;
      }

      if (selectedBucketId !== undefined) {
        const category = categories.find((c) => c.id === txn.categoryId);
        if (category?.bucketId !== selectedBucketId) {
          return false;
        }
      }

      if (
        selectedCategoryId !== undefined &&
        txn.categoryId !== selectedCategoryId
      ) {
        return false;
      }

      if (selectedDateFrom) {
        const txnDate = normalizeToLocalDay(txn.date);
        const fromDate = parseDateInputToLocalDay(selectedDateFrom);
        if (txnDate < fromDate) {
          return false;
        }
      }

      if (selectedDateTo) {
        const txnDate = normalizeToLocalDay(txn.date);
        const toDate = parseDateInputToLocalDay(selectedDateTo);
        if (txnDate > toDate) {
          return false;
        }
      }

      if (
        selectedDescription &&
        !txn.description
          ?.toLowerCase()
          .includes(selectedDescription.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [
    transactions,
    selectedAccountId,
    selectedRecipientId,
    selectedBucketId,
    selectedCategoryId,
    selectedDateFrom,
    selectedDateTo,
    selectedDescription,
    categories,
  ]);

  const visibleTransactions = useMemo(() => {
    if (selectedDateFrom) {
      // Date From explicitly defines the lower bound, so bypass rolling windowing.
      return filteredTransactions;
    }

    const today = normalizeToLocalDay(new Date());
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - visibleTransactionWindowDays);

    return filteredTransactions.filter((txn) => {
      const txnDate = normalizeToLocalDay(txn.date);
      if (txnDate > today) {
        // Future transactions are always visible regardless of the past window.
        return true;
      }

      return txnDate >= cutoffDate && txnDate <= today;
    });
  }, [filteredTransactions, selectedDateFrom, visibleTransactionWindowDays]);

  const groupedVisibleTransactions = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    const fixedGroupOrder = [
      "Next Month",
      "Later This Month",
      "Next Week",
      "This Week",
      "Last Week",
      "This Month (Past)",
    ];

    visibleTransactions.forEach((txn) => {
      const group = getTimeGroup(txn.date);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(txn);
    });

    const sortedGroups: Array<[string, Transaction[]]> = [];
    const today = normalizeToLocalDay(new Date());

    const monthNamedGroups = Array.from(groups.entries()).filter(
      ([group]) => !fixedGroupOrder.includes(group),
    );

    const futureMonthGroups = monthNamedGroups
      .filter(([group]) => {
        const groupDate = new Date(`${group} 1`);
        return (
          !Number.isNaN(groupDate.getTime()) &&
          (groupDate.getFullYear() > today.getFullYear() ||
            (groupDate.getFullYear() === today.getFullYear() &&
              groupDate.getMonth() > today.getMonth()))
        );
      })
      .sort((a, b) => {
        const dateA = new Date(`${a[0]} 1`);
        const dateB = new Date(`${b[0]} 1`);
        return dateB.getTime() - dateA.getTime();
      });

    sortedGroups.push(...futureMonthGroups);

    fixedGroupOrder.forEach((group) => {
      if (groups.has(group)) {
        sortedGroups.push([group, groups.get(group)!]);
      }
    });

    const pastMonthGroups = monthNamedGroups
      .filter(([group]) => {
        const groupDate = new Date(`${group} 1`);
        return (
          !Number.isNaN(groupDate.getTime()) &&
          (groupDate.getFullYear() < today.getFullYear() ||
            (groupDate.getFullYear() === today.getFullYear() &&
              groupDate.getMonth() < today.getMonth()))
        );
      })
      .sort((a, b) => {
        const dateA = new Date(`${a[0]} 1`);
        const dateB = new Date(`${b[0]} 1`);
        return dateB.getTime() - dateA.getTime();
      });

    sortedGroups.push(...pastMonthGroups);

    return sortedGroups;
  }, [visibleTransactions]);

  const { accountTotals, overallTotal } = useMemo(() => {
    if (filteredTransactions.length === 0 || accounts.length === 0) {
      return { accountTotals: [], overallTotal: 0 };
    }

    const accountTotalsMap = new Map<number, number>();

    filteredTransactions.forEach((txn) => {
      if (txn.accountId) {
        const netAmount = txn.amount + (txn.transactionCost || 0);
        const currentTotal = accountTotalsMap.get(txn.accountId) || 0;
        accountTotalsMap.set(txn.accountId, currentTotal + netAmount);
      }
    });

    const calculatedTotals = Array.from(accountTotalsMap.entries())
      .map(([accountId, total]) => {
        const account = accounts.find((a) => a.id === accountId);
        return {
          accountId,
          accountName: account?.name || "Unknown",
          total,
          imageUrl: accountImages.get(accountId),
        };
      })
      .filter((account) => {
        const acct = accounts.find((a) => a.id === account.accountId);
        if (acct?.isCredit) {
          return account.total < 0;
        }
        return true;
      });

    calculatedTotals.sort((a, b) => a.accountName.localeCompare(b.accountName));

    return {
      accountTotals: calculatedTotals,
      overallTotal: calculatedTotals.reduce(
        (sum, account) => sum + account.total,
        0,
      ),
    };
  }, [filteredTransactions, accounts, accountImages]);

  useEffect(() => {
    if (selectedDateFrom) {
      setHasMoreTransactions(false);
      return;
    }

    const today = normalizeToLocalDay(new Date());
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - visibleTransactionWindowDays);

    const hasOlder = filteredTransactions.some((txn) => {
      const txnDate = normalizeToLocalDay(txn.date);
      return txnDate < cutoffDate;
    });

    setHasMoreTransactions(hasOlder);
  }, [filteredTransactions, selectedDateFrom, visibleTransactionWindowDays]);

  const loadOlderTransactions = () => {
    setVisibleTransactionWindowDays((prev) => prev + TRANSACTION_BATCH_DAYS);
  };

  const loadAllTransactions = () => {
    if (selectedDateFrom || filteredTransactions.length === 0) {
      return;
    }

    const today = normalizeToLocalDay(new Date());
    const oldestTransactionDate = filteredTransactions.reduce<Date | null>(
      (oldest, txn) => {
        const txnDate = normalizeToLocalDay(txn.date);
        if (txnDate > today) {
          return oldest;
        }

        if (!oldest || txnDate < oldest) {
          return txnDate;
        }

        return oldest;
      },
      null,
    );

    if (!oldestTransactionDate) {
      setVisibleTransactionWindowDays(TRANSACTION_BATCH_DAYS);
      return;
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const daysToOldest = Math.ceil(
      (today.getTime() - oldestTransactionDate.getTime()) / millisecondsPerDay,
    );
    setVisibleTransactionWindowDays(
      Math.max(TRANSACTION_BATCH_DAYS, daysToOldest),
    );
  };

  // Add this helper function before the return statement (after calculateAccountTotals)
  const getRecipientTransactionCount = (recipientId: number): number => {
    return filteredTransactions.filter((txn) => txn.recipientId === recipientId)
      .length;
  };

  // Add these helper functions before the return statement (after getRecipientTransactionCount):
  const getAccountsInTransactions = (): number[] => {
    const accountIds = new Set<number>();
    transactions?.forEach((txn) => {
      if (txn.accountId) {
        accountIds.add(txn.accountId);
      }
    });
    return Array.from(accountIds);
  };

  const getBucketsInTransactions = (): number[] => {
    const bucketIds = new Set<number>();
    transactions?.forEach((txn) => {
      const category = categories.find((c) => c.id === txn.categoryId);
      if (category?.bucketId) {
        bucketIds.add(category.bucketId);
      }
    });
    return Array.from(bucketIds);
  };

  const getCategoriesInTransactions = (): number[] => {
    const catIds = new Set<number>();
    transactions?.forEach((txn) => {
      catIds.add(txn.categoryId);
    });
    return Array.from(catIds);
  };

  const getRecipientsInTransactions = (): number[] => {
    const recIds = new Set<number>();
    transactions?.forEach((txn) => {
      recIds.add(txn.recipientId);
    });
    return Array.from(recIds);
  };

  useEffect(() => {
    // REMOVED: Clear payment method filter when account filter changes
    // No longer needed since payment methods are gone
  }, [selectedAccountId]);

  useEffect(() => {
    // Clear category filter when bucket filter changes
    // (to prevent showing incompatible category)
    if (selectedBucketId !== undefined) {
      setSelectedCategoryId(undefined);
    }
  }, [selectedBucketId]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Transactions</IonTitle>
          <IonButtons slot="end">
            {!transactionsReadExperimentHttpReadonly && (
              <>
                <IonButton
                  onClick={async () => {
                    try {
                      const csv = await exportTransactionsToCSV();
                      const filename = `transactions-${
                        new Date().toISOString().split("T")[0]
                      }.csv`;
                      downloadCSV(csv, filename);
                    } catch (err) {
                      console.error("Export failed:", err);
                      // Show error toast
                    }
                  }}
                  title="Export Transactions to CSV"
                >
                  <IonIcon icon={downloadOutline} />
                </IonButton>
                <IonButton
                  onClick={() => setShowImportModal(true)}
                  title="Import transactions from CSV"
                >
                  <IonIcon icon={cloudUploadOutline} />
                </IonButton>
              </>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Delete Confirmation Alert */}
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => setShowDeleteConfirm(false)}
          header="Confirm Delete"
          message={
            isTransferDelete
              ? "Are you sure you want to delete this transfer transaction? This will remove both the outgoing and incoming transactions. This action cannot be undone."
              : "Are you sure you want to delete this transaction? This action cannot be undone."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => {
                setShowDeleteConfirm(false);
                setTransactionToDelete(undefined);
                setIsTransferDelete(false);
              },
            },
            {
              text: "Delete",
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

        {successMsg && (
          <IonText color="success">
            <p
              style={{
                padding: "12px",
                backgroundColor: "var(--ion-color-success-tint)",
                borderRadius: "4px",
                marginBottom: "16px",
              }}
            >
              {successMsg}
            </p>
          </IonText>
        )}

        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}

        {transactionsReadExperimentEnabled && (
          <IonCard style={{ margin: 0, marginBottom: "16px" }}>
            <IonCardContent>
              <IonText
                color={
                  transactionsReadExperimentHttpReadonly ? "warning" : "medium"
                }
              >
                <p style={{ marginTop: 0 }}>
                  {transactionsReadExperimentHttpReadonly
                    ? "Transactions read experiment is active. List is loaded through selected-read `http-readonly`; detail, edit, delete, duplicate, transfer, import, and export actions are disabled. Switch back to Dexie to manage transactions."
                    : "Transactions read experiment flag is active with the Dexie backend. Existing Dexie behavior remains available."}
                </p>
                <p style={{ marginBottom: 0, color: "#666", fontSize: "0.85rem" }}>
                  Backend: {selectedBackend}
                  {transactionsReadExperimentHttpReadonly &&
                    transactionsReadExperimentLoad &&
                    `; loaded ${transactionsReadExperimentLoad.transactions.length} transaction rows across ${transactionsReadExperimentLoad.pagesLoaded} page(s)`}
                  {transactionsReadExperimentHttpReadonly &&
                    transactionsReadExperimentLoad?.reportedCount !== undefined &&
                    ` of ${transactionsReadExperimentLoad.reportedCount} reported`}
                  {transactionsReadExperimentHttpReadonly &&
                    transactionsReadExperimentLoad?.truncated &&
                    ". This experiment is capped; refresh the matching SQLite baseline before using this as a migration signal."}
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        )}

        {showSelectedReadPreview && (
          <SelectedReadPreviewCard
            title="Experimental selected-read Transactions preview"
            resourceLabel="Selected-read transactions"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description="This preview manually reads a tiny selected-read transaction sample. It does not replace this page, alter filters, export data, or change edit/delete/transfer behavior."
          >
            {selectedReadPreview && (
              <IonList>
                <IonItem>
                  <IonLabel>Backend / source</IonLabel>
                  <IonText slot="end">
                    {selectedReadPreview.backend} / {selectedReadPreview.source}
                  </IonText>
                </IonItem>
                <IonItem>
                  <IonLabel>Status</IonLabel>
                  <IonBadge
                    color={
                      selectedReadPreview.status === "pass"
                        ? "success"
                        : "danger"
                    }
                    slot="end"
                  >
                    {selectedReadPreview.status === "pass" ? "Pass" : "Fail"}
                  </IonBadge>
                </IonItem>
                {selectedReadPreview.errorCode && (
                  <IonItem>
                    <IonLabel>Safe error code</IonLabel>
                    <IonText slot="end">
                      {selectedReadPreview.errorCode}
                    </IonText>
                  </IonItem>
                )}
                <IonItem>
                  <IonLabel>
                    <h3>Transactions</h3>
                    <p>
                      count={selectedReadPreview.count ?? "-"} loaded=
                      {selectedReadPreview.loadedRowCount ?? "-"} sampledIds=
                      {selectedReadPreview.sampledIds?.length
                        ? selectedReadPreview.sampledIds.join(", ")
                        : "-"}
                    </p>
                  </IonLabel>
                </IonItem>
                {selectedReadPreview.rows.map((transaction) => (
                  <IonItem
                    key={`selected-transaction-${transaction.id ?? "none"}`}
                  >
                    <IonLabel>
                      <h3>transaction id={transaction.id ?? "-"}</h3>
                      <p>
                        dateDayKey={transaction.dateDayKey ?? "-"} amountSign=
                        {transaction.amountSign} hasTransactionCost=
                        {String(transaction.hasTransactionCost)} isTransfer=
                        {transaction.isTransfer === undefined
                          ? "-"
                          : String(transaction.isTransfer)}
                      </p>
                      <p>
                        categoryId={transaction.categoryId ?? "-"} accountId=
                        {transaction.accountId ?? "-"} recipientId=
                        {transaction.recipientId ?? "-"} budgetSnapshotId=
                        {transaction.budgetSnapshotId ?? "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            )}
          </SelectedReadPreviewCard>
        )}

        {!loading && transactions && transactions.length > 0 && (
          <IonCard style={{ margin: 0, marginBottom: "16px" }}>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  {accountTotals.map((account) => (
                    <IonCol
                      key={account.accountId}
                      size="2"
                      onClick={() => setSelectedAccountId(account.accountId)}
                      style={{
                        cursor: "pointer",
                        opacity:
                          selectedAccountId === account.accountId ? 1 : 0.6,
                      }}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "left",
                            gap: "4px",
                            marginBottom: "4px",
                          }}
                        >
                          {account.imageUrl && (
                            <IonAvatar
                              style={{ width: "20px", height: "20px" }}
                            >
                              <IonImg src={account.imageUrl} alt="Account" />
                            </IonAvatar>
                          )}
                          <div style={{ fontSize: "0.9rem", color: "#666" }}>
                            {account.accountName}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: "1.4rem",
                            fontWeight: "bold",
                            marginLeft: "2px",
                            textAlign: "left",
                            color: account.total < 0 ? "#eb445c" : "#009688",
                          }}
                        >
                          {account.total.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                    </IonCol>
                  ))}
                  <IonCol
                    size="4"
                    onClick={() =>
                      selectedAccountId && setSelectedAccountId(undefined)
                    }
                    style={{
                      cursor: selectedAccountId ? "pointer" : "default",
                    }}
                  >
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          color: "#666",
                          marginBottom: "4px",
                          fontWeight: "bold",
                        }}
                      >
                        {hasActiveFilters()
                          ? "Net Total (Filtered)"
                          : "Net Total"}
                      </div>
                      <div
                        style={{
                          fontSize: "1.6rem",
                          fontWeight: "bold",
                          textAlign: "right",
                          color: overallTotal < 0 ? "#eb445c" : "#009688",
                        }}
                      >
                        {overallTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        )}

        {/* Filters Accordion */}
        {!loading && transactions && transactions.length > 0 && (
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
                            const accountsWithTxns =
                              getAccountsInTransactions();
                            return (
                              a.name && accountsWithTxns.includes(a.id || 0)
                            );
                          })
                          .map((a) => ({
                            id: a.id,
                            name: a.name as string,
                          }))}
                        onIonChange={setSelectedAccountId}
                      />
                    </IonCol>
                    {/* REMOVED: Payment Method filter section */}
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
                            const recsWithTxns = getRecipientsInTransactions();
                            return r.name && recsWithTxns.includes(r.id || 0);
                          })
                          .map((r) => ({
                            id: r.id,
                            name: r.name,
                          }))
                          .sort((a, b) => {
                            const countA = getRecipientTransactionCount(
                              a.id || 0,
                            );
                            const countB = getRecipientTransactionCount(
                              b.id || 0,
                            );
                            return countB - countA;
                          })}
                        onIonChange={setSelectedRecipientId}
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
                        Bucket
                      </div>
                      <SearchableFilterSelect
                        label="Bucket"
                        placeholder="All Buckets"
                        value={selectedBucketId}
                        options={buckets
                          .filter((b) => {
                            const bucketsWithTxns = getBucketsInTransactions();
                            return (
                              b.name && bucketsWithTxns.includes(b.id || 0)
                            );
                          })
                          .map((b) => ({
                            id: b.id,
                            name: b.name as string,
                          }))}
                        onIonChange={setSelectedBucketId}
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
                        Category
                      </div>
                      <SearchableFilterSelect
                        label="Category"
                        placeholder="All Categories"
                        value={selectedCategoryId}
                        options={categories
                          .filter((c) => {
                            const catsWithTxns = getCategoriesInTransactions();

                            if (selectedBucketId !== undefined) {
                              return (
                                c.bucketId === selectedBucketId &&
                                catsWithTxns.includes(c.id || 0)
                              );
                            }

                            return c.name && catsWithTxns.includes(c.id || 0);
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

        {!loading && filteredTransactions.length === 0 && (
          <IonText>
            {hasActiveFilters()
              ? "No transactions match the selected filters."
              : "No transactions found."}
          </IonText>
        )}
        {!loading && filteredTransactions.length > 0 && (
          <>
            {groupedVisibleTransactions.map(([group, txns]) => (
              <div key={group} style={{ marginBottom: "24px" }}>
                <h3
                  className={`time-group-header ${
                    group === "Overdue" ? "overdue" : ""
                  }`}
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: "bold",
                    color: "#999",
                    margin: "16px 0 8px 0",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {group}
                </h3>
                <IonList style={{ borderRadius: "4px" }}>
                  {txns.map((txn) => (
                    <IonItem key={txn.id}>
                      <IonGrid>
                        <IonRow>
                          <IonCol size="1" className="date-column">
                            <h2>
                              <div className="date-column-weekday">
                                {new Date(txn.date)
                                  .toLocaleDateString("en-US", {
                                    weekday: "short",
                                  })
                                  .toUpperCase()}
                              </div>
                              <div className="date-column-day">
                                {new Date(txn.date).toLocaleDateString(
                                  "en-US",
                                  {
                                    day: "2-digit",
                                  },
                                )}
                              </div>
                              <div className="date-column-month">
                                {new Date(txn.date)
                                  .toLocaleDateString("en-US", {
                                    month: "short",
                                  })
                                  .toUpperCase()}
                              </div>
                            </h2>
                          </IonCol>
                          <IonCol size="7">
                            <IonRow>
                              {txn.description && (
                                <h2
                                  className="item-description clickable"
                                  onClick={() => handleView(txn.id)}
                                >
                                  <div>{txn.description}</div>
                                </h2>
                              )}
                            </IonRow>
                            <IonRow>
                              <IonCol size="1.5">
                                <IonAvatar
                                  style={{
                                    width: "40px",
                                    height: "40px",
                                    cursor: "pointer",
                                  }}
                                  title={getAccountName(txn.accountId)}
                                >
                                  {getAccountImage(txn.accountId) ? (
                                    <IonImg
                                      src={getAccountImage(txn.accountId)}
                                      alt={getAccountName(txn.accountId)}
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
                                      {getAccountName(txn.accountId).charAt(0)}
                                    </div>
                                  )}
                                </IonAvatar>
                              </IonCol>
                              <IonCol>
                                <div
                                  style={{
                                    color: "#666",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <IonIcon
                                    icon={
                                      txn.amount + (txn.transactionCost || 0) <
                                      0
                                        ? arrowUpCircle
                                        : arrowDownCircle
                                    }
                                    style={{
                                      color:
                                        txn.amount +
                                          (txn.transactionCost || 0) <
                                        0
                                          ? "#eb445c"
                                          : "#009688",
                                      fontSize: "1.2rem",
                                    }}
                                  />
                                  {getRecipientName(txn.recipientId)}
                                </div>
                                <div>
                                  {getBucketName(txn.categoryId) && (
                                    <IonChip
                                      color="secondary"
                                      style={{
                                        fontSize: "0.75rem",
                                        height: "22px",
                                      }}
                                    >
                                      <IonLabel>
                                        {getBucketName(txn.categoryId)}
                                      </IonLabel>
                                    </IonChip>
                                  )}
                                  <IonChip
                                    color="primary"
                                    style={{
                                      fontSize: "0.85rem",
                                      height: "24px",
                                    }}
                                  >
                                    <IonLabel>
                                      {getCategoryName(txn.categoryId)}
                                    </IonLabel>
                                  </IonChip>
                                </div>
                              </IonCol>
                            </IonRow>
                          </IonCol>

                          <IonCol size="4" style={{ textAlign: "right" }}>
                            <div
                              className={`item-amount ${
                                txn.amount + (txn.transactionCost || 0) < 0
                                  ? "expense"
                                  : "income"
                              }`}
                              style={{ textAlign: "right" }}
                            >
                              {(
                                txn.amount + (txn.transactionCost || 0)
                              ).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <p style={{ margin: "0" }}>&nbsp;</p>
                            {/* Edit/Delete buttons */}
                            {!transactionsReadExperimentHttpReadonly && (
                              <IonRow className="item-actions">
                                <IonCol className="item-actions-container">
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    onClick={() => handleDuplicate(txn)}
                                    title="Duplicate Transaction"
                                  >
                                    <IonIcon slot="end" icon={copyOutline} />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    onClick={() => handleEdit(txn.id)}
                                    title="Edit Transaction"
                                  >
                                    <IonIcon slot="end" icon={createOutline} />
                                  </IonButton>
                                  <IonButton
                                    fill="clear"
                                    size="small"
                                    style={{ marginRight: "0" }}
                                    color="danger"
                                    onClick={() => handleDeleteClick(txn.id)}
                                    title="Delete Transaction"
                                  >
                                    <IonIcon slot="end" icon={trashOutline} />
                                  </IonButton>
                                </IonCol>
                              </IonRow>
                            )}
                          </IonCol>
                        </IonRow>
                      </IonGrid>
                    </IonItem>
                  ))}
                </IonList>
              </div>
            ))}

            {!selectedDateFrom && (
              <div style={{ padding: "16px 0 32px" }}>
                {hasMoreTransactions ? (
                  <>
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={loadOlderTransactions}
                    >
                      <IonIcon slot="start" icon={arrowDownCircle} />
                      Load 30 More Days
                    </IonButton>
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={loadAllTransactions}
                      style={{ marginTop: "8px" }}
                    >
                      <IonIcon slot="start" icon={downloadOutline} />
                      Load All Transactions
                    </IonButton>
                  </>
                ) : (
                  filteredTransactions.length > 0 && (
                    <IonText color="medium">
                      <p style={{ textAlign: "center", fontSize: "0.85rem" }}>
                        All transactions loaded
                      </p>
                    </IonText>
                  )
                )}
              </div>
            )}
          </>
        )}

        {!transactionsReadExperimentHttpReadonly && (
          <ImportModal
            isOpen={showImportModal}
            onDidDismiss={() => setShowImportModal(false)}
            onImportComplete={() => {
              setShowImportModal(false);
              // Reload transactions
              window.location.reload();
            }}
          />
        )}
      </IonContent>

      {/* FAB BUTTON FOR ADDING TRANSACTIONS */}
      {!transactionsReadExperimentHttpReadonly && (
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            onClick={() => history.push("/add")}
            title="Add Transaction"
          >
            <IonIcon icon={addOutline} />
          </IonFabButton>
        </IonFab>
      )}
    </IonPage>
  );
};

export default Transactions;

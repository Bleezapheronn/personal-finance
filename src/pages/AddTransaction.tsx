import React, { useEffect, useState } from "react";
import { useHistory, useLocation, useParams } from "react-router-dom";
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
  Budget,
  BudgetSnapshot,
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
import { SmsImportModal } from "../components/SmsImportModal";
import { SqliteAuthorityToolbarStatus } from "../components/SqliteAuthorityRehearsalBanner";
import { ParsedSmsData } from "../hooks/useSmsParser";
import { SearchableFilterSelect } from "../components/SearchableFilterSelect";
import { SelectableDropdown } from "../components/SelectableDropdown";
import {
  assertValidTransferPairPatches,
  assertValidTransferPairRows,
  resolveTransferPairEditLinks,
} from "../utils/transferPairs";
import type { DuplicateTransactionPrefill } from "../utils/transactionDuplicate";
import {
  accountRepository,
  categoryRepository,
  recipientRepository,
  smsImportTemplateRepository,
} from "../repositories";
import {
  getRepositoryBackend,
  isHttpSelectedReadRepositoryBackend,
  isSqliteAuthorityControlledBackend,
} from "../repositories/adapterSelection";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import type {
  AccountDto,
  ApiListResponse,
  BudgetDto,
  BudgetSnapshotDto,
  BucketDto,
  CategoryDto,
  RecipientDto,
  TransactionDto,
} from "../repositories/http/types";
import {
  createBasicTransactionInDisposableSqlite,
  isCostBudgetTransactionWriteEligible,
  isBasicTransactionWriteEligible,
  isTransactionsBasicWriteExperimentEnabled,
  isTransactionsCostBudgetWriteExperimentEnabled,
  transactionBasicWriteErrorCode,
  updateBasicTransactionInDisposableSqlite,
  type BasicTransactionWriteInput,
} from "../repositories/http/transactionBasicWriteExperiment";
import {
  createTransferInDisposableSqlite,
  isTransactionsTransferWriteExperimentEnabled,
  transactionTransferWriteErrorCode,
  updateTransferInDisposableSqlite,
  type TransferWriteInput,
} from "../repositories/http/transactionTransferWriteExperiment";

interface AddTransactionLocationState {
  duplicatePrefill?: DuplicateTransactionPrefill;
}

type TransferContentPayload = Omit<Transaction, "id" | "transferPairId">;
type TransferUpdatePatch = TransferContentPayload & { transferPairId: number };

const selectedRows = <Row,>(
  result: Row[] | ApiListResponse<Row>,
): Row[] => (Array.isArray(result) ? result : result.rows);

const SELECTED_BUDGET_PAGE_SIZE = 200;
const SELECTED_BUDGET_ROW_LIMIT = 5000;

const loadSelectedPages = async <Row,>(
  list: (options: {
    limit: number;
    offset: number;
  }) => Promise<Row[] | ApiListResponse<Row>>,
): Promise<Row[]> => {
  const rows: Row[] = [];
  while (rows.length < SELECTED_BUDGET_ROW_LIMIT) {
    const limit = Math.min(
      SELECTED_BUDGET_PAGE_SIZE,
      SELECTED_BUDGET_ROW_LIMIT - rows.length,
    );
    const result = await list({ limit, offset: rows.length });
    const page = selectedRows(result);
    rows.push(...page);
    const count = Array.isArray(result) ? undefined : result.count;
    if (
      page.length < limit ||
      page.length === 0 ||
      (typeof count === "number" && rows.length >= count)
    ) {
      break;
    }
  }
  return rows;
};

const selectedBoolean = (value: boolean | number): boolean =>
  value === true || value === 1;

const selectedDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const normalizeSelectedAccount = (account: Account | AccountDto): Account => ({
  id: account.id,
  name: account.name,
  description: account.description ?? undefined,
  currency: account.currency ?? undefined,
  isActive: selectedBoolean(account.isActive),
  isCredit: selectedBoolean(account.isCredit),
  creditLimit: account.creditLimit ?? undefined,
  createdAt: selectedDate(account.createdAt),
  updatedAt: selectedDate(account.updatedAt),
});

const normalizeSelectedBucket = (bucket: Bucket | BucketDto): Bucket => ({
  id: bucket.id,
  name: bucket.name ?? undefined,
  description: bucket.description ?? undefined,
  minPercentage: bucket.minPercentage,
  maxPercentage: bucket.maxPercentage,
  minFixedAmount: bucket.minFixedAmount ?? undefined,
  isActive: selectedBoolean(bucket.isActive),
  displayOrder: bucket.displayOrder,
  excludeFromReports: selectedBoolean(bucket.excludeFromReports),
  createdAt: selectedDate(bucket.createdAt),
  updatedAt: selectedDate(bucket.updatedAt),
});

const normalizeSelectedCategory = (
  category: Category | CategoryDto,
): Category => ({
  id: category.id,
  name: category.name ?? undefined,
  bucketId: category.bucketId,
  description: category.description ?? undefined,
  isActive: selectedBoolean(category.isActive),
  createdAt: selectedDate(category.createdAt),
  updatedAt: selectedDate(category.updatedAt),
});

const normalizeSelectedRecipient = (
  recipient: Recipient | RecipientDto,
): Recipient => ({
  id: recipient.id,
  name: recipient.name,
  aliases: recipient.aliases ?? undefined,
  email: recipient.email ?? undefined,
  phone: recipient.phone ?? undefined,
  tillNumber: recipient.tillNumber ?? undefined,
  paybill: recipient.paybill ?? undefined,
  accountNumber: recipient.accountNumber ?? undefined,
  description: recipient.description ?? undefined,
  isActive: selectedBoolean(recipient.isActive),
  createdAt: selectedDate(recipient.createdAt),
  updatedAt: selectedDate(recipient.updatedAt),
});

const normalizeSelectedTransaction = (
  transaction: Transaction | TransactionDto,
): Transaction => ({
  id: transaction.id,
  categoryId: transaction.categoryId,
  paymentChannelId: transaction.paymentChannelId ?? undefined,
  accountId: transaction.accountId ?? undefined,
  recipientId: transaction.recipientId,
  date: selectedDate(transaction.date),
  amount: transaction.amount,
  originalAmount: transaction.originalAmount ?? undefined,
  originalCurrency: transaction.originalCurrency ?? undefined,
  exchangeRate: transaction.exchangeRate ?? undefined,
  transactionReference: transaction.transactionReference ?? undefined,
  transactionCost: transaction.transactionCost ?? undefined,
  description: transaction.description ?? undefined,
  transferPairId: transaction.transferPairId ?? undefined,
  isTransfer:
    transaction.isTransfer == null
      ? undefined
      : selectedBoolean(transaction.isTransfer),
  budgetId: transaction.budgetId ?? undefined,
  occurrenceDate:
    transaction.occurrenceDate == null
      ? undefined
      : selectedDate(transaction.occurrenceDate),
  budgetSnapshotId: transaction.budgetSnapshotId ?? undefined,
});

const normalizeSelectedBudget = (budget: Budget | BudgetDto): Budget => ({
  id: budget.id,
  description: budget.description,
  categoryId: budget.categoryId,
  paymentChannelId: budget.paymentChannelId ?? undefined,
  accountId: budget.accountId ?? undefined,
  recipientId: budget.recipientId ?? undefined,
  amount: budget.amount,
  transactionCost: budget.transactionCost ?? undefined,
  frequency: budget.frequency,
  frequencyDetails:
    typeof budget.frequencyDetails === "string"
      ? undefined
      : (budget.frequencyDetails ?? undefined),
  isGoal: selectedBoolean(budget.isGoal),
  isFlexible: selectedBoolean(budget.isFlexible),
  goalPercentage: budget.goalPercentage ?? undefined,
  goalDirection: budget.goalDirection ?? undefined,
  isActive: selectedBoolean(budget.isActive),
  remainingCyclesTotal: budget.remainingCyclesTotal ?? undefined,
  dueDate: selectedDate(budget.dueDate),
  createdAt: selectedDate(budget.createdAt),
  updatedAt: selectedDate(budget.updatedAt),
});

const normalizeSelectedBudgetSnapshot = (
  snapshot: BudgetSnapshot | BudgetSnapshotDto,
): BudgetSnapshot => ({
  id: snapshot.id,
  budgetId: snapshot.budgetId,
  occurrenceDate: selectedDate(snapshot.occurrenceDate),
  dueDate: selectedDate(snapshot.dueDate),
  cycleIndex: snapshot.cycleIndex,
  description: snapshot.description,
  categoryId: snapshot.categoryId,
  accountId: snapshot.accountId ?? undefined,
  recipientId: snapshot.recipientId ?? undefined,
  amount: snapshot.amount,
  transactionCost: snapshot.transactionCost ?? undefined,
  frequency: snapshot.frequency,
  frequencyDetails:
    typeof snapshot.frequencyDetails === "string"
      ? undefined
      : (snapshot.frequencyDetails ?? undefined),
  isGoal: selectedBoolean(snapshot.isGoal),
  isFlexible: selectedBoolean(snapshot.isFlexible),
  goalPercentage: snapshot.goalPercentage ?? undefined,
  goalDirection: snapshot.goalDirection ?? undefined,
  remainingCyclesTotal: snapshot.remainingCyclesTotal ?? undefined,
  isHistorical: selectedBoolean(snapshot.isHistorical),
  sourceBudgetUpdatedAt: selectedDate(snapshot.sourceBudgetUpdatedAt),
  createdAt: selectedDate(snapshot.createdAt),
  updatedAt: selectedDate(snapshot.updatedAt),
});

const AddTransaction: React.FC = () => {
  const history = useHistory();
  const location = useLocation<AddTransactionLocationState>();
  const { id } = useParams<{ id?: string }>();
  const isEditMode = Boolean(id);
  const duplicatePrefill = location.state?.duplicatePrefill;
  const selectedBackend = getRepositoryBackend();
  const rehearsal = useSqliteAuthorityRehearsal();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(selectedBackend);
  const transactionsBasicWriteExperimentEnabled =
    isTransactionsBasicWriteExperimentEnabled();
  const transactionsCostBudgetWriteExperimentEnabled =
    isTransactionsCostBudgetWriteExperimentEnabled();
  const transactionsTransferWriteExperimentEnabled =
    isTransactionsTransferWriteExperimentEnabled();
  const transactionsSqliteWriteExperimentActive =
    (selectedBackend === "http-readonly" &&
      transactionsBasicWriteExperimentEnabled) ||
    (rehearsalSelected && rehearsal.ready);
  const transactionsHttpBackendSelected =
    isHttpSelectedReadRepositoryBackend(selectedBackend);
  const transactionsCostBudgetWriteExperimentActive =
    transactionsSqliteWriteExperimentActive &&
    (transactionsCostBudgetWriteExperimentEnabled || rehearsalSelected);
  const transactionsTransferWriteExperimentActive =
    transactionsSqliteWriteExperimentActive &&
    (transactionsTransferWriteExperimentEnabled || rehearsalSelected);

  // Combined date and time into single datetime state
  const [transactionDateTime, setTransactionDateTime] = useState<string>("");

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

  const [accountId, setAccountId] = useState<number | undefined>(undefined);

  const [recipientId, setRecipientId] = useState<number | undefined>(undefined);
  const [description, setDescription] = useState("");

  // Transfer-specific state
  const [transferToAccountId, setTransferToAccountId] = useState<
    number | undefined
  >(undefined);
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);
  const [editingTransferEligible, setEditingTransferEligible] = useState(false);
  const [transferRecipientId, setTransferRecipientId] = useState<
    number | undefined
  >(undefined);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [sortedCategories, setSortedCategories] = useState<Category[]>([]);
  const [sortedAccounts, setSortedAccounts] = useState<Account[]>([]);
  const [sortedRecipients, setSortedRecipients] = useState<Recipient[]>([]);
  const [smsTemplates, setSmsTemplates] = useState<SmsImportTemplate[]>([]);
  const [selectedBudgets, setSelectedBudgets] = useState<Budget[]>([]);
  const [selectedBudgetSnapshots, setSelectedBudgetSnapshots] = useState<
    BudgetSnapshot[]
  >([]);
  const [budgetSnapshotId, setBudgetSnapshotId] = useState<
    number | undefined
  >(undefined);
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);

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
      sortedAccounts
        .map((a) => a.currency)
        .filter((c): c is string => Boolean(c)),
    ),
  );

  // Clear messages and reset form when entering the page
  useIonViewWillEnter(() => {
    setErrorMsg("");
    setSuccessMsg("");
    setFieldErrors({});
  });

  // Auto-calculate exchange rate when amount and original amount change
  useEffect(() => {
    if (exchangeRateOverride) return;

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
      if (transactionsHttpBackendSelected) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const [
          bucketResult,
          categoryResult,
          accountResult,
          recipientResult,
          budgetRows,
          snapshotRows,
        ] = await Promise.all([
          repositories.buckets.list({ limit: 5000 }),
          repositories.categories.list({ limit: 5000 }),
          repositories.accounts.list({ limit: 5000 }),
          repositories.recipients.list({ limit: 5000 }),
          transactionsCostBudgetWriteExperimentActive
            ? loadSelectedPages<Budget | BudgetDto>((options) =>
                repositories.budgets.list(options),
              )
            : Promise.resolve([]),
          transactionsCostBudgetWriteExperimentActive
            ? loadSelectedPages<BudgetSnapshot | BudgetSnapshotDto>((options) =>
                repositories.budgetSnapshots.list(options),
              )
            : Promise.resolve([]),
        ]);
        const selectedBuckets = selectedRows<Bucket | BucketDto>(
          bucketResult,
        ).map(normalizeSelectedBucket);
        const selectedCategories = selectedRows<Category | CategoryDto>(
          categoryResult,
        ).map(normalizeSelectedCategory);
        const selectedAccounts = selectedRows<Account | AccountDto>(
          accountResult,
        ).map(normalizeSelectedAccount);
        const selectedRecipients = selectedRows<Recipient | RecipientDto>(
          recipientResult,
        ).map(normalizeSelectedRecipient);

        const activeAccounts = isEditMode
          ? selectedAccounts
          : selectedAccounts.filter((account) => account.isActive !== false);
        const activeBuckets = isEditMode
          ? selectedBuckets
          : selectedBuckets.filter((bucket) => bucket.isActive !== false);
        const activeCategories = isEditMode
          ? selectedCategories
          : selectedCategories.filter((category) => {
              const bucket = selectedBuckets.find(
                (candidate) => candidate.id === category.bucketId,
              );
              return (
                category.isActive !== false && bucket?.isActive !== false
              );
            });
        const activeRecipients = isEditMode
          ? selectedRecipients
          : selectedRecipients.filter(
              (recipient) => recipient.isActive !== false,
            );

        setBuckets(activeBuckets);
        setSortedCategories(activeCategories);
        setSortedAccounts(activeAccounts);
        setSortedRecipients(activeRecipients);
        setSmsTemplates([]);
        setSelectedBudgets(budgetRows.map(normalizeSelectedBudget));
        setSelectedBudgetSnapshots(
          snapshotRows.map(normalizeSelectedBudgetSnapshot),
        );
        return;
      }

      const [b, c, a, r, allTemplates] = await Promise.all([
        categoryRepository.listBuckets(),
        categoryRepository.listCategories(),
        accountRepository.listAccounts(),
        recipientRepository.listRecipients(),
        smsImportTemplateRepository.listTemplates(),
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
        : c.filter((cat) => {
            const bucket = b.find((bucket) => bucket.id === cat.bucketId);
            return cat.isActive !== false && bucket?.isActive !== false;
          });

      const activeRecipients = isEditMode
        ? r
        : r.filter((rec) => rec.isActive !== false);

      setBuckets(activeBuckets);
      setSortedAccounts(activeAccounts);
      setSmsTemplates(allTemplates.filter((t) => t.isActive !== false));

      const transactions = await db.transactions.toArray();

      // Count transactions per recipient
      const recipientCounts = new Map<number, number>();
      transactions.forEach((txn) => {
        const count = recipientCounts.get(txn.recipientId) || 0;
        recipientCounts.set(txn.recipientId, count + 1);
      });
      const sortedRecips = [...activeRecipients].sort((a, b) => {
        const countA = recipientCounts.get(a.id!) || 0;
        const countB = recipientCounts.get(b.id!) || 0;
        return countB - countA;
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
        return countB - countA;
      });
      setSortedCategories(sortedCats);
    } catch (err) {
      console.error("Failed to load lookup data:", err);
    }
  };

  // Load transaction data in edit mode OR clear form in add mode when id changes
  useEffect(() => {
    if (isEditMode && id) {
      const loadTransaction = async () => {
        try {
          const selectedTransaction = transactionsHttpBackendSelected
              ? await getSelectedReadRepositories(
                selectedBackend,
              ).transactions.getById(Number(id))
            : await db.transactions.get(Number(id));
          const txn = selectedTransaction
            ? normalizeSelectedTransaction(selectedTransaction)
            : undefined;

          if (txn) {
            setEditingTransaction(txn);
            setEditingTransferEligible(false);
            let transferPairForForm: Transaction | undefined;

            if (
              transactionsHttpBackendSelected &&
              !transactionsCostBudgetWriteExperimentActive &&
              !(
                transactionsTransferWriteExperimentActive &&
                txn.isTransfer
              ) &&
              !isBasicTransactionWriteEligible(txn)
            ) {
              setErrorMsg(
                "This transaction is not eligible for the basic SQLite write experiment.",
              );
            }

            // Check if this is a transfer transaction
            if (txn.isTransfer && txn.transferPairId) {
              setTransactionType("transfer");
              const pairedSelectedTransaction =
                transactionsHttpBackendSelected
                  ? await getSelectedReadRepositories(
                      selectedBackend,
                    ).transactions.getById(txn.transferPairId)
                  : await db.transactions.get(txn.transferPairId);
              const pairedTxn = pairedSelectedTransaction
                ? normalizeSelectedTransaction(pairedSelectedTransaction)
                : undefined;
              transferPairForForm = pairedTxn;
              if (pairedTxn) {
                try {
                  const links = resolveTransferPairEditLinks(txn, pairedTxn);
                  assertValidTransferPairRows(
                    links.outgoingTransactionId,
                    txn.amount < 0 ? txn : pairedTxn,
                    links.incomingTransactionId,
                    txn.amount < 0 ? pairedTxn : txn,
                  );
                  setEditingTransferEligible(true);
                } catch {
                  setEditingTransferEligible(false);
                }
              }

              // Determine which is outgoing and which is incoming
              if (txn.amount < 0) {
                // This is the outgoing transaction
                setAccountId(txn.accountId);
                setTransferToAccountId(pairedTxn?.accountId);
                setRecipientId(txn.recipientId);
                setTransferRecipientId(pairedTxn?.recipientId);
              } else {
                // This is the incoming transaction
                setAccountId(pairedTxn?.accountId);
                setTransferToAccountId(txn.accountId);
                setRecipientId(pairedTxn?.recipientId);
                setTransferRecipientId(txn.recipientId);
              }

              setCategoryId(txn.categoryId);
            } else {
              setTransactionType(txn.amount < 0 ? "expense" : "income");
              setCategoryId(txn.categoryId);
              setAccountId(txn.accountId);
              setRecipientId(txn.recipientId);
            }

            // Format datetime for datetime-local input
            const txnDate = new Date(txn.date);
            const year = txnDate.getFullYear();
            const month = String(txnDate.getMonth() + 1).padStart(2, "0");
            const day = String(txnDate.getDate()).padStart(2, "0");
            const hours = String(txnDate.getHours()).padStart(2, "0");
            const minutes = String(txnDate.getMinutes()).padStart(2, "0");
            setTransactionDateTime(
              `${year}-${month}-${day}T${hours}:${minutes}`,
            );

            setAmount(Math.abs(txn.amount).toString());
            setTransactionCost(
              txn.isTransfer &&
                transferPairForForm &&
                transactionsHttpBackendSelected
                ? Math.abs(
                    Number(
                      (txn.amount < 0 ? txn : transferPairForForm)
                        .transactionCost ?? 0,
                    ),
                  ).toString().replace(/^0$/, "")
                : txn.transactionCost
                  ? Math.abs(txn.transactionCost).toString()
                : "",
            );
            setTransactionReference(txn.transactionReference || "");
            setOriginalAmount(
              txn.originalAmount ? Math.abs(txn.originalAmount).toString() : "",
            );
            setOriginalCurrency(txn.originalCurrency || "");
            setExchangeRate(txn.exchangeRate?.toString() || "");
            setExchangeRateOverride(!!txn.exchangeRate);
            setDescription(txn.description || "");
            setBudgetSnapshotId(txn.budgetSnapshotId);
          }
        } catch (err) {
          console.error("Failed to load transaction:", err);
          setErrorMsg("Failed to load transaction for editing");
        }
      };

      loadTransaction();
    } else if (duplicatePrefill) {
      // ADD MODE + DUPLICATE PREFILL
      setTransactionDateTime("");
      setTransactionType(duplicatePrefill.transactionType);
      setAmount(duplicatePrefill.amount);
      setTransactionCost(duplicatePrefill.transactionCost);
      setTransactionReference("");
      setOriginalAmount(duplicatePrefill.originalAmount);
      setOriginalCurrency(duplicatePrefill.originalCurrency);
      setExchangeRate(duplicatePrefill.exchangeRate);
      setExchangeRateOverride(duplicatePrefill.exchangeRateOverride);
      setCategoryId(duplicatePrefill.categoryId);
      setAccountId(duplicatePrefill.accountId);
      setRecipientId(duplicatePrefill.recipientId);
      setTransferRecipientId(duplicatePrefill.transferRecipientId);
      setTransferToAccountId(duplicatePrefill.transferToAccountId);
      setDescription(duplicatePrefill.description);
      setBudgetSnapshotId(undefined);
      setEditingTransaction(null);
      setEditingTransferEligible(false);
    } else {
      // ADD MODE: Clear form
      setTransactionDateTime("");
      setTransactionType("expense");
      setAmount("");
      setTransactionCost("");
      setTransactionReference("");
      setOriginalAmount("");
      setOriginalCurrency("");
      setExchangeRate("");
      setExchangeRateOverride(false);
      setCategoryId(undefined);
      setAccountId(undefined);
      setRecipientId(undefined);
      setTransferRecipientId(undefined);
      setTransferToAccountId(undefined);
      setDescription("");
      setBudgetSnapshotId(undefined);
      setEditingTransaction(null);
      setEditingTransferEligible(false);
    }
  }, [
    duplicatePrefill,
    id,
    isEditMode,
    transactionsCostBudgetWriteExperimentActive,
    transactionsHttpBackendSelected,
  ]);

  // Load descriptions sorted by frequency when component mounts
  useEffect(() => {
    let isMounted = true;

    const loadDescriptions = async () => {
      if (transactionsHttpBackendSelected) {
        if (isMounted) {
          setDescriptionSuggestions([]);
        }
        return;
      }

      const transactions = await db.transactions.toArray();

      const descriptionCounts = new Map<string, number>();
      transactions.forEach((txn) => {
        if (txn.description) {
          const count = descriptionCounts.get(txn.description) || 0;
          descriptionCounts.set(txn.description, count + 1);
        }
      });

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
  }, [transactionsHttpBackendSelected]);

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

    // UPDATED: Validation now uses accountId instead of paymentMethodId
    const formValidation = validateTransactionForm({
      selectedDate: transactionDateTime
        ? transactionDateTime.split("T")[0]
        : "",
      selectedTime: transactionDateTime
        ? transactionDateTime.split("T")[1]
        : "",
      amount,
      description,
      categoryId,
      accountId, // CHANGED from paymentMethodId
      recipientId,
      transferRecipientId,
      transferToAccountId, // CHANGED from transferToPaymentMethodId
      transactionType,
    });

    if (!formValidation.isValid) {
      setFieldErrors(formValidation.errors);
      setErrorMsg(
        formValidation.errorMessage || "Please fill in all required fields.",
      );
      return;
    }

    // Validate date/time
    const dateTimeValidation = validateDateTime(transactionDateTime);
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

    // Parse datetime directly from transactionDateTime
    const selectedDateTime = new Date(transactionDateTime);
    const numericAmountRaw = parseFloat(amount);

    const parsedCost = transactionCost ? parseFloat(transactionCost) : NaN;
    const numericCost = !isNaN(parsedCost) ? -Math.abs(parsedCost) : undefined;

    const numericOriginalAmountRaw = originalAmount
      ? parseFloat(originalAmount)
      : undefined;

    const txReference = transactionReference.trim() || undefined;
    const origCurrency = originalCurrency.trim() || undefined;

    const numericExchangeRate = exchangeRate
      ? parseFloat(exchangeRate)
      : undefined;

    let sqliteWriteConfirmed = false;

    try {
      if (transactionsHttpBackendSelected) {
        if (!transactionsSqliteWriteExperimentActive) {
          setErrorMsg(
            "Transaction writes are disabled for the selected HTTP backend.",
          );
          return;
        }
        if (transactionType === "transfer") {
          if (!transactionsTransferWriteExperimentActive) {
            setErrorMsg(
              "Transfers are not enabled for the SQLite write experiment.",
            );
            return;
          }
          if (isEditMode && !editingTransferEligible) {
            setErrorMsg(
              "This transfer pair is malformed or ambiguous and remains read-only.",
            );
            return;
          }
          const transferInput: TransferWriteInput = {
            sourceAccountId: accountId!,
            destinationAccountId: transferToAccountId!,
            sourceRecipientId: recipientId!,
            destinationRecipientId: transferRecipientId!,
            date: selectedDateTime.toISOString(),
            amount: Math.abs(numericAmountRaw),
            transactionCost: numericCost ?? null,
            originalAmount:
              numericOriginalAmountRaw == null
                ? null
                : Math.abs(numericOriginalAmountRaw),
            originalCurrency: origCurrency,
            exchangeRate: numericExchangeRate,
            transactionReference: txReference,
            categoryId: categoryId!,
            description,
          };
          const response =
            isEditMode && id
              ? await updateTransferInDisposableSqlite(
                  Number(id),
                  transferInput,
                )
              : await createTransferInDisposableSqlite(transferInput);
          sqliteWriteConfirmed = true;
          const sourceId = response.sourceTransactionId;
          const destinationId = response.destinationTransactionId;
          if (
            typeof sourceId !== "number" ||
            typeof destinationId !== "number"
          ) {
            throw new Error("transaction_write_refresh_failed");
          }
          const repository = getSelectedReadRepositories(
            "http-readonly",
          ).transactions;
          const [sourceResult, destinationResult] = await Promise.all([
            repository.getById(sourceId),
            repository.getById(destinationId),
          ]);
          if (!sourceResult || !destinationResult) {
            throw new Error("transaction_write_refresh_failed");
          }
          const source = normalizeSelectedTransaction(sourceResult);
          const destination = normalizeSelectedTransaction(destinationResult);
          assertValidTransferPairRows(
            sourceId,
            source,
            destinationId,
            destination,
          );
          setSuccessToastMessage(
            isEditMode
              ? "Disposable SQLite transfer pair updated."
              : "Disposable SQLite transfer pair created.",
          );
          setShowSuccessToast(true);
          setTimeout(() => {
            history.push("/transactions");
          }, 500);
          return;
        }
        if (
          !transactionsCostBudgetWriteExperimentActive &&
          transactionCost.trim() !== ""
        ) {
          setErrorMsg(
            "Transaction costs are not supported by the basic SQLite write experiment.",
          );
          return;
        }
        const costBudgetEditEligible =
          !isEditMode ||
          (editingTransaction !== null &&
            isCostBudgetTransactionWriteEligible(
              editingTransaction,
              selectedBudgetSnapshots,
              selectedBudgets,
            ));
        if (
          isEditMode &&
          (!editingTransaction ||
            (transactionsCostBudgetWriteExperimentActive
              ? !costBudgetEditEligible
              : !isBasicTransactionWriteEligible(editingTransaction)))
        ) {
          setErrorMsg(
            transactionsCostBudgetWriteExperimentActive
              ? "This transaction has unsupported or inconsistent cost or budget linkage and remains read-only."
              : "This transaction is not eligible for the basic SQLite write experiment.",
          );
          return;
        }

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
        const selectedSnapshot =
          budgetSnapshotId === undefined
            ? undefined
            : selectedBudgetSnapshots.find(
                (snapshot) => snapshot.id === budgetSnapshotId,
              );
        if (
          transactionsCostBudgetWriteExperimentActive &&
          budgetSnapshotId !== undefined &&
          !selectedSnapshot
        ) {
          setErrorMsg("The selected budget snapshot is unavailable.");
          return;
        }
        const input: BasicTransactionWriteInput = {
          classification: transactionType,
          date: selectedDateTime.toISOString(),
          amount: numericAmount,
          originalAmount: numericOriginalAmount,
          originalCurrency: origCurrency,
          exchangeRate: numericExchangeRate,
          transactionReference: txReference,
          categoryId: categoryId!,
          accountId: accountId!,
          recipientId: recipientId!,
          description,
          transactionCost: transactionsCostBudgetWriteExperimentActive
            ? (numericCost ?? null)
            : null,
          ...(transactionsCostBudgetWriteExperimentActive
            ? {
                budgetSnapshotId: selectedSnapshot?.id ?? null,
                budgetId: selectedSnapshot?.budgetId ?? null,
                occurrenceDate:
                  selectedSnapshot?.dueDate.toISOString() ?? null,
              }
            : {}),
        };
        const response =
          isEditMode && id
            ? await updateBasicTransactionInDisposableSqlite(
                Number(id),
                input,
              )
            : await createBasicTransactionInDisposableSqlite(input);
        sqliteWriteConfirmed = true;

        const targetId = response.targetId;
        if (typeof targetId !== "number") {
          throw new Error("transaction_write_refresh_failed");
        }
        const refreshed = await getSelectedReadRepositories(
          "http-readonly",
        ).transactions.getById(targetId);
        if (!refreshed) {
          throw new Error("transaction_write_refresh_failed");
        }

        setSuccessToastMessage(
          isEditMode
            ? "Disposable SQLite transaction updated."
            : "Disposable SQLite transaction created.",
        );
        setShowSuccessToast(true);
        setTimeout(() => {
          history.push("/transactions");
        }, 500);
        return;
      }

      if (transactionType === "transfer") {
        // Outgoing transaction
        const outgoingTx: TransferContentPayload = {
          date: selectedDateTime,
          amount: -Math.abs(numericAmountRaw),
          transactionCost: numericCost,
          originalAmount: numericOriginalAmountRaw
            ? -Math.abs(numericOriginalAmountRaw)
            : undefined,
          originalCurrency: origCurrency,
          exchangeRate: numericExchangeRate,
          transactionReference: txReference,
          categoryId: categoryId!,
          accountId: accountId!, // CHANGED from paymentChannelId
          recipientId: recipientId!,
          description: description || undefined,
          isTransfer: true,
        };

        // Incoming transaction
        const incomingTx: TransferContentPayload = {
          date: selectedDateTime,
          amount: Math.abs(numericAmountRaw),
          transactionCost: undefined,
          originalAmount: numericOriginalAmountRaw
            ? Math.abs(numericOriginalAmountRaw)
            : undefined,
          originalCurrency: origCurrency,
          exchangeRate: numericExchangeRate,
          transactionReference: txReference,
          categoryId: categoryId!,
          accountId: transferToAccountId!, // CHANGED from paymentChannelId
          recipientId: transferRecipientId!,
          description: description || undefined,
          isTransfer: true,
        };

        if (isEditMode) {
          if (!editingTransaction?.id) {
            throw new Error(
              "Transfer edit failed: the edited transaction could not be loaded.",
            );
          }

          const pairedTransaction =
            editingTransaction.transferPairId === undefined
              ? undefined
              : await db.transactions.get(editingTransaction.transferPairId);
          const transferPairLinks = resolveTransferPairEditLinks(
            editingTransaction,
            pairedTransaction,
          );
          const outgoingPatch: TransferUpdatePatch = {
            ...outgoingTx,
            transferPairId: transferPairLinks.incomingTransactionId,
          };
          const incomingPatch: TransferUpdatePatch = {
            ...incomingTx,
            transferPairId: transferPairLinks.outgoingTransactionId,
          };

          assertValidTransferPairPatches(
            transferPairLinks.outgoingTransactionId,
            outgoingPatch,
            transferPairLinks.incomingTransactionId,
            incomingPatch,
          );

          await db.transaction("rw", db.transactions, async () => {
            await db.transactions.update(
              transferPairLinks.outgoingTransactionId,
              outgoingPatch,
            );
            await db.transactions.update(
              transferPairLinks.incomingTransactionId,
              incomingPatch,
            );

            const savedOutgoing = await db.transactions.get(
              transferPairLinks.outgoingTransactionId,
            );
            const savedIncoming = await db.transactions.get(
              transferPairLinks.incomingTransactionId,
            );

            assertValidTransferPairRows(
              transferPairLinks.outgoingTransactionId,
              savedOutgoing,
              transferPairLinks.incomingTransactionId,
              savedIncoming,
            );
          });

          setSuccessToastMessage("Transfer transaction updated successfully!");
          setShowSuccessToast(true);
        } else {
          await db.transaction("rw", db.transactions, async () => {
            const outgoingId = await db.transactions.add(outgoingTx);
            const incomingId = await db.transactions.add(incomingTx);
            const outgoingPairPatch = {
              amount: outgoingTx.amount,
              transferPairId: incomingId,
            };
            const incomingPairPatch = {
              amount: incomingTx.amount,
              transferPairId: outgoingId,
            };

            assertValidTransferPairPatches(
              outgoingId,
              outgoingPairPatch,
              incomingId,
              incomingPairPatch,
            );

            await db.transactions.update(outgoingId, {
              transferPairId: outgoingPairPatch.transferPairId,
            });
            await db.transactions.update(incomingId, {
              transferPairId: incomingPairPatch.transferPairId,
            });

            const savedOutgoing = await db.transactions.get(outgoingId);
            const savedIncoming = await db.transactions.get(incomingId);

            assertValidTransferPairRows(
              outgoingId,
              savedOutgoing,
              incomingId,
              savedIncoming,
            );
          });

          setSuccessToastMessage("Transfer transaction added successfully!");
          setShowSuccessToast(true);
        }
      } else {
        // REGULAR TRANSACTION
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
          accountId: accountId!, // CHANGED from paymentChannelId
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
        setTransactionDateTime("");
        setFieldErrors({});
        setAmount("");
        setTransactionCost("");
        setTransactionReference("");
        setOriginalAmount("");
        setOriginalCurrency("");
        setExchangeRate("");
        setExchangeRateOverride(false);
        setCategoryId(undefined);
        setAccountId(undefined);
        setRecipientId(undefined);
        setTransferRecipientId(undefined);
        setTransferToAccountId(undefined);
        setDescription("");

        // Redirect to transactions list after successful add (with brief delay for toast)
        setTimeout(() => {
          history.push("/transactions");
        }, 500);
      }
    } catch (error) {
      console.error("Error adding transaction:", error);
      if (sqliteWriteConfirmed) {
        setErrorMsg(
          "SQLite was changed, but selected-read refresh failed. Reload the Transactions page manually; do not retry this write.",
        );
        return;
      }
      setErrorMsg(
        transactionsHttpBackendSelected
          ? transactionType === "transfer"
            ? transactionTransferWriteErrorCode(error)
            : transactionBasicWriteErrorCode(error)
          : error instanceof Error
            ? error.message
            : `Failed to ${
                isEditMode ? "update" : "add"
              } transaction. Please try again.`,
      );
    }
  };

  const populateFromLastTransaction = async (description: string) => {
    if (!description || !description.trim()) return;
    if (transactionsHttpBackendSelected) return;
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
      if (accountId == null && latest.accountId != null) {
        setAccountId(latest.accountId); // CHANGED from paymentMethodId
        setFieldErrors((prev) => ({ ...prev, account: false }));
      }
    } catch (err) {
      console.error("Failed to load last transaction for description:", err);
    }
  };

  // Handle SMS import - UPDATED to use accountId
  const handleSmsImport = async (parsedData: ParsedSmsData) => {
    if (parsedData.date && parsedData.time) {
      const dateParts = parsedData.date.split("-");
      if (dateParts.length === 3) {
        const formattedDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
        setTransactionDateTime(`${formattedDate}T${parsedData.time}`);
      } else {
        setTransactionDateTime(`${parsedData.date}T${parsedData.time}`);
      }
    } else if (parsedData.date) {
      const dateParts = parsedData.date.split("-");
      if (dateParts.length === 3) {
        const formattedDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
        setTransactionDateTime(formattedDate);
      }
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

    if (parsedData.isIncome !== undefined) {
      setTransactionType(parsedData.isIncome ? "income" : "expense");
    }

    const usedTemplateId = parsedData.templateId;
    if (usedTemplateId) {
      const template = smsTemplates.find((t) => t.id === usedTemplateId);
      if (template?.accountId) {
        // CHANGED from paymentMethodId
        setAccountId(template.accountId);
      }
    }

    // Handle recipient - NEW: Check recipientId first (from alias matching)
    if (parsedData.recipientId) {
      // Recipient was already matched by name or alias in useSmsParser
      setRecipientId(parsedData.recipientId);
    } else if (parsedData.recipientName) {
      // Fallback: Check if recipient exists by name
      const existingRecipient = sortedRecipients.find(
        (r) =>
          r.name?.toLowerCase() === parsedData.recipientName?.toLowerCase(),
      );

      if (existingRecipient) {
        setRecipientId(existingRecipient.id);
      } else {
        // No match found, open modal to create new recipient
        setShowRecipientModal(true);
        sessionStorage.setItem(
          "smsRecipientData",
          JSON.stringify({
            name: parsedData.recipientName,
            phone: parsedData.recipientPhone || "",
          }),
        );
      }
    }
  };

  // Clear error message when all required fields are filled
  useEffect(() => {
    if (errorMsg && errorMsg === "Please fill in all required fields.") {
      const formValidation = validateTransactionForm({
        selectedDate: transactionDateTime
          ? transactionDateTime.split("T")[0]
          : "",
        selectedTime: transactionDateTime
          ? transactionDateTime.split("T")[1]
          : "",
        amount,
        description,
        categoryId,
        accountId,
        recipientId,
        transferRecipientId,
        transferToAccountId,
        transactionType,
      });

      if (formValidation.isValid) {
        setErrorMsg("");
        setFieldErrors({});
      }
    }
  }, [
    transactionDateTime,
    amount,
    description,
    categoryId,
    accountId,
    recipientId,
    transferRecipientId,
    transferToAccountId,
    transactionType,
    errorMsg,
  ]);

  // Real-time validation
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
    if ((fieldErrors.date || fieldErrors.time) && transactionDateTime) {
      setFieldErrors((prev) => ({ ...prev, date: false, time: false }));
    }
  }, [transactionDateTime, fieldErrors.date, fieldErrors.time]);

  const basicHttpEditEligible =
    !isEditMode ||
    (editingTransaction !== null &&
      isBasicTransactionWriteEligible(editingTransaction));
  const costBudgetHttpEditEligible =
    !isEditMode ||
    (editingTransaction !== null &&
      isCostBudgetTransactionWriteEligible(
        editingTransaction,
        selectedBudgetSnapshots,
        selectedBudgets,
      ));
  const httpEditEligible = transactionsCostBudgetWriteExperimentActive
    ? costBudgetHttpEditEligible
    : basicHttpEditEligible;
  const httpCurrentTypeEligible =
    transactionType === "transfer"
      ? transactionsTransferWriteExperimentActive &&
        (!isEditMode || editingTransferEligible)
      : httpEditEligible;
  const transactionSubmitDisabled =
    transactionsHttpBackendSelected &&
    (!transactionsSqliteWriteExperimentActive ||
      (!transactionsCostBudgetWriteExperimentActive &&
        transactionType !== "transfer" &&
        transactionCost.trim() !== "") ||
      !httpCurrentTypeEligible);

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
          <SqliteAuthorityToolbarStatus />
          <IonButtons slot="end">
            {!transactionsHttpBackendSelected && (
              <IonButton onClick={() => setShowSmsImportModal(true)}>
                <IonIcon icon={documentTextOutline} />
                Import SMS
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {transactionsHttpBackendSelected && (
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
              {transactionsSqliteWriteExperimentActive
                ? rehearsal.authoritativeMode
                  ? "SQLite authoritative mode is active. Supported Transaction and paired Transfer writes use the verified local SQLite database. Delete, import/export mutation, and transfer repair remain disabled."
                  : transactionsTransferWriteExperimentActive
                  ? "Transactions SQLite transfer experiment is active. Transfers are written as atomic reciprocal transaction pairs in disposable local SQLite. Dexie remains authoritative. Transfer delete and pair repair remain unsupported."
                  : transactionsCostBudgetWriteExperimentActive
                  ? "Transactions SQLite write experiment is active. Writes go to disposable local SQLite only. Dexie remains authoritative. Single-row income/expense transactions may include transaction costs and links to existing budget snapshots. Transfers and delete remain unsupported."
                  : "Basic Transactions SQLite write experiment is active. Writes go to disposable local SQLite only. Dexie remains authoritative. Transfers, transaction costs, and budget-linked transactions are not supported. Create/update only; re-import SQLite before clean parity checks."
                : "The HTTP transaction backend is selected, but the basic SQLite write experiment is disabled. No transaction write will be attempted."}
            </p>
          </IonText>
        )}
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
                        e.detail.value as "expense" | "income" | "transfer",
                      )
                    }
                    disabled={
                      (isEditMode && editingTransaction?.isTransfer) ||
                      (transactionsHttpBackendSelected &&
                        !httpEditEligible)
                    }
                  >
                    <IonSegmentButton value="income">
                      <IonLabel>Income</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="expense">
                      <IonLabel>Expense</IonLabel>
                    </IonSegmentButton>
                    {(!transactionsHttpBackendSelected ||
                      transactionsTransferWriteExperimentActive) && (
                      <IonSegmentButton value="transfer">
                        <IonLabel>Transfer</IonLabel>
                      </IonSegmentButton>
                    )}
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

            {/* Transaction Date/Time */}
            <IonRow>
              <IonCol size="4">
                <div className="form-input-wrapper">
                  <label className="form-label">Transaction Date/Time</label>
                  <IonInput
                    className="form-input"
                    type="datetime-local"
                    value={transactionDateTime}
                    onIonChange={(e) => {
                      setTransactionDateTime(e.detail.value ?? "");
                      setFieldErrors((prev) => ({
                        ...prev,
                        date: false,
                        time: false,
                      }));
                    }}
                  />
                  {(fieldErrors.date || fieldErrors.time) && (
                    <span className="error-message">Required field</span>
                  )}
                </div>
              </IonCol>

              {/* Transaction Reference */}
              <IonCol size="7">
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Transaction Reference (optional)
                  </label>
                  <IonInput
                    className="form-input"
                    type="text"
                    placeholder="e.g. ABCD123XYZ"
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
                {/* Payer */}
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
                  {!transactionsHttpBackendSelected && (
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
                  )}
                </IonRow>

                {/* Recipient */}
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
                  {!transactionsHttpBackendSelected && (
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
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId,
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
                  {!transactionsHttpBackendSelected && (
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

                {/* FROM Account - CHANGED from Payment Method */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">From Account</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select source account"
                        value={accountId}
                        options={sortedAccounts
                          .filter((a) => a.name)
                          .map((a) => {
                            const currency = a.currency
                              ? `(${a.currency})`
                              : "(—)";
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

                {/* TO Account - CHANGED from Payment Method */}
                <IonRow>
                  <IonCol size="11">
                    <div className="form-input-wrapper">
                      <label className="form-label">To Account</label>
                      <SearchableFilterSelect
                        label=""
                        placeholder="Select destination account"
                        value={transferToAccountId}
                        options={sortedAccounts
                          .filter((a) => a.name)
                          .map((a) => {
                            const currency = a.currency
                              ? `(${a.currency})`
                              : "(—)";
                            return {
                              id: a.id,
                              name: `${a.name} ${currency}`,
                            };
                          })}
                        onIonChange={(v) => {
                          setTransferToAccountId(v);
                          setFieldErrors((prev) => ({
                            ...prev,
                            transferToAccount: false,
                          }));
                        }}
                      />
                      {fieldErrors.transferToAccount && (
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
              </>
            ) : (
              <>
                {/* Recipient */}
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
                  {!transactionsHttpBackendSelected && (
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
                  )}
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
                            const bucket = buckets.find(
                              (b) => b.id === c.bucketId,
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
                  {!transactionsHttpBackendSelected && (
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
                            const currency = a.currency
                              ? `(${a.currency})`
                              : "(—)";
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

              {(!transactionsHttpBackendSelected ||
                transactionsCostBudgetWriteExperimentActive) && (
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
              )}
            </IonRow>

            {transactionsCostBudgetWriteExperimentActive && (
              <IonRow>
                <IonCol size="11">
                  <div className="form-input-wrapper">
                    <label className="form-label">
                      Existing Budget Snapshot (optional)
                    </label>
                    <SelectableDropdown
                      label="Budget snapshot"
                      placeholder="No budget snapshot"
                      value={
                        budgetSnapshotId === undefined
                          ? undefined
                          : String(budgetSnapshotId)
                      }
                      options={[
                        { value: "", label: "No budget snapshot" },
                        ...selectedBudgetSnapshots.map((snapshot) => ({
                          value: String(snapshot.id),
                          label: `Snapshot ${snapshot.id} / Budget ${snapshot.budgetId} / ${snapshot.dueDate.toLocaleDateString()}`,
                        })),
                      ]}
                      onValueChange={(value) =>
                        setBudgetSnapshotId(
                          value === "" ? undefined : Number(value),
                        )
                      }
                    />
                    <IonText color="medium">
                      <small>
                        Existing snapshots only. This form does not generate or
                        modify budget snapshots.
                      </small>
                    </IonText>
                  </div>
                </IonCol>
              </IonRow>
            )}

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
                  <SelectableDropdown
                    label="Currency"
                    placeholder="Select currency"
                    value={originalCurrency}
                    options={currencies.map((cur) => ({
                      value: cur,
                      label: cur,
                    }))}
                    onValueChange={(currency) => {
                      setOriginalCurrency(currency);
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
                  disabled={transactionSubmitDisabled}
                >
                  {isEditMode ? "Update Transaction" : "Add Transaction"}
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </form>
      </IonContent>

      {/* Modal: Add Recipient */}
      {!transactionsHttpBackendSelected && (
        <AddRecipientModal
          isOpen={showRecipientModal}
          onClose={() => setShowRecipientModal(false)}
          onRecipientAdded={(recipient) => {
            setSortedRecipients((prev) => [recipient, ...prev]);
            setRecipientId(recipient.id);
          }}
        />
      )}

      {/* Modal: Add Category */}
      {!transactionsHttpBackendSelected && (
        <AddCategoryModal
          isOpen={showCategoryModal}
          onClose={() => setShowCategoryModal(false)}
          onCategoryAdded={(category) => {
            setSortedCategories((prev) => [category, ...prev]);
            setCategoryId(category.id);
          }}
          buckets={buckets}
        />
      )}

      {/* REMOVED: Modal: Add Payment Method */}

      {/* Modal: Import SMS */}
      {!transactionsHttpBackendSelected && (
        <SmsImportModal
          isOpen={showSmsImportModal}
          onClose={() => setShowSmsImportModal(false)}
          onImport={handleSmsImport}
          smsTemplates={smsTemplates}
          accounts={sortedAccounts}
          accountId={accountId}
        />
      )}

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

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
import { SqliteAuthorityToolbarStatus } from "../components/SqliteAuthorityRehearsalBanner";
import { SelectedReadPreviewCard } from "../components/dev/SelectedReadPreviewCard";
import { budgetRepository } from "../repositories";
import {
  getRepositoryBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { findMatchingTransactions } from "../utils/transactionMatching";
import {
  booleanValue,
  type DevPreviewListResult,
  isSelectedReadPreviewsEnabled,
  numberValue,
  previewCount,
  previewRows,
  safePreviewErrorCode,
  sampledIds,
  stringValue,
} from "../utils/devPreview";
import { useAccountImageUrls } from "../hooks/useAccountImageUrls";
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

interface SelectedReadBudgetSnapshotPreviewRow {
  id?: number;
  budgetId?: number;
  categoryId?: number;
  accountId?: number;
  recipientId?: number;
  dueDateDayKey?: string;
  isHistorical?: boolean | null;
  isGoal?: boolean | null;
  isFlexible?: boolean | null;
  frequency?: string;
  amountSign?: "negative" | "zero" | "positive";
}

interface SelectedReadBudgetHistoryPreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  rows: SelectedReadBudgetSnapshotPreviewRow[];
  errorCode?: string;
}

interface SelectedReadBudgetHistoryLoadMeta {
  backend: RepositoryBackend;
  source: string;
  snapshotLoadedCount: number;
  snapshotReportedCount?: number;
  snapshotTruncated: boolean;
  transactionLoadedCount: number;
  transactionReportedCount?: number;
  transactionTruncated: boolean;
  budgetLoadedCount: number;
  budgetReportedCount?: number;
  budgetTruncated: boolean;
}

type ListResult<Row> =
  | Row[]
  | {
      rows?: Row[];
      count?: number;
    };

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

const SELECTED_READ_PREVIEW_LIMIT = 20;
const BUDGET_HISTORY_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUDGET_HISTORY_READ_EXPERIMENT";
const SELECTED_READ_SNAPSHOT_LIMIT = 5000;
const SELECTED_READ_TRANSACTION_LIMIT = 5000;
const SELECTED_READ_BUDGET_LIMIT = 500;
const SELECTED_READ_LOOKUP_LIMIT = 500;
const SELECTED_READ_PAGE_SIZE = 200;

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const isBudgetHistoryReadExperimentEnabled = (): boolean =>
  getEnvValue(BUDGET_HISTORY_READ_EXPERIMENT_FLAG) === "true";

const rowsFromListResult = <Row,>(result: ListResult<Row>): Row[] | undefined =>
  Array.isArray(result) ? result : result.rows;

const countFromListResult = <Row,>(
  result: ListResult<Row>,
): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const loadPagedRows = async <Row,>(
  list: (options: { limit: number; offset: number }) => Promise<unknown>,
  maxRows: number,
): Promise<{
  rows: Row[];
  reportedCount?: number;
  truncated: boolean;
}> => {
  const rows: Row[] = [];
  let reportedCount: number | undefined;
  let lastPageFilled = false;

  while (rows.length < maxRows) {
    const limit = Math.min(SELECTED_READ_PAGE_SIZE, maxRows - rows.length);
    const result = (await list({ limit, offset: rows.length })) as ListResult<Row>;
    const pageRows = rowsFromListResult(result);

    if (!pageRows) {
      throw new Error("invalid_selected_read_budget_history_response");
    }

    reportedCount ??= countFromListResult(result);
    rows.push(...pageRows);
    lastPageFilled = pageRows.length === limit;

    if (pageRows.length === 0) {
      lastPageFilled = false;
      break;
    }

    if (reportedCount !== undefined && rows.length >= reportedCount) {
      break;
    }

    if (pageRows.length < limit) {
      break;
    }
  }

  return {
    rows,
    reportedCount,
    truncated:
      reportedCount !== undefined
        ? rows.length < reportedCount
        : rows.length >= maxRows && lastPageFilled,
  };
};

const dateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
};

const normalizeFrequencyDetails = (
  value: unknown,
): Budget["frequencyDetails"] => {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Budget["frequencyDetails"];
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  return typeof value === "object"
    ? (value as Budget["frequencyDetails"])
    : undefined;
};

const nullableNumberValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return numberValue(value);
};

const normalizeBudgetRow = (row: unknown): Budget | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const description = stringValue(source.description);
  const categoryId = numberValue(source.categoryId);
  const accountId = nullableNumberValue(source.accountId);
  const recipientId = nullableNumberValue(source.recipientId);
  const amount = numberValue(source.amount);
  const dueDate = dateValue(source.dueDate);
  const createdAt = dateValue(source.createdAt) ?? new Date(0);
  const updatedAt = dateValue(source.updatedAt) ?? new Date(0);
  const frequency = stringValue(source.frequency) as
    | Budget["frequency"]
    | undefined;
  const isGoal = booleanValue(source.isGoal);
  const isActive = booleanValue(source.isActive);

  if (
    id === undefined ||
    description === undefined ||
    categoryId === undefined ||
    amount === undefined ||
    dueDate === undefined ||
    frequency === undefined ||
    (isGoal !== true && isGoal !== false) ||
    (isActive !== true && isActive !== false)
  ) {
    return undefined;
  }

  return {
    id,
    description,
    categoryId,
    accountId,
    recipientId,
    amount,
    transactionCost: nullableNumberValue(source.transactionCost),
    frequency,
    frequencyDetails: normalizeFrequencyDetails(source.frequencyDetails),
    isGoal,
    isFlexible: booleanValue(source.isFlexible) ?? false,
    goalPercentage: nullableNumberValue(source.goalPercentage),
    goalDirection:
      source.goalDirection === "income" || source.goalDirection === "expense"
        ? source.goalDirection
        : undefined,
    isActive,
    remainingCyclesTotal:
      source.remainingCyclesTotal === null
        ? null
        : nullableNumberValue(source.remainingCyclesTotal),
    dueDate,
    createdAt,
    updatedAt,
  };
};

const normalizeBudgetSnapshotRow = (row: unknown): BudgetSnapshot | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const budgetId = numberValue(source.budgetId);
  const description = stringValue(source.description);
  const categoryId = numberValue(source.categoryId);
  const accountId = nullableNumberValue(source.accountId);
  const recipientId = nullableNumberValue(source.recipientId);
  const amount = numberValue(source.amount);
  const dueDate = dateValue(source.dueDate);
  const occurrenceDate = dateValue(source.occurrenceDate) ?? dueDate;
  const sourceBudgetUpdatedAt =
    dateValue(source.sourceBudgetUpdatedAt) ?? dateValue(source.updatedAt);
  const createdAt = dateValue(source.createdAt) ?? new Date(0);
  const updatedAt = dateValue(source.updatedAt) ?? new Date(0);
  const frequency = stringValue(source.frequency) as
    | Budget["frequency"]
    | undefined;
  const isGoal = booleanValue(source.isGoal);
  const isHistorical = booleanValue(source.isHistorical);

  if (
    id === undefined ||
    budgetId === undefined ||
    description === undefined ||
    categoryId === undefined ||
    amount === undefined ||
    dueDate === undefined ||
    occurrenceDate === undefined ||
    sourceBudgetUpdatedAt === undefined ||
    frequency === undefined ||
    (isGoal !== true && isGoal !== false) ||
    (isHistorical !== true && isHistorical !== false)
  ) {
    return undefined;
  }

  return {
    id,
    budgetId,
    occurrenceDate,
    dueDate,
    cycleIndex: numberValue(source.cycleIndex) ?? 0,
    description,
    categoryId,
    accountId,
    recipientId,
    amount,
    transactionCost: nullableNumberValue(source.transactionCost),
    frequency,
    frequencyDetails: normalizeFrequencyDetails(source.frequencyDetails),
    isGoal,
    isFlexible: booleanValue(source.isFlexible) ?? false,
    goalPercentage: nullableNumberValue(source.goalPercentage),
    goalDirection:
      source.goalDirection === "income" || source.goalDirection === "expense"
        ? source.goalDirection
        : undefined,
    remainingCyclesTotal:
      source.remainingCyclesTotal === null
        ? null
        : nullableNumberValue(source.remainingCyclesTotal),
    isHistorical,
    sourceBudgetUpdatedAt,
    createdAt,
    updatedAt,
  };
};

const normalizeTransactionRow = (row: unknown): Transaction | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const categoryId = numberValue(source.categoryId);
  const recipientId = numberValue(source.recipientId);
  const amount = numberValue(source.amount);
  const date = dateValue(source.date);

  if (
    id === undefined ||
    categoryId === undefined ||
    recipientId === undefined ||
    amount === undefined ||
    date === undefined
  ) {
    return undefined;
  }

  return {
    id,
    categoryId,
    accountId: nullableNumberValue(source.accountId),
    recipientId,
    date,
    amount,
    transactionCost: nullableNumberValue(source.transactionCost),
    description: stringValue(source.description),
    transactionReference: stringValue(source.transactionReference),
    transferPairId: nullableNumberValue(source.transferPairId),
    isTransfer: booleanValue(source.isTransfer) ?? undefined,
    budgetId: nullableNumberValue(source.budgetId),
    occurrenceDate: dateValue(source.occurrenceDate),
    budgetSnapshotId: nullableNumberValue(source.budgetSnapshotId),
  };
};

const normalizeCategoryRow = (row: unknown): Category | undefined =>
  row as Category | undefined;

const normalizeBucketRow = (row: unknown): Bucket | undefined =>
  row as Bucket | undefined;

const normalizeRecipientRow = (row: unknown): Recipient | undefined =>
  row as Recipient | undefined;

const normalizeAccountRow = (row: unknown): Account | undefined =>
  row as Account | undefined;

const normalizeRows = <Row,>(
  rows: unknown[],
  normalize: (row: unknown) => Row | undefined,
  errorCode: string,
): Row[] => {
  const normalized = rows
    .map(normalize)
    .filter((row): row is Row => row !== undefined);

  if (normalized.length !== rows.length) {
    throw new Error(errorCode);
  }

  return normalized;
};

const dayKey = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string" && value.trim().length >= 10) {
    return value.trim().slice(0, 10);
  }

  return undefined;
};

const amountSign = (
  value: unknown,
): SelectedReadBudgetSnapshotPreviewRow["amountSign"] => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value < 0) {
    return "negative";
  }

  if (value > 0) {
    return "positive";
  }

  return "zero";
};

const BudgetHistory: React.FC = () => {
  const budgetHistoryReadExperimentEnabled =
    isBudgetHistoryReadExperimentEnabled();
  const repositoryBackend = getRepositoryBackend();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(repositoryBackend);
  const budgetHistoryHttpReadonlyExperimentActive =
    rehearsalSelected ||
    (budgetHistoryReadExperimentEnabled && repositoryBackend === "http-readonly");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { imageUrls: accountImages } = useAccountImageUrls(accounts);

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
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadBudgetHistoryPreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [selectedReadLoadMeta, setSelectedReadLoadMeta] =
    useState<SelectedReadBudgetHistoryLoadMeta | null>(null);

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
    setSelectedReadLoadMeta(null);
    try {
      if (budgetHistoryHttpReadonlyExperimentActive) {
        const repositories = getSelectedReadRepositories(repositoryBackend);
        const [
          snapshotLoad,
          transactionLoad,
          budgetLoad,
          categoryLoad,
          bucketLoad,
          recipientLoad,
          accountLoad,
        ] = await Promise.all([
          loadPagedRows<unknown>(
            repositories.budgetSnapshots.list,
            SELECTED_READ_SNAPSHOT_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.transactions.list,
            SELECTED_READ_TRANSACTION_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.budgets.list,
            SELECTED_READ_BUDGET_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.categories.list,
            SELECTED_READ_LOOKUP_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.buckets.list,
            SELECTED_READ_LOOKUP_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.recipients.list,
            SELECTED_READ_LOOKUP_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.accounts.list,
            SELECTED_READ_LOOKUP_LIMIT,
          ),
        ]);

        setSnapshots(
          normalizeRows(
            snapshotLoad.rows,
            normalizeBudgetSnapshotRow,
            "budget_history_read_experiment_snapshot_normalization_failed",
          ),
        );
        setTransactions(
          normalizeRows(
            transactionLoad.rows,
            normalizeTransactionRow,
            "budget_history_read_experiment_transaction_normalization_failed",
          ),
        );
        setBudgets(
          normalizeRows(
            budgetLoad.rows,
            normalizeBudgetRow,
            "budget_history_read_experiment_budget_normalization_failed",
          ),
        );
        setCategories(
          normalizeRows(
            categoryLoad.rows,
            normalizeCategoryRow,
            "budget_history_read_experiment_category_normalization_failed",
          ),
        );
        setBuckets(
          normalizeRows(
            bucketLoad.rows,
            normalizeBucketRow,
            "budget_history_read_experiment_bucket_normalization_failed",
          ),
        );
        setRecipients(
          normalizeRows(
            recipientLoad.rows,
            normalizeRecipientRow,
            "budget_history_read_experiment_recipient_normalization_failed",
          ),
        );
        setAccounts(
          normalizeRows(
            accountLoad.rows,
            normalizeAccountRow,
            "budget_history_read_experiment_account_normalization_failed",
          ),
        );
        setSelectedReadLoadMeta({
          backend: repositoryBackend,
          source: repositories.source,
          snapshotLoadedCount: snapshotLoad.rows.length,
          snapshotReportedCount: snapshotLoad.reportedCount,
          snapshotTruncated: snapshotLoad.truncated,
          transactionLoadedCount: transactionLoad.rows.length,
          transactionReportedCount: transactionLoad.reportedCount,
          transactionTruncated: transactionLoad.truncated,
          budgetLoadedCount: budgetLoad.rows.length,
          budgetReportedCount: budgetLoad.reportedCount,
          budgetTruncated: budgetLoad.truncated,
        });
        setError("");
        return;
      }

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

      setSnapshots(allSnapshots);
      setBudgets(allBudgets);
      setTransactions(allTransactions);
      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);
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

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const result = await repositories.budgetSnapshots.list({
        limit: SELECTED_READ_PREVIEW_LIMIT,
        offset: 0,
      });
      const rows = previewRows(result as DevPreviewListResult);

      if (!rows) {
        setSelectedReadPreview({
          status: "fail",
          backend,
          source,
          rows: [],
          errorCode: "invalid_selected_read_budget_history_preview_response",
        });
        return;
      }

      const visibleRows = rows.slice(0, SELECTED_READ_PREVIEW_LIMIT);

      setSelectedReadPreview({
        status: "pass",
        backend,
        source,
        count: previewCount(result as DevPreviewListResult),
        loadedRowCount: visibleRows.length,
        sampledIds: sampledIds(visibleRows, SELECTED_READ_PREVIEW_LIMIT),
        rows: visibleRows.map((row) => ({
          id: numberValue(row.id),
          budgetId: numberValue((row as { budgetId?: unknown }).budgetId),
          categoryId: numberValue((row as { categoryId?: unknown }).categoryId),
          accountId: numberValue((row as { accountId?: unknown }).accountId),
          recipientId: numberValue(
            (row as { recipientId?: unknown }).recipientId,
          ),
          dueDateDayKey: dayKey((row as { dueDate?: unknown }).dueDate),
          isHistorical: booleanValue(
            (row as { isHistorical?: unknown }).isHistorical,
          ),
          isGoal: booleanValue((row as { isGoal?: unknown }).isGoal),
          isFlexible: booleanValue(
            (row as { isFlexible?: unknown }).isFlexible,
          ),
          frequency: stringValue((row as { frequency?: unknown }).frequency),
          amountSign: amountSign((row as { amount?: unknown }).amount),
        })),
      });
    } catch (error) {
      setSelectedReadPreview({
        status: "fail",
        backend,
        source,
        rows: [],
        errorCode: safePreviewErrorCode(
          error,
          "selected_read_budget_history_preview_failed",
        ),
      });
    } finally {
      setSelectedReadPreviewLoading(false);
    }
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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError("Budget History read experiment is read-only. Delete is disabled.");
      return;
    }

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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError(
        "Budget History read experiment is read-only. Activate/deactivate is disabled.",
      );
      return;
    }

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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError("Budget History read experiment is read-only. Delete is disabled.");
      return;
    }

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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError(
        "Budget History read experiment is read-only. Occurrence delete is disabled.",
      );
      return;
    }

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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError(
        "Budget History read experiment is read-only. Transaction linking is disabled.",
      );
      return;
    }

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
    if (budgetHistoryHttpReadonlyExperimentActive) {
      setError(
        "Budget History read experiment is read-only. Transaction linking is disabled.",
      );
      return;
    }

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

  const selectedReadInputsTruncated =
    selectedReadLoadMeta?.snapshotTruncated === true ||
    selectedReadLoadMeta?.transactionTruncated === true ||
    selectedReadLoadMeta?.budgetTruncated === true;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/budget" />
          </IonButtons>
          <IonTitle>Budget History</IonTitle>
          <SqliteAuthorityToolbarStatus />
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonAlert
          isOpen={
            !budgetHistoryHttpReadonlyExperimentActive && showDeleteConfirm
          }
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

        {!loading && budgetHistoryReadExperimentEnabled && (
          <IonItem
            color={budgetHistoryHttpReadonlyExperimentActive ? "warning" : "light"}
            lines="none"
            style={{ marginBottom: "16px", borderRadius: "4px" }}
          >
            <IonLabel>
              <h3>Budget History read experiment is active</h3>
              <p>
                Backend: {repositoryBackend}.{" "}
                {budgetHistoryHttpReadonlyExperimentActive
                  ? "History inputs are loaded through selected-read http-readonly; snapshot lifecycle and mutation actions are disabled. Switch back to Dexie for normal Budget History behavior."
                  : "The experiment flag is on, but the selected backend is Dexie, so Budget History uses the existing Dexie read and lifecycle path."}
              </p>
            </IonLabel>
          </IonItem>
        )}

        {!loading &&
          budgetHistoryHttpReadonlyExperimentActive &&
          selectedReadLoadMeta && (
            <IonItem
              color={selectedReadInputsTruncated ? "danger" : "light"}
              lines="none"
              style={{ marginBottom: "16px", borderRadius: "4px" }}
            >
              <IonLabel>
                <h3>Selected-read inputs</h3>
                <p>
                  source={selectedReadLoadMeta.source} snapshots=
                  {selectedReadLoadMeta.snapshotLoadedCount}/
                  {selectedReadLoadMeta.snapshotReportedCount ?? "-"}{" "}
                  transactions={selectedReadLoadMeta.transactionLoadedCount}/
                  {selectedReadLoadMeta.transactionReportedCount ?? "-"} budgets=
                  {selectedReadLoadMeta.budgetLoadedCount}/
                  {selectedReadLoadMeta.budgetReportedCount ?? "-"}
                </p>
                <p>
                  {selectedReadInputsTruncated
                    ? "Inputs are capped, so Budget History results should not be treated as full-confidence."
                    : "Inputs are not truncated."}
                </p>
              </IonLabel>
            </IonItem>
          )}

        {showSelectedReadPreview && (
          <SelectedReadPreviewCard
            resourceLabel="Selected-read budget snapshots"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description="This preview uses the selected read facade only when manually loaded. It does not replace Budget History data, grouping, filters, completion, linking, editing, or delete behavior, and it does not run snapshot lifecycle helpers."
          >
            {selectedReadPreview && (
              <IonList>
                <IonItem>
                  <IonLabel>Backend / source</IonLabel>
                  <IonText slot="end">
                    {selectedReadPreview.backend} /{" "}
                    {selectedReadPreview.source}
                  </IonText>
                </IonItem>
                <IonItem>
                  <IonLabel>Status</IonLabel>
                  <IonChip
                    color={
                      selectedReadPreview.status === "pass"
                        ? "success"
                        : "danger"
                    }
                    slot="end"
                  >
                    {selectedReadPreview.status === "pass" ? "Pass" : "Fail"}
                  </IonChip>
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
                    <h3>Budget snapshots</h3>
                    <p>
                      count={selectedReadPreview.count ?? "-"} loaded=
                      {selectedReadPreview.loadedRowCount ?? "-"} sampledIds=
                      {selectedReadPreview.sampledIds?.length
                        ? selectedReadPreview.sampledIds.join(", ")
                        : "-"}
                    </p>
                  </IonLabel>
                </IonItem>
                {selectedReadPreview.rows.map((snapshot) => (
                  <IonItem
                    key={`selected-budget-snapshot-${snapshot.id ?? "none"}`}
                  >
                    <IonLabel>
                      <h3>snapshot id={snapshot.id ?? "-"}</h3>
                      <p>
                        budgetId={snapshot.budgetId ?? "-"} categoryId=
                        {snapshot.categoryId ?? "-"} accountId=
                        {snapshot.accountId ?? "-"} recipientId=
                        {snapshot.recipientId ?? "-"}
                      </p>
                      <p>
                        dueDate={snapshot.dueDateDayKey ?? "-"} frequency=
                        {snapshot.frequency ?? "-"} amountSign=
                        {snapshot.amountSign ?? "-"}
                      </p>
                      <p>
                        isHistorical=
                        {snapshot.isHistorical === undefined
                          ? "-"
                          : String(snapshot.isHistorical)}{" "}
                        isGoal=
                        {snapshot.isGoal === undefined
                          ? "-"
                          : String(snapshot.isGoal)}{" "}
                        isFlexible=
                        {snapshot.isFlexible === undefined
                          ? "-"
                          : String(snapshot.isFlexible)}
                      </p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            )}
          </SelectedReadPreviewCard>
        )}

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
                        if (budgetHistoryHttpReadonlyExperimentActive) {
                          return;
                        }
                        setSelectedOccurrenceForCompletion(occ);
                        setShowCompleteModal(true);
                      }}
                      style={{
                        cursor: budgetHistoryHttpReadonlyExperimentActive
                          ? "default"
                          : "pointer",
                      }}
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

                            {!budgetHistoryHttpReadonlyExperimentActive && (
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
                            )}
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

        {!budgetHistoryHttpReadonlyExperimentActive && (
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
        )}

        {!budgetHistoryHttpReadonlyExperimentActive &&
          selectedOccurrenceForCompletion && (
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

        {!budgetHistoryHttpReadonlyExperimentActive && (
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
        )}
      </IonContent>
    </IonPage>
  );
};

export default BudgetHistory;

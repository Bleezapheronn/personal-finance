import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  timeOutline,
} from "ionicons/icons";
import {
  db,
  Budget,
  BudgetSnapshot,
  Category,
  Bucket,
  Recipient,
  Transaction,
  Account,
  migrateBudgetSnapshots,
  ensureBudgetSnapshotForOccurrence,
} from "../db";
import { CompleteBudgetModal } from "../components/CompleteBudgetModal";
import { LinkPastTransactionsModal } from "../components/LinkPastTransactionsModal";
import { findMatchingTransactions } from "../utils/transactionMatching";
import {
  exportBudgetsToCSV,
  downloadBudgetsCSV,
} from "../utils/budgetCsvExport";
import { ensureBudgetSnapshotCoverage } from "../utils/budgetSnapshots";
import { ImportModal } from "../components/ImportModal";
import {
  getRepositoryBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { isBudgetsWriteExperimentEnabled } from "../repositories/http/budgetDefinitionWriteExperiment";
import {
  budgetDeleteWriteErrorCode,
  dryRunBudgetDelete,
  isBudgetDeleteWriteExperimentEnabled,
  type BudgetDeleteWriteResponse,
  writeBudgetDelete,
} from "../repositories/http/budgetDeleteWriteExperiment";
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

const BUDGET_BATCH_DAYS = 30;
const GOAL_CAROUSEL_EXTENDED_HORIZON_DAYS = 3650;
const BUDGET_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUDGET_READ_EXPERIMENT";
const SELECTED_READ_BUDGET_LIMIT = 500;
const SELECTED_READ_BUDGET_SNAPSHOT_LIMIT = 5000;
const SELECTED_READ_TRANSACTION_LIMIT = 5000;
const SELECTED_READ_LOOKUP_LIMIT = 500;
const SELECTED_READ_PAGE_SIZE = 200;

type ListResult<Row> =
  | Row[]
  | {
      count?: number;
      rows?: Row[];
    };

interface SelectedReadLoadMeta {
  backend: RepositoryBackend;
  source: string;
  budgetLoadedCount: number;
  budgetReportedCount?: number;
  budgetTruncated: boolean;
  budgetSnapshotLoadedCount: number;
  budgetSnapshotReportedCount?: number;
  budgetSnapshotTruncated: boolean;
  transactionLoadedCount: number;
  transactionReportedCount?: number;
  transactionTruncated: boolean;
}

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const isBudgetReadExperimentEnabled = (): boolean =>
  getEnvValue(BUDGET_READ_EXPERIMENT_FLAG) === "true";

const rowsFromListResult = <Row,>(result: ListResult<Row>): Row[] | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  return Array.isArray(result.rows) ? result.rows : undefined;
};

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
      throw new Error("invalid_budget_read_experiment_page_response");
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

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const dateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const nullableNumberValue = (value: unknown): number | undefined => {
  const number = numberValue(value);
  return number === undefined ? undefined : number;
};

const normalizeFrequencyDetails = (
  value: unknown,
): Budget["frequencyDetails"] => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Budget["frequencyDetails"];
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Budget["frequencyDetails"];
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const normalizeBudgetRow = (row: unknown): Budget | undefined => {
  const source = row as Record<string, unknown>;
  const categoryId = numberValue(source.categoryId);
  const amount = numberValue(source.amount);
  const frequency = stringValue(source.frequency) as Budget["frequency"] | undefined;
  const dueDate = dateValue(source.dueDate);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);
  const isGoal = booleanValue(source.isGoal);
  const isActive = booleanValue(source.isActive);

  if (
    categoryId === undefined ||
    amount === undefined ||
    frequency === undefined ||
    dueDate === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    isGoal === undefined ||
    isActive === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    description: stringValue(source.description) ?? "",
    categoryId,
    paymentChannelId: nullableNumberValue(source.paymentChannelId),
    accountId: nullableNumberValue(source.accountId),
    recipientId: nullableNumberValue(source.recipientId),
    amount,
    transactionCost: nullableNumberValue(source.transactionCost),
    frequency,
    frequencyDetails: normalizeFrequencyDetails(source.frequencyDetails),
    isGoal,
    isFlexible: booleanValue(source.isFlexible) ?? false,
    goalPercentage: nullableNumberValue(source.goalPercentage),
    goalDirection: stringValue(source.goalDirection) as
      | Budget["goalDirection"]
      | undefined,
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

const normalizeBudgetSnapshotRow = (
  row: unknown,
): BudgetSnapshot | undefined => {
  const source = row as Record<string, unknown>;
  const budgetId = numberValue(source.budgetId);
  const occurrenceDate = dateValue(source.occurrenceDate);
  const dueDate = dateValue(source.dueDate);
  const cycleIndex = numberValue(source.cycleIndex);
  const categoryId = numberValue(source.categoryId);
  const amount = numberValue(source.amount);
  const frequency = stringValue(source.frequency) as Budget["frequency"] | undefined;
  const isGoal = booleanValue(source.isGoal);
  const isHistorical = booleanValue(source.isHistorical);
  const sourceBudgetUpdatedAt = dateValue(source.sourceBudgetUpdatedAt);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);

  if (
    budgetId === undefined ||
    occurrenceDate === undefined ||
    dueDate === undefined ||
    cycleIndex === undefined ||
    categoryId === undefined ||
    amount === undefined ||
    frequency === undefined ||
    isGoal === undefined ||
    isHistorical === undefined ||
    sourceBudgetUpdatedAt === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    budgetId,
    occurrenceDate,
    dueDate,
    cycleIndex,
    description: stringValue(source.description) ?? "",
    categoryId,
    accountId: nullableNumberValue(source.accountId),
    recipientId: nullableNumberValue(source.recipientId),
    amount,
    transactionCost: nullableNumberValue(source.transactionCost),
    frequency,
    frequencyDetails: normalizeFrequencyDetails(source.frequencyDetails),
    isGoal,
    isFlexible: booleanValue(source.isFlexible) ?? false,
    goalPercentage: nullableNumberValue(source.goalPercentage),
    goalDirection: stringValue(source.goalDirection) as
      | Budget["goalDirection"]
      | undefined,
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
  const categoryId = numberValue(source.categoryId);
  const recipientId = numberValue(source.recipientId);
  const date = dateValue(source.date);
  const amount = numberValue(source.amount);

  if (
    categoryId === undefined ||
    recipientId === undefined ||
    date === undefined ||
    amount === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    categoryId,
    paymentChannelId: nullableNumberValue(source.paymentChannelId),
    accountId: nullableNumberValue(source.accountId),
    recipientId,
    date,
    amount,
    originalAmount: nullableNumberValue(source.originalAmount),
    originalCurrency: stringValue(source.originalCurrency),
    exchangeRate: nullableNumberValue(source.exchangeRate),
    transactionReference: stringValue(source.transactionReference),
    transactionCost: nullableNumberValue(source.transactionCost),
    description: stringValue(source.description),
    transferPairId: nullableNumberValue(source.transferPairId),
    isTransfer: booleanValue(source.isTransfer),
    budgetId: nullableNumberValue(source.budgetId),
    occurrenceDate: dateValue(source.occurrenceDate),
    budgetSnapshotId: nullableNumberValue(source.budgetSnapshotId),
  };
};

const normalizeCategoryRow = (row: unknown): Category | undefined => {
  const source = row as Record<string, unknown>;
  const bucketId = numberValue(source.bucketId);
  const isActive = booleanValue(source.isActive);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);

  if (
    bucketId === undefined ||
    isActive === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    name: stringValue(source.name),
    bucketId,
    description: stringValue(source.description),
    isActive,
    createdAt,
    updatedAt,
  };
};

const normalizeBucketRow = (row: unknown): Bucket | undefined => {
  const source = row as Record<string, unknown>;
  const minPercentage = numberValue(source.minPercentage);
  const maxPercentage = numberValue(source.maxPercentage);
  const displayOrder = numberValue(source.displayOrder);
  const isActive = booleanValue(source.isActive);
  const excludeFromReports = booleanValue(source.excludeFromReports);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);

  if (
    minPercentage === undefined ||
    maxPercentage === undefined ||
    displayOrder === undefined ||
    isActive === undefined ||
    excludeFromReports === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    name: stringValue(source.name),
    description: stringValue(source.description),
    minPercentage,
    maxPercentage,
    minFixedAmount: nullableNumberValue(source.minFixedAmount),
    isActive,
    displayOrder,
    excludeFromReports,
    createdAt,
    updatedAt,
  };
};

const normalizeRecipientRow = (row: unknown): Recipient | undefined => {
  const source = row as Record<string, unknown>;
  const name = stringValue(source.name);
  const isActive = booleanValue(source.isActive);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);

  if (
    name === undefined ||
    isActive === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    name,
    aliases: stringValue(source.aliases),
    email: stringValue(source.email),
    phone: stringValue(source.phone),
    tillNumber: stringValue(source.tillNumber),
    paybill: stringValue(source.paybill),
    accountNumber: stringValue(source.accountNumber),
    description: stringValue(source.description),
    isActive,
    createdAt,
    updatedAt,
  };
};

const normalizeAccountRow = (row: unknown): Account | undefined => {
  const source = row as Record<string, unknown>;
  const name = stringValue(source.name);
  const isActive = booleanValue(source.isActive);
  const createdAt = dateValue(source.createdAt);
  const updatedAt = dateValue(source.updatedAt);

  if (
    name === undefined ||
    isActive === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id: numberValue(source.id),
    name,
    description: stringValue(source.description),
    currency: stringValue(source.currency),
    imageBlob: null,
    isActive,
    isCredit: booleanValue(source.isCredit) ?? false,
    creditLimit: nullableNumberValue(source.creditLimit),
    createdAt,
    updatedAt,
  };
};

const normalizeRows = <Row,>(
  rows: unknown[],
  normalize: (row: unknown) => Row | undefined,
  code: string,
): Row[] => {
  const normalized = rows
    .map(normalize)
    .filter((row): row is Row => row !== undefined);

  if (normalized.length !== rows.length) {
    throw new Error(code);
  }

  return normalized;
};

const normalizeToLocalDay = (value: Date | string): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const isSameLocalDay = (left: Date | string, right: Date | string): boolean => {
  return (
    normalizeToLocalDay(left).getTime() === normalizeToLocalDay(right).getTime()
  );
};

const isDebugModeEnabled = (): boolean => {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("debugMode") === "true"
  );
};

const getLinkedTransactionCountForSnapshot = (
  transactions: Transaction[],
  snapshotId: number,
): number => {
  return transactions.filter(
    (txn) => Number(txn.budgetSnapshotId) === snapshotId,
  ).length;
};

const BudgetPage: React.FC = () => {
  const history = useHistory();
  const budgetReadExperimentEnabled = isBudgetReadExperimentEnabled();
  const repositoryBackend = getRepositoryBackend();
  const rehearsal = useSqliteAuthorityRehearsal();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(repositoryBackend);
  const budgetDefinitionWriteExperimentActive =
    (repositoryBackend === "http-readonly" &&
      isBudgetsWriteExperimentEnabled()) ||
    (rehearsalSelected && rehearsal.ready);
  const budgetHttpReadonlyExperimentActive =
    rehearsalSelected ||
    (repositoryBackend === "http-readonly" &&
      (budgetReadExperimentEnabled || budgetDefinitionWriteExperimentActive));
  const budgetDeleteWriteExperimentActive =
    rehearsalSelected &&
    rehearsal.ready &&
    rehearsal.budgetDeleteWritesAvailable &&
    isBudgetDeleteWriteExperimentEnabled();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetSnapshots, setBudgetSnapshots] = useState<BudgetSnapshot[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
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
  const [selectedReadLoadMeta, setSelectedReadLoadMeta] =
    useState<SelectedReadLoadMeta | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<number | undefined>(
    undefined,
  );
  const [deleteAnalysis, setDeleteAnalysis] = useState<{
    totalSnapshots: number;
    linkedSnapshots: BudgetSnapshot[];
    unlinkedSnapshots: BudgetSnapshot[];
  } | null>(null);
  const [sqliteDeletePlan, setSqliteDeletePlan] =
    useState<BudgetDeleteWriteResponse | null>(null);
  const [budgetDeleteBusy, setBudgetDeleteBusy] = useState(false);

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedBudgetForCompletion, setSelectedBudgetForCompletion] =
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

  // New state variables for budget period
  const [budgetSummaryPeriod, setBudgetSummaryPeriod] = useState<
    "month" | "quarter" | "year"
  >("month");

  // Add this state near the top with other state variables
  const [currentGoalIndex, setCurrentGoalIndex] = useState(0);
  const [visibleBudgetHorizonDays, setVisibleBudgetHorizonDays] =
    useState(BUDGET_BATCH_DAYS);
  const [isLoadingMoreBudgetOccurrences, setIsLoadingMoreBudgetOccurrences] =
    useState(false);

  // Load all data
  useIonViewWillEnter(() => {
    loadData();
  });

  const loadData = async () => {
    setLoading(true);
    setSelectedReadLoadMeta(null);
    try {
      if (budgetHttpReadonlyExperimentActive) {
        const repositories = getSelectedReadRepositories(repositoryBackend);
        const [
          budgetLoad,
          snapshotLoad,
          transactionLoad,
          categoryLoad,
          bucketLoad,
          recipientLoad,
          accountLoad,
        ] = await Promise.all([
          loadPagedRows<unknown>(
            repositories.budgets.list,
            SELECTED_READ_BUDGET_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.budgetSnapshots.list,
            SELECTED_READ_BUDGET_SNAPSHOT_LIMIT,
          ),
          loadPagedRows<unknown>(
            repositories.transactions.list,
            SELECTED_READ_TRANSACTION_LIMIT,
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

        setBudgets(
          normalizeRows(
            budgetLoad.rows,
            normalizeBudgetRow,
            "budget_read_experiment_budget_normalization_failed",
          ),
        );
        setBudgetSnapshots(
          normalizeRows(
            snapshotLoad.rows,
            normalizeBudgetSnapshotRow,
            "budget_read_experiment_snapshot_normalization_failed",
          ),
        );
        setTransactions(
          normalizeRows(
            transactionLoad.rows,
            normalizeTransactionRow,
            "budget_read_experiment_transaction_normalization_failed",
          ),
        );
        setCategories(
          normalizeRows(
            categoryLoad.rows,
            normalizeCategoryRow,
            "budget_read_experiment_category_normalization_failed",
          ),
        );
        setBuckets(
          normalizeRows(
            bucketLoad.rows,
            normalizeBucketRow,
            "budget_read_experiment_bucket_normalization_failed",
          ),
        );
        setRecipients(
          normalizeRows(
            recipientLoad.rows,
            normalizeRecipientRow,
            "budget_read_experiment_recipient_normalization_failed",
          ),
        );
        setAccounts(
          normalizeRows(
            accountLoad.rows,
            normalizeAccountRow,
            "budget_read_experiment_account_normalization_failed",
          ),
        );
        setAccountImages(new Map());
        setVisibleBudgetHorizonDays(BUDGET_BATCH_DAYS);
        setSelectedReadLoadMeta({
          backend: repositoryBackend,
          source: repositories.source,
          budgetLoadedCount: budgetLoad.rows.length,
          budgetReportedCount: budgetLoad.reportedCount,
          budgetTruncated: budgetLoad.truncated,
          budgetSnapshotLoadedCount: snapshotLoad.rows.length,
          budgetSnapshotReportedCount: snapshotLoad.reportedCount,
          budgetSnapshotTruncated: snapshotLoad.truncated,
          transactionLoadedCount: transactionLoad.rows.length,
          transactionReportedCount: transactionLoad.reportedCount,
          transactionTruncated: transactionLoad.truncated,
        });
        setError("");
        return true;
      }

      // Run snapshot migration and pre-generate upcoming snapshots
      await migrateBudgetSnapshots();

      const [b, txns, cats, bkts, recs, accs] = await Promise.all([
        db.budgets.toArray(),
        db.transactions.toArray(),
        db.categories.toArray(),
        db.buckets.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
      ]);

      // DEBUG: Check for snapshot ID type mismatches
      if (isDebugModeEnabled()) {
        const snapshotIds = new Set<number>();
        const snapshots = await db.budgetSnapshots.toArray();
        snapshots.forEach((snap) => {
          if (snap.id !== undefined) {
            snapshotIds.add(snap.id);
          }
        });
        const typeMismatches = txns.filter(
          (txn) =>
            txn.budgetSnapshotId !== undefined &&
            typeof txn.budgetSnapshotId !== "number",
        );
        if (typeMismatches.length > 0) {
          console.warn(
            `⚠️ Found ${typeMismatches.length} transactions with non-numeric budgetSnapshotId. This may cause linkage failures. Consider re-saving linked transactions.`,
            typeMismatches.slice(0, 3),
          );
        }
      }

      // Normalize one-time goal snapshots against the live budget due date.
      // Keep the due-date-matching snapshot when possible and prune stale,
      // unlinked duplicates left behind by past edits.
      const oneTimeGoalBudgets = b.filter(
        (budget) => budget.id && budget.isGoal && budget.frequency === "once",
      );
      const goalBudgetIds = new Set(
        oneTimeGoalBudgets.map((budget) => budget.id),
      );
      if (goalBudgetIds.size > 0) {
        const snapshots = await db.budgetSnapshots.toArray();
        const oneTimeGoalSnapshots = snapshots.filter((snap) =>
          goalBudgetIds.has(snap.budgetId),
        );
        const duplicatesByBudget = new Map<
          number,
          typeof oneTimeGoalSnapshots
        >();
        oneTimeGoalSnapshots.forEach((snap) => {
          if (!duplicatesByBudget.has(snap.budgetId)) {
            duplicatesByBudget.set(snap.budgetId, []);
          }
          duplicatesByBudget.get(snap.budgetId)!.push(snap);
        });
        for (const budget of oneTimeGoalBudgets) {
          const budgetId = budget.id;
          if (!budgetId) {
            continue;
          }

          const snaps = duplicatesByBudget.get(budgetId) || [];
          if (snaps.length <= 1) {
            continue;
          }

          const matchingDueDateSnapshots = snaps.filter((snap) =>
            isSameLocalDay(snap.dueDate, budget.dueDate),
          );
          const candidatePool =
            matchingDueDateSnapshots.length > 0
              ? matchingDueDateSnapshots
              : snaps;
          const sortedCandidates = [...candidatePool].sort((left, right) => {
            const rightLinkedCount = right.id
              ? getLinkedTransactionCountForSnapshot(txns, right.id)
              : 0;
            const leftLinkedCount = left.id
              ? getLinkedTransactionCountForSnapshot(txns, left.id)
              : 0;

            if (rightLinkedCount !== leftLinkedCount) {
              return rightLinkedCount - leftLinkedCount;
            }

            return (
              new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime()
            );
          });

          const keep = sortedCandidates[0];
          if (!keep?.id) {
            continue;
          }

          const deletedSnapshotIds: number[] = [];
          const preservedLinkedSnapshotIds: number[] = [];

          for (const snap of snaps) {
            if (!snap.id || snap.id === keep.id) {
              continue;
            }

            const linkedCount = getLinkedTransactionCountForSnapshot(
              txns,
              snap.id,
            );
            if (linkedCount === 0) {
              await db.budgetSnapshots.delete(snap.id);
              deletedSnapshotIds.push(snap.id);
            } else {
              preservedLinkedSnapshotIds.push(snap.id);
            }
          }

          if (isDebugModeEnabled()) {
            console.info("One-time goal snapshot normalization", {
              budgetId,
              budgetDescription: budget.description,
              liveBudgetDueDate: normalizeToLocalDay(
                budget.dueDate,
              ).toISOString(),
              keptSnapshotId: keep.id,
              keptSnapshotDueDate: normalizeToLocalDay(
                keep.dueDate,
              ).toISOString(),
              deletedSnapshotIds,
              preservedLinkedSnapshotIds,
            });
          }
        }
      }

      const oneYearFromNow = new Date();
      oneYearFromNow.setHours(0, 0, 0, 0);
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      await Promise.all(
        b
          .filter((budget) => budget.isActive)
          .map((budget) =>
            ensureBudgetSnapshotCoverage(budget, oneYearFromNow),
          ),
      );

      const snapshots = await db.budgetSnapshots.toArray();

      setBudgets(b);
      setBudgetSnapshots(snapshots);
      setTransactions(txns);
      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);
      setVisibleBudgetHorizonDays(BUDGET_BATCH_DAYS);

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
      return true;
    } catch (err) {
      console.error("Failed to load budget data:", err);
      setError("Failed to load budgets");
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Calculate amount paid for a specific budget occurrence
  // Coerce snapshot IDs to numeric type to handle type drift from imports/restores
  const getAmountPaidForOccurrence = (
    budgetSnapshotId: number | undefined,
    _budgetId: number,
    occurrenceDate: Date,
  ): number => {
    if (budgetSnapshotId !== undefined) {
      const numericSnapshotId = Number(budgetSnapshotId);
      return transactions
        .filter((txn) => Number(txn.budgetSnapshotId) === numericSnapshotId)
        .reduce((sum, txn) => sum + txn.amount + (txn.transactionCost || 0), 0);
    }

    // Legacy fallback: rows without snapshot linkage, matched by occurrence date.
    const targetTime = occurrenceDate.getTime();
    return transactions
      .filter(
        (txn) =>
          txn.budgetSnapshotId === undefined &&
          txn.occurrenceDate &&
          new Date(txn.occurrenceDate).getTime() === targetTime,
      )
      .reduce((sum, txn) => sum + txn.amount + (txn.transactionCost || 0), 0);
  };

  // Get linked transactions for a specific occurrence
  // Coerce snapshot IDs to numeric type to handle type drift from imports/restores
  const getLinkedTransactionsForOccurrence = (
    budgetSnapshotId: number | undefined,
    _budgetId: number,
    occurrenceDate: Date,
  ): Transaction[] => {
    if (budgetSnapshotId !== undefined) {
      const numericSnapshotId = Number(budgetSnapshotId);
      return transactions.filter(
        (txn) => Number(txn.budgetSnapshotId) === numericSnapshotId,
      );
    }

    // Legacy fallback: rows without snapshot linkage, matched by occurrence date.
    const targetTime = occurrenceDate.getTime();
    return transactions.filter(
      (txn) =>
        txn.budgetSnapshotId === undefined &&
        txn.occurrenceDate &&
        new Date(txn.occurrenceDate).getTime() === targetTime,
    );
  };

  // Generate occurrences from immutable snapshots, with legacy fallback.
  const generateBudgetOccurrences = (
    horizonDays: number,
  ): BudgetOccurrence[] => {
    const horizonDate = new Date();
    horizonDate.setHours(0, 0, 0, 0);
    horizonDate.setDate(horizonDate.getDate() + horizonDays);

    const occurrences: BudgetOccurrence[] = [];
    const budgetById = new Map<number, Budget>();

    budgets.forEach((budget) => {
      if (budget.id) {
        budgetById.set(budget.id, budget);
      }
    });

    const uniqueSnapshots = new Map<string, BudgetSnapshot>();
    budgetSnapshots.forEach((snapshot) => {
      const occurrenceDate = new Date(snapshot.occurrenceDate);
      occurrenceDate.setHours(0, 0, 0, 0);
      const key = `${snapshot.budgetId}:${occurrenceDate.getTime()}`;
      const existing = uniqueSnapshots.get(key);

      if (!existing) {
        uniqueSnapshots.set(key, snapshot);
        return;
      }

      // Choose the most recently updated snapshot for this occurrence
      // Prefer ones with linked transactions when available
      const existingHasLinks = transactions.some(
        (txn) => Number(txn.budgetSnapshotId) === existing.id,
      );
      const candidateHasLinks = transactions.some(
        (txn) => Number(txn.budgetSnapshotId) === snapshot.id,
      );

      if (candidateHasLinks && !existingHasLinks) {
        uniqueSnapshots.set(key, snapshot);
        return;
      }

      if (
        new Date(snapshot.updatedAt).getTime() >=
        new Date(existing.updatedAt).getTime()
      ) {
        uniqueSnapshots.set(key, snapshot);
      }
    });

    const snapshotOccurrences: BudgetOccurrence[] = Array.from(
      uniqueSnapshots.values(),
    )
      .filter((snapshot) => {
        const liveBudget = budgetById.get(snapshot.budgetId);
        if (!liveBudget) return false;

        const dueDate = new Date(snapshot.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate <= horizonDate;
      })
      .map((snapshot) => {
        const liveBudget = budgetById.get(snapshot.budgetId)!;

        const dueDate = new Date(snapshot.dueDate);
        dueDate.setHours(0, 0, 0, 0);

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

        const amountPaid = getAmountPaidForOccurrence(
          snapshot.id,
          snapshot.budgetId,
          dueDate,
        );

        const effectiveTarget = getEffectiveBudgetTarget(snapshotBudget);
        const isExpense = isExpenseBudget(snapshotBudget);
        const isCompleted = isExpense
          ? amountPaid <= -effectiveTarget
          : amountPaid >= effectiveTarget;

        return {
          budgetSnapshotId: snapshot.id,
          budgetId: snapshot.budgetId,
          budget: snapshotBudget,
          dueDate,
          amountPaid,
          isCompleted,
          timeGroup: getTimeGroup(dueDate),
          linkedTransactions: getLinkedTransactionsForOccurrence(
            snapshot.id,
            snapshot.budgetId,
            dueDate,
          ),
        };
      });

    occurrences.push(...snapshotOccurrences);

    const snapshotBudgetIdsInRange = new Set(
      snapshotOccurrences.map((occurrence) => occurrence.budgetId),
    );

    // Legacy fallback for active budgets with no snapshot rows yet.
    budgets
      .filter((budget) => budget.isActive)
      .forEach((budget) => {
        const budgetId = budget.id;
        if (!budgetId) return;

        const hasSnapshots = snapshotBudgetIdsInRange.has(budgetId);
        if (hasSnapshots) return;

        if (budget.frequency === "once") {
          const dueDate = new Date(budget.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          if (dueDate > horizonDate) {
            return;
          }

          const amountPaid = getAmountPaidForOccurrence(
            undefined,
            budgetId,
            dueDate,
          );
          const onceTarget = getEffectiveBudgetTarget(budget);
          const isOnceExpense = isExpenseBudget(budget);
          const isCompleted = isOnceExpense
            ? amountPaid <= -onceTarget
            : amountPaid >= onceTarget;

          occurrences.push({
            budgetId,
            budget,
            dueDate,
            amountPaid,
            isCompleted,
            timeGroup: getTimeGroup(dueDate),
            linkedTransactions: getLinkedTransactionsForOccurrence(
              undefined,
              budgetId,
              dueDate,
            ),
          });
        } else {
          let currentDueDate = new Date(budget.dueDate);
          currentDueDate.setHours(0, 0, 0, 0);

          let occurrenceCount = 0;
          while (currentDueDate <= horizonDate) {
            occurrenceCount++;

            const amountPaid = getAmountPaidForOccurrence(
              undefined,
              budgetId,
              currentDueDate,
            );
            const recurringTarget = getEffectiveBudgetTarget(budget);
            const isCompleted = isExpenseBudget(budget)
              ? amountPaid <= -recurringTarget
              : amountPaid >= recurringTarget;

            occurrences.push({
              budgetId,
              budget,
              dueDate: new Date(currentDueDate),
              amountPaid,
              isCompleted,
              timeGroup: getTimeGroup(currentDueDate),
              linkedTransactions: getLinkedTransactionsForOccurrence(
                undefined,
                budgetId,
                currentDueDate,
              ),
            });

            // Calculate next occurrence
            currentDueDate = getNextOccurrence(currentDueDate, budget);

            // Safety check to prevent infinite loops
            if (occurrenceCount > 5000) {
              break;
            }
          }
        }
      });

    return occurrences;
  };

  const hasBudgetOccurrencesBeyondHorizon = (horizonDays: number): boolean => {
    const horizonDate = new Date();
    horizonDate.setHours(0, 0, 0, 0);
    horizonDate.setDate(horizonDate.getDate() + horizonDays);

    const activeBudgetIds = new Set(
      budgets
        .filter((budget) => budget.isActive && budget.id)
        .map((b) => b.id!),
    );

    const hasSnapshotBeyond = budgetSnapshots.some((snapshot) => {
      if (!activeBudgetIds.has(snapshot.budgetId)) {
        return false;
      }
      const dueDate = new Date(snapshot.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate > horizonDate;
    });

    if (hasSnapshotBeyond) {
      return true;
    }

    const maxCyclesForBudget = (budget: Budget): number => {
      if (
        budget.remainingCyclesTotal === null ||
        budget.remainingCyclesTotal === undefined
      ) {
        return Number.MAX_SAFE_INTEGER;
      }
      return Math.max(0, budget.remainingCyclesTotal);
    };

    for (const budget of budgets.filter((b) => b.isActive)) {
      if (!budget.id) continue;

      const hasSnapshots = budgetSnapshots.some(
        (snapshot) => snapshot.budgetId === budget.id,
      );
      if (hasSnapshots) continue;

      let currentDueDate = new Date(budget.dueDate);
      currentDueDate.setHours(0, 0, 0, 0);
      const maxCycles = maxCyclesForBudget(budget);
      let cycleCount = 1;

      while (cycleCount <= maxCycles && currentDueDate <= horizonDate) {
        if (budget.frequency === "once") {
          break;
        }
        currentDueDate = getNextOccurrence(currentDueDate, budget);
        cycleCount += 1;

        if (cycleCount > 5000) {
          break;
        }
      }

      if (cycleCount <= maxCycles && currentDueDate > horizonDate) {
        return true;
      }
    }

    return false;
  };

  const loadMoreBudgetOccurrences = async () => {
    if (budgetHttpReadonlyExperimentActive) {
      setError(
        "Budget read experiment is read-only. Load more budget items is disabled.",
      );
      return;
    }

    const nextHorizon = visibleBudgetHorizonDays + BUDGET_BATCH_DAYS;

    try {
      setIsLoadingMoreBudgetOccurrences(true);
      const horizonDate = new Date();
      horizonDate.setHours(0, 0, 0, 0);
      horizonDate.setDate(horizonDate.getDate() + nextHorizon);

      await Promise.all(
        budgets
          .filter((budget) => budget.isActive)
          .map((budget) => ensureBudgetSnapshotCoverage(budget, horizonDate)),
      );

      const refreshedSnapshots = await db.budgetSnapshots.toArray();
      setBudgetSnapshots(refreshedSnapshots);
      setVisibleBudgetHorizonDays(nextHorizon);
    } finally {
      setIsLoadingMoreBudgetOccurrences(false);
    }
  };

  // Calculate next occurrence based on frequency with intelligent month boundary handling
  const getNextOccurrence = (currentDate: Date, budget: Budget): Date => {
    // Use local date parts consistently to avoid UTC/local drift.
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const day = currentDate.getDate();

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
          const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();

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

    const next = new Date(nextYear, nextMonth, nextDay);

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
  const groupedOccurrences = (
    occurrences: BudgetOccurrence[],
  ): Array<[string, BudgetOccurrence[]]> => {
    const groups = new Map<string, BudgetOccurrence[]>();
    const groupOrder = ["Overdue", "This Week", "Next Week", "This Month"];

    occurrences.forEach((occ) => {
      // Keep inactive budgets in totals, but hide them from the list display.
      if (!occ.budget.isActive) {
        return;
      }

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
          [group, sortOccurrences(occs)] as [string, BudgetOccurrence[]],
      );

    sortedGroups.push(...futureGroups);

    return sortedGroups;
  };

  // Analyze delete options based on snapshots and their linked transactions
  // Use type-safe snapshot ID coercion for robust linkage resolution
  const analyzeBudgetDeleteOptions = (budgetId: number) => {
    const budgetSnapshotsForId = budgetSnapshots.filter(
      (s) => s.budgetId === budgetId,
    );
    const linkedSnapshots = budgetSnapshotsForId.filter((snapshot) => {
      return transactions.some(
        (txn) => Number(txn.budgetSnapshotId) === snapshot.id,
      );
    });
    const unlinkedSnapshots = budgetSnapshotsForId.filter((snapshot) => {
      return !transactions.some(
        (txn) => Number(txn.budgetSnapshotId) === snapshot.id,
      );
    });

    return {
      totalSnapshots: budgetSnapshotsForId.length,
      linkedSnapshots,
      unlinkedSnapshots,
    };
  };

  // Handle delete click - run preflight analysis
  const handleDeleteClick = async (budgetId: number) => {
    if (budgetDeleteWriteExperimentActive) {
      setBudgetDeleteBusy(true);
      setError("");
      try {
        const plan = await dryRunBudgetDelete(budgetId);
        if (!plan.eligible || !plan.planFingerprint) {
          setError(
            `Budget deletion blocked: ${plan.transactionDependencyCount} protected transaction dependency/dependencies and ${plan.conflictCount} conflict(s). No rows changed.`,
          );
          return;
        }
        setSqliteDeletePlan(plan);
        setDeleteAnalysis(null);
        setBudgetToDelete(budgetId);
        setShowDeleteConfirm(true);
      } catch (err) {
        setError(budgetDeleteWriteErrorCode(err));
      } finally {
        setBudgetDeleteBusy(false);
      }
      return;
    }

    if (budgetHttpReadonlyExperimentActive) {
      setError("Budget read experiment is read-only. Delete is disabled.");
      return;
    }

    const analysis = analyzeBudgetDeleteOptions(budgetId);
    setDeleteAnalysis(analysis);
    setBudgetToDelete(budgetId);
    setShowDeleteConfirm(true);
  };

  // Handle delete confirmation - execute selected action
  const handleConfirmDelete = async (
    action: "delete" | "deleteUnlinked" | "deactivate" | "deleteSqlite",
  ) => {
    if (action === "deleteSqlite") {
      if (
        !budgetDeleteWriteExperimentActive ||
        budgetToDelete === undefined ||
        !sqliteDeletePlan?.planFingerprint
      ) {
        setError("budget_delete_write_not_ready");
        return;
      }
      setBudgetDeleteBusy(true);
      setError("");
      let sqliteMutated = false;
      try {
        await writeBudgetDelete(
          budgetToDelete,
          sqliteDeletePlan.planFingerprint,
        );
        sqliteMutated = true;
        const refreshed = await loadData();
        if (!refreshed) {
          setError(
            "Budget deletion completed, but refresh failed. SQLite may already have changed; verify it before retrying.",
          );
          return;
        }
        setSuccessMsg(
          "Budget and its unlinked snapshots deleted from SQLite. Rotate the authority checkpoint before restart.",
        );
        setShowSuccessToast(true);
        setShowDeleteConfirm(false);
        setBudgetToDelete(undefined);
        setSqliteDeletePlan(null);
      } catch (err) {
        setError(
          sqliteMutated
            ? "budget_delete_refresh_failed_sqlite_may_have_changed"
            : budgetDeleteWriteErrorCode(err),
        );
      } finally {
        setBudgetDeleteBusy(false);
      }
      return;
    }

    if (budgetHttpReadonlyExperimentActive) {
      setError("Budget read experiment is read-only. Delete is disabled.");
      return;
    }

    if (budgetToDelete === undefined || !deleteAnalysis) return;

    try {
      if (action === "delete") {
        // Delete budget only (no snapshots exist)
        await db.budgets.delete(budgetToDelete);
        setSuccessMsg("Budget deleted successfully");
      } else if (action === "deleteUnlinked") {
        // Delete unlinked snapshots
        for (const snapshot of deleteAnalysis.unlinkedSnapshots) {
          if (snapshot.id) {
            await db.budgetSnapshots.delete(snapshot.id);
          }
        }
        const count = deleteAnalysis.unlinkedSnapshots.length;
        setSuccessMsg(
          `${count} snapshot${count !== 1 ? "s" : ""} deleted successfully`,
        );
      } else if (action === "deactivate") {
        // Deactivate budget
        await db.budgets.update(budgetToDelete, { isActive: false });
        setSuccessMsg("Budget deactivated (has linked transactions)");
      }

      setShowSuccessToast(true);
      loadData();
      setShowDeleteConfirm(false);
      setBudgetToDelete(undefined);
      setDeleteAnalysis(null);
    } catch (err) {
      console.error("Error during delete action:", err);
      setError("Failed to complete delete action");
    }
  };

  // Handle link past transactions
  const handleOpenLinkModal = (budgetOccurrence: BudgetOccurrence) => {
    if (budgetHttpReadonlyExperimentActive) {
      setError(
        "Budget read experiment is read-only. Transaction linking is disabled.",
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
    if (budgetHttpReadonlyExperimentActive) {
      setError(
        "Budget read experiment is read-only. Transaction linking is disabled.",
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

      // Update all selected transactions with the budgetId and occurrenceDate
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
      loadData();
      setShowLinkModal(false);
      setBudgetIdForLinking(undefined);
      setBudgetSnapshotIdForLinking(undefined);
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
    accountId: number | undefined,
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

  // Sum of actual income transactions from Jan 1 of this year to today.
  // Uses the bucket flagged as excludeFromReports to identify income categories.
  const yearToDateIncome = useMemo(() => {
    const incomeBucket = buckets.find((b) => b.excludeFromReports);
    if (!incomeBucket) return 0;
    const incomeCategoryIds = new Set(
      categories
        .filter((c) => c.bucketId === incomeBucket.id)
        .map((c) => c.id!),
    );
    const jan1 = new Date(new Date().getFullYear(), 0, 1);
    jan1.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return transactions
      .filter((txn) => {
        const d = new Date(txn.date);
        return incomeCategoryIds.has(txn.categoryId) && d >= jan1 && d <= today;
      })
      .reduce((sum, txn) => sum + txn.amount + (txn.transactionCost || 0), 0);
  }, [transactions, categories, buckets]);

  // Returns the absolute effective target for a budget.
  // When goalPercentage is set: max(percentage × YTD income, optional floor).
  // Otherwise: abs(amount + transactionCost) as before.
  const getEffectiveBudgetTarget = useCallback(
    (budget: Budget): number => {
      if (budget.goalPercentage && budget.goalPercentage > 0) {
        const percentageAmount =
          (budget.goalPercentage / 100) * yearToDateIncome;
        const floor = Math.abs(
          (budget.amount || 0) + (budget.transactionCost || 0),
        );
        return Math.max(percentageAmount, floor);
      }
      return Math.abs(budget.amount + (budget.transactionCost || 0));
    },
    [yearToDateIncome],
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

  const getProgressPercentage = (occ: BudgetOccurrence): number => {
    const budget = occ.budget;
    const effectiveTarget = getEffectiveBudgetTarget(budget);

    if (effectiveTarget === 0) return 0;

    const isExpense = isExpenseBudget(budget);

    if (isExpense) {
      return Math.min(100, (Math.abs(occ.amountPaid) / effectiveTarget) * 100);
    } else {
      return Math.min(100, (occ.amountPaid / effectiveTarget) * 100);
    }
  };

  const getBudgetPeriodBoundaries = (
    period: "month" | "quarter" | "year",
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
    period: "month" | "quarter" | "year",
    occurrences: BudgetOccurrence[],
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

    occurrences.forEach((occ) => {
      const occDate = new Date(occ.dueDate);
      occDate.setHours(0, 0, 0, 0);

      const effectiveAbs = getEffectiveBudgetTarget(occ.budget);
      const isExpense = isExpenseBudget(occ.budget);
      const budgetAmount = isExpense ? -effectiveAbs : effectiveAbs;

      // Planned amounts are based on budget due date and active budgets only.
      if (occ.budget.isActive && occDate >= start && occDate <= end) {
        if (budgetAmount < 0) {
          totalExpense += Math.abs(budgetAmount);
        } else {
          totalIncome += budgetAmount;
        }
      }

      // Paid amounts are based on actual linked transaction dates.
      occ.linkedTransactions.forEach((txn) => {
        const txnDate = new Date(txn.date);
        txnDate.setHours(0, 0, 0, 0);

        if (txnDate >= start && txnDate <= end) {
          const txnAmount = txn.amount + (txn.transactionCost || 0);
          if (budgetAmount < 0) {
            expensePaid += Math.abs(txnAmount);
          } else {
            incomePaid += txnAmount;
          }
        }
      });
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
      calculateBudgetedAmounts(budgetSummaryPeriod, visibleBudgetOccurrences);

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

  const visibleBudgetOccurrences = generateBudgetOccurrences(
    visibleBudgetHorizonDays,
  );

  const allGoals = useMemo(() => {
    const visibleGoals = visibleBudgetOccurrences.filter(
      (occ) => occ.budget.isGoal,
    );

    const visibleGoalBudgetIds = new Set(
      visibleGoals.map((goal) => goal.budgetId),
    );

    const extendedGoalOccurrences = generateBudgetOccurrences(
      GOAL_CAROUSEL_EXTENDED_HORIZON_DAYS,
    ).filter((occ) => occ.budget.isGoal);

    // Only append one representative occurrence for goal budgets hidden by
    // the normal 30-day horizon; keep currently visible goal entries intact.
    const hiddenGoalsByBudget = new Map<number, BudgetOccurrence>();
    extendedGoalOccurrences.forEach((goalOcc) => {
      if (visibleGoalBudgetIds.has(goalOcc.budgetId)) {
        return;
      }

      const existing = hiddenGoalsByBudget.get(goalOcc.budgetId);
      if (!existing || goalOcc.dueDate.getTime() < existing.dueDate.getTime()) {
        hiddenGoalsByBudget.set(goalOcc.budgetId, goalOcc);
      }
    });

    const goals = [
      ...visibleGoals,
      ...Array.from(hiddenGoalsByBudget.values()),
    ];

    // Sort completed goals first, then incomplete; due date ascending within each group.
    return goals.sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) {
        return a.isCompleted ? -1 : 1;
      }

      const dateCompare = a.dueDate.getTime() - b.dueDate.getTime();
      if (dateCompare !== 0) {
        return dateCompare;
      }

      // For same due date, lower target goals come first.
      const targetCompare =
        getEffectiveBudgetTarget(a.budget) - getEffectiveBudgetTarget(b.budget);
      if (targetCompare !== 0) {
        return targetCompare;
      }

      // If target also matches, show higher paid progress first.
      const paidCompare = Math.abs(b.amountPaid) - Math.abs(a.amountPaid);
      if (paidCompare !== 0) {
        return paidCompare;
      }

      // Keep deterministic order when due dates are equal.
      return (a.budgetId || 0) - (b.budgetId || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBudgetOccurrences, getEffectiveBudgetTarget]);

  const activeGoals = useMemo(
    () => allGoals.filter((goal) => !goal.isCompleted).slice(0, 2),
    [allGoals],
  );

  const mostRecentCompletedGoal = useMemo(() => {
    const completedGoals = allGoals
      .filter((goal) => goal.isCompleted)
      .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
    return completedGoals.length > 0 ? completedGoals[0] : null;
  }, [allGoals]);

  const groupedBudgets = useMemo(
    () => groupedOccurrences(visibleBudgetOccurrences),
    [visibleBudgetOccurrences],
  );

  const hasMoreBudgetOccurrences = hasBudgetOccurrencesBeyondHorizon(
    visibleBudgetHorizonDays,
  );

  const getInitialGoalIndex = (): number => {
    const firstIncompleteIndex = allGoals.findIndex(
      (goal) => !goal.isCompleted,
    );

    if (firstIncompleteIndex >= 0) {
      return firstIncompleteIndex;
    }

    // If all goals are completed, default to the most recent completed goal.
    let mostRecentCompletedIndex = -1;
    let mostRecentCompletedDueDate = Number.NEGATIVE_INFINITY;

    allGoals.forEach((goal, index) => {
      if (!goal.isCompleted) {
        return;
      }

      const dueDate = goal.dueDate.getTime();
      if (dueDate > mostRecentCompletedDueDate) {
        mostRecentCompletedDueDate = dueDate;
        mostRecentCompletedIndex = index;
      }
    });

    return mostRecentCompletedIndex >= 0 ? mostRecentCompletedIndex : 0;
  };

  useEffect(() => {
    setCurrentGoalIndex(getInitialGoalIndex());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allGoals.length]);

  useEffect(() => {
    if (budgetHttpReadonlyExperimentActive) {
      return;
    }

    if (!isDebugModeEnabled()) {
      return;
    }

    const selectedGoal = allGoals[currentGoalIndex];
    console.info("Goal carousel diagnostics", {
      currentGoalIndex,
      totalGoals: allGoals.length,
      selectedGoal: selectedGoal
        ? {
            budgetId: selectedGoal.budgetId,
            description: selectedGoal.budget.description,
            budgetSnapshotId: selectedGoal.budgetSnapshotId,
            dueDate: selectedGoal.dueDate.toISOString(),
            amountPaid: selectedGoal.amountPaid,
            linkedTransactions: selectedGoal.linkedTransactions.length,
            linkedTransactionSnapshotIds: Array.from(
              new Set(
                selectedGoal.linkedTransactions.map(
                  (txn) => txn.budgetSnapshotId,
                ),
              ),
            ),
            isCompleted: selectedGoal.isCompleted,
          }
        : null,
      goals: allGoals.map((goal) => ({
        budgetId: goal.budgetId,
        description: goal.budget.description,
        budgetSnapshotId: goal.budgetSnapshotId,
        dueDate: goal.dueDate.toISOString(),
        amountPaid: goal.amountPaid,
        linkedTransactions: goal.linkedTransactions.length,
        linkedTransactionSnapshotIds: Array.from(
          new Set(goal.linkedTransactions.map((txn) => txn.budgetSnapshotId)),
        ),
        isCompleted: goal.isCompleted,
      })),
    });
  }, [allGoals, budgetHttpReadonlyExperimentActive, currentGoalIndex]);

  const handleGoalPrevious = () => {
    if (allGoals.length <= 1) return;
    setCurrentGoalIndex((prev) =>
      prev === 0 ? allGoals.length - 1 : prev - 1,
    );
  };

  const handleGoalNext = () => {
    if (allGoals.length <= 1) return;
    setCurrentGoalIndex((prev) =>
      prev === allGoals.length - 1 ? 0 : prev + 1,
    );
  };

  const selectedReadInputsTruncated =
    selectedReadLoadMeta?.budgetTruncated === true ||
    selectedReadLoadMeta?.budgetSnapshotTruncated === true ||
    selectedReadLoadMeta?.transactionTruncated === true;

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
              onClick={() => history.push("/budget/history")}
              title="Budget History"
            >
              <IonIcon icon={timeOutline} />
            </IonButton>
            {!budgetHttpReadonlyExperimentActive && (
              <>
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
              </>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Delete Confirmation - Multi-Option */}
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => {
            setShowDeleteConfirm(false);
            setDeleteAnalysis(null);
            setSqliteDeletePlan(null);
          }}
          header="Delete Budget"
          message={
            sqliteDeletePlan
              ? `This permanently removes the Budget and ${sqliteDeletePlan.snapshotCount} unlinked snapshot(s) from SQLite. Transaction dependencies: ${sqliteDeletePlan.transactionDependencyCount}. No transactions will be unlinked or deleted. Rotate the authority checkpoint before restart.`
              : deleteAnalysis
              ? deleteAnalysis.totalSnapshots === 0
                ? "This budget has no snapshots. Delete it?"
                : deleteAnalysis.linkedSnapshots.length > 0 &&
                    deleteAnalysis.unlinkedSnapshots.length > 0
                  ? `This budget has ${deleteAnalysis.unlinkedSnapshots.length} snapshot(s) with no transactions and ${deleteAnalysis.linkedSnapshots.length} snapshot(s) with linked transactions. Choose an action below.`
                  : deleteAnalysis.linkedSnapshots.length > 0
                    ? `This budget has ${deleteAnalysis.linkedSnapshots.length} snapshot(s) with linked transactions. Deactivate to keep history.`
                    : `This budget has ${deleteAnalysis.unlinkedSnapshots.length} snapshot(s) with no linked transactions. Delete them?`
              : "Loading..."
          }
          buttons={
            sqliteDeletePlan
              ? [
                  {
                    text: "Cancel",
                    role: "cancel",
                    handler: () => {
                      setShowDeleteConfirm(false);
                      setSqliteDeletePlan(null);
                    },
                  },
                  {
                    text: `Delete Budget + ${sqliteDeletePlan.snapshotCount} Snapshot(s)`,
                    role: "destructive" as const,
                    handler: () => handleConfirmDelete("deleteSqlite"),
                  },
                ]
              : deleteAnalysis
              ? [
                  {
                    text: "Cancel",
                    role: "cancel",
                    handler: () => {
                      setShowDeleteConfirm(false);
                      setDeleteAnalysis(null);
                    },
                  },
                  // Option 1: Delete Budget (only if no snapshots)
                  ...(deleteAnalysis.totalSnapshots === 0
                    ? [
                        {
                          text: "Delete Budget",
                          role: "destructive" as const,
                          handler: () => handleConfirmDelete("delete"),
                        },
                      ]
                    : []),
                  // Option 2: Delete Unlinked Snapshots (only if unlinked exist)
                  ...(deleteAnalysis.unlinkedSnapshots.length > 0
                    ? [
                        {
                          text: `Delete Unlinked Snapshots (${deleteAnalysis.unlinkedSnapshots.length})`,
                          role: "destructive" as const,
                          handler: () => handleConfirmDelete("deleteUnlinked"),
                        },
                      ]
                    : []),
                  // Option 3: Deactivate Budget (if linked snapshots exist)
                  ...(deleteAnalysis.linkedSnapshots.length > 0
                    ? [
                        {
                          text: "Deactivate Budget",
                          role: "destructive" as const,
                          handler: () => handleConfirmDelete("deactivate"),
                        },
                      ]
                    : []),
                ]
              : [
                  {
                    text: "Cancel",
                    role: "cancel",
                    handler: () => setShowDeleteConfirm(false),
                  },
                ]
          }
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
            {(budgetReadExperimentEnabled ||
              budgetDefinitionWriteExperimentActive) && (
              <IonCard color={budgetHttpReadonlyExperimentActive ? "warning" : undefined}>
                <IonCardContent>
                  <IonText>
                    <h3>
                      {budgetDefinitionWriteExperimentActive
                        ? budgetDeleteWriteExperimentActive
                          ? "Budget lifecycle SQLite write experiments are active"
                          : "Budget Definitions SQLite write experiment is active"
                        : "Budget read experiment is active"}
                    </h3>
                    <p>
                      Backend: {repositoryBackend}.{" "}
                      {budgetDefinitionWriteExperimentActive
                        ? budgetDeleteWriteExperimentActive
                          ? rehearsal.authoritativeMode
                            ? "SQLite authoritative mode is active. Budget create/update remains available, and an eligible unused Budget plus all of its unlinked snapshots may be deleted only after a reviewed dry-run. Transaction dependencies block deletion; no unlinking or repair runs."
                            : "Writes go to disposable local SQLite only. Dexie remains authoritative. Budget create/update remains available, and eligible unused Budget deletion is dry-run-first. Transaction dependencies block deletion; no unlinking or repair runs."
                          : rehearsal.authoritativeMode
                            ? "SQLite authoritative mode is active. Supported Budget definition create/update writes use the verified local SQLite database. Delete and automatic snapshot lifecycle actions remain unavailable."
                            : "Writes go to disposable local SQLite only. Dexie remains authoritative. Create/update definitions only; existing snapshots, Budget History, and transaction links remain unchanged. Delete and snapshot lifecycle actions are unavailable."
                        : budgetHttpReadonlyExperimentActive
                        ? "Budget inputs are loaded through selected-read http-readonly; budget edits and snapshot lifecycle actions are disabled. Switch back to Dexie for normal Budget behavior."
                        : "The experiment flag is on, but the selected backend is Dexie, so Budget uses the existing Dexie read and lifecycle path."}
                    </p>
                    {budgetDefinitionWriteExperimentActive && (
                      <p>
                        Recurrence edits affect only the definition and may
                        influence future snapshot generation when a separate
                        lifecycle process later runs. Re-import SQLite before
                        clean parity checks.
                      </p>
                    )}
                  </IonText>
                </IonCardContent>
              </IonCard>
            )}

            {budgetHttpReadonlyExperimentActive && selectedReadLoadMeta && (
              <IonCard color={selectedReadInputsTruncated ? "danger" : "light"}>
                <IonCardContent>
                  <IonText>
                    <p>
                      Selected-read inputs: budgets{" "}
                      {selectedReadLoadMeta.budgetLoadedCount}/
                      {selectedReadLoadMeta.budgetReportedCount ?? "-"},
                      snapshots{" "}
                      {selectedReadLoadMeta.budgetSnapshotLoadedCount}/
                      {selectedReadLoadMeta.budgetSnapshotReportedCount ?? "-"},
                      transactions{" "}
                      {selectedReadLoadMeta.transactionLoadedCount}/
                      {selectedReadLoadMeta.transactionReportedCount ?? "-"}.
                      {selectedReadInputsTruncated
                        ? " Inputs are capped, so Budget results should not be treated as full-confidence."
                        : " Inputs are not truncated."}
                    </p>
                  </IonText>
                </IonCardContent>
              </IonCard>
            )}

            {/* Active Goals Section - Scrollable */}
            {allGoals.length > 0 && (
              <div style={{ marginBottom: "24px" }}>
                {(() => {
                  if (allGoals.length === 0) return null;

                  const currentGoal = allGoals[currentGoalIndex];

                  return (
                    <IonCard
                      onClick={() => {
                        if (budgetHttpReadonlyExperimentActive) {
                          return;
                        }
                        setSelectedBudgetForCompletion(currentGoal);
                        setShowCompleteModal(true);
                      }}
                      style={{
                        cursor: budgetHttpReadonlyExperimentActive
                          ? "default"
                          : "pointer",
                        margin: "0",
                      }}
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
                            disabled={allGoals.length <= 1}
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
                            disabled={allGoals.length <= 1}
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
                                  currentGoal.budget.recipientId,
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
                                  },
                                )}
                              </p>
                            </IonCol>
                            <IonCol size="4" style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  fontSize: "1.2rem",
                                  fontWeight: "bold",
                                  color: isExpenseBudget(currentGoal.budget)
                                    ? "#eb445c"
                                    : "#009688",
                                }}
                              >
                                {Math.abs(
                                  currentGoal.amountPaid,
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                              <div
                                style={{ fontSize: "0.85rem", color: "#999" }}
                              >
                                of{" "}
                                {getEffectiveBudgetTarget(
                                  currentGoal.budget,
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                                {currentGoal.budget.goalPercentage ? (
                                  <span
                                    style={{
                                      marginLeft: "4px",
                                      fontSize: "0.75rem",
                                      color: "#aaa",
                                    }}
                                  >
                                    ({currentGoal.budget.goalPercentage}% of
                                    income)
                                  </span>
                                ) : null}
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
                                        currentGoal,
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <div className="progress-percentage">
                                  {Math.round(
                                    getProgressPercentage(currentGoal),
                                  )}
                                  %
                                </div>
                              </div>
                            </IonCol>
                          </IonRow>

                          <IonRow style={{ marginTop: "12px", gap: "8px" }}>
                            {/* Status Badge */}
                            {currentGoal.isCompleted && (
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
                            )}
                            {(!budgetHttpReadonlyExperimentActive ||
                              budgetDefinitionWriteExperimentActive) && (
                              <IonCol
                                style={{ paddingRight: 0, textAlign: "right" }}
                              >
                                {(!budgetHttpReadonlyExperimentActive ||
                                  budgetDeleteWriteExperimentActive) && (
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
                                )}
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  style={{ marginRight: "0" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    history.push(
                                      `/budget/edit/${currentGoal.budget.id}`,
                                    );
                                  }}
                                  title="Edit Goal"
                                >
                                  <IonIcon icon={createOutline} slot="end" />
                                </IonButton>
                                {!budgetHttpReadonlyExperimentActive && (
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
                                    disabled={budgetDeleteBusy}
                                  >
                                    <IonIcon icon={trashOutline} slot="end" />
                                  </IonButton>
                                )}
                              </IonCol>
                            )}
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
              <>
                {groupedBudgets.map(([timeGroup, occurrences]) => (
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
                          key={`${occ.budgetSnapshotId ?? "legacy"}-${occ.budgetId}-${occ.dueDate.getTime()}`}
                          onClick={() => {
                            if (budgetHttpReadonlyExperimentActive) {
                              return;
                            }
                            setSelectedBudgetForCompletion(occ);
                            setShowCompleteModal(true);
                          }}
                          style={{
                            cursor: budgetHttpReadonlyExperimentActive
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
                                      title={getAccountName(
                                        occ.budget.accountId,
                                      )}
                                    >
                                      {getAccountImage(occ.budget.accountId) ? (
                                        <IonImg
                                          src={getAccountImage(
                                            occ.budget.accountId,
                                          )}
                                          alt={getAccountName(
                                            occ.budget.accountId,
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
                                            occ.budget.accountId,
                                          ).charAt(0)}
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
                                            {getBucketName(
                                              occ.budget.categoryId,
                                            )}
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
                                          {getCategoryName(
                                            occ.budget.categoryId,
                                          )}
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
                                <div
                                  style={{ fontSize: "0.85rem", color: "#999" }}
                                >
                                  of{" "}
                                  {getEffectiveBudgetTarget(
                                    occ.budget,
                                  ).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  {occ.budget.goalPercentage ? (
                                    <span
                                      style={{
                                        marginLeft: "4px",
                                        fontSize: "0.75rem",
                                        color: "#aaa",
                                      }}
                                    >
                                      ({occ.budget.goalPercentage}% of income)
                                    </span>
                                  ) : null}
                                </div>
                                <IonProgressBar
                                  value={getProgressPercentage(occ) / 100}
                                  color={
                                    occ.isCompleted ? "success" : "primary"
                                  }
                                  style={{ marginTop: "4px" }}
                                />

                                {(!budgetHttpReadonlyExperimentActive ||
                                  budgetDefinitionWriteExperimentActive) && (
                                  <IonRow className="item-actions">
                                    <IonCol className="item-actions-container">
                                      {(!budgetHttpReadonlyExperimentActive ||
                                        budgetDeleteWriteExperimentActive) && (
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
                                          <IonIcon
                                            icon={linkOutline}
                                            slot="end"
                                          />
                                        </IonButton>
                                      )}
                                      <IonButton
                                        fill="clear"
                                        size="small"
                                        style={{ marginRight: "0" }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          history.push(
                                            `/budget/edit/${occ.budget.id}`,
                                          );
                                        }}
                                        title="Edit Budget Item"
                                      >
                                        <IonIcon
                                          icon={createOutline}
                                          slot="end"
                                        />
                                      </IonButton>
                                      {!budgetHttpReadonlyExperimentActive && (
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
                                          disabled={budgetDeleteBusy}
                                        >
                                          <IonIcon
                                            icon={trashOutline}
                                            slot="end"
                                          />
                                        </IonButton>
                                      )}
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

                <div style={{ padding: "16px 0 32px" }}>
                  {budgetHttpReadonlyExperimentActive ? (
                    <IonText color="medium">
                      <p style={{ textAlign: "center", fontSize: "0.85rem" }}>
                        Load more budget items is disabled in the read-only
                        Budget experiment.
                      </p>
                    </IonText>
                  ) : hasMoreBudgetOccurrences ? (
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={loadMoreBudgetOccurrences}
                      disabled={isLoadingMoreBudgetOccurrences}
                    >
                      {isLoadingMoreBudgetOccurrences ? (
                        <IonSpinner slot="start" name="crescent" />
                      ) : (
                        <IonIcon slot="start" icon={arrowDownCircle} />
                      )}
                      Load 30 More Days
                    </IonButton>
                  ) : (
                    <IonText color="medium">
                      <p style={{ textAlign: "center", fontSize: "0.85rem" }}>
                        No more budget items to load
                      </p>
                    </IonText>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </IonContent>

      {(!budgetHttpReadonlyExperimentActive ||
        budgetDefinitionWriteExperimentActive) && (
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            onClick={() => history.push("/budget/add")}
            title="Add Budget"
          >
            <IonIcon icon={addOutline} />
          </IonFabButton>
        </IonFab>
      )}

      {/* Complete Budget Modal */}
      {!budgetHttpReadonlyExperimentActive && selectedBudgetForCompletion && (
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
      {!budgetHttpReadonlyExperimentActive && (
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

      {/* Import Modal */}
      {!budgetHttpReadonlyExperimentActive && (
        <ImportModal
          isOpen={showImportModal}
          onDidDismiss={() => setShowImportModal(false)}
          onImportComplete={() => {
            setShowImportModal(false);
            // Reload budgets
            window.location.reload();
          }}
        />
      )}
    </IonPage>
  );
};

export default BudgetPage;

import type {
  Account,
  Bucket,
  Budget,
  BudgetSnapshot,
  Category,
  Recipient,
  SmsImportTemplate,
  Transaction,
} from "../db";
import {
  getRepositoryBackend,
  resolveRepositoryBackend,
  type RepositoryBackend,
} from "./adapterSelection";
import { db } from "../db";
import * as accountRepository from "./accountRepository";
import * as budgetRepository from "./budgetRepository";
import * as categoryRepository from "./categoryRepository";
import * as recipientRepository from "./recipientRepository";
import * as transactionRepository from "./transactionRepository";
import * as budgetHttpRepository from "./http/budgetHttpRepository";
import * as lookupHttpRepositories from "./http/lookupHttpRepositories";
import * as transactionHttpRepository from "./http/transactionHttpRepository";
import type {
  AccountDto,
  ApiListResponse,
  BudgetDto,
  BudgetSnapshotDto,
  BucketDto,
  CategoryDto,
  RecipientDto,
  SmsImportTemplateDto,
  TransactionDto,
} from "./http/types";

export type SelectedReadRepositorySource = "dexie" | "http-readonly";

type ReadList<DexieRow, HttpRow> =
  | Promise<DexieRow[]>
  | Promise<ApiListResponse<HttpRow>>;

type ReadOne<DexieRow, HttpRow> = Promise<DexieRow | HttpRow | undefined>;

interface DexieListOptions {
  limit?: number;
  offset?: number;
}

interface DexiePreviewTable<Row> {
  offset: (offset: number) => {
    limit: (limit: number) => {
      toArray: () => Promise<Row[]>;
    };
  };
  toArray: () => Promise<Row[]>;
}

interface IdRow {
  id?: number;
}

interface NamedRow extends IdRow {
  name?: string | null;
}

interface OrderedRow extends IdRow {
  displayOrder?: number | null;
}

const applyDexiePage = <Row>(
  table: DexiePreviewTable<Row>,
  options: DexieListOptions | undefined,
): Promise<Row[]> => {
  if (typeof options?.limit !== "number") {
    return table.toArray();
  }

  return table.offset(options.offset ?? 0).limit(options.limit).toArray();
};

const compareText = (left: string | null | undefined, right: string | null | undefined): number => {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";

  if (normalizedLeft < normalizedRight) {
    return -1;
  }

  if (normalizedLeft > normalizedRight) {
    return 1;
  }

  return 0;
};

const compareIds = (left: IdRow, right: IdRow): number =>
  (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER);

const compareByNameThenId = <Row extends NamedRow>(
  left: Row,
  right: Row,
): number => compareText(left.name, right.name) || compareIds(left, right);

const compareByDisplayOrderThenId = <Row extends OrderedRow>(
  left: Row,
  right: Row,
): number =>
  (left.displayOrder ?? 0) - (right.displayOrder ?? 0) ||
  compareIds(left, right);

const transactionTime = (date: Date | string | undefined): number => {
  if (date instanceof Date) {
    return date.getTime();
  }

  if (typeof date === "string") {
    return new Date(date).getTime();
  }

  return 0;
};

const transactionCombinedTotal = (transaction: Transaction): number =>
  transaction.amount + (transaction.transactionCost ?? 0);

const compareTransactionsByLivePageOrder = (
  left: Transaction,
  right: Transaction,
): number => {
  const dateDifference = transactionTime(right.date) - transactionTime(left.date);
  if (dateDifference !== 0) {
    return dateDifference;
  }

  const leftTotal = transactionCombinedTotal(left);
  const rightTotal = transactionCombinedTotal(right);
  const isLeftIncoming = leftTotal >= 0;
  const isRightIncoming = rightTotal >= 0;

  if (isLeftIncoming && !isRightIncoming) {
    return -1;
  }

  if (!isLeftIncoming && isRightIncoming) {
    return 1;
  }

  return leftTotal - rightTotal || compareIds(left, right);
};

const transactionMatchesFilters = (
  transaction: Transaction,
  options: transactionHttpRepository.TransactionListOptions | undefined,
): boolean => {
  if (options?.accountId !== undefined && transaction.accountId !== options.accountId) {
    return false;
  }

  if (options?.categoryId !== undefined && transaction.categoryId !== options.categoryId) {
    return false;
  }

  if (options?.recipientId !== undefined && transaction.recipientId !== options.recipientId) {
    return false;
  }

  if (
    options?.budgetSnapshotId !== undefined &&
    transaction.budgetSnapshotId !== options.budgetSnapshotId
  ) {
    return false;
  }

  if (options?.isTransfer !== undefined) {
    const isTransfer = transaction.isTransfer === true;
    if (isTransfer !== options.isTransfer) {
      return false;
    }
  }

  const time = transactionTime(transaction.date);
  if (
    options?.dateFrom !== undefined &&
    time < transactionTime(options.dateFrom)
  ) {
    return false;
  }

  if (options?.dateTo !== undefined && time > transactionTime(options.dateTo)) {
    return false;
  }

  return true;
};

const applyTransactionFiltersAndPage = async (
  options: transactionHttpRepository.TransactionListOptions | undefined,
): Promise<Transaction[]> => {
  const transactions = await db.transactions.toArray();
  const sortedRows = transactions
    .filter((transaction) => transactionMatchesFilters(transaction, options))
    .sort(compareTransactionsByLivePageOrder);

  if (typeof options?.limit !== "number") {
    return sortedRows;
  }

  const offset = options.offset ?? 0;
  return sortedRows.slice(offset, offset + options.limit);
};

const countSelectedReadTransactions = async (
  options: transactionHttpRepository.TransactionCountOptions | undefined,
): Promise<number> => {
  if (!options || Object.keys(options).length === 0) {
    return transactionRepository.getTransactionCount();
  }

  const transactions = await db.transactions.toArray();
  return transactions.filter((transaction) =>
    transactionMatchesFilters(transaction, options),
  ).length;
};

const budgetTime = (date: Date | string | undefined): number => {
  if (date instanceof Date) {
    return date.getTime();
  }

  if (typeof date === "string") {
    return new Date(date).getTime();
  }

  return 0;
};

const compareBudgetsByDueDateThenId = (
  left: Budget,
  right: Budget,
): number => budgetTime(left.dueDate) - budgetTime(right.dueDate) ||
  compareIds(left, right);

const budgetMatchesFilters = (
  budget: Budget,
  options: budgetHttpRepository.BudgetListOptions | undefined,
): boolean => {
  if (options?.activeOnly === true && budget.isActive !== true) {
    return false;
  }

  if (options?.categoryId !== undefined && budget.categoryId !== options.categoryId) {
    return false;
  }

  if (options?.accountId !== undefined && budget.accountId !== options.accountId) {
    return false;
  }

  if (options?.recipientId !== undefined && budget.recipientId !== options.recipientId) {
    return false;
  }

  if (options?.frequency !== undefined && budget.frequency !== options.frequency) {
    return false;
  }

  if (options?.isGoal !== undefined && budget.isGoal !== options.isGoal) {
    return false;
  }

  return true;
};

const applyBudgetFiltersAndPage = async (
  options: budgetHttpRepository.BudgetListOptions | undefined,
): Promise<Budget[]> => {
  const budgets = await db.budgets.toArray();
  const sortedRows = budgets
    .filter((budget) => budgetMatchesFilters(budget, options))
    .sort(compareBudgetsByDueDateThenId);

  if (typeof options?.limit !== "number") {
    return sortedRows;
  }

  const offset = options.offset ?? 0;
  return sortedRows.slice(offset, offset + options.limit);
};

const compareBudgetSnapshotsByDueDateThenId = (
  left: BudgetSnapshot,
  right: BudgetSnapshot,
): number => budgetTime(right.dueDate) - budgetTime(left.dueDate) ||
  compareIds(left, right);

const budgetSnapshotMatchesFilters = (
  snapshot: BudgetSnapshot,
  options: budgetHttpRepository.BudgetSnapshotListOptions | undefined,
): boolean => {
  if (options?.budgetId !== undefined && snapshot.budgetId !== options.budgetId) {
    return false;
  }

  if (options?.categoryId !== undefined && snapshot.categoryId !== options.categoryId) {
    return false;
  }

  if (options?.accountId !== undefined && snapshot.accountId !== options.accountId) {
    return false;
  }

  if (options?.recipientId !== undefined && snapshot.recipientId !== options.recipientId) {
    return false;
  }

  if (
    options?.isHistorical !== undefined &&
    snapshot.isHistorical !== options.isHistorical
  ) {
    return false;
  }

  const dueDateTime = budgetTime(snapshot.dueDate);
  if (
    options?.dateFrom !== undefined &&
    dueDateTime < budgetTime(options.dateFrom)
  ) {
    return false;
  }

  if (
    options?.dateTo !== undefined &&
    dueDateTime > budgetTime(options.dateTo)
  ) {
    return false;
  }

  return true;
};

const applyBudgetSnapshotFiltersAndPage = async (
  options: budgetHttpRepository.BudgetSnapshotListOptions | undefined,
): Promise<BudgetSnapshot[]> => {
  const snapshots = await db.budgetSnapshots.toArray();
  const sortedRows = snapshots
    .filter((snapshot) => budgetSnapshotMatchesFilters(snapshot, options))
    .sort(compareBudgetSnapshotsByDueDateThenId);

  if (typeof options?.limit !== "number") {
    return sortedRows;
  }

  const offset = options.offset ?? 0;
  return sortedRows.slice(offset, offset + options.limit);
};

const applySortedDexiePage = async <Row>(
  table: DexiePreviewTable<Row>,
  options: DexieListOptions | undefined,
  compare: (left: Row, right: Row) => number,
): Promise<Row[]> => {
  const rows = await table.toArray();
  const sortedRows = [...rows].sort(compare);

  if (typeof options?.limit !== "number") {
    return sortedRows;
  }

  const offset = options.offset ?? 0;
  return sortedRows.slice(offset, offset + options.limit);
};

export interface SelectedReadRepositories {
  source: SelectedReadRepositorySource;
  transactions: {
    list: (
      options?: transactionHttpRepository.TransactionListOptions,
    ) => ReadList<Transaction, TransactionDto>;
    getById: (id: number) => ReadOne<Transaction, TransactionDto>;
    count: (
      options?: transactionHttpRepository.TransactionCountOptions,
    ) => Promise<number>;
  };
  accounts: {
    list: (
      options?: lookupHttpRepositories.LookupListOptions,
    ) => ReadList<Account, AccountDto>;
    getById: (id: number) => ReadOne<Account, AccountDto>;
  };
  buckets: {
    list: (
      options?: lookupHttpRepositories.LookupListOptions,
    ) => ReadList<Bucket, BucketDto>;
    getById: (id: number) => ReadOne<Bucket, BucketDto>;
  };
  categories: {
    list: (
      options?: lookupHttpRepositories.CategoryListOptions,
    ) => ReadList<Category, CategoryDto>;
    getById: (id: number) => ReadOne<Category, CategoryDto>;
  };
  recipients: {
    list: (
      options?: lookupHttpRepositories.LookupListOptions,
    ) => ReadList<Recipient, RecipientDto>;
    getById: (id: number) => ReadOne<Recipient, RecipientDto>;
  };
  smsImportTemplates: {
    list: (
      options?: lookupHttpRepositories.SmsImportTemplateListOptions,
    ) => ReadList<SmsImportTemplate, SmsImportTemplateDto>;
    getById: (id: number) => ReadOne<SmsImportTemplate, SmsImportTemplateDto>;
  };
  budgets: {
    list: (
      options?: budgetHttpRepository.BudgetListOptions,
    ) => ReadList<Budget, BudgetDto>;
    getById: (id: number) => ReadOne<Budget, BudgetDto>;
  };
  budgetSnapshots: {
    list: (
      options?: budgetHttpRepository.BudgetSnapshotListOptions,
    ) => ReadList<BudgetSnapshot, BudgetSnapshotDto>;
    getById: (id: number) => ReadOne<BudgetSnapshot, BudgetSnapshotDto>;
    listForBudget: (
      budgetId: number,
      options?: Omit<budgetHttpRepository.BudgetSnapshotListOptions, "budgetId">,
    ) => ReadList<BudgetSnapshot, BudgetSnapshotDto>;
  };
}

const dexieReadRepositories: SelectedReadRepositories = {
  source: "dexie",
  transactions: {
    list: (options) => applyTransactionFiltersAndPage(options),
    getById: (id) => transactionRepository.getTransactionById(id),
    count: (options) => countSelectedReadTransactions(options),
  },
  accounts: {
    list: (options) =>
      applySortedDexiePage(db.accounts, options, compareByNameThenId),
    getById: (id) => accountRepository.getAccountById(id),
  },
  buckets: {
    list: (options) =>
      applySortedDexiePage(db.buckets, options, compareByDisplayOrderThenId),
    getById: (id) => categoryRepository.getBucketById(id),
  },
  categories: {
    list: (options) =>
      applySortedDexiePage(db.categories, options, compareByNameThenId),
    getById: (id) => categoryRepository.getCategoryById(id),
  },
  recipients: {
    list: (options) =>
      applySortedDexiePage(db.recipients, options, compareByNameThenId),
    getById: (id) => recipientRepository.getRecipientById(id),
  },
  smsImportTemplates: {
    list: (options) =>
      applySortedDexiePage(db.smsImportTemplates, options, compareByNameThenId),
    getById: (id) => db.smsImportTemplates.get(id),
  },
  budgets: {
    list: (options) => applyBudgetFiltersAndPage(options),
    getById: (id) => budgetRepository.getBudgetById(id),
  },
  budgetSnapshots: {
    list: (options) => applyBudgetSnapshotFiltersAndPage(options),
    getById: (id) => budgetRepository.getBudgetSnapshotById(id),
    listForBudget: (budgetId, options) =>
      applyBudgetSnapshotFiltersAndPage({ ...options, budgetId }),
  },
};

const httpReadonlyReadRepositories: SelectedReadRepositories = {
  source: "http-readonly",
  transactions: {
    list: (options) => transactionHttpRepository.listTransactions(options),
    getById: (id) => transactionHttpRepository.getTransactionById(id),
    count: (options) => transactionHttpRepository.countTransactions(options),
  },
  accounts: {
    list: (options) => lookupHttpRepositories.listAccounts(options),
    getById: (id) => lookupHttpRepositories.getAccountById(id),
  },
  buckets: {
    list: (options) => lookupHttpRepositories.listBuckets(options),
    getById: (id) => lookupHttpRepositories.getBucketById(id),
  },
  categories: {
    list: (options) => lookupHttpRepositories.listCategories(options),
    getById: (id) => lookupHttpRepositories.getCategoryById(id),
  },
  recipients: {
    list: (options) => lookupHttpRepositories.listRecipients(options),
    getById: (id) => lookupHttpRepositories.getRecipientById(id),
  },
  smsImportTemplates: {
    list: (options) => lookupHttpRepositories.listSmsImportTemplates(options),
    getById: (id) => lookupHttpRepositories.getSmsImportTemplateById(id),
  },
  budgets: {
    list: (options) => budgetHttpRepository.listBudgets(options),
    getById: (id) => budgetHttpRepository.getBudgetById(id),
  },
  budgetSnapshots: {
    list: (options) => budgetHttpRepository.listBudgetSnapshots(options),
    getById: (id) => budgetHttpRepository.getBudgetSnapshotById(id),
    listForBudget: (budgetId, options) =>
      budgetHttpRepository.listSnapshotsForBudget(budgetId, options),
  },
};

export const getSelectedReadRepositorySource = (
  configuredBackend: string | undefined,
): SelectedReadRepositorySource =>
  resolveRepositoryBackend(configuredBackend) === "dexie"
    ? "dexie"
    : "http-readonly";

export const getSelectedReadRepositoriesForBackend = (
  backend: RepositoryBackend,
): SelectedReadRepositories =>
  backend === "dexie" ? dexieReadRepositories : httpReadonlyReadRepositories;

export const getSelectedReadRepositories = (
  backend: RepositoryBackend = getRepositoryBackend(),
): SelectedReadRepositories => getSelectedReadRepositoriesForBackend(backend);

export const selectedReadRepositories = getSelectedReadRepositories();

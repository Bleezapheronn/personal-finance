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
    list: (options) => applyDexiePage(db.transactions, options),
    getById: (id) => transactionRepository.getTransactionById(id),
    count: () => transactionRepository.getTransactionCount(),
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
    list: (options) => applyDexiePage(db.budgets, options),
    getById: (id) => budgetRepository.getBudgetById(id),
  },
  budgetSnapshots: {
    list: (options) => applyDexiePage(db.budgetSnapshots, options),
    getById: (id) => budgetRepository.getBudgetSnapshotById(id),
    listForBudget: (budgetId) => budgetRepository.listSnapshotsForBudget(budgetId),
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
): SelectedReadRepositorySource => resolveRepositoryBackend(configuredBackend);

export const getSelectedReadRepositoriesForBackend = (
  backend: RepositoryBackend,
): SelectedReadRepositories =>
  backend === "http-readonly"
    ? httpReadonlyReadRepositories
    : dexieReadRepositories;

export const getSelectedReadRepositories = (
  backend: RepositoryBackend = getRepositoryBackend(),
): SelectedReadRepositories => getSelectedReadRepositoriesForBackend(backend);

export const selectedReadRepositories = getSelectedReadRepositories();

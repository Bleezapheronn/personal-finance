import type {
  Account,
  Bucket,
  Budget,
  BudgetSnapshot,
  Category,
  Recipient,
  Transaction,
} from "../../db";
import * as accountRepository from "../accountRepository";
import * as budgetRepository from "../budgetRepository";
import * as categoryRepository from "../categoryRepository";
import * as recipientRepository from "../recipientRepository";
import * as transactionRepository from "../transactionRepository";
import { LocalApiError } from "../../api/localApiClient";
import * as budgetHttpRepository from "./budgetHttpRepository";
import * as lookupHttpRepositories from "./lookupHttpRepositories";
import * as transactionHttpRepository from "./transactionHttpRepository";
import type {
  AccountDto,
  BudgetDto,
  BudgetSnapshotDto,
  BucketDto,
  CategoryDto,
  RecipientDto,
  TransactionDto,
} from "./types";

export interface LocalApiReadParityDiagnosticOptions {
  sampleSize?: number;
  logSummary?: boolean;
}

export interface LocalApiReadParityCheckResult {
  name: string;
  status: "pass" | "fail";
  mismatchCount: number;
  sampledIds?: number[];
  mismatches?: Array<{
    id?: number;
    field?: string;
    code: string;
  }>;
}

export interface LocalApiReadParityDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  comparedChecks: number;
  failedChecks: number;
  totalMismatches: number;
  checks: LocalApiReadParityCheckResult[];
}

type ComparableValue = string | number | boolean | null;
type ComparableRecord = Record<string, ComparableValue>;
type LocalApiReadParityMismatch = NonNullable<
  LocalApiReadParityCheckResult["mismatches"]
>[number];

const DEFAULT_SAMPLE_SIZE = 5;

const normalizeNullable = (value: unknown): ComparableValue => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  return String(value);
};

const normalizeBoolean = (value: unknown): ComparableValue => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return String(value).toLowerCase() === "true";
};

const normalizeLegacyDefaultFalseBoolean = (value: unknown): ComparableValue =>
  value === undefined || value === null ? false : normalizeBoolean(value);

const normalizeDate = (value: unknown): ComparableValue => {
  if (value === undefined || value === null) {
    return null;
  }

  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isNaN(time) ? String(value) : time;
};

const normalizeJsonText = (value: unknown): ComparableValue => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }

  return JSON.stringify(value);
};

const numericIds = <Row extends { id?: number }>(rows: Row[]): number[] =>
  rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number")
    .sort((left, right) => left - right);

const deterministicSampleIds = <Row extends { id?: number }>(
  rows: Row[],
  sampleSize: number,
): number[] => {
  const ids = numericIds(rows);
  if (ids.length <= sampleSize) {
    return ids;
  }

  const selected = new Set<number>();
  selected.add(ids[0]);
  selected.add(ids[ids.length - 1]);

  const slots = Math.max(sampleSize - selected.size, 0);
  for (let index = 1; index <= slots; index += 1) {
    const position = Math.floor((index * (ids.length - 1)) / (slots + 1));
    selected.add(ids[position]);
  }

  return Array.from(selected).sort((left, right) => left - right).slice(0, sampleSize);
};

const compareRecords = (
  expected: ComparableRecord,
  actual: ComparableRecord,
  id?: number,
): LocalApiReadParityMismatch[] => {
  const mismatches: LocalApiReadParityMismatch[] = [];

  Object.entries(expected).forEach(([field, expectedValue]) => {
    if (actual[field] !== expectedValue) {
      mismatches.push({
        id,
        field,
        code: "field_mismatch",
      });
    }
  });

  return mismatches;
};

const transactionComparable = (
  transaction: Transaction | TransactionDto,
): ComparableRecord => ({
  id: normalizeNullable(transaction.id),
  categoryId: normalizeNullable(transaction.categoryId),
  paymentChannelId: normalizeNullable(transaction.paymentChannelId),
  accountId: normalizeNullable(transaction.accountId),
  recipientId: normalizeNullable(transaction.recipientId),
  date: normalizeDate(transaction.date),
  amount: normalizeNullable(transaction.amount),
  originalAmount: normalizeNullable(transaction.originalAmount),
  originalCurrency: normalizeNullable(transaction.originalCurrency),
  exchangeRate: normalizeNullable(transaction.exchangeRate),
  transactionCost: normalizeNullable(transaction.transactionCost),
  transferPairId: normalizeNullable(transaction.transferPairId),
  isTransfer: normalizeBoolean(transaction.isTransfer),
  budgetId: normalizeNullable(transaction.budgetId),
  occurrenceDate: normalizeDate(transaction.occurrenceDate),
  budgetSnapshotId: normalizeNullable(transaction.budgetSnapshotId),
});

const accountComparable = (account: Account | AccountDto): ComparableRecord => ({
  id: normalizeNullable(account.id),
  currency: normalizeNullable(account.currency),
  isActive: normalizeBoolean(account.isActive),
  isCredit: normalizeLegacyDefaultFalseBoolean(account.isCredit),
  creditLimit: normalizeNullable(account.creditLimit),
  createdAt: normalizeDate(account.createdAt),
  updatedAt: normalizeDate(account.updatedAt),
});

const bucketComparable = (bucket: Bucket | BucketDto): ComparableRecord => ({
  id: normalizeNullable(bucket.id),
  minPercentage: normalizeNullable(bucket.minPercentage),
  maxPercentage: normalizeNullable(bucket.maxPercentage),
  minFixedAmount: normalizeNullable(bucket.minFixedAmount),
  isActive: normalizeBoolean(bucket.isActive),
  displayOrder: normalizeNullable(bucket.displayOrder),
  excludeFromReports: normalizeBoolean(bucket.excludeFromReports),
  createdAt: normalizeDate(bucket.createdAt),
  updatedAt: normalizeDate(bucket.updatedAt),
});

const categoryComparable = (
  category: Category | CategoryDto,
): ComparableRecord => ({
  id: normalizeNullable(category.id),
  bucketId: normalizeNullable(category.bucketId),
  isActive: normalizeBoolean(category.isActive),
  createdAt: normalizeDate(category.createdAt),
  updatedAt: normalizeDate(category.updatedAt),
});

const recipientComparable = (
  recipient: Recipient | RecipientDto,
): ComparableRecord => ({
  id: normalizeNullable(recipient.id),
  isActive: normalizeBoolean(recipient.isActive),
  createdAt: normalizeDate(recipient.createdAt),
  updatedAt: normalizeDate(recipient.updatedAt),
});

const budgetComparable = (budget: Budget | BudgetDto): ComparableRecord => ({
  id: normalizeNullable(budget.id),
  categoryId: normalizeNullable(budget.categoryId),
  paymentChannelId: normalizeNullable(budget.paymentChannelId),
  accountId: normalizeNullable(budget.accountId),
  recipientId: normalizeNullable(budget.recipientId),
  amount: normalizeNullable(budget.amount),
  transactionCost: normalizeNullable(budget.transactionCost),
  frequency: normalizeNullable(budget.frequency),
  frequencyDetails: normalizeJsonText(budget.frequencyDetails),
  isGoal: normalizeBoolean(budget.isGoal),
  isFlexible: normalizeLegacyDefaultFalseBoolean(budget.isFlexible),
  goalPercentage: normalizeNullable(budget.goalPercentage),
  goalDirection: normalizeNullable(budget.goalDirection),
  isActive: normalizeBoolean(budget.isActive),
  remainingCyclesTotal: normalizeNullable(budget.remainingCyclesTotal),
  dueDate: normalizeDate(budget.dueDate),
  createdAt: normalizeDate(budget.createdAt),
  updatedAt: normalizeDate(budget.updatedAt),
});

const budgetSnapshotComparable = (
  snapshot: BudgetSnapshot | BudgetSnapshotDto,
): ComparableRecord => ({
  id: normalizeNullable(snapshot.id),
  budgetId: normalizeNullable(snapshot.budgetId),
  occurrenceDate: normalizeDate(snapshot.occurrenceDate),
  dueDate: normalizeDate(snapshot.dueDate),
  cycleIndex: normalizeNullable(snapshot.cycleIndex),
  categoryId: normalizeNullable(snapshot.categoryId),
  accountId: normalizeNullable(snapshot.accountId),
  recipientId: normalizeNullable(snapshot.recipientId),
  amount: normalizeNullable(snapshot.amount),
  transactionCost: normalizeNullable(snapshot.transactionCost),
  frequency: normalizeNullable(snapshot.frequency),
  frequencyDetails: normalizeJsonText(snapshot.frequencyDetails),
  isGoal: normalizeBoolean(snapshot.isGoal),
  isFlexible: normalizeLegacyDefaultFalseBoolean(snapshot.isFlexible),
  goalPercentage: normalizeNullable(snapshot.goalPercentage),
  goalDirection: normalizeNullable(snapshot.goalDirection),
  remainingCyclesTotal: normalizeNullable(snapshot.remainingCyclesTotal),
  isHistorical: normalizeBoolean(snapshot.isHistorical),
  sourceBudgetUpdatedAt: normalizeDate(snapshot.sourceBudgetUpdatedAt),
  createdAt: normalizeDate(snapshot.createdAt),
  updatedAt: normalizeDate(snapshot.updatedAt),
});

const passOrFail = (
  name: string,
  mismatches: LocalApiReadParityCheckResult["mismatches"] = [],
  sampledIds?: number[],
): LocalApiReadParityCheckResult => ({
  name,
  status: mismatches.length === 0 ? "pass" : "fail",
  mismatchCount: mismatches.length,
  sampledIds,
  mismatches: mismatches.length > 0 ? mismatches : undefined,
});

const sanitizedFailure = (
  name: string,
  error: unknown,
): LocalApiReadParityCheckResult => {
  let code = "diagnostic_check_failed";
  if (error instanceof LocalApiError) {
    code = error.code;
  } else if (error instanceof TypeError) {
    code = "local_api_unreachable";
  }

  return passOrFail(name, [{ code }]);
};

const runCheck = async (
  name: string,
  check: () => Promise<LocalApiReadParityCheckResult>,
): Promise<LocalApiReadParityCheckResult> => {
  try {
    return await check();
  } catch (error) {
    return sanitizedFailure(name, error);
  }
};

const countCheck = async (
  name: string,
  dexieCount: Promise<number>,
  httpCount: Promise<number>,
): Promise<LocalApiReadParityCheckResult> => {
  const [expected, actual] = await Promise.all([dexieCount, httpCount]);
  return passOrFail(
    name,
    expected === actual ? [] : [{ code: "count_mismatch" }],
  );
};

const detailChecks = async<DexieRow extends { id?: number }, HttpRow>(
  options: {
    name: string;
    dexieRows: DexieRow[];
    sampleSize: number;
    getDexieById: (id: number) => Promise<DexieRow | undefined>;
    getHttpById: (id: number) => Promise<HttpRow | undefined>;
    comparable: (row: DexieRow | HttpRow) => ComparableRecord;
  },
): Promise<LocalApiReadParityCheckResult> => {
  const sampledIds = deterministicSampleIds(options.dexieRows, options.sampleSize);
  const mismatches: LocalApiReadParityMismatch[] = [];

  for (const id of sampledIds) {
    const [dexieRow, httpRow] = await Promise.all([
      options.getDexieById(id),
      options.getHttpById(id),
    ]);

    if (!dexieRow || !httpRow) {
      mismatches.push({
        id,
        code: "row_missing",
      });
      continue;
    }

    mismatches.push(
      ...compareRecords(
        options.comparable(dexieRow),
        options.comparable(httpRow),
        id,
      ),
    );
  }

  return passOrFail(options.name, mismatches, sampledIds);
};

const printSummary = (result: LocalApiReadParityDiagnosticResult): void => {
  console.log("Local API read parity diagnostics:");
  for (const check of result.checks) {
    const sampled = check.sampledIds?.length
      ? ` sampledIds=${check.sampledIds.join(",")}`
      : "";
    console.log(
      `  ${check.status.toUpperCase()} ${check.name} mismatches=${check.mismatchCount}${sampled}`,
    );
  }
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
  console.log(`Total mismatches: ${result.totalMismatches}`);
};

export const runLocalApiReadParityDiagnostics = async (
  options: LocalApiReadParityDiagnosticOptions = {},
): Promise<LocalApiReadParityDiagnosticResult> => {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const checks: LocalApiReadParityCheckResult[] = [];

  const [
    transactions,
    accounts,
    buckets,
    categories,
    recipients,
    budgets,
    budgetSnapshots,
  ] = await Promise.all([
    transactionRepository.listTransactions(),
    accountRepository.listAccounts(),
    categoryRepository.listBuckets(),
    categoryRepository.listCategories(),
    recipientRepository.listRecipients(),
    budgetRepository.listBudgets(),
    budgetRepository.listBudgetSnapshots(),
  ]);

  checks.push(
    await runCheck("transaction count", () =>
      countCheck(
        "transaction count",
        transactionRepository.getTransactionCount(),
        transactionHttpRepository.countTransactions(),
      ),
    ),
  );

  checks.push(
    await runCheck("transaction sampled detail", () =>
      detailChecks({
        name: "transaction sampled detail",
        dexieRows: transactions,
        sampleSize,
        getDexieById: transactionRepository.getTransactionById,
        getHttpById: transactionHttpRepository.getTransactionById,
        comparable: transactionComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("accounts count", () =>
      countCheck(
        "accounts count",
        Promise.resolve(accounts.length),
        lookupHttpRepositories.listAccounts({ limit: 1 }).then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("accounts sampled detail", () =>
      detailChecks({
        name: "accounts sampled detail",
        dexieRows: accounts,
        sampleSize,
        getDexieById: accountRepository.getAccountById,
        getHttpById: lookupHttpRepositories.getAccountById,
        comparable: accountComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("buckets count", () =>
      countCheck(
        "buckets count",
        Promise.resolve(buckets.length),
        lookupHttpRepositories.listBuckets({ limit: 1 }).then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("buckets sampled detail", () =>
      detailChecks({
        name: "buckets sampled detail",
        dexieRows: buckets,
        sampleSize,
        getDexieById: categoryRepository.getBucketById,
        getHttpById: lookupHttpRepositories.getBucketById,
        comparable: bucketComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("categories count", () =>
      countCheck(
        "categories count",
        Promise.resolve(categories.length),
        lookupHttpRepositories.listCategories({ limit: 1 }).then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("categories sampled detail", () =>
      detailChecks({
        name: "categories sampled detail",
        dexieRows: categories,
        sampleSize,
        getDexieById: categoryRepository.getCategoryById,
        getHttpById: lookupHttpRepositories.getCategoryById,
        comparable: categoryComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("recipients count", () =>
      countCheck(
        "recipients count",
        Promise.resolve(recipients.length),
        lookupHttpRepositories.listRecipients({ limit: 1 }).then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("recipients sampled detail", () =>
      detailChecks({
        name: "recipients sampled detail",
        dexieRows: recipients,
        sampleSize,
        getDexieById: recipientRepository.getRecipientById,
        getHttpById: lookupHttpRepositories.getRecipientById,
        comparable: recipientComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("budgets count", () =>
      countCheck(
        "budgets count",
        Promise.resolve(budgets.length),
        budgetHttpRepository.listBudgets({ limit: 1 }).then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("budgets sampled detail", () =>
      detailChecks({
        name: "budgets sampled detail",
        dexieRows: budgets,
        sampleSize,
        getDexieById: budgetRepository.getBudgetById,
        getHttpById: budgetHttpRepository.getBudgetById,
        comparable: budgetComparable,
      }),
    ),
  );

  checks.push(
    await runCheck("budgetSnapshots count", () =>
      countCheck(
        "budgetSnapshots count",
        Promise.resolve(budgetSnapshots.length),
        budgetHttpRepository
          .listBudgetSnapshots({ limit: 1 })
          .then((result) => result.count),
      ),
    ),
  );

  checks.push(
    await runCheck("budgetSnapshots sampled detail", () =>
      detailChecks({
        name: "budgetSnapshots sampled detail",
        dexieRows: budgetSnapshots,
        sampleSize,
        getDexieById: budgetRepository.getBudgetSnapshotById,
        getHttpById: budgetHttpRepository.getBudgetSnapshotById,
        comparable: budgetSnapshotComparable,
      }),
    ),
  );

  const failedChecks = checks.filter((check) => check.status === "fail").length;
  const totalMismatches = checks.reduce(
    (sum, check) => sum + check.mismatchCount,
    0,
  );

  const result: LocalApiReadParityDiagnosticResult = {
    ok: failedChecks === 0,
    generatedAt: new Date().toISOString(),
    comparedChecks: checks.length,
    failedChecks,
    totalMismatches,
    checks,
  };

  if (options.logSummary === true) {
    printSummary(result);
  }

  return result;
};

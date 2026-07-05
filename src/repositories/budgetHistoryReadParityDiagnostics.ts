import { LocalApiError } from "../api/localApiClient";
import { getSelectedReadRepositoriesForBackend } from "./selectedReadRepositories";
import {
  normalizeOrderingId,
  normalizedOrderingIdsMatch,
} from "./selectedReadOrderingDiagnostics";

export interface BudgetHistoryReadParityDiagnosticOptions {
  snapshotLimit?: number;
  transactionLimit?: number;
  budgetLimit?: number;
  pageSize?: number;
  logSummary?: boolean;
}

export interface BudgetHistoryReadParityDiagnosticCheck {
  name: string;
  status: "pass" | "fail";
  code?: string;
}

export interface BudgetHistoryReadParityDiagnosticResult {
  ok: boolean;
  generatedAt: string;
  snapshotLimit: number;
  transactionLimit: number;
  budgetLimit: number;
  pageSize: number;
  comparedChecks: number;
  failedChecks: number;
  dexieSnapshotLoadedCount: number;
  dexieSnapshotReportedCount?: number;
  dexieSnapshotPagesLoaded: number;
  dexieSnapshotTruncated: boolean;
  httpSnapshotLoadedCount: number;
  httpSnapshotReportedCount?: number;
  httpSnapshotPagesLoaded: number;
  httpSnapshotTruncated: boolean;
  dexieTransactionLoadedCount: number;
  dexieTransactionReportedCount?: number;
  dexieTransactionPagesLoaded: number;
  dexieTransactionTruncated: boolean;
  httpTransactionLoadedCount: number;
  httpTransactionReportedCount?: number;
  httpTransactionPagesLoaded: number;
  httpTransactionTruncated: boolean;
  dexieBudgetLoadedCount: number;
  dexieBudgetReportedCount?: number;
  dexieBudgetPagesLoaded: number;
  dexieBudgetTruncated: boolean;
  httpBudgetLoadedCount: number;
  httpBudgetReportedCount?: number;
  httpBudgetPagesLoaded: number;
  httpBudgetTruncated: boolean;
  baselineCountsMatch: boolean;
  parityLimitedByBaselineMismatch: boolean;
  allDexieRowsNormalized: boolean;
  allHttpRowsNormalized: boolean;
  snapshotIdsMatch: boolean;
  snapshotDisplayOrderMatches: boolean;
  occurrenceKeysMatch: boolean;
  occurrenceDisplayOrderMatches: boolean;
  occurrenceCountsMatch: boolean;
  fieldMismatchCounts: Partial<Record<BudgetHistoryFieldMismatch, number>>;
  distributionMatches: Record<BudgetHistoryDistributionField, boolean>;
  distributionMismatchCounts: Record<BudgetHistoryDistributionField, number>;
  transactionLinkageMismatchCount: number;
  amountPaidMismatchCount: number;
  effectiveTargetMismatchCount: number;
  completionMismatchCount: number;
  sampledDexieSnapshotIds: string[];
  sampledHttpSnapshotIds: string[];
  baselineNote: string;
  lifecycleNote: string;
  checks: BudgetHistoryReadParityDiagnosticCheck[];
}

type RowWithId = {
  id?: unknown;
};

type ReadListResult =
  | RowWithId[]
  | {
      count?: unknown;
      rows?: unknown;
    };

type ListReader = (options: {
  limit: number;
  offset: number;
}) => Promise<unknown>;

type GoalDirection = "expense" | "income" | "fallback_expense" | "fallback_income";
type Sign = "negative" | "positive" | "zero" | "missing";
type Presence = "present" | "missing";

type BudgetHistoryFieldMismatch =
  | "budgetId"
  | "dueDateDayKey"
  | "goalDirection"
  | "isFlexible"
  | "isGoal"
  | "isHistorical"
  | "linkedBudgetPresence"
  | "linkedTransactionCount"
  | "amountPaidRounded"
  | "effectiveTargetRounded"
  | "completionStatus";

type BudgetHistoryDistributionField =
  | "snapshotBudgetId"
  | "snapshotDueDateDayKey"
  | "snapshotGoalDirection"
  | "snapshotIsFlexible"
  | "snapshotCompletionStatus"
  | "linkedBudgetPresence"
  | "transactionBudgetSnapshotId"
  | "occurrenceKey";

interface PagedLoadResult {
  rows?: RowWithId[];
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
  code?: string;
}

interface DiagnosticBudget {
  id: number;
  idKey: string;
  isActive: boolean;
}

interface DiagnosticSnapshot {
  id: number;
  idKey: string;
  budgetId: number;
  budgetIdKey: string;
  dueDateTime: number;
  dueDateDayKey: string;
  amount: number;
  transactionCost: number;
  goalDirection: GoalDirection;
  isGoal: boolean;
  isFlexible: boolean;
  isHistorical: boolean;
  updatedAtTime: number;
}

interface DiagnosticTransaction {
  id: number;
  budgetSnapshotIdKey: string;
  combinedAmount: number;
}

interface DiagnosticOccurrence {
  snapshotId: number;
  snapshotIdKey: string;
  budgetId: number;
  budgetIdKey: string;
  occurrenceKey: string;
  dueDateTime: number;
  dueDateDayKey: string;
  linkedBudgetPresence: Presence;
  goalDirection: GoalDirection;
  isFlexible: boolean;
  isGoal: boolean;
  isHistorical: boolean;
  linkedTransactionCount: number;
  amountPaidRounded: number;
  effectiveTargetRounded: number;
  isCompleted: boolean;
}

const DEFAULT_SNAPSHOT_LIMIT = 5000;
const DEFAULT_TRANSACTION_LIMIT = 5000;
const DEFAULT_BUDGET_LIMIT = 500;
const DEFAULT_PAGE_SIZE = 200;
const SAMPLE_ID_LIMIT = 12;
const MISSING_KEY = "__missing__";
const DISTRIBUTION_FIELDS: BudgetHistoryDistributionField[] = [
  "snapshotBudgetId",
  "snapshotDueDateDayKey",
  "snapshotGoalDirection",
  "snapshotIsFlexible",
  "snapshotCompletionStatus",
  "linkedBudgetPresence",
  "transactionBudgetSnapshotId",
  "occurrenceKey",
];
const FIELD_MISMATCHES: BudgetHistoryFieldMismatch[] = [
  "budgetId",
  "dueDateDayKey",
  "goalDirection",
  "isFlexible",
  "isGoal",
  "isHistorical",
  "linkedBudgetPresence",
  "linkedTransactionCount",
  "amountPaidRounded",
  "effectiveTargetRounded",
  "completionStatus",
];
const BASELINE_NOTE =
  "Trust this result only when SQLite was imported from a fresh backup matching current Dexie data. Stale SQLite can produce false Budget History read parity mismatches.";
const LIFECYCLE_NOTE =
  "This diagnostic uses read-only selected-read list calls only. It does not call budget snapshot generation, pruning, dedupe, repair, coverage, creation, or update helpers.";

const safeLimit = (
  value: number | undefined,
  defaultValue: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(defaultValue, Math.trunc(value)));
};

const safePageSize = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.max(1, Math.min(DEFAULT_PAGE_SIZE, Math.trunc(value)));
};

const rowsFromListResult = (result: ReadListResult): RowWithId[] | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.rows)) {
    return result.rows as RowWithId[];
  }

  return undefined;
};

const countFromListResult = (result: ReadListResult): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const loadPages = async (
  list: ListReader,
  maxRows: number,
  pageSize: number,
  invalidResponseCode: string,
): Promise<PagedLoadResult> => {
  const rows: RowWithId[] = [];
  let reportedCount: number | undefined;
  let pagesLoaded = 0;
  let lastPageFilled = false;

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const result = await list({ limit, offset: rows.length });
    const pageRows = rowsFromListResult(result as ReadListResult);

    if (!pageRows) {
      return {
        rows,
        reportedCount,
        pagesLoaded,
        truncated:
          reportedCount !== undefined ? rows.length < reportedCount : false,
        code: invalidResponseCode,
      };
    }

    reportedCount ??= countFromListResult(result as ReadListResult);
    pagesLoaded += 1;
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
    pagesLoaded,
    truncated:
      reportedCount !== undefined
        ? rows.length < reportedCount
        : rows.length >= maxRows && lastPageFilled,
  };
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const normalizedKeyValue = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  return undefined;
};

const dayKey = (value: unknown): string | undefined => {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? new Date(value)
        : undefined;

  if (date && !Number.isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return undefined;
};

const dayTime = (value: unknown): number | undefined => {
  const key = dayKey(value);
  if (!key) {
    return undefined;
  }

  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
};

const timeValue = (value: unknown): number => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  return 0;
};

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const goalDirectionFor = (
  goalDirection: unknown,
  amount: number,
): GoalDirection | undefined => {
  if (goalDirection === "expense" || goalDirection === "income") {
    return goalDirection;
  }

  return amount < 0 ? "fallback_expense" : "fallback_income";
};

const isExpense = (goalDirection: GoalDirection): boolean =>
  goalDirection === "expense" || goalDirection === "fallback_expense";

const normalizeBudget = (row: RowWithId): DiagnosticBudget | undefined => {
  const id = numberValue(row.id);
  const idKey = normalizedKeyValue(row.id);
  const isActive = booleanValue((row as { isActive?: unknown }).isActive);

  if (id === undefined || idKey === undefined || isActive === undefined) {
    return undefined;
  }

  return { id, idKey, isActive };
};

const normalizeSnapshot = (row: RowWithId): DiagnosticSnapshot | undefined => {
  const id = numberValue(row.id);
  const idKey = normalizedKeyValue(row.id);
  const budgetId = numberValue((row as { budgetId?: unknown }).budgetId);
  const budgetIdKey = normalizedKeyValue(
    (row as { budgetId?: unknown }).budgetId,
  );
  const dueDate = (row as { dueDate?: unknown }).dueDate;
  const dueDateDayKey = dayKey(dueDate);
  const dueDateTime = dayTime(dueDate);
  const amount = numberValue((row as { amount?: unknown }).amount);
  const transactionCost =
    numberValue((row as { transactionCost?: unknown }).transactionCost) ?? 0;
  const goalDirection = goalDirectionFor(
    (row as { goalDirection?: unknown }).goalDirection,
    amount ?? 0,
  );

  if (
    id === undefined ||
    idKey === undefined ||
    budgetId === undefined ||
    budgetIdKey === undefined ||
    dueDateDayKey === undefined ||
    dueDateTime === undefined ||
    amount === undefined ||
    goalDirection === undefined
  ) {
    return undefined;
  }

  return {
    id,
    idKey,
    budgetId,
    budgetIdKey,
    dueDateTime,
    dueDateDayKey,
    amount,
    transactionCost,
    goalDirection,
    isGoal: booleanValue((row as { isGoal?: unknown }).isGoal) ?? false,
    isFlexible:
      booleanValue((row as { isFlexible?: unknown }).isFlexible) ?? false,
    isHistorical:
      booleanValue((row as { isHistorical?: unknown }).isHistorical) ?? false,
    updatedAtTime: timeValue((row as { updatedAt?: unknown }).updatedAt),
  };
};

const normalizeTransaction = (
  row: RowWithId,
): DiagnosticTransaction | undefined => {
  const id = numberValue(row.id);
  const amount = numberValue((row as { amount?: unknown }).amount);
  const transactionCost =
    numberValue((row as { transactionCost?: unknown }).transactionCost) ?? 0;

  if (id === undefined || amount === undefined) {
    return undefined;
  }

  return {
    id,
    budgetSnapshotIdKey: keyForValue(
      normalizedKeyValue(
        (row as { budgetSnapshotId?: unknown }).budgetSnapshotId,
      ),
    ),
    combinedAmount: amount + transactionCost,
  };
};

const keyForValue = (value: unknown): string =>
  value === undefined || value === null ? MISSING_KEY : String(value);

const budgetById = (
  budgets: DiagnosticBudget[],
): Map<string, DiagnosticBudget> =>
  new Map(budgets.map((budget) => [budget.idKey, budget]));

const linkedTransactionsFor = (
  snapshotIdKey: string,
  transactions: DiagnosticTransaction[],
): DiagnosticTransaction[] =>
  transactions.filter(
    (transaction) => transaction.budgetSnapshotIdKey === snapshotIdKey,
  );

const effectiveTarget = (snapshot: DiagnosticSnapshot): number =>
  Math.abs(snapshot.amount + snapshot.transactionCost);

const deriveOccurrences = (
  snapshots: DiagnosticSnapshot[],
  budgets: DiagnosticBudget[],
  transactions: DiagnosticTransaction[],
): DiagnosticOccurrence[] => {
  const budgetsById = budgetById(budgets);
  const todayTime = dayTime(new Date()) ?? new Date().setHours(0, 0, 0, 0);
  const dedupedByDueDate = new Map<
    string,
    {
      snapshot: DiagnosticSnapshot;
      linkedTransactions: DiagnosticTransaction[];
      amountPaid: number;
    }
  >();

  for (const snapshot of snapshots) {
    if (snapshot.dueDateTime >= todayTime) {
      continue;
    }

    const linkedTransactions = linkedTransactionsFor(
      snapshot.idKey,
      transactions,
    );
    const amountPaid = linkedTransactions.reduce(
      (sum, transaction) => sum + transaction.combinedAmount,
      0,
    );
    const key = `${snapshot.budgetIdKey}:${snapshot.dueDateDayKey}`;
    const existing = dedupedByDueDate.get(key);

    if (!existing) {
      dedupedByDueDate.set(key, { snapshot, linkedTransactions, amountPaid });
      continue;
    }

    const existingScore = Math.abs(existing.amountPaid);
    const candidateScore = Math.abs(amountPaid);

    if (
      candidateScore > existingScore ||
      (candidateScore === existingScore &&
        linkedTransactions.length > existing.linkedTransactions.length) ||
      (candidateScore === existingScore &&
        linkedTransactions.length === existing.linkedTransactions.length &&
        snapshot.updatedAtTime >= existing.snapshot.updatedAtTime)
    ) {
      dedupedByDueDate.set(key, { snapshot, linkedTransactions, amountPaid });
    }
  }

  return Array.from(dedupedByDueDate.values())
    .map(({ snapshot, linkedTransactions, amountPaid }) => {
      const budget = budgetsById.get(snapshot.budgetIdKey);
      const target = effectiveTarget(snapshot);
      const expense = isExpense(snapshot.goalDirection);
      const isCompleted = expense
        ? amountPaid <= -target
        : amountPaid >= target;

      return {
        snapshotId: snapshot.id,
        snapshotIdKey: snapshot.idKey,
        budgetId: snapshot.budgetId,
        budgetIdKey: snapshot.budgetIdKey,
        occurrenceKey: `${snapshot.budgetIdKey}:${snapshot.dueDateDayKey}`,
        dueDateTime: snapshot.dueDateTime,
        dueDateDayKey: snapshot.dueDateDayKey,
        linkedBudgetPresence: budget ? ("present" as const) : ("missing" as const),
        goalDirection: snapshot.goalDirection,
        isFlexible: snapshot.isFlexible,
        isGoal: snapshot.isGoal,
        isHistorical: snapshot.isHistorical,
        linkedTransactionCount: linkedTransactions.length,
        amountPaidRounded: roundCurrency(amountPaid),
        effectiveTargetRounded: roundCurrency(target),
        isCompleted,
        budgetIsActive: budget?.isActive,
      };
    })
    .filter(
      (occurrence) =>
        occurrence.budgetIsActive === true || occurrence.amountPaidRounded !== 0,
    )
    .map(({ budgetIsActive: _budgetIsActive, ...occurrence }) => occurrence)
    .sort((left, right) => right.dueDateTime - left.dueDateTime);
};

const normalizedIdSetsMatch = (
  left: Array<{ id: number }>,
  right: Array<{ id: number }>,
): boolean => {
  const leftIds = left.map((row) => normalizeOrderingId(row.id)).sort();
  const rightIds = right.map((row) => normalizeOrderingId(row.id)).sort();
  return normalizedOrderingIdsMatch(leftIds, rightIds);
};

const sampledSnapshotIds = (rows: Array<{ id: number }>): string[] =>
  rows
    .slice(0, SAMPLE_ID_LIMIT)
    .map((row) => normalizeOrderingId(row.id))
    .filter((id): id is string => id !== undefined);

const occurrenceKeys = (rows: DiagnosticOccurrence[]): string[] =>
  rows.map((row) => row.occurrenceKey);

const occurrenceKeySetsMatch = (
  left: DiagnosticOccurrence[],
  right: DiagnosticOccurrence[],
): boolean =>
  normalizedOrderingIdsMatch(
    [...occurrenceKeys(left)].sort(),
    [...occurrenceKeys(right)].sort(),
  );

const occurrenceKeyOrderMatches = (
  left: DiagnosticOccurrence[],
  right: DiagnosticOccurrence[],
): boolean => normalizedOrderingIdsMatch(occurrenceKeys(left), occurrenceKeys(right));

const comparableOccurrences = (
  left: DiagnosticOccurrence[],
  right: DiagnosticOccurrence[],
): Array<[DiagnosticOccurrence, DiagnosticOccurrence]> => {
  const rightByKey = new Map(right.map((row) => [row.occurrenceKey, row]));
  return left.flatMap((leftRow) => {
    const rightRow = rightByKey.get(leftRow.occurrenceKey);
    return rightRow
      ? [[leftRow, rightRow] as [DiagnosticOccurrence, DiagnosticOccurrence]]
      : [];
  });
};

const emptyFieldMismatchCounts = (): Record<BudgetHistoryFieldMismatch, number> =>
  Object.fromEntries(FIELD_MISMATCHES.map((field) => [field, 0])) as Record<
    BudgetHistoryFieldMismatch,
    number
  >;

const fieldMismatchCountsForPairs = (
  pairs: Array<[DiagnosticOccurrence, DiagnosticOccurrence]>,
): Partial<Record<BudgetHistoryFieldMismatch, number>> => {
  const counts = emptyFieldMismatchCounts();

  for (const [left, right] of pairs) {
    if (left.budgetId !== right.budgetId) counts.budgetId += 1;
    if (left.dueDateDayKey !== right.dueDateDayKey) counts.dueDateDayKey += 1;
    if (left.goalDirection !== right.goalDirection) counts.goalDirection += 1;
    if (left.isFlexible !== right.isFlexible) counts.isFlexible += 1;
    if (left.isGoal !== right.isGoal) counts.isGoal += 1;
    if (left.isHistorical !== right.isHistorical) counts.isHistorical += 1;
    if (left.linkedBudgetPresence !== right.linkedBudgetPresence) {
      counts.linkedBudgetPresence += 1;
    }
    if (left.linkedTransactionCount !== right.linkedTransactionCount) {
      counts.linkedTransactionCount += 1;
    }
    if (left.amountPaidRounded !== right.amountPaidRounded) {
      counts.amountPaidRounded += 1;
    }
    if (left.effectiveTargetRounded !== right.effectiveTargetRounded) {
      counts.effectiveTargetRounded += 1;
    }
    if (left.isCompleted !== right.isCompleted) counts.completionStatus += 1;
  }

  return Object.fromEntries(
    Object.entries(counts).filter(([, count]) => count > 0),
  ) as Partial<Record<BudgetHistoryFieldMismatch, number>>;
};

const distribution = (
  rows: unknown[],
  keyForRow: (row: unknown) => string,
): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyForRow(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};

const distributionDiffCount = (
  left: Map<string, number>,
  right: Map<string, number>,
): number => {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let count = 0;

  for (const key of keys) {
    if ((left.get(key) ?? 0) !== (right.get(key) ?? 0)) {
      count += 1;
    }
  }

  return count;
};

const distributionComparisons = (
  dexieSnapshots: DiagnosticSnapshot[],
  httpSnapshots: DiagnosticSnapshot[],
  dexieTransactions: DiagnosticTransaction[],
  httpTransactions: DiagnosticTransaction[],
  dexieOccurrences: DiagnosticOccurrence[],
  httpOccurrences: DiagnosticOccurrence[],
): {
  matches: Record<BudgetHistoryDistributionField, boolean>;
  mismatchCounts: Record<BudgetHistoryDistributionField, number>;
} => {
  const distributions: Record<
    BudgetHistoryDistributionField,
    [Map<string, number>, Map<string, number>]
  > = {
    snapshotBudgetId: [
      distribution(dexieSnapshots, (row) =>
        (row as DiagnosticSnapshot).budgetIdKey,
      ),
      distribution(httpSnapshots, (row) =>
        (row as DiagnosticSnapshot).budgetIdKey,
      ),
    ],
    snapshotDueDateDayKey: [
      distribution(dexieSnapshots, (row) =>
        (row as DiagnosticSnapshot).dueDateDayKey,
      ),
      distribution(httpSnapshots, (row) =>
        (row as DiagnosticSnapshot).dueDateDayKey,
      ),
    ],
    snapshotGoalDirection: [
      distribution(dexieSnapshots, (row) =>
        (row as DiagnosticSnapshot).goalDirection,
      ),
      distribution(httpSnapshots, (row) =>
        (row as DiagnosticSnapshot).goalDirection,
      ),
    ],
    snapshotIsFlexible: [
      distribution(dexieSnapshots, (row) =>
        String((row as DiagnosticSnapshot).isFlexible),
      ),
      distribution(httpSnapshots, (row) =>
        String((row as DiagnosticSnapshot).isFlexible),
      ),
    ],
    snapshotCompletionStatus: [
      distribution(dexieOccurrences, (row) =>
        String((row as DiagnosticOccurrence).isCompleted),
      ),
      distribution(httpOccurrences, (row) =>
        String((row as DiagnosticOccurrence).isCompleted),
      ),
    ],
    linkedBudgetPresence: [
      distribution(dexieOccurrences, (row) =>
        (row as DiagnosticOccurrence).linkedBudgetPresence,
      ),
      distribution(httpOccurrences, (row) =>
        (row as DiagnosticOccurrence).linkedBudgetPresence,
      ),
    ],
    transactionBudgetSnapshotId: [
      distribution(dexieTransactions, (row) =>
        (row as DiagnosticTransaction).budgetSnapshotIdKey,
      ),
      distribution(httpTransactions, (row) =>
        (row as DiagnosticTransaction).budgetSnapshotIdKey,
      ),
    ],
    occurrenceKey: [
      distribution(dexieOccurrences, (row) =>
        (row as DiagnosticOccurrence).occurrenceKey,
      ),
      distribution(httpOccurrences, (row) =>
        (row as DiagnosticOccurrence).occurrenceKey,
      ),
    ],
  };

  const matches = {} as Record<BudgetHistoryDistributionField, boolean>;
  const mismatchCounts = {} as Record<BudgetHistoryDistributionField, number>;

  for (const field of DISTRIBUTION_FIELDS) {
    const mismatchCount = distributionDiffCount(
      distributions[field][0],
      distributions[field][1],
    );
    mismatchCounts[field] = mismatchCount;
    matches[field] = mismatchCount === 0;
  }

  return { matches, mismatchCounts };
};

const pass = (name: string): BudgetHistoryReadParityDiagnosticCheck => ({
  name,
  status: "pass",
});

const fail = (
  name: string,
  code: string,
): BudgetHistoryReadParityDiagnosticCheck => ({
  name,
  status: "fail",
  code,
});

const sanitizeErrorCode = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    return error.code;
  }

  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "budget_history_read_parity_diagnostic_failed";
};

const printSummary = (result: BudgetHistoryReadParityDiagnosticResult): void => {
  console.log("Budget History read parity diagnostic:");
  for (const check of result.checks) {
    const code = check.code ? ` code=${check.code}` : "";
    console.log(`  ${check.status.toUpperCase()} ${check.name}${code}`);
  }
  console.log(`Snapshot limit: ${result.snapshotLimit}`);
  console.log(`Transaction limit: ${result.transactionLimit}`);
  console.log(`Budget limit: ${result.budgetLimit}`);
  console.log(`Dexie snapshots loaded: ${result.dexieSnapshotLoadedCount}`);
  console.log(`HTTP snapshots loaded: ${result.httpSnapshotLoadedCount}`);
  console.log(`HTTP snapshots truncated: ${String(result.httpSnapshotTruncated)}`);
  console.log(`Compared checks: ${result.comparedChecks}`);
  console.log(`Failed checks: ${result.failedChecks}`);
};

const failedResult = (
  snapshotLimit: number,
  transactionLimit: number,
  budgetLimit: number,
  pageSize: number,
  dexieSnapshotLoad: PagedLoadResult,
  httpSnapshotLoad: PagedLoadResult,
  dexieTransactionLoad: PagedLoadResult,
  httpTransactionLoad: PagedLoadResult,
  dexieBudgetLoad: PagedLoadResult,
  httpBudgetLoad: PagedLoadResult,
  checks: BudgetHistoryReadParityDiagnosticCheck[],
): BudgetHistoryReadParityDiagnosticResult => ({
  ok: false,
  generatedAt: new Date().toISOString(),
  snapshotLimit,
  transactionLimit,
  budgetLimit,
  pageSize,
  comparedChecks: checks.length,
  failedChecks: checks.filter((check) => check.status === "fail").length,
  dexieSnapshotLoadedCount: dexieSnapshotLoad.rows?.length ?? 0,
  dexieSnapshotReportedCount: dexieSnapshotLoad.reportedCount,
  dexieSnapshotPagesLoaded: dexieSnapshotLoad.pagesLoaded,
  dexieSnapshotTruncated: dexieSnapshotLoad.truncated,
  httpSnapshotLoadedCount: httpSnapshotLoad.rows?.length ?? 0,
  httpSnapshotReportedCount: httpSnapshotLoad.reportedCount,
  httpSnapshotPagesLoaded: httpSnapshotLoad.pagesLoaded,
  httpSnapshotTruncated: httpSnapshotLoad.truncated,
  dexieTransactionLoadedCount: dexieTransactionLoad.rows?.length ?? 0,
  dexieTransactionReportedCount: dexieTransactionLoad.reportedCount,
  dexieTransactionPagesLoaded: dexieTransactionLoad.pagesLoaded,
  dexieTransactionTruncated: dexieTransactionLoad.truncated,
  httpTransactionLoadedCount: httpTransactionLoad.rows?.length ?? 0,
  httpTransactionReportedCount: httpTransactionLoad.reportedCount,
  httpTransactionPagesLoaded: httpTransactionLoad.pagesLoaded,
  httpTransactionTruncated: httpTransactionLoad.truncated,
  dexieBudgetLoadedCount: dexieBudgetLoad.rows?.length ?? 0,
  dexieBudgetReportedCount: dexieBudgetLoad.reportedCount,
  dexieBudgetPagesLoaded: dexieBudgetLoad.pagesLoaded,
  dexieBudgetTruncated: dexieBudgetLoad.truncated,
  httpBudgetLoadedCount: httpBudgetLoad.rows?.length ?? 0,
  httpBudgetReportedCount: httpBudgetLoad.reportedCount,
  httpBudgetPagesLoaded: httpBudgetLoad.pagesLoaded,
  httpBudgetTruncated: httpBudgetLoad.truncated,
  baselineCountsMatch: false,
  parityLimitedByBaselineMismatch: true,
  allDexieRowsNormalized: false,
  allHttpRowsNormalized: false,
  snapshotIdsMatch: false,
  snapshotDisplayOrderMatches: false,
  occurrenceKeysMatch: false,
  occurrenceDisplayOrderMatches: false,
  occurrenceCountsMatch: false,
  fieldMismatchCounts: {},
  distributionMatches: Object.fromEntries(
    DISTRIBUTION_FIELDS.map((field) => [field, false]),
  ) as Record<BudgetHistoryDistributionField, boolean>,
  distributionMismatchCounts: Object.fromEntries(
    DISTRIBUTION_FIELDS.map((field) => [field, 0]),
  ) as Record<BudgetHistoryDistributionField, number>,
  transactionLinkageMismatchCount: 0,
  amountPaidMismatchCount: 0,
  effectiveTargetMismatchCount: 0,
  completionMismatchCount: 0,
  sampledDexieSnapshotIds: [],
  sampledHttpSnapshotIds: [],
  baselineNote: BASELINE_NOTE,
  lifecycleNote: LIFECYCLE_NOTE,
  checks,
});

export const runBudgetHistoryReadParityDiagnostics = async (
  options: BudgetHistoryReadParityDiagnosticOptions = {},
): Promise<BudgetHistoryReadParityDiagnosticResult> => {
  const snapshotLimit = safeLimit(
    options.snapshotLimit,
    DEFAULT_SNAPSHOT_LIMIT,
  );
  const transactionLimit = safeLimit(
    options.transactionLimit,
    DEFAULT_TRANSACTION_LIMIT,
  );
  const budgetLimit = safeLimit(options.budgetLimit, DEFAULT_BUDGET_LIMIT);
  const pageSize = safePageSize(options.pageSize);
  const dexieRepositories = getSelectedReadRepositoriesForBackend("dexie");
  const httpRepositories = getSelectedReadRepositoriesForBackend("http-readonly");

  try {
    const [
      dexieSnapshotLoad,
      httpSnapshotLoad,
      dexieTransactionLoad,
      httpTransactionLoad,
      dexieBudgetLoad,
      httpBudgetLoad,
    ] = await Promise.all([
      loadPages(
        dexieRepositories.budgetSnapshots.list,
        snapshotLimit,
        pageSize,
        "invalid_dexie_budget_history_snapshot_list_response",
      ),
      loadPages(
        httpRepositories.budgetSnapshots.list,
        snapshotLimit,
        pageSize,
        "invalid_http_budget_history_snapshot_list_response",
      ),
      loadPages(
        dexieRepositories.transactions.list,
        transactionLimit,
        pageSize,
        "invalid_dexie_budget_history_transaction_list_response",
      ),
      loadPages(
        httpRepositories.transactions.list,
        transactionLimit,
        pageSize,
        "invalid_http_budget_history_transaction_list_response",
      ),
      loadPages(
        dexieRepositories.budgets.list,
        budgetLimit,
        pageSize,
        "invalid_dexie_budget_history_budget_list_response",
      ),
      loadPages(
        httpRepositories.budgets.list,
        budgetLimit,
        pageSize,
        "invalid_http_budget_history_budget_list_response",
      ),
    ]);
    const dexieSnapshotRows = dexieSnapshotLoad.rows;
    const httpSnapshotRows = httpSnapshotLoad.rows;
    const dexieTransactionRows = dexieTransactionLoad.rows;
    const httpTransactionRows = httpTransactionLoad.rows;
    const dexieBudgetRows = dexieBudgetLoad.rows;
    const httpBudgetRows = httpBudgetLoad.rows;

    if (
      !dexieSnapshotRows ||
      !httpSnapshotRows ||
      !dexieTransactionRows ||
      !httpTransactionRows ||
      !dexieBudgetRows ||
      !httpBudgetRows
    ) {
      const checks = [
        dexieSnapshotRows && !dexieSnapshotLoad.code
          ? pass("dexie budget history snapshots loaded")
          : fail(
              "dexie budget history snapshots loaded",
              dexieSnapshotLoad.code ??
                "invalid_dexie_budget_history_snapshot_list_response",
            ),
        httpSnapshotRows && !httpSnapshotLoad.code
          ? pass("http budget history snapshots loaded")
          : fail(
              "http budget history snapshots loaded",
              httpSnapshotLoad.code ??
                "invalid_http_budget_history_snapshot_list_response",
            ),
        dexieTransactionRows && !dexieTransactionLoad.code
          ? pass("dexie budget history transactions loaded")
          : fail(
              "dexie budget history transactions loaded",
              dexieTransactionLoad.code ??
                "invalid_dexie_budget_history_transaction_list_response",
            ),
        httpTransactionRows && !httpTransactionLoad.code
          ? pass("http budget history transactions loaded")
          : fail(
              "http budget history transactions loaded",
              httpTransactionLoad.code ??
                "invalid_http_budget_history_transaction_list_response",
            ),
        dexieBudgetRows && !dexieBudgetLoad.code
          ? pass("dexie budget history budgets loaded")
          : fail(
              "dexie budget history budgets loaded",
              dexieBudgetLoad.code ??
                "invalid_dexie_budget_history_budget_list_response",
            ),
        httpBudgetRows && !httpBudgetLoad.code
          ? pass("http budget history budgets loaded")
          : fail(
              "http budget history budgets loaded",
              httpBudgetLoad.code ??
                "invalid_http_budget_history_budget_list_response",
            ),
      ];
      const result = failedResult(
        snapshotLimit,
        transactionLimit,
        budgetLimit,
        pageSize,
        dexieSnapshotLoad,
        httpSnapshotLoad,
        dexieTransactionLoad,
        httpTransactionLoad,
        dexieBudgetLoad,
        httpBudgetLoad,
        checks,
      );

      if (options.logSummary === true) {
        printSummary(result);
      }

      return result;
    }

    const dexieSnapshots = dexieSnapshotRows
      .map(normalizeSnapshot)
      .filter((row): row is DiagnosticSnapshot => row !== undefined);
    const httpSnapshots = httpSnapshotRows
      .map(normalizeSnapshot)
      .filter((row): row is DiagnosticSnapshot => row !== undefined);
    const dexieTransactions = dexieTransactionRows
      .map(normalizeTransaction)
      .filter((row): row is DiagnosticTransaction => row !== undefined);
    const httpTransactions = httpTransactionRows
      .map(normalizeTransaction)
      .filter((row): row is DiagnosticTransaction => row !== undefined);
    const dexieBudgets = dexieBudgetRows
      .map(normalizeBudget)
      .filter((row): row is DiagnosticBudget => row !== undefined);
    const httpBudgets = httpBudgetRows
      .map(normalizeBudget)
      .filter((row): row is DiagnosticBudget => row !== undefined);
    const allDexieRowsNormalized =
      dexieSnapshots.length === dexieSnapshotRows.length &&
      dexieTransactions.length === dexieTransactionRows.length &&
      dexieBudgets.length === dexieBudgetRows.length;
    const allHttpRowsNormalized =
      httpSnapshots.length === httpSnapshotRows.length &&
      httpTransactions.length === httpTransactionRows.length &&
      httpBudgets.length === httpBudgetRows.length;
    const dexieSnapshotCount =
      dexieSnapshotLoad.reportedCount ?? dexieSnapshots.length;
    const httpSnapshotCount =
      httpSnapshotLoad.reportedCount ?? httpSnapshots.length;
    const dexieTransactionCount =
      dexieTransactionLoad.reportedCount ?? dexieTransactions.length;
    const httpTransactionCount =
      httpTransactionLoad.reportedCount ?? httpTransactions.length;
    const dexieBudgetCount = dexieBudgetLoad.reportedCount ?? dexieBudgets.length;
    const httpBudgetCount = httpBudgetLoad.reportedCount ?? httpBudgets.length;
    const baselineCountsMatch =
      dexieSnapshotCount === httpSnapshotCount &&
      dexieTransactionCount === httpTransactionCount &&
      dexieBudgetCount === httpBudgetCount &&
      dexieSnapshots.length === dexieSnapshotCount &&
      httpSnapshots.length === httpSnapshotCount &&
      dexieTransactions.length === dexieTransactionCount &&
      httpTransactions.length === httpTransactionCount &&
      dexieBudgets.length === dexieBudgetCount &&
      httpBudgets.length === httpBudgetCount;
    const anyTruncated =
      dexieSnapshotLoad.truncated ||
      httpSnapshotLoad.truncated ||
      dexieTransactionLoad.truncated ||
      httpTransactionLoad.truncated ||
      dexieBudgetLoad.truncated ||
      httpBudgetLoad.truncated;
    const comparable =
      baselineCountsMatch &&
      allDexieRowsNormalized &&
      allHttpRowsNormalized &&
      !anyTruncated;
    const snapshotIdsMatch =
      comparable && normalizedIdSetsMatch(dexieSnapshots, httpSnapshots);
    const snapshotDisplayOrderMatches =
      comparable &&
      normalizedOrderingIdsMatch(
        dexieSnapshots.map((snapshot) => normalizeOrderingId(snapshot.id)),
        httpSnapshots.map((snapshot) => normalizeOrderingId(snapshot.id)),
      );
    const dexieOccurrences = deriveOccurrences(
      dexieSnapshots,
      dexieBudgets,
      dexieTransactions,
    );
    const httpOccurrences = deriveOccurrences(
      httpSnapshots,
      httpBudgets,
      httpTransactions,
    );
    const occurrenceCountsMatch =
      comparable && dexieOccurrences.length === httpOccurrences.length;
    const occurrenceKeysMatch =
      comparable && occurrenceKeySetsMatch(dexieOccurrences, httpOccurrences);
    const occurrenceDisplayOrderMatches =
      comparable &&
      occurrenceKeyOrderMatches(dexieOccurrences, httpOccurrences);
    const occurrencePairs = comparableOccurrences(
      dexieOccurrences,
      httpOccurrences,
    );
    const fieldMismatchCounts = comparable
      ? fieldMismatchCountsForPairs(occurrencePairs)
      : {};
    const distributions = distributionComparisons(
      dexieSnapshots,
      httpSnapshots,
      dexieTransactions,
      httpTransactions,
      dexieOccurrences,
      httpOccurrences,
    );
    const transactionLinkageMismatchCount =
      distributions.mismatchCounts.transactionBudgetSnapshotId;
    const amountPaidMismatchCount = fieldMismatchCounts.amountPaidRounded ?? 0;
    const effectiveTargetMismatchCount =
      fieldMismatchCounts.effectiveTargetRounded ?? 0;
    const completionMismatchCount = fieldMismatchCounts.completionStatus ?? 0;
    const fieldMismatchesTotal = Object.values(fieldMismatchCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const distributionsMatch = DISTRIBUTION_FIELDS.every(
      (field) => distributions.matches[field],
    );
    const parityLimitedByBaselineMismatch = !baselineCountsMatch || anyTruncated;

    const checks: BudgetHistoryReadParityDiagnosticCheck[] = [
      allDexieRowsNormalized
        ? pass("dexie budget history rows normalized")
        : fail(
            "dexie budget history rows normalized",
            "dexie_budget_history_row_normalization_failed",
          ),
      allHttpRowsNormalized
        ? pass("http budget history rows normalized")
        : fail(
            "http budget history rows normalized",
            "http_budget_history_row_normalization_failed",
          ),
      baselineCountsMatch
        ? pass("budget history baseline counts match")
        : fail(
            "budget history baseline counts match",
            "budget_history_baseline_count_mismatch",
          ),
      anyTruncated
        ? fail("budget history inputs fully loaded", "budget_history_input_truncated")
        : pass("budget history inputs fully loaded"),
      snapshotIdsMatch
        ? pass("budget history snapshot ids match")
        : fail(
            "budget history snapshot ids match",
            comparable
              ? "budget_history_snapshot_ids_mismatch"
              : "budget_history_snapshot_ids_limited_by_baseline",
          ),
      snapshotDisplayOrderMatches
        ? pass("budget history snapshot display order matches")
        : fail(
            "budget history snapshot display order matches",
            comparable
              ? "budget_history_snapshot_order_mismatch"
              : "budget_history_snapshot_order_limited_by_baseline",
          ),
      occurrenceCountsMatch
        ? pass("budget history occurrence counts match")
        : fail(
            "budget history occurrence counts match",
            comparable
              ? "budget_history_occurrence_count_mismatch"
              : "budget_history_occurrence_count_limited_by_baseline",
          ),
      occurrenceKeysMatch
        ? pass("budget history occurrence keys match")
        : fail(
            "budget history occurrence keys match",
            comparable
              ? "budget_history_occurrence_key_mismatch"
              : "budget_history_occurrence_key_limited_by_baseline",
          ),
      occurrenceDisplayOrderMatches
        ? pass("budget history occurrence display order matches")
        : fail(
            "budget history occurrence display order matches",
            comparable
              ? "budget_history_occurrence_order_mismatch"
              : "budget_history_occurrence_order_limited_by_baseline",
          ),
      fieldMismatchesTotal === 0
        ? pass("budget history occurrence safe fields match")
        : fail(
            "budget history occurrence safe fields match",
            "budget_history_occurrence_field_mismatch",
          ),
      distributionsMatch
        ? pass("budget history distributions match")
        : fail(
            "budget history distributions match",
            "budget_history_distribution_mismatch",
          ),
      amountPaidMismatchCount === 0
        ? pass("budget history amount-paid parity matches")
        : fail(
            "budget history amount-paid parity matches",
            "budget_history_amount_paid_mismatch",
          ),
      effectiveTargetMismatchCount === 0
        ? pass("budget history effective-target parity matches")
        : fail(
            "budget history effective-target parity matches",
            "budget_history_effective_target_mismatch",
          ),
      completionMismatchCount === 0
        ? pass("budget history completion parity matches")
        : fail(
            "budget history completion parity matches",
            "budget_history_completion_mismatch",
          ),
      transactionLinkageMismatchCount === 0
        ? pass("budget history transaction linkage matches")
        : fail(
            "budget history transaction linkage matches",
            "budget_history_transaction_linkage_mismatch",
          ),
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").length;
    const result: BudgetHistoryReadParityDiagnosticResult = {
      ok: failedChecks === 0,
      generatedAt: new Date().toISOString(),
      snapshotLimit,
      transactionLimit,
      budgetLimit,
      pageSize,
      comparedChecks: checks.length,
      failedChecks,
      dexieSnapshotLoadedCount: dexieSnapshots.length,
      dexieSnapshotReportedCount: dexieSnapshotLoad.reportedCount,
      dexieSnapshotPagesLoaded: dexieSnapshotLoad.pagesLoaded,
      dexieSnapshotTruncated: dexieSnapshotLoad.truncated,
      httpSnapshotLoadedCount: httpSnapshots.length,
      httpSnapshotReportedCount: httpSnapshotLoad.reportedCount,
      httpSnapshotPagesLoaded: httpSnapshotLoad.pagesLoaded,
      httpSnapshotTruncated: httpSnapshotLoad.truncated,
      dexieTransactionLoadedCount: dexieTransactions.length,
      dexieTransactionReportedCount: dexieTransactionLoad.reportedCount,
      dexieTransactionPagesLoaded: dexieTransactionLoad.pagesLoaded,
      dexieTransactionTruncated: dexieTransactionLoad.truncated,
      httpTransactionLoadedCount: httpTransactions.length,
      httpTransactionReportedCount: httpTransactionLoad.reportedCount,
      httpTransactionPagesLoaded: httpTransactionLoad.pagesLoaded,
      httpTransactionTruncated: httpTransactionLoad.truncated,
      dexieBudgetLoadedCount: dexieBudgets.length,
      dexieBudgetReportedCount: dexieBudgetLoad.reportedCount,
      dexieBudgetPagesLoaded: dexieBudgetLoad.pagesLoaded,
      dexieBudgetTruncated: dexieBudgetLoad.truncated,
      httpBudgetLoadedCount: httpBudgets.length,
      httpBudgetReportedCount: httpBudgetLoad.reportedCount,
      httpBudgetPagesLoaded: httpBudgetLoad.pagesLoaded,
      httpBudgetTruncated: httpBudgetLoad.truncated,
      baselineCountsMatch,
      parityLimitedByBaselineMismatch,
      allDexieRowsNormalized,
      allHttpRowsNormalized,
      snapshotIdsMatch,
      snapshotDisplayOrderMatches,
      occurrenceKeysMatch,
      occurrenceDisplayOrderMatches,
      occurrenceCountsMatch,
      fieldMismatchCounts,
      distributionMatches: distributions.matches,
      distributionMismatchCounts: distributions.mismatchCounts,
      transactionLinkageMismatchCount,
      amountPaidMismatchCount,
      effectiveTargetMismatchCount,
      completionMismatchCount,
      sampledDexieSnapshotIds: sampledSnapshotIds(dexieSnapshots),
      sampledHttpSnapshotIds: sampledSnapshotIds(httpSnapshots),
      baselineNote: BASELINE_NOTE,
      lifecycleNote: LIFECYCLE_NOTE,
      checks,
    };

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  } catch (error) {
    const checks = [
      fail("budget history read parity diagnostic", sanitizeErrorCode(error)),
    ];
    const emptyLoad = { pagesLoaded: 0, truncated: false, rows: [] };
    const result = failedResult(
      snapshotLimit,
      transactionLimit,
      budgetLimit,
      pageSize,
      emptyLoad,
      emptyLoad,
      emptyLoad,
      emptyLoad,
      emptyLoad,
      emptyLoad,
      checks,
    );

    if (options.logSummary === true) {
      printSummary(result);
    }

    return result;
  }
};

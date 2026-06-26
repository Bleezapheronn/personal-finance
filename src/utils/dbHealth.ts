import {
  Account,
  Budget,
  BudgetSnapshot,
  Category,
  PaymentMethod,
  Recipient,
  SmsImportTemplate,
  Transaction,
  db,
} from "../db";
import {
  FULL_BACKUP_TABLE_NAMES,
  FullBackupTableName,
} from "./fullBackup";

export type DbHealthSeverity = "error" | "warning" | "info";

export interface DbHealthIssue {
  severity: DbHealthSeverity;
  code: string;
  table: FullBackupTableName;
  recordId?: number;
  message: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface DbHealthReport {
  generatedAt: string;
  rowCounts: Record<FullBackupTableName, number>;
  issues: Record<DbHealthSeverity, DbHealthIssue[]>;
  repairPreviews: {
    selfReferencedTransfers: SelfReferencedTransferRepairCandidate[];
    orphanedBudgetSnapshots: OrphanedBudgetSnapshotCleanupCandidate[];
  };
}

export type OrphanedBudgetSnapshotRecommendedAction =
  | "safe_to_delete"
  | "manual_review_required";

export interface OrphanedBudgetSnapshotCleanupCandidate {
  snapshotId?: number;
  missingBudgetId: number;
  description: string;
  dueDate: string;
  occurrenceDate: string;
  amount: number;
  hasLinkedTransactions: boolean;
  linkedTransactionIds: number[];
  recommendedAction: OrphanedBudgetSnapshotRecommendedAction;
}

export interface OrphanedBudgetSnapshotSkippedCleanup {
  snapshotId?: number;
  missingBudgetId?: number;
  reason: string;
}

export interface OrphanedBudgetSnapshotCleanupSummary {
  candidateCount: number;
  deletedSnapshotCount: number;
  skippedSnapshotCount: number;
  deletedSnapshotIds: number[];
  skippedSnapshots: OrphanedBudgetSnapshotSkippedCleanup[];
}

export interface SelfReferencedTransferRepairCandidate {
  outgoingTransactionId: number;
  incomingTransactionId: number;
  outgoingCurrentTransferPairId: number;
  incomingCurrentTransferPairId: number;
  outgoingProposedTransferPairId: number;
  incomingProposedTransferPairId: number;
  transactionReference: string;
  date: string;
  description: string;
  amount: number;
}

export interface SelfReferencedTransferUpdatedPair {
  outgoingTransactionId: number;
  incomingTransactionId: number;
  outgoingPreviousTransferPairId: number;
  incomingPreviousTransferPairId: number;
  outgoingNewTransferPairId: number;
  incomingNewTransferPairId: number;
  transactionReference: string;
}

export interface SelfReferencedTransferSkippedPair {
  outgoingTransactionId: number;
  incomingTransactionId: number;
  transactionReference: string;
  reason: string;
}

export interface SelfReferencedTransferRepairSummary {
  candidateCount: number;
  updatedTransactionCount: number;
  skippedCandidateCount: number;
  updatedPairs: SelfReferencedTransferUpdatedPair[];
  skippedPairs: SelfReferencedTransferSkippedPair[];
}

interface TableData {
  transactions: Transaction[];
  budgets: Budget[];
  budgetSnapshots: BudgetSnapshot[];
  buckets: { id?: number }[];
  categories: Category[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  recipients: Recipient[];
  smsImportTemplates: SmsImportTemplate[];
}

const buildTimestampForFilename = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}-${pad(date.getMinutes())}`;
};

const idSet = (records: { id?: number }[]): Set<number> =>
  new Set(
    records
      .map((record) => record.id)
      .filter((id): id is number => id !== undefined),
  );

const idMap = <T extends { id?: number }>(records: T[]): Map<number, T> =>
  new Map(
    records
      .filter((record): record is T & { id: number } => record.id !== undefined)
      .map((record) => [record.id, record]),
  );

const dateKey = (value: Date): string => new Date(value).toISOString();

const addIssue = (
  report: DbHealthReport,
  issue: DbHealthIssue,
): void => {
  report.issues[issue.severity].push(issue);
};

const addMissingReferenceIssue = (
  report: DbHealthReport,
  options: {
    severity: DbHealthSeverity;
    table: FullBackupTableName;
    recordId?: number;
    code: string;
    field: string;
    referencedTable: FullBackupTableName;
    referencedId?: number;
  },
): void => {
  addIssue(report, {
    severity: options.severity,
    code: options.code,
    table: options.table,
    recordId: options.recordId,
    message: `${options.table} record references missing ${options.referencedTable} record via ${options.field}.`,
    details: {
      field: options.field,
      referencedTable: options.referencedTable,
      referencedId: options.referencedId,
    },
  });
};

const readAllTables = async (): Promise<TableData> => {
  const [
    transactions,
    budgets,
    budgetSnapshots,
    buckets,
    categories,
    accounts,
    paymentMethods,
    recipients,
    smsImportTemplates,
  ] = await Promise.all([
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.budgetSnapshots.toArray(),
    db.buckets.toArray(),
    db.categories.toArray(),
    db.accounts.toArray(),
    db.paymentMethods.toArray(),
    db.recipients.toArray(),
    db.smsImportTemplates.toArray(),
  ]);

  return {
    transactions,
    budgets,
    budgetSnapshots,
    buckets,
    categories,
    accounts,
    paymentMethods,
    recipients,
    smsImportTemplates,
  };
};

const getRowCounts = (data: TableData): Record<FullBackupTableName, number> =>
  Object.fromEntries(
    FULL_BACKUP_TABLE_NAMES.map((tableName) => [
      tableName,
      data[tableName].length,
    ]),
  ) as Record<FullBackupTableName, number>;

const checkTransactionReferences = (
  report: DbHealthReport,
  data: TableData,
): void => {
  const categoryIds = idSet(data.categories);
  const accountIds = idSet(data.accounts);
  const recipientIds = idSet(data.recipients);
  const budgetIds = idSet(data.budgets);
  const snapshotsById = idMap(data.budgetSnapshots);

  data.transactions.forEach((transaction) => {
    if (!categoryIds.has(transaction.categoryId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "transactions",
        recordId: transaction.id,
        code: "transaction_missing_category",
        field: "categoryId",
        referencedTable: "categories",
        referencedId: transaction.categoryId,
      });
    }

    if (!transaction.accountId || !accountIds.has(transaction.accountId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "transactions",
        recordId: transaction.id,
        code: "transaction_missing_account",
        field: "accountId",
        referencedTable: "accounts",
        referencedId: transaction.accountId,
      });
    }

    if (!recipientIds.has(transaction.recipientId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "transactions",
        recordId: transaction.id,
        code: "transaction_missing_recipient",
        field: "recipientId",
        referencedTable: "recipients",
        referencedId: transaction.recipientId,
      });
    }

    const snapshot = transaction.budgetSnapshotId
      ? snapshotsById.get(transaction.budgetSnapshotId)
      : undefined;

    if (transaction.budgetSnapshotId && !snapshot) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "transactions",
        recordId: transaction.id,
        code: "transaction_missing_budget_snapshot",
        field: "budgetSnapshotId",
        referencedTable: "budgetSnapshots",
        referencedId: transaction.budgetSnapshotId,
      });
    }

    if (transaction.budgetId && !budgetIds.has(transaction.budgetId)) {
      addMissingReferenceIssue(report, {
        severity: "warning",
        table: "transactions",
        recordId: transaction.id,
        code: "transaction_missing_legacy_budget",
        field: "budgetId",
        referencedTable: "budgets",
        referencedId: transaction.budgetId,
      });
    }

    if (
      transaction.budgetId &&
      transaction.budgetSnapshotId &&
      snapshot &&
      snapshot.budgetId !== transaction.budgetId
    ) {
      addIssue(report, {
        severity: "error",
        code: "transaction_budget_snapshot_budget_mismatch",
        table: "transactions",
        recordId: transaction.id,
        message:
          "Transaction has budgetId and budgetSnapshotId, but the snapshot points to a different budgetId.",
        details: {
          budgetId: transaction.budgetId,
          budgetSnapshotId: transaction.budgetSnapshotId,
          snapshotBudgetId: snapshot.budgetId,
        },
      });
    }
  });
};

const checkBudgetSnapshots = (
  report: DbHealthReport,
  data: TableData,
): void => {
  const budgetIds = idSet(data.budgets);
  const byOccurrence = new Map<string, BudgetSnapshot[]>();
  const byDueDate = new Map<string, BudgetSnapshot[]>();

  data.budgetSnapshots.forEach((snapshot) => {
    if (!budgetIds.has(snapshot.budgetId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "budgetSnapshots",
        recordId: snapshot.id,
        code: "budget_snapshot_missing_budget",
        field: "budgetId",
        referencedTable: "budgets",
        referencedId: snapshot.budgetId,
      });
    }

    const occurrenceKey = `${snapshot.budgetId}:${dateKey(snapshot.occurrenceDate)}`;
    const occurrenceGroup = byOccurrence.get(occurrenceKey) ?? [];
    occurrenceGroup.push(snapshot);
    byOccurrence.set(occurrenceKey, occurrenceGroup);

    const dueDateKey = `${snapshot.budgetId}:${dateKey(snapshot.dueDate)}`;
    const dueDateGroup = byDueDate.get(dueDateKey) ?? [];
    dueDateGroup.push(snapshot);
    byDueDate.set(dueDateKey, dueDateGroup);
  });

  byOccurrence.forEach((snapshots) => {
    if (snapshots.length > 1) {
      addIssue(report, {
        severity: "warning",
        code: "duplicate_budget_snapshots_by_occurrence_date",
        table: "budgetSnapshots",
        message:
          "Multiple BudgetSnapshots share the same budgetId and occurrenceDate.",
        details: {
          budgetId: snapshots[0].budgetId,
          occurrenceDate: dateKey(snapshots[0].occurrenceDate),
          count: snapshots.length,
          ids: snapshots
            .map((snapshot) => snapshot.id)
            .filter((id) => id !== undefined)
            .join(","),
        },
      });
    }
  });

  byDueDate.forEach((snapshots) => {
    if (snapshots.length > 1) {
      addIssue(report, {
        severity: "warning",
        code: "duplicate_budget_snapshots_by_due_date",
        table: "budgetSnapshots",
        message: "Multiple BudgetSnapshots share the same budgetId and dueDate.",
        details: {
          budgetId: snapshots[0].budgetId,
          dueDate: dateKey(snapshots[0].dueDate),
          count: snapshots.length,
          ids: snapshots
            .map((snapshot) => snapshot.id)
            .filter((id) => id !== undefined)
            .join(","),
        },
      });
    }
  });
};

const getOrphanedBudgetSnapshotCleanupCandidates = (
  data: TableData,
): OrphanedBudgetSnapshotCleanupCandidate[] => {
  const budgetIds = idSet(data.budgets);
  const linkedTransactionIdsBySnapshotId = new Map<number, number[]>();

  data.transactions.forEach((transaction) => {
    if (
      transaction.id === undefined ||
      transaction.budgetSnapshotId === undefined
    ) {
      return;
    }

    const linkedIds =
      linkedTransactionIdsBySnapshotId.get(transaction.budgetSnapshotId) ?? [];
    linkedIds.push(transaction.id);
    linkedTransactionIdsBySnapshotId.set(
      transaction.budgetSnapshotId,
      linkedIds,
    );
  });

  return data.budgetSnapshots
    .filter((snapshot) => !budgetIds.has(snapshot.budgetId))
    .map((snapshot) => {
      const linkedTransactionIds =
        snapshot.id !== undefined
          ? (linkedTransactionIdsBySnapshotId.get(snapshot.id) ?? [])
          : [];
      const hasLinkedTransactions = linkedTransactionIds.length > 0;
      const recommendedAction: OrphanedBudgetSnapshotRecommendedAction =
        hasLinkedTransactions ? "manual_review_required" : "safe_to_delete";

      return {
        snapshotId: snapshot.id,
        missingBudgetId: snapshot.budgetId,
        description: snapshot.description,
        dueDate: dateKey(snapshot.dueDate),
        occurrenceDate: dateKey(snapshot.occurrenceDate),
        amount: snapshot.amount,
        hasLinkedTransactions,
        linkedTransactionIds,
        recommendedAction,
      };
    })
    .sort((a, b) => (a.snapshotId ?? 0) - (b.snapshotId ?? 0));
};

const checkTransfers = (report: DbHealthReport, data: TableData): void => {
  const transactionsById = idMap(data.transactions);

  data.transactions.forEach((transaction) => {
    if (!transaction.isTransfer) {
      return;
    }

    if (!transaction.transferPairId) {
      addIssue(report, {
        severity: "error",
        code: "transfer_missing_pair_id",
        table: "transactions",
        recordId: transaction.id,
        message: "Transfer transaction is marked isTransfer but has no transferPairId.",
      });
      return;
    }

    if (
      transaction.id !== undefined &&
      transaction.transferPairId === transaction.id
    ) {
      addIssue(report, {
        severity: "error",
        code: "transfer_pair_self_reference",
        table: "transactions",
        recordId: transaction.id,
        message: "Transfer transaction points to itself as its transfer pair.",
        details: {
          transferPairId: transaction.transferPairId,
        },
      });
      return;
    }

    const pair = transactionsById.get(transaction.transferPairId);
    if (!pair) {
      addIssue(report, {
        severity: "error",
        code: "transfer_pair_missing",
        table: "transactions",
        recordId: transaction.id,
        message: "Transfer transaction points to a missing transferPairId.",
        details: {
          transferPairId: transaction.transferPairId,
        },
      });
      return;
    }

    if (pair.transferPairId !== transaction.id) {
      addIssue(report, {
        severity: "error",
        code: "transfer_pair_not_reciprocal",
        table: "transactions",
        recordId: transaction.id,
        message: "Transfer pair does not point back to the original transaction.",
        details: {
          transferPairId: transaction.transferPairId,
          pairedTransactionTransferPairId: pair.transferPairId,
        },
      });
    }

    const hasOneNegativeAndOnePositive =
      (transaction.amount < 0 && pair.amount > 0) ||
      (transaction.amount > 0 && pair.amount < 0);

    if (!hasOneNegativeAndOnePositive) {
      addIssue(report, {
        severity: "error",
        code: "transfer_pair_invalid_amount_signs",
        table: "transactions",
        recordId: transaction.id,
        message: "Transfer pair does not have one negative and one positive amount.",
        details: {
          transferPairId: transaction.transferPairId,
          amount: transaction.amount,
          pairedTransactionAmount: pair.amount,
        },
      });
    }
  });
};

const createSelfReferencedTransferCandidate = (
  first: Transaction,
  second: Transaction,
): SelfReferencedTransferRepairCandidate | null => {
  if (
    first.id === undefined ||
    second.id === undefined ||
    first.transferPairId !== first.id ||
    second.transferPairId !== second.id ||
    !first.isTransfer ||
    !second.isTransfer ||
    !first.transactionReference ||
    first.transactionReference !== second.transactionReference ||
    new Date(first.date).getTime() !== new Date(second.date).getTime() ||
    (first.description ?? "") !== (second.description ?? "") ||
    first.categoryId !== second.categoryId ||
    Math.abs(first.amount) !== Math.abs(second.amount) ||
    first.amount * second.amount >= 0 ||
    first.accountId === undefined ||
    second.accountId === undefined ||
    first.accountId === second.accountId
  ) {
    return null;
  }

  const outgoing = first.amount < 0 ? first : second;
  const incoming = first.amount > 0 ? first : second;

  if (
    outgoing.id === undefined ||
    incoming.id === undefined ||
    outgoing.transferPairId === undefined ||
    incoming.transferPairId === undefined ||
    !outgoing.transactionReference
  ) {
    return null;
  }

  return {
    outgoingTransactionId: outgoing.id,
    incomingTransactionId: incoming.id,
    outgoingCurrentTransferPairId: outgoing.transferPairId,
    incomingCurrentTransferPairId: incoming.transferPairId,
    outgoingProposedTransferPairId: incoming.id,
    incomingProposedTransferPairId: outgoing.id,
    transactionReference: outgoing.transactionReference,
    date: dateKey(outgoing.date),
    description: outgoing.description ?? "",
    amount: Math.abs(outgoing.amount),
  };
};

const getSelfReferencedTransferRepairCandidates = (
  transactions: Transaction[],
): SelfReferencedTransferRepairCandidate[] => {
  const groups = new Map<string, Transaction[]>();

  transactions.forEach((transaction) => {
    if (
      !transaction.isTransfer ||
      transaction.id === undefined ||
      transaction.transferPairId !== transaction.id ||
      !transaction.transactionReference
    ) {
      return;
    }

    const key = [
      transaction.transactionReference,
      new Date(transaction.date).getTime(),
      transaction.description ?? "",
      transaction.categoryId,
      Math.abs(transaction.amount),
    ].join("|");

    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  });

  const candidates: SelfReferencedTransferRepairCandidate[] = [];

  groups.forEach((group) => {
    if (group.length !== 2) {
      return;
    }

    const [first, second] = group;
    const candidate = createSelfReferencedTransferCandidate(first, second);

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates.sort(
    (a, b) => a.outgoingTransactionId - b.outgoingTransactionId,
  );
};

export const applySelfReferencedTransferRepairs =
  async (): Promise<SelfReferencedTransferRepairSummary> => {
    const data = await readAllTables();
    const candidates = getSelfReferencedTransferRepairCandidates(
      data.transactions,
    );
    const summary: SelfReferencedTransferRepairSummary = {
      candidateCount: candidates.length,
      updatedTransactionCount: 0,
      skippedCandidateCount: 0,
      updatedPairs: [],
      skippedPairs: [],
    };

    await db.transaction("rw", db.transactions, async () => {
      for (const candidate of candidates) {
        const [outgoing, incoming] = await Promise.all([
          db.transactions.get(candidate.outgoingTransactionId),
          db.transactions.get(candidate.incomingTransactionId),
        ]);

        if (!outgoing || !incoming) {
          summary.skippedCandidateCount += 1;
          summary.skippedPairs.push({
            outgoingTransactionId: candidate.outgoingTransactionId,
            incomingTransactionId: candidate.incomingTransactionId,
            transactionReference: candidate.transactionReference,
            reason: "One or both transactions no longer exist.",
          });
          continue;
        }

        const currentCandidate = createSelfReferencedTransferCandidate(
          outgoing,
          incoming,
        );

        if (!currentCandidate) {
          summary.skippedCandidateCount += 1;
          summary.skippedPairs.push({
            outgoingTransactionId: candidate.outgoingTransactionId,
            incomingTransactionId: candidate.incomingTransactionId,
            transactionReference: candidate.transactionReference,
            reason: "Candidate no longer matches high-confidence repair criteria.",
          });
          continue;
        }

        await db.transactions.update(currentCandidate.outgoingTransactionId, {
          transferPairId: currentCandidate.incomingTransactionId,
        });
        await db.transactions.update(currentCandidate.incomingTransactionId, {
          transferPairId: currentCandidate.outgoingTransactionId,
        });

        summary.updatedTransactionCount += 2;
        summary.updatedPairs.push({
          outgoingTransactionId: currentCandidate.outgoingTransactionId,
          incomingTransactionId: currentCandidate.incomingTransactionId,
          outgoingPreviousTransferPairId:
            currentCandidate.outgoingCurrentTransferPairId,
          incomingPreviousTransferPairId:
            currentCandidate.incomingCurrentTransferPairId,
          outgoingNewTransferPairId:
            currentCandidate.outgoingProposedTransferPairId,
          incomingNewTransferPairId:
            currentCandidate.incomingProposedTransferPairId,
          transactionReference: currentCandidate.transactionReference,
        });
      }
    });

    return summary;
  };

export const deleteSafeOrphanedBudgetSnapshots =
  async (): Promise<OrphanedBudgetSnapshotCleanupSummary> => {
    const data = await readAllTables();
    const candidates = getOrphanedBudgetSnapshotCleanupCandidates(data);
    const summary: OrphanedBudgetSnapshotCleanupSummary = {
      candidateCount: candidates.length,
      deletedSnapshotCount: 0,
      skippedSnapshotCount: 0,
      deletedSnapshotIds: [],
      skippedSnapshots: [],
    };

    await db.transaction(
      "rw",
      db.budgetSnapshots,
      db.budgets,
      db.transactions,
      async () => {
        for (const candidate of candidates) {
          if (candidate.recommendedAction !== "safe_to_delete") {
            summary.skippedSnapshotCount += 1;
            summary.skippedSnapshots.push({
              snapshotId: candidate.snapshotId,
              missingBudgetId: candidate.missingBudgetId,
              reason: "Candidate has linked transactions and requires manual review.",
            });
            continue;
          }

          if (candidate.snapshotId === undefined) {
            summary.skippedSnapshotCount += 1;
            summary.skippedSnapshots.push({
              missingBudgetId: candidate.missingBudgetId,
              reason: "Snapshot has no id.",
            });
            continue;
          }

          const snapshot = await db.budgetSnapshots.get(candidate.snapshotId);

          if (!snapshot) {
            summary.skippedSnapshotCount += 1;
            summary.skippedSnapshots.push({
              snapshotId: candidate.snapshotId,
              missingBudgetId: candidate.missingBudgetId,
              reason: "Snapshot no longer exists.",
            });
            continue;
          }

          const budget = await db.budgets.get(snapshot.budgetId);

          if (budget) {
            summary.skippedSnapshotCount += 1;
            summary.skippedSnapshots.push({
              snapshotId: candidate.snapshotId,
              missingBudgetId: snapshot.budgetId,
              reason: "Snapshot budget now exists.",
            });
            continue;
          }

          const linkedTransactionCount = await db.transactions
            .where("budgetSnapshotId")
            .equals(candidate.snapshotId)
            .count();

          if (linkedTransactionCount > 0) {
            summary.skippedSnapshotCount += 1;
            summary.skippedSnapshots.push({
              snapshotId: candidate.snapshotId,
              missingBudgetId: snapshot.budgetId,
              reason: "Snapshot now has linked transactions.",
            });
            continue;
          }

          await db.budgetSnapshots.delete(candidate.snapshotId);
          summary.deletedSnapshotCount += 1;
          summary.deletedSnapshotIds.push(candidate.snapshotId);
        }
      },
    );

    return summary;
  };

const checkBudgetReferences = (
  report: DbHealthReport,
  data: TableData,
): void => {
  const categoryIds = idSet(data.categories);
  const accountIds = idSet(data.accounts);
  const recipientIds = idSet(data.recipients);

  data.budgets.forEach((budget) => {
    if (!categoryIds.has(budget.categoryId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "budgets",
        recordId: budget.id,
        code: "budget_missing_category",
        field: "categoryId",
        referencedTable: "categories",
        referencedId: budget.categoryId,
      });
    }

    if (budget.accountId && !accountIds.has(budget.accountId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "budgets",
        recordId: budget.id,
        code: "budget_missing_account",
        field: "accountId",
        referencedTable: "accounts",
        referencedId: budget.accountId,
      });
    }

    if (budget.recipientId && !recipientIds.has(budget.recipientId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "budgets",
        recordId: budget.id,
        code: "budget_missing_recipient",
        field: "recipientId",
        referencedTable: "recipients",
        referencedId: budget.recipientId,
      });
    }
  });
};

const checkCategoryReferences = (
  report: DbHealthReport,
  data: TableData,
): void => {
  const bucketIds = idSet(data.buckets);

  data.categories.forEach((category) => {
    if (!bucketIds.has(category.bucketId)) {
      addMissingReferenceIssue(report, {
        severity: "error",
        table: "categories",
        recordId: category.id,
        code: "category_missing_bucket",
        field: "bucketId",
        referencedTable: "buckets",
        referencedId: category.bucketId,
      });
    }
  });
};

const checkLegacyTableReferences = (
  report: DbHealthReport,
  data: TableData,
): void => {
  const accountIds = idSet(data.accounts);

  data.smsImportTemplates.forEach((template) => {
    if (!template.accountId || !accountIds.has(template.accountId)) {
      addMissingReferenceIssue(report, {
        severity: "warning",
        table: "smsImportTemplates",
        recordId: template.id,
        code: "sms_template_missing_account",
        field: "accountId",
        referencedTable: "accounts",
        referencedId: template.accountId,
      });
    }
  });

  data.paymentMethods.forEach((paymentMethod) => {
    if (!accountIds.has(paymentMethod.accountId)) {
      addMissingReferenceIssue(report, {
        severity: "warning",
        table: "paymentMethods",
        recordId: paymentMethod.id,
        code: "payment_method_missing_account",
        field: "accountId",
        referencedTable: "accounts",
        referencedId: paymentMethod.accountId,
      });
    }
  });
};

export const runDbHealthCheck = async (): Promise<DbHealthReport> => {
  const data = await readAllTables();
  const report: DbHealthReport = {
    generatedAt: new Date().toISOString(),
    rowCounts: getRowCounts(data),
    issues: {
      error: [],
      warning: [],
      info: [],
    },
    repairPreviews: {
      selfReferencedTransfers: [],
      orphanedBudgetSnapshots: [],
    },
  };

  checkTransactionReferences(report, data);
  checkBudgetSnapshots(report, data);
  checkTransfers(report, data);
  checkBudgetReferences(report, data);
  checkCategoryReferences(report, data);
  checkLegacyTableReferences(report, data);
  report.repairPreviews.selfReferencedTransfers =
    getSelfReferencedTransferRepairCandidates(data.transactions);
  report.repairPreviews.orphanedBudgetSnapshots =
    getOrphanedBudgetSnapshotCleanupCandidates(data);

  if (
    report.issues.error.length === 0 &&
    report.issues.warning.length === 0
  ) {
    addIssue(report, {
      severity: "info",
      code: "health_check_no_issues_found",
      table: "transactions",
      message: "No health check errors or warnings were found.",
    });
  }

  return report;
};

export const getDbHealthReportFilename = (date = new Date()): string =>
  `personal-finance-health-report-${buildTimestampForFilename(date)}.json`;

export const downloadDbHealthReport = (report: DbHealthReport): string => {
  const filename = getDbHealthReportFilename();
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return filename;
};

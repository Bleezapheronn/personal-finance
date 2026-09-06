import type { Category, Recipient, Transaction } from "../db";

export interface TransactionFilterIndex {
  accountIds: Set<number>;
  bucketIds: Set<number>;
  categoryIds: Set<number>;
  recipientIds: Set<number>;
}

export interface TransactionDateDisplay {
  weekday: string;
  day: string;
  month: string;
  time: string;
}

export const buildTransactionFilterIndex = (
  transactions: Transaction[],
  categories: Category[],
): TransactionFilterIndex => {
  const categoryBucketIds = new Map(
    categories.map((category) => [category.id, category.bucketId]),
  );
  const accountIds = new Set<number>();
  const bucketIds = new Set<number>();
  const categoryIds = new Set<number>();
  const recipientIds = new Set<number>();

  transactions.forEach((transaction) => {
    if (transaction.accountId) {
      accountIds.add(transaction.accountId);
    }

    const bucketId = categoryBucketIds.get(transaction.categoryId);
    if (bucketId) {
      bucketIds.add(bucketId);
    }

    categoryIds.add(transaction.categoryId);
    recipientIds.add(transaction.recipientId);
  });

  return { accountIds, bucketIds, categoryIds, recipientIds };
};

export const buildRecipientTransactionCounts = (
  transactions: Transaction[],
): Map<number, number> => {
  const counts = new Map<number, number>();

  transactions.forEach((transaction) => {
    counts.set(
      transaction.recipientId,
      (counts.get(transaction.recipientId) ?? 0) + 1,
    );
  });

  return counts;
};

export const buildRecipientFilterOptions = (
  recipients: Recipient[],
  recipientIds: Set<number>,
  transactionCounts: Map<number, number>,
): Array<{ id: number | undefined; name: string }> =>
  recipients
    .map((recipient, sourceIndex) => ({ recipient, sourceIndex }))
    .filter(
      ({ recipient }) =>
        Boolean(recipient.name) && recipientIds.has(recipient.id || 0),
    )
    .sort((a, b) => {
      const countDifference =
        (transactionCounts.get(b.recipient.id || 0) ?? 0) -
        (transactionCounts.get(a.recipient.id || 0) ?? 0);
      return countDifference || a.sourceIndex - b.sourceIndex;
    })
    .map(({ recipient }) => ({ id: recipient.id, name: recipient.name }));

export const buildTransactionDateDisplays = (
  transactions: Transaction[],
  locale: string | undefined,
  timeZone: string | undefined,
): Map<Transaction, TransactionDateDisplay> => {
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  });
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    timeZone,
  });
  const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone,
  });

  return new Map(
    transactions.map((transaction) => {
      const date = new Date(transaction.date);
      return [
        transaction,
        {
          weekday: weekdayFormatter.format(date).toUpperCase(),
          day: dayFormatter.format(date),
          month: monthFormatter.format(date).toUpperCase(),
          time: timeFormatter.format(date),
        },
      ];
    }),
  );
};

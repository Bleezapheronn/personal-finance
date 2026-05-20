import React, { useCallback, useMemo, useState } from "react";
import {
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
import { findMatchingTransactions } from "../utils/transactionMatching";
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

const BudgetHistory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountImages, setAccountImages] = useState<Map<number, string>>(
    new Map(),
  );

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<number | undefined>(
    undefined,
  );
  const [budgetDeleteHasTransactions, setBudgetDeleteHasTransactions] =
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

  const [successMsg, setSuccessMsg] = useState("");
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
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
        db.budgetSnapshots.toArray(),
        db.budgets.toArray(),
        db.transactions.toArray(),
        db.categories.toArray(),
        db.buckets.toArray(),
        db.recipients.toArray(),
        db.accounts.toArray(),
      ]);

      const imageMap = new Map<number, string>();
      for (const acc of accs) {
        if (acc.id && acc.imageBlob) {
          const url = URL.createObjectURL(acc.imageBlob);
          imageMap.set(acc.id, url);
        }
      }

      setSnapshots(allSnapshots);
      setBudgets(allBudgets);
      setTransactions(allTransactions);
      setCategories(cats);
      setBuckets(bkts);
      setRecipients(recs);
      setAccounts(accs);
      setAccountImages(imageMap);
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
    (snapshotId: number | undefined, budgetId: number, targetDate: Date) => {
      const targetTime = normalizeToLocalDay(targetDate).getTime();

      return transactions.filter(
        (txn) =>
          (snapshotId !== undefined && txn.budgetSnapshotId === snapshotId) ||
          (txn.budgetId === budgetId &&
            txn.occurrenceDate &&
            normalizeToLocalDay(txn.occurrenceDate).getTime() === targetTime),
      );
    },
    [transactions],
  );

  const isExpenseBudget = (
    budget: Pick<Budget, "goalDirection" | "amount">,
  ): boolean => {
    return (
      budget.goalDirection === "expense" ||
      (budget.goalDirection === undefined && budget.amount < 0)
    );
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

  const groupedOccurrences = useMemo(() => {
    const groups = new Map<string, BudgetOccurrence[]>();

    pastOccurrences.forEach((occurrence) => {
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
  }, [pastOccurrences]);

  const handleDeleteClick = (budgetId: number) => {
    const linkedTxns = transactions.filter((txn) => txn.budgetId === budgetId);
    setBudgetDeleteHasTransactions(linkedTxns.length > 0);
    setBudgetToDelete(budgetId);
    setShowDeleteConfirm(true);
  };

  const handleToggleBudgetActive = async (budget: Budget) => {
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
      await loadData();
    } catch (err) {
      console.error("Error deleting budget:", err);
      setError("Failed to delete budget");
    }
  };

  const handleOpenLinkModal = (budgetOccurrence: BudgetOccurrence) => {
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

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/budget" />
          </IonButtons>
          <IonTitle>Budget History</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonAlert
          isOpen={showDeleteConfirm}
          onDidDismiss={() => setShowDeleteConfirm(false)}
          header="Delete Budget"
          message={
            budgetDeleteHasTransactions
              ? "This budget has linked transactions. It will be deactivated instead of deleted. You can reactivate it later if needed."
              : "Are you sure you want to delete this budget? This action cannot be undone."
          }
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
              handler: () => setShowDeleteConfirm(false),
            },
            {
              text: budgetDeleteHasTransactions ? "Deactivate" : "Delete",
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

        {!loading && !error && pastOccurrences.length === 0 && (
          <IonText>
            <p>No budget history found yet.</p>
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
                        setSelectedOccurrenceForCompletion(occ);
                        setShowCompleteModal(true);
                      }}
                      style={{ cursor: "pointer" }}
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
                                      setSnapshotToEdit(snap);
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
                                    handleDeleteClick(occ.budget.id!);
                                  }}
                                  title="Delete Budget Item"
                                >
                                  <IonIcon icon={trashOutline} slot="end" />
                                </IonButton>
                              </IonCol>
                            </IonRow>
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

        <EditSnapshotModal
          snapshot={snapshotToEdit}
          isOpen={showEditSnapshotModal}
          onDismiss={() => {
            setShowEditSnapshotModal(false);
            setSnapshotToEdit(null);
          }}
          onSaved={() => {
            setShowEditSnapshotModal(false);
            setSnapshotToEdit(null);
            loadData();
          }}
        />

        {selectedOccurrenceForCompletion && (
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
      </IonContent>
    </IonPage>
  );
};

export default BudgetHistory;

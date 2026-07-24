import React, { useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonText,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
  useIonViewWillEnter,
  IonIcon,
  IonAlert,
  IonGrid,
  IonRow,
  IonCol,
} from "@ionic/react";
import { useParams, useHistory } from "react-router-dom";
import { createOutline, calendar, linkOutline, trash } from "ionicons/icons";
import { db, Transaction, Category, Recipient, Account, Budget, BudgetSnapshot } from "../db";
import { getRepositoryBackend, isHttpSelectedReadRepositoryBackend } from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import type {
  AccountDto,
  BudgetDto,
  BudgetSnapshotDto,
  CategoryDto,
  RecipientDto,
  TransactionDto,
} from "../repositories/http/types";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { SqliteAuthorityToolbarStatus } from "../components/SqliteAuthorityRehearsalBanner";
import {
  dryRunBudgetSnapshotOccurrence,
  writeBudgetSnapshotOccurrence,
} from "../repositories/http/budgetSnapshotOccurrenceWrite";

const asBoolean = (value: boolean | number): boolean =>
  value === true || value === 1;

const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const normalizeTransaction = (
  row: Transaction | TransactionDto,
): Transaction => ({
  ...row,
  accountId: row.accountId ?? undefined,
  paymentChannelId: row.paymentChannelId ?? undefined,
  originalAmount: row.originalAmount ?? undefined,
  originalCurrency: row.originalCurrency ?? undefined,
  exchangeRate: row.exchangeRate ?? undefined,
  transactionReference: row.transactionReference ?? undefined,
  transactionCost: row.transactionCost ?? undefined,
  description: row.description ?? undefined,
  transferPairId: row.transferPairId ?? undefined,
  isTransfer: row.isTransfer == null ? undefined : asBoolean(row.isTransfer),
  budgetId: row.budgetId ?? undefined,
  occurrenceDate:
    row.occurrenceDate == null ? undefined : asDate(row.occurrenceDate),
  budgetSnapshotId: row.budgetSnapshotId ?? undefined,
  date: asDate(row.date),
});

const normalizeCategory = (row: Category | CategoryDto): Category => ({
  ...row,
  name: row.name ?? undefined,
  description: row.description ?? undefined,
  isActive: asBoolean(row.isActive),
  createdAt: asDate(row.createdAt),
  updatedAt: asDate(row.updatedAt),
});

const normalizeRecipient = (row: Recipient | RecipientDto): Recipient => ({
  ...row,
  aliases: row.aliases ?? undefined,
  email: row.email ?? undefined,
  phone: row.phone ?? undefined,
  tillNumber: row.tillNumber ?? undefined,
  paybill: row.paybill ?? undefined,
  accountNumber: row.accountNumber ?? undefined,
  description: row.description ?? undefined,
  isActive: asBoolean(row.isActive),
  createdAt: asDate(row.createdAt),
  updatedAt: asDate(row.updatedAt),
});

const normalizeAccount = (row: Account | AccountDto): Account => ({
  ...row,
  description: row.description ?? undefined,
  currency: row.currency ?? undefined,
  isActive: asBoolean(row.isActive),
  isCredit: asBoolean(row.isCredit),
  creditLimit: row.creditLimit ?? undefined,
  createdAt: asDate(row.createdAt),
  updatedAt: asDate(row.updatedAt),
});

const normalizeBudget = (row: Budget | BudgetDto): Budget => ({
  ...row,
  paymentChannelId: row.paymentChannelId ?? undefined,
  accountId: row.accountId ?? undefined,
  recipientId: row.recipientId ?? undefined,
  transactionCost: row.transactionCost ?? undefined,
  frequencyDetails:
    typeof row.frequencyDetails === "string"
      ? undefined
      : (row.frequencyDetails ?? undefined),
  isGoal: asBoolean(row.isGoal),
  isFlexible: asBoolean(row.isFlexible),
  goalPercentage: row.goalPercentage ?? undefined,
  goalDirection: row.goalDirection ?? undefined,
  isActive: asBoolean(row.isActive),
  remainingCyclesTotal: row.remainingCyclesTotal ?? undefined,
  dueDate: asDate(row.dueDate),
  createdAt: asDate(row.createdAt),
  updatedAt: asDate(row.updatedAt),
});

const TransactionDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useHistory();
  const backend = getRepositoryBackend();
  const httpSelected = isHttpSelectedReadRepositoryBackend(backend);
  const authority = useSqliteAuthorityRehearsal();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [showRemoveAlert, setShowRemoveAlert] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const occurrenceWritesActive =
    httpSelected &&
    authority.ready &&
    authority.budgetSnapshotOccurrenceWritesAvailable;

  useIonViewWillEnter(() => {
    const fetchDetail = async () => {
      const repositories = getSelectedReadRepositories(backend);
      const selectedTransaction = await repositories.transactions.getById(Number(id));
      const transaction = selectedTransaction
        ? normalizeTransaction(selectedTransaction)
        : undefined;
      setTxn(transaction || null);
      if (transaction) {
        // Fetch related data
        const [cat, rec, acc] = await Promise.all([
          repositories.categories.getById(transaction.categoryId),
          repositories.recipients.getById(transaction.recipientId),
          transaction.accountId
            ? repositories.accounts.getById(transaction.accountId)
            : Promise.resolve(null),
        ]);
        setCategory(cat ? normalizeCategory(cat) : null);
        setRecipient(rec ? normalizeRecipient(rec) : null);
        setAccount(acc ? normalizeAccount(acc) : null);

        // Fetch linked budget through snapshot linkage when present.
        if (transaction.budgetSnapshotId !== undefined) {
          const linkedSnapshot = await repositories.budgetSnapshots.getById(
            transaction.budgetSnapshotId,
          );
          if (linkedSnapshot) {
            const snapshot = linkedSnapshot as BudgetSnapshot | BudgetSnapshotDto;
            const linkedBudget = await repositories.budgets.getById(snapshot.budgetId);
            setBudget(linkedBudget ? normalizeBudget(linkedBudget) : null);
          } else {
            setBudget(null);
          }
        } else {
          setBudget(null);
        }

        // Fetch recent history for same recipient
        const selectedHistory = await repositories.transactions.list({
          recipientId: transaction.recipientId,
          limit: 4,
          offset: 0,
        });
        const allForRecipient = (
          Array.isArray(selectedHistory)
            ? selectedHistory
            : selectedHistory.rows
        ).map((row) => normalizeTransaction(row));
        setHistory(
          allForRecipient.filter((t) => t.id !== transaction.id).slice(0, 3),
        );
      }
    };
    fetchDetail();
  });

  const handleRemoveFromBudget = async () => {
    if (!txn) return;

    try {
      if (httpSelected) {
        if (!occurrenceWritesActive) {
          setMutationError("Budget occurrence changes are currently unavailable.");
          return;
        }
        const input = {
          transactionId: txn.id!,
          ...(txn.budgetSnapshotId
            ? { snapshotId: txn.budgetSnapshotId }
            : {}),
        };
        const dryRun = await dryRunBudgetSnapshotOccurrence("unlink", input);
        const confirmed = window.confirm(
          "Remove this Budget link?\n\nOnly this Transaction's Budget linkage fields will be cleared. The occurrence remains unchanged.",
        );
        if (!confirmed) return;
        await writeBudgetSnapshotOccurrence(
          "unlink",
          input,
          dryRun.planFingerprint!,
        );
      } else {
        await db.transactions.update(txn.id!, {
          budgetSnapshotId: undefined,
          budgetId: undefined,
          occurrenceDate: undefined,
        });
      }

      // Update local state
      setTxn({
        ...txn,
        budgetSnapshotId: undefined,
        budgetId: undefined,
        occurrenceDate: undefined,
      });
      setBudget(null);
      setShowRemoveAlert(false);
    } catch (error) {
      console.error("Error removing transaction from budget:", error);
      setMutationError(
        error instanceof Error ? error.message : "Budget unlink failed.",
      );
    }
  };

  const handleLinkSnapshot = async () => {
    if (!txn || !occurrenceWritesActive) {
      setMutationError("Budget occurrence changes are currently unavailable.");
      return;
    }
    const snapshotText = window.prompt("Budget occurrence snapshot ID");
    if (!snapshotText) return;
    const snapshotId = Number(snapshotText);
    if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
      setMutationError("Enter a valid snapshot ID.");
      return;
    }
    const action = txn.budgetSnapshotId ? "changeLink" : "link";
    const input = {
      transactionId: txn.id!,
      snapshotId,
      ...(txn.budgetSnapshotId
        ? { expectedCurrentSnapshotId: txn.budgetSnapshotId }
        : {}),
    };
    try {
      const dryRun = await dryRunBudgetSnapshotOccurrence(action, input);
      const confirmed = window.confirm(
        `${txn.budgetSnapshotId ? "Change" : "Add"} this Budget link?\n\n` +
          "Only this Transaction's Budget linkage fields will change.",
      );
      if (!confirmed) return;
      const result = await writeBudgetSnapshotOccurrence(
        action,
        input,
        dryRun.planFingerprint!,
      );
      const repositories = getSelectedReadRepositories(backend);
      const [snapshotRow, transactionRow] = await Promise.all([
        repositories.budgetSnapshots.getById(result.target.snapshotId!),
        repositories.transactions.getById(txn.id!),
      ]);
      if (!snapshotRow || !transactionRow) {
        throw new Error("budget_snapshot_link_refresh_failed");
      }
      const snapshot = snapshotRow as BudgetSnapshot | BudgetSnapshotDto;
      const budgetRow = await repositories.budgets.getById(snapshot.budgetId);
      setTxn(normalizeTransaction(transactionRow));
      setBudget(budgetRow ? normalizeBudget(budgetRow) : null);
      setMutationError("");
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Budget link failed.",
      );
    }
  };

  if (!txn) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonMenuButton />
            </IonButtons>
            <IonTitle>Transaction Details</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText color="danger">Transaction not found.</IonText>
        </IonContent>
      </IonPage>
    );
  }

  const totalAmount = txn.amount + (txn.transactionCost || 0);
  const isNegative = totalAmount < 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Transaction Details</IonTitle>
          <SqliteAuthorityToolbarStatus />
          <IonButtons slot="end">
            {httpSelected && occurrenceWritesActive && (
              <IonButton
                onClick={handleLinkSnapshot}
                title={txn.budgetSnapshotId ? "Change Budget link" : "Link Budget"}
              >
                <IonIcon slot="icon-only" icon={linkOutline} />
              </IonButton>
            )}
            <IonButton
              onClick={() => navigate.push(`/budget/from-transaction/${id}`)}
              title="Create Budget from Transaction"
              disabled={
                httpSelected &&
                !(
                  authority.ready &&
                  authority.budgetSnapshotOccurrenceWritesAvailable
                )
              }
            >
              <IonIcon slot="icon-only" icon={calendar} />
            </IonButton>
            <IonButton onClick={() => navigate.push(`/edit/${id}`)}>
              <IonIcon slot="icon-only" icon={createOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {mutationError && (
          <IonText color="danger">
            <p>{mutationError}</p>
          </IonText>
        )}
        {/* Amount and Recipient */}
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <IonText
            style={{
              fontSize: "2.3rem",
              color: isNegative ? "orangered" : "green",
              fontWeight: "bold",
            }}
          >
            {isNegative ? "-" : ""}
            {Math.abs(totalAmount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </IonText>
          <div style={{ fontSize: "0.9rem", color: "#888", marginTop: 5 }}>
            {isNegative ? "Paid to" : "Received from"}
          </div>
          <div
            style={{ fontSize: "1.2rem", fontWeight: "bold", marginBottom: 3 }}
          >
            {recipient?.name || "—"}
          </div>
          <div style={{ fontSize: "0.95rem", color: "#888" }}>
            {new Date(txn.date).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            at{" "}
            {new Date(txn.date).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div style={{ color: "#888", fontSize: "0.9rem" }}>
            Via {account?.name || "—"}
          </div>
        </div>

        {/* Details Card */}
        <IonCard>
          <IonCardHeader style={{ fontWeight: 500, fontSize: "1rem" }}>
            Description
          </IonCardHeader>
          <IonCardContent>
            <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {txn.description || "—"}
            </IonText>
            <div style={{ marginTop: 12 }}>
              <IonText style={{ color: "#888" }}>Category</IonText>
              <br />
              <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
                {category?.name || "—"}
              </IonText>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 18,
              }}
            >
              <div>
                <IonText style={{ color: "#888" }}>Amount</IonText>
                <br />
                <IonText style={{ fontWeight: "bold", fontSize: "1.12rem" }}>
                  {txn.amount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </IonText>
              </div>
              <div>
                <IonText style={{ color: "#888" }}>Charges</IonText>
                <br />
                <IonText style={{ fontWeight: "bold", fontSize: "1.12rem" }}>
                  {txn.transactionCost?.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) ?? "0.00"}
                </IonText>
              </div>
            </div>
            {txn.originalAmount && (
              <div style={{ marginTop: 18 }}>
                <IonText style={{ color: "#888" }}>Original Amount</IonText>
                <br />
                <IonText style={{ fontWeight: "bold", fontSize: "1.12rem" }}>
                  {txn.originalAmount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {txn.originalCurrency || ""}
                  {txn.exchangeRate && (
                    <span style={{ color: "#888", fontSize: "0.9rem" }}>
                      {" "}
                      @ {txn.exchangeRate}
                    </span>
                  )}
                </IonText>
              </div>
            )}
            {txn.transactionReference && (
              <div style={{ marginTop: 18 }}>
                <IonText style={{ color: "#888" }}>Reference</IonText>
                <br />
                <IonText style={{ fontWeight: "bold", fontSize: "1.12rem" }}>
                  {txn.transactionReference}
                </IonText>
              </div>
            )}
          </IonCardContent>
        </IonCard>

        {/* Linked Budget Card - Only shown if transaction is linked to a budget */}
        {txn.budgetSnapshotId && budget && txn.occurrenceDate && (
          <IonCard style={{ marginTop: "1.6rem" }}>
            <IonCardHeader
              style={{
                fontWeight: 500,
                fontSize: "1rem",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Linked Budget</span>
            </IonCardHeader>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  <IonCol>
                    <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
                      {new Date(txn.occurrenceDate).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </IonText>
                  </IonCol>
                  <IonCol style={{ textAlign: "right" }}>
                    <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
                      {budget.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </IonText>
                  </IonCol>
                  <IonCol size="1">
                    <IonButton
                      fill="clear"
                      size="small"
                      color="danger"
                      style={{ marginTop: -4 }}
                      onClick={() => setShowRemoveAlert(true)}
                      title="Remove from budget"
                      disabled={httpSelected && !authority.ready}
                    >
                      <IonIcon icon={trash} />
                    </IonButton>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        )}

        {/* Recent Activity/History */}
        {history.length > 0 && (
          <IonCard style={{ marginTop: "1.6rem" }}>
            <IonCardHeader style={{ fontWeight: 500, fontSize: "1rem" }}>
              Recent activity with {recipient?.name || "this recipient"}
            </IonCardHeader>
            <IonCardContent style={{ padding: 0 }}>
              <IonList>
                {history.map((h) => {
                  const hTotal = h.amount + (h.transactionCost || 0);
                  return (
                    <IonItem
                      key={h.id}
                      style={{ fontSize: "1.05rem" }}
                      lines="none"
                    >
                      <IonLabel>
                        <div style={{ fontSize: "0.9rem", color: "#888" }}>
                          {new Date(h.date)
                            .toLocaleDateString(undefined, {
                              month: "short",
                              day: "2-digit",
                            })
                            .toUpperCase()}
                        </div>
                        {h.description || "—"}
                      </IonLabel>
                      <IonText color={hTotal < 0 ? "danger" : "success"}>
                        <span style={{ fontWeight: "bold" }}>
                          {hTotal < 0 ? "-" : ""}
                          {Math.abs(hTotal).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </IonText>
                    </IonItem>
                  );
                })}
              </IonList>
            </IonCardContent>
          </IonCard>
        )}

        {/* Remove from Budget Alert */}
        <IonAlert
          isOpen={showRemoveAlert}
          onDidDismiss={() => setShowRemoveAlert(false)}
          header="Remove from Budget?"
          message="This transaction will no longer be linked to the budget item."
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Remove",
              role: "destructive",
              handler: handleRemoveFromBudget,
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default TransactionDetails;

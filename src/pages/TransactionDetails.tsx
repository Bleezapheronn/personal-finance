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
import { createOutline, calendar, trash } from "ionicons/icons";
import {
  db,
  Transaction,
  Category,
  PaymentMethod,
  Recipient,
  Account,
  Budget,
} from "../db";

const TransactionDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useHistory();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [showRemoveAlert, setShowRemoveAlert] = useState(false);

  useIonViewWillEnter(() => {
    const fetchDetail = async () => {
      const transaction = await db.transactions.get(Number(id));
      setTxn(transaction || null);
      if (transaction) {
        // Fetch related data
        const [cat, pm, rec, acc] = await Promise.all([
          db.categories.get(transaction.categoryId),
          db.paymentMethods.get(transaction.paymentChannelId),
          db.recipients.get(transaction.recipientId),
          db.paymentMethods
            .get(transaction.paymentChannelId)
            .then(async (pm) => {
              if (pm?.accountId) {
                return db.accounts.get(pm.accountId);
              }
              return null;
            }),
        ]);
        setCategory(cat || null);
        setPaymentMethod(pm || null);
        setRecipient(rec || null);
        setAccount(acc || null);

        // Fetch linked budget if exists
        if (transaction.budgetId) {
          const linkedBudget = await db.budgets.get(transaction.budgetId);
          setBudget(linkedBudget || null);
        }

        // Fetch recent history for same recipient
        const allForRecipient = await db.transactions
          .where("recipientId")
          .equals(transaction.recipientId)
          .reverse()
          .sortBy("date");
        setHistory(
          allForRecipient.filter((t) => t.id !== transaction.id).slice(0, 3)
        );
      }
    };
    fetchDetail();
  });

  const handleRemoveFromBudget = async () => {
    if (!txn) return;

    try {
      await db.transactions.update(txn.id!, {
        budgetId: undefined,
        occurrenceDate: undefined,
      });

      // Update local state
      setTxn({
        ...txn,
        budgetId: undefined,
        occurrenceDate: undefined,
      });
      setBudget(null);
      setShowRemoveAlert(false);
    } catch (error) {
      console.error("Error removing transaction from budget:", error);
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
          <IonButtons slot="end">
            <IonButton
              onClick={() => navigate.push(`/budget/from-transaction/${id}`)}
              title="Create Budget from Transaction"
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
            Via {account?.name || "—"} - {paymentMethod?.name || "—"}
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
        {txn.budgetId && budget && txn.occurrenceDate && (
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
                        }
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

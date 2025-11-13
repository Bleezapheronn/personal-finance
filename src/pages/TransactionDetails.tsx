import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
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
} from "@ionic/react";
import { useParams } from "react-router-dom";
import { db, Transaction } from "../db"; // Adjust path as needed

const TransactionDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);

  useIonViewWillEnter(() => {
    const fetchDetail = async () => {
      const transaction = await db.transactions.get(Number(id));
      setTxn(transaction || null);
      if (transaction?.recipient) {
        // Fetch recent history for same recipient
        const allForRecipient = await db.transactions
          .where("recipient")
          .equals(transaction.recipient)
          .reverse()
          .sortBy("date");
        setHistory(
          allForRecipient.filter((t) => t.id !== transaction.id).slice(0, 3)
        );
      }
    };
    fetchDetail();
  });

  if (!txn) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Transaction Details</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText color="danger">Transaction not found.</IonText>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Transaction Details</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Amount and Recipient */}
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <IonText
            style={{
              fontSize: "2.3rem",
              color: "orangered",
              fontWeight: "bold",
            }}
          >
            KShs. {txn.amount + (txn.transactionCost || 0) < 0 ? "-" : ""}
            {Math.abs(txn.amount + (txn.transactionCost || 0)).toLocaleString(
              undefined,
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            )}
          </IonText>
          <div style={{ fontSize: "0.9rem", color: "#888", marginTop: 5 }}>
            Paid to
          </div>
          <div
            style={{ fontSize: "1.2rem", fontWeight: "bold", marginBottom: 3 }}
          >
            {txn.recipient}
          </div>
          <div style={{ fontSize: "0.95rem", color: "#888" }}>
            {new Date(txn.date).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div style={{ color: "#888", fontSize: "0.9rem" }}>
            Via {txn.paymentMode}{" "}
            {txn.paymentChannel ? `(${txn.paymentChannel})` : ""}
          </div>
        </div>

        {/* Details Card */}
        <IonCard>
          <IonCardHeader style={{ fontWeight: 500, fontSize: "1rem" }}>
            Description
          </IonCardHeader>
          <IonCardContent>
            <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {txn.description}
            </IonText>
            <div style={{ marginTop: 12 }}>
              <IonText style={{ color: "#888" }}>Category</IonText>
              <br />
              <IonText style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
                {txn.category}
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
          </IonCardContent>
        </IonCard>

        {/* Recent Activity/History */}
        <IonCard style={{ marginTop: "1.6rem" }}>
          <IonCardHeader style={{ fontWeight: 500, fontSize: "1rem" }}>
            Recent activity
          </IonCardHeader>
          <IonCardContent style={{ padding: 0 }}>
            <IonList>
              {history.map((h) => (
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
                    {h.description}
                  </IonLabel>
                  <IonText color="danger">
                    <span style={{ fontWeight: "bold" }}>
                      {h.amount + (h.transactionCost || 0) < 0 ? "-" : ""}
                      {Math.abs(
                        h.amount + (h.transactionCost || 0)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </IonText>
                </IonItem>
              ))}
            </IonList>
            <IonButton
              expand="block"
              fill="clear"
              color="primary"
              style={{ marginTop: 5 }}
            >
              VIEW ALL
            </IonButton>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default TransactionDetails;

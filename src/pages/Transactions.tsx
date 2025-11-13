import React, { useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonText,
  IonSpinner,
  IonButton,
  IonIcon,
  useIonViewWillEnter,
} from "@ionic/react";

import { useHistory } from "react-router-dom";
import { eyeOutline, trashOutline } from "ionicons/icons";
import { db, Transaction } from "../db"; // adjust path if needed

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const history = useHistory(); // for navigation

  const fetchTransactions = async () => {
    setLoading(true);

    try {
      const allTransactions = await db.transactions.toArray();

      // Sort descending by date, then by total amount
      const sortedTransactions = allTransactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateB !== dateA) {
          return dateB - dateA; // Newest dates first
        }
        const totalA = a.amount + (a.transactionCost || 0);
        const totalB = b.amount + (b.transactionCost || 0);
        return totalB - totalA; // Larger amounts first
      });

      setTransactions(sortedTransactions);
      setError("");
    } catch (err) {
      setError("Failed to load transactions.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // This hook runs every time the page is about to enter and become active
  useIonViewWillEnter(() => {
    fetchTransactions();
  });

  // Handler to navigate to Transaction Details page with transaction ID
  const handleView = (id?: number) => {
    if (id !== undefined) {
      history.push(`/transaction-details/${id}`);
    }
  };

  // Handler to delete a transaction and refresh list
  const handleDelete = async (id?: number) => {
    if (id === undefined) return;
    try {
      await db.transactions.delete(id);
      fetchTransactions(); // refresh after delete
    } catch (err) {
      console.error("Error deleting transaction:", err);
      setError("Error deleting transaction.");
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Your Transactions</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}
        {!loading && transactions && transactions.length === 0 && (
          <IonText>No transactions found.</IonText>
        )}
        {!loading && transactions && transactions.length > 0 && (
          <IonList>
            {transactions.map((txn) => (
              <IonItem key={txn.id}>
                <IonLabel>
                  <h2>{new Date(txn.date).toLocaleString()}</h2>
                  <p>
                    Amount:{" "}
                    {(txn.amount + (txn.transactionCost || 0)).toLocaleString(
                      undefined,
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    )}
                    <br />
                    Description: {txn.description || "—"} <br />
                    Category: {txn.category} <br />
                    Payment: {txn.paymentMode}
                  </p>
                </IonLabel>
                {/* View Button */}
                <IonButton fill="clear" onClick={() => handleView(txn.id)}>
                  <IonIcon slot="icon-only" icon={eyeOutline} />
                </IonButton>
                {/* Delete Button */}
                <IonButton
                  fill="clear"
                  color="danger"
                  onClick={() => handleDelete(txn.id)}
                >
                  <IonIcon slot="icon-only" icon={trashOutline} />
                </IonButton>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Transactions;

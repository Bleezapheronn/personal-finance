import React, { useEffect, useMemo, useState } from "react";
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
  IonCard,
  IonCardContent,
  IonChip,
  IonLabel,
  IonItem,
  IonList,
} from "@ionic/react";
import { Budget, BudgetSnapshot, Transaction, db } from "../db";

const BudgetHistory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [allSnapshots, allBudgets, allTransactions] = await Promise.all([
          db.budgetSnapshots.toArray(),
          db.budgets.toArray(),
          db.transactions.toArray(),
        ]);

        setSnapshots(allSnapshots);
        setBudgets(allBudgets);
        setTransactions(allTransactions);
        setError("");
      } catch (err) {
        console.error("Failed to load budget history:", err);
        setError("Failed to load budget history");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort(
      (a, b) =>
        new Date(b.occurrenceDate).getTime() -
        new Date(a.occurrenceDate).getTime(),
    );
  }, [snapshots]);

  const getLinkedTransactions = (
    snapshotId: number,
    budgetId: number,
    occurrenceDate: Date,
  ) => {
    const occurrenceTime = new Date(occurrenceDate).getTime();
    return transactions.filter(
      (txn) =>
        txn.budgetSnapshotId === snapshotId ||
        (txn.budgetId === budgetId &&
          txn.occurrenceDate &&
          new Date(txn.occurrenceDate).getTime() === occurrenceTime),
    );
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
        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}

        {!loading && !error && sortedSnapshots.length === 0 && (
          <IonText>
            <p>No budget history found yet.</p>
          </IonText>
        )}

        {!loading && !error && sortedSnapshots.length > 0 && (
          <IonList>
            {sortedSnapshots.map((snapshot) => {
              const linked = snapshot.id
                ? getLinkedTransactions(
                    snapshot.id,
                    snapshot.budgetId,
                    snapshot.occurrenceDate,
                  )
                : [];

              const amountPaid = linked.reduce(
                (sum, txn) => sum + txn.amount + (txn.transactionCost || 0),
                0,
              );

              const isCompleted =
                snapshot.amount < 0
                  ? amountPaid <= snapshot.amount
                  : amountPaid >= snapshot.amount;

              const budgetStillActive = budgets.some(
                (budget) => budget.id === snapshot.budgetId && budget.isActive,
              );

              return (
                <IonItem key={snapshot.id} lines="none">
                  <IonCard style={{ width: "100%" }}>
                    <IonCardContent>
                      <h3 style={{ marginTop: 0 }}>{snapshot.description}</h3>
                      <p style={{ margin: "6px 0", color: "#666" }}>
                        Due: {new Date(snapshot.dueDate).toLocaleDateString()} |
                        Frequency: {snapshot.frequency}
                      </p>
                      <p style={{ margin: "6px 0", color: "#666" }}>
                        Budgeted:{" "}
                        {Math.abs(
                          snapshot.amount + (snapshot.transactionCost || 0),
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        {"  "}
                        Paid:{" "}
                        {Math.abs(amountPaid).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <IonChip color={isCompleted ? "success" : "medium"}>
                          <IonLabel>
                            {isCompleted ? "Completed" : "Pending"}
                          </IonLabel>
                        </IonChip>
                        <IonChip
                          color={snapshot.isFlexible ? "warning" : "primary"}
                        >
                          <IonLabel>
                            {snapshot.isFlexible ? "Flexible" : "Strict"}
                          </IonLabel>
                        </IonChip>
                        <IonChip
                          color={budgetStillActive ? "tertiary" : "dark"}
                        >
                          <IonLabel>
                            {budgetStillActive
                              ? "Active Budget"
                              : "Budget Inactive"}
                          </IonLabel>
                        </IonChip>
                        <IonChip color="light">
                          <IonLabel>
                            {linked.length} linked txn
                            {linked.length !== 1 ? "s" : ""}
                          </IonLabel>
                        </IonChip>
                      </div>
                    </IonCardContent>
                  </IonCard>
                </IonItem>
              );
            })}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default BudgetHistory;

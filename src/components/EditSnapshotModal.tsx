import React, { useEffect, useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonCheckbox,
  IonText,
  IonNote,
} from "@ionic/react";
import { BudgetSnapshot, db } from "../db";

interface Props {
  snapshot: BudgetSnapshot | null;
  budgetDueDate?: Date;
  isOpen: boolean;
  onDismiss: () => void;
  onSaved: () => void;
}

export const EditSnapshotModal: React.FC<Props> = ({
  snapshot,
  budgetDueDate,
  isOpen,
  onDismiss,
  onSaved,
}) => {
  const [amount, setAmount] = useState("");
  const [transactionCost, setTransactionCost] = useState("");
  const [isFlexible, setIsFlexible] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Pre-populate fields whenever the snapshot changes
  useEffect(() => {
    if (snapshot) {
      setAmount(String(Math.abs(snapshot.amount)));
      setTransactionCost(
        snapshot.transactionCost != null
          ? String(Math.abs(snapshot.transactionCost))
          : "",
      );
      setIsFlexible(snapshot.isFlexible ?? false);
      setErrorMsg("");
    }
  }, [snapshot]);

  const handleSave = async () => {
    if (!snapshot?.id) return;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg("Amount must be a positive number.");
      return;
    }

    const parsedCost =
      transactionCost.trim() === "" ? undefined : parseFloat(transactionCost);
    if (parsedCost !== undefined && (isNaN(parsedCost) || parsedCost < 0)) {
      setErrorMsg("Transaction cost must be a non-negative number.");
      return;
    }

    // Preserve the original sign (expenses are stored as negative)
    const signedAmount =
      snapshot.amount < 0 ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

    const signedCost =
      parsedCost !== undefined
        ? snapshot.amount < 0
          ? -Math.abs(parsedCost)
          : Math.abs(parsedCost)
        : undefined;

    await db.budgetSnapshots.update(snapshot.id, {
      amount: signedAmount,
      transactionCost: signedCost,
      isFlexible,
      updatedAt: new Date(),
    });

    onSaved();
  };

  const formatDueDate = (d: Date) =>
    d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Edit Occurrence</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}>Cancel</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {snapshot && (
          <>
            <IonItem lines="none" style={{ marginBottom: "8px" }}>
              <IonLabel>
                <h2>{snapshot.description}</h2>
              </IonLabel>
            </IonItem>

            {budgetDueDate && (
              <IonItem lines="full">
                <IonLabel>Due Date</IonLabel>
                <IonNote slot="end">{formatDueDate(budgetDueDate)}</IonNote>
              </IonItem>
            )}

            <IonItem>
              <IonLabel position="stacked">Amount</IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={amount}
                onIonInput={(e) => setAmount(e.detail.value ?? "")}
                placeholder="0.00"
              />
            </IonItem>

            <IonItem>
              <IonLabel position="stacked">
                Transaction Cost (optional)
              </IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={transactionCost}
                onIonInput={(e) => setTransactionCost(e.detail.value ?? "")}
                placeholder="0.00"
              />
            </IonItem>

            <IonItem>
              <IonLabel>Flexible</IonLabel>
              <IonCheckbox
                slot="end"
                checked={isFlexible}
                onIonChange={(e) => setIsFlexible(e.detail.checked)}
              />
            </IonItem>

            {errorMsg && (
              <IonText color="danger">
                <p style={{ padding: "0 16px" }}>{errorMsg}</p>
              </IonText>
            )}

            <div style={{ padding: "16px" }}>
              <IonButton expand="block" onClick={handleSave}>
                Save Changes
              </IonButton>
            </div>

            <IonText color="medium">
              <p style={{ padding: "0 16px", fontSize: "0.8em" }}>
                These changes apply only to this occurrence and do not affect
                the budget template or any other occurrences.
              </p>
            </IonText>
          </>
        )}
      </IonContent>
    </IonModal>
  );
};

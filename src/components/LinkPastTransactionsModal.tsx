import React, { useState, useEffect } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonText,
  IonList,
  IonItem,
  IonCheckbox,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner,
} from "@ionic/react";
import { close, checkmarkCircle } from "ionicons/icons";
import { Transaction, Category, Recipient } from "../db";

interface LinkPastTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchingTransactions: Transaction[];
  onLinkTransactions: (
    transactionIds: number[],
    occurrenceDate: Date
  ) => Promise<void>; // NEW: Pass occurrence date
  categories: Category[];
  recipients: Recipient[];
  occurrenceDate: Date; // NEW: The occurrence being linked to
}

export const LinkPastTransactionsModal: React.FC<
  LinkPastTransactionsModalProps
> = ({
  isOpen,
  onClose,
  matchingTransactions,
  onLinkTransactions,
  categories,
  recipients,
  occurrenceDate,
}) => {
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<
    Set<number>
  >(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSelectedTransactionIds(new Set());
      setError("");
    }
  }, [isOpen]);

  const handleToggleTransaction = (txnId: number) => {
    const newSelected = new Set(selectedTransactionIds);
    if (newSelected.has(txnId)) {
      newSelected.delete(txnId);
    } else {
      newSelected.add(txnId);
    }
    setSelectedTransactionIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTransactionIds.size === matchingTransactions.length) {
      // Deselect all
      setSelectedTransactionIds(new Set());
    } else {
      // Select all
      const allIds = new Set(
        matchingTransactions.map((txn) => txn.id as number)
      );
      setSelectedTransactionIds(allIds);
    }
  };

  const handleLinkTransactions = async () => {
    if (selectedTransactionIds.size === 0) {
      setError("Please select at least one transaction to link");
      return;
    }

    setLoading(true);
    try {
      await onLinkTransactions(
        Array.from(selectedTransactionIds),
        occurrenceDate // NEW: Pass the occurrence date
      );
      onClose();
    } catch (err) {
      console.error("Error linking transactions:", err);
      setError("Failed to link transactions");
    } finally {
      setLoading(false);
    }
  };

  const getCategoryName = (categoryId: number) =>
    categories.find((c) => c.id === categoryId)?.name || "—";

  const getRecipientName = (recipientId: number) =>
    recipients.find((r) => r.id === recipientId)?.name || "—";

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Link Past Transactions</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {matchingTransactions.length === 0 ? (
          <IonText>
            <p>No unlinked transactions found matching this budget criteria.</p>
          </IonText>
        ) : (
          <>
            <IonText color="medium">
              <p style={{ fontSize: "0.9rem", marginBottom: "16px" }}>
                Found {matchingTransactions.length} unlinked transaction
                {matchingTransactions.length !== 1 ? "s" : ""} matching this
                budget. Select which ones to link:
              </p>
            </IonText>

            {error && (
              <IonText color="danger">
                <p style={{ marginBottom: "16px" }}>{error}</p>
              </IonText>
            )}

            {/* Select All Button */}
            <IonButton
              expand="block"
              fill="outline"
              size="small"
              onClick={handleSelectAll}
              style={{ marginBottom: "16px" }}
            >
              {selectedTransactionIds.size === matchingTransactions.length
                ? "Deselect All"
                : "Select All"}
            </IonButton>

            {/* Transactions List */}
            <IonList>
              {matchingTransactions.map((txn) => (
                <IonItem key={txn.id}>
                  <IonGrid style={{ width: "100%" }}>
                    <IonRow>
                      <IonCol size="1">
                        <IonCheckbox
                          checked={selectedTransactionIds.has(txn.id as number)}
                          onIonChange={() =>
                            handleToggleTransaction(txn.id as number)
                          }
                        />
                      </IonCol>
                      <IonCol size="6">
                        <div>
                          <div
                            style={{ fontWeight: "bold", fontSize: "0.95rem" }}
                          >
                            {txn.description || "—"}
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#666" }}>
                            {getRecipientName(txn.recipientId)}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "#999" }}>
                            {getCategoryName(txn.categoryId)} •{" "}
                            {new Date(txn.date).toLocaleDateString()}
                          </div>
                        </div>
                      </IonCol>
                      <IonCol size="5" style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontWeight: "bold",
                            fontSize: "1rem",
                            color:
                              txn.amount + (txn.transactionCost || 0) < 0
                                ? "#D44619"
                                : "#009688",
                          }}
                        >
                          {(
                            txn.amount + (txn.transactionCost || 0)
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </IonCol>
                    </IonRow>
                  </IonGrid>
                </IonItem>
              ))}
            </IonList>

            {/* Link Button */}
            <IonButton
              expand="block"
              onClick={handleLinkTransactions}
              disabled={selectedTransactionIds.size === 0 || loading}
              style={{ marginTop: "16px" }}
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <>
                  <IonIcon icon={checkmarkCircle} slot="start" />
                  Link {selectedTransactionIds.size} Transaction
                  {selectedTransactionIds.size !== 1 ? "s" : ""}
                </>
              )}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
};

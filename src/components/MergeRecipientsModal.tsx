import React, { useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonCard,
  IonCardContent,
  IonGrid,
  IonRow,
  IonCol,
  IonIcon,
  IonText,
  IonAlert,
  IonSpinner,
  IonCheckbox,
} from "@ionic/react";
import {
  close,
  checkmarkCircle,
  warningOutline,
  swapHorizontal,
} from "ionicons/icons";
import { Recipient } from "../db";
import { mergeRecipients, MergeResult } from "../utils/recipientMerge";

interface MergeRecipientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  duplicatePairs: Array<[Recipient, Recipient]>;
  recipientCounts: Map<number, number>;
  onMergeComplete: () => void;
}

interface SelectedPair {
  primary: Recipient;
  secondary: Recipient;
  transactionCount: number;
}

export const MergeRecipientsModal: React.FC<MergeRecipientsModalProps> = ({
  isOpen,
  onClose,
  duplicatePairs,
  recipientCounts,
  onMergeComplete,
}) => {
  const [selectedPairs, setSelectedPairs] = useState<SelectedPair[]>([]);
  const [showConfirmAlert, setShowConfirmAlert] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mergeResults, setMergeResults] = useState<MergeResult[]>([]);
  const [showResultsAlert, setShowResultsAlert] = useState(false);

  /**
   * togglePairSelection - Add/remove a pair from the merge list
   */
  const togglePairSelection = (pair: [Recipient, Recipient]) => {
    // Determine primary (most used)
    const countPrimary = recipientCounts.get(pair[0].id!) || 0;
    const countSecondary = recipientCounts.get(pair[1].id!) || 0;

    const primary = countPrimary >= countSecondary ? pair[0] : pair[1];
    const secondary = countPrimary >= countSecondary ? pair[1] : pair[0];
    const transactionCount = recipientCounts.get(secondary.id!) || 0;

    setSelectedPairs((current) => {
      const isSelected = current.some(
        (p) => p.primary.id === primary.id && p.secondary.id === secondary.id
      );

      if (isSelected) {
        return current.filter(
          (p) =>
            !(p.primary.id === primary.id && p.secondary.id === secondary.id)
        );
      } else {
        return [...current, { primary, secondary, transactionCount }];
      }
    });
  };

  /**
   * handleMerge - Execute the merge for all selected pairs
   */
  const handleMerge = async () => {
    setLoading(true);
    const results: MergeResult[] = [];

    try {
      for (const pair of selectedPairs) {
        const result = await mergeRecipients(
          pair.primary.id!,
          pair.secondary.id!
        );
        results.push(result);
      }

      setMergeResults(results);
      setShowConfirmAlert(false);
      setShowResultsAlert(true);
    } catch (err) {
      console.error("Error during merge:", err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleCloseResults - Close results alert and refresh data
   */
  const handleCloseResults = () => {
    setShowResultsAlert(false);
    setSelectedPairs([]);
    setMergeResults([]);
    onMergeComplete(); // Refresh parent data
    onClose();
  };

  const isPairSelected = (pair: [Recipient, Recipient]): boolean => {
    const countPrimary = recipientCounts.get(pair[0].id!) || 0;
    const countSecondary = recipientCounts.get(pair[1].id!) || 0;
    const primary = countPrimary >= countSecondary ? pair[0] : pair[1];
    const secondary = countPrimary >= countSecondary ? pair[1] : pair[0];

    return selectedPairs.some(
      (p) => p.primary.id === primary.id && p.secondary.id === secondary.id
    );
  };

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={onClose}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Merge Duplicate Recipients</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={onClose}>
                <IonIcon icon={close} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          {duplicatePairs.length === 0 ? (
            <p>No duplicate recipients found.</p>
          ) : (
            <>
              <IonText>
                <p style={{ fontSize: "0.9rem", color: "#666" }}>
                  Found {duplicatePairs.length} duplicate pair(s). Select the
                  ones you want to merge. The recipient with more transactions
                  will be kept as the primary.
                </p>
              </IonText>

              {duplicatePairs.map((pair, index) => {
                const countFirst = recipientCounts.get(pair[0].id!) || 0;
                const countSecond = recipientCounts.get(pair[1].id!) || 0;

                const primary = countFirst >= countSecond ? pair[0] : pair[1];
                const secondary = countFirst >= countSecond ? pair[1] : pair[0];
                const primaryCount =
                  countFirst >= countSecond ? countFirst : countSecond;
                const secondaryCount =
                  countFirst >= countSecond ? countSecond : countFirst;

                const isSelected = isPairSelected(pair);

                return (
                  <IonCard key={index}>
                    <IonCardContent>
                      <IonGrid>
                        <IonRow>
                          <IonCol size="1">
                            <IonCheckbox
                              checked={isSelected}
                              onIonChange={() => togglePairSelection(pair)}
                            />
                          </IonCol>
                          <IonCol>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "12px",
                              }}
                            >
                              {/* PRIMARY RECIPIENT */}
                              <div
                                style={{
                                  padding: "8px",
                                  backgroundColor: "#f0f9ff",
                                  borderRadius: "4px",
                                  border: "1px solid #cce5ff",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "4px",
                                  }}
                                >
                                  <IonIcon
                                    icon={checkmarkCircle}
                                    style={{
                                      color: "#2dd36f",
                                      fontSize: "1.2rem",
                                    }}
                                  />
                                  <strong>Primary (Keep)</strong>
                                </div>
                                <p
                                  style={{
                                    margin: "0 0 4px 0",
                                    fontSize: "0.95rem",
                                  }}
                                >
                                  {primary.name}
                                </p>
                                <p
                                  style={{
                                    margin: "0",
                                    fontSize: "0.85rem",
                                    color: "#666",
                                  }}
                                >
                                  {primaryCount} transaction
                                  {primaryCount !== 1 ? "s" : ""}
                                </p>
                              </div>

                              {/* SWAP ICON */}
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "center",
                                }}
                              >
                                <IonIcon
                                  icon={swapHorizontal}
                                  style={{
                                    color: "#999",
                                    fontSize: "1.5rem",
                                  }}
                                />
                              </div>

                              {/* SECONDARY RECIPIENT */}
                              <div
                                style={{
                                  padding: "8px",
                                  backgroundColor: "#fff5f5",
                                  borderRadius: "4px",
                                  border: "1px solid #ffcccc",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "4px",
                                  }}
                                >
                                  <IonIcon
                                    icon={warningOutline}
                                    style={{
                                      color: "#eb445c",
                                      fontSize: "1.2rem",
                                    }}
                                  />
                                  <strong>
                                    Secondary (Merge into Primary)
                                  </strong>
                                </div>
                                <p
                                  style={{
                                    margin: "0 0 4px 0",
                                    fontSize: "0.95rem",
                                  }}
                                >
                                  {secondary.name}
                                </p>
                                <p
                                  style={{
                                    margin: "0",
                                    fontSize: "0.85rem",
                                    color: "#666",
                                  }}
                                >
                                  {secondaryCount} transaction
                                  {secondaryCount !== 1 ? "s" : ""} will be
                                  updated
                                </p>
                              </div>
                            </div>
                          </IonCol>
                        </IonRow>
                      </IonGrid>
                    </IonCardContent>
                  </IonCard>
                );
              })}

              {selectedPairs.length > 0 && (
                <IonButton
                  expand="block"
                  color="primary"
                  onClick={() => setShowConfirmAlert(true)}
                  style={{ marginTop: "16px" }}
                >
                  Merge {selectedPairs.length} Pair
                  {selectedPairs.length !== 1 ? "s" : ""}
                </IonButton>
              )}
            </>
          )}
        </IonContent>
      </IonModal>

      {/* CONFIRMATION ALERT */}
      <IonAlert
        isOpen={showConfirmAlert}
        onDidDismiss={() => setShowConfirmAlert(false)}
        header="Confirm Merge"
        message={`Are you sure you want to merge ${
          selectedPairs.length
        } recipient pair(s)? This will update ${selectedPairs.reduce(
          (sum, p) => sum + p.transactionCount,
          0
        )} transaction(s). This action cannot be undone.`}
        buttons={[
          {
            text: "Cancel",
            role: "cancel",
          },
          {
            text: "Merge",
            role: "destructive",
            handler: handleMerge,
          },
        ]}
      />

      {/* LOADING SPINNER */}
      {loading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 9999,
          }}
        >
          <IonSpinner />
        </div>
      )}

      {/* RESULTS ALERT */}
      <IonAlert
        isOpen={showResultsAlert}
        onDidDismiss={handleCloseResults}
        header="Merge Complete"
        message={`Successfully merged ${
          mergeResults.filter((r) => r.success).length
        } recipient pair(s).\n\nUpdated ${mergeResults.reduce(
          (sum, r) => sum + r.transactionsUpdated,
          0
        )} transaction(s).`}
        buttons={[
          {
            text: "Done",
            handler: handleCloseResults,
          },
        ]}
      />
    </>
  );
};

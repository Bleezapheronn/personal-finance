import React, { useState, useRef } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonText,
  IonSpinner,
  IonList,
  IonItem,
  IonLabel,
} from "@ionic/react";
import { close, cloudUploadOutline } from "ionicons/icons";
import { importTransactionsFromCSV, ImportResult } from "../utils/csvImport";

interface ImportModalProps {
  isOpen: boolean;
  onDidDismiss: () => void;
  onImportComplete: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onDidDismiss,
  onImportComplete,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const text = await file.text();
      const importResult = await importTransactionsFromCSV(text);
      setResult(importResult);

      if (importResult.success > 0) {
        onImportComplete();
      }
    } catch (err) {
      console.error("Import error:", err);
      setResult({
        success: 0,
        failed: 1,
        errors: [
          {
            row: 0,
            reason: `Failed to read file: ${
              err instanceof Error ? err.message : "Unknown error"
            }`,
          },
        ],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    onDidDismiss();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Import Transactions</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {!result ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <IonText>
              <p>
                Select a CSV file exported from Personal Finance to import
                transactions.
              </p>
            </IonText>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />

            <IonButton
              expand="block"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <IonSpinner name="crescent" slot="start" />
                  Importing...
                </>
              ) : (
                <>
                  <IonIcon icon={cloudUploadOutline} slot="start" />
                  Choose CSV File
                </>
              )}
            </IonButton>
          </div>
        ) : (
          <div>
            <IonText>
              <h2>Import Complete</h2>
              <p style={{ fontSize: "1.1rem" }}>
                ✅ Successful: <strong>{result.success}</strong>
              </p>
              <p
                style={{
                  fontSize: "1.1rem",
                  color: result.failed > 0 ? "#D44619" : "#009688",
                }}
              >
                ❌ Failed: <strong>{result.failed}</strong>
              </p>
            </IonText>

            {result.errors.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <IonText>
                  <h3>Errors:</h3>
                </IonText>
                <IonList>
                  {result.errors.slice(0, 10).map((error, idx) => (
                    <IonItem key={idx}>
                      <IonLabel>
                        <p style={{ fontSize: "0.9rem" }}>
                          {error.row > 0 ? `Row ${error.row}: ` : ""}
                          {error.reason}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
                {result.errors.length > 10 && (
                  <IonText color="medium">
                    <p style={{ fontSize: "0.85rem" }}>
                      ... and {result.errors.length - 10} more errors
                    </p>
                  </IonText>
                )}
              </div>
            )}

            <IonButton
              expand="block"
              onClick={handleClose}
              style={{ marginTop: "16px" }}
            >
              Close
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

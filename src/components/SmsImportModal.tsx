import React, { useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonLabel,
  IonText,
  IonIcon,
  IonCheckbox,
} from "@ionic/react";
import { close } from "ionicons/icons";
import { SmsImportTemplate, Account } from "../db";
import { useSmsParser, ParsedSmsData } from "../hooks/useSmsParser";
import { SelectableDropdown } from "./SelectableDropdown";

interface SmsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (parsedData: ParsedSmsData) => void;
  smsTemplates: SmsImportTemplate[];
  accounts: Account[]; // CHANGED: from paymentMethods to accounts
  accountId?: number; // CHANGED: from paymentMethodId to accountId
}

export const SmsImportModal: React.FC<SmsImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  smsTemplates,
  accounts, // CHANGED
  accountId, // CHANGED
}) => {
  const [smsText, setSmsText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    string | undefined
  >(undefined);

  // Track which parsed fields are checked
  const [checkedFields, setCheckedFields] = useState<{
    [key: string]: boolean;
  }>({
    type: true,
    reference: true,
    amount: true,
    cost: true,
    recipientName: true,
    recipientPhone: true,
    date: true,
    time: true,
  });

  const {
    parsedPreview,
    parseError: smsParseError,
    previewParse,
    clearParsedData,
  } = useSmsParser(smsTemplates, accountId); // CHANGED: accountId

  const handleClose = () => {
    setSmsText("");
    setSelectedTemplateId(undefined);
    clearParsedData();
    setCheckedFields({
      type: true,
      reference: true,
      amount: true,
      cost: true,
      recipientName: true,
      recipientPhone: true,
      date: true,
      time: true,
    });
    onClose();
  };

  const handleCheckboxChange = (field: string, checked: boolean) => {
    setCheckedFields((prev) => ({
      ...prev,
      [field]: checked,
    }));
  };

  const handleImport = () => {
    if (parsedPreview) {
      // Create a filtered copy of parsedPreview with only checked fields
      const filteredData: ParsedSmsData = {
        ...parsedPreview,
      };

      // Remove unchecked fields
      if (!checkedFields.type) filteredData.isIncome = undefined;
      if (!checkedFields.reference) filteredData.reference = undefined;
      if (!checkedFields.amount) filteredData.amount = undefined;
      if (!checkedFields.cost) filteredData.cost = undefined;
      if (!checkedFields.recipientName) filteredData.recipientName = undefined;
      if (!checkedFields.recipientPhone)
        filteredData.recipientPhone = undefined;
      if (!checkedFields.date) filteredData.date = undefined;
      if (!checkedFields.time) filteredData.time = undefined;

      onImport(filteredData);
      handleClose();
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Import from SMS</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {smsParseError && (
          <IonText color="danger">
            <p>{smsParseError}</p>
          </IonText>
        )}
        <IonGrid>
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Select Template (optional)</label>
                <SelectableDropdown
                  label="Select Template"
                  placeholder="Auto-detect from all templates"
                  value={selectedTemplateId}
                  options={[
                    {
                      value: "",
                      label: "Auto-detect from all templates",
                    },
                    ...smsTemplates.map((template) => {
                      // CHANGED: Get account name directly from accountId
                      const accountName = template.accountId
                        ? accounts.find((a) => a.id === template.accountId)
                            ?.name
                        : null;
                      return {
                        value: template.id!.toString(),
                        label: accountName
                          ? `${template.name} (${accountName})`
                          : template.name,
                      };
                    }),
                  ]}
                  onValueChange={(value) => {
                    setSelectedTemplateId(value === "" ? undefined : value);
                    clearParsedData();
                  }}
                />
              </div>
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <IonLabel position="stacked">Paste SMS Message</IonLabel>
              <textarea
                rows={5}
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: "8px",
                  borderRadius: "4px",
                  border: "1px solid var(--ion-color-medium)",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                }}
                placeholder="Paste your transaction SMS here..."
                value={smsText}
                onChange={(e) => {
                  setSmsText(e.target.value);
                  clearParsedData();
                }}
              />
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <IonButton
                expand="block"
                fill="outline"
                onClick={() =>
                  previewParse(
                    smsText,
                    selectedTemplateId ? Number(selectedTemplateId) : undefined
                  )
                }
                disabled={!smsText.trim()}
              >
                Preview Parse
              </IonButton>
            </IonCol>
          </IonRow>

          {/* Preview Section with Checkboxes */}
          {parsedPreview && (
            <IonRow>
              <IonCol>
                <div
                  style={{
                    backgroundColor: "var(--ion-color-light)",
                    padding: "12px",
                    borderRadius: "8px",
                    marginTop: "8px",
                  }}
                >
                  <h3
                    style={{
                      marginTop: 0,
                      fontSize: "1rem",
                      fontWeight: "bold",
                    }}
                  >
                    Parsed Information
                  </h3>
                  <div style={{ fontSize: "0.9rem" }}>
                    {parsedPreview.isIncome !== undefined && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.type}
                          onIonChange={(e) =>
                            handleCheckboxChange("type", e.detail.checked)
                          }
                          aria-label="Include transaction type"
                        />
                        <span>
                          <strong>Type:</strong>{" "}
                          <IonText
                            color={
                              parsedPreview.isIncome ? "success" : "danger"
                            }
                          >
                            {parsedPreview.isIncome ? "Income" : "Expense"}
                          </IonText>
                        </span>
                      </div>
                    )}
                    {parsedPreview.reference && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.reference}
                          onIonChange={(e) =>
                            handleCheckboxChange("reference", e.detail.checked)
                          }
                          aria-label="Include reference"
                        />
                        <span>
                          <strong>Reference:</strong> {parsedPreview.reference}
                        </span>
                      </div>
                    )}
                    {parsedPreview.amount && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.amount}
                          onIonChange={(e) =>
                            handleCheckboxChange("amount", e.detail.checked)
                          }
                          aria-label="Include amount"
                        />
                        <span>
                          <strong>Amount:</strong> {parsedPreview.amount}
                        </span>
                      </div>
                    )}
                    {parsedPreview.cost && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.cost}
                          onIonChange={(e) =>
                            handleCheckboxChange("cost", e.detail.checked)
                          }
                          aria-label="Include transaction cost"
                        />
                        <span>
                          <strong>Transaction Cost:</strong>{" "}
                          {parsedPreview.cost}
                        </span>
                      </div>
                    )}
                    {parsedPreview.recipientName && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.recipientName}
                          onIonChange={(e) =>
                            handleCheckboxChange(
                              "recipientName",
                              e.detail.checked
                            )
                          }
                          aria-label="Include recipient name"
                        />
                        <span>
                          <strong>
                            {parsedPreview.isIncome ? "Sender" : "Recipient"}:
                          </strong>{" "}
                          {parsedPreview.recipientName}
                          {parsedPreview.recipientPhone && (
                            <> ({parsedPreview.recipientPhone})</>
                          )}
                        </span>
                      </div>
                    )}
                    {parsedPreview.date && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.date}
                          onIonChange={(e) =>
                            handleCheckboxChange("date", e.detail.checked)
                          }
                          aria-label="Include date and time"
                        />
                        <span>
                          <strong>Date/Time:</strong> {parsedPreview.date}
                          {parsedPreview.time && <> at {parsedPreview.time}</>}
                        </span>
                      </div>
                    )}
                    {parsedPreview.time && !parsedPreview.date && (
                      <div
                        style={{
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <IonCheckbox
                          checked={checkedFields.time}
                          onIonChange={(e) =>
                            handleCheckboxChange("time", e.detail.checked)
                          }
                          aria-label="Include time"
                        />
                        <span>
                          <strong>Time:</strong> {parsedPreview.time}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </IonCol>
            </IonRow>
          )}

          <IonRow>
            <IonCol>
              <IonButton
                expand="block"
                onClick={handleImport}
                disabled={!parsedPreview}
                color="primary"
              >
                Parse & Import
              </IonButton>
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <IonText color="medium">
                <p style={{ fontSize: "0.85rem" }}>
                  <strong>How to use:</strong>
                </p>
                <ol style={{ fontSize: "0.85rem", paddingLeft: "20px" }}>
                  <li>Paste your SMS message above</li>
                  <li>
                    Optionally select a specific template or let the system
                    auto-detect
                  </li>
                  <li>Click "Preview Parse" to see what will be extracted</li>
                  <li>Check/uncheck items you want to import</li>
                  <li>Click "Parse & Import" to add the transaction</li>
                </ol>
                <p style={{ fontSize: "0.85rem" }}>
                  If parsing fails, you may need to add or update SMS import
                  templates in the management page.
                </p>
              </IonText>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

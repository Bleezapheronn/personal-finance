import React, { useState, useEffect } from "react";
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
  IonIcon,
  IonText,
  IonToast,
} from "@ionic/react";
import { close } from "ionicons/icons";
import { db, Recipient } from "../db";

interface AddRecipientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecipientAdded: (recipient: Recipient) => void;
  editingRecipient?: Recipient | null;
  onDuplicateFound?: (duplicate: Recipient) => void;
  checkForDuplicate?: (
    name: string,
    phone?: string,
    paybill?: string,
    accountNumber?: string,
    excludeId?: number
  ) => Promise<Recipient | null>;
}

export const AddRecipientModal: React.FC<AddRecipientModalProps> = ({
  isOpen,
  onClose,
  onRecipientAdded,
  editingRecipient,
  onDuplicateFound,
  checkForDuplicate,
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [till, setTill] = useState("");
  const [paybill, setPaybill] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [description, setDescription] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setTill("");
    setPaybill("");
    setAccountNumber("");
    setDescription("");
    setErrorMsg("");
  };

  useEffect(() => {
    if (isOpen) {
      if (editingRecipient) {
        // EDIT MODE: Load existing recipient data
        setName(editingRecipient.name);
        setEmail(editingRecipient.email || "");
        setPhone(editingRecipient.phone || "");
        setTill(editingRecipient.tillNumber || "");
        setPaybill(editingRecipient.paybill || "");
        setAccountNumber(editingRecipient.accountNumber || "");
        setDescription(editingRecipient.description || "");
        setErrorMsg("");
      } else {
        // ADD MODE: Check for SMS recipient data
        const smsData = sessionStorage.getItem("smsRecipientData");
        if (smsData) {
          try {
            const parsed = JSON.parse(smsData);
            setName(parsed.name || "");
            setPhone(parsed.phone || "");
            sessionStorage.removeItem("smsRecipientData"); // Clear after using
          } catch (err) {
            console.error("Failed to parse SMS recipient data:", err);
            resetForm();
          }
        } else {
          resetForm();
        }
      }
    }
  }, [isOpen, editingRecipient]);

  const handleSave = async () => {
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg("Recipient name is required");
      return;
    }

    if (accountNumber.trim() && !paybill.trim()) {
      setErrorMsg("Enter a Paybill number before providing an Account Number");
      return;
    }

    try {
      setLoading(true);

      // Check for duplicates only when adding new recipient
      if (!editingRecipient?.id && checkForDuplicate) {
        const duplicate = await checkForDuplicate(
          name.trim(),
          phone.trim(),
          paybill.trim(),
          accountNumber.trim()
        );

        if (duplicate) {
          onDuplicateFound?.(duplicate);
          onClose();
          return;
        }
      }

      const now = new Date();

      if (editingRecipient?.id) {
        // UPDATE MODE
        await db.recipients.update(editingRecipient.id, {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          tillNumber: till.trim() || undefined,
          paybill: paybill.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          description: description.trim() || undefined,
          updatedAt: now,
        });
        const updated = await db.recipients.get(editingRecipient.id);
        if (updated) {
          onRecipientAdded(updated);
          setToastMessage("Recipient updated successfully!");
        }
      } else {
        // ADD MODE
        const newRecipient: Omit<Recipient, "id"> = {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          tillNumber: till.trim() || undefined,
          paybill: paybill.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          description: description.trim() || undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        const id = await db.recipients.add(newRecipient);
        const saved = await db.recipients.get(id);

        if (saved) {
          onRecipientAdded(saved);
          setToastMessage("Recipient added successfully!");
        }
      }

      setShowToast(true);
      resetForm();
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to save recipient");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={handleClose}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>
              {editingRecipient ? "Edit Recipient" : "Add Recipient"}
            </IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={handleClose}>
                <IonIcon icon={close} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {errorMsg && (
            <IonText
              color="danger"
              style={{ display: "block", marginBottom: "16px" }}
            >
              {errorMsg}
            </IonText>
          )}

          <IonGrid>
            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Recipient Name</label>
                  <input
                    type="text"
                    placeholder="e.g., John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Description (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., My business partner"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Phone (optional)</label>
                  <input
                    type="tel"
                    placeholder="e.g., 0712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Email (optional)</label>
                  <input
                    type="email"
                    placeholder="e.g., john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Till Number (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., 123456"
                    value={till}
                    onChange={(e) => setTill(e.target.value)}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Paybill (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., 400200"
                    value={paybill}
                    onChange={(e) => {
                      setPaybill(e.target.value);
                      if (!e.target.value.trim()) {
                        setAccountNumber("");
                      }
                    }}
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  />
                </div>
              </IonCol>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">
                    Account Number (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 1234567890"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    disabled={loading || !paybill.trim()}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                      opacity: loading || !paybill.trim() ? 0.5 : 1,
                    }}
                  />
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <IonButton
                  expand="block"
                  onClick={handleSave}
                  disabled={loading}
                >
                  {editingRecipient ? "Update Recipient" : "Add Recipient"}
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonContent>
      </IonModal>

      <IonToast
        isOpen={showToast}
        onDidDismiss={() => setShowToast(false)}
        message={toastMessage}
        duration={2000}
        position="top"
        color="success"
      />
    </>
  );
};

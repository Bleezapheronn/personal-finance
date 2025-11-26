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
  IonInput,
  IonAlert,
  IonIcon,
} from "@ionic/react";
import { close } from "ionicons/icons";
import { db, Recipient } from "../db";

interface AddRecipientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecipientAdded: (recipient: Recipient) => void;
  initialName?: string;
  initialPhone?: string;
}

export const AddRecipientModal: React.FC<AddRecipientModalProps> = ({
  isOpen,
  onClose,
  onRecipientAdded,
  initialName = "",
  initialPhone = "",
}) => {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [till, setTill] = useState("");
  const [paybill, setPaybill] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  // Update initial values when props change
  useEffect(() => {
    setName(initialName);
    setPhone(initialPhone);
  }, [initialName, initialPhone]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setTill("");
    setPaybill("");
    setAccountNumber("");
    setAlertMessage("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setAlertMessage("Recipient name is required");
      return;
    }
    if (accountNumber.trim() && !paybill.trim()) {
      setAlertMessage(
        "Enter a Paybill number before providing an Account Number"
      );
      return;
    }

    try {
      const now = new Date();
      const newRec: Omit<Recipient, "id"> = {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        tillNumber: till.trim() || undefined,
        paybill: paybill.trim() || undefined,
        accountNumber: accountNumber.trim() || undefined,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const id = await db.recipients.add(newRec);
      const saved = await db.recipients.get(id);

      if (saved) {
        onRecipientAdded(saved);
        resetForm();
        onClose();
      }
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to add recipient");
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Recipient</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {alertMessage && (
          <IonAlert
            isOpen={!!alertMessage}
            onDidDismiss={() => setAlertMessage("")}
            header="Alert"
            message={alertMessage}
            buttons={["OK"]}
          />
        )}
        <IonGrid>
          <IonRow>
            <IonCol>
              <IonInput
                label="Recipient Name"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., John Doe"
                value={name}
                onIonChange={(e) => setName(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonInput
                label="Phone (optional)"
                labelPlacement="stacked"
                fill="outline"
                type="tel"
                placeholder="e.g., 0712345678"
                value={phone}
                onIonChange={(e) => setPhone(e.detail.value ?? "")}
              />
            </IonCol>
            <IonCol>
              <IonInput
                label="Email (optional)"
                labelPlacement="stacked"
                fill="outline"
                type="email"
                placeholder="e.g., john@example.com"
                value={email}
                onIonChange={(e) => setEmail(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonInput
                label="Till Number (optional)"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., 123456"
                value={till}
                onIonChange={(e) => setTill(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonInput
                label="Paybill (optional)"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., 400200"
                value={paybill}
                onIonChange={(e) => setPaybill(e.detail.value ?? "")}
              />
            </IonCol>
            <IonCol>
              <IonInput
                label="Account Number (optional)"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., 1234567890"
                value={accountNumber}
                onIonChange={(e) => setAccountNumber(e.detail.value ?? "")}
                disabled={!paybill.trim()}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonButton expand="block" onClick={handleSave}>
                Add Recipient
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

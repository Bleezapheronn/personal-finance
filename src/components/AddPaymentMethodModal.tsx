import React, { useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonAlert,
} from "@ionic/react";
import { db, PaymentMethod, Account } from "../db";

interface AddPaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentMethodAdded: (paymentMethod: PaymentMethod) => void;
  accounts: Account[];
}

export const AddPaymentMethodModal: React.FC<AddPaymentMethodModalProps> = ({
  isOpen,
  onClose,
  onPaymentMethodAdded,
  accounts,
}) => {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState("");

  const resetForm = () => {
    setName("");
    setAccountId(undefined);
    setAlertMessage("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setAlertMessage("Payment method name is required");
      return;
    }
    if (!accountId) {
      setAlertMessage("Please select an account");
      return;
    }

    try {
      const now = new Date();
      const newPaymentMethod: Omit<PaymentMethod, "id"> = {
        accountId: accountId,
        name: name.trim(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const id = await db.paymentMethods.add(newPaymentMethod);
      const saved = await db.paymentMethods.get(id);

      if (saved) {
        onPaymentMethodAdded(saved);
        resetForm();
        onClose();
      }
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to add payment method");
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
          <IonTitle>Add Payment Method</IonTitle>
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
              <IonSelect
                label="Account"
                placeholder="Select account"
                interface="popover"
                value={accountId}
                onIonChange={(e) =>
                  setAccountId(e.detail.value as number | undefined)
                }
                labelPlacement="stacked"
                fill="outline"
              >
                {accounts.map((a) => (
                  <IonSelectOption key={a.id} value={a.id}>
                    {a.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonInput
                label="Payment Method Name"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., Visa, Mastercard"
                value={name}
                onIonChange={(e) => setName(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonButton expand="block" onClick={handleSave}>
                Add Payment Method
              </IonButton>
            </IonCol>
            <IonCol>
              <IonButton expand="block" color="medium" onClick={handleClose}>
                Cancel
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

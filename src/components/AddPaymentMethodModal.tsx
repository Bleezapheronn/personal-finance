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
import { db, PaymentMethod, Account } from "../db";

interface AddPaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentMethodAdded: (paymentMethod: PaymentMethod) => void;
  accounts: Account[];
  editingPaymentMethod?: PaymentMethod | null;
  preSelectedAccountId?: number;
}

export const AddPaymentMethodModal: React.FC<AddPaymentMethodModalProps> = ({
  isOpen,
  onClose,
  onPaymentMethodAdded,
  accounts,
  editingPaymentMethod,
  preSelectedAccountId,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const resetForm = () => {
    setName("");
    setDescription("");
    setAccountId(preSelectedAccountId || undefined);
    setErrorMsg("");
  };

  useEffect(() => {
    if (isOpen && editingPaymentMethod) {
      setName(editingPaymentMethod.name);
      setDescription(editingPaymentMethod.description || "");
      setAccountId(editingPaymentMethod.accountId);
      setErrorMsg("");
    } else if (isOpen && preSelectedAccountId) {
      setName("");
      setDescription("");
      setAccountId(preSelectedAccountId);
      setErrorMsg("");
    } else if (isOpen) {
      setName("");
      setDescription("");
      setAccountId(undefined);
      setErrorMsg("");
    }
  }, [isOpen, editingPaymentMethod, preSelectedAccountId]);

  /**
   * checkDuplicatePaymentMethod - Checks if a payment method with the same name already exists for the account
   */
  const checkDuplicatePaymentMethod = async (
    accountIdToCheck: number,
    nameToCheck: string,
    excludeId?: number
  ): Promise<boolean> => {
    try {
      const existing = await db.paymentMethods
        .where("accountId")
        .equals(accountIdToCheck)
        .toArray();

      return existing.some(
        (pm) =>
          pm.name.toLowerCase() === nameToCheck.toLowerCase() &&
          pm.id !== excludeId
      );
    } catch (error) {
      console.error("Error checking for duplicate:", error);
      return false;
    }
  };

  const handleSave = async () => {
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg("Payment method name is required");
      return;
    }

    if (!accountId) {
      setErrorMsg("Please select an account");
      return;
    }

    try {
      setLoading(true);

      // Check for duplicates
      const isDuplicate = await checkDuplicatePaymentMethod(
        accountId,
        name,
        editingPaymentMethod?.id
      );

      if (isDuplicate) {
        setErrorMsg(
          `A payment method named "${name.trim()}" already exists for this account`
        );
        return;
      }

      const now = new Date();

      if (editingPaymentMethod?.id) {
        // UPDATE MODE
        await db.paymentMethods.update(editingPaymentMethod.id, {
          accountId: accountId,
          name: name.trim(),
          description: description.trim() || undefined,
          updatedAt: now,
        });
        const updated = await db.paymentMethods.get(editingPaymentMethod.id);
        if (updated) {
          onPaymentMethodAdded(updated);
          setToastMessage("Payment method updated successfully!");
        }
      } else {
        // ADD MODE
        const newPaymentMethod: Omit<PaymentMethod, "id"> = {
          accountId: accountId,
          name: name.trim(),
          description: description.trim() || undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        const id = await db.paymentMethods.add(newPaymentMethod);
        const saved = await db.paymentMethods.get(id);

        if (saved) {
          onPaymentMethodAdded(saved);
          setToastMessage("Payment method added successfully!");
        }
      }

      setShowToast(true);
      resetForm();
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to save payment method");
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
              {editingPaymentMethod
                ? "Edit Payment Method"
                : "Add Payment Method"}
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
                  <label className="form-label">Account</label>
                  <select
                    value={accountId ?? ""}
                    onChange={(e) =>
                      setAccountId(parseInt(e.target.value) || undefined)
                    }
                    disabled={loading}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--ion-color-medium)",
                      borderRadius: "4px",
                      backgroundColor: "var(--ion-background-color)",
                      color: "inherit",
                      fontSize: "0.95rem",
                    }}
                  >
                    {accounts
                      .filter((a) => a.isActive !== false) // Hide deactivated accounts
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.currency || "—"})
                        </option>
                      ))}
                  </select>
                </div>
              </IonCol>
            </IonRow>

            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Payment Method Name</label>
                  <input
                    type="text"
                    placeholder="e.g., Visa, Mastercard"
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
                    placeholder="e.g., My business account"
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
                <IonButton
                  expand="block"
                  onClick={handleSave}
                  disabled={loading}
                >
                  {editingPaymentMethod ? "Update" : "Add"} Payment Method
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

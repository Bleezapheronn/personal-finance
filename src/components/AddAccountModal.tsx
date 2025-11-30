import React, { useState, useEffect, useCallback, useRef } from "react";
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
} from "@ionic/react";
import { close, trash } from "ionicons/icons";
import { db, Account } from "../db";

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountAdded: (account: Account) => void;
  editingAccount?: Account | null;
}

const CURRENCY_OPTIONS = ["KES", "USD", "EUR", "GBP"];

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  onAccountAdded,
  editingAccount,
}) => {
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageRemovalIntent, setImageRemovalIntent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const previewUrlRef = useRef<string | null>(null);

  const resetForm = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setAccountName("");
    setCurrency("KES");
    setImageFile(null);
    setPreviewUrl(null);
    setImageRemovalIntent(false);
    setErrorMsg("");
  }, []);

  useEffect(() => {
    if (isOpen && editingAccount) {
      setAccountName(editingAccount.name);
      setCurrency(editingAccount.currency || "KES");
      if (editingAccount.imageBlob) {
        const url = URL.createObjectURL(editingAccount.imageBlob);
        setPreviewUrl(url);
        previewUrlRef.current = url;
      } else {
        setPreviewUrl(null);
        previewUrlRef.current = null;
      }
      setImageFile(null);
      setImageRemovalIntent(false);
      setErrorMsg("");
    } else if (isOpen) {
      resetForm();
    }
  }, [isOpen, editingAccount, resetForm]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Revoke old preview URL BEFORE creating new one
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    setImageFile(file);
    setImageRemovalIntent(false);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      previewUrlRef.current = url;
    } else {
      setPreviewUrl(null);
      previewUrlRef.current = null;
    }
  };

  const handleRemoveImage = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setImageFile(null);
    setImageRemovalIntent(true);
  };

  const handleSave = async () => {
    setErrorMsg("");

    if (!accountName.trim()) {
      setErrorMsg("Account name is required");
      return;
    }

    if (!currency || !currency.trim()) {
      setErrorMsg("Currency is required");
      return;
    }

    try {
      setLoading(true);
      const now = new Date();

      if (editingAccount?.id) {
        // UPDATE MODE
        const updateData: Partial<Account> = {
          name: accountName.trim(),
          currency: currency || "KES",
          updatedAt: now,
        };

        // Handle image updates
        if (imageFile) {
          // New file selected
          updateData.imageBlob = imageFile;
        } else if (imageRemovalIntent) {
          // User explicitly removed the image
          updateData.imageBlob = undefined;
        }
        // Otherwise don't touch imageBlob (keep existing)

        await db.accounts.update(editingAccount.id, updateData);
        const updated = await db.accounts.get(editingAccount.id);
        if (updated) {
          onAccountAdded(updated);
        }
      } else {
        // ADD MODE
        const newAccount: Omit<Account, "id"> = {
          name: accountName.trim(),
          currency: currency || "KES",
          imageBlob: imageFile ?? undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        const id = await db.accounts.add(newAccount);
        const saved = await db.accounts.get(id);
        if (saved) {
          onAccountAdded(saved);
        }
      }

      resetForm();
      onClose();
    } catch (error) {
      console.error("Error saving account:", error);
      setErrorMsg("Failed to save account");
    } finally {
      setLoading(false);
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
          <IonTitle>{editingAccount ? "Edit Account" : "Add Account"}</IonTitle>
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
          {/* Account Name */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Account Name</label>
                <input
                  type="text"
                  placeholder="e.g., M-Pesa, PayPal"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
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

          {/* Currency */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
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
                  {CURRENCY_OPTIONS.map((curr) => (
                    <option key={curr} value={curr}>
                      {curr}
                    </option>
                  ))}
                </select>
              </div>
            </IonCol>
          </IonRow>

          {/* Image Upload */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Account Image (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  disabled={loading}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--ion-color-medium)",
                    borderRadius: "4px",
                    backgroundColor: "var(--ion-background-color)",
                  }}
                />
              </div>
            </IonCol>
          </IonRow>

          {/* Image Preview with Remove Button */}
          {previewUrl && (
            <IonRow>
              <IonCol>
                <div
                  style={{
                    position: "relative",
                    width: 80,
                    height: 80,
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="preview"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "1px solid var(--ion-color-medium)",
                    }}
                  />
                  <button
                    onClick={handleRemoveImage}
                    disabled={loading}
                    style={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      backgroundColor: "var(--ion-color-danger)",
                      border: "2px solid var(--ion-background-color)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      color: "white",
                    }}
                  >
                    <IonIcon icon={trash} style={{ fontSize: "16px" }} />
                  </button>
                </div>
              </IonCol>
            </IonRow>
          )}

          {/* Buttons */}
          <IonRow>
            <IonCol>
              <IonButton expand="block" onClick={handleSave} disabled={loading}>
                {editingAccount ? "Update Account" : "Add Account"}
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

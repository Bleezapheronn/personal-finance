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
import { SelectableDropdown } from "./SelectableDropdown";

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
  const [isCredit, setIsCredit] = useState(false);
  const [creditLimit, setCreditLimit] = useState<string>("");
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
    setIsCredit(false);
    setCreditLimit("");
    setImageFile(null);
    setPreviewUrl(null);
    setImageRemovalIntent(false);
    setErrorMsg("");
  }, []);

  useEffect(() => {
    if (isOpen && editingAccount) {
      setAccountName(editingAccount.name);
      setCurrency(editingAccount.currency || "KES");
      setIsCredit(editingAccount.isCredit || false);
      setCreditLimit(editingAccount.creditLimit?.toString() || "");
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

    if (isCredit && creditLimit) {
      const limit = parseFloat(creditLimit);
      if (isNaN(limit) || limit < 0) {
        setErrorMsg("Credit limit must be a positive number");
        return;
      }
    }

    try {
      setLoading(true);
      const now = new Date();

      if (editingAccount?.id) {
        // UPDATE MODE
        const updateData: Partial<Account> = {
          name: accountName.trim(),
          currency: currency || "KES",
          isCredit: isCredit,
          creditLimit: isCredit ? parseFloat(creditLimit) : undefined,
          updatedAt: now,
        };

        if (imageFile) {
          updateData.imageBlob = imageFile;
        } else if (imageRemovalIntent) {
          updateData.imageBlob = undefined;
        }

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
          isCredit: isCredit,
          creditLimit: isCredit ? parseFloat(creditLimit) : undefined,
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
                  placeholder="e.g., M-Pesa, PayPal, Fuliza"
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

          {/* Currency - UPDATED: Using SelectableDropdown */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Currency</label>
                <SelectableDropdown
                  label="Currency"
                  placeholder="Select currency"
                  value={currency}
                  options={CURRENCY_OPTIONS.map((curr) => ({
                    value: curr,
                    label: curr,
                  }))}
                  onValueChange={(selectedCurrency) => {
                    setCurrency(selectedCurrency);
                  }}
                />
              </div>
            </IonCol>
          </IonRow>

          {/* Is Credit Account Checkbox */}
          <IonRow>
            <IonCol>
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  type="checkbox"
                  id="isCredit"
                  checked={isCredit}
                  onChange={(e) => setIsCredit(e.target.checked)}
                  disabled={loading}
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                />
                <label
                  htmlFor="isCredit"
                  style={{ cursor: "pointer", marginBottom: 0 }}
                >
                  Credit/Overdraft Account (e.g., Fuliza)
                </label>
              </div>
            </IonCol>
          </IonRow>

          {/* Credit Limit Input (only show if isCredit is checked) */}
          {isCredit && (
            <IonRow>
              <IonCol>
                <div className="form-input-wrapper">
                  <label className="form-label">Credit Limit (optional)</label>
                  <input
                    type="number"
                    placeholder="e.g., 50000"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    disabled={loading}
                    inputMode="decimal"
                    step="0.01"
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
          )}

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

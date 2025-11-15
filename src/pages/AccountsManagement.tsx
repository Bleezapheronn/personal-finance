/**
 * AccountsManagement Component
 *
 * This page allows users to:
 * - View all bank accounts/payment methods
 * - Add new accounts with name, currency, and optional image
 * - Edit existing account details
 * - Delete accounts with confirmation
 * - Add/edit/delete payment methods for each account
 *
 * State Management:
 * - accounts: Array of all accounts from the database
 * - paymentMethods: Array of all payment methods (filtered by account in render)
 * - accountName, currency: Form input values for accounts
 * - editingAccountId: Tracks which account is being edited (null if adding new)
 * - paymentMethodName: Form input for new payment method
 * - editingPaymentMethodId: Tracks which payment method is being edited
 * - selectedAccountForPaymentMethod: Account ID for which we're adding/editing payment method
 * - loading: Shows spinner while database operations are in progress
 * - showAlert: Controls visibility of success/error messages
 * - deleteAccountId: Tracks which account user wants to delete
 * - deletePaymentMethodId: Tracks which payment method user wants to delete
 */

import React, { useEffect, useState, useRef } from "react";
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonMenuButton,
  IonList,
  IonItem,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonAlert,
  IonSpinner,
  IonGrid,
  IonRow,
  IonCol,
  IonIcon,
  IonAccordion,
  IonAccordionGroup,
} from "@ionic/react";
import { db } from "../db";
import { createOutline, trashOutline } from "ionicons/icons";

import type { Account, PaymentMethod } from "../db";

// List of supported currencies for the dropdown menu
const CURRENCY_OPTIONS = ["KES", "USD", "EUR", "GBP"];

type LocalAccount = Account & { previewUrl?: string };
type NewAccount = Omit<Account, "id">;
type NewPaymentMethod = Omit<PaymentMethod, "id">;

const AccountsManagement: React.FC = () => {
  // Account state
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);

  // Payment Method state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodName, setPaymentMethodName] = useState("");
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState<
    number | null
  >(null);
  const [selectedAccountForPaymentMethod, setSelectedAccountForPaymentMethod] =
    useState<number | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);
  const [deletePaymentMethodId, setDeletePaymentMethodId] = useState<
    number | null
  >(null);

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    fetchAccounts();
    fetchPaymentMethods();
  }, []);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      previewUrlsRef.current = [];
    };
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  /**
   * fetchAccounts - Retrieves all accounts from the database
   */
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      previewUrlsRef.current = [];

      const fetched: Account[] = await db.accounts.toArray();
      const withPreview: LocalAccount[] = fetched.map((a) => {
        const preview = a.imageBlob
          ? URL.createObjectURL(a.imageBlob)
          : undefined;
        if (preview) previewUrlsRef.current.push(preview);
        return { ...a, previewUrl: preview };
      });
      setAccounts(withPreview);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      setAlertMessage("Failed to fetch accounts");
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * fetchPaymentMethods - Retrieves all payment methods from the database
   */
  const fetchPaymentMethods = async () => {
    try {
      const fetched: PaymentMethod[] = await db.paymentMethods.toArray();
      setPaymentMethods(fetched);
    } catch (error) {
      console.error("Error fetching payment methods:", error);
      setAlertMessage("Failed to fetch payment methods");
      setShowAlert(true);
    }
  };

  /**
   * handleAddOrUpdateAccount - Creates or updates an account
   */
  const handleAddOrUpdateAccount = async () => {
    if (!accountName.trim()) {
      setAlertMessage("Account name is required");
      setShowAlert(true);
      return;
    }

    try {
      setLoading(true);
      const now = new Date();

      if (editingAccountId) {
        await db.accounts.update(editingAccountId, {
          name: accountName.trim(),
          currency: currency || "KES",
          imageBlob: imageFile ?? undefined,
          updatedAt: now,
        });
        setAlertMessage("Account updated successfully");
      } else {
        const newAccount: NewAccount = {
          name: accountName.trim(),
          currency: currency || "KES",
          imageBlob: imageFile ?? undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        await db.accounts.add(newAccount);
        setAlertMessage("Account added successfully");
      }

      resetAccountForm();
      await fetchAccounts();
      setShowAlert(true);
    } catch (error) {
      console.error("Error saving account:", error);
      setAlertMessage("Failed to save account");
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleEditAccount - Prepares form for editing an existing account
   */
  const handleEditAccount = (account: Account) => {
    setAccountName(account.name);
    setCurrency(account.currency || "KES");
    setEditingAccountId(account.id ?? null);
  };

  /**
   * handleDeleteAccount - Removes an account from the database
   */
  const handleDeleteAccount = async (accountId: number) => {
    try {
      setLoading(true);
      await db.accounts.delete(accountId);
      setAlertMessage("Account deleted successfully");
      setDeleteAccountId(null);
      await fetchAccounts();
      await fetchPaymentMethods();
      setShowAlert(true);
    } catch (error) {
      console.error("Error deleting account:", error);
      setAlertMessage("Failed to delete account");
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleAddOrUpdatePaymentMethod - Creates or updates a payment method
   */
  const handleAddOrUpdatePaymentMethod = async () => {
    if (!paymentMethodName.trim()) {
      setAlertMessage("Payment method name is required");
      setShowAlert(true);
      return;
    }

    if (!selectedAccountForPaymentMethod) {
      setAlertMessage("Please select an account");
      setShowAlert(true);
      return;
    }

    try {
      setLoading(true);
      const now = new Date();

      if (editingPaymentMethodId) {
        await db.paymentMethods.update(editingPaymentMethodId, {
          name: paymentMethodName.trim(),
          updatedAt: now,
        });
        setAlertMessage("Payment method updated successfully");
      } else {
        const newPaymentMethod: NewPaymentMethod = {
          accountId: selectedAccountForPaymentMethod,
          name: paymentMethodName.trim(),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        await db.paymentMethods.add(newPaymentMethod);
        setAlertMessage("Payment method added successfully");
      }

      resetPaymentMethodForm();
      await fetchPaymentMethods();
      setShowAlert(true);
    } catch (error) {
      console.error("Error saving payment method:", error);
      setAlertMessage("Failed to save payment method");
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleEditPaymentMethod - Prepares form for editing a payment method
   */
  const handleEditPaymentMethod = (paymentMethod: PaymentMethod) => {
    setPaymentMethodName(paymentMethod.name);
    setSelectedAccountForPaymentMethod(paymentMethod.accountId);
    setEditingPaymentMethodId(paymentMethod.id ?? null);
  };

  /**
   * handleDeletePaymentMethod - Removes a payment method from the database
   */
  const handleDeletePaymentMethod = async (paymentMethodId: number) => {
    try {
      setLoading(true);
      await db.paymentMethods.delete(paymentMethodId);
      setAlertMessage("Payment method deleted successfully");
      setDeletePaymentMethodId(null);
      await fetchPaymentMethods();
      setShowAlert(true);
    } catch (error) {
      console.error("Error deleting payment method:", error);
      setAlertMessage("Failed to delete payment method");
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * resetAccountForm - Clears all account form fields
   */
  const resetAccountForm = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setImageFile(null);
    setAccountName("");
    setCurrency("KES");
    setEditingAccountId(null);
  };

  /**
   * resetPaymentMethodForm - Clears all payment method form fields
   */
  const resetPaymentMethodForm = () => {
    setPaymentMethodName("");
    setSelectedAccountForPaymentMethod(null);
    setEditingPaymentMethodId(null);
  };

  /**
   * getPaymentMethodsForAccount - Filters payment methods by account ID
   */
  const getPaymentMethodsForAccount = (accountId: number) => {
    return paymentMethods.filter((pm) => pm.accountId === accountId);
  };

  // NEW: payment methods that have no accountId (null / undefined)
  const unlinkedPaymentMethods = paymentMethods.filter(
    (pm) => pm.accountId == null
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Accounts</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {loading && <IonSpinner />}

        {/* ACCOUNT FORM SECTION */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {editingAccountId ? "Edit Account" : "Add New Account"}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonInput
                    label="Account Name"
                    labelPlacement="stacked"
                    placeholder="e.g., M-Pesa, PayPal"
                    value={accountName}
                    onIonChange={(e) => setAccountName(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonSelect
                    label="Currency"
                    labelPlacement="stacked"
                    value={currency}
                    onIonChange={(e) => setCurrency(e.detail.value)}
                  >
                    {CURRENCY_OPTIONS.map((curr) => (
                      <IonSelectOption key={curr} value={curr}>
                        {curr}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <label>Account Image (optional)</label>
                  <input type="file" accept="image/*" onChange={onFileChange} />
                  {previewUrl && (
                    <div style={{ marginTop: 8 }}>
                      <img
                        src={previewUrl}
                        alt="preview"
                        style={{
                          width: 64,
                          height: 64,
                          objectFit: "cover",
                          borderRadius: 6,
                        }}
                      />
                    </div>
                  )}
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton expand="block" onClick={handleAddOrUpdateAccount}>
                    {editingAccountId ? "Update Account" : "Add Account"}
                  </IonButton>
                </IonCol>
                {editingAccountId && (
                  <IonCol>
                    <IonButton
                      expand="block"
                      onClick={resetAccountForm}
                      color="medium"
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* PAYMENT METHOD FORM SECTION */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {editingPaymentMethodId
                ? "Edit Payment Method"
                : "Add Payment Method"}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonSelect
                    label="Select Account"
                    labelPlacement="stacked"
                    value={selectedAccountForPaymentMethod}
                    onIonChange={(e) =>
                      setSelectedAccountForPaymentMethod(e.detail.value)
                    }
                  >
                    {accounts.map((account) => (
                      <IonSelectOption key={account.id} value={account.id}>
                        {account.name}
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
                    placeholder="e.g., Visa, Mastercard"
                    value={paymentMethodName}
                    onIonChange={(e) => setPaymentMethodName(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton
                    expand="block"
                    onClick={handleAddOrUpdatePaymentMethod}
                  >
                    {editingPaymentMethodId
                      ? "Update Payment Method"
                      : "Add Payment Method"}
                  </IonButton>
                </IonCol>
                {editingPaymentMethodId && (
                  <IonCol>
                    <IonButton
                      expand="block"
                      onClick={resetPaymentMethodForm}
                      color="medium"
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* ACCOUNTS LIST WITH NESTED PAYMENT METHODS */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Accounts</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {accounts.length === 0 ? (
              <p>No accounts yet. Add one to get started.</p>
            ) : (
              <IonAccordionGroup>
                {accounts.map((account: LocalAccount) => {
                  const accountPaymentMethods = getPaymentMethodsForAccount(
                    account.id!
                  );
                  return (
                    <IonAccordion
                      key={account.id}
                      value={`account-${account.id}`}
                    >
                      <IonItem slot="header">
                        <IonGrid className="ion-no-padding">
                          <IonRow>
                            <IonCol size="auto">
                              {account.previewUrl && (
                                <img
                                  src={account.previewUrl}
                                  alt={account.name}
                                  style={{
                                    width: 40,
                                    height: 40,
                                    objectFit: "cover",
                                    borderRadius: 4,
                                    marginRight: 8,
                                  }}
                                />
                              )}
                            </IonCol>
                            <IonCol>
                              <strong>{account.name}</strong>
                              {account.currency && (
                                <span style={{ marginLeft: "10px" }}>
                                  ({account.currency})
                                </span>
                              )}
                              <p style={{ fontSize: "0.85rem", color: "#666" }}>
                                {accountPaymentMethods.length} payment method
                                {accountPaymentMethods.length !== 1 ? "s" : ""}
                              </p>
                            </IonCol>
                            <IonCol size="auto">
                              <IonButton
                                fill="clear"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditAccount(account);
                                }}
                              >
                                <IonIcon icon={createOutline} />
                              </IonButton>

                              <IonButton
                                fill="clear"
                                size="small"
                                color="danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteAccountId(account.id ?? null);
                                }}
                              >
                                <IonIcon icon={trashOutline} />
                              </IonButton>
                            </IonCol>
                          </IonRow>
                        </IonGrid>
                      </IonItem>

                      <div slot="content">
                        {accountPaymentMethods.length === 0 ? (
                          <p style={{ padding: "16px" }}>
                            No payment methods for this account.
                          </p>
                        ) : (
                          <IonList>
                            {accountPaymentMethods.map((pm) => (
                              <IonItem key={pm.id}>
                                <IonGrid className="ion-no-padding">
                                  <IonRow>
                                    <IonCol>
                                      <strong>{pm.name}</strong>
                                    </IonCol>
                                    <IonCol size="auto">
                                      <IonButton
                                        fill="clear"
                                        size="small"
                                        onClick={() =>
                                          handleEditPaymentMethod(pm)
                                        }
                                      >
                                        <IonIcon icon={createOutline} />
                                      </IonButton>

                                      <IonButton
                                        fill="clear"
                                        size="small"
                                        color="danger"
                                        onClick={() =>
                                          setDeletePaymentMethodId(
                                            pm.id ?? null
                                          )
                                        }
                                      >
                                        <IonIcon icon={trashOutline} />
                                      </IonButton>
                                    </IonCol>
                                  </IonRow>
                                </IonGrid>
                              </IonItem>
                            ))}
                          </IonList>
                        )}
                      </div>
                    </IonAccordion>
                  );
                })}
              </IonAccordionGroup>
            )}
          </IonCardContent>
        </IonCard>

        {/* NEW: Unlinked payment methods shown after all accounts */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Unlinked Payment Methods</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {unlinkedPaymentMethods.length === 0 ? (
              <p style={{ margin: 0 }}>No unlinked payment methods.</p>
            ) : (
              <IonList>
                {unlinkedPaymentMethods.map((pm) => (
                  <IonItem key={pm.id}>
                    <IonGrid className="ion-no-padding">
                      <IonRow>
                        <IonCol>
                          <strong>{pm.name}</strong>
                          <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
                            {pm.isActive ? "Active" : "Inactive"}
                          </p>
                        </IonCol>
                        <IonCol size="auto">
                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={() => handleEditPaymentMethod(pm)}
                          >
                            <IonIcon icon={createOutline} />
                          </IonButton>
                          <IonButton
                            fill="clear"
                            size="small"
                            color="danger"
                            onClick={() =>
                              setDeletePaymentMethodId(pm.id ?? null)
                            }
                          >
                            <IonIcon icon={trashOutline} />
                          </IonButton>
                        </IonCol>
                      </IonRow>
                    </IonGrid>
                  </IonItem>
                ))}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        {/* ALERTS */}
        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header="Alert"
          message={alertMessage}
          buttons={["OK"]}
        />

        <IonAlert
          isOpen={deleteAccountId !== null}
          onDidDismiss={() => setDeleteAccountId(null)}
          header="Confirm Delete"
          message="Are you sure you want to delete this account? All associated payment methods will also be deleted."
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteAccountId) {
                  handleDeleteAccount(deleteAccountId);
                }
              },
            },
          ]}
        />

        <IonAlert
          isOpen={deletePaymentMethodId !== null}
          onDidDismiss={() => setDeletePaymentMethodId(null)}
          header="Confirm Delete"
          message="Are you sure you want to delete this payment method?"
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deletePaymentMethodId) {
                  handleDeletePaymentMethod(deletePaymentMethodId);
                }
              },
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default AccountsManagement;

/**
 * AccountsManagement Component
 *
 * This page allows users to:
 * - View all bank accounts
 * - Add new accounts with name, currency, and optional image
 * - Edit existing account details
 * - Delete accounts with confirmation
 * - Activate/deactivate accounts
 *
 * State Management:
 * - accounts: Array of all accounts from the database
 * - editingAccount: Tracks which account is being edited (null if adding new)
 * - loading: Shows spinner while database operations are in progress
 * - showAddAccountModal: Controls visibility of add/edit account modal
 * - deleteState: Tracks account deletion state and type
 * - showToast: Controls visibility of success messages
 * - toastMessage: Message to display in toast
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
  IonCard,
  IonCardContent,
  IonAlert,
  IonSpinner,
  IonGrid,
  IonRow,
  IonCol,
  IonIcon,
  IonFab,
  IonFabButton,
  IonToast,
  IonItem,
  IonList,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
} from "ionicons/icons";
import { db } from "../db";
import { AddAccountModal } from "../components/AddAccountModal";

import type { Account } from "../db";

type LocalAccount = Account & { previewUrl?: string };

type DeleteState =
  | { type: "none" }
  | { type: "used"; accountId: number; accountName: string }
  | { type: "used_deactivated"; accountId: number; accountName: string }
  | { type: "empty"; accountId: number; accountName: string };

const AccountsManagement: React.FC = () => {
  // Account state
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({ type: "none" });

  // Toast state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Track blob URLs for cleanup
  const blobUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchAccounts();

    // Capture current blob URLs for cleanup
    const blobUrls = blobUrlsRef.current;

    // Cleanup blob URLs on unmount
    return () => {
      blobUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrls.clear();
    };
  }, []);

  /**
   * fetchAccounts - Retrieves all accounts from the database
   */
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      // Revoke old blob URLs before fetching new ones
      blobUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrlsRef.current.clear();

      const fetched: Account[] = await db.accounts.toArray();
      const withPreview: LocalAccount[] = fetched.map((a) => {
        let preview: string | undefined;
        if (a.imageBlob) {
          preview = URL.createObjectURL(a.imageBlob);
          blobUrlsRef.current.add(preview);
        }
        return { ...a, previewUrl: preview };
      });
      setAccounts(withPreview);
    } catch (error) {
      console.error("Error fetching accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleAccountSaved - Called when account is added/updated via modal
   */
  const handleAccountSaved = async (isEdit: boolean) => {
    setEditingAccount(null);
    setToastMessage(
      isEdit ? "Account updated successfully!" : "Account added successfully!"
    );
    setShowToast(true);
    await fetchAccounts();
  };

  /**
   * handleEditAccount - Opens modal with account data
   */
  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setShowAddAccountModal(true);
  };

  /**
   * checkAccountUsage - Determines if account has been used in transactions
   */
  const checkAccountUsage = async (accountId: number): Promise<boolean> => {
    try {
      const transactions = await db.transactions.toArray();
      return transactions.some((txn) => txn.accountId === accountId);
    } catch (error) {
      console.error("Error checking account usage:", error);
      return false;
    }
  };

  /**
   * initiateDeleteAccount - Check account usage and set appropriate delete state
   */
  const initiateDeleteAccount = async (account: Account) => {
    try {
      setLoading(true);

      const isUsed = await checkAccountUsage(account.id!);
      const isDeactivated = account.isActive === false;

      if (isUsed && !isDeactivated) {
        // Account is ACTIVE and has been used in transactions
        setDeleteState({
          type: "used",
          accountId: account.id!,
          accountName: account.name,
        });
      } else if (isUsed && isDeactivated) {
        // Account is DEACTIVATED and has been used in transactions
        // Show informational alert, no deactivate option
        setDeleteState({
          type: "used_deactivated",
          accountId: account.id!,
          accountName: account.name,
        });
      } else {
        // Account is completely empty
        setDeleteState({
          type: "empty",
          accountId: account.id!,
          accountName: account.name,
        });
      }
    } catch (error) {
      console.error("Error checking account usage:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeactivateAccount - Deactivates an account instead of deleting
   */
  const handleDeactivateAccount = async (accountId: number) => {
    try {
      setLoading(true);
      await db.accounts.update(accountId, { isActive: false });
      setDeleteState({ type: "none" });
      setToastMessage("Account deactivated successfully!");
      setShowToast(true);
      await fetchAccounts();
    } catch (error) {
      console.error("Error deactivating account:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeleteAccount - Removes an account from the database
   */
  const handleDeleteAccount = async (accountId: number) => {
    try {
      setLoading(true);
      await db.accounts.delete(accountId);

      setDeleteState({ type: "none" });
      setToastMessage("Account deleted successfully!");
      setShowToast(true);
      await fetchAccounts();
    } catch (error) {
      console.error("Error deleting account:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleToggleAccountActive - Toggles account active/inactive status
   */
  const handleToggleAccountActive = async (account: Account) => {
    try {
      setLoading(true);
      const newStatus = account.isActive === false ? true : false;
      await db.accounts.update(account.id!, { isActive: newStatus });
      setToastMessage(
        newStatus ? "Account activated!" : "Account deactivated!"
      );
      setShowToast(true);
      await fetchAccounts();
    } catch (error) {
      console.error("Error toggling account status:", error);
    } finally {
      setLoading(false);
    }
  };

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

        {/* ACCOUNTS LIST */}
        <IonCard>
          <IonCardContent>
            {accounts.length === 0 ? (
              <p>No accounts yet. Tap the + button to add one.</p>
            ) : (
              <IonList>
                {accounts.map((account: LocalAccount) => {
                  const isInactive = account.isActive === false;

                  return (
                    <IonItem key={account.id}>
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
                                  opacity: isInactive ? 0.5 : 1,
                                }}
                              />
                            )}
                          </IonCol>
                          <IonCol>
                            <strong style={{ opacity: isInactive ? 0.6 : 1 }}>
                              {account.name}
                            </strong>
                            {account.currency && (
                              <span
                                style={{
                                  marginLeft: "10px",
                                  opacity: isInactive ? 0.6 : 1,
                                }}
                              >
                                ({account.currency})
                              </span>
                            )}
                            {account.isCredit && (
                              <div
                                style={{
                                  fontSize: "0.85rem",
                                  color: "var(--ion-color-warning)",
                                  marginTop: "4px",
                                  opacity: isInactive ? 0.6 : 1,
                                }}
                              >
                                Credit Account
                                {account.creditLimit && (
                                  <span>
                                    {" "}
                                    - Limit:{" "}
                                    {account.creditLimit.toLocaleString(
                                      undefined,
                                      {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      }
                                    )}
                                  </span>
                                )}
                              </div>
                            )}
                            {account.description && (
                              <p
                                style={{
                                  fontSize: "0.85rem",
                                  color: "#999",
                                  margin: "4px 0 0 0",
                                  opacity: isInactive ? 0.6 : 1,
                                }}
                              >
                                {account.description}
                              </p>
                            )}
                          </IonCol>
                          <IonCol size="auto">
                            <IonButton
                              fill="clear"
                              size="small"
                              color="secondary"
                              title="Edit Account"
                              onClick={() => handleEditAccount(account)}
                            >
                              <IonIcon icon={createOutline} />
                            </IonButton>
                            <IonButton
                              fill="clear"
                              size="small"
                              title={
                                isInactive
                                  ? "Activate account"
                                  : "Deactivate account"
                              }
                              onClick={() => handleToggleAccountActive(account)}
                              color={isInactive ? "medium" : "success"}
                            >
                              <IonIcon
                                icon={
                                  isInactive
                                    ? closeCircleOutline
                                    : checkmarkCircleOutline
                                }
                              />
                            </IonButton>

                            <IonButton
                              fill="clear"
                              size="small"
                              color="danger"
                              onClick={() => initiateDeleteAccount(account)}
                            >
                              <IonIcon icon={trashOutline} />
                            </IonButton>
                          </IonCol>
                        </IonRow>
                      </IonGrid>
                    </IonItem>
                  );
                })}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        {/* ALERT: Deactivated account has been used in transactions */}
        <IonAlert
          isOpen={deleteState.type === "used_deactivated"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Cannot Delete Used Account"
          message={`This account (${
            deleteState.type === "used_deactivated"
              ? deleteState.accountName
              : ""
          }) has been used in transactions and cannot be deleted. Deactivated accounts will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "OK",
              role: "cancel",
            },
          ]}
        />

        {/* ALERT: Account has been used in transactions (ACTIVE - offer to deactivate) */}
        <IonAlert
          isOpen={deleteState.type === "used"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Cannot Delete Used Account"
          message={`This account (${
            deleteState.type === "used" ? deleteState.accountName : ""
          }) has been used in transactions and cannot be deleted. Would you like to deactivate it instead? Deactivated accounts will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Deactivate",
              role: "destructive",
              handler: () => {
                if (deleteState.type === "used") {
                  handleDeactivateAccount(deleteState.accountId);
                }
              },
            },
          ]}
        />

        {/* ALERT: Delete empty account */}
        <IonAlert
          isOpen={deleteState.type === "empty"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Confirm Delete"
          message={`Are you sure you want to delete "${
            deleteState.type === "empty" ? deleteState.accountName : ""
          }"? This action cannot be undone.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteState.type === "empty") {
                  handleDeleteAccount(deleteState.accountId);
                }
              },
            },
          ]}
        />

        {/* MODALS */}
        <AddAccountModal
          isOpen={showAddAccountModal}
          onClose={() => {
            setShowAddAccountModal(false);
            setEditingAccount(null);
          }}
          onAccountAdded={() => handleAccountSaved(!!editingAccount)}
          editingAccount={editingAccount}
        />

        {/* FAB BUTTON FOR ADDING ACCOUNTS */}
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            onClick={() => {
              setEditingAccount(null);
              setShowAddAccountModal(true);
            }}
            title="Add Account"
          >
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        {/* TOAST NOTIFICATIONS */}
        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMessage}
          duration={2000}
          position="top"
          color="success"
        />
      </IonContent>
    </IonPage>
  );
};

export default AccountsManagement;

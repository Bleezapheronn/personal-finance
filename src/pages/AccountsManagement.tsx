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
  IonFab,
  IonFabButton,
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
import { AddPaymentMethodModal } from "../components/AddPaymentMethodModal";

import type { Account, PaymentMethod } from "../db";

type LocalAccount = Account & { previewUrl?: string };

type DeleteState =
  | { type: "none" }
  | { type: "used"; accountId: number; accountName: string }
  | {
      type: "unused_with_pm";
      accountId: number;
      accountName: string;
      pmCount: number;
    }
  | { type: "empty"; accountId: number; accountName: string };

const AccountsManagement: React.FC = () => {
  // Account state
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // Payment Method state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [editingPaymentMethod, setEditingPaymentMethod] =
    useState<PaymentMethod | null>(null);
  const [showAddPaymentMethodModal, setShowAddPaymentMethodModal] =
    useState(false);
  const [selectedAccountForPaymentMethod, setSelectedAccountForPaymentMethod] =
    useState<number | undefined>(undefined);

  // UI state
  const [loading, setLoading] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({ type: "none" });
  const [deletePaymentMethodId, setDeletePaymentMethodId] = useState<
    number | null
  >(null);

  // Track blob URLs for cleanup
  const blobUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchAccounts();
    fetchPaymentMethods();

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
   * fetchPaymentMethods - Retrieves all payment methods from the database
   */
  const fetchPaymentMethods = async () => {
    try {
      const fetched: PaymentMethod[] = await db.paymentMethods.toArray();
      setPaymentMethods(fetched);
    } catch (error) {
      console.error("Error fetching payment methods:", error);
    }
  };

  /**
   * handleAccountSaved - Called when account is added/updated via modal
   */
  const handleAccountSaved = async () => {
    setEditingAccount(null);
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
      const paymentMethodsForAccount = paymentMethods.filter(
        (pm) => pm.accountId === accountId
      );

      if (paymentMethodsForAccount.length === 0) {
        return false; // No payment methods, so no transactions possible
      }

      const pmIds = paymentMethodsForAccount.map((pm) => pm.id!);
      const transactions = await db.transactions.toArray();

      // Check if any transaction uses these payment methods
      const hasTransactions = transactions.some((txn) =>
        pmIds.includes(txn.paymentChannelId)
      );

      return hasTransactions;
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
      const accountPaymentMethods = paymentMethods.filter(
        (pm) => pm.accountId === account.id
      );

      if (isUsed) {
        // Account has been used in transactions
        setDeleteState({
          type: "used",
          accountId: account.id!,
          accountName: account.name,
        });
      } else if (accountPaymentMethods.length > 0) {
        // Account has payment methods but unused
        setDeleteState({
          type: "unused_with_pm",
          accountId: account.id!,
          accountName: account.name,
          pmCount: accountPaymentMethods.length,
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
      await fetchAccounts();
    } catch (error) {
      console.error("Error deactivating account:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeleteAccount - Removes an account and its unused payment methods
   */
  const handleDeleteAccount = async (accountId: number) => {
    try {
      setLoading(true);

      // Get all payment methods for this account
      const accountPaymentMethods = paymentMethods.filter(
        (pm) => pm.accountId === accountId
      );

      // Delete all payment methods
      for (const pm of accountPaymentMethods) {
        if (pm.id) {
          await db.paymentMethods.delete(pm.id);
        }
      }

      // Delete the account
      await db.accounts.delete(accountId);

      setDeleteState({ type: "none" });
      await fetchAccounts();
      await fetchPaymentMethods();
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
      await fetchAccounts();
    } catch (error) {
      console.error("Error toggling account status:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handlePaymentMethodSaved - Called when payment method is added/updated via modal
   */
  const handlePaymentMethodSaved = async () => {
    setEditingPaymentMethod(null);
    await fetchPaymentMethods();
  };

  /**
   * handleEditPaymentMethod - Opens modal with payment method data
   */
  const handleEditPaymentMethod = (paymentMethod: PaymentMethod) => {
    setEditingPaymentMethod(paymentMethod);
    setShowAddPaymentMethodModal(true);
  };

  /**
   * handleAddPaymentMethod - Opens modal to add payment method for specific account
   */
  const handleAddPaymentMethod = (accountId: number) => {
    setEditingPaymentMethod(null);
    setSelectedAccountForPaymentMethod(accountId);
    setShowAddPaymentMethodModal(true);
  };

  /**
   * handleDeletePaymentMethod - Removes a payment method from the database
   */
  const handleDeletePaymentMethod = async (paymentMethodId: number) => {
    try {
      setLoading(true);
      await db.paymentMethods.delete(paymentMethodId);
      setDeletePaymentMethodId(null);
      await fetchPaymentMethods();
    } catch (error) {
      console.error("Error deleting payment method:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleTogglePaymentMethodActive - Toggles payment method active/inactive status
   */
  const handleTogglePaymentMethodActive = async (
    paymentMethod: PaymentMethod
  ) => {
    try {
      setLoading(true);
      const newStatus = paymentMethod.isActive === false ? true : false;
      await db.paymentMethods.update(paymentMethod.id!, {
        isActive: newStatus,
      });
      await fetchPaymentMethods();
    } catch (error) {
      console.error("Error toggling payment method status:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * getPaymentMethodsForAccount - Filters payment methods by account ID
   */
  const getPaymentMethodsForAccount = (accountId: number) => {
    return paymentMethods.filter((pm) => pm.accountId === accountId);
  };

  /**
   * unlinkedPaymentMethods - Payment methods with no matching account
   */
  const unlinkedPaymentMethods = paymentMethods.filter((pm) => {
    const accountExists = accounts.some((a) => a.id === pm.accountId);
    return !accountExists;
  });

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

        {/* ACCOUNTS LIST WITH NESTED PAYMENT METHODS */}
        <IonCard>
          <IonCardContent>
            {accounts.length === 0 ? (
              <p>No accounts yet. Tap the + button to add one.</p>
            ) : (
              <IonAccordionGroup>
                {accounts.map((account: LocalAccount) => {
                  const accountPaymentMethods = getPaymentMethodsForAccount(
                    account.id!
                  );
                  const isInactive = account.isActive === false;

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
                              <p
                                style={{
                                  fontSize: "0.85rem",
                                  color: "#666",
                                  opacity: isInactive ? 0.6 : 1,
                                }}
                              >
                                {accountPaymentMethods.length} payment method
                                {accountPaymentMethods.length !== 1 ? "s" : ""}
                              </p>
                            </IonCol>
                            <IonCol size="auto">
                              {/* ADD PAYMENT METHOD BUTTON - Only show for active accounts */}
                              {!isInactive && (
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  color="secondary"
                                  title="Add Payment Method"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddPaymentMethod(account.id!);
                                  }}
                                >
                                  <IonIcon icon={add} />
                                </IonButton>
                              )}
                              <IonButton
                                fill="clear"
                                size="small"
                                title="Edit Account"
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
                                title={
                                  isInactive
                                    ? "Activate account"
                                    : "Deactivate account"
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleAccountActive(account);
                                }}
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  initiateDeleteAccount(account);
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
                            {accountPaymentMethods.map((pm) => {
                              const isInactivePM = pm.isActive === false;
                              return (
                                <IonItem key={pm.id}>
                                  <IonGrid className="ion-no-padding">
                                    <IonRow>
                                      <IonCol>
                                        <strong
                                          style={{
                                            opacity: isInactivePM ? 0.6 : 1,
                                          }}
                                        >
                                          {pm.name}
                                        </strong>
                                        {pm.description && (
                                          <p
                                            style={{
                                              fontSize: "0.85rem",
                                              color: "#999",
                                              margin: "4px 0 0 0",
                                              opacity: isInactivePM ? 0.6 : 1,
                                            }}
                                          >
                                            {pm.description}
                                          </p>
                                        )}
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
                                          title={
                                            isInactivePM
                                              ? "Activate payment method"
                                              : "Deactivate payment method"
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleTogglePaymentMethodActive(pm);
                                          }}
                                          color={
                                            isInactivePM ? "medium" : "success"
                                          }
                                        >
                                          <IonIcon
                                            icon={
                                              isInactivePM
                                                ? closeCircleOutline
                                                : checkmarkCircleOutline
                                            }
                                          />
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
                              );
                            })}
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

        {/* UNLINKED PAYMENT METHODS */}
        {unlinkedPaymentMethods.length > 0 && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Unlinked Payment Methods</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                {unlinkedPaymentMethods.map((pm) => {
                  const isInactivePM = pm.isActive === false;
                  return (
                    <IonItem key={pm.id}>
                      <IonGrid className="ion-no-padding">
                        <IonRow>
                          <IonCol>
                            <strong
                              style={{
                                opacity: isInactivePM ? 0.6 : 1,
                              }}
                            >
                              {pm.name}
                            </strong>
                            {pm.description && (
                              <p
                                style={{
                                  fontSize: "0.85rem",
                                  color: "#999",
                                  margin: "4px 0 0 0",
                                  opacity: isInactivePM ? 0.6 : 1,
                                }}
                              >
                                {pm.description}
                              </p>
                            )}
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
                              title={
                                isInactivePM
                                  ? "Activate payment method"
                                  : "Deactivate payment method"
                              }
                              onClick={() =>
                                handleTogglePaymentMethodActive(pm)
                              }
                              color={isInactivePM ? "medium" : "success"}
                            >
                              <IonIcon
                                icon={
                                  isInactivePM
                                    ? closeCircleOutline
                                    : checkmarkCircleOutline
                                }
                              />
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
                  );
                })}
              </IonList>
            </IonCardContent>
          </IonCard>
        )}

        {/* ALERT: Account has been used in transactions */}
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

        {/* ALERT: Delete unused account with payment methods */}
        <IonAlert
          isOpen={deleteState.type === "unused_with_pm"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Confirm Delete"
          message={`Delete "${
            deleteState.type === "unused_with_pm" ? deleteState.accountName : ""
          }" and its ${
            deleteState.type === "unused_with_pm" ? deleteState.pmCount : 0
          } payment method${
            deleteState.type === "unused_with_pm" && deleteState.pmCount !== 1
              ? "s"
              : ""
          }? This action cannot be undone.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteState.type === "unused_with_pm") {
                  handleDeleteAccount(deleteState.accountId);
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

        {/* DELETE PAYMENT METHOD ALERT */}
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

        {/* MODALS */}
        <AddAccountModal
          isOpen={showAddAccountModal}
          onClose={() => {
            setShowAddAccountModal(false);
            setEditingAccount(null);
          }}
          onAccountAdded={handleAccountSaved}
          editingAccount={editingAccount}
        />

        <AddPaymentMethodModal
          isOpen={showAddPaymentMethodModal}
          onClose={() => {
            setShowAddPaymentMethodModal(false);
            setEditingPaymentMethod(null);
            setSelectedAccountForPaymentMethod(undefined);
          }}
          onPaymentMethodAdded={handlePaymentMethodSaved}
          accounts={accounts}
          editingPaymentMethod={editingPaymentMethod}
          preSelectedAccountId={selectedAccountForPaymentMethod}
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
      </IonContent>
    </IonPage>
  );
};

export default AccountsManagement;

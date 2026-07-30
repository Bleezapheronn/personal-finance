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

import React, { useEffect, useState } from "react";
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
  IonLabel,
  IonList,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
} from "ionicons/icons";
import {
  AddAccountModal,
  type AccountFormValues,
} from "../components/AddAccountModal";
import {
  getRepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  booleanValue,
  type DevPreviewListResult,
  numberValue,
  previewRows,
  stringValue,
} from "../utils/devPreview";
import {
  createAccountInDisposableSqlite,
  updateAccountInDisposableSqlite,
} from "../repositories/http/accountWriteExperiment";
import {
  accountLifecycleErrorCode,
  dryRunAccountDelete,
  writeAccountDelete,
} from "../repositories/http/accountDeleteMergeWriteExperiment";
import { useAccountImageUrls } from "../hooks/useAccountImageUrls";
import { writeLookupActiveState } from "../repositories/http/lookupActiveStateWrite";

import type { Account } from "../db";

type LocalAccount = Account;

type DeleteState =
  | { type: "none" }
  | { type: "used"; accountId: number; accountName: string }
  | { type: "used_deactivated"; accountId: number; accountName: string }
  | {
      type: "empty";
      accountId: number;
      accountName: string;
      sqlitePlanFingerprint?: string;
    };

const ACCOUNTS_LIST_LIMIT = 500;

const dateValue = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
};

const selectedReadRowToAccount = (row: { id?: unknown }): Account => {
  const source = row as Record<string, unknown>;

  return {
    id: numberValue(source.id),
    name: stringValue(source.name) ?? "",
    description: stringValue(source.description),
    currency: stringValue(source.currency),
    imageBlob: null,
    isActive: booleanValue(source.isActive) !== false,
    isCredit: booleanValue(source.isCredit) === true,
    creditLimit: numberValue(source.creditLimit),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const compareAccountsByExistingDisplayOrder = (
  left: Account,
  right: Account,
): number =>
  (left.id ?? Number.MAX_SAFE_INTEGER) -
  (right.id ?? Number.MAX_SAFE_INTEGER);

const AccountsManagement: React.FC = () => {
  // Account state
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const { imageUrls: accountImageUrls } = useAccountImageUrls(accounts);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({ type: "none" });

  // Toast state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const selectedBackend = getRepositoryBackend();

  const showSafeAccountLifecycleError = (error: unknown): void => {
    const code = accountLifecycleErrorCode(error);
    const message = code === "account_lifecycle_plan_stale"
      ? "This account changed before the action could finish. Reload and try again."
      : "Couldn't complete that account action. Try again.";
    setToastMessage(message);
    setShowToast(true);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  /**
   * fetchAccounts - Retrieves all accounts from the database
   */
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const repositories = getSelectedReadRepositories(selectedBackend);
      const result = await repositories.accounts.list({ limit: ACCOUNTS_LIST_LIMIT, offset: 0 });
      const rows = previewRows(result as DevPreviewListResult);
      if (!rows) throw new Error("authoritative_accounts_read_unavailable");
      setAccounts(rows.map(selectedReadRowToAccount).sort(compareAccountsByExistingDisplayOrder));
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

  const handleSqliteAccountSave = async (
    values: AccountFormValues,
    currentAccount?: Account | null,
  ) => {
    try {
      if (currentAccount?.id) {
        await updateAccountInDisposableSqlite(currentAccount.id, values);
        setToastMessage("Account updated successfully!");
      } else {
        await createAccountInDisposableSqlite(values);
        setToastMessage("Account added successfully!");
      }
      await fetchAccounts();
      setShowToast(true);
    } catch (error) {
      setToastMessage("Couldn't save the account. Try again.");
      setShowToast(true);
      throw new Error("account_save_failed");
    }
  };

  const initiateDeleteAccount = async (account: Account) => {
    try {
      setLoading(true);
      if (!account.id) {
        throw new Error("account_id_missing");
      }
      const plan = await dryRunAccountDelete(account.id);
      if (!plan.eligible) {
        if (account.isActive === false) {
          setDeleteState({
            type: "used_deactivated",
            accountId: account.id,
            accountName: account.name,
          });
        } else {
          setDeleteState({
            type: "used",
            accountId: account.id,
            accountName: account.name,
          });
        }
        return;
      }
      setDeleteState({
        type: "empty",
        accountId: account.id,
        accountName: account.name,
        sqlitePlanFingerprint: plan.planFingerprint,
      });
    } catch (error) {
      showSafeAccountLifecycleError(error);
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
      await writeLookupActiveState("account", accountId, "deactivate");
      setDeleteState({ type: "none" });
      setToastMessage("Account deactivated successfully!");
      setShowToast(true);
      await fetchAccounts();
    } catch (error) {
      showSafeAccountLifecycleError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeleteAccount - Removes an account from the database
   */
  const handleDeleteAccount = async (accountId: number) => {
    if (deleteState.type !== "empty" || !deleteState.sqlitePlanFingerprint) {
      setToastMessage("Review this account again before deleting it.");
      setShowToast(true);
      return;
    }
    try {
      setLoading(true);
      await writeAccountDelete(accountId, deleteState.sqlitePlanFingerprint);
      setDeleteState({ type: "none" });
      await fetchAccounts();
      setToastMessage("Account deleted successfully!");
      setShowToast(true);
    } catch (error) {
      showSafeAccountLifecycleError(error);
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
      await writeLookupActiveState(
        "account",
        account.id!,
        newStatus ? "activate" : "deactivate",
      );
      setToastMessage(
        newStatus ? "Account activated!" : "Account deactivated!"
      );
      setShowToast(true);
      await fetchAccounts();
    } catch (error) {
      showSafeAccountLifecycleError(error);
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
                            {account.id && accountImageUrls.has(account.id) ? (
                              <img
                                src={accountImageUrls.get(account.id)}
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
                            ) : (
                              <div
                                aria-label={`${account.name} initials`}
                                style={{
                                  width: 40,
                                  height: 40,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderRadius: 4,
                                  marginRight: 8,
                                  background: "#d7d8da",
                                  opacity: isInactive ? 0.5 : 1,
                                }}
                              >
                                {account.name.charAt(0).toUpperCase()}
                              </div>
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
                                title={isInactive ? "Activate account" : "Deactivate account"}
                                onClick={() => handleToggleAccountActive(account)}
                                color={isInactive ? "medium" : "success"}
                              >
                                <IonIcon icon={isInactive ? closeCircleOutline : checkmarkCircleOutline} />
                              </IonButton>
                              <IonButton
                                fill="clear"
                                size="small"
                                color="danger"
                                title="Delete unused Account"
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
            onSave={handleSqliteAccountSave}
            imageEditingEnabled={false}
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

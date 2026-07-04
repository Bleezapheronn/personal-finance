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
  IonLabel,
  IonList,
  IonText,
  IonBadge,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  warningOutline,
} from "ionicons/icons";
import { db } from "../db";
import { AddAccountModal } from "../components/AddAccountModal";
import { accountRepository, transactionRepository } from "../repositories";
import {
  getRepositoryBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { SelectedReadPreviewCard } from "../components/dev/SelectedReadPreviewCard";
import {
  booleanValue,
  type DevPreviewListResult,
  hasValue,
  isSelectedReadPreviewsEnabled,
  numberValue,
  previewCount,
  previewRows,
  safePreviewErrorCode,
  sampledIds,
  stringValue,
} from "../utils/devPreview";

import type { Account } from "../db";

type LocalAccount = Account & { previewUrl?: string };

type DeleteState =
  | { type: "none" }
  | { type: "used"; accountId: number; accountName: string }
  | { type: "used_deactivated"; accountId: number; accountName: string }
  | { type: "empty"; accountId: number; accountName: string };

interface SelectedReadAccountPreviewRow {
  id?: number;
  isActive?: boolean | null;
  isCredit?: boolean | null;
  currency?: string;
  hasImage: boolean;
  hasCreditLimit: boolean;
}

interface SelectedReadAccountsPreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  rows: SelectedReadAccountPreviewRow[];
  errorCode?: string;
}

const SELECTED_READ_PREVIEW_LIMIT = 20;
const ACCOUNTS_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT";
const ACCOUNTS_READ_EXPERIMENT_LIMIT = 500;

const isAccountsReadExperimentEnabled = (): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[ACCOUNTS_READ_EXPERIMENT_FLAG]?.trim() === "true";
};

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
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({ type: "none" });

  // Toast state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadAccountsPreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [accountsReadExperimentCount, setAccountsReadExperimentCount] =
    useState<number | undefined>(undefined);

  const selectedBackend = getRepositoryBackend();
  const accountsReadExperimentEnabled = isAccountsReadExperimentEnabled();
  const accountsReadExperimentHttpReadonly =
    accountsReadExperimentEnabled && selectedBackend === "http-readonly";

  const showReadExperimentWriteDisabledToast = () => {
    setToastMessage("Switch back to Dexie to edit accounts");
    setShowToast(true);
  };

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

      let fetched: Account[];
      let selectedReadCount: number | undefined;

      if (accountsReadExperimentHttpReadonly) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.accounts.list({
          limit: ACCOUNTS_READ_EXPERIMENT_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_accounts_read_experiment_response");
        }

        fetched = rows
          .map(selectedReadRowToAccount)
          .sort(compareAccountsByExistingDisplayOrder);
        selectedReadCount = previewCount(result as DevPreviewListResult);
      } else {
        fetched = await accountRepository.listAccounts();
      }

      setAccountsReadExperimentCount(selectedReadCount);
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
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

    setEditingAccount(account);
    setShowAddAccountModal(true);
  };

  /**
   * checkAccountUsage - Determines if account has been used in transactions
   */
  const checkAccountUsage = async (accountId: number): Promise<boolean> => {
    try {
      return transactionRepository.accountHasTransactions(accountId);
    } catch (error) {
      console.error("Error checking account usage:", error);
      return false;
    }
  };

  /**
   * initiateDeleteAccount - Check account usage and set appropriate delete state
   */
  const initiateDeleteAccount = async (account: Account) => {
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      setDeleteState({ type: "none" });
      return;
    }

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
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      setDeleteState({ type: "none" });
      return;
    }

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
    if (accountsReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const result = await repositories.accounts.list({
        limit: SELECTED_READ_PREVIEW_LIMIT,
        offset: 0,
      });
      const rows = previewRows(result as DevPreviewListResult);

      if (!rows) {
        setSelectedReadPreview({
          status: "fail",
          backend,
          source,
          rows: [],
          errorCode: "invalid_selected_read_accounts_preview_response",
        });
        return;
      }

      const visibleRows = rows.slice(0, SELECTED_READ_PREVIEW_LIMIT);

      setSelectedReadPreview({
        status: "pass",
        backend,
        source,
        count: previewCount(result as DevPreviewListResult),
        loadedRowCount: visibleRows.length,
        sampledIds: sampledIds(visibleRows, SELECTED_READ_PREVIEW_LIMIT),
        rows: visibleRows.map((row) => ({
          id: numberValue(row.id),
          isActive: booleanValue((row as { isActive?: unknown }).isActive),
          isCredit: booleanValue((row as { isCredit?: unknown }).isCredit),
          currency: stringValue((row as { currency?: unknown }).currency),
          hasImage:
            hasValue((row as { imageBlob?: unknown }).imageBlob) ||
            hasValue((row as { imageMimeType?: unknown }).imageMimeType),
          hasCreditLimit: hasValue(
            (row as { creditLimit?: unknown }).creditLimit
          ),
        })),
      });
    } catch (error) {
      setSelectedReadPreview({
        status: "fail",
        backend,
        source,
        rows: [],
        errorCode: safePreviewErrorCode(
          error,
          "selected_read_accounts_preview_failed",
        ),
      });
    } finally {
      setSelectedReadPreviewLoading(false);
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
        {showSelectedReadPreview && (
          <SelectedReadPreviewCard
            resourceLabel="Selected-read accounts"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description="This preview uses the selected read facade only when manually loaded. It does not replace this management screen or change create, edit, delete, or activation actions."
          >
              {selectedReadPreview && (
                <IonList>
                  <IonItem>
                    <IonLabel>Backend / source</IonLabel>
                    <IonText slot="end">
                      {selectedReadPreview.backend} /{" "}
                      {selectedReadPreview.source}
                    </IonText>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Status</IonLabel>
                    <IonBadge
                      color={
                        selectedReadPreview.status === "pass"
                          ? "success"
                          : "danger"
                      }
                      slot="end"
                    >
                      {selectedReadPreview.status === "pass" ? "Pass" : "Fail"}
                    </IonBadge>
                  </IonItem>
                  {selectedReadPreview.errorCode && (
                    <IonItem>
                      <IonLabel>Safe error code</IonLabel>
                      <IonText slot="end">
                        {selectedReadPreview.errorCode}
                      </IonText>
                    </IonItem>
                  )}
                  <IonItem>
                    <IonLabel>
                      <h3>Accounts</h3>
                      <p>
                        count={selectedReadPreview.count ?? "-"} loaded=
                        {selectedReadPreview.loadedRowCount ?? "-"} sampledIds=
                        {selectedReadPreview.sampledIds?.length
                          ? selectedReadPreview.sampledIds.join(", ")
                          : "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                  {selectedReadPreview.rows.map((account) => (
                    <IonItem key={`selected-account-${account.id ?? "none"}`}>
                      <IonLabel>
                        <h3>account id={account.id ?? "-"}</h3>
                        <p>
                          isActive=
                          {account.isActive === undefined
                            ? "-"
                            : String(account.isActive)}{" "}
                          isCredit=
                          {account.isCredit === undefined
                            ? "-"
                            : String(account.isCredit)}{" "}
                          currency={account.currency ?? "-"}
                        </p>
                        <p>
                          hasImage={String(account.hasImage)} hasCreditLimit=
                          {String(account.hasCreditLimit)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
              )}
          </SelectedReadPreviewCard>
        )}

        {accountsReadExperimentEnabled && (
          <IonCard>
            <IonCardContent>
              <IonText
                color={
                  accountsReadExperimentHttpReadonly ? "warning" : "medium"
                }
              >
                <p>
                  <IonIcon icon={warningOutline} />{" "}
                  {accountsReadExperimentHttpReadonly
                    ? "Accounts read experiment is active. List is loaded through selected-read `http-readonly`; writes are disabled. Switch back to Dexie to edit."
                    : "Accounts read experiment flag is active with the Dexie backend. Existing Dexie write behavior remains available."}
                </p>
                {accountsReadExperimentHttpReadonly && (
                  <p>
                    This is a list-only experiment. Transaction-derived account
                    usage checks remain on the existing Dexie path.
                  </p>
                )}
                {accountsReadExperimentHttpReadonly &&
                  accountsReadExperimentCount !== undefined &&
                  accountsReadExperimentCount > accounts.length && (
                    <p>
                      Showing {accounts.length} of {accountsReadExperimentCount}{" "}
                      accounts from the bounded selected-read page.
                    </p>
                  )}
              </IonText>
            </IonCardContent>
          </IonCard>
        )}

        {loading && <IonSpinner />}

        {/* ACCOUNTS LIST */}
        <IonCard>
          <IonCardContent>
            {accounts.length === 0 ? (
              <p>
                {accountsReadExperimentHttpReadonly
                  ? "No accounts were loaded by the read experiment."
                  : "No accounts yet. Tap the + button to add one."}
              </p>
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
                          {!accountsReadExperimentHttpReadonly && (
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
                                onClick={() =>
                                  handleToggleAccountActive(account)
                                }
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
                          )}
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
        {!accountsReadExperimentHttpReadonly && (
          <AddAccountModal
            isOpen={showAddAccountModal}
            onClose={() => {
              setShowAddAccountModal(false);
              setEditingAccount(null);
            }}
            onAccountAdded={() => handleAccountSaved(!!editingAccount)}
            editingAccount={editingAccount}
          />
        )}

        {/* FAB BUTTON FOR ADDING ACCOUNTS */}
        {!accountsReadExperimentHttpReadonly && (
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
        )}

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

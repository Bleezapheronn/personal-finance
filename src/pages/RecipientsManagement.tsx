import React, { useEffect, useState, useCallback } from "react";
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonMenuButton,
  IonList,
  IonItem,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonIcon,
  IonLabel,
  IonText,
  IonBadge,
  IonSpinner,
  IonFab,
  IonFabButton,
  IonToast,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  closeOutline,
  warningOutline,
} from "ionicons/icons";
import { db } from "../db";
import { AddRecipientModal } from "../components/AddRecipientModal";
import { findAllDuplicatePairs } from "../utils/recipientMerge";
import { MergeRecipientsModal } from "../components/MergeRecipientsModal";
import { recipientRepository, transactionRepository } from "../repositories";
import {
  getRepositoryBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import type { Recipient } from "../db";

type DeleteState =
  | { type: "none" }
  | { type: "used"; recipientId: number; recipientName: string }
  | { type: "used_deactivated"; recipientId: number; recipientName: string }
  | { type: "delete"; recipientId: number; recipientName: string };

interface SelectedReadRecipientPreviewRow {
  id?: number;
  isActive?: boolean | null;
  hasAliases: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasTillNumber: boolean;
  hasPaybill: boolean;
  hasAccountNumber: boolean;
}

interface SelectedReadRecipientsPreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  rows: SelectedReadRecipientPreviewRow[];
  errorCode?: string;
}

type SelectedReadListResult =
  | Array<{ id?: unknown }>
  | {
      count?: unknown;
      rows?: unknown;
    };

const SELECTED_READ_PREVIEWS_FLAG =
  "VITE_PERSONAL_FINANCE_SHOW_SELECTED_READ_PREVIEWS";
const SELECTED_READ_PREVIEW_LIMIT = 20;

const envFlagEnabled = (key: string): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() === "true";
};

const selectedReadRows = (
  result: SelectedReadListResult
): Array<{ id?: unknown }> | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  return Array.isArray(result.rows)
    ? (result.rows as Array<{ id?: unknown }>)
    : undefined;
};

const selectedReadCount = (result: SelectedReadListResult): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown): boolean | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
};

const sampledIds = (rows: Array<{ id?: unknown }>): number[] =>
  rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, SELECTED_READ_PREVIEW_LIMIT);

const safeErrorCode = (error: unknown): string => {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  return "selected_read_recipients_preview_failed";
};

const RecipientsManagement: React.FC = () => {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(
    null
  );
  const [showAddRecipientModal, setShowAddRecipientModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<
    "usage-high" | "usage-low" | "name-asc" | "name-desc"
  >("usage-high");
  const [filteredRecipients, setFilteredRecipients] = useState<Recipient[]>([]);
  const [recipientCounts, setRecipientCounts] = useState<Map<number, number>>(
    new Map()
  );
  const [duplicateRecipient, setDuplicateRecipient] =
    useState<Recipient | null>(null);
  const [showDuplicateAlert, setShowDuplicateAlert] = useState(false);

  const [deleteState, setDeleteState] = useState<DeleteState>({ type: "none" });
  const [duplicatePairs, setDuplicatePairs] = useState<
    Array<[Recipient, Recipient]>
  >([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const showSelectedReadPreview = envFlagEnabled(SELECTED_READ_PREVIEWS_FLAG);
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadRecipientsPreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);

  useEffect(() => {
    fetchRecipients();
  }, []);

  /**
   * fetchRecipients - Retrieves all recipients from the database
   */
  const fetchRecipients = async () => {
    try {
      setLoading(true);
      const all = await recipientRepository.listRecipients();

      // Get transactions to count usage
      const transactions = await transactionRepository.listTransactions();
      const counts = new Map<number, number>();

      transactions.forEach((txn) => {
        const count = counts.get(txn.recipientId) || 0;
        counts.set(txn.recipientId, count + 1);
      });

      setRecipientCounts(counts); // Store counts in state

      // Sort by transaction count (most used first), then by name
      const sorted = [...all].sort((a, b) => {
        const countA = counts.get(a.id!) || 0;
        const countB = counts.get(b.id!) || 0;
        if (countB !== countA) {
          return countB - countA;
        }
        return (a.name || "").localeCompare(b.name || "");
      });

      setRecipients(sorted);

      // NEW: Find duplicate pairs
      const pairs = findAllDuplicatePairs(sorted);
      setDuplicatePairs(pairs);
    } catch (err) {
      console.error("Error fetching recipients:", err);
      setToastMessage("Failed to load recipients");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleRecipientSaved - Called when recipient is added/updated via modal
   */
  const handleRecipientSaved = async () => {
    setEditingRecipient(null);
    const isEdit = editingRecipient !== null;
    setToastMessage(
      isEdit
        ? "Recipient updated successfully!"
        : "Recipient added successfully!"
    );
    setShowToast(true);
    await fetchRecipients();
  };

  /**
   * handleEditRecipient - Opens modal to edit recipient
   * Removed: old fuzzy duplicate detection that showed false positives
   */
  const handleEditRecipient = (recipient: Recipient) => {
    setEditingRecipient(recipient);
    setShowAddRecipientModal(true);
    // Removed: detectPotentialDuplicates() call that was showing false alerts
    // The banner notification already shows real duplicates using findAllDuplicatePairs()
  };

  /**
   * handleDeactivateRecipient - Deactivates a recipient instead of deleting
   */
  const handleDeactivateRecipient = async (recipientId: number) => {
    try {
      setLoading(true);
      await db.recipients.update(recipientId, { isActive: false });
      setDeleteState({ type: "none" });
      setToastMessage("Recipient deactivated successfully!");
      setShowToast(true);
      await fetchRecipients();
    } catch (error) {
      console.error("Error deactivating recipient:", error);
      setToastMessage("Failed to deactivate recipient");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeleteRecipient - Removes a recipient from the database
   */
  const handleDeleteRecipient = async (recipientId: number) => {
    try {
      setLoading(true);
      await db.recipients.delete(recipientId);
      setDeleteState({ type: "none" });
      setToastMessage("Recipient deleted successfully!");
      setShowToast(true);
      await fetchRecipients();
    } catch (error) {
      console.error("Error deleting recipient:", error);
      setToastMessage("Failed to delete recipient");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleToggleRecipientActive - Toggles recipient active/inactive status
   */
  const handleToggleRecipientActive = async (recipient: Recipient) => {
    try {
      setLoading(true);
      const newStatus = recipient.isActive === false ? true : false;
      await db.recipients.update(recipient.id!, { isActive: newStatus });
      await fetchRecipients();
    } catch (error) {
      console.error("Error toggling recipient status:", error);
      setToastMessage("Failed to update recipient status");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * applySearchAndSort - Filters and sorts recipients based on search term and sort preference
   */
  const applySearchAndSort = useCallback(
    (recipientsToFilter: Recipient[]) => {
      let result = [...recipientsToFilter];

      // Apply search filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        result = result.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            r.phone?.toLowerCase().includes(term) ||
            r.email?.toLowerCase().includes(term) ||
            r.tillNumber?.toLowerCase().includes(term) ||
            r.paybill?.toLowerCase().includes(term) ||
            r.accountNumber?.toLowerCase().includes(term) ||
            r.description?.toLowerCase().includes(term)
        );
      }

      // Apply sorting
      switch (sortBy) {
        case "name-asc":
          result.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case "name-desc":
          result.sort((a, b) => b.name.localeCompare(a.name));
          break;
        case "usage-low":
          result.sort((a, b) => {
            const countA = recipientCounts.get(a.id!) || 0;
            const countB = recipientCounts.get(b.id!) || 0;
            return countA - countB; // Low to high
          });
          break;
        case "usage-high":
        default:
          result.sort((a, b) => {
            const countA = recipientCounts.get(a.id!) || 0;
            const countB = recipientCounts.get(b.id!) || 0;
            return countB - countA; // High to low
          });
          break;
      }

      setFilteredRecipients(result);
    },
    [searchTerm, sortBy, recipientCounts]
  );

  useEffect(() => {
    applySearchAndSort(recipients);
  }, [applySearchAndSort, recipients]);

  /**
   * checkForDuplicateRecipient - Checks if a recipient with similar data already exists
   * Checks: name (case-insensitive), phone, paybill, account number
   */
  const checkForDuplicateRecipient = async (
    name: string,
    phone?: string,
    paybill?: string,
    accountNumber?: string,
    excludeId?: number
  ): Promise<Recipient | null> => {
    try {
      const allRecipients = await recipientRepository.listRecipients();

      return (
        allRecipients.find((r) => {
          if (r.id === excludeId) return false;

          // Check name (case-insensitive)
          if (r.name.toLowerCase() === name.toLowerCase()) {
            return true;
          }

          // Check phone match
          if (
            phone?.trim() &&
            r.phone?.trim() &&
            r.phone.trim() === phone.trim()
          ) {
            return true;
          }

          // Check paybill + account match
          if (
            paybill?.trim() &&
            accountNumber?.trim() &&
            r.paybill?.trim() === paybill.trim() &&
            r.accountNumber?.trim() === accountNumber.trim()
          ) {
            return true;
          }

          // Check till number match
          if (
            phone?.trim() &&
            r.phone?.trim() &&
            r.phone.trim() === phone.trim()
          ) {
            return true;
          }

          return false;
        }) || null
      );
    } catch (error) {
      console.error("Error checking for duplicate:", error);
      return null;
    }
  };

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const result = await repositories.recipients.list({
        limit: SELECTED_READ_PREVIEW_LIMIT,
        offset: 0,
      });
      const rows = selectedReadRows(result as SelectedReadListResult);

      if (!rows) {
        setSelectedReadPreview({
          status: "fail",
          backend,
          source,
          rows: [],
          errorCode: "invalid_selected_read_recipients_preview_response",
        });
        return;
      }

      const previewRows = rows.slice(0, SELECTED_READ_PREVIEW_LIMIT);

      setSelectedReadPreview({
        status: "pass",
        backend,
        source,
        count: selectedReadCount(result as SelectedReadListResult),
        loadedRowCount: previewRows.length,
        sampledIds: sampledIds(previewRows),
        rows: previewRows.map((row) => ({
          id: numberValue(row.id),
          isActive: booleanValue((row as { isActive?: unknown }).isActive),
          hasAliases: hasValue((row as { aliases?: unknown }).aliases),
          hasEmail: hasValue((row as { email?: unknown }).email),
          hasPhone: hasValue((row as { phone?: unknown }).phone),
          hasTillNumber: hasValue(
            (row as { tillNumber?: unknown }).tillNumber
          ),
          hasPaybill: hasValue((row as { paybill?: unknown }).paybill),
          hasAccountNumber: hasValue(
            (row as { accountNumber?: unknown }).accountNumber
          ),
        })),
      });
    } catch (error) {
      setSelectedReadPreview({
        status: "fail",
        backend,
        source,
        rows: [],
        errorCode: safeErrorCode(error),
      });
    } finally {
      setSelectedReadPreviewLoading(false);
    }
  };

  /**
   * initiateDeleteRecipient - Checks if recipient has been used in transactions
   * If used: offer to deactivate instead
   * If unused: confirm deletion
   */
  const initiateDeleteRecipient = async (recipient: Recipient) => {
    const transactionCount = recipientCounts.get(recipient.id!) || 0;

    if (transactionCount > 0) {
      // Recipient has been used in transactions
      if (recipient.isActive === false) {
        // Already inactive, can't delete
        setDeleteState({
          type: "used_deactivated",
          recipientId: recipient.id!,
          recipientName: recipient.name,
        });
      } else {
        // Active and used, offer to deactivate
        setDeleteState({
          type: "used",
          recipientId: recipient.id!,
          recipientName: recipient.name,
        });
      }
    } else {
      // Recipient has never been used, safe to delete
      setDeleteState({
        type: "delete",
        recipientId: recipient.id!,
        recipientName: recipient.name,
      });
    }
  };

  // Determine which alert to show

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Recipients</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {showSelectedReadPreview && (
          <IonCard>
            <IonCardHeader>
              <IonText>
                <h3>Experimental selected-read recipients preview</h3>
              </IonText>
              <IonBadge color="warning">Read-only</IonBadge>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                <IonItem>
                  <IonLabel>
                    <h3>Dexie remains authoritative</h3>
                    <p>
                      This preview uses the selected read facade only when
                      manually loaded. It does not replace this management
                      screen or change create, edit, delete, search, or merge
                      actions.
                    </p>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel>Selected-read recipients</IonLabel>
                  <IonButton
                    slot="end"
                    size="small"
                    onClick={() => void loadSelectedReadPreview()}
                    disabled={selectedReadPreviewLoading}
                  >
                    Load preview
                  </IonButton>
                  {selectedReadPreviewLoading && (
                    <IonSpinner name="crescent" slot="end" />
                  )}
                </IonItem>
              </IonList>

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
                      <h3>Recipients</h3>
                      <p>
                        count={selectedReadPreview.count ?? "-"} loaded=
                        {selectedReadPreview.loadedRowCount ?? "-"} sampledIds=
                        {selectedReadPreview.sampledIds?.length
                          ? selectedReadPreview.sampledIds.join(", ")
                          : "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                  {selectedReadPreview.rows.map((recipient) => (
                    <IonItem
                      key={`selected-recipient-${recipient.id ?? "none"}`}
                    >
                      <IonLabel>
                        <h3>recipient id={recipient.id ?? "-"}</h3>
                        <p>
                          isActive=
                          {recipient.isActive === undefined
                            ? "-"
                            : String(recipient.isActive)}{" "}
                          hasAliases={String(recipient.hasAliases)} hasEmail=
                          {String(recipient.hasEmail)} hasPhone=
                          {String(recipient.hasPhone)}
                        </p>
                        <p>
                          hasTillNumber={String(recipient.hasTillNumber)}{" "}
                          hasPaybill={String(recipient.hasPaybill)}{" "}
                          hasAccountNumber=
                          {String(recipient.hasAccountNumber)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
              )}
            </IonCardContent>
          </IonCard>
        )}

        {/* NEW: DUPLICATE NOTIFICATION BANNER */}
        {duplicatePairs.length > 0 && (
          <IonCard
            style={{
              marginBottom: "16px",
              backgroundColor: "#fff5f5",
              borderLeft: "4px solid #eb445c",
            }}
          >
            <IonCardContent>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <IonIcon
                  icon={warningOutline}
                  style={{ color: "#eb445c", fontSize: "1.5rem" }}
                />
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: "0 0 8px 0",
                      fontWeight: "600",
                      fontSize: "0.95rem",
                    }}
                  >
                    {duplicatePairs.length} Duplicate Recipient Pair
                    {duplicatePairs.length !== 1 ? "s" : ""} Found
                  </p>
                  <p
                    style={{
                      margin: "0",
                      fontSize: "0.85rem",
                      color: "#666",
                    }}
                  >
                    You have {duplicatePairs.length} duplicate recipient
                    {duplicatePairs.length !== 1 ? "s" : ""} that can be merged
                    to keep your data clean.
                  </p>
                </div>
                <IonButton
                  onClick={() => setShowMergeModal(true)}
                  size="small"
                  color="danger"
                >
                  Merge Now
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {loading && <IonSpinner />}

        {/* SEARCH & SORT CONTROLS */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--ion-color-medium)",
              borderRadius: "4px",
              backgroundColor: "var(--ion-background-color)",
              paddingRight: "8px",
            }}
          >
            <input
              type="text"
              placeholder="Search recipients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "none",
                backgroundColor: "transparent",
                color: "inherit",
                fontSize: "0.95rem",
                outline: "none",
              }}
            />
            {searchTerm && (
              <IonButton
                fill="clear"
                size="small"
                onClick={() => setSearchTerm("")}
                style={{ margin: "0", padding: "4px" }}
              >
                <IonIcon icon={closeOutline} />
              </IonButton>
            )}
          </div>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as
                  | "usage-high"
                  | "usage-low"
                  | "name-asc"
                  | "name-desc"
              )
            }
            style={{
              padding: "10px 12px",
              border: "1px solid var(--ion-color-medium)",
              borderRadius: "4px",
              backgroundColor: "var(--ion-background-color)",
              color: "inherit",
              fontSize: "0.95rem",
              minWidth: "150px",
            }}
          >
            <option value="usage-high">Usage (High to Low)</option>
            <option value="usage-low">Usage (Low to High)</option>
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
          </select>
        </div>

        {/* RECIPIENTS LIST */}
        <IonCard>
          <IonCardContent>
            {filteredRecipients.length === 0 ? (
              <p>
                {recipients.length === 0
                  ? "No recipients yet. Tap the + button to add one."
                  : "No recipients match your search."}
              </p>
            ) : (
              <IonList>
                {filteredRecipients.map((recipient) => {
                  const isInactive = recipient.isActive === false;

                  return (
                    <IonItem key={recipient.id}>
                      <IonGrid className="ion-no-padding">
                        <IonRow>
                          <IonCol>
                            <strong
                              style={{
                                opacity: isInactive ? 0.6 : 1,
                              }}
                            >
                              {recipient.name}
                            </strong>
                            {(recipient.phone ||
                              recipient.tillNumber ||
                              recipient.paybill ||
                              recipient.accountNumber ||
                              recipient.email) && (
                              <p
                                style={{
                                  fontSize: "0.85rem",
                                  color: "#999",
                                  margin: "2px 0 0 0",
                                  opacity: isInactive ? 0.6 : 1,
                                }}
                              >
                                {[
                                  recipient.phone,
                                  recipient.tillNumber &&
                                    `Till: ${recipient.tillNumber}`,
                                  recipient.paybill &&
                                    `Paybill: ${recipient.paybill}`,
                                  recipient.accountNumber &&
                                    `Acc: ${recipient.accountNumber}`,
                                  recipient.email,
                                ]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </p>
                            )}
                          </IonCol>
                          <IonCol size="auto">
                            <IonButton
                              fill="clear"
                              size="small"
                              onClick={() => handleEditRecipient(recipient)}
                            >
                              <IonIcon icon={createOutline} />
                            </IonButton>

                            <IonButton
                              fill="clear"
                              size="small"
                              title={
                                isInactive
                                  ? "Activate Recipient"
                                  : "Deactivate Recipient"
                              }
                              onClick={() =>
                                handleToggleRecipientActive(recipient)
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
                              onClick={() => initiateDeleteRecipient(recipient)}
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

        {/* ALERT: Deactivated recipient has been used in transactions */}
        <IonAlert
          isOpen={deleteState.type === "used_deactivated"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Cannot Delete Used Recipient"
          message={`This recipient (${
            deleteState.type === "used_deactivated"
              ? deleteState.recipientName
              : ""
          }) has been used in transactions and cannot be deleted. Deactivated recipients will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "OK",
              role: "cancel",
            },
          ]}
        />

        {/* ALERT: Active recipient has been used in transactions (offer to deactivate) */}
        <IonAlert
          isOpen={deleteState.type === "used"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Cannot Delete Used Recipient"
          message={`This recipient (${
            deleteState.type === "used" ? deleteState.recipientName : ""
          }) has been used in transactions and cannot be deleted. Would you like to deactivate it instead? Deactivated recipients will no longer appear in dropdowns but will remain in your records.`}
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
                  handleDeactivateRecipient(deleteState.recipientId);
                }
              },
            },
          ]}
        />

        {/* ALERT: Delete unused recipient */}
        <IonAlert
          isOpen={deleteState.type === "delete"}
          onDidDismiss={() => setDeleteState({ type: "none" })}
          header="Confirm Delete"
          message={`Are you sure you want to delete "${
            deleteState.type === "delete" ? deleteState.recipientName : ""
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
                if (deleteState.type === "delete") {
                  handleDeleteRecipient(deleteState.recipientId);
                }
              },
            },
          ]}
        />

        {/* ALERT: Duplicate Recipient Found */}
        <IonAlert
          isOpen={showDuplicateAlert}
          onDidDismiss={() => {
            setShowDuplicateAlert(false);
            setDuplicateRecipient(null);
          }}
          header="Duplicate Recipient"
          message={`A recipient named "${duplicateRecipient?.name}" already exists with similar contact details. Would you like to edit the existing recipient instead?`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Edit Existing",
              handler: () => {
                if (duplicateRecipient) {
                  handleEditRecipient(duplicateRecipient);
                  setShowDuplicateAlert(false);
                }
              },
            },
          ]}
        />

        {/* MODALS */}
        <AddRecipientModal
          isOpen={showAddRecipientModal}
          onClose={() => {
            setShowAddRecipientModal(false);
            setEditingRecipient(null);
          }}
          onRecipientAdded={handleRecipientSaved}
          editingRecipient={editingRecipient}
          onDuplicateFound={(duplicate) => {
            setDuplicateRecipient(duplicate);
            setShowDuplicateAlert(true);
          }}
          checkForDuplicate={checkForDuplicateRecipient}
        />

        {/* MERGE MODAL */}
        <MergeRecipientsModal
          isOpen={showMergeModal}
          onClose={() => setShowMergeModal(false)}
          duplicatePairs={duplicatePairs}
          recipientCounts={recipientCounts}
          onMergeComplete={() => {
            setShowMergeModal(false);
            setToastMessage("Recipients merged successfully!");
            setShowToast(true);
            fetchRecipients(); // Refresh to remove merged recipients
          }}
        />

        {/* FAB BUTTON FOR ADDING RECIPIENTS */}
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            onClick={() => {
              setEditingRecipient(null);
              setShowAddRecipientModal(true);
            }}
            title="Add Recipient"
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

export default RecipientsManagement;

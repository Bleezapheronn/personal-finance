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
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonIcon,
  IonLabel,
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
  gitMergeOutline,
} from "ionicons/icons";
import {
  AddRecipientModal,
  type RecipientFormValues,
} from "../components/AddRecipientModal";
import { findAllDuplicatePairs } from "../utils/recipientMerge";
import { MergeRecipientsModal } from "../components/MergeRecipientsModal";
import {
  getRepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  activateRecipientInDisposableSqlite,
  createRecipientInDisposableSqlite,
  deactivateRecipientInDisposableSqlite,
  recipientWriteErrorCode,
  updateRecipientInDisposableSqlite,
} from "../repositories/http/recipientWriteExperiment";
import {
  dryRunRecipientDelete,
  dryRunRecipientMerge,
  recipientLifecycleErrorCode,
  writeRecipientDelete,
  writeRecipientMerge,
} from "../repositories/http/recipientDeleteMergeWriteExperiment";
import {
  booleanValue,
  type DevPreviewListResult,
  numberValue,
  previewRows,
  stringValue,
} from "../utils/devPreview";
import type { Recipient } from "../db";

type DeleteState =
  | { type: "none" }
  | { type: "used"; recipientId: number; recipientName: string }
  | { type: "used_deactivated"; recipientId: number; recipientName: string }
  | {
      type: "delete";
      recipientId: number;
      recipientName: string;
      sqlitePlanFingerprint?: string;
    };

const RECIPIENTS_LIST_LIMIT = 500;

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

const selectedReadRowToRecipient = (row: { id?: unknown }): Recipient => {
  const source = row as Record<string, unknown>;

  return {
    id: numberValue(source.id),
    name: stringValue(source.name) ?? "",
    aliases: stringValue(source.aliases),
    email: stringValue(source.email),
    phone: stringValue(source.phone),
    tillNumber: stringValue(source.tillNumber),
    paybill: stringValue(source.paybill),
    accountNumber: stringValue(source.accountNumber),
    description: stringValue(source.description),
    isActive: booleanValue(source.isActive) !== false,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
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

  const selectedBackend = getRepositoryBackend();

  useEffect(() => {
    fetchRecipients();
  }, []);

  const safeRecipientWriteMessage = (code: string): string => {
    void code;
    return "Couldn't save that recipient. Try again.";
  };

  const showSafeRecipientWriteError = (error: unknown): string => {
    const message = safeRecipientWriteMessage(recipientWriteErrorCode(error));
    setToastMessage(message);
    setShowToast(true);
    return message;
  };

  const showSafeRecipientLifecycleError = (error: unknown): void => {
    const code = recipientLifecycleErrorCode(error);
    const message = code === "recipient_lifecycle_plan_stale"
        ? "Recipient references changed after review. Reload and review again."
        : "Couldn't complete that recipient action. Try again.";
    setToastMessage(message);
    setShowToast(true);
  };

  const refreshRecipientLifecycleReads = async (): Promise<void> => {
    await fetchRecipients();
  };

  const handleSqliteRecipientSave = async (
    input: RecipientFormValues,
    currentRecipient?: Recipient | null
  ) => {
    try {
      if (currentRecipient?.id) {
        await updateRecipientInDisposableSqlite(currentRecipient.id, input);
        setToastMessage("Recipient updated successfully!");
      } else {
        await createRecipientInDisposableSqlite(input);
        setToastMessage("Recipient added successfully!");
      }

      setEditingRecipient(null);
      setShowToast(true);
      await fetchRecipients();
    } catch (error) {
      throw new Error(showSafeRecipientWriteError(error));
    }
  };

  /**
   * fetchRecipients - Retrieves all recipients from the database
   */
  const fetchRecipients = async () => {
    try {
      setLoading(true);
      let all: Recipient[];
      const repositories = getSelectedReadRepositories(selectedBackend);
      const result = await repositories.recipients.list({
        limit: RECIPIENTS_LIST_LIMIT,
        offset: 0,
      });
      const rows = previewRows(result as DevPreviewListResult);
      if (!rows) throw new Error("authoritative_recipients_read_unavailable");
      all = rows.map(selectedReadRowToRecipient);
      // Get transactions to count usage
      const reportedCount = await repositories.transactions.count();
      const transactionRows: Array<Record<string, unknown>> = [];
      const pageSize = 500;
      while (transactionRows.length < reportedCount) {
        const page = await repositories.transactions.list({ limit: Math.min(pageSize, reportedCount - transactionRows.length), offset: transactionRows.length });
        const pageRows = previewRows(page as DevPreviewListResult);
        if (!pageRows?.length) break;
        transactionRows.push(...pageRows);
      }
      if (transactionRows.length !== reportedCount) throw new Error("recipients_transaction_usage_read_incomplete");
      const transactionRecipientIds = transactionRows.map((row) => Number(row.recipientId));
      const counts = new Map<number, number>();

      transactionRecipientIds.forEach((recipientId) => {
        const count = counts.get(recipientId) || 0;
        counts.set(recipientId, count + 1);
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
      setDuplicatePairs(findAllDuplicatePairs(sorted));
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

  const handleDeactivateRecipient = async (recipientId: number) => {
    try {
      setLoading(true);
      await deactivateRecipientInDisposableSqlite(recipientId);
      setDeleteState({ type: "none" });
      setToastMessage("Recipient deactivated successfully!");
      setShowToast(true);
      await fetchRecipients();
    } catch (error) {
      showSafeRecipientWriteError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecipient = async (recipientId: number) => {
    if (
      deleteState.type !== "delete" ||
      !deleteState.sqlitePlanFingerprint
    ) {
      setToastMessage("Couldn't complete that recipient action. Try again.");
      setShowToast(true);
      return;
    }
    try {
      setLoading(true);
      await writeRecipientDelete(
        recipientId,
        deleteState.sqlitePlanFingerprint,
      );
      setDeleteState({ type: "none" });
      await refreshRecipientLifecycleReads();
      setToastMessage("Recipient deleted successfully!");
      setShowToast(true);
    } catch (error) {
      showSafeRecipientLifecycleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRecipientActive = async (recipient: Recipient) => {
    if (!recipient.id) return;

    try {
      setLoading(true);
      if (recipient.isActive === false) {
        await activateRecipientInDisposableSqlite(recipient.id);
        setToastMessage("Recipient activated successfully!");
      } else {
        await deactivateRecipientInDisposableSqlite(recipient.id);
        setToastMessage("Recipient deactivated successfully!");
      }
      setShowToast(true);
      await fetchRecipients();
    } catch (error) {
      showSafeRecipientWriteError(error);
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
      const allRecipients = recipients;

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

  const initiateDeleteRecipient = async (recipient: Recipient) => {
    if (!recipient.id) return;
    try {
      setLoading(true);
      const plan = await dryRunRecipientDelete(recipient.id);
      if (!plan.eligible) {
        setDeleteState({
          type: recipient.isActive === false ? "used_deactivated" : "used",
          recipientId: recipient.id,
          recipientName: recipient.name,
        });
        return;
      }
      setDeleteState({
        type: "delete",
        recipientId: recipient.id,
        recipientName: recipient.name,
        sqlitePlanFingerprint: plan.planFingerprint,
      });
    } catch (error) {
      showSafeRecipientLifecycleError(error);
    } finally {
      setLoading(false);
    }
  };

  const mergeSuggestedRecipients = async (
    primaryRecipientId: number,
    secondaryRecipientId: number,
  ): Promise<{ success: boolean; transactionsUpdated: number; error?: string }> => {
    try {
      const plan = await dryRunRecipientMerge(secondaryRecipientId, primaryRecipientId);
      await writeRecipientMerge(secondaryRecipientId, primaryRecipientId, plan.planFingerprint!);
      return { success: true, transactionsUpdated: plan.sourceReferenceCount };
    } catch (error) {
      return { success: false, transactionsUpdated: 0, error: recipientLifecycleErrorCode(error) };
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
                                  onClick={() =>
                                    initiateDeleteRecipient(recipient)
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
            onSaveRecipient={handleSqliteRecipientSave}
            existingRecipients={recipients}
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
            onMerge={mergeSuggestedRecipients}
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

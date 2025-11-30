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
} from "ionicons/icons";
import { db } from "../db";
import { AddRecipientModal } from "../components/AddRecipientModal";
import type { Recipient } from "../db";

const RecipientsManagement: React.FC = () => {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(
    null
  );
  const [showAddRecipientModal, setShowAddRecipientModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [deleteRecipientId, setDeleteRecipientId] = useState<number | null>(
    null
  );
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

  useEffect(() => {
    fetchRecipients();
  }, []);

  /**
   * fetchRecipients - Retrieves all recipients from the database
   */
  const fetchRecipients = async () => {
    try {
      setLoading(true);
      const all = await db.recipients.toArray();

      // Get transactions to count usage
      const transactions = await db.transactions.toArray();
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
   * handleEditRecipient - Opens modal with recipient data
   */
  const handleEditRecipient = (recipient: Recipient) => {
    setEditingRecipient(recipient);
    setShowAddRecipientModal(true);
  };

  /**
   * checkRecipientUsage - Determines if recipient has been used in transactions
   */
  const checkRecipientUsage = async (recipientId: number): Promise<boolean> => {
    try {
      const transactions = await db.transactions.toArray();
      return transactions.some((txn) => txn.recipientId === recipientId);
    } catch (error) {
      console.error("Error checking recipient usage:", error);
      return false;
    }
  };

  /**
   * initiateDeleteRecipient - Check recipient usage and show appropriate alert
   */
  const initiateDeleteRecipient = async (recipient: Recipient) => {
    try {
      setLoading(true);
      const isUsed = await checkRecipientUsage(recipient.id!);

      if (isUsed) {
        // Show deactivation modal
        setDeleteRecipientId(-recipient.id!); // Use negative ID to indicate deactivation mode
      } else {
        // Show simple delete confirmation
        setDeleteRecipientId(recipient.id!);
      }
    } catch (error) {
      console.error("Error checking recipient usage:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeactivateRecipient - Deactivates a recipient instead of deleting
   */
  const handleDeactivateRecipient = async (recipientId: number) => {
    try {
      setLoading(true);
      await db.recipients.update(recipientId, { isActive: false });
      setDeleteRecipientId(null);
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
      setDeleteRecipientId(null);
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
      const allRecipients = await db.recipients.toArray();

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

  // Determine which alert to show
  const showDeactivateAlert = deleteRecipientId! < 0;
  const deleteIdForAlert = Math.abs(deleteRecipientId || 0);
  const recipientForAlert = recipients.find((r) => r.id === deleteIdForAlert);

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

        {/* ALERT: Recipient has been used in transactions */}
        <IonAlert
          isOpen={showDeactivateAlert && deleteRecipientId !== null}
          onDidDismiss={() => setDeleteRecipientId(null)}
          header="Cannot Delete Used Recipient"
          message={`This recipient (${
            recipientForAlert?.name || ""
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
                if (deleteIdForAlert) {
                  handleDeactivateRecipient(deleteIdForAlert);
                }
              },
            },
          ]}
        />

        {/* ALERT: Delete unused recipient */}
        <IonAlert
          isOpen={!showDeactivateAlert && deleteRecipientId !== null}
          onDidDismiss={() => setDeleteRecipientId(null)}
          header="Confirm Delete"
          message={`Are you sure you want to delete "${
            recipientForAlert?.name || ""
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
                if (deleteIdForAlert) {
                  handleDeleteRecipient(deleteIdForAlert);
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

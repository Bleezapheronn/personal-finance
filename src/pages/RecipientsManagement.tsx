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
  IonText,
  IonBadge,
  IonSpinner,
  IonFab,
  IonFabButton,
  IonToast,
  IonModal,
  IonSelect,
  IonSelectOption,
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
import { db } from "../db";
import {
  AddRecipientModal,
  type RecipientFormValues,
} from "../components/AddRecipientModal";
import { findAllDuplicatePairs } from "../utils/recipientMerge";
import { MergeRecipientsModal } from "../components/MergeRecipientsModal";
import { recipientRepository, transactionRepository } from "../repositories";
import {
  getRepositoryBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { SelectedReadPreviewCard } from "../components/dev/SelectedReadPreviewCard";
import {
  activateRecipientInDisposableSqlite,
  createRecipientInDisposableSqlite,
  deactivateRecipientInDisposableSqlite,
  isRecipientsWriteExperimentEnabled,
  recipientWriteErrorCode,
  updateRecipientInDisposableSqlite,
} from "../repositories/http/recipientWriteExperiment";
import {
  dryRunRecipientDelete,
  dryRunRecipientMerge,
  isRecipientDeleteMergeWriteExperimentEnabled,
  recipientLifecycleErrorCode,
  writeRecipientDelete,
  writeRecipientMerge,
  type RecipientLifecycleResponse,
} from "../repositories/http/recipientDeleteMergeWriteExperiment";
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

const SELECTED_READ_PREVIEW_LIMIT = 20;
const RECIPIENTS_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT";
const RECIPIENTS_READ_EXPERIMENT_LIMIT = 500;

const isRecipientsReadExperimentEnabled = (): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[RECIPIENTS_READ_EXPERIMENT_FLAG]?.trim() === "true";
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
  const [showSqliteMergeModal, setShowSqliteMergeModal] = useState(false);
  const [sqliteMergeSource, setSqliteMergeSource] = useState<Recipient | null>(null);
  const [sqliteMergeTargetId, setSqliteMergeTargetId] = useState<number>();
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadRecipientsPreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [recipientsReadExperimentCount, setRecipientsReadExperimentCount] =
    useState<number | undefined>(undefined);

  const selectedBackend = getRepositoryBackend();
  const rehearsal = useSqliteAuthorityRehearsal();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(selectedBackend);
  const recipientsReadExperimentEnabled = isRecipientsReadExperimentEnabled();
  const recipientsWriteExperimentEnabled = isRecipientsWriteExperimentEnabled();
  const recipientDeleteMergeWriteExperimentEnabled =
    isRecipientDeleteMergeWriteExperimentEnabled();
  const recipientsSqliteWriteExperimentActive =
    (recipientsWriteExperimentEnabled && selectedBackend === "http-readonly") ||
    (rehearsalSelected && rehearsal.ready);
  const recipientsHttpSelectedReadActive =
    rehearsalSelected ||
    ((recipientsReadExperimentEnabled || recipientsWriteExperimentEnabled) &&
      selectedBackend === "http-readonly");
  const recipientsHttpReadonlyWithoutWrites =
    recipientsHttpSelectedReadActive && !recipientsSqliteWriteExperimentActive;
  const recipientDeleteMergeWriteExperimentActive =
    rehearsalSelected &&
    rehearsal.ready &&
    rehearsal.recipientDeleteMergeWritesAvailable &&
    recipientDeleteMergeWriteExperimentEnabled;

  useEffect(() => {
    fetchRecipients();
  }, []);

  const safeRecipientWriteMessage = (code: string): string => {
    if (code === "recipient_create_update_writes_disabled") {
      return "Server recipient create/update write flag is off.";
    }

    if (code === "recipient_active_state_writes_disabled") {
      return "Server recipient active-state write flag is off.";
    }

    if (
      code === "local_api_base_url_missing" ||
      code === "local_api_token_missing" ||
      code === "recipient_write_failed" ||
      code === "local_api_request_failed"
    ) {
      return "Local API write failed. Check the local server and write flags.";
    }

    return `Recipient write failed: ${code}`;
  };

  const showSafeRecipientWriteError = (error: unknown): string => {
    const message = safeRecipientWriteMessage(recipientWriteErrorCode(error));
    setToastMessage(message);
    setShowToast(true);
    return message;
  };

  const showSafeRecipientLifecycleError = (error: unknown): void => {
    const code = recipientLifecycleErrorCode(error);
    const message = code === "recipient_delete_merge_writes_disabled"
      ? "Server recipient delete/merge capability is disabled."
      : code === "recipient_lifecycle_plan_stale"
        ? "Recipient references changed after review. Reload and review again."
        : `Recipient lifecycle operation failed: ${code}`;
    setToastMessage(message);
    setShowToast(true);
  };

  const referenceSummary = (plan: RecipientLifecycleResponse): string =>
    `transactions=${plan.referenceCountsByEntity.transactions}, ` +
    `budgets=${plan.referenceCountsByEntity.budgets}, ` +
    `snapshots=${plan.referenceCountsByEntity.budgetSnapshots}`;

  const refreshRecipientLifecycleReads = async (): Promise<void> => {
    const repositories = getSelectedReadRepositories(selectedBackend);
    await Promise.all([
      repositories.recipients.list({ limit: RECIPIENTS_READ_EXPERIMENT_LIMIT, offset: 0 }),
      repositories.transactions.list({ limit: 1, offset: 0 }),
      repositories.budgets.list({ limit: 1, offset: 0 }),
      repositories.budgetSnapshots.list({ limit: 1, offset: 0 }),
    ]);
    await fetchRecipients();
  };

  const handleSqliteRecipientSave = async (
    input: RecipientFormValues,
    currentRecipient?: Recipient | null
  ) => {
    try {
      if (currentRecipient?.id) {
        await updateRecipientInDisposableSqlite(currentRecipient.id, input);
        setToastMessage(rehearsal.authoritativeMode ? "Recipient updated in authoritative SQLite." : "Recipient updated in disposable SQLite.");
      } else {
        await createRecipientInDisposableSqlite(input);
        setToastMessage(rehearsal.authoritativeMode ? "Recipient created in authoritative SQLite." : "Recipient created in disposable SQLite.");
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
      let selectedReadCount: number | undefined;

      if (recipientsHttpSelectedReadActive) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.recipients.list({
          limit: RECIPIENTS_READ_EXPERIMENT_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_recipients_read_experiment_response");
        }

        all = rows.map(selectedReadRowToRecipient);
        selectedReadCount = previewCount(result as DevPreviewListResult);
      } else {
        all = await recipientRepository.listRecipients();
      }

      setRecipientsReadExperimentCount(selectedReadCount);

      // Get transactions to count usage
      let transactionRecipientIds: number[];
      if (recipientsHttpSelectedReadActive) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const reportedCount = await repositories.transactions.count();
        const rows: Array<Record<string, unknown>> = [];
        const pageSize = 500;

        while (rows.length < reportedCount) {
          const result = await repositories.transactions.list({
            limit: Math.min(pageSize, reportedCount - rows.length),
            offset: rows.length,
          });
          const pageRows = previewRows(result as DevPreviewListResult);
          if (!pageRows || pageRows.length === 0) {
            break;
          }
          rows.push(...pageRows);
        }

        if (rows.length !== reportedCount) {
          throw new Error("recipients_transaction_usage_read_incomplete");
        }
        transactionRecipientIds = rows.map((row) => Number(row.recipientId));
      } else {
        transactionRecipientIds = (
          await transactionRepository.listTransactions()
        ).map((transaction) => transaction.recipientId);
      }
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
      setDuplicatePairs(
        recipientsHttpSelectedReadActive ? [] : findAllDuplicatePairs(sorted)
      );
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
    if (recipientsHttpReadonlyWithoutWrites) {
      setToastMessage("Writes are disabled in the recipients read experiment");
      setShowToast(true);
      return;
    }

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
    if (recipientsHttpReadonlyWithoutWrites) {
      setToastMessage("Switch back to Dexie to edit recipients");
      setShowToast(true);
      return;
    }

    setEditingRecipient(recipient);
    setShowAddRecipientModal(true);
    // Removed: detectPotentialDuplicates() call that was showing false alerts
    // The banner notification already shows real duplicates using findAllDuplicatePairs()
  };

  /**
   * handleDeactivateRecipient - Deactivates a recipient instead of deleting
   */
  const handleDeactivateRecipient = async (recipientId: number) => {
    if (recipientsSqliteWriteExperimentActive) {
      try {
        setLoading(true);
        await deactivateRecipientInDisposableSqlite(recipientId);
        setDeleteState({ type: "none" });
        setToastMessage(rehearsal.authoritativeMode ? "Recipient deactivated in authoritative SQLite." : "Recipient deactivated in disposable SQLite.");
        setShowToast(true);
        await fetchRecipients();
      } catch (error) {
        showSafeRecipientWriteError(error);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (recipientsHttpReadonlyWithoutWrites) {
      setToastMessage("Switch back to Dexie to edit recipients");
      setShowToast(true);
      setDeleteState({ type: "none" });
      return;
    }

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
    if (recipientDeleteMergeWriteExperimentActive) {
      if (
        deleteState.type !== "delete" ||
        !deleteState.sqlitePlanFingerprint
      ) {
        setToastMessage("Recipient delete requires a fresh reviewed dry-run.");
        setShowToast(true);
        return;
      }
      let sqliteMutated = false;
      try {
        setLoading(true);
        await writeRecipientDelete(
          recipientId,
          deleteState.sqlitePlanFingerprint,
        );
        sqliteMutated = true;
        setDeleteState({ type: "none" });
        await refreshRecipientLifecycleReads();
        setToastMessage(
          rehearsal.authoritativeMode
            ? "Recipient deleted from authoritative SQLite. Rotate the checkpoint before restart."
            : "Unused recipient deleted from disposable SQLite.",
        );
        setShowToast(true);
      } catch (error) {
        if (sqliteMutated) {
          setToastMessage(
            "SQLite may have changed, but selected-read refresh failed. Reload before retrying.",
          );
          setShowToast(true);
        } else {
          showSafeRecipientLifecycleError(error);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (recipientsHttpSelectedReadActive) {
      setToastMessage("Delete is not available in the recipients SQLite write experiment");
      setShowToast(true);
      setDeleteState({ type: "none" });
      return;
    }

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
    if (recipientsSqliteWriteExperimentActive) {
      if (!recipient.id) {
        setToastMessage("Recipient write failed: recipient_id_missing");
        setShowToast(true);
        return;
      }

      try {
        setLoading(true);
        if (recipient.isActive === false) {
          await activateRecipientInDisposableSqlite(recipient.id);
          setToastMessage(rehearsal.authoritativeMode ? "Recipient activated in authoritative SQLite." : "Recipient activated in disposable SQLite.");
        } else {
          await deactivateRecipientInDisposableSqlite(recipient.id);
          setToastMessage(rehearsal.authoritativeMode ? "Recipient deactivated in authoritative SQLite." : "Recipient deactivated in disposable SQLite.");
        }
        setShowToast(true);
        await fetchRecipients();
      } catch (error) {
        showSafeRecipientWriteError(error);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (recipientsHttpReadonlyWithoutWrites) {
      setToastMessage("Switch back to Dexie to edit recipients");
      setShowToast(true);
      return;
    }

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
    if (recipientsHttpSelectedReadActive) {
      return null;
    }

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
      const rows = previewRows(result as DevPreviewListResult);

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
        errorCode: safePreviewErrorCode(
          error,
          "selected_read_recipients_preview_failed",
        ),
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
    if (recipientDeleteMergeWriteExperimentActive) {
      if (!recipient.id) {
        setToastMessage("Recipient lifecycle operation failed: recipient_id_missing");
        setShowToast(true);
        return;
      }
      try {
        setLoading(true);
        const plan = await dryRunRecipientDelete(recipient.id);
        if (!plan.eligible) {
          setToastMessage(
            `Recipient is referenced (${referenceSummary(plan)}). Merge it instead of deleting it.`,
          );
          setShowToast(true);
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
      return;
    }

    if (recipientsHttpSelectedReadActive) {
      setToastMessage("Delete is not available in the recipients SQLite write experiment");
      setShowToast(true);
      return;
    }

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

  const openSqliteMerge = (source: Recipient) => {
    setSqliteMergeSource(source);
    setSqliteMergeTargetId(undefined);
    setShowSqliteMergeModal(true);
  };

  const handleSqliteMerge = async () => {
    if (!sqliteMergeSource?.id || !sqliteMergeTargetId) {
      setToastMessage("Choose a distinct target recipient before reviewing the merge.");
      setShowToast(true);
      return;
    }
    let sqliteMutated = false;
    try {
      setLoading(true);
      const plan = await dryRunRecipientMerge(
        sqliteMergeSource.id,
        sqliteMergeTargetId,
      );
      const confirmed = window.confirm(
        `Merge this source recipient into the selected target?\n\n` +
          `References to move: ${plan.sourceReferenceCount}\n` +
          `${referenceSummary(plan)}\n\n` +
          "The source will be permanently removed. The target record will remain unchanged.",
      );
      if (!confirmed) return;
      await writeRecipientMerge(
        sqliteMergeSource.id,
        sqliteMergeTargetId,
        plan.planFingerprint!,
      );
      sqliteMutated = true;
      setShowSqliteMergeModal(false);
      setSqliteMergeSource(null);
      setSqliteMergeTargetId(undefined);
      await refreshRecipientLifecycleReads();
      setToastMessage(
        rehearsal.authoritativeMode
          ? "Recipient merged in authoritative SQLite. Rotate the checkpoint before restart."
          : "Recipient merged in disposable SQLite.",
      );
      setShowToast(true);
    } catch (error) {
      if (sqliteMutated) {
        setToastMessage(
          "SQLite may have changed, but selected-read refresh failed. Reload before retrying.",
        );
        setShowToast(true);
      } else {
        showSafeRecipientLifecycleError(error);
      }
    } finally {
      setLoading(false);
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
          <SelectedReadPreviewCard
            title="Experimental selected-read recipients preview"
            resourceLabel="Selected-read recipients"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description={
              recipientsSqliteWriteExperimentActive
                ? "This preview uses the selected read facade only when manually loaded. The active write experiment is separate and still does not enable delete or merge."
                : "This preview uses the selected read facade only when manually loaded. It does not replace this management screen or change create, edit, delete, search, or merge actions."
            }
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
          </SelectedReadPreviewCard>
        )}

        {(recipientsReadExperimentEnabled ||
          recipientsWriteExperimentEnabled ||
          recipientDeleteMergeWriteExperimentEnabled) && (
          <IonCard
            style={{
              marginBottom: "16px",
              borderLeft: recipientsHttpSelectedReadActive
                ? "4px solid var(--ion-color-warning)"
                : "4px solid var(--ion-color-medium)",
            }}
          >
            <IonCardContent>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <IonIcon
                  icon={warningOutline}
                  style={{
                    color: recipientsHttpSelectedReadActive
                      ? "var(--ion-color-warning)"
                      : "var(--ion-color-medium)",
                    fontSize: "1.5rem",
                  }}
                />
                <div>
                  <p
                    style={{
                      margin: "0 0 6px 0",
                      fontWeight: 600,
                    }}
                  >
                    {recipientsSqliteWriteExperimentActive
                      ? rehearsal.authoritativeMode
                        ? recipientDeleteMergeWriteExperimentActive
                          ? "SQLite authoritative mode is active. Recipient delete and merge use dry-run-first exact-reference lifecycle writes."
                          : "SQLite authoritative mode is active. Recipient create/update/active-state writes remain available; delete and merge require their separate capability and frontend flag."
                        : "Recipients SQLite write experiment is active. Writes go to disposable local SQLite only. Dexie remains authoritative. Re-import SQLite from backup before clean parity checks."
                      : recipientsHttpReadonlyWithoutWrites
                        ? "Recipients read experiment is active. List is loaded through selected-read `http-readonly`; writes are disabled. Switch back to Dexie or enable the dev write experiment to edit."
                        : "Recipients experiment flag is active with the Dexie backend. Existing Dexie write behavior remains available."}
                  </p>
                  <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
                    Backend: {selectedBackend}
                    {recipientsHttpSelectedReadActive &&
                      recipientsReadExperimentCount !== undefined &&
                      recipientsReadExperimentCount > recipients.length &&
                      `; loaded first ${recipients.length} of ${recipientsReadExperimentCount} recipients for this experiment.`}
                    {recipientsSqliteWriteExperimentActive &&
                      (recipientDeleteMergeWriteExperimentActive
                        ? " Delete is unused-only; merge moves exact stored IDs and preserves the target."
                        : " Delete and merge remain unavailable.")}
                  </p>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {/* NEW: DUPLICATE NOTIFICATION BANNER */}
        {!recipientsHttpSelectedReadActive && duplicatePairs.length > 0 && (
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
                  ? recipientsHttpSelectedReadActive
                    ? "No recipients loaded from the read-only experiment."
                    : "No recipients yet. Tap the + button to add one."
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
                          {(!recipientsHttpSelectedReadActive ||
                            recipientsSqliteWriteExperimentActive) && (
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

                              {(!recipientsHttpSelectedReadActive ||
                                recipientDeleteMergeWriteExperimentActive) && (
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
                              )}
                              {recipientDeleteMergeWriteExperimentActive && (
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  color="warning"
                                  title="Merge Recipient"
                                  onClick={() => openSqliteMerge(recipient)}
                                >
                                  <IonIcon icon={gitMergeOutline} />
                                </IonButton>
                              )}
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
          message={recipientDeleteMergeWriteExperimentActive
            ? `The dry-run confirmed that "${
                deleteState.type === "delete" ? deleteState.recipientName : ""
              }" has no supported references. Delete it from SQLite? Rotate the authority checkpoint before restart.`
            : `Are you sure you want to delete "${
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
        {(!recipientsHttpSelectedReadActive ||
          recipientsSqliteWriteExperimentActive) && (
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
            onSaveRecipient={
              recipientsSqliteWriteExperimentActive
                ? handleSqliteRecipientSave
                : undefined
            }
          />
        )}

        <IonModal
          isOpen={showSqliteMergeModal}
          onDidDismiss={() => {
            setShowSqliteMergeModal(false);
            setSqliteMergeSource(null);
            setSqliteMergeTargetId(undefined);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Merge Recipient</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowSqliteMergeModal(false)}>
                  Close
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonCard color="warning">
              <IonCardContent>
                <IonText>
                  <h3>SQLite-only dry-run-first merge</h3>
                  <p>
                    The selected source will be permanently removed. Exact
                    Transaction, Budget, and Budget Snapshot recipient IDs move
                    to the target; the target record remains unchanged.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>
            <IonItem>
              <IonLabel position="stacked">Source</IonLabel>
              <p>{sqliteMergeSource?.name ?? "-"}</p>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Target Recipient</IonLabel>
              <IonSelect
                value={sqliteMergeTargetId}
                placeholder="Choose target"
                onIonChange={(event) =>
                  setSqliteMergeTargetId(Number(event.detail.value))
                }
              >
                {recipients
                  .filter((recipient) => recipient.id !== sqliteMergeSource?.id)
                  .map((recipient) => (
                    <IonSelectOption key={recipient.id} value={recipient.id}>
                      {recipient.name}
                    </IonSelectOption>
                  ))}
              </IonSelect>
            </IonItem>
            <IonButton
              expand="block"
              color="danger"
              disabled={!sqliteMergeTargetId || loading}
              onClick={handleSqliteMerge}
              style={{ marginTop: "16px" }}
            >
              Review and Merge
            </IonButton>
          </IonContent>
        </IonModal>

        {/* MERGE MODAL */}
        {!recipientsHttpSelectedReadActive && (
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
        )}

        {/* FAB BUTTON FOR ADDING RECIPIENTS */}
        {(!recipientsHttpSelectedReadActive ||
          recipientsSqliteWriteExperimentActive) && (
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

export default RecipientsManagement;

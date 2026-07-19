import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonList,
  IonItem,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  useIonViewWillEnter,
  IonModal,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonCard,
  IonCardContent,
  IonLabel,
  IonBadge,
  IonFab,
  IonFabButton,
  IonToast,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  close,
  checkmarkCircleOutline,
  closeCircleOutline,
  warningOutline,
} from "ionicons/icons";
import { db, SmsImportTemplate, Account } from "../db";
import {
  accountRepository,
  smsImportTemplateRepository,
} from "../repositories";
import {
  getRepositoryBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  activateSmsTemplateInDisposableSqlite,
  createSmsTemplateInDisposableSqlite,
  deactivateSmsTemplateInDisposableSqlite,
  deleteSmsTemplateFromDisposableSqlite,
  isSmsTemplatesWriteExperimentEnabled,
  smsTemplateWriteErrorCode,
  type SmsTemplateWriteInput,
  updateSmsTemplateInDisposableSqlite,
} from "../repositories/http/smsTemplateWriteExperiment";
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

type LocalAccount = Account & { previewUrl?: string };

interface SelectedReadSmsTemplatePreviewRow {
  id?: number;
  isActive?: boolean | null;
  accountId?: number;
  paymentMethodId?: number;
  hasReferencePattern: boolean;
  hasAmountPattern: boolean;
  hasRecipientNamePattern: boolean;
  hasRecipientPhonePattern: boolean;
  hasDateTimePattern: boolean;
  hasCostPattern: boolean;
  hasIncomePattern: boolean;
  hasExpensePattern: boolean;
}

interface SelectedReadSmsTemplatePreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  rows: SelectedReadSmsTemplatePreviewRow[];
  errorCode?: string;
}

const SELECTED_READ_PREVIEW_LIMIT = 20;
const SMS_TEMPLATES_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_SMS_TEMPLATES_READ_EXPERIMENT";
const SMS_TEMPLATES_READ_EXPERIMENT_LIMIT = 500;

const isSmsTemplatesReadExperimentEnabled = (): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[SMS_TEMPLATES_READ_EXPERIMENT_FLAG]?.trim() === "true";
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

const selectedReadRowToSmsTemplate = (row: {
  id?: unknown;
}): SmsImportTemplate => {
  const source = row as Record<string, unknown>;

  return {
    id: numberValue(source.id),
    name: stringValue(source.name) ?? "",
    description: stringValue(source.description),
    paymentMethodId: numberValue(source.paymentMethodId),
    accountId: numberValue(source.accountId),
    referencePattern: stringValue(source.referencePattern),
    amountPattern: stringValue(source.amountPattern),
    recipientNamePattern: stringValue(source.recipientNamePattern),
    recipientPhonePattern: stringValue(source.recipientPhonePattern),
    dateTimePattern: stringValue(source.dateTimePattern),
    costPattern: stringValue(source.costPattern),
    incomePattern: stringValue(source.incomePattern),
    expensePattern: stringValue(source.expensePattern),
    isActive: booleanValue(source.isActive) !== false,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const compareSmsTemplatesByExistingDisplayOrder = (
  left: SmsImportTemplate,
  right: SmsImportTemplate,
): number =>
  (left.id ?? Number.MAX_SAFE_INTEGER) -
  (right.id ?? Number.MAX_SAFE_INTEGER);

const SmsImportTemplatesManagement: React.FC = () => {
  const [templates, setTemplates] = useState<SmsImportTemplate[]>([]);
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Track blob URLs for cleanup
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Modal state
  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<SmsImportTemplate | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAccountId, setFormAccountId] = useState<number | undefined>(
    undefined
  );
  const [formReferencePattern, setFormReferencePattern] = useState("");
  const [formAmountPattern, setFormAmountPattern] = useState("");
  const [formRecipientNamePattern, setFormRecipientNamePattern] = useState("");
  const [formRecipientPhonePattern, setFormRecipientPhonePattern] =
    useState("");
  const [formDateTimePattern, setFormDateTimePattern] = useState("");
  const [formCostPattern, setFormCostPattern] = useState("");
  const [formIncomePattern, setFormIncomePattern] = useState("");
  const [formExpensePattern, setFormExpensePattern] = useState("");
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [deleteTemplateId, setDeleteTemplateId] = useState<number | null>(null);

  // Toast
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadSmsTemplatePreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [smsTemplatesReadExperimentCount, setSmsTemplatesReadExperimentCount] =
    useState<number | undefined>(undefined);

  const selectedBackend = getRepositoryBackend();
  const smsTemplatesReadExperimentEnabled =
    isSmsTemplatesReadExperimentEnabled();
  const smsTemplatesWriteExperimentEnabled =
    isSmsTemplatesWriteExperimentEnabled();
  const smsTemplatesSqliteWriteExperimentActive =
    smsTemplatesWriteExperimentEnabled && selectedBackend === "http-readonly";
  const smsTemplatesReadExperimentHttpReadonly =
    (smsTemplatesReadExperimentEnabled || smsTemplatesWriteExperimentEnabled) &&
    selectedBackend === "http-readonly";
  const smsTemplatesHttpReadonlyWithoutWrites =
    smsTemplatesReadExperimentHttpReadonly &&
    !smsTemplatesSqliteWriteExperimentActive;

  const showReadExperimentActionDisabledToast = () => {
    setToastMessage(
      "Enable the SMS template write experiment or switch back to Dexie",
    );
    setShowToast(true);
  };

  useEffect(() => {
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

  const fetchData = async (): Promise<boolean> => {
    setLoading(true);
    try {
      // Revoke old blob URLs before fetching new ones
      blobUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrlsRef.current.clear();

      let temps: SmsImportTemplate[];
      let selectedReadCount: number | undefined;
      const accsPromise = accountRepository.listAccounts();

      if (smsTemplatesReadExperimentHttpReadonly) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.smsImportTemplates.list({
          limit: SMS_TEMPLATES_READ_EXPERIMENT_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_sms_templates_read_experiment_response");
        }

        temps = rows
          .map(selectedReadRowToSmsTemplate)
          .sort(compareSmsTemplatesByExistingDisplayOrder);
        selectedReadCount = previewCount(result as DevPreviewListResult);
      } else {
        temps = await smsImportTemplateRepository.listTemplates();
      }

      const accs = await accsPromise;

      // Convert accounts to include preview URLs
      const accountsWithPreview: LocalAccount[] = accs.map((a) => {
        let preview: string | undefined;
        if (a.imageBlob) {
          preview = URL.createObjectURL(a.imageBlob);
          blobUrlsRef.current.add(preview);
        }
        return { ...a, previewUrl: preview };
      });

      setTemplates(temps);
      setSmsTemplatesReadExperimentCount(selectedReadCount);
      setAccounts(accountsWithPreview);
      return true;
    } catch (err) {
      console.error("Failed to load SMS import templates:", err);
      setToastMessage("Failed to load SMS import templates");
      setShowToast(true);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useIonViewWillEnter(() => {
    fetchData();
  });

  /**
   * resetForm - Clears all form fields
   */
  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormAccountId(undefined); // CHANGED
    setFormReferencePattern("");
    setFormAmountPattern("");
    setFormRecipientNamePattern("");
    setFormRecipientPhonePattern("");
    setFormDateTimePattern("");
    setFormCostPattern("");
    setFormIncomePattern("");
    setFormExpensePattern("");
    setFormError("");
    setEditingTemplate(null);
  }, []);

  /**
   * handleEditTemplate - Opens modal with template data
   */
  const handleEditTemplate = (template: SmsImportTemplate) => {
    if (smsTemplatesHttpReadonlyWithoutWrites) {
      showReadExperimentActionDisabledToast();
      return;
    }

    setEditingTemplate(template);
    setFormName(template.name);
    setFormDescription(template.description || "");
    setFormAccountId(template.accountId); // CHANGED
    setFormReferencePattern(template.referencePattern || "");
    setFormAmountPattern(template.amountPattern || "");
    setFormRecipientNamePattern(template.recipientNamePattern || "");
    setFormRecipientPhonePattern(template.recipientPhonePattern || "");
    setFormDateTimePattern(template.dateTimePattern || "");
    setFormCostPattern(template.costPattern || "");
    setFormIncomePattern(template.incomePattern || "");
    setFormExpensePattern(template.expensePattern || "");
    setFormError("");
    setShowAddTemplateModal(true);
  };

  /**
   * handleSave - Saves or updates template
   */
  const handleSave = async () => {
    if (smsTemplatesHttpReadonlyWithoutWrites) {
      showReadExperimentActionDisabledToast();
      return;
    }

    setFormError("");

    if (!formName.trim()) {
      setFormError("Template name is required");
      return;
    }

    try {
      setLoading(true);
      const input: SmsTemplateWriteInput = {
        name: formName,
        description: formDescription,
        accountId: formAccountId,
        referencePattern: formReferencePattern,
        amountPattern: formAmountPattern,
        recipientNamePattern: formRecipientNamePattern,
        recipientPhonePattern: formRecipientPhonePattern,
        dateTimePattern: formDateTimePattern,
        costPattern: formCostPattern,
        incomePattern: formIncomePattern,
        expensePattern: formExpensePattern,
      };

      if (smsTemplatesSqliteWriteExperimentActive) {
        if (editingTemplate?.id) {
          await updateSmsTemplateInDisposableSqlite(editingTemplate.id, input);
          setToastMessage("Template updated in disposable SQLite");
        } else {
          await createSmsTemplateInDisposableSqlite(input);
          setToastMessage("Template created in disposable SQLite");
        }
      } else if (editingTemplate?.id) {
        const now = new Date();
        // UPDATE MODE
        await db.smsImportTemplates.update(editingTemplate.id, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          accountId: formAccountId, // CHANGED
          referencePattern: formReferencePattern.trim() || undefined,
          amountPattern: formAmountPattern.trim() || undefined,
          recipientNamePattern: formRecipientNamePattern.trim() || undefined,
          recipientPhonePattern: formRecipientPhonePattern.trim() || undefined,
          dateTimePattern: formDateTimePattern.trim() || undefined,
          costPattern: formCostPattern.trim() || undefined,
          incomePattern: formIncomePattern.trim() || undefined,
          expensePattern: formExpensePattern.trim() || undefined,
          updatedAt: now,
        } as Partial<SmsImportTemplate>);
        setToastMessage("Template updated successfully!");
      } else {
        const now = new Date();
        // ADD MODE
        const newTemplate: Omit<SmsImportTemplate, "id"> = {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          accountId: formAccountId, // CHANGED
          referencePattern: formReferencePattern.trim() || undefined,
          amountPattern: formAmountPattern.trim() || undefined,
          recipientNamePattern: formRecipientNamePattern.trim() || undefined,
          recipientPhonePattern: formRecipientPhonePattern.trim() || undefined,
          dateTimePattern: formDateTimePattern.trim() || undefined,
          costPattern: formCostPattern.trim() || undefined,
          incomePattern: formIncomePattern.trim() || undefined,
          expensePattern: formExpensePattern.trim() || undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        await db.smsImportTemplates.add(newTemplate);
        setToastMessage("Template added successfully!");
      }

      setShowToast(true);
      resetForm();
      setShowAddTemplateModal(false);
      const refreshed = await fetchData();
      if (!refreshed && smsTemplatesSqliteWriteExperimentActive) {
        setToastMessage(
          "SQLite changed, but refresh failed. Reload before retrying.",
        );
      }
    } catch (err) {
      const code = smsTemplatesSqliteWriteExperimentActive
        ? smsTemplateWriteErrorCode(err)
        : "sms_template_save_failed";
      setFormError(`Failed to save template: ${code}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleToggleTemplateActive - Toggles template active/inactive status
   */
  const handleToggleTemplateActive = async (template: SmsImportTemplate) => {
    if (smsTemplatesHttpReadonlyWithoutWrites) {
      showReadExperimentActionDisabledToast();
      return;
    }

    try {
      setLoading(true);
      const newStatus = template.isActive ? false : true;
      if (smsTemplatesSqliteWriteExperimentActive) {
        if (newStatus) {
          await activateSmsTemplateInDisposableSqlite(template.id!);
        } else {
          await deactivateSmsTemplateInDisposableSqlite(template.id!);
        }
      } else {
        await db.smsImportTemplates.update(template.id!, {
          isActive: newStatus,
          updatedAt: new Date(),
        } as Partial<SmsImportTemplate>);
      }
      const refreshed = await fetchData();
      if (!refreshed && smsTemplatesSqliteWriteExperimentActive) {
        setToastMessage(
          "SQLite changed, but refresh failed. Reload before retrying.",
        );
        setShowToast(true);
      }
    } catch (error) {
      console.error("Error toggling template status:", error);
      setToastMessage("Failed to update template status");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleDeleteTemplate - Removes template from database
   */
  const handleDeleteTemplate = async (templateId: number) => {
    if (smsTemplatesHttpReadonlyWithoutWrites) {
      showReadExperimentActionDisabledToast();
      setDeleteTemplateId(null);
      return;
    }

    try {
      setLoading(true);
      if (smsTemplatesSqliteWriteExperimentActive) {
        await deleteSmsTemplateFromDisposableSqlite(templateId);
      } else {
        await db.smsImportTemplates.delete(templateId);
      }
      setDeleteTemplateId(null);
      setToastMessage("Template deleted successfully!");
      setShowToast(true);
      const refreshed = await fetchData();
      if (!refreshed && smsTemplatesSqliteWriteExperimentActive) {
        setToastMessage(
          "SQLite changed, but refresh failed. Reload before retrying.",
        );
      }
    } catch (error) {
      console.error("Error deleting template:", error);
      setToastMessage("Failed to delete template");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseModal = () => {
    resetForm();
    setShowAddTemplateModal(false);
  };

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const result = await repositories.smsImportTemplates.list({
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
          errorCode: "invalid_selected_read_sms_templates_preview_response",
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
          accountId: numberValue((row as { accountId?: unknown }).accountId),
          paymentMethodId: numberValue(
            (row as { paymentMethodId?: unknown }).paymentMethodId,
          ),
          hasReferencePattern: hasValue(
            (row as { referencePattern?: unknown }).referencePattern,
          ),
          hasAmountPattern: hasValue(
            (row as { amountPattern?: unknown }).amountPattern,
          ),
          hasRecipientNamePattern: hasValue(
            (row as { recipientNamePattern?: unknown }).recipientNamePattern,
          ),
          hasRecipientPhonePattern: hasValue(
            (row as { recipientPhonePattern?: unknown }).recipientPhonePattern,
          ),
          hasDateTimePattern: hasValue(
            (row as { dateTimePattern?: unknown }).dateTimePattern,
          ),
          hasCostPattern: hasValue(
            (row as { costPattern?: unknown }).costPattern,
          ),
          hasIncomePattern: hasValue(
            (row as { incomePattern?: unknown }).incomePattern,
          ),
          hasExpensePattern: hasValue(
            (row as { expensePattern?: unknown }).expensePattern,
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
          "selected_read_sms_templates_preview_failed",
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
          <IonTitle>SMS Import Templates</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {showSelectedReadPreview && (
          <SelectedReadPreviewCard
            resourceLabel="Selected-read SMS import templates"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description="This preview uses the selected read facade only when manually loaded. It does not replace this management screen or change create, edit, delete, or import behavior."
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
                      <h3>SMS import templates</h3>
                      <p>
                        count={selectedReadPreview.count ?? "-"} loaded=
                        {selectedReadPreview.loadedRowCount ?? "-"} sampledIds=
                        {selectedReadPreview.sampledIds?.length
                          ? selectedReadPreview.sampledIds.join(", ")
                          : "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                  {selectedReadPreview.rows.map((template) => (
                    <IonItem
                      key={`selected-sms-template-${template.id ?? "none"}`}
                    >
                      <IonLabel>
                        <h3>template id={template.id ?? "-"}</h3>
                        <p>
                          isActive=
                          {template.isActive === undefined
                            ? "-"
                            : String(template.isActive)}{" "}
                          accountId={template.accountId ?? "-"}{" "}
                          paymentMethodId={template.paymentMethodId ?? "-"}
                        </p>
                        <p>
                          hasReferencePattern=
                          {String(template.hasReferencePattern)}{" "}
                          hasAmountPattern={String(template.hasAmountPattern)}{" "}
                          hasDateTimePattern=
                          {String(template.hasDateTimePattern)}
                        </p>
                        <p>
                          hasRecipientNamePattern=
                          {String(template.hasRecipientNamePattern)}{" "}
                          hasRecipientPhonePattern=
                          {String(template.hasRecipientPhonePattern)}
                        </p>
                        <p>
                          hasCostPattern={String(template.hasCostPattern)}{" "}
                          hasIncomePattern={String(template.hasIncomePattern)}{" "}
                          hasExpensePattern=
                          {String(template.hasExpensePattern)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
              )}
          </SelectedReadPreviewCard>
        )}

        {(smsTemplatesReadExperimentEnabled ||
          smsTemplatesWriteExperimentEnabled) && (
          <IonCard>
            <IonCardContent>
              <IonText
                color={
                  smsTemplatesReadExperimentHttpReadonly ? "warning" : "medium"
                }
              >
                <p>
                  <IonIcon icon={warningOutline} />{" "}
                  {smsTemplatesSqliteWriteExperimentActive
                    ? "SMS Import Templates SQLite write experiment is active. Writes go to disposable local SQLite only. Dexie remains authoritative. Saving templates does not import or modify transactions."
                    : smsTemplatesReadExperimentHttpReadonly
                    ? "SMS Templates read experiment is active. List is loaded through selected-read `http-readonly`; writes, imports, and test-parse actions are disabled. Switch back to Dexie to edit."
                    : "SMS Templates read experiment flag is active with the Dexie backend. Existing Dexie write, import, and test-parse behavior remains available."}
                </p>
                {smsTemplatesSqliteWriteExperimentActive && (
                  <p>
                    Create, update, activate, deactivate, and delete are
                    available. Each operation runs a dry-run first. No parser,
                    SMS import, transaction, Account, or Recipient mutation is
                    performed.
                  </p>
                )}
                {smsTemplatesHttpReadonlyWithoutWrites && (
                  <p>
                    This is a list-only experiment. Regex and pattern values are
                    not shown unless you switch back to Dexie and open the edit
                    workflow.
                  </p>
                )}
                {smsTemplatesReadExperimentHttpReadonly &&
                  smsTemplatesReadExperimentCount !== undefined &&
                  smsTemplatesReadExperimentCount > templates.length && (
                    <p>
                      Showing {templates.length} of{" "}
                      {smsTemplatesReadExperimentCount} SMS templates from the
                      bounded selected-read page.
                    </p>
                  )}
              </IonText>
            </IonCardContent>
          </IonCard>
        )}

        {loading && <IonSpinner />}

        {/* TEMPLATES LIST */}
        <IonCard>
          <IonCardContent>
            {templates.length === 0 ? (
              <p>
                {smsTemplatesReadExperimentHttpReadonly
                  ? "No SMS import templates were loaded by the read experiment."
                  : "No SMS import templates yet. Tap the + button to add one."}
              </p>
            ) : (
              <IonList>
                {templates.map((template) => {
                  const isInactive = !template.isActive;
                  const account = accounts.find(
                    (a) => a.id === template.accountId
                  ); // CHANGED

                  return (
                    <IonItem key={template.id}>
                      <IonGrid className="ion-no-padding">
                        <IonRow>
                          {/* ACCOUNT AVATAR */}
                          <IonCol size="auto">
                            {account?.previewUrl ? (
                              <img
                                src={account.previewUrl}
                                alt={account.name}
                                title={account.name}
                                style={{
                                  width: 40,
                                  height: 40,
                                  objectFit: "cover",
                                  opacity: isInactive ? 0.6 : 1,
                                  marginRight: 8,
                                }}
                              />
                            ) : (
                              <div
                                title={account?.name || "All Accounts"}
                                style={{
                                  width: 40,
                                  height: 40,
                                  backgroundColor:
                                    "var(--ion-color-medium-shade)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "white",
                                  fontWeight: "bold",
                                  fontSize: "1.2rem",
                                  opacity: isInactive ? 0.6 : 1,
                                  marginRight: 8,
                                }}
                              >
                                {account?.name?.charAt(0).toUpperCase() || "*"}
                              </div>
                            )}
                          </IonCol>

                          {/* TEMPLATE INFO */}
                          <IonCol>
                            <strong
                              style={{
                                opacity: isInactive ? 0.6 : 1,
                              }}
                            >
                              {template.name}
                            </strong>
                            <p
                              style={{
                                fontSize: "0.85rem",
                                color: "#999",
                                margin: "4px 0 0 0",
                                opacity: isInactive ? 0.6 : 1,
                              }}
                            >
                              <strong>Account:</strong>{" "}
                              {account?.name || "All Accounts"}
                            </p>
                          </IonCol>

                          {/* ACTION BUTTONS */}
                          {(!smsTemplatesReadExperimentHttpReadonly ||
                            smsTemplatesSqliteWriteExperimentActive) && (
                            <IonCol size="auto">
                              <IonButton
                                fill="clear"
                                size="small"
                                onClick={() => handleEditTemplate(template)}
                              >
                                <IonIcon icon={createOutline} />
                              </IonButton>

                              <IonButton
                                fill="clear"
                                size="small"
                                title={
                                  isInactive
                                    ? "Activate template"
                                    : "Deactivate template"
                                }
                                onClick={() =>
                                  handleToggleTemplateActive(template)
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
                                  setDeleteTemplateId(template.id ?? null)
                                }
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

        {/* ALERT: Delete template confirmation */}
        <IonAlert
          isOpen={
            deleteTemplateId !== null &&
            (!smsTemplatesReadExperimentHttpReadonly ||
              smsTemplatesSqliteWriteExperimentActive)
          }
          onDidDismiss={() => setDeleteTemplateId(null)}
          header="Delete Template"
          message="Are you sure you want to delete this SMS import template?"
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteTemplateId) {
                  handleDeleteTemplate(deleteTemplateId);
                }
              },
            },
          ]}
        />

        {/* MODAL: Add/Edit Template */}
        <IonModal
          isOpen={
            showAddTemplateModal &&
            (!smsTemplatesReadExperimentHttpReadonly ||
              smsTemplatesSqliteWriteExperimentActive)
          }
          onDidDismiss={handleCloseModal}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>
                {editingTemplate ? "Edit Template" : "Add Template"}
              </IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={handleCloseModal}>
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            {formError && (
              <IonText
                color="danger"
                style={{ display: "block", marginBottom: "16px" }}
              >
                {formError}
              </IonText>
            )}

            <IonGrid>
              <IonRow>
                <IonCol>
                  <div className="form-input-wrapper">
                    <label className="form-label">Template Name</label>
                    <input
                      type="text"
                      placeholder="e.g., M-PESA Standard"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
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

              <IonRow>
                <IonCol>
                  <div className="form-input-wrapper">
                    <label className="form-label">Description (optional)</label>
                    <textarea
                      placeholder="Template description"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      disabled={loading}
                      rows={2}
                      style={{
                        padding: "12px",
                        border: "1px solid var(--ion-color-medium)",
                        borderRadius: "4px",
                        backgroundColor: "var(--ion-background-color)",
                        color: "inherit",
                        fontSize: "0.95rem",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <div className="form-input-wrapper">
                    <label className="form-label">Account (optional)</label>
                    <select
                      value={formAccountId ?? ""}
                      onChange={(e) =>
                        setFormAccountId(parseInt(e.target.value) || undefined)
                      }
                      disabled={loading}
                      style={{
                        padding: "12px",
                        border: "1px solid var(--ion-color-medium)",
                        borderRadius: "4px",
                        backgroundColor: "var(--ion-background-color)",
                        color: "inherit",
                        fontSize: "0.95rem",
                      }}
                    >
                      <option value="">All Accounts</option>
                      {accounts
                        .filter((a) => a.name)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <h4 style={{ margin: "16px 0 8px 0" }}>Regex Patterns</h4>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--ion-color-medium)",
                      margin: "0 0 12px 0",
                    }}
                  >
                    Define regex patterns to extract transaction details from
                    SMS messages.
                  </p>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Reference Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., ^([A-Z0-9]{10})"
                      value={formReferencePattern}
                      onChange={(e) => setFormReferencePattern(e.target.value)}
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
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Amount Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., Ksh([\d,]+\.?\d*)"
                      value={formAmountPattern}
                      onChange={(e) => setFormAmountPattern(e.target.value)}
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

              <IonRow>
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Recipient Name Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., sent to\s+([A-Z\s]+)"
                      value={formRecipientNamePattern}
                      onChange={(e) =>
                        setFormRecipientNamePattern(e.target.value)
                      }
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
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">
                      Recipient Phone Pattern
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., (\d{10})"
                      value={formRecipientPhonePattern}
                      onChange={(e) =>
                        setFormRecipientPhonePattern(e.target.value)
                      }
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

              <IonRow>
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Date/Time Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., (\d{1,2})/(\d{1,2})/(\d{2})"
                      value={formDateTimePattern}
                      onChange={(e) => setFormDateTimePattern(e.target.value)}
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
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Cost Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., Transaction cost,?\s*Ksh([\d,]+)"
                      value={formCostPattern}
                      onChange={(e) => setFormCostPattern(e.target.value)}
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

              <IonRow>
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Income Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., You have received"
                      value={formIncomePattern}
                      onChange={(e) => setFormIncomePattern(e.target.value)}
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
                <IonCol size="6">
                  <div className="form-input-wrapper">
                    <label className="form-label">Expense Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g., sent to"
                      value={formExpensePattern}
                      onChange={(e) => setFormExpensePattern(e.target.value)}
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

              <IonRow>
                <IonCol>
                  <IonButton
                    expand="block"
                    onClick={handleSave}
                    disabled={loading}
                  >
                    {editingTemplate ? "Update Template" : "Add Template"}
                  </IonButton>
                </IonCol>
              </IonRow>
            </IonGrid>
          </IonContent>
        </IonModal>

        {/* FAB BUTTON FOR ADDING TEMPLATES */}
        {(!smsTemplatesReadExperimentHttpReadonly ||
          smsTemplatesSqliteWriteExperimentActive) && (
          <IonFab vertical="bottom" horizontal="end" slot="fixed">
            <IonFabButton
              onClick={() => {
                resetForm();
                setShowAddTemplateModal(true);
              }}
              title="Add Template"
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

export default SmsImportTemplatesManagement;

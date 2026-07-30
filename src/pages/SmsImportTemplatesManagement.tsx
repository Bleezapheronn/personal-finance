import React, { useState, useCallback } from "react";
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
} from "ionicons/icons";
import { SmsImportTemplate, Account } from "../db";
import {
  getRepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  activateSmsTemplateInDisposableSqlite,
  createSmsTemplateInDisposableSqlite,
  deactivateSmsTemplateInDisposableSqlite,
  deleteSmsTemplateFromDisposableSqlite,
  smsTemplateWriteErrorCode,
  type SmsTemplateWriteInput,
  updateSmsTemplateInDisposableSqlite,
} from "../repositories/http/smsTemplateWriteExperiment";
import {
  booleanValue,
  type DevPreviewListResult,
  numberValue,
  previewRows,
  stringValue,
} from "../utils/devPreview";
import { useAccountImageUrls } from "../hooks/useAccountImageUrls";

type LocalAccount = Account;

const SMS_TEMPLATES_LIST_LIMIT = 500;

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
  const { imageUrls: accountImageUrls } = useAccountImageUrls(accounts);
  const [loading, setLoading] = useState(true);

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

  const selectedBackend = getRepositoryBackend();

  const fetchData = async (): Promise<boolean> => {
    setLoading(true);
    try {
      let temps: SmsImportTemplate[];
      const accsPromise: Promise<Account[]> = getSelectedReadRepositories(selectedBackend)
            .accounts.list({ limit: 500, offset: 0 })
            .then((result) => {
              const rows = previewRows(result as DevPreviewListResult);
              if (!rows) {
                throw new Error("invalid_sms_template_accounts_response");
              }
              return rows.map(
                (row) => {
                  const source = row as Record<string, unknown>;
                  return {
                    ...source,
                    id: Number(source.id),
                    isActive: booleanValue(source.isActive),
                    isCredit: booleanValue(source.isCredit),
                  } as Account;
                },
              );
            })
        ;

      {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.smsImportTemplates.list({
          limit: SMS_TEMPLATES_LIST_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_sms_templates_response");
        }

        temps = rows
          .map(selectedReadRowToSmsTemplate)
          .sort(compareSmsTemplatesByExistingDisplayOrder);
      }

      const accs = await accsPromise;

      setTemplates(temps);
      setAccounts(accs);
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

      if (editingTemplate?.id) {
        await updateSmsTemplateInDisposableSqlite(editingTemplate.id, input);
        setToastMessage("Template updated successfully!");
      } else {
        await createSmsTemplateInDisposableSqlite(input);
        setToastMessage("Template added successfully!");
      }

      setShowToast(true);
      resetForm();
      setShowAddTemplateModal(false);
      await fetchData();
    } catch (err) {
      void smsTemplateWriteErrorCode(err);
      setFormError("Couldn't save this template. Try again.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * handleToggleTemplateActive - Toggles template active/inactive status
   */
  const handleToggleTemplateActive = async (template: SmsImportTemplate) => {
    try {
      setLoading(true);
      const newStatus = template.isActive ? false : true;
      if (newStatus) await activateSmsTemplateInDisposableSqlite(template.id!);
      else await deactivateSmsTemplateInDisposableSqlite(template.id!);
      await fetchData();
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
    try {
      setLoading(true);
      await deleteSmsTemplateFromDisposableSqlite(templateId);
      setDeleteTemplateId(null);
      setToastMessage("Template deleted successfully!");
      setShowToast(true);
      await fetchData();
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
        {/* TEMPLATES LIST */}
        <IonCard>
          <IonCardContent>
            {templates.length === 0 ? (
              <p>
                No SMS import templates yet. Tap the + button to add one.
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
                            {account?.id && accountImageUrls.has(account.id) ? (
                              <img
                                src={accountImageUrls.get(account.id)}
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
          isOpen={deleteTemplateId !== null}
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
          isOpen={showAddTemplateModal}
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
                  <IonButton disabled fill="outline" size="small">
                    Test parse unavailable
                  </IonButton>
                  <IonButton disabled fill="outline" size="small">
                    Import SMS unavailable
                  </IonButton>
                  <IonText color="medium">
                    <p>Test parsing and SMS import are not available yet.</p>
                  </IonText>
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

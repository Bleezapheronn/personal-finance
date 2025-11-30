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
import { db, SmsImportTemplate, PaymentMethod, Account } from "../db";

type LocalAccount = Account & { previewUrl?: string };

const SmsImportTemplatesManagement: React.FC = () => {
  const [templates, setTemplates] = useState<SmsImportTemplate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
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
  const [formPaymentMethodId, setFormPaymentMethodId] = useState<
    number | undefined
  >(undefined);
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

  const fetchData = async () => {
    setLoading(true);
    try {
      // Revoke old blob URLs before fetching new ones
      blobUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrlsRef.current.clear();

      const [temps, pms, accs] = await Promise.all([
        db.smsImportTemplates.toArray(),
        db.paymentMethods.toArray(),
        db.accounts.toArray(),
      ]);

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
      setPaymentMethods(pms);
      setAccounts(accountsWithPreview);
    } catch (err) {
      console.error("Failed to load SMS import templates:", err);
      setToastMessage("Failed to load SMS import templates");
      setShowToast(true);
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
    setFormPaymentMethodId(undefined);
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
    setFormPaymentMethodId(template.paymentMethodId);
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
      const now = new Date();

      if (editingTemplate?.id) {
        // UPDATE MODE
        await db.smsImportTemplates.update(editingTemplate.id, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          paymentMethodId: formPaymentMethodId,
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
        // ADD MODE
        const newTemplate: Omit<SmsImportTemplate, "id"> = {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          paymentMethodId: formPaymentMethodId,
          referencePattern: formReferencePattern.trim() || undefined,
          amountPattern: formAmountPattern.trim() || undefined,
          recipientNamePattern: formRecipientNamePattern.trim() || undefined,
          recipientPhonePattern: formRecipientPhonePattern.trim() || undefined,
          dateTimePattern: formDateTimePattern.trim() || undefined,
          costPattern: formCostPattern.trim() || undefined,
          incomePattern: formIncomePattern.trim() || undefined,
          expensePattern: formExpensePattern.trim() || undefined,
          isActive: true, // NEW: Default to active
          createdAt: now,
          updatedAt: now,
        };

        await db.smsImportTemplates.add(newTemplate);
        setToastMessage("Template added successfully!");
      }

      setShowToast(true);
      resetForm();
      setShowAddTemplateModal(false);
      await fetchData();
    } catch (err) {
      console.error("Failed to save template:", err);
      setFormError("Failed to save template");
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
      await db.smsImportTemplates.update(template.id!, {
        isActive: newStatus,
        updatedAt: new Date(),
      } as Partial<SmsImportTemplate>);
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
      await db.smsImportTemplates.delete(templateId);
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
        {loading && <IonSpinner />}

        {/* TEMPLATES LIST */}
        <IonCard>
          <IonCardContent>
            {templates.length === 0 ? (
              <p>No SMS import templates yet. Tap the + button to add one.</p>
            ) : (
              <IonList>
                {templates.map((template) => {
                  const isInactive = !template.isActive;
                  const paymentMethod = paymentMethods.find(
                    (pm) => pm.id === template.paymentMethodId
                  );
                  const account = paymentMethod
                    ? accounts.find((a) => a.id === paymentMethod.accountId)
                    : null;

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
                                title={account?.name || "No Account"}
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
                                {account?.name?.charAt(0).toUpperCase() || "?"}
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
                              <strong>Payment Method:</strong>{" "}
                              {paymentMethod?.name || "All Payment Methods"}
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
        <IonModal isOpen={showAddTemplateModal} onDidDismiss={handleCloseModal}>
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
                    <label className="form-label">
                      Payment Method (optional)
                    </label>
                    <select
                      value={formPaymentMethodId ?? ""}
                      onChange={(e) =>
                        setFormPaymentMethodId(
                          parseInt(e.target.value) || undefined
                        )
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
                      <option value="">All Payment Methods</option>
                      {accounts.map((account) => {
                        const methods = paymentMethods.filter(
                          (pm) => pm.accountId === account.id
                        );
                        if (methods.length === 0) return null;
                        return (
                          <optgroup key={account.id} label={account.name}>
                            {methods.map((pm) => (
                              <option key={pm.id} value={pm.id}>
                                {pm.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
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

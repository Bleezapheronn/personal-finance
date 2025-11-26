import React, { useState } from "react";
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
  IonLabel,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  useIonViewWillEnter,
  IonModal,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonToggle,
  IonTextarea,
} from "@ionic/react";
import { addOutline, createOutline, trashOutline, close } from "ionicons/icons";
import { db, SmsImportTemplate, PaymentMethod, Account } from "../db";

const SmsImportTemplatesManagement: React.FC = () => {
  const [templates, setTemplates] = useState<SmsImportTemplate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
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
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [temps, pms, accs] = await Promise.all([
        db.smsImportTemplates.toArray(),
        db.paymentMethods.toArray(),
        db.accounts.toArray(),
      ]);
      setTemplates(temps);
      setPaymentMethods(pms);
      setAccounts(accs);
      setError("");
    } catch (err) {
      console.error("Failed to load SMS import templates:", err);
      setError("Failed to load SMS import templates");
    } finally {
      setLoading(false);
    }
  };

  useIonViewWillEnter(() => {
    fetchData();
  });

  const resetForm = () => {
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
    setFormIsActive(true);
    setFormError("");
    setEditingTemplate(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (template: SmsImportTemplate) => {
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
    setFormIsActive(template.isActive);
    setFormError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError("");

    if (!formName.trim()) {
      setFormError("Template name is required");
      return;
    }

    const now = new Date();
    const templateData: Omit<SmsImportTemplate, "id"> = {
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
      isActive: formIsActive,
      createdAt: editingTemplate?.createdAt || now,
      updatedAt: now,
    };

    try {
      if (editingTemplate?.id) {
        await db.smsImportTemplates.update(editingTemplate.id, templateData);
      } else {
        await db.smsImportTemplates.add(templateData);
      }
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (err) {
      console.error("Failed to save template:", err);
      setFormError("Failed to save template");
    }
  };

  const handleDeleteClick = (id: number) => {
    setTemplateToDelete(id);
    setShowDeleteAlert(true);
  };

  const handleDeleteConfirm = async () => {
    if (templateToDelete) {
      try {
        await db.smsImportTemplates.delete(templateToDelete);
        fetchData();
      } catch (err) {
        console.error("Failed to delete template:", err);
        setError("Failed to delete template");
      }
    }
    setTemplateToDelete(null);
  };

  const getPaymentMethodName = (id?: number) => {
    if (!id) return "All Payment Methods";
    const pm = paymentMethods.find((p) => p.id === id);
    return pm?.name || "Unknown";
  };

  const getAccountName = (paymentMethodId?: number) => {
    if (!paymentMethodId) return "";
    const pm = paymentMethods.find((p) => p.id === paymentMethodId);
    if (!pm?.accountId) return "";
    const account = accounts.find((a) => a.id === pm.accountId);
    return account?.name || "";
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>SMS Import Templates</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={openAddModal}>
              <IonIcon icon={addOutline} />
              Add Template
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {loading && <IonSpinner name="crescent" />}
        {error && <IonText color="danger">{error}</IonText>}
        {!loading && templates.length === 0 && (
          <IonText>
            <p>
              No SMS import templates found. Click "Add Template" to create one.
            </p>
          </IonText>
        )}
        {!loading && templates.length > 0 && (
          <IonList>
            {templates.map((template) => (
              <IonItem key={template.id}>
                <IonLabel>
                  <h2>{template.name}</h2>
                  {template.description && <p>{template.description}</p>}
                  <p>
                    <strong>Payment Method:</strong>{" "}
                    {getPaymentMethodName(template.paymentMethodId)}
                    {template.paymentMethodId &&
                      getAccountName(template.paymentMethodId) && (
                        <> ({getAccountName(template.paymentMethodId)})</>
                      )}
                  </p>
                  <p>
                    <strong>Status:</strong>{" "}
                    {template.isActive ? (
                      <IonText color="success">Active</IonText>
                    ) : (
                      <IonText color="medium">Inactive</IonText>
                    )}
                  </p>
                </IonLabel>
                <IonButton
                  fill="clear"
                  onClick={() => openEditModal(template)}
                  slot="end"
                >
                  <IonIcon icon={createOutline} />
                </IonButton>
                <IonButton
                  fill="clear"
                  color="danger"
                  onClick={() => handleDeleteClick(template.id!)}
                  slot="end"
                >
                  <IonIcon icon={trashOutline} />
                </IonButton>
              </IonItem>
            ))}
          </IonList>
        )}

        {/* Modal for Add/Edit */}
        <IonModal isOpen={showModal} onDidDismiss={() => setShowModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>
                {editingTemplate ? "Edit Template" : "Add Template"}
              </IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowModal(false)}>
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {formError && (
              <IonText color="danger">
                <p>{formError}</p>
              </IonText>
            )}
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonInput
                    label="Template Name"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., M-PESA Standard"
                    value={formName}
                    onIonChange={(e) => setFormName(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>
              <IonRow>
                <IonCol>
                  <IonTextarea
                    label="Description (optional)"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="Template description"
                    rows={2}
                    value={formDescription}
                    onIonChange={(e) => setFormDescription(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>
              <IonRow>
                <IonCol>
                  <IonSelect
                    label="Payment Method (optional)"
                    labelPlacement="stacked"
                    fill="outline"
                    interface="popover"
                    placeholder="Select payment method"
                    value={formPaymentMethodId}
                    onIonChange={(e) => setFormPaymentMethodId(e.detail.value)}
                  >
                    <IonSelectOption value={undefined}>
                      All Payment Methods
                    </IonSelectOption>
                    {accounts.map((account) => {
                      const methods = paymentMethods.filter(
                        (pm) => pm.accountId === account.id
                      );
                      if (methods.length === 0) return null;
                      return (
                        <React.Fragment key={account.id}>
                          <IonSelectOption
                            value={-1}
                            disabled
                            style={{ fontWeight: 700, opacity: 0.9 }}
                          >
                            {account.name}
                          </IonSelectOption>
                          {methods.map((pm) => (
                            <IonSelectOption key={pm.id} value={pm.id}>
                              {pm.name}
                            </IonSelectOption>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </IonSelect>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <h3>Regex Patterns</h3>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--ion-color-medium)",
                    }}
                  >
                    Define regex patterns to extract transaction details from
                    SMS messages.
                  </p>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonInput
                    label="Reference Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., ^([A-Z0-9]{10})"
                    value={formReferencePattern}
                    onIonChange={(e) =>
                      setFormReferencePattern(e.detail.value!)
                    }
                  />
                </IonCol>
                <IonCol size="6">
                  <IonInput
                    label="Amount Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., Ksh([\d,]+\.?\d*)"
                    value={formAmountPattern}
                    onIonChange={(e) => setFormAmountPattern(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonInput
                    label="Recipient Name Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., sent to\s+([A-Z\s]+)"
                    value={formRecipientNamePattern}
                    onIonChange={(e) =>
                      setFormRecipientNamePattern(e.detail.value!)
                    }
                  />
                </IonCol>
                <IonCol size="6">
                  <IonInput
                    label="Recipient Phone Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., (\d{10})"
                    value={formRecipientPhonePattern}
                    onIonChange={(e) =>
                      setFormRecipientPhonePattern(e.detail.value!)
                    }
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonInput
                    label="Date/Time Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., (\d{1,2})/(\d{1,2})/(\d{2})"
                    value={formDateTimePattern}
                    onIonChange={(e) => setFormDateTimePattern(e.detail.value!)}
                  />
                </IonCol>
                <IonCol size="6">
                  <IonInput
                    label="Cost Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., Transaction cost,?\s*Ksh([\d,]+)"
                    value={formCostPattern}
                    onIonChange={(e) => setFormCostPattern(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonInput
                    label="Income Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., You have received"
                    value={formIncomePattern}
                    onIonChange={(e) => setFormIncomePattern(e.detail.value!)}
                  />
                </IonCol>
                <IonCol size="6">
                  <IonInput
                    label="Expense Pattern"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="e.g., sent to"
                    value={formExpensePattern}
                    onIonChange={(e) => setFormExpensePattern(e.detail.value!)}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem lines="none">
                    <IonToggle
                      checked={formIsActive}
                      onIonChange={(e) => setFormIsActive(e.detail.checked)}
                    >
                      Active
                    </IonToggle>
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton expand="block" onClick={handleSave}>
                    {editingTemplate ? "Update Template" : "Add Template"}
                  </IonButton>
                </IonCol>
              </IonRow>
            </IonGrid>
          </IonContent>
        </IonModal>

        {/* Delete Confirmation Alert */}
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Delete Template"
          message="Are you sure you want to delete this SMS import template?"
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "confirm",
              handler: handleDeleteConfirm,
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default SmsImportTemplatesManagement;

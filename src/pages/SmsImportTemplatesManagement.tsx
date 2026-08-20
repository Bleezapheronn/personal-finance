import React, { useState } from "react";
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCol,
  IonContent,
  IonFab,
  IonFabButton,
  IonGrid,
  IonHeader,
  IonIcon,
  IonItem,
  IonList,
  IonMenuButton,
  IonPage,
  IonRow,
  IonSpinner,
  IonTitle,
  IonToast,
  IonToolbar,
  useIonViewWillEnter,
} from "@ionic/react";
import {
  add,
  checkmarkCircleOutline,
  closeCircleOutline,
  createOutline,
  trashOutline,
} from "ionicons/icons";
import { useHistory } from "react-router-dom";
import type { Account, SmsImportTemplate } from "../db";
import { useAccountImageUrls } from "../hooks/useAccountImageUrls";
import { getRepositoryBackend } from "../repositories/adapterSelection";
import {
  activateSmsTemplateInDisposableSqlite,
  deactivateSmsTemplateInDisposableSqlite,
  deleteSmsTemplateFromDisposableSqlite,
} from "../repositories/http/smsTemplateWriteExperiment";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import {
  booleanValue,
  numberValue,
  previewRows,
  stringValue,
  type DevPreviewListResult,
} from "../utils/devPreview";

const templateFromRow = (row: Record<string, unknown>): SmsImportTemplate => ({
  id: numberValue(row.id),
  name: stringValue(row.name) ?? "",
  description: stringValue(row.description),
  paymentMethodId: numberValue(row.paymentMethodId),
  accountId: numberValue(row.accountId),
  referencePattern: stringValue(row.referencePattern),
  amountPattern: stringValue(row.amountPattern),
  recipientNamePattern: stringValue(row.recipientNamePattern),
  recipientPhonePattern: stringValue(row.recipientPhonePattern),
  dateTimePattern: stringValue(row.dateTimePattern),
  costPattern: stringValue(row.costPattern),
  incomePattern: stringValue(row.incomePattern),
  expensePattern: stringValue(row.expensePattern),
  isActive: booleanValue(row.isActive) !== false,
  createdAt: new Date(String(row.createdAt ?? 0)),
  updatedAt: new Date(String(row.updatedAt ?? 0)),
});

const accountFromRow = (row: Record<string, unknown>): Account => ({
  ...row,
  id: numberValue(row.id),
  name: stringValue(row.name) ?? "",
  isActive: booleanValue(row.isActive) !== false,
} as Account);

const SmsImportTemplatesManagement: React.FC = () => {
  const history = useHistory();
  const [templates, setTemplates] = useState<SmsImportTemplate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { imageUrls: accountImageUrls } = useAccountImageUrls(accounts);
  const [loading, setLoading] = useState(true);
  const [deleteTemplateId, setDeleteTemplateId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const repositories = getSelectedReadRepositories(getRepositoryBackend());
      const [templateResult, accountResult] = await Promise.all([
        repositories.smsImportTemplates.list({ limit: 500, offset: 0 }),
        repositories.accounts.list({ limit: 500, offset: 0 }),
      ]);
      const templateRows = previewRows(templateResult as DevPreviewListResult);
      const accountRows = previewRows(accountResult as DevPreviewListResult);
      if (!templateRows || !accountRows) throw new Error("invalid_sms_template_list");
      setTemplates(
        templateRows
          .map((row) => templateFromRow(row as Record<string, unknown>))
          .sort(
            (left, right) =>
              (left.id ?? Number.MAX_SAFE_INTEGER) -
              (right.id ?? Number.MAX_SAFE_INTEGER),
          ),
      );
      setAccounts(
        accountRows.map((row) => accountFromRow(row as Record<string, unknown>)),
      );
    } catch {
      setToastMessage("Failed to load SMS import templates");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useIonViewWillEnter(() => {
    void fetchData();
  });

  const toggleActive = async (template: SmsImportTemplate) => {
    if (!template.id) return;
    setLoading(true);
    try {
      if (template.isActive) {
        await deactivateSmsTemplateInDisposableSqlite(template.id);
      } else {
        await activateSmsTemplateInDisposableSqlite(template.id);
      }
      await fetchData();
    } catch {
      setToastMessage("Failed to update template status");
      setShowToast(true);
      setLoading(false);
    }
  };

  const deleteTemplate = async (templateId: number) => {
    setLoading(true);
    try {
      await deleteSmsTemplateFromDisposableSqlite(templateId);
      setDeleteTemplateId(null);
      setToastMessage("Template deleted successfully!");
      setShowToast(true);
      await fetchData();
    } catch {
      setToastMessage("Failed to delete template");
      setShowToast(true);
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
          <IonTitle>SMS Import Templates</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardContent>
            {loading && templates.length === 0 ? (
              <IonSpinner />
            ) : templates.length === 0 ? (
              <p>No SMS import templates yet. Tap the + button to add one.</p>
            ) : (
              <IonList>
                {templates.map((template) => {
                  const account = accounts.find(
                    (candidate) => candidate.id === template.accountId,
                  );
                  const inactive = !template.isActive;
                  return (
                    <IonItem key={template.id}>
                      <IonGrid className="ion-no-padding">
                        <IonRow>
                          <IonCol size="auto">
                            {account?.id && accountImageUrls.has(account.id) ? (
                              <img
                                src={accountImageUrls.get(account.id)}
                                alt={account.name}
                                style={{
                                  width: 40,
                                  height: 40,
                                  objectFit: "cover",
                                  opacity: inactive ? 0.6 : 1,
                                  marginRight: 8,
                                }}
                              />
                            ) : (
                              <div
                                title={account?.name || "All Accounts"}
                                style={{
                                  width: 40,
                                  height: 40,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  backgroundColor: "var(--ion-color-medium-shade)",
                                  color: "white",
                                  opacity: inactive ? 0.6 : 1,
                                  marginRight: 8,
                                }}
                              >
                                {account?.name?.charAt(0).toUpperCase() || "*"}
                              </div>
                            )}
                          </IonCol>
                          <IonCol style={{ opacity: inactive ? 0.6 : 1 }}>
                            <strong>{template.name}</strong>
                            <p style={{ margin: "4px 0 0", color: "#999" }}>
                              <strong>Account:</strong> {account?.name || "All Accounts"}
                            </p>
                          </IonCol>
                          <IonCol size="auto">
                            <IonButton
                              fill="clear"
                              size="small"
                              title="Edit SMS Template"
                              aria-label="Edit SMS Template"
                              onClick={() =>
                                history.push(`/sms-import-templates/${template.id}/edit`)
                              }
                            >
                              <IonIcon icon={createOutline} />
                            </IonButton>
                            <IonButton
                              fill="clear"
                              size="small"
                              color={inactive ? "medium" : "success"}
                              title={inactive ? "Activate template" : "Deactivate template"}
                              aria-label={
                                inactive ? "Activate template" : "Deactivate template"
                              }
                              onClick={() => void toggleActive(template)}
                            >
                              <IonIcon
                                icon={
                                  inactive
                                    ? closeCircleOutline
                                    : checkmarkCircleOutline
                                }
                              />
                            </IonButton>
                            <IonButton
                              fill="clear"
                              size="small"
                              color="danger"
                              title="Delete SMS Template"
                              aria-label="Delete SMS Template"
                              onClick={() => setDeleteTemplateId(template.id ?? null)}
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

        <IonAlert
          isOpen={deleteTemplateId !== null}
          onDidDismiss={() => setDeleteTemplateId(null)}
          header="Delete Template"
          message="Are you sure you want to delete this SMS import template?"
          buttons={[
            { text: "Cancel", role: "cancel" },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteTemplateId) void deleteTemplate(deleteTemplateId);
              },
            },
          ]}
        />

        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            title="Add SMS Template"
            onClick={() => history.push("/sms-import-templates/new")}
          >
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMessage}
          duration={2000}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default SmsImportTemplatesManagement;

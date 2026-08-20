import React, { useEffect, useMemo, useState } from "react";
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonViewWillLeave,
} from "@ionic/react";
import { Prompt, useHistory, useParams } from "react-router-dom";
import type { Account, SmsImportTemplate } from "../db";
import { SmsTemplateAssistantModal } from "../components/SmsTemplateAssistantModal";
import {
  smsTemplateManagementRepository,
  type SmsTemplateWriteInput,
} from "../repositories";
import {
  evaluateSmsTemplate,
  SMS_TEMPLATE_PATTERN_FIELDS,
  type SmsTemplateEvaluation,
  type SmsTemplatePatternField,
} from "../utils/smsTemplateParser";
import "./SmsImportTemplateEditor.css";

const patternLabels: Record<SmsTemplatePatternField, string> = {
  referencePattern: "Reference Pattern",
  amountPattern: "Amount Pattern",
  recipientNamePattern: "Recipient Name Pattern",
  recipientPhonePattern: "Recipient Phone Pattern",
  dateTimePattern: "Date/Time Pattern",
  costPattern: "Cost Pattern",
  incomePattern: "Income Pattern",
  expensePattern: "Expense Pattern",
};

type TemplateDraft = SmsTemplateWriteInput;

const emptyDraft = (): TemplateDraft => ({
  name: "",
  description: "",
  accountId: undefined,
  referencePattern: "",
  amountPattern: "",
  recipientNamePattern: "",
  recipientPhonePattern: "",
  dateTimePattern: "",
  costPattern: "",
  incomePattern: "",
  expensePattern: "",
});

const templateToDraft = (template: SmsImportTemplate): TemplateDraft => ({
  name: template.name,
  description: template.description ?? "",
  accountId: template.accountId,
  referencePattern: template.referencePattern ?? "",
  amountPattern: template.amountPattern ?? "",
  recipientNamePattern: template.recipientNamePattern ?? "",
  recipientPhonePattern: template.recipientPhonePattern ?? "",
  dateTimePattern: template.dateTimePattern ?? "",
  costPattern: template.costPattern ?? "",
  incomePattern: template.incomePattern ?? "",
  expensePattern: template.expensePattern ?? "",
});

const diagnosticColor = (status: string): string => {
  if (status === "matched") return "success";
  if (status === "not-configured") return "medium";
  if (status === "ambiguous") return "warning";
  return "danger";
};

const SmsImportTemplateEditor: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const history = useHistory();
  const editId = id ? Number(id) : undefined;
  const isEdit = Number.isInteger(editId) && Number(editId) > 0;
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [originalDraft, setOriginalDraft] = useState<TemplateDraft>(emptyDraft);
  const [templateActive, setTemplateActive] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sample, setSample] = useState("");
  const [evaluation, setEvaluation] = useState<SmsTemplateEvaluation | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(originalDraft);
  const draftTemplate = useMemo<SmsImportTemplate>(
    () => ({
      id: editId,
      ...draft,
      isActive: templateActive,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    [draft, editId, templateActive],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data =
          await smsTemplateManagementRepository.loadSmsTemplateEditorData(
            isEdit ? editId : undefined,
          );
        let nextDraft = emptyDraft();
        let nextActive = true;
        if (data.template) {
          nextDraft = templateToDraft(data.template);
          nextActive = data.template.isActive;
        }
        if (!cancelled) {
          setAccounts(data.accounts);
          setDraft(nextDraft);
          setOriginalDraft(nextDraft);
          setTemplateActive(nextActive);
        }
      } catch {
        if (!cancelled) setError("Couldn't load this SMS import template.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [editId, isEdit]);

  useIonViewWillLeave(() => {
    setSample("");
    setEvaluation(null);
    setAssistantOpen(false);
  });

  const updateDraft = <K extends keyof TemplateDraft>(
    field: K,
    value: TemplateDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setEvaluation(null);
  };

  const save = async () => {
    setError("");
    if (!draft.name.trim()) {
      setError("Template name is required.");
      return;
    }
    setSaving(true);
    try {
      await smsTemplateManagementRepository.saveSmsTemplateDraft(
        isEdit ? editId : undefined,
        draft,
      );
      setOriginalDraft(draft);
      setSample("");
      setEvaluation(null);
      history.replace("/sms-import-templates");
    } catch (saveError) {
      const code =
        smsTemplateManagementRepository.smsTemplateManagementErrorCode(
          saveError,
        );
      setError(`Couldn't save this template (${code}).`);
    } finally {
      setSaving(false);
    }
  };

  const testSample = () => {
    if (!sample.trim()) {
      setEvaluation(null);
      setError("Paste a private sample SMS before testing.");
      return;
    }
    setError("");
    setEvaluation(evaluateSmsTemplate(sample, draftTemplate));
  };

  const cancel = () => {
    setSample("");
    setEvaluation(null);
    setAssistantOpen(false);
    history.push("/sms-import-templates");
  };

  if (loading) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <IonSpinner />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <Prompt
        when={dirty && !saving}
        message="Discard unsaved SMS template changes?"
      />
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>{isEdit ? "Edit SMS Template" : "Add SMS Template"}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {error && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}

        <div className="sms-template-editor">
        <IonCard className="sms-template-editor-card">
          <IonCardContent>
            <h2 className="sms-template-editor-heading">Template Details</h2>
            <div className="form-grid-2">
              <div className="form-input-wrapper">
                <label className="form-label" htmlFor="sms-template-name">
                  Template Name
                </label>
                <input
                  id="sms-template-name"
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  className="sms-template-control"
                />
              </div>
              <div className="form-input-wrapper">
                <label className="form-label" htmlFor="sms-template-account">
                  Account (optional)
                </label>
                <select
                  id="sms-template-account"
                  value={draft.accountId ?? ""}
                  onChange={(event) =>
                    updateDraft(
                      "accountId",
                      event.target.value ? Number(event.target.value) : undefined,
                    )
                  }
                  className="sms-template-control"
                >
                  <option value="">All Accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-input-wrapper sms-template-editor-spaced-field">
              <label className="form-label" htmlFor="sms-template-description">
                Description (optional)
              </label>
              <textarea
                id="sms-template-description"
                rows={2}
                value={draft.description ?? ""}
                onChange={(event) =>
                  updateDraft("description", event.target.value)
                }
                className="sms-template-control"
              />
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="sms-template-editor-card">
          <IonCardContent>
            <h2 className="sms-template-editor-heading">Regex Patterns</h2>
            <IonText color="medium">
              <p>Capture group 1 supplies extracted values.</p>
            </IonText>
            <div className="form-grid-2">
              {SMS_TEMPLATE_PATTERN_FIELDS.map((field) => (
                <div className="form-input-wrapper" key={field}>
                  <label className="form-label" htmlFor={`sms-template-${field}`}>
                    {patternLabels[field]}
                  </label>
                  <input
                    id={`sms-template-${field}`}
                    value={draft[field] ?? ""}
                    onChange={(event) => updateDraft(field, event.target.value)}
                    className="sms-template-control sms-template-code-input"
                  />
                </div>
              ))}
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="sms-template-editor-card">
          <IonCardContent>
            <h2 className="sms-template-editor-heading">Sample Workshop</h2>
            <IonText color="medium">
              <p>
                Samples stay only in this page's memory. Testing does not save
                the template or create or prefill a Transaction.
              </p>
            </IonText>
            <label className="form-label" htmlFor="sms-template-sample">
              Private sample SMS
            </label>
            <textarea
              id="sms-template-sample"
              rows={6}
              value={sample}
              onChange={(event) => {
                setSample(event.target.value);
                setEvaluation(null);
              }}
              className="sms-template-control sms-template-code-input"
            />
            <div className="sms-template-workshop-actions">
              <IonButton fill="outline" onClick={testSample} disabled={!sample.trim()}>
                Test Sample
              </IonButton>
              <IonButton
                fill="outline"
                onClick={() => setAssistantOpen(true)}
                disabled={!sample.trim()}
              >
                Build from Sample
              </IonButton>
            </div>

            {evaluation && (
              <div className="sms-template-results">
                <h3>Extraction Results</h3>
                {SMS_TEMPLATE_PATTERN_FIELDS.map((field) => {
                  const diagnostic = evaluation.diagnostics[field];
                  return (
                    <div
                      key={field}
                      className="sms-template-diagnostic"
                    >
                      <strong>{patternLabels[field]}:</strong>{" "}
                      <IonText color={diagnosticColor(diagnostic.status)}>
                        {diagnostic.status}
                      </IonText>
                      {diagnostic.fullMatch && (
                        <div>Matched: {diagnostic.fullMatch}</div>
                      )}
                      {diagnostic.extractedValue && (
                        <div>Extracted: {diagnostic.extractedValue}</div>
                      )}
                      {diagnostic.message && <div>{diagnostic.message}</div>}
                    </div>
                  );
                })}
                {evaluation.warnings.map((warning) => (
                  <IonText color="warning" key={warning}>
                    <p>{warning}</p>
                  </IonText>
                ))}
              </div>
            )}
          </IonCardContent>
        </IonCard>

        <div className="sms-template-editor-actions">
          <IonButton
            fill="outline"
            onClick={cancel}
          >
            Cancel
          </IonButton>
          <IonButton onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Update Template" : "Add Template"}
          </IonButton>
        </div>

        <SmsTemplateAssistantModal
          isOpen={assistantOpen}
          sample={sample}
          draftTemplate={draftTemplate}
          onClose={() => setAssistantOpen(false)}
          onApply={(field, pattern) => {
            updateDraft(field, pattern);
            setAssistantOpen(false);
          }}
        />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SmsImportTemplateEditor;

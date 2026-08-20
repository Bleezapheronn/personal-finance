import React, { useEffect, useMemo, useState } from "react";
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import type { SmsImportTemplate } from "../db";
import {
  smsTemplateSelection,
  suggestSmsTemplatePattern,
} from "../utils/smsTemplateAssistant";
import {
  evaluateSmsTemplate,
  type SmsTemplatePatternField,
} from "../utils/smsTemplateParser";

const fields: Array<{ field: SmsTemplatePatternField; label: string }> = [
  { field: "referencePattern", label: "Reference" },
  { field: "amountPattern", label: "Amount" },
  { field: "recipientNamePattern", label: "Recipient / sender name" },
  { field: "recipientPhonePattern", label: "Recipient phone" },
  { field: "dateTimePattern", label: "Date / time" },
  { field: "costPattern", label: "Transaction cost" },
  { field: "incomePattern", label: "Income indicator" },
  { field: "expensePattern", label: "Expense indicator" },
];

interface SmsTemplateAssistantModalProps {
  isOpen: boolean;
  sample: string;
  draftTemplate: SmsImportTemplate;
  onClose: () => void;
  onApply: (field: SmsTemplatePatternField, pattern: string) => void;
}

export const SmsTemplateAssistantModal: React.FC<
  SmsTemplateAssistantModalProps
> = ({ isOpen, sample, draftTemplate, onClose, onApply }) => {
  const [field, setField] = useState<SmsTemplatePatternField>(
    "amountPattern",
  );
  const [selectedText, setSelectedText] = useState("");
  const [beforeAnchor, setBeforeAnchor] = useState("");
  const [afterAnchor, setAfterAnchor] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSelectedText("");
      setBeforeAnchor("");
      setAfterAnchor("");
      setSuggestion("");
      setError("");
    }
  }, [isOpen]);

  const preview = useMemo(() => {
    if (!suggestion) return null;
    const candidate = { ...draftTemplate, [field]: suggestion };
    return evaluateSmsTemplate(sample, candidate).diagnostics[field];
  }, [draftTemplate, field, sample, suggestion]);

  const captureSelection = (target: HTMLTextAreaElement) => {
    const selection = smsTemplateSelection(
      sample,
      target.selectionStart,
      target.selectionEnd,
    );
    setSelectedText(selection.text);
    setBeforeAnchor(selection.beforeAnchor);
    setAfterAnchor(selection.afterAnchor);
    setSuggestion("");
    setError("");
  };

  const generate = () => {
    const result = suggestSmsTemplatePattern({
      field,
      selectedText,
      beforeAnchor,
      afterAnchor,
    });
    if (!result.ok || !result.pattern) {
      setSuggestion("");
      setError(result.error ?? "A safe pattern could not be suggested.");
      return;
    }
    setError("");
    setSuggestion(result.pattern);
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Build from Sample</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>Close</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText color="medium">
          <p>
            Highlight one value or indicator in the sample (or type the exact
            selected text below), choose its field, and review the suggested
            pattern before applying it to the draft.
          </p>
        </IonText>

        <label className="form-label" htmlFor="sms-assistant-sample">
          Private sample (not saved)
        </label>
        <textarea
          id="sms-assistant-sample"
          rows={7}
          readOnly
          value={sample}
          onSelect={(event) => captureSelection(event.currentTarget)}
          className="sms-template-control sms-template-code-input"
        />

        <div className="form-grid-2 sms-template-assistant-grid">
          <div className="form-input-wrapper">
            <label className="form-label" htmlFor="sms-assistant-field">
              Target field
            </label>
            <select
              id="sms-assistant-field"
              value={field}
              onChange={(event) => {
                setField(event.target.value as SmsTemplatePatternField);
                setSuggestion("");
                setError("");
              }}
              className="sms-template-control"
            >
              {fields.map((option) => (
                <option key={option.field} value={option.field}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-input-wrapper">
            <label className="form-label" htmlFor="sms-assistant-selection">
              Selected text
            </label>
            <input
              id="sms-assistant-selection"
              value={selectedText}
              placeholder="Highlight text in the sample"
              onChange={(event) => {
                setSelectedText(event.target.value);
                setSuggestion("");
                setError("");
              }}
              className="sms-template-control"
            />
          </div>
          <div className="form-input-wrapper">
            <label className="form-label" htmlFor="sms-assistant-before">
              Stable text before
            </label>
            <input
              id="sms-assistant-before"
              value={beforeAnchor}
              onChange={(event) => {
                setBeforeAnchor(event.target.value);
                setSuggestion("");
              }}
              className="sms-template-control"
            />
          </div>
          <div className="form-input-wrapper">
            <label className="form-label" htmlFor="sms-assistant-after">
              Stable text after
            </label>
            <input
              id="sms-assistant-after"
              value={afterAnchor}
              onChange={(event) => {
                setAfterAnchor(event.target.value);
                setSuggestion("");
              }}
              className="sms-template-control"
            />
          </div>
        </div>

        <IonButton
          expand="block"
          fill="outline"
          onClick={generate}
          className="sms-template-assistant-button"
        >
          Suggest Pattern
        </IonButton>

        {error && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}

        {suggestion && (
          <div className="sms-template-assistant-suggestion">
            <label className="form-label" htmlFor="sms-assistant-pattern">
              Suggested pattern
            </label>
            <input
              id="sms-assistant-pattern"
              value={suggestion}
              onChange={(event) => setSuggestion(event.target.value)}
              className="sms-template-control sms-template-code-input"
            />
            <IonText color={preview?.status === "matched" ? "success" : "warning"}>
              <p>
                Preview: {preview?.status ?? "not tested"}
                {preview?.extractedValue
                  ? ` — extracted “${preview.extractedValue}”`
                  : ""}
              </p>
            </IonText>
            <IonButton
              expand="block"
              disabled={
                preview?.status !== "matched" && preview?.status !== "ambiguous"
              }
              onClick={() => onApply(field, suggestion)}
            >
              Apply to Draft
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

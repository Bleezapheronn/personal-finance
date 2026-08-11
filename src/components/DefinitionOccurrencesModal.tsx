import React, { useEffect, useMemo, useState } from "react";
import {
  IonButton, IonButtons, IonCheckbox, IonCol, IonContent, IonGrid, IonHeader,
  IonIcon, IonItem, IonList, IonModal, IonRow, IonSpinner, IonText, IonTitle, IonToolbar,
} from "@ionic/react";
import { checkmarkCircleOutline, close, closeCircleOutline, trashOutline } from "ionicons/icons";
import type { Budget, BudgetSnapshot, Category, Recipient } from "../db";
import { occurrenceDisplayTarget } from "../utils/budgetDisplayTarget";

export type DefinitionOccurrence = BudgetSnapshot & {
  occurrenceDependencySummary?: {
    linkedTransactionCount: number;
    ambiguousLegacyReferenceCount: number;
    linkedTransactionTotal?: number;
  };
};

interface Props {
  isOpen: boolean;
  budget: Budget | null;
  snapshots: DefinitionOccurrence[];
  categories: Category[];
  recipients: Recipient[];
  incomeForYear: (year: number) => number;
  loading?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSetActive: (snapshotIds: number[], isActive: boolean) => Promise<void>;
  onDelete: (snapshotIds: number[]) => Promise<void>;
}

const money = (value: number) => value.toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const DefinitionOccurrencesModal: React.FC<Props> = ({
  isOpen, budget, snapshots, categories, recipients, incomeForYear, loading = false, busy = false,
  onClose, onSetActive, onDelete,
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const rows = useMemo(
    () => [...snapshots].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
    [snapshots],
  );
  const selectedRows = rows.filter((row) => row.id !== undefined && selected.has(row.id));
  const selectedIds = selectedRows.map((row) => row.id!);
  const dependency = (row: DefinitionOccurrence) => row.occurrenceDependencySummary ?? {
    linkedTransactionCount: 0,
    ambiguousLegacyReferenceCount: 0,
  };
  const deleteReason = !budget?.isActive
    ? selectedRows.some((row) => dependency(row).linkedTransactionCount > 0)
      ? "Selected occurrences with linked Transactions cannot be deleted."
      : selectedRows.some((row) => dependency(row).ambiguousLegacyReferenceCount > 0)
        ? "Selected occurrences with ambiguous legacy references cannot be deleted."
        : ""
    : "Deactivate the Budget definition before deleting occurrences.";
  const canDelete = selectedIds.length > 0 && deleteReason === "";

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set());
      setError("");
    }
  }, [isOpen]);

  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll = () => setSelected(
    selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id!).filter(Boolean)),
  );
  const recipientName = (id: number | undefined) => recipients.find((row) => row.id === id)?.name ?? "—";
  const categoryName = (id: number) => categories.find((row) => row.id === id)?.name ?? "—";
  const target = (row: BudgetSnapshot) => occurrenceDisplayTarget(row, incomeForYear(row.dueDate.getFullYear()));
  const run = async (operation: () => Promise<void>) => {
    setError("");
    try { await operation(); setSelected(new Set()); } catch { setError("Occurrence change could not be completed."); }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader><IonToolbar><IonTitle>Definition Occurrences</IonTitle><IonButtons slot="end"><IonButton onClick={onClose} aria-label="Close occurrence list"><IonIcon icon={close} /></IonButton></IonButtons></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        <IonText color="medium"><p>{loading ? "Loading persisted occurrences…" : `${rows.length} persisted occurrence${rows.length === 1 ? "" : "s"} for ${budget?.description ?? "this Budget definition"}.`}</p></IonText>
        {error && <IonText color="danger"><p>{error}</p></IonText>}
        {loading ? <IonSpinner /> : <>
          <IonButton expand="block" fill="outline" size="small" onClick={selectAll} disabled={busy || rows.length === 0}>
            {selected.size === rows.length && rows.length > 0 ? "Deselect All" : "Select All"}
          </IonButton>
          <IonList>
            {rows.map((row) => {
              const rowId = row.id!;
              const active = row.isActive !== false;
              const rowDependency = dependency(row);
              const deletable = budget?.isActive === false && rowDependency.linkedTransactionCount === 0 && rowDependency.ambiguousLegacyReferenceCount === 0;
              return <IonItem key={rowId}>
                <IonGrid style={{ width: "100%" }}><IonRow className="ion-align-items-center">
                  <IonCol size="1"><IonCheckbox checked={selected.has(rowId)} onIonChange={() => toggle(rowId)} /></IonCol>
                  <IonCol size="7"><div style={{ fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.description}</div>
                    <div style={{ fontSize: "0.85rem", color: "#888" }}>{recipientName(row.recipientId)}</div>
                    <div style={{ fontSize: "0.8rem", color: "#999" }}>{categoryName(row.categoryId)} · {row.dueDate.toLocaleDateString()}</div>
                  </IonCol>
                  <IonCol size="4" style={{ textAlign: "right" }}><div style={{ fontWeight: "bold", color: row.amount + (row.transactionCost ?? 0) < 0 ? "#eb445c" : "#009688" }}>{money(Math.abs(rowDependency.linkedTransactionTotal ?? 0))}</div>
                    <div style={{ fontSize: "0.8rem", color: "#999" }}>{target(row) == null ? "Target unavailable" : `of ${money(target(row)!)}`}</div>
                    <IonRow className="ion-justify-content-end ion-align-items-center">
                      <IonButton fill="clear" size="small" disabled={busy} title={active ? "Deactivate this Budget occurrence" : "Reactivate this Budget occurrence"} aria-label={active ? "Deactivate this Budget occurrence" : "Reactivate this Budget occurrence"} onClick={() => run(() => onSetActive([rowId], !active))}><IonIcon color={active ? "success" : "medium"} icon={active ? checkmarkCircleOutline : closeCircleOutline} /></IonButton>
                      <IonButton fill="clear" color="danger" size="small" disabled={busy || !deletable} title="Delete Budget occurrence" aria-label="Delete Budget occurrence" onClick={() => run(() => onDelete([rowId]))}><IonIcon icon={trashOutline} /></IonButton>
                    </IonRow>
                  </IonCol>
                </IonRow></IonGrid>
              </IonItem>;
            })}
          </IonList>
          {rows.length === 0 && <IonText color="medium"><p>No persisted occurrences exist for this definition.</p></IonText>}
          {deleteReason && selectedIds.length > 0 && <IonText color="medium"><p>{deleteReason}</p></IonText>}
          <IonGrid><IonRow><IonCol><IonButton expand="block" disabled={busy || selectedIds.length === 0} onClick={() => run(() => onSetActive(selectedIds, true))}>Activate Selected</IonButton></IonCol><IonCol><IonButton expand="block" disabled={busy || selectedIds.length === 0} onClick={() => run(() => onSetActive(selectedIds, false))}>Deactivate Selected</IonButton></IonCol></IonRow></IonGrid>
          <IonButton expand="block" color="danger" disabled={busy || !canDelete} onClick={() => run(() => onDelete(selectedIds))}><IonIcon icon={trashOutline} slot="start" />Delete Selected</IonButton>
        </>}
      </IonContent>
    </IonModal>
  );
};

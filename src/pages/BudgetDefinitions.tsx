import React, { useMemo, useState } from "react";
import {
  IonButton, IonButtons, IonChip, IonCol, IonContent, IonGrid, IonHeader, IonIcon,
  IonAvatar, IonImg, IonItem, IonLabel, IonList, IonPage, IonRow, IonSpinner, IonText, IonTitle,
  IonToolbar, IonMenuButton, useIonViewWillEnter,
} from "@ionic/react";
import { arrowDownCircle, arrowUpCircle, checkmarkCircleOutline, closeCircleOutline, createOutline, timeOutline, trashOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";
import { Account, Bucket, Budget, BudgetSnapshot, Category, db, Recipient, Transaction } from "../db";
import { DefinitionOccurrence, DefinitionOccurrencesModal } from "../components/DefinitionOccurrencesModal";
import { getRepositoryBackend, isLocalSqliteBackend } from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { useLocalSqliteRuntime } from "../contexts/LocalSqliteRuntimeContext";
import { dryRunBudgetLifecycle, writeBudgetLifecycle } from "../repositories/http/budgetLifecycleWriteExperiment";
import { dryRunBudgetDelete, writeBudgetDelete } from "../repositories/http/budgetDeleteWriteExperiment";
import { dryRunBudgetOccurrenceBatch, writeBudgetOccurrenceBatch } from "../repositories/http/budgetSnapshotOccurrenceBatchWrite";
import { formatBudgetDefinitionOrdinal } from "../utils/budgetDefinitionFormatting";
import { isExpenseBudgetAmount } from "../utils/budgetAmountColor";
import { definitionDisplayTarget } from "../utils/budgetDisplayTarget";
import { useAccountImageUrls } from "../hooks/useAccountImageUrls";
import { budgetDefinitionIncomeForYear, normalizeBudgetDefinitionTransaction } from "../utils/budgetDefinitionIncome";

type DependencySummary = { persistedOccurrenceCount: number; transactionDependencyCount: number };
type BudgetWithDependencies = Budget & { definitionDependencySummary?: DependencySummary };
type SnapshotWithDependencies = BudgetSnapshot & DefinitionOccurrence;

const localDay = (value: Date | string) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; };
const bool = (value: unknown) => value === true || value === 1 || value === "1";
const rows = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : ((value as { rows?: T[] })?.rows ?? []);
const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const readAllRows = async <T,>(
  list: (options: { limit: number; offset: number }) => Promise<unknown>,
  maximum = 5_000,
): Promise<T[]> => {
  const all: T[] = [];
  let expected: number | undefined;
  while (all.length < maximum) {
    const response = await list({ limit: Math.min(200, maximum - all.length), offset: all.length });
    const page = rows<T>(response);
    expected ??= Number((response as { count?: number }).count ?? NaN);
    all.push(...page);
    if (page.length === 0 || (Number.isFinite(expected) && all.length >= expected)) break;
  }
  return all;
};
const details = (budget: Budget) => {
  const value = budget.frequencyDetails as unknown;
  if (typeof value !== "string") return value as { dayOfWeek?: number; dayOfMonth?: number; intervalDays?: number } | undefined;
  try { return JSON.parse(value) as { dayOfWeek?: number; dayOfMonth?: number; intervalDays?: number }; } catch { return undefined; }
};
const frequencyChip = (budget: Budget) => budget.frequency === "custom" ? "Custom" : budget.frequency[0].toUpperCase() + budget.frequency.slice(1);
const scheduleChip = (budget: Budget) => {
  const detail = details(budget);
  if (budget.frequency === "weekly") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][detail?.dayOfWeek ?? budget.dueDate.getDay()];
  if (budget.frequency === "monthly") return formatBudgetDefinitionOrdinal(detail?.dayOfMonth ?? budget.dueDate.getDate());
  if (budget.frequency === "yearly") return budget.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (budget.frequency === "custom") return `Every ${detail?.intervalDays ?? 1} days`;
  return null;
};
const normalizeBudget = (value: any): BudgetWithDependencies => ({ ...value, id: Number(value.id), categoryId: Number(value.categoryId), accountId: value.accountId == null ? undefined : Number(value.accountId), recipientId: value.recipientId == null ? undefined : Number(value.recipientId), amount: Number(value.amount), transactionCost: value.transactionCost == null ? undefined : Number(value.transactionCost), isGoal: bool(value.isGoal), isFlexible: bool(value.isFlexible), isActive: bool(value.isActive), dueDate: new Date(value.dueDate), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), ...(value.definitionDependencySummary ? { definitionDependencySummary: { persistedOccurrenceCount: Number(value.definitionDependencySummary.persistedOccurrenceCount), transactionDependencyCount: Number(value.definitionDependencySummary.transactionDependencyCount) } } : {}) });
const normalizeSnapshot = (value: any): SnapshotWithDependencies => ({ ...value, id: Number(value.id), budgetId: Number(value.budgetId), categoryId: Number(value.categoryId), accountId: value.accountId == null ? undefined : Number(value.accountId), recipientId: value.recipientId == null ? undefined : Number(value.recipientId), amount: Number(value.amount), transactionCost: value.transactionCost == null ? undefined : Number(value.transactionCost), isGoal: bool(value.isGoal), isFlexible: bool(value.isFlexible), isHistorical: bool(value.isHistorical), isActive: value.isActive == null ? undefined : bool(value.isActive), occurrenceDate: new Date(value.occurrenceDate), dueDate: new Date(value.dueDate), sourceBudgetUpdatedAt: new Date(value.sourceBudgetUpdatedAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt), ...(value.occurrenceDependencySummary ? { occurrenceDependencySummary: { linkedTransactionCount: Number(value.occurrenceDependencySummary.linkedTransactionCount), linkedTransactionTotal: Number(value.occurrenceDependencySummary.linkedTransactionTotal ?? 0), ambiguousLegacyReferenceCount: Number(value.occurrenceDependencySummary.ambiguousLegacyReferenceCount) } } : {}) });

const BudgetDefinitions: React.FC = () => {
  const history = useHistory();
  const runtime = useLocalSqliteRuntime();
  const backend = getRepositoryBackend();
  const [budgets, setBudgets] = useState<BudgetWithDependencies[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<BudgetWithDependencies | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotWithDependencies[]>([]);
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      if (isLocalSqliteBackend(backend)) {
        const repositories = getSelectedReadRepositories(backend);
        const [b, s, t, a, c, r, bucketRows] = await Promise.all([
          repositories.budgets.list({ limit: 500, includeDefinitionDependencies: true }), repositories.budgetSnapshots.list({ limit: 500 }), readAllRows<unknown>(repositories.transactions.list), repositories.accounts.list({ limit: 500 }), repositories.categories.list({ limit: 500 }), repositories.recipients.list({ limit: 500 }), repositories.buckets.list({ limit: 500 }),
        ]);
        const legacySnapshots = rows<BudgetSnapshot>(s);
        const legacyTransactions = (Array.isArray(t) ? t : rows<unknown>(t))
          .map(normalizeBudgetDefinitionTransaction)
          .filter((transaction): transaction is Transaction => transaction !== undefined);
        setBudgets(rows<any>(b).map(normalizeBudget).map((budget) => ({ ...budget, definitionDependencySummary: budget.definitionDependencySummary ?? { persistedOccurrenceCount: legacySnapshots.filter((snapshot) => snapshot.budgetId === budget.id).length, transactionDependencyCount: legacyTransactions.filter((transaction) => transaction.budgetId === budget.id || legacySnapshots.some((snapshot) => snapshot.budgetId === budget.id && snapshot.id === transaction.budgetSnapshotId)).length } })));
        setAccounts(rows<Account>(a)); setCategories(rows<Category>(c)); setRecipients(rows<Recipient>(r)); setBuckets(rows<Bucket>(bucketRows)); setTransactions(legacyTransactions);
      } else {
        const [b, s, t, a, c, r, bucketRows] = await Promise.all([db.budgets.toArray(), db.budgetSnapshots.toArray(), db.transactions.toArray(), db.accounts.toArray(), db.categories.toArray(), db.recipients.toArray(), db.buckets.toArray()]);
        setBudgets(b.map((budget) => ({ ...budget, definitionDependencySummary: { persistedOccurrenceCount: s.filter((snapshot) => snapshot.budgetId === budget.id).length, transactionDependencyCount: t.filter((transaction) => transaction.budgetId === budget.id || s.some((snapshot) => snapshot.budgetId === budget.id && snapshot.id === transaction.budgetSnapshotId)).length } })));
        setAccounts(a); setCategories(c); setRecipients(r); setBuckets(bucketRows); setTransactions(t);
      }
    } catch { setError("Failed to load Budget definitions."); } finally { setLoading(false); }
  };
  useIonViewWillEnter(() => { void load(); });

  const openOccurrences = async (budget: BudgetWithDependencies) => {
    setSelected(budget); setSnapshots([]); setLoadingOccurrences(true); setError("");
    try {
      if (isLocalSqliteBackend(backend)) {
        const repositories = getSelectedReadRepositories(backend);
        const all: SnapshotWithDependencies[] = [];
        let offset = 0;
        let count = 0;
        do {
          const response = await repositories.budgetSnapshots.listForBudget(budget.id!, { limit: 500, offset, includeOccurrenceDependencies: true });
          const page = rows<any>(response).map(normalizeSnapshot);
          all.push(...page); count = Number((response as { count?: number }).count ?? all.length); offset += page.length;
          if (page.length === 0 && all.length < count) throw new Error("incomplete_occurrence_page");
        } while (all.length < count);
        setSnapshots(all);
      } else {
        setSnapshots((await db.budgetSnapshots.where("budgetId").equals(budget.id!).toArray()).map((snapshot) => ({ ...snapshot, occurrenceDependencySummary: { linkedTransactionCount: 0, ambiguousLegacyReferenceCount: 0 } })));
      }
    } catch { setError("Failed to load persisted occurrences for this Budget definition."); } finally { setLoadingOccurrences(false); }
  };
  const summary = (budget: BudgetWithDependencies): DependencySummary => budget.definitionDependencySummary ?? { persistedOccurrenceCount: 0, transactionDependencyCount: 0 };
  const submitLifecycle = async (budget: Budget, isActive: boolean) => {
    if (!runtime.budgetLifecycleWritesAvailable) { setError("Budget definition changes are currently unavailable."); return; }
    const reactivationMode = !budget.isActive && isActive ? window.prompt("Reactivate Budget definition: type RESUME or BACKFILL.")?.trim().toLowerCase() : undefined;
    if (!budget.isActive && isActive && reactivationMode !== "resume" && reactivationMode !== "backfill") return;
    const input = { id: budget.id!, description: budget.description, categoryId: budget.categoryId, accountId: budget.accountId!, recipientId: budget.recipientId ?? null, amount: budget.amount, transactionCost: budget.transactionCost ?? null, frequency: budget.frequency, frequencyDetails: budget.frequencyDetails ?? null, isGoal: budget.isGoal, isFlexible: budget.isFlexible, goalPercentage: budget.goalPercentage ?? null, goalDirection: budget.goalDirection ?? null, remainingCyclesTotal: budget.remainingCyclesTotal ?? null, dueDate: budget.dueDate.toISOString(), isActive, asOf: localDay(new Date()).toISOString().slice(0, 10), ...(reactivationMode ? { reactivationMode: reactivationMode as "resume" | "backfill" } : {}) };
    const review = await dryRunBudgetLifecycle("update", input);
    if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} this Budget definition? Existing occurrences remain unchanged.`)) return;
    await writeBudgetLifecycle("update", input, review.planFingerprint!); await load();
  };
  const deleteDefinition = async (budget: BudgetWithDependencies) => {
    const dependency = summary(budget);
    if (dependency.persistedOccurrenceCount > 0 || dependency.transactionDependencyCount > 0) return;
    if (!runtime.budgetDeleteWritesAvailable) { setError("Budget definition deletion is currently unavailable."); return; }
    const review = await dryRunBudgetDelete(budget.id!);
    if (!window.confirm("Delete this Budget definition? It has no persisted occurrences or Transaction dependencies.")) return;
    await writeBudgetDelete(budget.id!, review.planFingerprint!); await load();
  };
  const batch = async (action: "setActive" | "delete", snapshotIds: number[], isActive?: boolean) => {
    if (!selected || !runtime.budgetSnapshotOccurrenceWritesAvailable) throw new Error("occurrence_writes_unavailable");
    const input = { action, budgetId: selected.id!, snapshotIds, ...(action === "setActive" ? { isActive } : {}) } as const;
    const review = await dryRunBudgetOccurrenceBatch(input);
    const message = action === "delete" ? `Delete ${snapshotIds.length} Budget occurrence(s)? This cannot be undone.` : `${isActive ? "Activate" : "Deactivate"} ${snapshotIds.length} Budget occurrence(s)?`;
    if (!window.confirm(message)) return;
    await writeBudgetOccurrenceBatch(input, review.planFingerprint!); await openOccurrences(selected); await load();
  };
  const orderedBudgets = useMemo(() => [...budgets].sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime()), [budgets]);
  const accountName = (id: number | undefined) => accounts.find((account) => account.id === id)?.name ?? "—";
  const recipientName = (id: number | undefined) => recipients.find((recipient) => recipient.id === id)?.name ?? "—";
  const { imageUrls: accountImages } = useAccountImageUrls(accounts);
  const isExpense = (budget: Budget) => budget.goalDirection === "expense" || (budget.goalDirection !== "income" && budget.amount < 0);
  const incomeForYear = (year: number) => budgetDefinitionIncomeForYear(transactions, categories, buckets, year);

  return <IonPage><IonHeader><IonToolbar><IonButtons slot="start"><IonMenuButton /></IonButtons><IonTitle>Budget Definitions</IonTitle><IonButtons slot="end"><IonButton onClick={() => history.push("/budget/history")} title="Budget History"><IonIcon icon={timeOutline} /></IonButton></IonButtons></IonToolbar></IonHeader><IonContent className="ion-padding">
    {loading && <IonSpinner />}{error && <IonText color="danger"><p>{error}</p></IonText>}
    <IonList>{orderedBudgets.map((budget) => {
      const dependency = summary(budget); const deletable = dependency.persistedOccurrenceCount === 0 && dependency.transactionDependencyCount === 0;
      return <IonItem key={budget.id}><IonGrid style={{ width: "100%" }}><IonRow>
        <IonCol size="1" className="date-column"><h2><div className="date-column-weekday">{budget.dueDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</div><div className="date-column-day">{budget.dueDate.toLocaleDateString("en-US", { day: "2-digit" })}</div><div className="date-column-month">{budget.dueDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</div></h2></IonCol>
        <IonCol size="7"><h3 className="item-description"><button type="button" onClick={() => { void openOccurrences(budget); }} title="View Budget occurrences" style={{ padding: 0, border: 0, background: "none", color: "inherit", font: "inherit", cursor: "pointer", textAlign: "left" }}>{budget.description}</button></h3>
          <IonRow><IonCol size="1.5"><IonAvatar style={{ width: "40px", height: "40px" }} title={accountName(budget.accountId)}>{accountImages.get(budget.accountId ?? -1) ? <IonImg src={accountImages.get(budget.accountId ?? -1)} alt={accountName(budget.accountId)} /> : <div style={{ width: "100%", height: "100%", backgroundColor: "#ccc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem" }}>{accountName(budget.accountId).charAt(0)}</div>}</IonAvatar></IonCol><IonCol><div className="item-metadata"><IonIcon icon={isExpense(budget) ? arrowUpCircle : arrowDownCircle} className={`item-metadata-icon ${isExpense(budget) ? "expense" : "income"}`} />{recipientName(budget.recipientId)}</div><div style={{ marginTop: "4px" }}><IonChip color="primary" style={{ fontSize: "0.75rem", height: "20px" }}><IonLabel>{frequencyChip(budget)}</IonLabel></IonChip>{scheduleChip(budget) && <IonChip color="primary" style={{ fontSize: "0.75rem", height: "20px" }}><IonLabel>{scheduleChip(budget)}</IonLabel></IonChip>}</div></IonCol></IonRow>
        </IonCol>
        <IonCol size="4" style={{ textAlign: "right", display: "flex", flexDirection: "column", justifyContent: "space-between" }}><div style={{ fontSize: "1.2rem", fontWeight: "bold", color: isExpenseBudgetAmount(budget) ? "#eb445c" : "#009688" }}>{money(definitionDisplayTarget(budget, incomeForYear(budget.dueDate.getFullYear())))}</div>
          <IonRow className="item-actions"><IonCol className="item-actions-container"><IonButton fill="clear" title="Edit Budget definition" aria-label="Edit Budget definition" onClick={() => history.push(`/budget/edit/${budget.id}`)}><IonIcon icon={createOutline} /></IonButton><IonButton fill="clear" title={`${budget.isActive ? "Deactivate" : "Activate"} Budget definition`} aria-label={`${budget.isActive ? "Deactivate" : "Activate"} Budget definition`} onClick={() => { void submitLifecycle(budget, !budget.isActive); }}><IonIcon color={budget.isActive ? "success" : "medium"} icon={budget.isActive ? checkmarkCircleOutline : closeCircleOutline} /></IonButton><IonButton fill="clear" color="danger" disabled={!deletable} title={deletable ? "Delete Budget definition" : "Delete unavailable: persisted occurrences or Transactions exist"} aria-label="Delete Budget definition" onClick={() => { void deleteDefinition(budget); }}><IonIcon icon={trashOutline} /></IonButton></IonCol></IonRow>
        </IonCol>
      </IonRow></IonGrid></IonItem>;
    })}</IonList>
    <DefinitionOccurrencesModal isOpen={selected !== null} budget={selected} snapshots={snapshots} categories={categories} recipients={recipients} incomeForYear={incomeForYear} loading={loadingOccurrences} busy={busy} onClose={() => { setSelected(null); setSnapshots([]); }} onSetActive={(ids, isActive) => batch("setActive", ids, isActive)} onDelete={(ids) => batch("delete", ids)} />
  </IonContent></IonPage>;
};

export default BudgetDefinitions;

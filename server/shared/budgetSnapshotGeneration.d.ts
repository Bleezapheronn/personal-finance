export type BudgetFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export interface BudgetGenerationDefinition {
  id?: number;
  description: string;
  categoryId: number;
  accountId?: number | null;
  recipientId?: number | null;
  amount: number;
  transactionCost?: number | null;
  frequency: BudgetFrequency;
  frequencyDetails?: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalDays?: number;
  } | null;
  isGoal: boolean | number;
  isFlexible?: boolean | number | null;
  goalPercentage?: number | null;
  goalDirection?: "income" | "expense" | null;
  isActive: boolean | number;
  remainingCyclesTotal?: number | null;
  dueDate: Date | string;
  updatedAt: Date | string;
}

export interface ExistingSnapshotIdentity {
  id?: number;
  budgetId: number;
  occurrenceDate: Date | string;
  dueDate: Date | string;
}

export interface BudgetSnapshotGenerationValues {
  budgetId: number;
  occurrenceDate: Date;
  dueDate: Date;
  cycleIndex: number;
  description: string;
  categoryId: number;
  accountId?: number | null;
  recipientId?: number | null;
  amount: number;
  transactionCost?: number | null;
  frequency: BudgetFrequency;
  frequencyDetails?: BudgetGenerationDefinition["frequencyDetails"];
  isGoal: boolean;
  isFlexible: boolean;
  goalPercentage?: number | null;
  goalDirection?: "income" | "expense" | null;
  remainingCyclesTotal: number | null;
  isHistorical: boolean;
  sourceBudgetUpdatedAt: Date | string;
}

export interface BudgetSnapshotGenerationCandidate {
  identityKey: string;
  values: BudgetSnapshotGenerationValues;
}

export interface BudgetSnapshotGenerationPlan {
  normalizedAsOf: string;
  normalizedAsOfDate: Date;
  activeHorizon: string;
  eligibleBudgetCount: number;
  existingSnapshotCount: number;
  proposedSnapshotCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  conflictCodes: string[];
  validationErrors: string[];
  recurrenceSummary: Record<string, number>;
  goalDirectionSummary: { expense: number; income: number; fallback: number };
  candidates: BudgetSnapshotGenerationCandidate[];
}

export const normalizeToLocalDay: (value: Date | string) => Date;
export const localDayKey: (value: Date | string) => string;
export const addLocalCalendarYear: (value: Date | string) => Date;
export const getBudgetMaxCycles: (
  budget: Pick<BudgetGenerationDefinition, "remainingCyclesTotal">,
) => number;
export const getNextBudgetOccurrence: (
  currentDate: Date | string,
  budget: Pick<BudgetGenerationDefinition, "frequency" | "frequencyDetails">,
) => Date;
export const calculateBudgetOccurrenceSchedule: (
  budget: BudgetGenerationDefinition,
  horizonDate: Date | string,
  guardLimit?: number,
) => Array<{ occurrenceDate: Date; cycleIndex: number }>;
export const effectiveGoalDirection: (
  goalDirection: "income" | "expense" | null | undefined,
  amount: number,
) => "income" | "expense";
export const buildBudgetSnapshotValues: (
  budget: BudgetGenerationDefinition,
  occurrenceDate: Date | string,
  cycleIndex: number,
  isHistorical: boolean,
) => BudgetSnapshotGenerationValues;
export const calculateMissingBudgetSnapshotPlan: (input: {
  budgets: BudgetGenerationDefinition[];
  existingSnapshots: ExistingSnapshotIdentity[];
  asOf: Date | string;
}) => BudgetSnapshotGenerationPlan;

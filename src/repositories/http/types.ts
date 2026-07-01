export type ApiBudgetFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export interface ApiListResponse<Row> {
  ok: true;
  mode: "prototype";
  readonly: true;
  resource?: string;
  limit: number;
  offset: number;
  count: number;
  rows: Row[];
}

export interface ApiCountResponse {
  ok: true;
  mode: "prototype";
  readonly: true;
  count: number;
}

export interface TransactionDto {
  id: number;
  categoryId: number;
  paymentChannelId?: number | null;
  accountId?: number | null;
  recipientId: number;
  date: string;
  amount: number;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  exchangeRate?: number | null;
  transactionReference?: string | null;
  transactionCost?: number | null;
  description?: string | null;
  transferPairId?: number | null;
  isTransfer?: number | boolean | null;
  budgetId?: number | null;
  occurrenceDate?: string | null;
  budgetSnapshotId?: number | null;
}

export interface AccountDto {
  id: number;
  name: string;
  description?: string | null;
  currency?: string | null;
  imageMimeType?: string | null;
  isActive: number | boolean;
  isCredit: number | boolean;
  creditLimit?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BucketDto {
  id: number;
  name?: string | null;
  description?: string | null;
  minPercentage: number;
  maxPercentage: number;
  minFixedAmount?: number | null;
  isActive: number | boolean;
  displayOrder: number;
  excludeFromReports: number | boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: number;
  name?: string | null;
  bucketId: number;
  description?: string | null;
  isActive: number | boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientDto {
  id: number;
  name: string;
  aliases?: string | null;
  email?: string | null;
  phone?: string | null;
  tillNumber?: string | null;
  paybill?: string | null;
  accountNumber?: string | null;
  description?: string | null;
  isActive: number | boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetDto {
  id: number;
  description: string;
  categoryId: number;
  paymentChannelId?: number | null;
  accountId?: number | null;
  recipientId?: number | null;
  amount: number;
  transactionCost?: number | null;
  frequency: ApiBudgetFrequency;
  frequencyDetails?: string | null;
  isGoal: number | boolean;
  isFlexible: number | boolean;
  goalPercentage?: number | null;
  goalDirection?: "income" | "expense" | null;
  isActive: number | boolean;
  remainingCyclesTotal?: number | null;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetSnapshotDto {
  id: number;
  budgetId: number;
  occurrenceDate: string;
  dueDate: string;
  cycleIndex: number;
  description: string;
  categoryId: number;
  accountId?: number | null;
  recipientId?: number | null;
  amount: number;
  transactionCost?: number | null;
  frequency: ApiBudgetFrequency;
  frequencyDetails?: string | null;
  isGoal: number | boolean;
  isFlexible: number | boolean;
  goalPercentage?: number | null;
  goalDirection?: "income" | "expense" | null;
  remainingCyclesTotal?: number | null;
  isHistorical: number | boolean;
  sourceBudgetUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

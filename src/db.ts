import Dexie from "dexie";

// Define TypeScript interfaces for each table

export interface Transaction {
  id?: number;
  categoryId: number;
  paymentChannelId: number;
  recipientId: number;
  date: Date;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  transactionReference?: string;
  transactionCost?: number;
  description?: string;
  transferPairId?: number; // Links the two transactions in a transfer
  isTransfer?: boolean; // Flag to identify transfer transactions
}

export interface Bucket {
  id?: number;
  name?: string;
  description?: string;
  minPercentage: number;
  maxPercentage: number;
  minFixedAmount?: number;
  isActive: boolean;
  displayOrder: number; // NEW: controls sort order (1, 2, 3, etc.)
  excludeFromReports: boolean; // NEW: hide from reports view
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id?: number;
  name?: string;
  bucketId: number;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id?: number;
  name: string;
  description?: string;
  currency?: string;
  // store uploaded image as a Blob so we can keep it fully local
  imageBlob?: Blob | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethod {
  id?: number;
  accountId: number;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Recipient {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  tillNumber?: string;
  paybill?: string;
  accountNumber?: string;
  description?: string; // NEW: optional description field
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsImportTemplate {
  id?: number;
  name: string;
  description?: string;
  paymentMethodId?: number;
  referencePattern?: string;
  amountPattern?: string;
  recipientNamePattern?: string;
  recipientPhonePattern?: string;
  dateTimePattern?: string;
  costPattern?: string;
  incomePattern?: string;
  expensePattern?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Define your database class with all tables

export class FinanceDB extends Dexie {
  transactions: Dexie.Table<Transaction, number>;
  buckets: Dexie.Table<Bucket, number>;
  categories: Dexie.Table<Category, number>;
  accounts: Dexie.Table<Account, number>;
  paymentMethods: Dexie.Table<PaymentMethod, number>;
  recipients: Dexie.Table<Recipient, number>;
  smsImportTemplates: Dexie.Table<SmsImportTemplate, number>;

  constructor() {
    super("FinanceDB");

    this.version(8).stores({
      transactions:
        "++id, categoryId, paymentChannelId, recipientId, date, amount, originalAmount, originalCurrency, exchangeRate, transactionReference, description, transferPairId, isTransfer",
      buckets:
        "++id, name, description, minPercentage, maxPercentage, minFixedAmount, isActive, displayOrder, excludeFromReports, createdAt, updatedAt",
      categories:
        "++id, name, bucketId, description, isActive, createdAt, updatedAt",
      accounts:
        "++id, name, currency, description, isActive, createdAt, updatedAt",
      paymentMethods:
        "++id, accountId, name, description, isActive, createdAt, updatedAt",
      recipients:
        "++id, name, email, phone, tillNumber, paybill, accountNumber, isActive, createdAt, updatedAt",
      smsImportTemplates:
        "++id, name, paymentMethodId, description, isActive, createdAt, updatedAt",
    });

    this.transactions = this.table("transactions");
    this.buckets = this.table("buckets");
    this.categories = this.table("categories");
    this.accounts = this.table("accounts");
    this.paymentMethods = this.table("paymentMethods");
    this.recipients = this.table("recipients");
    this.smsImportTemplates = this.table("smsImportTemplates");
  }
}

// Export a singleton db instance
export const db = new FinanceDB();

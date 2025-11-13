import Dexie from "dexie";

// Define your database
export class FinanceDB extends Dexie {
  transactions: Dexie.Table<Transaction, number>;

  constructor() {
    super("FinanceDB");
    this.version(2).stores({
      transactions:
        "++id, date, amount, transactionCost, category, paymentMode, paymentChannel, description, recipient",
    });
    this.transactions = this.table("transactions");
  }
}

// Define the type for your transactions
export interface Transaction {
  id?: number;
  date: Date;
  amount: number;
  transactionCost?: number;
  category: string;
  paymentMode: string;
  paymentChannel?: string;
  description?: string;
  recipient?: string;
}

// Export a singleton db instance
export const db = new FinanceDB();

-- Personal Finance local API SQLite prototype schema draft.
-- Draft only: do not treat this as production migration approval.
-- Dexie / IndexedDB remains authoritative until a separate migration is approved.
-- Importers must preserve IDs from the full JSON backup; do not rely on generated IDs.
-- Relationship comments are intentionally preferred over strict foreign keys for now
-- because legacy/restored data may need importer validation before constraints harden.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  categoryId INTEGER NOT NULL,
  paymentChannelId INTEGER,
  accountId INTEGER,
  recipientId INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  originalAmount REAL,
  originalCurrency TEXT,
  exchangeRate REAL,
  transactionReference TEXT,
  transactionCost REAL,
  description TEXT,
  transferPairId INTEGER,
  isTransfer INTEGER,
  budgetId INTEGER,
  occurrenceDate TEXT,
  budgetSnapshotId INTEGER
  -- categoryId references categories.id.
  -- accountId references accounts.id.
  -- recipientId references recipients.id.
  -- transferPairId references transactions.id and must be reciprocal for transfers.
  -- budgetSnapshotId references budgetSnapshots.id and is canonical where present.
  -- budgetId is legacy/secondary when budgetSnapshotId exists.
  -- paymentChannelId is a legacy migration field.
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  categoryId INTEGER NOT NULL,
  paymentChannelId INTEGER,
  accountId INTEGER,
  recipientId INTEGER,
  amount REAL NOT NULL,
  transactionCost REAL,
  frequency TEXT NOT NULL,
  frequencyDetails TEXT,
  isGoal INTEGER NOT NULL,
  isFlexible INTEGER NOT NULL,
  goalPercentage REAL,
  goalDirection TEXT,
  isActive INTEGER NOT NULL,
  remainingCyclesTotal INTEGER,
  dueDate TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- categoryId references categories.id.
  -- accountId references accounts.id.
  -- recipientId references recipients.id.
  -- frequencyDetails stores JSON text.
  -- paymentChannelId is a legacy migration field.
);

CREATE TABLE IF NOT EXISTS budgetSnapshots (
  id INTEGER PRIMARY KEY,
  budgetId INTEGER NOT NULL,
  occurrenceDate TEXT NOT NULL,
  dueDate TEXT NOT NULL,
  cycleIndex INTEGER NOT NULL,
  description TEXT NOT NULL,
  categoryId INTEGER NOT NULL,
  accountId INTEGER,
  recipientId INTEGER,
  amount REAL NOT NULL,
  transactionCost REAL,
  frequency TEXT NOT NULL,
  frequencyDetails TEXT,
  isGoal INTEGER NOT NULL,
  isFlexible INTEGER NOT NULL,
  goalPercentage REAL,
  goalDirection TEXT,
  remainingCyclesTotal INTEGER,
  isHistorical INTEGER NOT NULL,
  sourceBudgetUpdatedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- budgetId references budgets.id, but orphaned historical/restored rows must be
  -- validated before hard constraints are enabled.
  -- categoryId references categories.id.
  -- accountId references accounts.id.
  -- recipientId references recipients.id.
  -- frequencyDetails stores JSON text.
);

CREATE TABLE IF NOT EXISTS buckets (
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  minPercentage REAL NOT NULL,
  maxPercentage REAL NOT NULL,
  minFixedAmount REAL,
  isActive INTEGER NOT NULL,
  displayOrder INTEGER NOT NULL,
  excludeFromReports INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT,
  bucketId INTEGER NOT NULL,
  description TEXT,
  isActive INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- bucketId references buckets.id.
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT,
  imageBlob BLOB,
  imageMimeType TEXT,
  isActive INTEGER NOT NULL,
  isCredit INTEGER NOT NULL,
  creditLimit REAL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- imageMimeType is a draft helper for restoring account images. The current
  -- Dexie model stores imageBlob but does not expose a separate MIME column.
);

CREATE TABLE IF NOT EXISTS paymentMethods (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  isActive INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- accountId references accounts.id.
  -- This is a legacy/migration table kept for backup parity.
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  email TEXT,
  phone TEXT,
  tillNumber TEXT,
  paybill TEXT,
  accountNumber TEXT,
  description TEXT,
  isActive INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- aliases is currently a semicolon-separated string in Dexie, not JSON.
);

CREATE TABLE IF NOT EXISTS smsImportTemplates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  paymentMethodId INTEGER,
  accountId INTEGER,
  referencePattern TEXT,
  amountPattern TEXT,
  recipientNamePattern TEXT,
  recipientPhonePattern TEXT,
  dateTimePattern TEXT,
  costPattern TEXT,
  incomePattern TEXT,
  expensePattern TEXT,
  isActive INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
  -- accountId references accounts.id.
  -- paymentMethodId is a legacy migration field.
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_accountId ON transactions(accountId);
CREATE INDEX IF NOT EXISTS idx_transactions_categoryId ON transactions(categoryId);
CREATE INDEX IF NOT EXISTS idx_transactions_recipientId ON transactions(recipientId);
CREATE INDEX IF NOT EXISTS idx_transactions_budgetSnapshotId ON transactions(budgetSnapshotId);
CREATE INDEX IF NOT EXISTS idx_transactions_transferPairId ON transactions(transferPairId);

CREATE INDEX IF NOT EXISTS idx_budgetSnapshots_budgetId ON budgetSnapshots(budgetId);
CREATE INDEX IF NOT EXISTS idx_budgetSnapshots_dueDate ON budgetSnapshots(dueDate);

CREATE INDEX IF NOT EXISTS idx_categories_bucketId ON categories(bucketId);
CREATE INDEX IF NOT EXISTS idx_smsImportTemplates_accountId ON smsImportTemplates(accountId);

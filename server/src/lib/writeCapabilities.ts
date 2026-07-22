import {
  areAccountWritesEnabled,
  areBudgetDefinitionWritesEnabled,
  areBudgetSnapshotGenerationWritesEnabled,
  areBucketCategoryWritesEnabled,
  areRecipientActiveStateWritesEnabled,
  areRecipientCreateUpdateWritesEnabled,
  areSmsTemplateWritesEnabled,
  areTransactionBasicWritesEnabled,
  areTransactionCostBudgetWritesEnabled,
  areTransactionTransferWritesEnabled,
} from "../config.js";

export const WRITE_CAPABILITY_KEYS = [
  "recipientActiveStateWrites",
  "recipientCreateUpdateWrites",
  "bucketCategoryWrites",
  "accountWrites",
  "transactionBasicWrites",
  "transactionCostBudgetWrites",
  "transactionTransferWrites",
  "smsTemplateWrites",
  "budgetDefinitionWrites",
  "budgetSnapshotGenerationWrites",
] as const;

export type WriteCapabilityKey = (typeof WRITE_CAPABILITY_KEYS)[number];
export type WriteCapabilities = Record<WriteCapabilityKey, boolean>;

export const SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS = [
  "recipient_delete",
  "recipient_merge",
  "recipient_reference_reassignment",
  "bucket_category_delete",
  "bucket_reorder",
  "bucket_category_active_state",
  "account_delete",
  "account_merge",
  "account_active_state",
  "account_reference_migration",
  "transaction_delete",
  "transaction_duplicate_import_export",
  "transfer_pair_repair",
  "budget_definition_delete",
  "budget_snapshot_editing",
  "budget_snapshot_deletion",
  "budget_snapshot_pruning",
  "budget_snapshot_repair",
  "historical_snapshot_relink",
  "sms_parse_or_import",
] as const;

export const readWriteCapabilities = (): WriteCapabilities => ({
  recipientActiveStateWrites: areRecipientActiveStateWritesEnabled(),
  recipientCreateUpdateWrites: areRecipientCreateUpdateWritesEnabled(),
  bucketCategoryWrites: areBucketCategoryWritesEnabled(),
  accountWrites: areAccountWritesEnabled(),
  transactionBasicWrites: areTransactionBasicWritesEnabled(),
  transactionCostBudgetWrites: areTransactionCostBudgetWritesEnabled(),
  transactionTransferWrites: areTransactionTransferWritesEnabled(),
  smsTemplateWrites: areSmsTemplateWritesEnabled(),
  budgetDefinitionWrites: areBudgetDefinitionWritesEnabled(),
  budgetSnapshotGenerationWrites:
    areBudgetSnapshotGenerationWritesEnabled(),
});

export const buildWriteCapabilitiesResponse = (sqliteAvailable: boolean) => ({
  ok: true,
  mode: "prototype" as const,
  storageMode: "sqlite-disposable" as const,
  authoritative: false as const,
  capabilities: readWriteCapabilities(),
  unsupportedOperations: [...SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS],
  safety: {
    endpointReadOnly: true as const,
    sqliteAvailable,
    dexieAccessed: false as const,
    filesWritten: false as const,
    rawConfigurationIncluded: false as const,
  },
});

import {
  areAccountWritesEnabled,
  areAccountDeleteMergeWritesEnabled,
  areCategoryDeleteMergeWritesEnabled,
  areBucketDeleteMergeWritesEnabled,
  areBudgetDefinitionWritesEnabled,
  areBudgetLifecycleWritesEnabled,
  areBudgetDeleteWritesEnabled,
  areBudgetSnapshotGenerationWritesEnabled,
  areBucketCategoryWritesEnabled,
  areRecipientActiveStateWritesEnabled,
  areRecipientCreateUpdateWritesEnabled,
  areRecipientDeleteMergeWritesEnabled,
  areSmsTemplateWritesEnabled,
  areTransactionBasicWritesEnabled,
  areTransactionCostBudgetWritesEnabled,
  areTransactionDeleteWritesEnabled,
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
export const OPTIONAL_WRITE_CAPABILITY_KEYS = [
  "transactionDeleteWrites",
  "budgetLifecycleWrites",
  "recipientDeleteMergeWrites",
  "accountDeleteMergeWrites",
  "categoryDeleteMergeWrites",
  "bucketDeleteMergeWrites",
  "budgetDeleteWrites",
] as const;
export type OptionalWriteCapabilityKey =
  (typeof OPTIONAL_WRITE_CAPABILITY_KEYS)[number];
export type WriteCapabilities = Record<WriteCapabilityKey, boolean> &
  Record<OptionalWriteCapabilityKey, boolean>;

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
  recipientDeleteMergeWrites: areRecipientDeleteMergeWritesEnabled(),
  accountDeleteMergeWrites: areAccountDeleteMergeWritesEnabled(),
  categoryDeleteMergeWrites: areCategoryDeleteMergeWritesEnabled(),
  bucketDeleteMergeWrites: areBucketDeleteMergeWritesEnabled(),
  bucketCategoryWrites: areBucketCategoryWritesEnabled(),
  accountWrites: areAccountWritesEnabled(),
  transactionBasicWrites: areTransactionBasicWritesEnabled(),
  transactionCostBudgetWrites: areTransactionCostBudgetWritesEnabled(),
  transactionTransferWrites: areTransactionTransferWritesEnabled(),
  transactionDeleteWrites: areTransactionDeleteWritesEnabled(),
  smsTemplateWrites: areSmsTemplateWritesEnabled(),
  budgetDefinitionWrites: areBudgetDefinitionWritesEnabled(),
  budgetSnapshotGenerationWrites:
    areBudgetSnapshotGenerationWritesEnabled(),
  budgetLifecycleWrites: areBudgetLifecycleWritesEnabled(),
  budgetDeleteWrites: areBudgetDeleteWritesEnabled(),
});

interface AuthorityStatusForCapabilities {
  authorityEnabled: boolean;
  storageMode: "sqlite-disposable" | "sqlite-authoritative";
  authoritative: boolean;
  cutoverVerified: boolean;
  backupVerified: boolean;
  rollbackAvailable: boolean;
  missingRequirements: string[];
}

export const buildWriteCapabilitiesResponse = (
  sqliteAvailable: boolean,
  authorityStatus?: AuthorityStatusForCapabilities,
) => ({
  ok: true,
  mode: "prototype" as const,
  storageMode: authorityStatus?.storageMode ?? ("sqlite-disposable" as const),
  authoritative: authorityStatus?.authoritative ?? false,
  cutoverVerified: authorityStatus?.cutoverVerified ?? false,
  backupVerified: authorityStatus?.backupVerified ?? false,
  rollbackAvailable: authorityStatus?.rollbackAvailable ?? false,
  missingRequirements: authorityStatus?.missingRequirements ?? [],
  capabilities: readWriteCapabilities(),
  unsupportedOperations: SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS.filter(
    (operation) => {
      if (operation === "transaction_delete") {
        return !areTransactionDeleteWritesEnabled();
      }
      if (
        operation === "recipient_delete" ||
        operation === "recipient_merge" ||
        operation === "recipient_reference_reassignment"
      ) {
        return !areRecipientDeleteMergeWritesEnabled();
      }
      if (
        operation === "account_delete" ||
        operation === "account_merge" ||
        operation === "account_reference_migration"
      ) {
        return !areAccountDeleteMergeWritesEnabled();
      }
      if (
        operation === "bucket_category_delete"
      ) {
        return !(
          areCategoryDeleteMergeWritesEnabled() ||
          areBucketDeleteMergeWritesEnabled()
        );
      }
      if (operation === "budget_definition_delete") {
        return !areBudgetDeleteWritesEnabled();
      }
      return true;
    },
  ),
  safety: {
    endpointReadOnly: true as const,
    sqliteAvailable,
    dexieAccessed: false as const,
    filesWritten: false as const,
    rawConfigurationIncluded: false as const,
  },
});

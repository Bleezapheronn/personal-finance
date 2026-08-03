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

export const OPTIONAL_WRITE_CAPABILITY_KEYS = [
  "transactionDeleteWrites",
  "budgetLifecycleWrites",
  "recipientDeleteMergeWrites",
  "accountDeleteMergeWrites",
  "categoryDeleteMergeWrites",
  "bucketDeleteMergeWrites",
  "budgetDeleteWrites",
  "budgetSnapshotOccurrenceWrites",
  "lookupActiveStateWrites",
  "bucketReorderWrites",
] as const;

export type WriteCapabilityKey = (typeof WRITE_CAPABILITY_KEYS)[number];
export type OptionalWriteCapabilityKey =
  (typeof OPTIONAL_WRITE_CAPABILITY_KEYS)[number];
export type WriteCapabilities = Record<WriteCapabilityKey, true> &
  Record<OptionalWriteCapabilityKey, true>;

export const readWriteCapabilities = (): WriteCapabilities =>
  Object.fromEntries(
    [...WRITE_CAPABILITY_KEYS, ...OPTIONAL_WRITE_CAPABILITY_KEYS].map((key) => [key, true]),
  ) as WriteCapabilities;

export const unsupportedOperationsForCapabilities = (): string[] => [
  "transaction_duplicate_import_export",
  "transfer_pair_repair",
  "budget_snapshot_editing",
  "budget_snapshot_pruning",
  "budget_snapshot_repair",
  "historical_snapshot_relink",
  "sms_parse_or_import",
];

export const buildWriteCapabilitiesResponse = (sqliteAvailable: boolean) => ({
  ok: true,
  mode: "local" as const,
  storageMode: "sqlite" as const,
  capabilities: readWriteCapabilities(),
  unsupportedOperations: unsupportedOperationsForCapabilities(),
  safety: {
    endpointReadOnly: true as const,
    sqliteAvailable,
    dexieAccessed: false as const,
    filesWritten: false as const,
    rawConfigurationIncluded: false as const,
  },
});

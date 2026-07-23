import {
  ACCOUNT_DELETE_MERGE_WRITES_ENV_VAR,
  ACCOUNT_WRITES_ENV_VAR,
  BUCKET_CATEGORY_WRITES_ENV_VAR,
  BUCKET_DELETE_MERGE_WRITES_ENV_VAR,
  BUDGET_DEFINITION_WRITES_ENV_VAR,
  BUDGET_DELETE_WRITES_ENV_VAR,
  BUDGET_LIFECYCLE_WRITES_ENV_VAR,
  BUDGET_SNAPSHOT_GENERATION_WRITES_ENV_VAR,
  CATEGORY_DELETE_MERGE_WRITES_ENV_VAR,
  RECIPIENT_ACTIVE_STATE_WRITES_ENV_VAR,
  RECIPIENT_CREATE_UPDATE_WRITES_ENV_VAR,
  RECIPIENT_DELETE_MERGE_WRITES_ENV_VAR,
  SMS_TEMPLATE_WRITES_ENV_VAR,
  TRANSACTION_BASIC_WRITES_ENV_VAR,
  TRANSACTION_COST_BUDGET_WRITES_ENV_VAR,
  TRANSACTION_DELETE_WRITES_ENV_VAR,
  TRANSACTION_TRANSFER_WRITES_ENV_VAR,
} from "../config.js";

export interface AuthorityOpsCapabilityDefinition {
  name: string;
  backendEnvironmentVariable: string;
  frontendEnvironmentVariable?: string;
  apiCapabilityField: string;
  authorityRequired: boolean;
  rehearsalAllowed: true;
  authoritativeAllowed: true;
  frontendPairGroup?: string;
}

export const AUTHORITY_OPS_CAPABILITIES = [
  {
    name: "recipientActiveStateWrites",
    backendEnvironmentVariable: RECIPIENT_ACTIVE_STATE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT",
    apiCapabilityField: "recipientActiveStateWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
    frontendPairGroup: "recipient-basic-writes",
  },
  {
    name: "recipientCreateUpdateWrites",
    backendEnvironmentVariable: RECIPIENT_CREATE_UPDATE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_RECIPIENTS_WRITE_EXPERIMENT",
    apiCapabilityField: "recipientCreateUpdateWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
    frontendPairGroup: "recipient-basic-writes",
  },
  {
    name: "bucketCategoryWrites",
    backendEnvironmentVariable: BUCKET_CATEGORY_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_WRITE_EXPERIMENT",
    apiCapabilityField: "bucketCategoryWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "accountWrites",
    backendEnvironmentVariable: ACCOUNT_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_ACCOUNTS_WRITE_EXPERIMENT",
    apiCapabilityField: "accountWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "transactionBasicWrites",
    backendEnvironmentVariable: TRANSACTION_BASIC_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_TRANSACTIONS_BASIC_WRITE_EXPERIMENT",
    apiCapabilityField: "transactionBasicWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "transactionCostBudgetWrites",
    backendEnvironmentVariable: TRANSACTION_COST_BUDGET_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_TRANSACTIONS_COST_BUDGET_WRITE_EXPERIMENT",
    apiCapabilityField: "transactionCostBudgetWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "transactionTransferWrites",
    backendEnvironmentVariable: TRANSACTION_TRANSFER_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_TRANSACTIONS_TRANSFER_WRITE_EXPERIMENT",
    apiCapabilityField: "transactionTransferWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "smsTemplateWrites",
    backendEnvironmentVariable: SMS_TEMPLATE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_SMS_TEMPLATES_WRITE_EXPERIMENT",
    apiCapabilityField: "smsTemplateWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "budgetDefinitionWrites",
    backendEnvironmentVariable: BUDGET_DEFINITION_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_BUDGETS_WRITE_EXPERIMENT",
    apiCapabilityField: "budgetDefinitionWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "budgetSnapshotGenerationWrites",
    backendEnvironmentVariable: BUDGET_SNAPSHOT_GENERATION_WRITES_ENV_VAR,
    apiCapabilityField: "budgetSnapshotGenerationWrites",
    authorityRequired: true,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "transactionDeleteWrites",
    backendEnvironmentVariable: TRANSACTION_DELETE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_TRANSACTIONS_DELETE_WRITE_EXPERIMENT",
    apiCapabilityField: "transactionDeleteWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "budgetLifecycleWrites",
    backendEnvironmentVariable: BUDGET_LIFECYCLE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_BUDGET_LIFECYCLE_WRITE_EXPERIMENT",
    apiCapabilityField: "budgetLifecycleWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "recipientDeleteMergeWrites",
    backendEnvironmentVariable: RECIPIENT_DELETE_MERGE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_RECIPIENT_DELETE_MERGE_WRITE_EXPERIMENT",
    apiCapabilityField: "recipientDeleteMergeWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "accountDeleteMergeWrites",
    backendEnvironmentVariable: ACCOUNT_DELETE_MERGE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_ACCOUNT_DELETE_MERGE_WRITE_EXPERIMENT",
    apiCapabilityField: "accountDeleteMergeWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "categoryDeleteMergeWrites",
    backendEnvironmentVariable: CATEGORY_DELETE_MERGE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_CATEGORY_DELETE_MERGE_WRITE_EXPERIMENT",
    apiCapabilityField: "categoryDeleteMergeWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "bucketDeleteMergeWrites",
    backendEnvironmentVariable: BUCKET_DELETE_MERGE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_BUCKET_DELETE_MERGE_WRITE_EXPERIMENT",
    apiCapabilityField: "bucketDeleteMergeWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
  {
    name: "budgetDeleteWrites",
    backendEnvironmentVariable: BUDGET_DELETE_WRITES_ENV_VAR,
    frontendEnvironmentVariable:
      "VITE_PERSONAL_FINANCE_BUDGET_DELETE_WRITE_EXPERIMENT",
    apiCapabilityField: "budgetDeleteWrites",
    authorityRequired: false,
    rehearsalAllowed: true,
    authoritativeAllowed: true,
  },
] as const satisfies readonly AuthorityOpsCapabilityDefinition[];

export type AuthorityOpsCapabilityName =
  (typeof AUTHORITY_OPS_CAPABILITIES)[number]["name"];

export const AUTHORITY_OPS_CAPABILITY_NAMES = AUTHORITY_OPS_CAPABILITIES.map(
  ({ name }) => name,
) as AuthorityOpsCapabilityName[];

export const AUTHORITY_REQUIRED_CAPABILITY_NAMES =
  AUTHORITY_OPS_CAPABILITIES.filter(({ authorityRequired }) => authorityRequired)
    .map(({ name }) => name) as AuthorityOpsCapabilityName[];

export const OPERATIONAL_READ_EXPERIMENT_FLAGS = [
  "VITE_PERSONAL_FINANCE_ACCOUNTS_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_RECIPIENTS_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_SMS_TEMPLATES_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_TRANSACTIONS_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_REPORTS_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_BUDGET_READ_EXPERIMENT",
  "VITE_PERSONAL_FINANCE_BUDGET_HISTORY_READ_EXPERIMENT",
] as const;

export const validateCapabilitySelection = (
  names: readonly string[],
  mode: "rehearsal" | "authoritative",
): AuthorityOpsCapabilityName[] => {
  const known = new Set<string>(AUTHORITY_OPS_CAPABILITY_NAMES);
  if (names.some((name) => !known.has(name))) {
    throw new Error("authority_profile_capability_unknown");
  }
  if (new Set(names).size !== names.length) {
    throw new Error("authority_profile_capability_duplicate");
  }
  const selected = new Set(names);
  const groups = new Map<string, string[]>();
  for (const capability of AUTHORITY_OPS_CAPABILITIES) {
    if (!("frontendPairGroup" in capability)) continue;
    const group = groups.get(capability.frontendPairGroup) ?? [];
    group.push(capability.name);
    groups.set(capability.frontendPairGroup, group);
  }
  for (const group of groups.values()) {
    const selectedCount = group.filter((name) => selected.has(name)).length;
    if (selectedCount !== 0 && selectedCount !== group.length) {
      throw new Error("authority_profile_capability_pair_incomplete");
    }
  }
  if (
    mode === "authoritative" &&
    AUTHORITY_REQUIRED_CAPABILITY_NAMES.some((name) => !selected.has(name))
  ) {
    throw new Error("authority_profile_required_capability_missing");
  }
  return [...names] as AuthorityOpsCapabilityName[];
};

export const buildCapabilityEnvironment = (
  enabledNames: readonly AuthorityOpsCapabilityName[],
): { backend: Record<string, string>; frontend: Record<string, string> } => {
  const selected = new Set<string>(enabledNames);
  const backend: Record<string, string> = {};
  const frontend: Record<string, string> = {};
  for (const capability of AUTHORITY_OPS_CAPABILITIES) {
    const enabled = selected.has(capability.name);
    backend[capability.backendEnvironmentVariable] = enabled ? "true" : "false";
    if ("frontendEnvironmentVariable" in capability) {
      const current = frontend[capability.frontendEnvironmentVariable] === "true";
      frontend[capability.frontendEnvironmentVariable] =
        current || enabled ? "true" : "false";
    }
  }
  return { backend, frontend };
};

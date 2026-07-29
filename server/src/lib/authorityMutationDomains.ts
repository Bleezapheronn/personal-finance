import type { MutationDomain } from "./authorityOpsSession.js";

/** The authoritative table domains used for diagnostic before/after proofs. */
export interface AuthorityMutationDomainDefinition {
  readonly domain: MutationDomain;
  readonly tables: readonly string[];
  /** Stable representation contract used by the supplemental proof. */
  readonly representation: "logical-table-rows";
  readonly emptyIsRepresentable: true;
}

export const AUTHORITY_MUTATION_DOMAIN_DEFINITIONS: readonly AuthorityMutationDomainDefinition[] = [
  { domain: "transactions", tables: ["transactions"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "budgets", tables: ["budgets"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "budgetSnapshots", tables: ["budgetSnapshots"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "buckets", tables: ["buckets"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "categories", tables: ["categories"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "accounts", tables: ["accounts"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "paymentMethods", tables: ["paymentMethods"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "recipients", tables: ["recipients"], representation: "logical-table-rows", emptyIsRepresentable: true },
  { domain: "smsImportTemplates", tables: ["smsImportTemplates"], representation: "logical-table-rows", emptyIsRepresentable: true },
];

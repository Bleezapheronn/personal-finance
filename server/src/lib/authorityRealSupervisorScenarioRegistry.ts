export interface RealSupervisorScenario {
  id: string;
  command: string;
  executed: boolean;
  routes: readonly string[];
}

export const realSupervisorScenarios: readonly RealSupervisorScenario[] = [
  { id: "authority-route-families", command: "test:authority-route-families-process", executed: true, routes: ["/prototype/repositories/transactions/write/create", "/prototype/repositories/transactions/write/update", "/prototype/repositories/budgets/lifecycle/write/create", "/prototype/repositories/budgets/lifecycle/write/update"] },
  { id: "authority-recipient-lifecycle", command: "test:authority-recipient-lifecycle-process", executed: true, routes: ["/prototype/repositories/recipients/write/create", "/prototype/repositories/recipients/write/update", "/prototype/repositories/recipients/delete/write", "/prototype/repositories/recipients/merge/write"] },
  { id: "authority-transaction-delete", command: "test:authority-transaction-delete-process", executed: true, routes: ["/prototype/repositories/transactions/delete/write"] },
  { id: "authority-account-create", command: "test:authority-account-lifecycle-process", executed: true, routes: ["/prototype/repositories/accounts/write/create"] },
  { id: "authority-account-update", command: "test:authority-account-lifecycle-process", executed: true, routes: ["/prototype/repositories/accounts/write/update"] },
  { id: "authority-account-merge", command: "test:authority-account-lifecycle-process", executed: true, routes: ["/prototype/repositories/accounts/merge/write"] },
  { id: "authority-account-delete", command: "test:authority-account-lifecycle-process", executed: true, routes: ["/prototype/repositories/accounts/delete/write"] },
  { id: "authority-account-active-state", command: "test:authority-account-lifecycle-process", executed: true, routes: ["/prototype/repositories/accounts/active-state/write/activate", "/prototype/repositories/accounts/active-state/write/deactivate"] },
  { id: "authority-category-create", command: "test:authority-category-lifecycle-process", executed: true, routes: ["/prototype/repositories/categories/write/create"] },
  { id: "authority-category-update", command: "test:authority-category-lifecycle-process", executed: true, routes: ["/prototype/repositories/categories/write/update"] },
  { id: "authority-category-merge", command: "test:authority-category-lifecycle-process", executed: true, routes: ["/prototype/repositories/categories/merge/write"] },
  { id: "authority-category-delete", command: "test:authority-category-lifecycle-process", executed: true, routes: ["/prototype/repositories/categories/delete/write"] },
  { id: "authority-category-active-state", command: "test:authority-category-lifecycle-process", executed: true, routes: ["/prototype/repositories/categories/active-state/write/activate", "/prototype/repositories/categories/active-state/write/deactivate"] },
  { id: "authority-bucket-create", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/write/create"] },
  { id: "authority-bucket-update", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/write/update"] },
  { id: "authority-bucket-merge", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/merge/write"] },
  { id: "authority-bucket-delete", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/delete/write"] },
  { id: "authority-bucket-active-state", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/active-state/write/activate", "/prototype/repositories/buckets/active-state/write/deactivate"] },
  { id: "authority-bucket-reorder", command: "test:authority-bucket-lifecycle-process", executed: true, routes: ["/prototype/repositories/buckets/reorder/write"] },
  { id: "authority-recipient-activate", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/recipients/write/activate"] },
  { id: "authority-recipient-deactivate", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/recipients/write/deactivate"] },
  { id: "authority-sms-template-create", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/sms-import-templates/write/create"] },
  { id: "authority-sms-template-update", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/sms-import-templates/write/update"] },
  { id: "authority-sms-template-activate", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/sms-import-templates/write/activate"] },
  { id: "authority-sms-template-deactivate", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/sms-import-templates/write/deactivate"] },
  { id: "authority-sms-template-delete", command: "test:authority-recipient-active-sms-process", executed: true, routes: ["/prototype/repositories/sms-import-templates/write/delete"] },
  { id: "authority-transfer-create", command: "test:authority-transfer-lifecycle-process", executed: true, routes: ["/prototype/repositories/transactions/transfers/write/create"] },
  { id: "authority-transfer-update", command: "test:authority-transfer-lifecycle-process", executed: true, routes: ["/prototype/repositories/transactions/transfers/write/update"] },
  { id: "authority-budget-definition-create", command: "test:authority-budget-definition-process", executed: true, routes: ["/prototype/repositories/budgets/write/create"] },
  { id: "authority-budget-definition-update", command: "test:authority-budget-definition-process", executed: true, routes: ["/prototype/repositories/budgets/write/update"] },
  { id: "authority-budget-delete", command: "test:authority-budget-definition-process", executed: true, routes: ["/prototype/repositories/budgets/delete/write"] },
  { id: "authority-occurrence-create", command: "test:authority-occurrence-create-delete-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/create"] },
  { id: "authority-occurrence-delete", command: "test:authority-occurrence-create-delete-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/delete"] },
  { id: "authority-occurrence-link", command: "test:authority-occurrence-link-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/link"] },
  { id: "authority-occurrence-change-link", command: "test:authority-occurrence-change-link-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/changeLink"] },
  { id: "authority-occurrence-unlink", command: "test:authority-occurrence-unlink-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/unlink"] },
  { id: "authority-occurrence-create-and-link", command: "test:authority-occurrence-create-and-link-process", executed: true, routes: ["/prototype/repositories/budget-snapshot-occurrences/write/createAndLink"] },
  { id: "authority-snapshot-generation", command: "test:authority-snapshot-generation-process", executed: true, routes: ["/prototype/repositories/budget-snapshots/lifecycle/write/generate"] },
  { id: "authority-budget-from-transaction", command: "test:authority-budget-from-transaction-process", executed: true, routes: ["/prototype/repositories/budgets/from-transaction/write"] },
];

export const realSupervisorScenario = (id: string): RealSupervisorScenario | undefined =>
  realSupervisorScenarios.find((scenario) => scenario.id === id);

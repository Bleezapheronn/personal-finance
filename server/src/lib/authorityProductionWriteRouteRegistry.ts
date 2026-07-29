/**
 * Canonical authenticated, committed production write routes.  The API server
 * verifies this registry against Fastify's structured route registrations when
 * it becomes ready; it is intentionally not inferred by searching source text.
 */
export const productionAuthenticatedCommittedWriteRoutes = [
  "/prototype/repositories/budgets/write/create", "/prototype/repositories/budgets/write/update",
  "/prototype/repositories/buckets/delete/write", "/prototype/repositories/buckets/merge/write",
  "/prototype/repositories/accounts/delete/write", "/prototype/repositories/accounts/merge/write",
  "/prototype/repositories/categories/delete/write", "/prototype/repositories/categories/merge/write",
  "/prototype/repositories/budgets/lifecycle/write/create", "/prototype/repositories/budgets/lifecycle/write/update",
  "/prototype/repositories/budget-snapshot-occurrences/write/delete", "/prototype/repositories/budget-snapshot-occurrences/write/create",
  "/prototype/repositories/budget-snapshot-occurrences/write/link", "/prototype/repositories/budget-snapshot-occurrences/write/changeLink",
  "/prototype/repositories/budget-snapshot-occurrences/write/unlink", "/prototype/repositories/budget-snapshot-occurrences/write/createAndLink",
  "/prototype/repositories/budgets/from-transaction/write", "/prototype/repositories/budgets/delete/write",
  "/prototype/repositories/transactions/delete/write", "/prototype/repositories/budget-snapshots/lifecycle/write/generate",
  "/prototype/repositories/buckets/write/create", "/prototype/repositories/buckets/write/update",
  "/prototype/repositories/categories/write/create", "/prototype/repositories/categories/write/update",
  "/prototype/repositories/accounts/write/create", "/prototype/repositories/accounts/write/update",
  "/prototype/repositories/transactions/write/create", "/prototype/repositories/transactions/write/update",
  "/prototype/repositories/transactions/transfers/write/create", "/prototype/repositories/transactions/transfers/write/update",
  "/prototype/repositories/recipients/write/activate", "/prototype/repositories/recipients/write/create",
  "/prototype/repositories/recipients/write/update", "/prototype/repositories/recipients/write/deactivate",
  "/prototype/repositories/recipients/delete/write", "/prototype/repositories/recipients/merge/write",
  "/prototype/repositories/sms-import-templates/write/create", "/prototype/repositories/sms-import-templates/write/update",
  "/prototype/repositories/sms-import-templates/write/activate", "/prototype/repositories/sms-import-templates/write/deactivate",
  "/prototype/repositories/sms-import-templates/write/delete",
] as const;

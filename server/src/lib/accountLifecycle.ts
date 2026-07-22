import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const ACCOUNT_LIFECYCLE_CONFIRMATIONS = {
  delete: "delete unused account from disposable sqlite",
  merge: "merge account references in disposable sqlite",
} as const;

export const ACCOUNT_REFERENCE_FIELDS = [
  { table: "transactions", field: "accountId", nullable: true },
  { table: "budgets", field: "accountId", nullable: true },
  { table: "budgetSnapshots", field: "accountId", nullable: true },
  { table: "smsImportTemplates", field: "accountId", nullable: true },
  { table: "paymentMethods", field: "accountId", nullable: false },
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
type Action = keyof typeof ACCOUNT_LIFECYCLE_CONFIRMATIONS;
type Row = Record<string, unknown>;
type ReferenceEntity = (typeof ACCOUNT_REFERENCE_FIELDS)[number]["table"];
type ReferenceCounts = Record<ReferenceEntity, number>;

interface NormalizedInput {
  action: Action;
  accountId?: number;
  sourceAccountId?: number;
  targetAccountId?: number;
  expectedPlanFingerprint?: string;
}

interface AccountLifecyclePlan {
  input: NormalizedInput;
  source?: Row;
  target?: Row;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctAccounts: boolean;
  compatible: boolean;
  currencyCompatible: boolean;
  accountTypeCompatible: boolean;
  sourceReferences: Record<ReferenceEntity, Row[]>;
  targetReferenceCounts: ReferenceCounts;
  affectedTransferPairCount: number;
  transferConflicts: string[];
  validationErrors: string[];
  planFingerprint?: string;
}

export interface AccountLifecycleResponse {
  ok: boolean;
  mode: "prototype";
  entity: "accountLifecycle";
  action: Action;
  sourcePresent: boolean;
  targetPresent: boolean;
  distinctAccounts: boolean;
  compatible: boolean;
  currencyCompatible: boolean;
  accountTypeCompatible: boolean;
  eligible: boolean;
  referenceCount: number;
  sourceReferenceCount: number;
  targetExistingReferenceCount: number;
  referenceCountsByEntity: ReferenceCounts;
  transferReferenceCount: number;
  affectedTransferPairCount: number;
  transferConflicts: string[];
  rowsProposedForUpdate: number;
  sourceWouldBeDeleted: boolean;
  planFingerprint?: string;
  validationErrors: string[];
  warnings: string[];
  wouldMutate: false;
  sqliteMutated: boolean;
  rowsChanged: number;
  financialEffects: {
    globalTotalsWouldChange: false;
    transactionValuesWouldChange: false;
    targetBalanceWouldConsolidate: boolean;
  };
  safety: {
    dexieMutated: false;
    filesWritten: false;
    financialFieldsMutated: false;
    transferLinksMutated: false;
    budgetLifecycleInvoked: false;
    targetAccountMutated: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

export class AccountLifecycleRequestError extends Error {
  statusCode = 400 as const;
  constructor(public readonly code: string) {
    super(code);
  }
}

const isPlainObject = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const positiveInteger = (value: unknown, code: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AccountLifecycleRequestError(code);
  }
  return value;
};

const allowedFields = (action: Action, write: boolean): Set<string> => new Set([
  ...(action === "delete" ? ["accountId"] : ["sourceAccountId", "targetAccountId"]),
  ...(write ? ["dryRunReviewed", "confirmation", "expectedPlanFingerprint"] : []),
]);

const normalizePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => {
  if (!isPlainObject(payload)) throw new AccountLifecycleRequestError("payload_must_be_object");
  if (Object.keys(payload).some((field) => !allowedFields(action, write).has(field))) {
    throw new AccountLifecycleRequestError("unexpected_payload_field");
  }
  const input: NormalizedInput = action === "delete"
    ? { action, accountId: positiveInteger(payload.accountId, "account_id_invalid") }
    : {
        action,
        sourceAccountId: positiveInteger(payload.sourceAccountId, "source_account_id_invalid"),
        targetAccountId: positiveInteger(payload.targetAccountId, "target_account_id_invalid"),
      };
  if (write) {
    if (payload.dryRunReviewed !== true) {
      throw new AccountLifecycleRequestError("dry_run_reviewed_required");
    }
    if (payload.confirmation !== ACCOUNT_LIFECYCLE_CONFIRMATIONS[action]) {
      throw new AccountLifecycleRequestError("matching_dry_run_required");
    }
    if (typeof payload.expectedPlanFingerprint !== "string" ||
        !SHA256_HEX.test(payload.expectedPlanFingerprint)) {
      throw new AccountLifecycleRequestError("expected_account_lifecycle_plan_required");
    }
    input.expectedPlanFingerprint = payload.expectedPlanFingerprint;
  }
  return input;
};

export const validateAccountLifecyclePayload = (
  payload: unknown,
  action: Action,
  write: boolean,
): NormalizedInput => normalizePayload(payload, action, write);

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");
const emptyCounts = (): ReferenceCounts => ({
  transactions: 0,
  budgets: 0,
  budgetSnapshots: 0,
  smsImportTemplates: 0,
  paymentMethods: 0,
});
const tableRows = (db: Database.Database, table: string): Row[] =>
  db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY id ASC`).all() as Row[];
const accountById = (db: Database.Database, id: number): Row | undefined =>
  db.prepare("SELECT * FROM accounts WHERE id = @id").get({ id }) as Row | undefined;
const userTables = (db: Database.Database): string[] =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`).all() as Array<{ name: string }>)
    .map((row) => row.name);

const unsupportedAccountReferenceLocations = (db: Database.Database): string[] => {
  const supported = new Set(
    ACCOUNT_REFERENCE_FIELDS.map(({ table, field }) => `${table}.${field}`.toLowerCase()),
  );
  const unsupported: string[] = [];
  for (const table of userTables(db)) {
    const escaped = table.replaceAll('"', '""');
    const columns = db.prepare(`PRAGMA table_info("${escaped}")`).all() as Array<{ name: string }>;
    for (const column of columns) {
      if (column.name.toLowerCase() !== "accountid") continue;
      const location = `${table}.${column.name}`;
      if (!supported.has(location.toLowerCase())) unsupported.push(location);
    }
  }
  return unsupported.sort();
};

const validateStoredReferences = (db: Database.Database): string[] => {
  const accountIds = new Set(tableRows(db, "accounts").map((row) => Number(row.id)));
  const errors = new Set<string>();
  for (const reference of ACCOUNT_REFERENCE_FIELDS) {
    for (const row of tableRows(db, reference.table)) {
      const value = row[reference.field];
      if (value === null || value === undefined) {
        if (!reference.nullable) errors.add(`${reference.table}_account_reference_missing`);
        continue;
      }
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 ||
          !accountIds.has(value)) {
        errors.add(`${reference.table}_account_reference_malformed`);
      }
    }
  }
  return [...errors].sort();
};

const referencesFor = (
  db: Database.Database,
  accountId: number,
): Record<ReferenceEntity, Row[]> => Object.fromEntries(
  ACCOUNT_REFERENCE_FIELDS.map(({ table }) => [
    table,
    db.prepare(`SELECT * FROM ${table} WHERE accountId = @accountId ORDER BY id ASC`)
      .all({ accountId }) as Row[],
  ]),
) as Record<ReferenceEntity, Row[]>;

const referenceCounts = (references: Record<ReferenceEntity, Row[]>): ReferenceCounts => ({
  transactions: references.transactions.length,
  budgets: references.budgets.length,
  budgetSnapshots: references.budgetSnapshots.length,
  smsImportTemplates: references.smsImportTemplates.length,
  paymentMethods: references.paymentMethods.length,
});
const totalCounts = (counts: ReferenceCounts): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const isTransferRow = (row: Row): boolean =>
  row.isTransfer === true || row.isTransfer === 1 || row.transferPairId != null;
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const same = (left: unknown, right: unknown): boolean =>
  serialized(left ?? null) === serialized(right ?? null);
const sameInstant = (left: unknown, right: unknown): boolean => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
};

const validateTransferPairRows = (rows: Row[], targetId: number): string[] => {
  const errors = new Set<string>();
  const byId = new Map(rows.map((row) => [integer(row.id), row]));
  const target = byId.get(targetId);
  if (!target) return ["transfer_pair_transaction_missing"];
  const pairedId = integer(target.transferPairId);
  if (pairedId === null) return ["transfer_pair_missing"];
  if (pairedId === targetId) return ["transfer_pair_self_reference"];
  const paired = byId.get(pairedId);
  if (!paired) return ["transfer_pair_not_found"];
  if (integer(paired.transferPairId) !== targetId) errors.add("transfer_pair_not_reciprocal");
  if ((target.isTransfer !== 1 && target.isTransfer !== true) ||
      (paired.isTransfer !== 1 && paired.isTransfer !== true)) {
    errors.add("transfer_pair_flag_invalid");
  }
  const targetAmount = target.amount;
  const pairedAmount = paired.amount;
  if (typeof targetAmount !== "number" || typeof pairedAmount !== "number" ||
      !((targetAmount < 0 && pairedAmount > 0) ||
        (targetAmount > 0 && pairedAmount < 0))) {
    errors.add("transfer_pair_signs_invalid");
  }
  if (typeof targetAmount === "number" && typeof pairedAmount === "number" &&
      Math.abs(targetAmount) !== Math.abs(pairedAmount)) {
    errors.add("transfer_pair_amounts_unbalanced");
  }
  const source = typeof targetAmount === "number" && targetAmount < 0 ? target : paired;
  const destination = source === target ? paired : target;
  const sourceId = integer(source.id);
  const destinationId = integer(destination.id);
  if (sourceId === null || destinationId === null) {
    errors.add("transfer_pair_ids_invalid");
  } else {
    const inbound = rows.filter((row) =>
      row.transferPairId === sourceId || row.transferPairId === destinationId);
    if (inbound.length !== 2 ||
        !inbound.some((row) => row.id === sourceId && row.transferPairId === destinationId) ||
        !inbound.some((row) => row.id === destinationId && row.transferPairId === sourceId)) {
      errors.add("transfer_pair_has_ambiguous_inbound_reference");
    }
  }
  if (source.accountId === destination.accountId) errors.add("transfer_accounts_must_differ");
  for (const field of ["categoryId", "description", "originalCurrency", "exchangeRate", "transactionReference"]) {
    if (!same(source[field], destination[field])) errors.add(`transfer_pair_${field}_mismatch`);
  }
  if (!sameInstant(source.date, destination.date)) errors.add("transfer_pair_date_mismatch");
  const sourceOriginal = source.originalAmount;
  const destinationOriginal = destination.originalAmount;
  if (!((sourceOriginal == null && destinationOriginal == null) ||
        (typeof sourceOriginal === "number" && typeof destinationOriginal === "number" &&
         sourceOriginal < 0 && destinationOriginal > 0 &&
         Math.abs(sourceOriginal) === Math.abs(destinationOriginal)))) {
    errors.add("transfer_pair_original_amount_mismatch");
  }
  if ((source.transactionCost != null &&
       (typeof source.transactionCost !== "number" || source.transactionCost > 0)) ||
      (destination.transactionCost != null && destination.transactionCost !== 0)) {
    errors.add("transfer_pair_transaction_cost_invalid");
  }
  if ([source, destination].some((row) =>
    row.budgetId != null || row.occurrenceDate != null || row.budgetSnapshotId != null)) {
    errors.add("transfer_pair_budget_linkage_not_supported");
  }
  return [...errors].sort();
};

const affectedTransferSummary = (
  transactions: Row[],
  sourceId: number,
  targetId?: number,
): { pairCount: number; conflicts: string[] } => {
  const affectedIds = new Set<number>();
  for (const row of transactions) {
    if (row.accountId !== sourceId || !isTransferRow(row)) continue;
    const id = integer(row.id);
    const pair = integer(row.transferPairId);
    if (id !== null) affectedIds.add(id);
    if (pair !== null) affectedIds.add(pair);
  }
  const simulated = targetId === undefined
    ? transactions
    : transactions.map((row) => row.accountId === sourceId
      ? { ...row, accountId: targetId }
      : row);
  const conflicts = new Set<string>();
  for (const id of affectedIds) {
    for (const error of validateTransferPairRows(simulated, id)) conflicts.add(error);
  }
  return { pairCount: Math.ceil(affectedIds.size / 2), conflicts: [...conflicts].sort() };
};

const creditClassification = (row?: Row): boolean | null => {
  if (!row || ![0, 1, false, true].includes(row.isCredit as never)) return null;
  return row.isCredit === 1 || row.isCredit === true;
};
const validCurrency = (row?: Row): string | null =>
  row && typeof row.currency === "string" && row.currency.trim().length > 0
    ? row.currency
    : null;

const buildPlan = (db: Database.Database, input: NormalizedInput): AccountLifecyclePlan => {
  const sourceId = input.action === "delete" ? input.accountId! : input.sourceAccountId!;
  const targetId = input.action === "merge" ? input.targetAccountId! : undefined;
  const source = accountById(db, sourceId);
  const target = targetId === undefined ? undefined : accountById(db, targetId);
  const sourceReferences = referencesFor(db, sourceId);
  const targetReferences = targetId === undefined
    ? { transactions: [], budgets: [], budgetSnapshots: [], smsImportTemplates: [], paymentMethods: [] }
    : referencesFor(db, targetId);
  const unsupported = unsupportedAccountReferenceLocations(db);
  const errors = new Set(validateStoredReferences(db));
  if (unsupported.length > 0) errors.add("unsupported_account_reference_location");
  const distinctAccounts = input.action === "delete" || sourceId !== targetId;
  if (!source) errors.add(input.action === "delete" ? "account_not_found" : "source_account_not_found");
  if (input.action === "merge" && !target) errors.add("target_account_not_found");
  if (!distinctAccounts) errors.add("source_target_account_same");
  const sourceCurrency = validCurrency(source);
  const targetCurrency = validCurrency(target);
  const sourceCredit = creditClassification(source);
  const targetCredit = creditClassification(target);
  const currencyCompatible = input.action === "delete" ||
    (sourceCurrency !== null && targetCurrency !== null && sourceCurrency === targetCurrency);
  const accountTypeCompatible = input.action === "delete" ||
    (sourceCredit !== null && targetCredit !== null && sourceCredit === targetCredit);
  if (source && sourceCurrency === null) errors.add("source_account_currency_invalid");
  if (target && targetCurrency === null) errors.add("target_account_currency_invalid");
  if (source && sourceCredit === null) errors.add("source_account_classification_invalid");
  if (target && targetCredit === null) errors.add("target_account_classification_invalid");
  if (input.action === "merge" && sourceCurrency !== null && targetCurrency !== null &&
      !currencyCompatible) errors.add("account_currency_mismatch");
  if (input.action === "merge" && sourceCredit !== null && targetCredit !== null &&
      !accountTypeCompatible) errors.add("account_classification_mismatch");
  const counts = referenceCounts(sourceReferences);
  if (input.action === "delete" && totalCounts(counts) > 0) errors.add("account_referenced");
  const transferSummary = affectedTransferSummary(
    tableRows(db, "transactions"),
    sourceId,
    input.action === "merge" ? targetId : undefined,
  );
  for (const conflict of transferSummary.conflicts) errors.add(conflict);
  const validationErrors = [...errors].sort();
  const compatible = currencyCompatible && accountTypeCompatible;
  const fingerprintEligible = Boolean(source) &&
    (input.action === "delete" || Boolean(target)) && distinctAccounts && compatible &&
    unsupported.length === 0 &&
    validationErrors.every((code) => code === "account_referenced");
  const state = {
    input: input.action === "delete"
      ? { action: input.action, accountId: input.accountId }
      : { action: input.action, sourceAccountId: input.sourceAccountId, targetAccountId: input.targetAccountId },
    accounts: tableRows(db, "accounts"),
    references: Object.fromEntries(ACCOUNT_REFERENCE_FIELDS.map(({ table }) => [table, tableRows(db, table)])),
    unsupported,
    validationErrors,
  };
  return {
    input, source, target, sourcePresent: Boolean(source),
    targetPresent: input.action === "delete" ? Boolean(source) : Boolean(target),
    distinctAccounts, compatible, currencyCompatible, accountTypeCompatible,
    sourceReferences, targetReferenceCounts: referenceCounts(targetReferences),
    affectedTransferPairCount: transferSummary.pairCount,
    transferConflicts: transferSummary.conflicts,
    validationErrors,
    ...(fingerprintEligible ? { planFingerprint: fingerprint(state) } : {}),
  };
};

const response = (
  plan: AccountLifecyclePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): AccountLifecycleResponse => {
  const counts = referenceCounts(plan.sourceReferences);
  const sourceReferenceCount = totalCounts(counts);
  const eligible = plan.input.action === "delete"
    ? plan.sourcePresent && plan.validationErrors.length === 0 && sourceReferenceCount === 0
    : plan.sourcePresent && plan.targetPresent && plan.distinctAccounts && plan.compatible &&
      plan.validationErrors.length === 0;
  const sqliteMutated = options.sqliteMutated === true;
  const code = options.code ?? plan.validationErrors[0];
  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype", entity: "accountLifecycle", action: plan.input.action,
    sourcePresent: plan.sourcePresent, targetPresent: plan.targetPresent,
    distinctAccounts: plan.distinctAccounts, compatible: plan.compatible,
    currencyCompatible: plan.currencyCompatible,
    accountTypeCompatible: plan.accountTypeCompatible, eligible,
    referenceCount: sourceReferenceCount, sourceReferenceCount,
    targetExistingReferenceCount: totalCounts(plan.targetReferenceCounts),
    referenceCountsByEntity: counts,
    transferReferenceCount: plan.sourceReferences.transactions.filter(isTransferRow).length,
    affectedTransferPairCount: plan.affectedTransferPairCount,
    transferConflicts: [...plan.transferConflicts],
    rowsProposedForUpdate: plan.input.action === "merge" ? sourceReferenceCount : 0,
    sourceWouldBeDeleted: eligible,
    ...(plan.planFingerprint ? { planFingerprint: plan.planFingerprint } : {}),
    validationErrors: [...plan.validationErrors],
    warnings: eligible
      ? ["target_account_fields_remain_unchanged", "account_balances_consolidate_under_target",
          "manual_checkpoint_rotation_required_before_authority_restart"]
      : plan.validationErrors.includes("account_referenced")
        ? ["referenced_account_requires_merge_or_manual_cleanup"] : [],
    wouldMutate: false, sqliteMutated, rowsChanged: options.rowsChanged ?? 0,
    financialEffects: {
      globalTotalsWouldChange: false,
      transactionValuesWouldChange: false,
      targetBalanceWouldConsolidate: plan.input.action === "merge" && eligible,
    },
    safety: {
      dexieMutated: false, filesWritten: false, financialFieldsMutated: false,
      transferLinksMutated: false, budgetLifecycleInvoked: false,
      targetAccountMutated: false, rawRowsIncluded: false,
      automaticCheckpointCreated: false,
    },
    resultCodes: sqliteMutated
      ? [`account_${plan.input.action}_completed`, "sqlite_mutated"]
      : eligible
        ? [`account_${plan.input.action}_dry_run_valid`, "no_mutation_performed"]
        : [`account_${plan.input.action}_conflict`, "no_mutation_performed"],
    ...(code ? { code } : {}),
  };
};

const errorPlan = (action: Action, code: string): AccountLifecyclePlan => ({
  input: { action }, sourcePresent: false, targetPresent: false,
  distinctAccounts: action === "delete", compatible: action === "delete",
  currencyCompatible: action === "delete", accountTypeCompatible: action === "delete",
  sourceReferences: { transactions: [], budgets: [], budgetSnapshots: [], smsImportTemplates: [], paymentMethods: [] },
  targetReferenceCounts: emptyCounts(), affectedTransferPairCount: 0,
  transferConflicts: [], validationErrors: [code],
});

export const accountLifecycleRequestErrorResponse = (action: Action, code: string) =>
  response(errorPlan(action, code), { code });
export const accountLifecycleDisabledResponse = (action: Action) =>
  accountLifecycleRequestErrorResponse(action, "account_delete_merge_writes_disabled");

export const accountLifecycleDryRun = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): AccountLifecycleResponse => response(buildPlan(db, normalizePayload(payload, action, false)));

const expectedReferenceRows = (before: Row[], sourceId: number, targetId: number): Row[] =>
  before.map((row) => row.accountId === sourceId ? { ...row, accountId: targetId } : row);

export const accountLifecycleRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: Action,
): AccountLifecycleResponse => {
  const input = normalizePayload(payload, action, true);
  const execute = db.transaction(() => {
    const plan = buildPlan(db, input);
    if (!plan.planFingerprint || plan.planFingerprint !== input.expectedPlanFingerprint) {
      const stale = Boolean(plan.planFingerprint) && plan.planFingerprint !== input.expectedPlanFingerprint;
      return response(plan, { code: stale ? "account_lifecycle_plan_stale" : plan.validationErrors[0] });
    }
    if (plan.validationErrors.length > 0) return response(plan);
    const tables = userTables(db);
    const before = Object.fromEntries(tables.map((table) => [table, tableRows(db, table)])) as Record<string, Row[]>;
    let rowsChanged = 0;
    if (action === "merge") {
      const sourceId = input.sourceAccountId!;
      const targetId = input.targetAccountId!;
      for (const { table } of ACCOUNT_REFERENCE_FIELDS) {
        const changes = db.prepare(`UPDATE ${table} SET accountId = @targetId WHERE accountId = @sourceId`)
          .run({ sourceId, targetId }).changes;
        if (changes !== plan.sourceReferences[table].length) {
          throw new Error("account_merge_reference_count_mismatch");
        }
        rowsChanged += changes;
      }
    }
    const sourceId = action === "delete" ? input.accountId! : input.sourceAccountId!;
    const deleted = db.prepare("DELETE FROM accounts WHERE id = @id").run({ id: sourceId }).changes;
    if (deleted !== 1) throw new Error("account_lifecycle_source_delete_failed");
    rowsChanged += deleted;
    for (const table of tables) {
      let expected = before[table];
      if (table === "accounts") {
        expected = before.accounts.filter((row) => Number(row.id) !== sourceId);
      } else if (action === "merge" && ACCOUNT_REFERENCE_FIELDS.some((item) => item.table === table)) {
        expected = expectedReferenceRows(before[table], sourceId, input.targetAccountId!);
      }
      if (serialized(tableRows(db, table)) !== serialized(expected)) {
        throw new Error("account_lifecycle_mutation_boundary_failed");
      }
    }
    if (accountById(db, sourceId)) throw new Error("account_lifecycle_source_still_present");
    if (action === "merge" &&
        serialized(accountById(db, input.targetAccountId!)) !== serialized(plan.target)) {
      throw new Error("account_lifecycle_target_changed");
    }
    if (action === "merge") {
      const transactionsAfter = tableRows(db, "transactions");
      const affectedTransferIds = new Set(
        plan.sourceReferences.transactions
          .filter(isTransferRow)
          .flatMap((row) => [integer(row.id), integer(row.transferPairId)])
          .filter((id): id is number => id !== null),
      );
      if ([...affectedTransferIds].some(
        (id) => validateTransferPairRows(transactionsAfter, id).length > 0,
      )) {
        throw new Error("account_lifecycle_transfer_boundary_failed");
      }
    }
    return response(plan, { sqliteMutated: true, rowsChanged });
  });
  return execute.immediate();
};

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { validateTransferPair } from "./transactionTransferDryRun.js";

export const TRANSACTION_DELETE_WRITE_CONFIRMATION =
  "delete transaction or transfer pair from disposable sqlite" as const;

const RELATED_TABLES = [
  "accounts",
  "paymentMethods",
  "budgets",
  "budgetSnapshots",
  "buckets",
  "categories",
  "recipients",
  "smsImportTemplates",
] as const;
const WRITE_FIELDS = new Set([
  "id",
  "dryRunReviewed",
  "confirmation",
  "expectedPlanFingerprint",
]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

type TransactionDeleteClassification =
  | "ordinary"
  | "transferPair"
  | "conflict";

interface DeletePlan {
  classification: TransactionDeleteClassification;
  targetPresent: boolean;
  rows: Record<string, unknown>[];
  validationErrors: string[];
  planFingerprint?: string;
}

export interface TransactionDeleteResponse {
  ok: boolean;
  mode: "prototype";
  entity: "transaction";
  action: "delete";
  classification: TransactionDeleteClassification;
  targetPresent: boolean;
  rowsProposedForDeletion: number;
  transferPairValidated: boolean;
  transactionCostPresent: boolean;
  budgetSnapshotLinkPresent: boolean;
  planFingerprint?: string;
  financialEffectSummary: {
    accountBalanceWouldChange: boolean;
    affectedAccountCount: number;
    combinedEffectDirection: "increase" | "decrease" | "neutral";
  };
  reportEffectSummary: {
    transactionCountDelta: number;
    reportTotalsWouldChange: boolean;
    combinedEffectDirection: "increase" | "decrease" | "neutral";
  };
  budgetHistoryEffectSummary: {
    membershipWouldChange: boolean;
    linkedBudgetSnapshotRemainsUnchanged: boolean;
  };
  validationErrors: string[];
  warnings: string[];
  wouldMutate: boolean;
  sqliteMutated: boolean;
  rowsChanged: number;
  safety: {
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
    automaticCheckpointCreated: false;
  };
  resultCodes: string[];
  code?: string;
}

export class TransactionDeleteRequestError extends Error {
  statusCode = 400 as const;
  constructor(public readonly code: string) {
    super(code);
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const positiveInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TransactionDeleteRequestError("transaction_id_invalid");
  }
  return value;
};

export const validateTransactionDeleteDryRunPayload = (payload: unknown) => {
  if (!isPlainObject(payload)) {
    throw new TransactionDeleteRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => field !== "id")) {
    throw new TransactionDeleteRequestError("unexpected_payload_field");
  }
  return { id: positiveInteger(payload.id) };
};

export const validateTransactionDeleteWritePayload = (payload: unknown) => {
  if (!isPlainObject(payload)) {
    throw new TransactionDeleteRequestError("payload_must_be_object");
  }
  if (Object.keys(payload).some((field) => !WRITE_FIELDS.has(field))) {
    throw new TransactionDeleteRequestError("unexpected_payload_field");
  }
  const id = positiveInteger(payload.id);
  if (payload.dryRunReviewed !== true) {
    throw new TransactionDeleteRequestError("dry_run_reviewed_required");
  }
  if (payload.confirmation !== TRANSACTION_DELETE_WRITE_CONFIRMATION) {
    throw new TransactionDeleteRequestError("matching_dry_run_required");
  }
  if (
    typeof payload.expectedPlanFingerprint !== "string" ||
    !SHA256_HEX.test(payload.expectedPlanFingerprint)
  ) {
    throw new TransactionDeleteRequestError("expected_delete_plan_required");
  }
  return { id, expectedPlanFingerprint: payload.expectedPlanFingerprint };
};

const rows = (
  db: Database.Database,
  table: "transactions" | (typeof RELATED_TABLES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const rowById = (db: Database.Database, id: number) =>
  db.prepare("SELECT * FROM transactions WHERE id = @id").get({ id }) as
    | Record<string, unknown>
    | undefined;

const serialized = (value: unknown): string => JSON.stringify(value);
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(serialized(value)).digest("hex");

const isTransfer = (row: Record<string, unknown>): boolean =>
  row.isTransfer === true || row.isTransfer === 1;

const transferPairId = (row: Record<string, unknown>): number | null =>
  typeof row.transferPairId === "number" && Number.isInteger(row.transferPairId)
    ? row.transferPairId
    : null;

const referencePresent = (
  db: Database.Database,
  table: "accounts" | "categories" | "recipients",
  value: unknown,
): boolean =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  db.prepare(`SELECT 1 FROM ${table} WHERE id = @id`).get({ id: value }) !==
    undefined;

const validatePairReferences = (
  db: Database.Database,
  pairRows: Record<string, unknown>[],
): string[] => {
  const errors: string[] = [];
  for (const row of pairRows) {
    if (!referencePresent(db, "accounts", row.accountId)) {
      errors.push("transfer_pair_account_not_found");
    }
    if (!referencePresent(db, "categories", row.categoryId)) {
      errors.push("transfer_pair_category_not_found");
    }
    if (!referencePresent(db, "recipients", row.recipientId)) {
      errors.push("transfer_pair_recipient_not_found");
    }
  }
  return [...new Set(errors)];
};

const buildDeletePlan = (
  db: Database.Database,
  id: number,
): DeletePlan => {
  const target = rowById(db, id);
  if (!target) {
    return {
      classification: "conflict",
      targetPresent: false,
      rows: [],
      validationErrors: ["transaction_not_found"],
    };
  }

  const inbound = db
    .prepare(
      "SELECT id FROM transactions WHERE transferPairId = @id ORDER BY id ASC",
    )
    .all({ id }) as Array<{ id: number }>;
  const hasTransferMarker = isTransfer(target) || transferPairId(target) !== null;

  if (!hasTransferMarker && inbound.length === 0) {
    const rowsToDelete = [target];
    return {
      classification: "ordinary",
      targetPresent: true,
      rows: rowsToDelete,
      validationErrors: [],
      planFingerprint: fingerprint({ classification: "ordinary", rows: rowsToDelete }),
    };
  }

  if (!hasTransferMarker) {
    return {
      classification: "conflict",
      targetPresent: true,
      rows: [],
      validationErrors: ["ordinary_transaction_has_inbound_transfer_reference"],
    };
  }

  const pair = validateTransferPair(db, id);
  const pairRows = pair.rows ? [pair.rows.source, pair.rows.destination] : [];
  const validationErrors = [
    ...pair.errors,
    ...(pair.rows ? validatePairReferences(db, pairRows) : []),
  ];
  if (validationErrors.length > 0 || pairRows.length !== 2) {
    return {
      classification: "conflict",
      targetPresent: true,
      rows: [],
      validationErrors: [...new Set(validationErrors)],
    };
  }

  const orderedRows = [...pairRows].sort(
    (left, right) => Number(left.id) - Number(right.id),
  );
  return {
    classification: "transferPair",
    targetPresent: true,
    rows: orderedRows,
    validationErrors: [],
    planFingerprint: fingerprint({
      classification: "transferPair",
      rows: orderedRows,
    }),
  };
};

const direction = (value: number): "increase" | "decrease" | "neutral" =>
  value > 0 ? "increase" : value < 0 ? "decrease" : "neutral";

const numeric = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const reportContribution = (
  db: Database.Database,
  row: Record<string, unknown>,
): number => {
  const included = db
    .prepare(
      `SELECT 1
       FROM categories c
       JOIN buckets b ON b.id = c.bucketId
       WHERE c.id = @categoryId AND b.excludeFromReports = 0`,
    )
    .get({ categoryId: row.categoryId });
  return included
    ? numeric(row.amount) + numeric(row.transactionCost)
    : 0;
};

const response = (
  db: Database.Database | undefined,
  plan: DeletePlan,
  options: { sqliteMutated?: boolean; rowsChanged?: number; code?: string } = {},
): TransactionDeleteResponse => {
  const rowsToDelete = plan.rows;
  const combinedContribution = rowsToDelete.reduce(
    (sum, row) => sum + numeric(row.amount) + numeric(row.transactionCost),
    0,
  );
  const reportContributionTotal = rowsToDelete.reduce(
    (sum, row) => sum + (db ? reportContribution(db, row) : 0),
    0,
  );
  const accountIds = new Set(
    rowsToDelete
      .map((row) => row.accountId)
      .filter((value): value is number => typeof value === "number"),
  );
  const eligible =
    plan.validationErrors.length === 0 &&
    (plan.classification === "ordinary" ||
      plan.classification === "transferPair");
  const sqliteMutated = options.sqliteMutated === true;
  const rowsChanged = options.rowsChanged ?? 0;
  const code = options.code ?? plan.validationErrors[0];

  return {
    ok: sqliteMutated || (eligible && !options.code),
    mode: "prototype",
    entity: "transaction",
    action: "delete",
    classification: plan.classification,
    targetPresent: plan.targetPresent,
    rowsProposedForDeletion: rowsToDelete.length,
    transferPairValidated: plan.classification === "transferPair" && eligible,
    transactionCostPresent: rowsToDelete.some(
      (row) => numeric(row.transactionCost) !== 0,
    ),
    budgetSnapshotLinkPresent: rowsToDelete.some(
      (row) => typeof row.budgetSnapshotId === "number",
    ),
    ...(plan.planFingerprint
      ? { planFingerprint: plan.planFingerprint }
      : {}),
    financialEffectSummary: {
      accountBalanceWouldChange: rowsToDelete.length > 0,
      affectedAccountCount: accountIds.size,
      combinedEffectDirection: direction(-combinedContribution),
    },
    reportEffectSummary: {
      transactionCountDelta: -rowsToDelete.length,
      reportTotalsWouldChange: reportContributionTotal !== 0,
      combinedEffectDirection: direction(-reportContributionTotal),
    },
    budgetHistoryEffectSummary: {
      membershipWouldChange: rowsToDelete.some(
        (row) => typeof row.budgetSnapshotId === "number",
      ),
      linkedBudgetSnapshotRemainsUnchanged: true,
    },
    validationErrors: [...plan.validationErrors],
    warnings: eligible
      ? [
          "deletion_is_permanent_within_current_sqlite_checkpoint",
          "manual_checkpoint_rotation_required_before_authority_restart",
        ]
      : [],
    wouldMutate: false,
    sqliteMutated,
    rowsChanged,
    safety: {
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
      automaticCheckpointCreated: false,
    },
    resultCodes: sqliteMutated
      ? ["transaction_delete_completed", "sqlite_mutated"]
      : eligible
        ? ["transaction_delete_dry_run_valid", "no_mutation_performed"]
        : ["transaction_delete_conflict", "no_mutation_performed"],
    ...(code ? { code } : {}),
  };
};

export const transactionDeleteDryRun = (
  db: Database.Database,
  payload: unknown,
): TransactionDeleteResponse => {
  const { id } = validateTransactionDeleteDryRunPayload(payload);
  return response(db, buildDeletePlan(db, id));
};

export const transactionDeleteRequestErrorResponse = (
  code: string,
): TransactionDeleteResponse =>
  response(
    undefined,
    {
      classification: "conflict",
      targetPresent: false,
      rows: [],
      validationErrors: [code],
    },
    { code },
  );

export const transactionDeleteDisabledResponse = (): TransactionDeleteResponse =>
  transactionDeleteRequestErrorResponse("transaction_delete_writes_disabled");

const relatedFingerprints = (db: Database.Database) =>
  Object.fromEntries(
    RELATED_TABLES.map((table) => [table, fingerprint(rows(db, table))]),
  ) as Record<(typeof RELATED_TABLES)[number], string>;

const assertRelatedTablesUnchanged = (
  db: Database.Database,
  before: Record<(typeof RELATED_TABLES)[number], string>,
): void => {
  for (const table of RELATED_TABLES) {
    if (fingerprint(rows(db, table)) !== before[table]) {
      throw new Error("transaction_delete_related_table_boundary_failed");
    }
  }
};

export const transactionDeleteRealWrite = (
  db: Database.Database,
  payload: unknown,
): TransactionDeleteResponse => {
  const input = validateTransactionDeleteWritePayload(payload);
  const run = db.transaction(() => {
    const plan = buildDeletePlan(db, input.id);
    if (
      plan.validationErrors.length > 0 ||
      !plan.planFingerprint ||
      plan.planFingerprint !== input.expectedPlanFingerprint
    ) {
      const stale =
        plan.validationErrors.length === 0 &&
        plan.planFingerprint !== input.expectedPlanFingerprint;
      return response(
        db,
        stale
          ? { ...plan, validationErrors: ["transaction_delete_plan_stale"] }
          : plan,
        { code: stale ? "transaction_delete_plan_stale" : undefined },
      );
    }

    const transactionsBefore = rows(db, "transactions");
    const relatedBefore = relatedFingerprints(db);
    const deleteIds = new Set(plan.rows.map((row) => Number(row.id)));
    const expectedRemaining = transactionsBefore.filter(
      (row) => !deleteIds.has(Number(row.id)),
    );
    const statement = db.prepare("DELETE FROM transactions WHERE id = @id");
    let changes = 0;
    for (const row of plan.rows) {
      changes += statement.run({ id: row.id }).changes;
    }

    const transactionsAfter = rows(db, "transactions");
    if (
      changes !== plan.rows.length ||
      transactionsAfter.length !== transactionsBefore.length - plan.rows.length ||
      serialized(transactionsAfter) !== serialized(expectedRemaining) ||
      plan.rows.some((row) => rowById(db, Number(row.id)) !== undefined)
    ) {
      throw new Error("transaction_delete_write_boundary_failed");
    }
    assertRelatedTablesUnchanged(db, relatedBefore);

    return response(db, plan, {
      sqliteMutated: true,
      rowsChanged: changes,
    });
  });
  return run();
};

import Database from "better-sqlite3";
import {
  accountDryRun,
  type AccountAction,
  type AccountDryRunResponse,
  normalizeAccountPayload,
  type NormalizedAccountInput,
} from "./accountDryRun.js";

export const ACCOUNT_CREATE_WRITE_CONFIRMATION =
  "create account in disposable sqlite" as const;
export const ACCOUNT_UPDATE_WRITE_CONFIRMATION =
  "update account in disposable sqlite" as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
const ACCOUNT_DATA_FIELDS = new Set([
  "id",
  "name",
  "currency",
  "isCredit",
  "creditLimit",
]);
const RELATED_TABLES = [
  "transactions",
  "paymentMethods",
  "budgets",
  "budgetSnapshots",
  "buckets",
  "categories",
  "recipients",
  "smsImportTemplates",
] as const;

export interface AccountWriteResponse {
  ok: boolean;
  mode: "prototype";
  entity: "account";
  action: AccountAction;
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  targetIdPresent: boolean;
  targetId: number | null;
  validationErrors: string[];
  warnings: string[];
  duplicateSummary: AccountDryRunResponse["duplicateSummary"];
  normalizedFieldPresence: AccountDryRunResponse["normalizedFieldPresence"];
  financialSignificance: AccountDryRunResponse["financialSignificance"];
  timestampBehavior: AccountDryRunResponse["timestampBehavior"];
  affectedSummary: {
    accountRowsChanged: number;
    transactionRowsChanged: 0;
    paymentMethodRowsChanged: 0;
    budgetRowsChanged: 0;
    budgetSnapshotRowsChanged: 0;
  };
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class AccountWriteRequestError extends Error {
  statusCode: 400;
  code: string;

  constructor(code: string) {
    super(code);
    this.statusCode = 400;
    this.code = code;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export const validateAccountWritePayload = (
  payload: unknown,
  action: AccountAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new AccountWriteRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (!ACCOUNT_DATA_FIELDS.has(field) && !CONTROL_FIELDS.has(field)) {
      throw new AccountWriteRequestError("unexpected_payload_field");
    }
    if (action === "create" && field === "id") {
      throw new AccountWriteRequestError("unexpected_payload_field");
    }
  }
  if (payload.dryRunReviewed !== true) {
    throw new AccountWriteRequestError("dry_run_reviewed_required");
  }
  const confirmation =
    action === "create"
      ? ACCOUNT_CREATE_WRITE_CONFIRMATION
      : ACCOUNT_UPDATE_WRITE_CONFIRMATION;
  if (payload.confirmation !== confirmation) {
    throw new AccountWriteRequestError("matching_dry_run_required");
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => ACCOUNT_DATA_FIELDS.has(field)),
  );
};

const tableRows = (
  db: Database.Database,
  tableName:
    | "accounts"
    | (typeof RELATED_TABLES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${tableName} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const serialized = (rows: Record<string, unknown>[]): string =>
  JSON.stringify(rows);

const withoutId = (
  rows: Record<string, unknown>[],
  id: number,
): Record<string, unknown>[] => rows.filter((row) => row.id !== id);

const nextTimestamp = (previous?: string): string => {
  const now = new Date();
  if (!previous) {
    return now.toISOString();
  }
  const previousTime = Date.parse(previous);
  return Number.isFinite(previousTime) && now.getTime() <= previousTime
    ? new Date(previousTime + 1).toISOString()
    : now.toISOString();
};

const response = (input: {
  action: AccountAction;
  dryRun?: AccountDryRunResponse;
  targetId: number | null;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  resultCodes: string[];
  code?: string;
}): AccountWriteResponse => {
  const dryRun = input.dryRun;
  const validationErrors = input.validationErrors ?? [];

  return {
    ok:
      validationErrors.length === 0 &&
      input.resultCodes.includes("sqlite_mutated"),
    mode: "prototype",
    entity: "account",
    action: input.action,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    validationErrors,
    warnings: dryRun?.warnings ?? [],
    duplicateSummary: dryRun?.duplicateSummary ?? {
      duplicateNameCandidates: 0,
    },
    normalizedFieldPresence: dryRun?.normalizedFieldPresence ?? {
      hasName: false,
      hasCurrency: false,
      hasCreditClassification: false,
      hasCreditLimit: false,
      hasImageInput: false,
    },
    financialSignificance: dryRun?.financialSignificance ?? {
      currencyWouldChange: false,
      creditClassificationWouldChange: false,
      creditLimitWouldChange: false,
      balancesWouldChange: false,
      transactionsWouldChange: false,
    },
    timestampBehavior: dryRun?.timestampBehavior ?? {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: input.action === "update",
    },
    affectedSummary: {
      accountRowsChanged: input.rowsChanged,
      transactionRowsChanged: 0,
      paymentMethodRowsChanged: 0,
      budgetRowsChanged: 0,
      budgetSnapshotRowsChanged: 0,
    },
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: input.resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const accountWriteDisabledResponse = (
  action: AccountAction,
): AccountWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: ["account_writes_disabled"],
    resultCodes: ["account_writes_disabled", "no_mutation_performed"],
    code: "account_writes_disabled",
  });

export const accountWriteRequestErrorResponse = (
  action: AccountAction,
  code: string,
): AccountWriteResponse =>
  response({
    action,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

const relatedTableFingerprints = (
  db: Database.Database,
): Record<(typeof RELATED_TABLES)[number], string> =>
  Object.fromEntries(
    RELATED_TABLES.map((tableName) => [
      tableName,
      serialized(tableRows(db, tableName)),
    ]),
  ) as Record<(typeof RELATED_TABLES)[number], string>;

const assertRelatedTablesUnchanged = (
  db: Database.Database,
  before: Record<(typeof RELATED_TABLES)[number], string>,
): void => {
  for (const tableName of RELATED_TABLES) {
    if (serialized(tableRows(db, tableName)) !== before[tableName]) {
      throw new Error("account_related_table_boundary_failed");
    }
  }
};

const createAccount = (
  db: Database.Database,
  input: NormalizedAccountInput,
  dryRun: AccountDryRunResponse,
): AccountWriteResponse => {
  const accountsBefore = tableRows(db, "accounts");
  const relatedBefore = relatedTableFingerprints(db);
  const timestamp = nextTimestamp();
  const result = db
    .prepare(
      `INSERT INTO accounts (
        name, description, currency, imageBlob, imageMimeType, isActive,
        isCredit, creditLimit, createdAt, updatedAt
      ) VALUES (
        @name, NULL, @currency, NULL, NULL, 1,
        @isCredit, @creditLimit, @createdAt, @updatedAt
      )`,
    )
    .run({
      ...input,
      isCredit: input.isCredit ? 1 : 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  const targetId = Number(result.lastInsertRowid);
  const accountsAfter = tableRows(db, "accounts");

  if (
    result.changes !== 1 ||
    accountsAfter.length !== accountsBefore.length + 1 ||
    serialized(withoutId(accountsAfter, targetId)) !== serialized(accountsBefore)
  ) {
    throw new Error("account_create_write_invariant_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return response({
    action: "create",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["account_created", "sqlite_mutated"],
  });
};

const updateAccount = (
  db: Database.Database,
  input: NormalizedAccountInput,
  dryRun: AccountDryRunResponse,
): AccountWriteResponse => {
  const targetId = input.id!;
  const accountsBefore = tableRows(db, "accounts");
  const previous = accountsBefore.find((row) => row.id === targetId);
  if (!previous) {
    return response({
      action: "update",
      dryRun,
      targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: ["account_not_found"],
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: "account_not_found",
    });
  }
  const relatedBefore = relatedTableFingerprints(db);
  const result = db
    .prepare(
      `UPDATE accounts
       SET name = @name,
           currency = @currency,
           isCredit = @isCredit,
           creditLimit = @creditLimit,
           updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run({
      ...input,
      isCredit: input.isCredit ? 1 : 0,
      updatedAt: nextTimestamp(String(previous.updatedAt)),
    });
  const accountsAfter = tableRows(db, "accounts");
  const next = accountsAfter.find((row) => row.id === targetId);

  for (const field of [
    "id",
    "description",
    "imageBlob",
    "imageMimeType",
    "isActive",
    "createdAt",
  ]) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next?.[field])) {
      throw new Error(`account_update_changed_preserved_${field}`);
    }
  }
  if (
    result.changes !== 1 ||
    accountsAfter.length !== accountsBefore.length ||
    !next ||
    serialized(withoutId(accountsAfter, targetId)) !==
      serialized(withoutId(accountsBefore, targetId))
  ) {
    throw new Error("account_update_write_boundary_failed");
  }
  assertRelatedTablesUnchanged(db, relatedBefore);

  return response({
    action: "update",
    dryRun,
    targetId,
    rowsChanged: 1,
    sqliteMutated: true,
    resultCodes: ["account_updated", "sqlite_mutated"],
  });
};

export const accountRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: AccountAction,
): AccountWriteResponse => {
  const dataPayload = validateAccountWritePayload(payload, action);
  const dryRun = accountDryRun(db, dataPayload, action);

  if (!dryRun.ok) {
    return response({
      action,
      dryRun,
      targetId: dryRun.targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: dryRun.validationErrors,
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: dryRun.code ?? dryRun.validationErrors[0],
    });
  }

  const transaction = db.transaction(() => {
    const normalized = normalizeAccountPayload(dataPayload, action);
    return action === "create"
      ? createAccount(db, normalized, dryRun)
      : updateAccount(db, normalized, dryRun);
  });
  return transaction();
};

import Database from "better-sqlite3";

export const RECIPIENT_ACTIVATE_WRITE_CONFIRMATION =
  "activate recipient in disposable sqlite" as const;

const ACTIVATE_WRITE_FIELDS = new Set([
  "id",
  "expectedIsActive",
  "dryRunReviewed",
  "confirmation",
]);

const FORBIDDEN_ACTION_FIELDS = new Set([
  "delete",
  "deleteId",
  "merge",
  "mergeId",
  "primaryId",
  "secondaryId",
]);

interface RecipientActivateWriteInput {
  id: number;
  expectedIsActive: false;
  dryRunReviewed: true;
  confirmation: typeof RECIPIENT_ACTIVATE_WRITE_CONFIRMATION;
}

interface RecipientStateRow {
  id: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientActivateWriteResponse {
  ok: boolean;
  mode: "prototype";
  action: "activate";
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  targetIdPresent: boolean;
  targetId: number | null;
  previousStateSummary: {
    isActive: boolean | null;
  };
  newStateSummary: {
    isActive: boolean | null;
  };
  timestampBehavior: {
    createdAtWouldChange: false;
    updatedAtWouldChange: false;
    createdAtPreserved: boolean;
    updatedAtPreservedByCurrentToggleBehavior: true;
  };
  validationErrors: string[];
  warnings: string[];
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    transactionReferencesMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class RecipientWriteRequestError extends Error {
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

const normalizePositiveInteger = (value: unknown): number => {
  if (value === undefined || value === null || value === "") {
    throw new RecipientWriteRequestError("id_required");
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RecipientWriteRequestError("id_invalid");
  }

  return value;
};

export const validateRecipientActivateWritePayload = (
  payload: unknown,
): RecipientActivateWriteInput => {
  if (!isPlainObject(payload)) {
    throw new RecipientWriteRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new RecipientWriteRequestError("unsupported_first_write_action");
    }

    if (!ACTIVATE_WRITE_FIELDS.has(field)) {
      throw new RecipientWriteRequestError("unexpected_payload_field");
    }
  }

  const id = normalizePositiveInteger(payload.id);

  if (payload.expectedIsActive !== false) {
    throw new RecipientWriteRequestError("expected_is_active_false_required");
  }

  if (payload.dryRunReviewed !== true) {
    throw new RecipientWriteRequestError("dry_run_reviewed_required");
  }

  if (payload.confirmation !== RECIPIENT_ACTIVATE_WRITE_CONFIRMATION) {
    throw new RecipientWriteRequestError("matching_dry_run_required");
  }

  return {
    id,
    expectedIsActive: false,
    dryRunReviewed: true,
    confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
  };
};

const readRecipientState = (
  db: Database.Database,
  id: number,
): RecipientStateRow | undefined =>
  db
    .prepare("SELECT id, isActive, createdAt, updatedAt FROM recipients WHERE id = @id")
    .get({ id }) as RecipientStateRow | undefined;

const countRecipients = (db: Database.Database): number => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
};

const activeBoolean = (row: RecipientStateRow | undefined): boolean | null => {
  if (!row) {
    return null;
  }
  return row.isActive === 1;
};

const buildResponse = (input: {
  ok: boolean;
  targetId: number | null;
  previous: RecipientStateRow | undefined;
  next: RecipientStateRow | undefined;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  warnings?: string[];
  resultCodes: string[];
  code?: string;
}): RecipientActivateWriteResponse => {
  const validationErrors = input.validationErrors ?? [];
  const warnings = input.warnings ?? [];
  const createdAtPreserved =
    input.previous !== undefined &&
    input.next !== undefined &&
    input.previous.createdAt === input.next.createdAt;

  return {
    ok: input.ok,
    mode: "prototype",
    action: "activate",
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    previousStateSummary: {
      isActive: activeBoolean(input.previous),
    },
    newStateSummary: {
      isActive: activeBoolean(input.next),
    },
    timestampBehavior: {
      createdAtWouldChange: false,
      updatedAtWouldChange: false,
      createdAtPreserved,
      updatedAtPreservedByCurrentToggleBehavior: true,
    },
    validationErrors,
    warnings,
    safety: {
      sqliteMutated: input.sqliteMutated,
      dexieMutated: false,
      filesWritten: false,
      transactionReferencesMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: input.resultCodes,
    ...(input.code ? { code: input.code } : {}),
  };
};

export const recipientActivateWriteDisabledResponse = (
  targetId: number | null = null,
): RecipientActivateWriteResponse =>
  buildResponse({
    ok: false,
    targetId,
    previous: undefined,
    next: undefined,
    rowsChanged: 0,
    sqliteMutated: false,
    warnings: ["recipient_active_state_writes_disabled"],
    resultCodes: ["recipient_active_state_writes_disabled", "no_mutation_performed"],
    code: "recipient_active_state_writes_disabled",
  });

export const recipientActivateWriteRequestErrorResponse = (
  code: string,
): RecipientActivateWriteResponse =>
  buildResponse({
    ok: false,
    targetId: null,
    previous: undefined,
    next: undefined,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

export const activateRecipientWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientActivateWriteResponse => {
  const input = validateRecipientActivateWritePayload(payload);

  const transaction = db.transaction((): RecipientActivateWriteResponse => {
    const countBefore = countRecipients(db);
    const previous = readRecipientState(db, input.id);

    if (!previous) {
      return buildResponse({
        ok: false,
        targetId: input.id,
        previous,
        next: undefined,
        rowsChanged: 0,
        sqliteMutated: false,
        validationErrors: ["recipient_not_found"],
        resultCodes: ["recipient_not_found", "no_mutation_performed"],
        code: "recipient_not_found",
      });
    }

    if (previous.isActive === 1) {
      return buildResponse({
        ok: true,
        targetId: input.id,
        previous,
        next: previous,
        rowsChanged: 0,
        sqliteMutated: false,
        warnings: ["recipient_already_active"],
        resultCodes: ["recipient_already_active", "no_mutation_performed"],
      });
    }

    const updateResult = db
      .prepare("UPDATE recipients SET isActive = 1 WHERE id = @id AND isActive = 0")
      .run({ id: input.id });

    const next = readRecipientState(db, input.id);
    const countAfter = countRecipients(db);

    if (updateResult.changes !== 1 || countAfter !== countBefore || !next) {
      throw new Error("recipient_activate_write_invariant_failed");
    }

    if (previous.createdAt !== next.createdAt || previous.updatedAt !== next.updatedAt) {
      throw new Error("recipient_activate_timestamp_changed");
    }

    return buildResponse({
      ok: true,
      targetId: input.id,
      previous,
      next,
      rowsChanged: updateResult.changes,
      sqliteMutated: true,
      warnings: ["toggle_preserves_updated_at_current_behavior"],
      resultCodes: ["recipient_activated", "sqlite_mutated"],
    });
  });

  return transaction();
};

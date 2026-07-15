import Database from "better-sqlite3";

export const RECIPIENT_ACTIVATE_WRITE_CONFIRMATION =
  "activate recipient in disposable sqlite" as const;
export const RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION =
  "deactivate recipient in disposable sqlite" as const;
export const RECIPIENT_CREATE_WRITE_CONFIRMATION =
  "create recipient in disposable sqlite" as const;
export const RECIPIENT_UPDATE_WRITE_CONFIRMATION =
  "update recipient in disposable sqlite" as const;

const ACTIVE_STATE_WRITE_FIELDS = new Set([
  "id",
  "expectedIsActive",
  "dryRunReviewed",
  "confirmation",
]);

const CREATE_WRITE_FIELDS = new Set([
  "name",
  "aliases",
  "email",
  "phone",
  "tillNumber",
  "paybill",
  "accountNumber",
  "description",
  "dryRunReviewed",
  "confirmation",
]);

const UPDATE_WRITE_FIELDS = new Set([
  "id",
  "name",
  "aliases",
  "email",
  "phone",
  "tillNumber",
  "paybill",
  "accountNumber",
  "description",
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

type RecipientWriteAction = "activate" | "deactivate";
type RecipientCreateUpdateWriteAction = "create" | "update";

interface RecipientCreateUpdateWriteInput {
  id?: number;
  name: string;
  aliases: string | null;
  email: string | null;
  phone: string | null;
  tillNumber: string | null;
  paybill: string | null;
  accountNumber: string | null;
  description: string | null;
  dryRunReviewed: true;
  confirmation:
    | typeof RECIPIENT_CREATE_WRITE_CONFIRMATION
    | typeof RECIPIENT_UPDATE_WRITE_CONFIRMATION;
}

interface RecipientActiveStateWriteInput {
  id: number;
  expectedIsActive: boolean;
  dryRunReviewed: true;
  confirmation:
    | typeof RECIPIENT_ACTIVATE_WRITE_CONFIRMATION
    | typeof RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION;
}

interface RecipientStateRow {
  id: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

interface RecipientLookupRow {
  id: number;
  name: string;
  aliases: string | null;
  phone: string | null;
  paybill: string | null;
  accountNumber: string | null;
  isActive: number;
}

interface RecipientFullRow extends RecipientLookupRow {
  email: string | null;
  tillNumber: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientActiveStateWriteResponse {
  ok: boolean;
  mode: "prototype";
  action: RecipientWriteAction;
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

export interface RecipientCreateUpdateWriteResponse {
  ok: boolean;
  mode: "prototype";
  action: RecipientCreateUpdateWriteAction;
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  targetIdPresent: boolean;
  targetId: number | null;
  validationErrors: string[];
  warnings: string[];
  normalizedFieldPresence: {
    hasName: boolean;
    hasAliases: boolean;
    hasEmail: boolean;
    hasPhone: boolean;
    hasTillNumber: boolean;
    hasPaybill: boolean;
    hasAccountNumber: boolean;
    hasDescription: boolean;
    isActive: boolean;
  };
  duplicateSummary: {
    duplicateNameCandidates: number;
    duplicatePhoneCandidates: number;
    duplicatePaybillAccountCandidates: number;
    duplicateTillCandidates: null;
    aliasCollisions: number;
  };
  timestampBehavior: {
    createdAtWouldChange: boolean;
    updatedAtWouldChange: boolean;
    createdAtPreserved: boolean;
    updatedAtPreservedByCurrentToggleBehavior: false;
  };
  affectedSummary: {
    recipientRowsChanged: number;
    transactionRowsChanged: 0;
    transactionUsageCount: number;
  };
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

const normalizeOptionalText = (value: unknown, fieldName: string): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RecipientWriteRequestError(`${fieldName}_invalid`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeRequiredText = (value: unknown, fieldName: string): string => {
  const normalized = normalizeOptionalText(value, fieldName);
  if (!normalized) {
    throw new RecipientWriteRequestError(`${fieldName}_required`);
  }
  return normalized;
};

const normalizeAliases = (aliases: string | null): string[] =>
  (aliases ?? "")
    .split(";")
    .map((alias) => alias.toLowerCase().trim())
    .filter((alias) => alias.length > 0);

const nextTimestamp = (previous?: string): string => {
  const now = new Date();
  if (!previous) {
    return now.toISOString();
  }

  const previousTime = Date.parse(previous);
  if (!Number.isFinite(previousTime) || now.getTime() > previousTime) {
    return now.toISOString();
  }

  return new Date(previousTime + 1).toISOString();
};

const writeConfig = (action: RecipientWriteAction) => {
  if (action === "activate") {
    return {
      expectedIsActive: false,
      expectedStateError: "expected_is_active_false_required",
      confirmation: RECIPIENT_ACTIVATE_WRITE_CONFIRMATION,
      proposedActive: 1,
      previousActive: 0,
      noOpWarning: "recipient_already_active",
      invariantError: "recipient_activate_write_invariant_failed",
      timestampError: "recipient_activate_timestamp_changed",
      successCode: "recipient_activated",
    } as const;
  }

  return {
    expectedIsActive: true,
    expectedStateError: "expected_is_active_true_required",
    confirmation: RECIPIENT_DEACTIVATE_WRITE_CONFIRMATION,
    proposedActive: 0,
    previousActive: 1,
    noOpWarning: "recipient_already_inactive",
    invariantError: "recipient_deactivate_write_invariant_failed",
    timestampError: "recipient_deactivate_timestamp_changed",
    successCode: "recipient_deactivated",
  } as const;
};

const validateRecipientActiveStateWritePayload = (
  payload: unknown,
  action: RecipientWriteAction,
): RecipientActiveStateWriteInput => {
  if (!isPlainObject(payload)) {
    throw new RecipientWriteRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new RecipientWriteRequestError("unsupported_first_write_action");
    }

    if (!ACTIVE_STATE_WRITE_FIELDS.has(field)) {
      throw new RecipientWriteRequestError("unexpected_payload_field");
    }
  }

  const config = writeConfig(action);
  const id = normalizePositiveInteger(payload.id);

  if (payload.expectedIsActive !== config.expectedIsActive) {
    throw new RecipientWriteRequestError(config.expectedStateError);
  }

  if (payload.dryRunReviewed !== true) {
    throw new RecipientWriteRequestError("dry_run_reviewed_required");
  }

  if (payload.confirmation !== config.confirmation) {
    throw new RecipientWriteRequestError("matching_dry_run_required");
  }

  return {
    id,
    expectedIsActive: config.expectedIsActive,
    dryRunReviewed: true,
    confirmation: config.confirmation,
  };
};

const validateCreateUpdateWritePayloadFields = (
  payload: unknown,
  allowedFields: Set<string>,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new RecipientWriteRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new RecipientWriteRequestError("unsupported_first_write_action");
    }

    if (!allowedFields.has(field)) {
      throw new RecipientWriteRequestError("unexpected_payload_field");
    }
  }

  return payload;
};

const validateRecipientCreateUpdateWritePayload = (
  payload: unknown,
  action: RecipientCreateUpdateWriteAction,
): RecipientCreateUpdateWriteInput => {
  const input = validateCreateUpdateWritePayloadFields(
    payload,
    action === "create" ? CREATE_WRITE_FIELDS : UPDATE_WRITE_FIELDS,
  );

  const confirmation =
    action === "create"
      ? RECIPIENT_CREATE_WRITE_CONFIRMATION
      : RECIPIENT_UPDATE_WRITE_CONFIRMATION;

  if (input.dryRunReviewed !== true) {
    throw new RecipientWriteRequestError("dry_run_reviewed_required");
  }

  if (input.confirmation !== confirmation) {
    throw new RecipientWriteRequestError("matching_dry_run_required");
  }

  const normalized: RecipientCreateUpdateWriteInput = {
    ...(action === "update" ? { id: normalizePositiveInteger(input.id) } : {}),
    name: normalizeRequiredText(input.name, "name"),
    aliases: normalizeOptionalText(input.aliases, "aliases"),
    email: normalizeOptionalText(input.email, "email"),
    phone: normalizeOptionalText(input.phone, "phone"),
    tillNumber: normalizeOptionalText(input.tillNumber, "tillNumber"),
    paybill: normalizeOptionalText(input.paybill, "paybill"),
    accountNumber: normalizeOptionalText(input.accountNumber, "accountNumber"),
    description: normalizeOptionalText(input.description, "description"),
    dryRunReviewed: true,
    confirmation,
  };

  if (normalized.accountNumber && !normalized.paybill) {
    throw new RecipientWriteRequestError("account_number_requires_paybill");
  }

  return normalized;
};

export const validateRecipientActivateWritePayload = (
  payload: unknown,
): RecipientActiveStateWriteInput => validateRecipientActiveStateWritePayload(payload, "activate");

export const validateRecipientDeactivateWritePayload = (
  payload: unknown,
): RecipientActiveStateWriteInput => validateRecipientActiveStateWritePayload(payload, "deactivate");

export const validateRecipientCreateWritePayload = (
  payload: unknown,
): RecipientCreateUpdateWriteInput =>
  validateRecipientCreateUpdateWritePayload(payload, "create");

export const validateRecipientUpdateWritePayload = (
  payload: unknown,
): RecipientCreateUpdateWriteInput =>
  validateRecipientCreateUpdateWritePayload(payload, "update");

const readRecipientState = (
  db: Database.Database,
  id: number,
): RecipientStateRow | undefined =>
  db
    .prepare("SELECT id, isActive, createdAt, updatedAt FROM recipients WHERE id = @id")
    .get({ id }) as RecipientStateRow | undefined;

const readRecipientFullRow = (
  db: Database.Database,
  id: number,
): RecipientFullRow | undefined =>
  db
    .prepare(
      `SELECT id, name, aliases, email, phone, tillNumber, paybill,
        accountNumber, description, isActive, createdAt, updatedAt
       FROM recipients
       WHERE id = @id`,
    )
    .get({ id }) as RecipientFullRow | undefined;

const readRecipientLookupRows = (db: Database.Database): RecipientLookupRow[] =>
  db
    .prepare(
      `SELECT id, name, aliases, phone, paybill, accountNumber, isActive
       FROM recipients`,
    )
    .all() as RecipientLookupRow[];

const countRecipients = (db: Database.Database): number => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM recipients").get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
};

const countTransactionsForRecipient = (db: Database.Database, recipientId: number): number => {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE recipientId = @recipientId")
    .get({ recipientId }) as { count: number } | undefined;

  return row?.count ?? 0;
};

const countAliasCollisions = (
  proposedAliases: string[],
  rows: RecipientLookupRow[],
): number => {
  if (proposedAliases.length === 0) {
    return 0;
  }

  const proposed = new Set(proposedAliases);
  let collisions = 0;

  for (const row of rows) {
    const existingAliases = normalizeAliases(row.aliases);
    if (existingAliases.some((alias) => proposed.has(alias))) {
      collisions += 1;
    }
  }

  return collisions;
};

const duplicateSummaryForInput = (
  input: RecipientCreateUpdateWriteInput,
  rows: RecipientLookupRow[],
  action: RecipientCreateUpdateWriteAction,
): RecipientCreateUpdateWriteResponse["duplicateSummary"] => {
  const candidateRows =
    action === "update" && input.id !== undefined
      ? rows.filter((row) => row.id !== input.id)
      : rows;
  const normalizedNameLower = input.name.toLowerCase();

  return {
    duplicateNameCandidates: candidateRows.filter(
      (row) => row.name.toLowerCase() === normalizedNameLower,
    ).length,
    duplicatePhoneCandidates: input.phone
      ? candidateRows.filter((row) => row.phone?.trim() === input.phone).length
      : 0,
    duplicatePaybillAccountCandidates:
      input.paybill && input.accountNumber
        ? candidateRows.filter(
            (row) =>
              row.paybill?.trim() === input.paybill &&
              row.accountNumber?.trim() === input.accountNumber,
          ).length
        : 0,
    duplicateTillCandidates: null,
    aliasCollisions: countAliasCollisions(normalizeAliases(input.aliases), candidateRows),
  };
};

const activeBoolean = (row: RecipientStateRow | undefined): boolean | null => {
  if (!row) {
    return null;
  }
  return row.isActive === 1;
};

const buildResponse = (input: {
  action: RecipientWriteAction;
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
}): RecipientActiveStateWriteResponse => {
  const validationErrors = input.validationErrors ?? [];
  const warnings = input.warnings ?? [];
  const createdAtPreserved =
    input.previous !== undefined &&
    input.next !== undefined &&
    input.previous.createdAt === input.next.createdAt;

  return {
    ok: input.ok,
    mode: "prototype",
    action: input.action,
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

const recipientActiveStateWriteDisabledResponse = (
  action: RecipientWriteAction,
  targetId: number | null = null,
): RecipientActiveStateWriteResponse =>
  buildResponse({
    action,
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

const recipientActiveStateWriteRequestErrorResponse = (
  action: RecipientWriteAction,
  code: string,
): RecipientActiveStateWriteResponse =>
  buildResponse({
    action,
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

export const recipientActivateWriteDisabledResponse = (
  targetId: number | null = null,
): RecipientActiveStateWriteResponse =>
  recipientActiveStateWriteDisabledResponse("activate", targetId);

export const recipientDeactivateWriteDisabledResponse = (
  targetId: number | null = null,
): RecipientActiveStateWriteResponse =>
  recipientActiveStateWriteDisabledResponse("deactivate", targetId);

export const recipientActivateWriteRequestErrorResponse = (
  code: string,
): RecipientActiveStateWriteResponse =>
  recipientActiveStateWriteRequestErrorResponse("activate", code);

export const recipientDeactivateWriteRequestErrorResponse = (
  code: string,
): RecipientActiveStateWriteResponse =>
  recipientActiveStateWriteRequestErrorResponse("deactivate", code);

const normalizedFieldPresence = (
  input: RecipientCreateUpdateWriteInput | undefined,
  isActive: boolean,
): RecipientCreateUpdateWriteResponse["normalizedFieldPresence"] => ({
  hasName: (input?.name ?? "").length > 0,
  hasAliases: (input?.aliases ?? "").length > 0,
  hasEmail: (input?.email ?? "").length > 0,
  hasPhone: (input?.phone ?? "").length > 0,
  hasTillNumber: (input?.tillNumber ?? "").length > 0,
  hasPaybill: (input?.paybill ?? "").length > 0,
  hasAccountNumber: (input?.accountNumber ?? "").length > 0,
  hasDescription: (input?.description ?? "").length > 0,
  isActive,
});

const emptyDuplicateSummary =
  (): RecipientCreateUpdateWriteResponse["duplicateSummary"] => ({
    duplicateNameCandidates: 0,
    duplicatePhoneCandidates: 0,
    duplicatePaybillAccountCandidates: 0,
    duplicateTillCandidates: null,
    aliasCollisions: 0,
  });

const buildCreateUpdateResponse = (input: {
  action: RecipientCreateUpdateWriteAction;
  ok: boolean;
  input?: RecipientCreateUpdateWriteInput;
  targetId: number | null;
  rowsChanged: number;
  sqliteMutated: boolean;
  validationErrors?: string[];
  warnings?: string[];
  duplicateSummary?: RecipientCreateUpdateWriteResponse["duplicateSummary"];
  createdAtPreserved?: boolean;
  isActive?: boolean;
  transactionUsageCount?: number;
  resultCodes: string[];
  code?: string;
}): RecipientCreateUpdateWriteResponse => {
  const validationErrors = input.validationErrors ?? [];
  const warnings = input.warnings ?? [];
  const isActive = input.isActive ?? true;

  return {
    ok: input.ok,
    mode: "prototype",
    action: input.action,
    dryRunRequired: true,
    realWrite: true,
    sqliteMutated: input.sqliteMutated,
    rowsChanged: input.rowsChanged,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    validationErrors,
    warnings,
    normalizedFieldPresence: normalizedFieldPresence(input.input, isActive),
    duplicateSummary: input.duplicateSummary ?? emptyDuplicateSummary(),
    timestampBehavior: {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved:
        input.action === "update" ? input.createdAtPreserved === true : false,
      updatedAtPreservedByCurrentToggleBehavior: false,
    },
    affectedSummary: {
      recipientRowsChanged: input.rowsChanged,
      transactionRowsChanged: 0,
      transactionUsageCount: input.transactionUsageCount ?? 0,
    },
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

const recipientCreateUpdateWriteDisabledResponse = (
  action: RecipientCreateUpdateWriteAction,
  input?: RecipientCreateUpdateWriteInput,
): RecipientCreateUpdateWriteResponse =>
  buildCreateUpdateResponse({
    action,
    ok: false,
    input,
    targetId: input?.id ?? null,
    rowsChanged: 0,
    sqliteMutated: false,
    warnings: ["recipient_create_update_writes_disabled"],
    resultCodes: ["recipient_create_update_writes_disabled", "no_mutation_performed"],
    code: "recipient_create_update_writes_disabled",
  });

const recipientCreateUpdateWriteRequestErrorResponse = (
  action: RecipientCreateUpdateWriteAction,
  code: string,
): RecipientCreateUpdateWriteResponse =>
  buildCreateUpdateResponse({
    action,
    ok: false,
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });

export const recipientCreateWriteDisabledResponse = (
  input?: RecipientCreateUpdateWriteInput,
): RecipientCreateUpdateWriteResponse =>
  recipientCreateUpdateWriteDisabledResponse("create", input);

export const recipientUpdateWriteDisabledResponse = (
  input?: RecipientCreateUpdateWriteInput,
): RecipientCreateUpdateWriteResponse =>
  recipientCreateUpdateWriteDisabledResponse("update", input);

export const recipientCreateWriteRequestErrorResponse = (
  code: string,
): RecipientCreateUpdateWriteResponse =>
  recipientCreateUpdateWriteRequestErrorResponse("create", code);

export const recipientUpdateWriteRequestErrorResponse = (
  code: string,
): RecipientCreateUpdateWriteResponse =>
  recipientCreateUpdateWriteRequestErrorResponse("update", code);

const activeStateRecipientWrite = (
  db: Database.Database,
  payload: unknown,
  action: RecipientWriteAction,
): RecipientActiveStateWriteResponse => {
  const input = validateRecipientActiveStateWritePayload(payload, action);
  const config = writeConfig(action);

  const transaction = db.transaction((): RecipientActiveStateWriteResponse => {
    const countBefore = countRecipients(db);
    const previous = readRecipientState(db, input.id);

    if (!previous) {
      return buildResponse({
        action,
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

    if (previous.isActive === config.proposedActive) {
      return buildResponse({
        action,
        ok: true,
        targetId: input.id,
        previous,
        next: previous,
        rowsChanged: 0,
        sqliteMutated: false,
        warnings: [config.noOpWarning],
        resultCodes: [config.noOpWarning, "no_mutation_performed"],
      });
    }

    const updateResult = db
      .prepare(
        "UPDATE recipients SET isActive = @proposedActive WHERE id = @id AND isActive = @previousActive",
      )
      .run({
        id: input.id,
        proposedActive: config.proposedActive,
        previousActive: config.previousActive,
      });

    const next = readRecipientState(db, input.id);
    const countAfter = countRecipients(db);

    if (updateResult.changes !== 1 || countAfter !== countBefore || !next) {
      throw new Error(config.invariantError);
    }

    if (previous.createdAt !== next.createdAt || previous.updatedAt !== next.updatedAt) {
      throw new Error(config.timestampError);
    }

    return buildResponse({
      action,
      ok: true,
      targetId: input.id,
      previous,
      next,
      rowsChanged: updateResult.changes,
      sqliteMutated: true,
      warnings: ["toggle_preserves_updated_at_current_behavior"],
      resultCodes: [config.successCode, "sqlite_mutated"],
    });
  });

  return transaction();
};

const validateCreateUpdateAgainstDatabase = (
  db: Database.Database,
  input: RecipientCreateUpdateWriteInput,
  action: RecipientCreateUpdateWriteAction,
): {
  target?: RecipientFullRow;
  duplicateSummary: RecipientCreateUpdateWriteResponse["duplicateSummary"];
  validationErrors: string[];
  warnings: string[];
} => {
  const rows = readRecipientLookupRows(db);
  const target =
    action === "update" && input.id !== undefined
      ? readRecipientFullRow(db, input.id)
      : undefined;
  const validationErrors = new Set<string>();
  const warnings = new Set<string>();

  if (action === "update" && !target) {
    validationErrors.add("recipient_not_found");
  }

  if (input.tillNumber) {
    warnings.add("ambiguous_till_number_duplicate_behavior");
    warnings.add("duplicate_till_candidates_unknown");
  }

  const duplicateSummary = duplicateSummaryForInput(input, rows, action);

  if (
    duplicateSummary.duplicateNameCandidates > 0 ||
    duplicateSummary.duplicatePhoneCandidates > 0 ||
    duplicateSummary.duplicatePaybillAccountCandidates > 0
  ) {
    validationErrors.add("duplicate_candidate_detected");
  }

  if (duplicateSummary.aliasCollisions > 0) {
    validationErrors.add("alias_collision_detected");
    warnings.add("alias_collision_count_redacted");
  }

  if (duplicateSummary.duplicateNameCandidates > 0) {
    warnings.add("duplicate_name_candidates_present");
  }
  if (duplicateSummary.duplicatePhoneCandidates > 0) {
    warnings.add("duplicate_phone_candidates_present");
  }
  if (duplicateSummary.duplicatePaybillAccountCandidates > 0) {
    warnings.add("duplicate_paybill_account_candidates_present");
  }

  return {
    target,
    duplicateSummary,
    validationErrors: [...validationErrors],
    warnings: [...warnings],
  };
};

const createRecipientWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientCreateUpdateWriteResponse => {
  const input = validateRecipientCreateWritePayload(payload);

  const transaction = db.transaction((): RecipientCreateUpdateWriteResponse => {
    const countBefore = countRecipients(db);
    const checked = validateCreateUpdateAgainstDatabase(db, input, "create");

    if (checked.validationErrors.length > 0) {
      return buildCreateUpdateResponse({
        action: "create",
        ok: false,
        input,
        targetId: null,
        rowsChanged: 0,
        sqliteMutated: false,
        validationErrors: checked.validationErrors,
        warnings: checked.warnings,
        duplicateSummary: checked.duplicateSummary,
        resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
        code: checked.validationErrors[0],
      });
    }

    const timestamp = nextTimestamp();
    const insertResult = db
      .prepare(
        `INSERT INTO recipients (
          name, aliases, email, phone, tillNumber, paybill, accountNumber,
          description, isActive, createdAt, updatedAt
        ) VALUES (
          @name, @aliases, @email, @phone, @tillNumber, @paybill, @accountNumber,
          @description, 1, @createdAt, @updatedAt
        )`,
      )
      .run({
        name: input.name,
        aliases: input.aliases,
        email: input.email,
        phone: input.phone,
        tillNumber: input.tillNumber,
        paybill: input.paybill,
        accountNumber: input.accountNumber,
        description: input.description,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const targetId = Number(insertResult.lastInsertRowid);
    const next = readRecipientFullRow(db, targetId);
    const countAfter = countRecipients(db);

    if (insertResult.changes !== 1 || countAfter !== countBefore + 1 || !next) {
      throw new Error("recipient_create_write_invariant_failed");
    }

    return buildCreateUpdateResponse({
      action: "create",
      ok: true,
      input,
      targetId,
      rowsChanged: insertResult.changes,
      sqliteMutated: true,
      warnings: checked.warnings,
      duplicateSummary: checked.duplicateSummary,
      resultCodes: ["recipient_created", "sqlite_mutated"],
    });
  });

  return transaction();
};

const updateRecipientWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientCreateUpdateWriteResponse => {
  const input = validateRecipientUpdateWritePayload(payload);

  const transaction = db.transaction((): RecipientCreateUpdateWriteResponse => {
    const countBefore = countRecipients(db);
    const checked = validateCreateUpdateAgainstDatabase(db, input, "update");
    const targetId = input.id ?? null;

    if (!checked.target || checked.validationErrors.length > 0) {
      return buildCreateUpdateResponse({
        action: "update",
        ok: false,
        input,
        targetId,
        rowsChanged: 0,
        sqliteMutated: false,
        validationErrors: checked.validationErrors,
        warnings: checked.warnings,
        duplicateSummary: checked.duplicateSummary,
        transactionUsageCount:
          targetId === null ? 0 : countTransactionsForRecipient(db, targetId),
        isActive: checked.target ? checked.target.isActive === 1 : true,
        resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
        code: checked.validationErrors[0] ?? "recipient_update_write_invalid",
      });
    }

    const timestamp = nextTimestamp(checked.target.updatedAt);
    const updateResult = db
      .prepare(
        `UPDATE recipients
         SET name = @name,
             aliases = @aliases,
             email = @email,
             phone = @phone,
             tillNumber = @tillNumber,
             paybill = @paybill,
             accountNumber = @accountNumber,
             description = @description,
             updatedAt = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: input.id,
        name: input.name,
        aliases: input.aliases,
        email: input.email,
        phone: input.phone,
        tillNumber: input.tillNumber,
        paybill: input.paybill,
        accountNumber: input.accountNumber,
        description: input.description,
        updatedAt: timestamp,
      });

    const next = readRecipientFullRow(db, input.id!);
    const countAfter = countRecipients(db);

    if (updateResult.changes !== 1 || countAfter !== countBefore || !next) {
      throw new Error("recipient_update_write_invariant_failed");
    }

    if (
      checked.target.createdAt !== next.createdAt ||
      checked.target.isActive !== next.isActive
    ) {
      throw new Error("recipient_update_write_boundary_failed");
    }

    return buildCreateUpdateResponse({
      action: "update",
      ok: true,
      input,
      targetId: input.id!,
      rowsChanged: updateResult.changes,
      sqliteMutated: true,
      warnings: checked.warnings,
      duplicateSummary: checked.duplicateSummary,
      createdAtPreserved: checked.target.createdAt === next.createdAt,
      isActive: next.isActive === 1,
      transactionUsageCount: countTransactionsForRecipient(db, input.id!),
      resultCodes: ["recipient_updated", "sqlite_mutated"],
    });
  });

  return transaction();
};

export const activateRecipientWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientActiveStateWriteResponse => activeStateRecipientWrite(db, payload, "activate");

export const deactivateRecipientWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientActiveStateWriteResponse => activeStateRecipientWrite(db, payload, "deactivate");

export const createRecipientRealWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientCreateUpdateWriteResponse => createRecipientWrite(db, payload);

export const updateRecipientRealWrite = (
  db: Database.Database,
  payload: unknown,
): RecipientCreateUpdateWriteResponse => updateRecipientWrite(db, payload);

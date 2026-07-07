import Database from "better-sqlite3";

const CREATE_FIELDS = new Set([
  "name",
  "aliases",
  "email",
  "phone",
  "tillNumber",
  "paybill",
  "accountNumber",
  "description",
]);

const UPDATE_FIELDS = new Set([...CREATE_FIELDS, "id"]);

const FORBIDDEN_ACTION_FIELDS = new Set([
  "delete",
  "deleteId",
  "merge",
  "mergeId",
  "primaryId",
  "secondaryId",
]);

interface RecipientDryRunInput {
  id?: number;
  name?: string;
  aliases?: string;
  email?: string;
  phone?: string;
  tillNumber?: string;
  paybill?: string;
  accountNumber?: string;
  description?: string;
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

export interface RecipientDryRunResponse {
  ok: boolean;
  mode: "prototype";
  action: "create" | "update";
  dryRun: true;
  wouldMutate: false;
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
    recipientRowsWouldChange: 0;
    transactionRowsWouldChange: 0;
    transactionUsageCount: 0;
  };
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    transactionReferencesMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
}

export class RecipientDryRunRequestError extends Error {
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

const normalizeOptionalText = (value: unknown, fieldName: keyof RecipientDryRunInput): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new RecipientDryRunRequestError(`${fieldName}_invalid`);
  }

  return value.trim();
};

const normalizePositiveInteger = (
  value: unknown,
  fieldName: keyof RecipientDryRunInput,
): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RecipientDryRunRequestError(`${fieldName}_invalid`);
  }

  return value;
};

const normalizeAliases = (aliases: string): string[] =>
  aliases
    .split(";")
    .map((alias) => alias.toLowerCase().trim())
    .filter((alias) => alias.length > 0);

const countAliasCollisions = (proposedAliases: string[], rows: RecipientLookupRow[]): number => {
  if (proposedAliases.length === 0) {
    return 0;
  }

  const proposed = new Set(proposedAliases);
  let collisions = 0;

  for (const row of rows) {
    if (!row.aliases) {
      continue;
    }

    const existingAliases = normalizeAliases(row.aliases);
    if (existingAliases.some((alias) => proposed.has(alias))) {
      collisions += 1;
    }
  }

  return collisions;
};

const readRecipientLookupRows = (db: Database.Database): RecipientLookupRow[] =>
  db
    .prepare(
      `SELECT id, name, aliases, phone, paybill, accountNumber,
        isActive FROM recipients`,
    )
    .all() as RecipientLookupRow[];

const buildSafeRequestErrorResponse = (
  action: "create" | "update",
  code: string,
): RecipientDryRunResponse => ({
  ok: false,
  mode: "prototype",
  action,
  dryRun: true,
  wouldMutate: false,
  targetIdPresent: false,
  targetId: null,
  validationErrors: [code],
  warnings: [],
  normalizedFieldPresence: {
    hasName: false,
    hasAliases: false,
    hasEmail: false,
    hasPhone: false,
    hasTillNumber: false,
    hasPaybill: false,
      hasAccountNumber: false,
      hasDescription: false,
      isActive: true,
  },
  duplicateSummary: {
    duplicateNameCandidates: 0,
    duplicatePhoneCandidates: 0,
    duplicatePaybillAccountCandidates: 0,
    duplicateTillCandidates: null,
    aliasCollisions: 0,
  },
  timestampBehavior: {
    createdAtWouldChange: false,
    updatedAtWouldChange: false,
    createdAtPreserved: true,
    updatedAtPreservedByCurrentToggleBehavior: false,
  },
  affectedSummary: {
    recipientRowsWouldChange: 0,
    transactionRowsWouldChange: 0,
    transactionUsageCount: 0,
  },
  safety: {
    sqliteMutated: false,
    dexieMutated: false,
    filesWritten: false,
    transactionReferencesMutated: false,
    rawRowsIncluded: false,
  },
  resultCodes: ["dry_run_has_validation_errors", "no_mutation_performed"],
});

const validatePayloadFields = (
  payload: unknown,
  allowedFields: Set<string>,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new RecipientDryRunRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new RecipientDryRunRequestError("unsupported_first_slice_action");
    }

    if (!allowedFields.has(field)) {
      throw new RecipientDryRunRequestError("unexpected_payload_field");
    }
  }

  return payload;
};

export const validateCreateRecipientDryRunPayload = (
  payload: unknown,
): RecipientDryRunInput => {
  return validatePayloadFields(payload, CREATE_FIELDS) as RecipientDryRunInput;
};

export const validateUpdateRecipientDryRunPayload = (
  payload: unknown,
): RecipientDryRunInput => {
  return validatePayloadFields(payload, UPDATE_FIELDS) as RecipientDryRunInput;
};

const buildRecipientDryRun = (
  db: Database.Database,
  payload: unknown,
  action: "create" | "update",
): RecipientDryRunResponse => {
  const input =
    action === "create"
      ? validateCreateRecipientDryRunPayload(payload)
      : validateUpdateRecipientDryRunPayload(payload);

  const normalized = {
    id: normalizePositiveInteger(input.id, "id"),
    name: normalizeOptionalText(input.name, "name"),
    aliases: normalizeOptionalText(input.aliases, "aliases"),
    email: normalizeOptionalText(input.email, "email"),
    phone: normalizeOptionalText(input.phone, "phone"),
    tillNumber: normalizeOptionalText(input.tillNumber, "tillNumber"),
    paybill: normalizeOptionalText(input.paybill, "paybill"),
    accountNumber: normalizeOptionalText(input.accountNumber, "accountNumber"),
    description: normalizeOptionalText(input.description, "description"),
  };

  const validationErrors = new Set<string>();
  const warnings = new Set<string>();

  const rows = readRecipientLookupRows(db);
  const target = action === "update" ? rows.find((row) => row.id === normalized.id) : undefined;

  if (action === "update" && normalized.id === undefined) {
    validationErrors.add("id_required");
  }

  if (action === "update" && normalized.id !== undefined && !target) {
    validationErrors.add("recipient_not_found");
  }

  if (!normalized.name) {
    validationErrors.add("name_required");
  }

  if (normalized.accountNumber && !normalized.paybill) {
    validationErrors.add("account_number_requires_paybill");
  }

  if (normalized.tillNumber) {
    warnings.add("ambiguous_till_number_duplicate_behavior");
    warnings.add("duplicate_till_candidates_unknown");
  }

  const candidateRows =
    action === "update" && normalized.id !== undefined
      ? rows.filter((row) => row.id !== normalized.id)
      : rows;
  const normalizedNameLower = normalized.name.toLowerCase();
  const duplicateNameCandidates = normalized.name
    ? candidateRows.filter((row) => row.name.toLowerCase() === normalizedNameLower).length
    : 0;
  const duplicatePhoneCandidates = normalized.phone
    ? candidateRows.filter((row) => row.phone?.trim() === normalized.phone).length
    : 0;
  const duplicatePaybillAccountCandidates =
    normalized.paybill && normalized.accountNumber
      ? candidateRows.filter(
          (row) =>
            row.paybill?.trim() === normalized.paybill &&
            row.accountNumber?.trim() === normalized.accountNumber,
        ).length
      : 0;
  const aliasCollisions = countAliasCollisions(normalizeAliases(normalized.aliases), candidateRows);

  if (
    duplicateNameCandidates > 0 ||
    duplicatePhoneCandidates > 0 ||
    duplicatePaybillAccountCandidates > 0
  ) {
    validationErrors.add("duplicate_candidate_detected");
  }

  if (aliasCollisions > 0) {
    validationErrors.add("alias_collision_detected");
    warnings.add("alias_collision_count_redacted");
  }

  if (duplicateNameCandidates > 0) {
    warnings.add("duplicate_name_candidates_present");
  }
  if (duplicatePhoneCandidates > 0) {
    warnings.add("duplicate_phone_candidates_present");
  }
  if (duplicatePaybillAccountCandidates > 0) {
    warnings.add("duplicate_paybill_account_candidates_present");
  }

  const validationErrorList = [...validationErrors];
  const warningList = [...warnings];
  const resultCodes = ["no_mutation_performed"];
  if (validationErrorList.length > 0) {
    resultCodes.push("dry_run_has_validation_errors");
  } else {
    resultCodes.push("dry_run_valid");
  }
  if (warningList.length > 0) {
    resultCodes.push("dry_run_has_warnings");
  }

  return {
    ok: validationErrorList.length === 0,
    mode: "prototype",
    action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: action === "update" && normalized.id !== undefined,
    targetId: action === "update" ? normalized.id ?? null : null,
    validationErrors: validationErrorList,
    warnings: warningList,
    normalizedFieldPresence: {
      hasName: normalized.name.length > 0,
      hasAliases: normalized.aliases.length > 0,
      hasEmail: normalized.email.length > 0,
      hasPhone: normalized.phone.length > 0,
      hasTillNumber: normalized.tillNumber.length > 0,
      hasPaybill: normalized.paybill.length > 0,
      hasAccountNumber: normalized.accountNumber.length > 0,
      hasDescription: normalized.description.length > 0,
      isActive: action === "update" && target ? target.isActive === 1 : true,
    },
    duplicateSummary: {
      duplicateNameCandidates,
      duplicatePhoneCandidates,
      duplicatePaybillAccountCandidates,
      duplicateTillCandidates: null,
      aliasCollisions,
    },
    timestampBehavior: {
      createdAtWouldChange: action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: action === "update",
      updatedAtPreservedByCurrentToggleBehavior: false,
    },
    affectedSummary: {
      recipientRowsWouldChange: 0,
      transactionRowsWouldChange: 0,
      transactionUsageCount: 0,
    },
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      transactionReferencesMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes,
  };
};

export const createRecipientDryRun = (
  db: Database.Database,
  payload: unknown,
): RecipientDryRunResponse => buildRecipientDryRun(db, payload, "create");

export const updateRecipientDryRun = (
  db: Database.Database,
  payload: unknown,
): RecipientDryRunResponse => buildRecipientDryRun(db, payload, "update");

export const recipientDryRunRequestErrorResponse = (
  action: "create" | "update",
  code: string,
): RecipientDryRunResponse => buildSafeRequestErrorResponse(action, code);

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

const FORBIDDEN_ACTION_FIELDS = new Set([
  "delete",
  "deleteId",
  "merge",
  "mergeId",
  "primaryId",
  "secondaryId",
]);

interface RecipientDryRunInput {
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
}

export interface RecipientDryRunResponse {
  ok: boolean;
  mode: "prototype";
  action: "create";
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: false;
  targetId: null;
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
    isActive: true;
  };
  duplicateSummary: {
    duplicateNameCandidates: number;
    duplicatePhoneCandidates: number;
    duplicatePaybillAccountCandidates: number;
    duplicateTillCandidates: null;
    aliasCollisions: number;
  };
  timestampBehavior: {
    createdAtWouldChange: true;
    updatedAtWouldChange: true;
    createdAtPreserved: false;
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
      `SELECT id, name, aliases, phone, paybill, accountNumber
       FROM recipients`,
    )
    .all() as RecipientLookupRow[];

export const validateCreateRecipientDryRunPayload = (
  payload: unknown,
): RecipientDryRunInput => {
  if (!isPlainObject(payload)) {
    throw new RecipientDryRunRequestError("payload_must_be_object");
  }

  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_ACTION_FIELDS.has(field)) {
      throw new RecipientDryRunRequestError("unsupported_first_slice_action");
    }

    if (!CREATE_FIELDS.has(field)) {
      throw new RecipientDryRunRequestError("unexpected_payload_field");
    }
  }

  return payload as RecipientDryRunInput;
};

export const createRecipientDryRun = (
  db: Database.Database,
  payload: unknown,
): RecipientDryRunResponse => {
  const input = validateCreateRecipientDryRunPayload(payload);

  const normalized = {
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

  const rows = readRecipientLookupRows(db);
  const normalizedNameLower = normalized.name.toLowerCase();
  const duplicateNameCandidates = normalized.name
    ? rows.filter((row) => row.name.toLowerCase() === normalizedNameLower).length
    : 0;
  const duplicatePhoneCandidates = normalized.phone
    ? rows.filter((row) => row.phone?.trim() === normalized.phone).length
    : 0;
  const duplicatePaybillAccountCandidates =
    normalized.paybill && normalized.accountNumber
      ? rows.filter(
          (row) =>
            row.paybill?.trim() === normalized.paybill &&
            row.accountNumber?.trim() === normalized.accountNumber,
        ).length
      : 0;
  const aliasCollisions = countAliasCollisions(normalizeAliases(normalized.aliases), rows);

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
    action: "create",
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: false,
    targetId: null,
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
      isActive: true,
    },
    duplicateSummary: {
      duplicateNameCandidates,
      duplicatePhoneCandidates,
      duplicatePaybillAccountCandidates,
      duplicateTillCandidates: null,
      aliasCollisions,
    },
    timestampBehavior: {
      createdAtWouldChange: true,
      updatedAtWouldChange: true,
      createdAtPreserved: false,
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

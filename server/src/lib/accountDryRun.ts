import Database from "better-sqlite3";

export type AccountAction = "create" | "update";

const ACCOUNT_CREATE_FIELDS = new Set([
  "name",
  "currency",
  "isCredit",
  "creditLimit",
]);
const ACCOUNT_UPDATE_FIELDS = new Set([...ACCOUNT_CREATE_FIELDS, "id"]);
const FORBIDDEN_FIELDS = new Set([
  "delete",
  "deleteId",
  "merge",
  "mergeId",
  "isActive",
  "imageBlob",
  "imageMimeType",
  "description",
  "createdAt",
  "updatedAt",
]);

export interface NormalizedAccountInput {
  id?: number;
  name: string;
  currency: string;
  isCredit: boolean;
  creditLimit: number | null;
}

export interface AccountDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "account";
  action: AccountAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  targetId: number | null;
  validationErrors: string[];
  warnings: string[];
  duplicateSummary: {
    duplicateNameCandidates: number;
  };
  normalizedFieldPresence: {
    hasName: boolean;
    hasCurrency: boolean;
    hasCreditClassification: boolean;
    hasCreditLimit: boolean;
    hasImageInput: false;
  };
  financialSignificance: {
    currencyWouldChange: boolean;
    creditClassificationWouldChange: boolean;
    creditLimitWouldChange: boolean;
    balancesWouldChange: false;
    transactionsWouldChange: false;
  };
  timestampBehavior: {
    createdAtWouldChange: boolean;
    updatedAtWouldChange: boolean;
    createdAtPreserved: boolean;
  };
  affectedSummary: {
    accountRowsWouldChange: 0;
    transactionRowsWouldChange: 0;
    paymentMethodRowsWouldChange: 0;
    budgetRowsWouldChange: 0;
    budgetSnapshotRowsWouldChange: 0;
  };
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    relatedRecordsMutated: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class AccountDryRunRequestError extends Error {
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

const validateFields = (
  payload: unknown,
  action: AccountAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new AccountDryRunRequestError("payload_must_be_object");
  }

  const allowedFields =
    action === "create" ? ACCOUNT_CREATE_FIELDS : ACCOUNT_UPDATE_FIELDS;
  for (const field of Object.keys(payload)) {
    if (FORBIDDEN_FIELDS.has(field)) {
      throw new AccountDryRunRequestError("unsupported_write_field");
    }
    if (!allowedFields.has(field)) {
      throw new AccountDryRunRequestError("unexpected_payload_field");
    }
  }

  return payload;
};

const normalizePositiveInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AccountDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

const normalizeRequiredText = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new AccountDryRunRequestError(`${fieldName}_invalid`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new AccountDryRunRequestError(`${fieldName}_required`);
  }
  return normalized;
};

const normalizeBoolean = (
  value: unknown,
  fieldName: string,
  defaultValue: boolean,
): boolean => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new AccountDryRunRequestError(`${fieldName}_invalid`);
  }
  return value;
};

const normalizeCreditLimit = (
  value: unknown,
  isCredit: boolean,
): number | null => {
  if (!isCredit || value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AccountDryRunRequestError("creditLimit_invalid");
  }
  return value;
};

export const normalizeAccountPayload = (
  payload: unknown,
  action: AccountAction,
): NormalizedAccountInput => {
  const input = validateFields(payload, action);
  const isCredit = normalizeBoolean(input.isCredit, "isCredit", false);

  return {
    ...(action === "update"
      ? { id: normalizePositiveInteger(input.id, "id") }
      : {}),
    name: normalizeRequiredText(input.name, "name"),
    currency:
      input.currency === undefined || input.currency === null
        ? "KES"
        : normalizeRequiredText(input.currency, "currency"),
    isCredit,
    creditLimit: normalizeCreditLimit(input.creditLimit, isCredit),
  };
};

const countDuplicateNames = (
  db: Database.Database,
  name: string,
  excludedId?: number,
): number => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM accounts
       WHERE LOWER(TRIM(name)) = LOWER(@name)
         AND (@excludedId IS NULL OR id <> @excludedId)`,
    )
    .get({ name, excludedId: excludedId ?? null }) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
};

const accountSummary = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db
    .prepare(
      `SELECT id, currency, isCredit, creditLimit
       FROM accounts
       WHERE id = @id`,
    )
    .get({ id }) as Record<string, unknown> | undefined;

const response = (input: {
  action: AccountAction;
  targetId: number | null;
  validationErrors?: string[];
  warnings?: string[];
  duplicateNameCandidates?: number;
  hasName?: boolean;
  hasCurrency?: boolean;
  hasCreditClassification?: boolean;
  hasCreditLimit?: boolean;
  currencyWouldChange?: boolean;
  creditClassificationWouldChange?: boolean;
  creditLimitWouldChange?: boolean;
  code?: string;
}): AccountDryRunResponse => {
  const validationErrors = input.validationErrors ?? [];
  const warnings = input.warnings ?? [];

  return {
    ok: validationErrors.length === 0,
    mode: "prototype",
    entity: "account",
    action: input.action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: input.targetId !== null,
    targetId: input.targetId,
    validationErrors,
    warnings,
    duplicateSummary: {
      duplicateNameCandidates: input.duplicateNameCandidates ?? 0,
    },
    normalizedFieldPresence: {
      hasName: input.hasName ?? false,
      hasCurrency: input.hasCurrency ?? false,
      hasCreditClassification: input.hasCreditClassification ?? false,
      hasCreditLimit: input.hasCreditLimit ?? false,
      hasImageInput: false,
    },
    financialSignificance: {
      currencyWouldChange: input.currencyWouldChange ?? false,
      creditClassificationWouldChange:
        input.creditClassificationWouldChange ?? false,
      creditLimitWouldChange: input.creditLimitWouldChange ?? false,
      balancesWouldChange: false,
      transactionsWouldChange: false,
    },
    timestampBehavior: {
      createdAtWouldChange: input.action === "create",
      updatedAtWouldChange: true,
      createdAtPreserved: input.action === "update",
    },
    affectedSummary: {
      accountRowsWouldChange: 0,
      transactionRowsWouldChange: 0,
      paymentMethodRowsWouldChange: 0,
      budgetRowsWouldChange: 0,
      budgetSnapshotRowsWouldChange: 0,
    },
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      relatedRecordsMutated: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      validationErrors.length > 0
        ? "dry_run_has_validation_errors"
        : "dry_run_valid",
      ...(warnings.length > 0 ? ["dry_run_has_warnings"] : []),
      "no_mutation_performed",
    ],
    ...(input.code ? { code: input.code } : {}),
  };
};

export const accountDryRun = (
  db: Database.Database,
  payload: unknown,
  action: AccountAction,
): AccountDryRunResponse => {
  const normalized = normalizeAccountPayload(payload, action);
  const validationErrors: string[] = [];
  const warnings = [
    "account_images_not_supported_in_http_write_experiment",
    "transactions_balances_and_references_not_mutated",
  ];
  const targetId = action === "update" ? normalized.id ?? null : null;
  const previous =
    action === "update" && normalized.id !== undefined
      ? accountSummary(db, normalized.id)
      : undefined;

  if (action === "update" && !previous) {
    validationErrors.push("account_not_found");
  }

  const duplicateNameCandidates = countDuplicateNames(
    db,
    normalized.name,
    normalized.id,
  );
  if (duplicateNameCandidates > 0) {
    warnings.push("duplicate_name_candidates_present");
  }

  const currencyWouldChange =
    action === "create" || previous?.currency !== normalized.currency;
  const creditClassificationWouldChange =
    action === "create" ||
    (previous !== undefined &&
      Boolean(previous.isCredit) !== normalized.isCredit);
  const creditLimitWouldChange =
    action === "create" ||
    (previous !== undefined &&
      (previous.creditLimit ?? null) !== normalized.creditLimit);

  if (currencyWouldChange) {
    warnings.push("account_currency_is_financially_significant");
  }
  if (creditClassificationWouldChange) {
    warnings.push("account_credit_classification_is_financially_significant");
  }
  if (creditLimitWouldChange) {
    warnings.push("account_credit_limit_display_may_change");
  }

  return response({
    action,
    targetId,
    validationErrors,
    warnings,
    duplicateNameCandidates,
    hasName: true,
    hasCurrency: true,
    hasCreditClassification: true,
    hasCreditLimit: normalized.creditLimit !== null,
    currencyWouldChange,
    creditClassificationWouldChange,
    creditLimitWouldChange,
    code: validationErrors[0],
  });
};

export const accountDryRunRequestErrorResponse = (
  action: AccountAction,
  code: string,
): AccountDryRunResponse =>
  response({
    action,
    targetId: null,
    validationErrors: [code],
    code,
  });

import Database from "better-sqlite3";

export type SmsTemplateAction =
  | "create"
  | "update"
  | "activate"
  | "deactivate"
  | "delete";

export const SMS_TEMPLATE_PATTERN_FIELDS = [
  "referencePattern",
  "amountPattern",
  "recipientNamePattern",
  "recipientPhonePattern",
  "dateTimePattern",
  "costPattern",
  "incomePattern",
  "expensePattern",
] as const;

type PatternField = (typeof SMS_TEMPLATE_PATTERN_FIELDS)[number];

const TEMPLATE_DATA_FIELDS = new Set([
  "id",
  "name",
  "description",
  "accountId",
  ...SMS_TEMPLATE_PATTERN_FIELDS,
]);
const ID_ONLY_ACTIONS = new Set<SmsTemplateAction>([
  "activate",
  "deactivate",
  "delete",
]);

export interface NormalizedSmsTemplateInput {
  id?: number;
  name?: string;
  description?: string | null;
  accountId?: number | null;
  referencePattern?: string | null;
  amountPattern?: string | null;
  recipientNamePattern?: string | null;
  recipientPhonePattern?: string | null;
  dateTimePattern?: string | null;
  costPattern?: string | null;
  incomePattern?: string | null;
  expensePattern?: string | null;
}

export interface SmsTemplateDryRunResponse {
  ok: boolean;
  mode: "prototype";
  entity: "smsImportTemplate";
  action: SmsTemplateAction;
  dryRun: true;
  wouldMutate: false;
  targetIdPresent: boolean;
  targetId: number | null;
  patternSyntaxValid: boolean;
  referenceSummary: {
    accountIdProvided: boolean;
    accountExists: boolean | null;
  };
  duplicateSummary: {
    duplicateNameCandidates: number;
    duplicatePatternSignatureCandidates: number;
  };
  matchingRiskSummary: {
    broadPatternCount: number;
    parserSignificantFieldsWouldChange: number;
  };
  normalizedFieldPresence: {
    hasName: boolean;
    hasDescription: boolean;
    hasAccountId: boolean;
    patternCount: number;
    isActive: boolean | null;
  };
  timestampBehavior: {
    createdAtWouldChange: boolean;
    updatedAtWouldChange: boolean;
    createdAtPreserved: boolean;
  };
  validationErrors: string[];
  warnings: string[];
  safety: {
    sqliteMutated: false;
    dexieMutated: false;
    filesWritten: false;
    transactionsMutated: false;
    accountsMutated: false;
    recipientsMutated: false;
    parserExecuted: false;
    rawRowsIncluded: false;
  };
  resultCodes: string[];
  code?: string;
}

export class SmsTemplateDryRunRequestError extends Error {
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

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new SmsTemplateDryRunRequestError(`${field}_invalid`);
  }
  return value;
};

const optionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new SmsTemplateDryRunRequestError(`${field}_invalid`);
  }
  const normalized = value.trim();
  return normalized || null;
};

const requiredText = (value: unknown, field: string): string => {
  const normalized = optionalText(value, field);
  if (!normalized) {
    throw new SmsTemplateDryRunRequestError(`${field}_required`);
  }
  return normalized;
};

const validateFields = (
  payload: unknown,
  action: SmsTemplateAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new SmsTemplateDryRunRequestError("payload_must_be_object");
  }

  const allowedFields = ID_ONLY_ACTIONS.has(action)
    ? new Set(["id"])
    : action === "create"
      ? new Set([...TEMPLATE_DATA_FIELDS].filter((field) => field !== "id"))
      : TEMPLATE_DATA_FIELDS;

  for (const field of Object.keys(payload)) {
    if (
      field === "paymentMethodId" ||
      field === "isActive" ||
      field === "createdAt" ||
      field === "updatedAt"
    ) {
      throw new SmsTemplateDryRunRequestError("unsupported_write_field");
    }
    if (!allowedFields.has(field)) {
      throw new SmsTemplateDryRunRequestError("unexpected_payload_field");
    }
  }
  return payload;
};

export const normalizeSmsTemplatePayload = (
  payload: unknown,
  action: SmsTemplateAction,
): NormalizedSmsTemplateInput => {
  const input = validateFields(payload, action);
  if (ID_ONLY_ACTIONS.has(action)) {
    return { id: positiveInteger(input.id, "id") };
  }

  const normalized: NormalizedSmsTemplateInput = {
    ...(action === "update" ? { id: positiveInteger(input.id, "id") } : {}),
    name: requiredText(input.name, "name"),
    description: optionalText(input.description, "description"),
    accountId:
      input.accountId === undefined || input.accountId === null || input.accountId === ""
        ? null
        : positiveInteger(input.accountId, "accountId"),
  };
  for (const field of SMS_TEMPLATE_PATTERN_FIELDS) {
    normalized[field] = optionalText(input[field], field);
  }
  return normalized;
};

const captureGroupCount = (source: string): number => {
  let count = 0;
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "]") {
      inClass = false;
      continue;
    }
    if (!inClass && character === "(") {
      const suffix = source.slice(index + 1, index + 3);
      const lookbehindMarker = source[index + 3];
      if (
        !suffix.startsWith("?") ||
        (suffix === "?<" &&
          lookbehindMarker !== "=" &&
          lookbehindMarker !== "!")
      ) {
        count += 1;
      }
    }
  }
  return count;
};

const validatePatterns = (
  input: NormalizedSmsTemplateInput,
): { errors: string[]; broadPatternCount: number; patternCount: number } => {
  const errors: string[] = [];
  let broadPatternCount = 0;
  let patternCount = 0;
  const extractionFields = new Set<PatternField>([
    "referencePattern",
    "amountPattern",
    "recipientNamePattern",
    "recipientPhonePattern",
    "costPattern",
  ]);

  for (const field of SMS_TEMPLATE_PATTERN_FIELDS) {
    const pattern = input[field];
    if (!pattern) {
      continue;
    }
    patternCount += 1;
    try {
      new RegExp(pattern, "i");
    } catch {
      errors.push(`${field}_invalid_regex`);
      continue;
    }
    if (pattern.length <= 3 || pattern === ".*" || pattern === ".+") {
      broadPatternCount += 1;
    }
    const captures = captureGroupCount(pattern);
    if (extractionFields.has(field) && captures < 1) {
      errors.push(`${field}_capture_required`);
    }
    if (field === "dateTimePattern" && captures < 6) {
      errors.push("dateTimePattern_six_captures_required");
    }
  }
  return { errors, broadPatternCount, patternCount };
};

const getTemplate = (
  db: Database.Database,
  id: number,
): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM smsImportTemplates WHERE id = @id").get({ id }) as
    | Record<string, unknown>
    | undefined;

const countDuplicates = (
  db: Database.Database,
  input: NormalizedSmsTemplateInput,
): SmsTemplateDryRunResponse["duplicateSummary"] => {
  if (!input.name) {
    return { duplicateNameCandidates: 0, duplicatePatternSignatureCandidates: 0 };
  }
  const excludedId = input.id ?? null;
  const duplicateName = db
    .prepare(
      `SELECT COUNT(*) AS count FROM smsImportTemplates
       WHERE LOWER(TRIM(name)) = LOWER(@name)
         AND (@excludedId IS NULL OR id <> @excludedId)`,
    )
    .get({ name: input.name, excludedId }) as { count: number };
  const patternClauses = SMS_TEMPLATE_PATTERN_FIELDS.map(
    (field) => `COALESCE(${field}, '') = COALESCE(@${field}, '')`,
  ).join(" AND ");
  const duplicatePatterns = db
    .prepare(
      `SELECT COUNT(*) AS count FROM smsImportTemplates
       WHERE ${patternClauses}
         AND (@excludedId IS NULL OR id <> @excludedId)`,
    )
    .get({ ...input, excludedId }) as { count: number };
  return {
    duplicateNameCandidates: duplicateName.count,
    duplicatePatternSignatureCandidates: duplicatePatterns.count,
  };
};

const parserSignificantChangeCount = (
  previous: Record<string, unknown> | undefined,
  input: NormalizedSmsTemplateInput,
): number => {
  if (!previous) {
    return 0;
  }
  return ["accountId", ...SMS_TEMPLATE_PATTERN_FIELDS].filter(
    (field) => (previous[field] ?? null) !== (input[field as keyof typeof input] ?? null),
  ).length;
};

export const smsTemplateDryRun = (
  db: Database.Database,
  payload: unknown,
  action: SmsTemplateAction,
): SmsTemplateDryRunResponse => {
  const input = normalizeSmsTemplatePayload(payload, action);
  const targetId = input.id ?? null;
  const previous = targetId ? getTemplate(db, targetId) : undefined;
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  const patternValidation = validatePatterns(input);
  validationErrors.push(...patternValidation.errors);

  if (targetId && !previous) {
    validationErrors.push("sms_template_not_found");
  }

  let accountExists: boolean | null = null;
  if (input.accountId) {
    accountExists = Boolean(
      db.prepare("SELECT 1 FROM accounts WHERE id = @id").get({ id: input.accountId }),
    );
    if (!accountExists) {
      validationErrors.push("account_not_found");
    }
  }

  const duplicates =
    action === "create" || action === "update"
      ? countDuplicates(db, input)
      : { duplicateNameCandidates: 0, duplicatePatternSignatureCandidates: 0 };
  if (duplicates.duplicateNameCandidates > 0) {
    warnings.push("duplicate_template_name_candidates");
  }
  if (duplicates.duplicatePatternSignatureCandidates > 0) {
    warnings.push("duplicate_pattern_signature_candidates");
  }
  if (patternValidation.broadPatternCount > 0) {
    warnings.push("broad_patterns_may_match_unexpectedly");
  }

  const expectedActive =
    action === "activate" ? true : action === "deactivate" ? false : null;
  const currentActive = previous ? Number(previous.isActive) === 1 : null;
  if (expectedActive !== null) {
    warnings.push(
      currentActive === expectedActive
        ? "active_state_already_matches"
        : "active_state_would_change",
    );
  }
  if (action === "delete") {
    warnings.push("template_would_be_deleted_without_cascade");
  }
  const parserChanges =
    action === "update" ? parserSignificantChangeCount(previous, input) : 0;
  if (parserChanges > 0) {
    warnings.push("parser_significant_fields_would_change");
  }

  const isActive =
    action === "create"
      ? true
      : action === "activate"
        ? true
        : action === "deactivate"
          ? false
          : currentActive;

  return {
    ok: validationErrors.length === 0,
    mode: "prototype",
    entity: "smsImportTemplate",
    action,
    dryRun: true,
    wouldMutate: false,
    targetIdPresent: targetId !== null,
    targetId,
    patternSyntaxValid: patternValidation.errors.length === 0,
    referenceSummary: {
      accountIdProvided: Boolean(input.accountId),
      accountExists,
    },
    duplicateSummary: duplicates,
    matchingRiskSummary: {
      broadPatternCount: patternValidation.broadPatternCount,
      parserSignificantFieldsWouldChange: parserChanges,
    },
    normalizedFieldPresence: {
      hasName: Boolean(input.name),
      hasDescription: Boolean(input.description),
      hasAccountId: Boolean(input.accountId),
      patternCount: patternValidation.patternCount,
      isActive,
    },
    timestampBehavior: {
      createdAtWouldChange: action === "create",
      updatedAtWouldChange: action !== "delete",
      createdAtPreserved: action !== "create",
    },
    validationErrors,
    warnings,
    safety: {
      sqliteMutated: false,
      dexieMutated: false,
      filesWritten: false,
      transactionsMutated: false,
      accountsMutated: false,
      recipientsMutated: false,
      parserExecuted: false,
      rawRowsIncluded: false,
    },
    resultCodes: [
      validationErrors.length ? "dry_run_has_validation_errors" : "dry_run_valid",
      ...(warnings.length ? ["dry_run_has_warnings"] : []),
      "no_mutation_performed",
    ],
    ...(validationErrors[0] ? { code: validationErrors[0] } : {}),
  };
};

export const smsTemplateDryRunRequestErrorResponse = (
  action: SmsTemplateAction,
  code: string,
): SmsTemplateDryRunResponse => ({
  ok: false,
  mode: "prototype",
  entity: "smsImportTemplate",
  action,
  dryRun: true,
  wouldMutate: false,
  targetIdPresent: false,
  targetId: null,
  patternSyntaxValid: false,
  referenceSummary: { accountIdProvided: false, accountExists: null },
  duplicateSummary: {
    duplicateNameCandidates: 0,
    duplicatePatternSignatureCandidates: 0,
  },
  matchingRiskSummary: {
    broadPatternCount: 0,
    parserSignificantFieldsWouldChange: 0,
  },
  normalizedFieldPresence: {
    hasName: false,
    hasDescription: false,
    hasAccountId: false,
    patternCount: 0,
    isActive: null,
  },
  timestampBehavior: {
    createdAtWouldChange: action === "create",
    updatedAtWouldChange: action !== "delete",
    createdAtPreserved: action !== "create",
  },
  validationErrors: [code],
  warnings: [],
  safety: {
    sqliteMutated: false,
    dexieMutated: false,
    filesWritten: false,
    transactionsMutated: false,
    accountsMutated: false,
    recipientsMutated: false,
    parserExecuted: false,
    rawRowsIncluded: false,
  },
  resultCodes: ["dry_run_has_validation_errors", "no_mutation_performed"],
  code,
});

import Database from "better-sqlite3";
import {
  normalizeSmsTemplatePayload,
  SMS_TEMPLATE_PATTERN_FIELDS,
  smsTemplateDryRun,
  type SmsTemplateAction,
  type SmsTemplateDryRunResponse,
} from "./smsTemplateDryRun.js";

export const SMS_TEMPLATE_WRITE_CONFIRMATIONS = {
  create: "create sms import template in disposable sqlite",
  update: "update sms import template in disposable sqlite",
  activate: "activate sms import template in disposable sqlite",
  deactivate: "deactivate sms import template in disposable sqlite",
  delete: "delete sms import template from disposable sqlite",
} as const;

const CONTROL_FIELDS = new Set(["dryRunReviewed", "confirmation"]);
const DATA_FIELDS = new Set([
  "id",
  "name",
  "description",
  "accountId",
  ...SMS_TEMPLATE_PATTERN_FIELDS,
]);
const RELATED_TABLES = [
  "transactions",
  "budgets",
  "budgetSnapshots",
  "buckets",
  "categories",
  "accounts",
  "paymentMethods",
  "recipients",
] as const;

export interface SmsTemplateWriteResponse
  extends Omit<
    SmsTemplateDryRunResponse,
    "dryRun" | "wouldMutate" | "safety"
  > {
  dryRunRequired: true;
  realWrite: true;
  sqliteMutated: boolean;
  rowsChanged: number;
  safety: {
    sqliteMutated: boolean;
    dexieMutated: false;
    filesWritten: false;
    transactionsMutated: false;
    accountsMutated: false;
    recipientsMutated: false;
    parserExecuted: false;
    rawRowsIncluded: false;
  };
}

export class SmsTemplateWriteRequestError extends Error {
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

export const validateSmsTemplateWritePayload = (
  payload: unknown,
  action: SmsTemplateAction,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new SmsTemplateWriteRequestError("payload_must_be_object");
  }
  for (const field of Object.keys(payload)) {
    if (!DATA_FIELDS.has(field) && !CONTROL_FIELDS.has(field)) {
      throw new SmsTemplateWriteRequestError("unexpected_payload_field");
    }
  }
  const data = Object.fromEntries(
    Object.entries(payload).filter(([field]) => DATA_FIELDS.has(field)),
  );
  try {
    normalizeSmsTemplatePayload(data, action);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new SmsTemplateWriteRequestError(String(error.code));
    }
    throw error;
  }
  if (payload.dryRunReviewed !== true) {
    throw new SmsTemplateWriteRequestError("dry_run_reviewed_required");
  }
  if (payload.confirmation !== SMS_TEMPLATE_WRITE_CONFIRMATIONS[action]) {
    throw new SmsTemplateWriteRequestError("matching_dry_run_required");
  }
  return data;
};

const rows = (
  db: Database.Database,
  table: "smsImportTemplates" | (typeof RELATED_TABLES)[number],
): Record<string, unknown>[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as Record<
    string,
    unknown
  >[];

const serialize = (value: unknown): string => JSON.stringify(value);

const relatedFingerprints = (db: Database.Database): Record<string, string> =>
  Object.fromEntries(
    RELATED_TABLES.map((table) => [table, serialize(rows(db, table))]),
  );

const assertRelatedUnchanged = (
  db: Database.Database,
  before: Record<string, string>,
): void => {
  for (const table of RELATED_TABLES) {
    if (serialize(rows(db, table)) !== before[table]) {
      throw new Error("sms_template_related_table_boundary_failed");
    }
  }
};

const nextTimestamp = (previous?: unknown): string => {
  const now = new Date();
  const previousTime = typeof previous === "string" ? Date.parse(previous) : NaN;
  return Number.isFinite(previousTime) && now.getTime() <= previousTime
    ? new Date(previousTime + 1).toISOString()
    : now.toISOString();
};

const response = (
  dryRun: SmsTemplateDryRunResponse,
  input: {
    targetId: number | null;
    rowsChanged: number;
    sqliteMutated: boolean;
    resultCodes: string[];
    validationErrors?: string[];
    code?: string;
  },
): SmsTemplateWriteResponse => ({
  ...dryRun,
  ok:
    (input.validationErrors ?? []).length === 0 &&
    (input.resultCodes.includes("sqlite_mutated") ||
      input.resultCodes.includes("active_state_already_matches")),
  targetIdPresent: input.targetId !== null,
  targetId: input.targetId,
  validationErrors: input.validationErrors ?? [],
  resultCodes: input.resultCodes,
  ...(input.code ? { code: input.code } : {}),
  dryRunRequired: true,
  realWrite: true,
  sqliteMutated: input.sqliteMutated,
  rowsChanged: input.rowsChanged,
  safety: {
    sqliteMutated: input.sqliteMutated,
    dexieMutated: false,
    filesWritten: false,
    transactionsMutated: false,
    accountsMutated: false,
    recipientsMutated: false,
    parserExecuted: false,
    rawRowsIncluded: false,
  },
});

const errorResponse = (
  action: SmsTemplateAction,
  code: string,
): SmsTemplateWriteResponse => {
  const dryRun = {
    ...smsTemplateDryRunRequestShape(action),
    validationErrors: [code],
    code,
  };
  return response(dryRun, {
    targetId: null,
    rowsChanged: 0,
    sqliteMutated: false,
    validationErrors: [code],
    resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
    code,
  });
};

const smsTemplateDryRunRequestShape = (
  action: SmsTemplateAction,
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
  validationErrors: [],
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
  resultCodes: [],
});

export const smsTemplateWriteDisabledResponse = (
  action: SmsTemplateAction,
): SmsTemplateWriteResponse =>
  errorResponse(action, "sms_template_writes_disabled");

export const smsTemplateWriteRequestErrorResponse = errorResponse;

export const smsTemplateRealWrite = (
  db: Database.Database,
  payload: unknown,
  action: SmsTemplateAction,
): SmsTemplateWriteResponse => {
  const data = validateSmsTemplateWritePayload(payload, action);
  const dryRun = smsTemplateDryRun(db, data, action);
  if (!dryRun.ok) {
    return response(dryRun, {
      targetId: dryRun.targetId,
      rowsChanged: 0,
      sqliteMutated: false,
      validationErrors: dryRun.validationErrors,
      resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
      code: dryRun.code,
    });
  }

  const input = normalizeSmsTemplatePayload(data, action);
  const before = rows(db, "smsImportTemplates");
  const relatedBefore = relatedFingerprints(db);
  const targetId = input.id ?? null;
  const previous = targetId
    ? before.find((row) => Number(row.id) === targetId)
    : undefined;

  const transaction = db.transaction((): SmsTemplateWriteResponse => {
    if (action === "create") {
      const timestamp = nextTimestamp();
      const result = db
        .prepare(
          `INSERT INTO smsImportTemplates (
            name, description, paymentMethodId, accountId, referencePattern,
            amountPattern, recipientNamePattern, recipientPhonePattern,
            dateTimePattern, costPattern, incomePattern, expensePattern,
            isActive, createdAt, updatedAt
          ) VALUES (
            @name, @description, NULL, @accountId, @referencePattern,
            @amountPattern, @recipientNamePattern, @recipientPhonePattern,
            @dateTimePattern, @costPattern, @incomePattern, @expensePattern,
            1, @createdAt, @updatedAt
          )`,
        )
        .run({ ...input, createdAt: timestamp, updatedAt: timestamp });
      const createdId = Number(result.lastInsertRowid);
      const after = rows(db, "smsImportTemplates");
      if (
        result.changes !== 1 ||
        after.length !== before.length + 1 ||
        serialize(after.filter((row) => Number(row.id) !== createdId)) !== serialize(before)
      ) {
        throw new Error("sms_template_create_invariant_failed");
      }
      assertRelatedUnchanged(db, relatedBefore);
      return response(dryRun, {
        targetId: createdId,
        rowsChanged: 1,
        sqliteMutated: true,
        resultCodes: ["sms_template_created", "sqlite_mutated"],
      });
    }

    if (!targetId || !previous) {
      return response(dryRun, {
        targetId,
        rowsChanged: 0,
        sqliteMutated: false,
        validationErrors: ["sms_template_not_found"],
        resultCodes: ["write_has_validation_errors", "no_mutation_performed"],
        code: "sms_template_not_found",
      });
    }

    if (action === "update") {
      const result = db
        .prepare(
          `UPDATE smsImportTemplates SET
            name = @name, description = @description, accountId = @accountId,
            referencePattern = @referencePattern, amountPattern = @amountPattern,
            recipientNamePattern = @recipientNamePattern,
            recipientPhonePattern = @recipientPhonePattern,
            dateTimePattern = @dateTimePattern, costPattern = @costPattern,
            incomePattern = @incomePattern, expensePattern = @expensePattern,
            updatedAt = @updatedAt
           WHERE id = @id`,
        )
        .run({ ...input, updatedAt: nextTimestamp(previous.updatedAt) });
      const after = rows(db, "smsImportTemplates");
      const next = after.find((row) => Number(row.id) === targetId);
      for (const field of ["id", "paymentMethodId", "isActive", "createdAt"]) {
        if (serialize(previous[field]) !== serialize(next?.[field])) {
          throw new Error(`sms_template_update_changed_preserved_${field}`);
        }
      }
      if (
        result.changes !== 1 ||
        after.length !== before.length ||
        serialize(after.filter((row) => Number(row.id) !== targetId)) !==
          serialize(before.filter((row) => Number(row.id) !== targetId))
      ) {
        throw new Error("sms_template_update_invariant_failed");
      }
      assertRelatedUnchanged(db, relatedBefore);
      return response(dryRun, {
        targetId,
        rowsChanged: 1,
        sqliteMutated: true,
        resultCodes: ["sms_template_updated", "sqlite_mutated"],
      });
    }

    if (action === "delete") {
      const result = db
        .prepare("DELETE FROM smsImportTemplates WHERE id = @id")
        .run({ id: targetId });
      const after = rows(db, "smsImportTemplates");
      if (
        result.changes !== 1 ||
        after.length !== before.length - 1 ||
        serialize(after) !==
          serialize(before.filter((row) => Number(row.id) !== targetId))
      ) {
        throw new Error("sms_template_delete_invariant_failed");
      }
      assertRelatedUnchanged(db, relatedBefore);
      return response(dryRun, {
        targetId,
        rowsChanged: 1,
        sqliteMutated: true,
        resultCodes: ["sms_template_deleted", "sqlite_mutated"],
      });
    }

    const desiredActive = action === "activate";
    if ((Number(previous.isActive) === 1) === desiredActive) {
      return response(dryRun, {
        targetId,
        rowsChanged: 0,
        sqliteMutated: false,
        resultCodes: ["active_state_already_matches", "no_mutation_performed"],
      });
    }
    const result = db
      .prepare(
        `UPDATE smsImportTemplates
         SET isActive = @isActive, updatedAt = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: targetId,
        isActive: desiredActive ? 1 : 0,
        updatedAt: nextTimestamp(previous.updatedAt),
      });
    const after = rows(db, "smsImportTemplates");
    const next = after.find((row) => Number(row.id) === targetId);
    for (const field of Object.keys(previous).filter(
      (field) => field !== "isActive" && field !== "updatedAt",
    )) {
      if (serialize(previous[field]) !== serialize(next?.[field])) {
        throw new Error(`sms_template_active_state_changed_${field}`);
      }
    }
    if (result.changes !== 1 || after.length !== before.length) {
      throw new Error("sms_template_active_state_invariant_failed");
    }
    assertRelatedUnchanged(db, relatedBefore);
    return response(dryRun, {
      targetId,
      rowsChanged: 1,
      sqliteMutated: true,
      resultCodes: [
        desiredActive ? "sms_template_activated" : "sms_template_deactivated",
        "sqlite_mutated",
      ],
    });
  });

  return transaction();
};

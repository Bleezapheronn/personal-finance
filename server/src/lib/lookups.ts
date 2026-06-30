import Database from "better-sqlite3";

export type LookupResource = "accounts" | "buckets" | "categories" | "recipients";
export type LookupDetailKey = "account" | "bucket" | "category" | "recipient";

export interface LookupFilters {
  activeOnly?: boolean;
  bucketId?: number;
}

export interface LookupListOptions {
  resource: LookupResource;
  limit: number;
  offset: number;
  filters: LookupFilters;
}

export interface LookupListResult {
  resource: LookupResource;
  limit: number;
  offset: number;
  count: number;
  rows: Record<string, unknown>[];
}

export interface LookupResourceConfig {
  detailKey: LookupDetailKey;
  tableName: LookupResource;
  selectSql: string;
  orderBySql: string;
  supportsActiveOnly: boolean;
  supportsBucketId: boolean;
}

const LOOKUP_CONFIGS: Record<LookupResource, LookupResourceConfig> = {
  accounts: {
    detailKey: "account",
    tableName: "accounts",
    selectSql: `SELECT id, name, description, currency, imageMimeType, isActive,
      isCredit, creditLimit, createdAt, updatedAt FROM accounts`,
    orderBySql: "ORDER BY name ASC, id ASC",
    supportsActiveOnly: true,
    supportsBucketId: false,
  },
  buckets: {
    detailKey: "bucket",
    tableName: "buckets",
    selectSql: `SELECT id, name, description, minPercentage, maxPercentage,
      minFixedAmount, isActive, displayOrder, excludeFromReports, createdAt,
      updatedAt FROM buckets`,
    orderBySql: "ORDER BY displayOrder ASC, id ASC",
    supportsActiveOnly: true,
    supportsBucketId: false,
  },
  categories: {
    detailKey: "category",
    tableName: "categories",
    selectSql: `SELECT id, name, bucketId, description, isActive, createdAt,
      updatedAt FROM categories`,
    orderBySql: "ORDER BY name ASC, id ASC",
    supportsActiveOnly: true,
    supportsBucketId: true,
  },
  recipients: {
    detailKey: "recipient",
    tableName: "recipients",
    selectSql: `SELECT id, name, aliases, email, phone, tillNumber, paybill,
      accountNumber, description, isActive, createdAt, updatedAt FROM recipients`,
    orderBySql: "ORDER BY name ASC, id ASC",
    supportsActiveOnly: true,
    supportsBucketId: false,
  },
};

export const lookupResources = Object.keys(LOOKUP_CONFIGS) as LookupResource[];

export const isLookupResource = (resource: string): resource is LookupResource =>
  Object.hasOwn(LOOKUP_CONFIGS, resource);

export const getLookupConfig = (resource: LookupResource): LookupResourceConfig =>
  LOOKUP_CONFIGS[resource];

const buildWhere = (
  config: LookupResourceConfig,
  filters: LookupFilters,
): { whereSql: string; params: Record<string, number> } => {
  const clauses: string[] = [];
  const params: Record<string, number> = {};

  if (filters.activeOnly === true && config.supportsActiveOnly) {
    clauses.push("isActive = 1");
  }

  if (filters.bucketId !== undefined && config.supportsBucketId) {
    clauses.push("bucketId = @bucketId");
    params.bucketId = filters.bucketId;
  }

  return {
    whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};

export const listLookupRows = (
  db: Database.Database,
  options: LookupListOptions,
): LookupListResult => {
  const config = getLookupConfig(options.resource);
  const { whereSql, params } = buildWhere(config, options.filters);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM ${config.tableName}${whereSql}`)
    .get(params) as { count: number } | undefined;

  if (!countRow || typeof countRow.count !== "number") {
    throw new Error(`Could not read ${options.resource} count.`);
  }

  const rows = db
    .prepare(
      `${config.selectSql}${whereSql} ${config.orderBySql} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: options.limit, offset: options.offset }) as Record<
    string,
    unknown
  >[];

  return {
    resource: options.resource,
    limit: options.limit,
    offset: options.offset,
    count: countRow.count,
    rows,
  };
};

export const getLookupRowById = (
  db: Database.Database,
  resource: LookupResource,
  id: number,
): Record<string, unknown> | undefined => {
  const config = getLookupConfig(resource);
  return db.prepare(`${config.selectSql} WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;
};

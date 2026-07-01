import {
  localApiGet,
  type LocalApiQueryParams,
} from "../../api/localApiClient";
import {
  AccountDto,
  ApiListResponse,
  BucketDto,
  CategoryDto,
  RecipientDto,
} from "./types";

export interface LookupListOptions {
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
}

export interface CategoryListOptions extends LookupListOptions {
  bucketId?: number;
}

type LookupResource = "accounts" | "buckets" | "categories" | "recipients";

const listLookupRows = async <Row>(
  resource: LookupResource,
  options: LookupListOptions | CategoryListOptions = {},
): Promise<ApiListResponse<Row>> => {
  return localApiGet<ApiListResponse<Row>>(
    `/prototype/repositories/${resource}`,
    { query: options as LocalApiQueryParams },
  );
};

const getLookupRowById = async <Row>(
  resource: LookupResource,
  detailKey: string,
  id: number,
): Promise<Row | undefined> => {
  try {
    const response = await localApiGet<Record<string, unknown>>(
      `/prototype/repositories/${resource}/${id}`,
    );
    return response[detailKey] as Row;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      return undefined;
    }
    throw error;
  }
};

export const listAccounts = async (
  options: LookupListOptions = {},
): Promise<ApiListResponse<AccountDto>> => {
  return listLookupRows<AccountDto>("accounts", options);
};

export const getAccountById = async (
  id: number,
): Promise<AccountDto | undefined> => {
  return getLookupRowById<AccountDto>("accounts", "account", id);
};

export const listBuckets = async (
  options: LookupListOptions = {},
): Promise<ApiListResponse<BucketDto>> => {
  return listLookupRows<BucketDto>("buckets", options);
};

export const getBucketById = async (
  id: number,
): Promise<BucketDto | undefined> => {
  return getLookupRowById<BucketDto>("buckets", "bucket", id);
};

export const listCategories = async (
  options: CategoryListOptions = {},
): Promise<ApiListResponse<CategoryDto>> => {
  return listLookupRows<CategoryDto>("categories", options);
};

export const getCategoryById = async (
  id: number,
): Promise<CategoryDto | undefined> => {
  return getLookupRowById<CategoryDto>("categories", "category", id);
};

export const listRecipients = async (
  options: LookupListOptions = {},
): Promise<ApiListResponse<RecipientDto>> => {
  return listLookupRows<RecipientDto>("recipients", options);
};

export const getRecipientById = async (
  id: number,
): Promise<RecipientDto | undefined> => {
  return getLookupRowById<RecipientDto>("recipients", "recipient", id);
};

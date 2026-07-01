const TOKEN_HEADER_NAME = "x-personal-finance-token";

export interface LocalApiClientConfig {
  baseUrl: string;
  token: string;
}

export type LocalApiQueryParams = Record<
  string,
  string | number | boolean | undefined
>;

export interface LocalApiRequestOptions {
  query?: LocalApiQueryParams;
}

export class LocalApiError extends Error {
  status?: number;
  code: string;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "LocalApiError";
    this.code = code;
    this.status = status;
  }
}

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const getLocalApiClientConfig = (): LocalApiClientConfig => {
  const baseUrl = getEnvValue("VITE_PERSONAL_FINANCE_LOCAL_API_URL");
  const token = getEnvValue("VITE_PERSONAL_FINANCE_LOCAL_API_TOKEN");

  if (!baseUrl) {
    throw new LocalApiError(
      "local_api_base_url_missing",
      "Local API base URL is not configured.",
    );
  }

  if (!token) {
    throw new LocalApiError(
      "local_api_token_missing",
      "Local API token is not configured.",
    );
  }

  return { baseUrl, token };
};

const buildUrl = (
  baseUrl: string,
  pathname: string,
  query: LocalApiRequestOptions["query"],
): string => {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(pathname.replace(/^\//, ""), base);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
};

const responseCode = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      error?: unknown;
    };
    if (typeof body.code === "string") {
      return body.code;
    }
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Keep errors token-safe and row-free if the body is not JSON.
  }

  return "local_api_request_failed";
};

export const localApiGet = async <ResponseBody>(
  pathname: string,
  options: LocalApiRequestOptions = {},
): Promise<ResponseBody> => {
  const config = getLocalApiClientConfig();
  const response = await fetch(buildUrl(config.baseUrl, pathname, options.query), {
    headers: {
      [TOKEN_HEADER_NAME]: config.token,
    },
  });

  if (!response.ok) {
    const code = await responseCode(response);
    throw new LocalApiError(code, "Local API request failed.", response.status);
  }

  return (await response.json()) as ResponseBody;
};

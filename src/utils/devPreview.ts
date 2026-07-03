export const SELECTED_READ_PREVIEWS_FLAG =
  "VITE_PERSONAL_FINANCE_SHOW_SELECTED_READ_PREVIEWS";

export type DevPreviewListResult =
  | Array<{ id?: unknown }>
  | {
      count?: unknown;
      rows?: unknown;
    };

export const envFlagEnabled = (key: string): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[key]?.trim() === "true";
};

export const isSelectedReadPreviewsEnabled = (): boolean =>
  envFlagEnabled(SELECTED_READ_PREVIEWS_FLAG);

export const previewRows = (
  result: DevPreviewListResult,
): Array<{ id?: unknown }> | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  return Array.isArray(result.rows)
    ? (result.rows as Array<{ id?: unknown }>)
    : undefined;
};

export const previewCount = (
  result: DevPreviewListResult,
): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

export const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const booleanValue = (value: unknown): boolean | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

export const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

export const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
};

export const sampledIds = (
  rows: Array<{ id?: unknown }>,
  limit: number,
): number[] =>
  rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, limit);

export const safePreviewErrorCode = (
  error: unknown,
  fallbackCode = "selected_read_preview_failed",
): string => {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  return fallbackCode;
};

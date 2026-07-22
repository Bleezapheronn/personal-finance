import { pathToFileURL } from "node:url";

export const isDirectRun = (moduleUrl: string): boolean =>
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === moduleUrl;

export const safeCliErrorMessage = (
  error: unknown,
  fallbackCode: string,
): string => {
  if (!(error instanceof Error)) return fallbackCode;
  return /(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(error.message)
    ? fallbackCode
    : error.message;
};

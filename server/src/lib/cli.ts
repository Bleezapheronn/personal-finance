import { pathToFileURL } from "node:url";

export const isDirectRun = (moduleUrl: string): boolean =>
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === moduleUrl;

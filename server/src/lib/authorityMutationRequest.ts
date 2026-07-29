/** True only for the dedicated production mutation path segment. */
export const isAuthoritativeMutationPath = (url: string): boolean =>
  /(?:^|\/)write(?:\/|$)/.test(url.split("?", 1)[0]);

import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const protectedPaths = [
  "C:\\dev\\personal-finance",
  "C:\\dev\\personal-finance-data",
  "C:\\dev\\personal-finance-data\\activation-20260723-160032\\profiles\\authoritative-profile.json",
];
const isWindows = process.platform === "win32";
const normalize = (value: string) => isWindows ? value.toLowerCase() : value;
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const canonical = (value: string) => normalize(realpathSync.native(value));
export interface DisposableIdentityPolicy { tempRoot: string; protectedRoots: string[]; }
export const disposableIdentityPolicy = (): DisposableIdentityPolicy => ({
  tempRoot: canonical(os.tmpdir()),
  protectedRoots: protectedPaths.filter(existsSync).map(canonical),
});
const invalidSyntax = (value: string) => !value || !path.isAbsolute(value) || /^\\\\(?:[?.]|[^\\])/.test(value);
const reject = (code: string) => { throw new Error(code); };

/** Test-support only. Existing ancestors are inspected component by component. */
export const requireDisposablePath = (candidate: string, code = "disposable_path_validation_failed", policy = disposableIdentityPolicy()): string => {
  if (invalidSyntax(candidate)) reject("disposable_path_device_or_unc");
  const resolved = path.resolve(candidate);
  const lexicalTemp = path.resolve(os.tmpdir());
  if (resolved === lexicalTemp || !inside(lexicalTemp, resolved)) reject("disposable_path_outside_temp");
  let ancestor = resolved;
  while (!existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) reject(code); ancestor = parent; }
  const ancestorIdentity = canonical(ancestor);
  if (!inside(policy.tempRoot, ancestorIdentity)) reject("disposable_path_outside_temp");
  for (const protectedRoot of policy.protectedRoots) if (inside(protectedRoot, ancestorIdentity)) reject("disposable_path_protected_identity");
  let cursor = lexicalTemp;
  for (const part of path.relative(lexicalTemp, ancestor).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && cursor !== ancestor)) reject("disposable_path_reparse_component");
    if (!inside(policy.tempRoot, canonical(cursor))) reject("disposable_path_reparse_component");
  }
  return resolved;
};

export const validateCreateAndRevalidateDisposableDirectory = (candidate: string, policy = disposableIdentityPolicy(), hooks?: { beforeCreate?: () => void; afterCreate?: () => void }): string => {
  const resolved = requireDisposablePath(candidate, "disposable_path_validation_failed", policy);
  hooks?.beforeCreate?.();
  mkdirSync(resolved, { recursive: false });
  hooks?.afterCreate?.();
  return requireDisposablePath(resolved, "disposable_path_identity_changed", policy);
};

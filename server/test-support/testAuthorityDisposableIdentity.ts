import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { disposableIdentityPolicy, requireDisposablePath, validateCreateAndRevalidateDisposableDirectory } from "./authorityDisposableIdentity.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-disposable-identity-"));
const policy = disposableIdentityPolicy();
let assertions = 0;
const check = (value: unknown, code: string) => { assertions += 1; if (!value) throw new Error(code); };
const rejected = (value: string) => { try { requireDisposablePath(value, "unexpected", policy); return false; } catch { return true; } };
const junction = (name: string, target: string) => { const link = path.join(root, name); symlinkSync(target, link, "junction"); return link; };
try {
  check(requireDisposablePath(path.join(root, "plain", "file"), "unexpected", policy).endsWith(path.join("plain", "file")), "plain_temp_rejected");
  check(rejected(process.cwd()), "repository_direct_accepted");
  check(rejected("relative/path"), "relative_accepted");
  check(rejected("\\\\?\\C:\\temp\\x") && rejected("\\\\server\\share\\x"), "ambiguous_path_accepted");
  const aliases = [path.join(root, ".", "plain", "..", "plain", "again"), path.join(root, "plain") + path.sep];
  check(aliases.every((entry) => !rejected(entry)), "temp_alias_rejected");
  check(rejected("C:\\dev\\personal-finance-data-copy\\x") || !existsSync("C:\\dev\\personal-finance-data-copy"), "prefix_collision_misclassified");
  for (const [name, target] of [["repo", "C:\\dev\\personal-finance"], ["data", "C:\\dev\\personal-finance-data"]] as const) {
    if (!existsSync(target)) continue;
    const link = junction(name, target);
    check(rejected(path.join(link, "profile", "x")), `${name}_junction_accepted`);
  }
  const first = junction("first", root);
  const second = path.join(first, "second");
  try { symlinkSync("C:\\dev\\personal-finance-data", second, "junction"); check(rejected(path.join(second, "x")), "nested_junction_accepted"); } catch { /* target may be unavailable */ }
  check(rejected(path.join(junction("parent", "C:\\dev\\personal-finance"), "future")), "parent_junction_accepted");
  const created = validateCreateAndRevalidateDisposableDirectory(path.join(root, "created"), policy);
  check(existsSync(created), "create_revalidate_failed");
  check(rejected(path.join(root, "created")) === false, "created_path_rejected");
  const raced = path.join(root, "raced");
  let raceRejected = false;
  try {
    validateCreateAndRevalidateDisposableDirectory(raced, policy, { afterCreate: () => {
      rmSync(raced, { recursive: true, force: true });
      symlinkSync("C:\\dev\\personal-finance", raced, "junction");
    } });
  } catch (error) { raceRejected = error instanceof Error && ["disposable_path_reparse_component", "disposable_path_outside_temp", "disposable_path_protected_identity"].includes(error.message); }
  check(raceRejected, "toctou_identity_change_not_rejected");
  console.log(`Authority disposable identity test: ${assertions} passed, 0 failed`);
} finally { rmSync(root, { recursive: true, force: true }); }

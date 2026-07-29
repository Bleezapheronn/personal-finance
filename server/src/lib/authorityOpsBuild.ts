import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.js";
import { writeJsonAtomic } from "./authorityOpsSession.js";

export interface BuildReceipt { version: 1; serverFingerprint: string; frontendFingerprint: string; nodeVersion: string; npmVersion: string; successfulAt: string; }
export interface AuthorityBuildTestOptions {
  fingerprints?: { server: string; frontend: string };
  nodeVersion?: string;
  npmVersion?: string;
  run?: (target: "server" | "root") => void;
  repositoryRoot?: string;
  testLinkEntries?: Record<string, string>;
  testAfterLinkResolved?: (logicalPath: string) => void;
}

const digest = (items: string[]) => createHash("sha256").update(items.join("\n")).digest("hex");
const fileDigest = (filePath: string): string => createHash("sha256").update(readFileSync(filePath)).digest("hex");
const normalized = (value: string) => value.replace(/\\/g, "/");
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const samePath = (left: string, right: string) => {
  const normalizePath = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalizePath(left) === normalizePath(right);
};
const identity = (value: string) => {
  const resolved = realpathSync.native(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * Vite resolves symlinks by default. Supported links in a frontend input tree
 * are therefore followed only to declared in-repository frontend roots, while
 * their logical path, lexical target, resolved identity and consumed content
 * remain part of the receipt. External, dangling, cyclic and unknown reparse
 * entries fail closed rather than disappearing from the fingerprint.
 */
const buildItems = (
  repositoryRoot: string,
  relativeRoot: string,
  allowedRoots: string[],
  testLinkEntries?: Record<string, string>,
  testAfterLinkResolved?: (logicalPath: string) => void,
): string[] => {
  const repositoryIdentity = identity(repositoryRoot);
  const allowedIdentities = allowedRoots
    .filter((entry) => existsSync(path.join(repositoryRoot, entry)))
    .map((entry) => identity(path.join(repositoryRoot, entry)));
  const root = path.join(repositoryRoot, relativeRoot);
  let rootStat;
  try { rootStat = lstatSync(root); } catch { return []; }
  const permitted = (target: string) => {
    const targetIdentity = identity(target);
    if (!inside(repositoryIdentity, targetIdentity)) {
      throw new Error("build_input_link_outside_root");
    }
    if (!allowedIdentities.some((allowed) => inside(allowed, targetIdentity))) {
      throw new Error("build_input_link_outside_root");
    }
    return targetIdentity;
  };
  const result: string[] = [];
  const visit = (physical: string, logical: string, ancestors: Set<string>): void => {
    let entry;
    try { entry = lstatSync(physical); } catch { throw new Error("build_input_identity_failed"); }
    const virtualLinkTarget = samePath(physical, path.join(repositoryRoot, logical)) ? testLinkEntries?.[logical] : undefined;
    if (entry.isSymbolicLink() || virtualLinkTarget !== undefined) {
      const isVirtualLink = virtualLinkTarget !== undefined;
      let linked: string;
      let targetIdentity: string;
      try {
        linked = virtualLinkTarget ?? readlinkSync(physical);
        targetIdentity = permitted(path.resolve(path.dirname(physical), linked));
        statSync(targetIdentity);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("build_input_")) throw error;
        throw new Error("build_input_link_dangling");
      }
      const lexicalTarget = normalized(path.relative(repositoryRoot, path.resolve(path.dirname(physical), linked)));
      const targetRelative = normalized(path.relative(repositoryIdentity, targetIdentity));
      result.push(`link:${logical}:symbolic-link:${lexicalTarget}:${targetRelative}`);
      testAfterLinkResolved?.(logical);
      const verifyUnchangedLink = () => {
        try {
          if (isVirtualLink) {
            const currentLink = samePath(physical, path.join(repositoryRoot, logical)) ? testLinkEntries?.[logical] : undefined;
            if (currentLink !== linked || permitted(path.resolve(path.dirname(physical), currentLink)) !== targetIdentity) throw new Error("build_input_identity_failed");
          } else if (identity(physical) !== targetIdentity) {
            throw new Error("build_input_identity_failed");
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("build_input_")) throw error;
          throw new Error("build_input_identity_failed");
        }
      };
      const target = statSync(targetIdentity);
      if (target.isFile()) {
        result.push(`file:${logical}:${fileDigest(targetIdentity)}`);
        verifyUnchangedLink();
        return;
      }
      if (!target.isDirectory()) throw new Error("build_input_reparse_unsupported");
      visit(targetIdentity, logical, ancestors);
      verifyUnchangedLink();
      return;
    }
    if (entry.isFile()) {
      result.push(`file:${logical}:${fileDigest(physical)}`);
      return;
    }
    if (!entry.isDirectory()) throw new Error("build_input_reparse_unsupported");
    const directoryIdentity = identity(physical);
    if (ancestors.has(directoryIdentity)) throw new Error("build_input_link_cycle");
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(directoryIdentity);
    for (const child of readdirSync(physical).sort(compare)) {
      visit(path.join(physical, child), normalized(path.posix.join(logical, child)), nextAncestors);
    }
  };
  if (rootStat.isSymbolicLink()) {
    visit(root, normalized(relativeRoot), new Set());
  } else if (rootStat.isFile()) {
    visit(root, normalized(relativeRoot), new Set());
  } else if (rootStat.isDirectory()) {
    visit(root, normalized(relativeRoot), new Set());
  } else {
    throw new Error("build_input_reparse_unsupported");
  }
  return result.sort(compare);
};

const frontendRoots = ["src", "shared", "public"];
const frontendFiles = [
  "index.html", ".browserslistrc", "package.json", "package-lock.json", "tsconfig.json",
  "tsconfig.node.json", "vite.config.ts", "capacitor.config.ts", "ionic.config.json",
];
const serverFiles = ["server/package.json", "server/package-lock.json", "server/tsconfig.json"];

export const currentAuthorityBuildReceipt = (
  repositoryRoot = repoRoot,
  testLinkEntries?: Record<string, string>,
  testAfterLinkResolved?: (logicalPath: string) => void,
): BuildReceipt => {
  const frontendAllowed = [...frontendRoots, ...frontendFiles];
  return {
    version: 1,
    serverFingerprint: digest([
      ...buildItems(repositoryRoot, "server/src", ["server/src"], testLinkEntries, testAfterLinkResolved),
      ...serverFiles.flatMap((entry) => buildItems(repositoryRoot, entry, serverFiles, testLinkEntries, testAfterLinkResolved)),
    ]),
    frontendFingerprint: digest([
      ...frontendRoots.flatMap((entry) => buildItems(repositoryRoot, entry, frontendRoots, testLinkEntries, testAfterLinkResolved)),
      ...frontendFiles.flatMap((entry) => buildItems(repositoryRoot, entry, frontendAllowed, testLinkEntries, testAfterLinkResolved)),
    ]),
    nodeVersion: process.version,
    npmVersion: npmVersion(repositoryRoot),
    successfulAt: new Date().toISOString(),
  };
};

const npmCliPath = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCommand = (args: string[]) => [process.execPath, [npmCliPath, ...args] as string[]] as const;
const npmVersion = (repositoryRoot: string) => { const [file, args] = npmCommand(["--version"]); return execFileSync(file, args, { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }).trim(); };
export const runConditionalAuthorityBuild = (receiptPath: string, options: AuthorityBuildTestOptions = {}): { serverBuilt: boolean; rootBuilt: boolean } => {
  const repositoryRoot = options.repositoryRoot ?? repoRoot;
  const baseline = currentAuthorityBuildReceipt(repositoryRoot, options.testLinkEntries, options.testAfterLinkResolved);
  const current = { ...baseline, serverFingerprint: options.fingerprints?.server ?? baseline.serverFingerprint, frontendFingerprint: options.fingerprints?.frontend ?? baseline.frontendFingerprint, nodeVersion: options.nodeVersion ?? baseline.nodeVersion, npmVersion: options.npmVersion ?? baseline.npmVersion, successfulAt: new Date().toISOString() };
  let previous: BuildReceipt | undefined;
  try { previous = JSON.parse(readFileSync(receiptPath, "utf8")) as BuildReceipt; } catch { /* first run */ }
  const serverBuilt = !previous || previous.serverFingerprint !== current.serverFingerprint || previous.nodeVersion !== current.nodeVersion || previous.npmVersion !== current.npmVersion;
  const rootBuilt = !previous || previous.frontendFingerprint !== current.frontendFingerprint || previous.nodeVersion !== current.nodeVersion || previous.npmVersion !== current.npmVersion;
  if (serverBuilt) { const [file, args] = npmCommand(["--prefix", "server", "run", "build"]); options.run ? options.run("server") : execFileSync(file, args, { cwd: repositoryRoot, stdio: "inherit", windowsHide: true }); }
  if (rootBuilt) { const [file, args] = npmCommand(["run", "build"]); options.run ? options.run("root") : execFileSync(file, args, { cwd: repositoryRoot, stdio: "inherit", windowsHide: true }); }
  if (serverBuilt || rootBuilt || !previous) writeJsonAtomic(receiptPath, current);
  return { serverBuilt, rootBuilt };
};

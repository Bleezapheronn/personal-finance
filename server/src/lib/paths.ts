import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverRoot = path.resolve(__dirname, "..", "..");
export const repoRoot = path.resolve(serverRoot, "..");

export const basename = (filePath: string): string => path.basename(filePath);

export const resolvePathIdentity = (filePath: string): string => {
  let existingAncestor = path.resolve(filePath);
  const missingParts: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingParts.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const resolved = path.join(
    existsSync(existingAncestor)
      ? realpathSync.native(existingAncestor)
      : existingAncestor,
    ...missingParts,
  );
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const pathsReferToSameLocation = (
  leftPath: string,
  rightPath: string,
): boolean => resolvePathIdentity(leftPath) === resolvePathIdentity(rightPath);

export const isInsidePath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const assertFileExists = (filePath: string, label: string): void => {
  if (!existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${basename(filePath)}`);
  }
};

export const assertPathDoesNotExist = (
  filePath: string,
  label: string,
): void => {
  if (existsSync(filePath)) {
    throw new Error(`${label} already exists: ${basename(filePath)}`);
  }
};

export const assertOutsideRepoUnlessAllowed = (
  outputPath: string | undefined,
  allowRepoOutputForTests: boolean,
  artifactLabel: string,
): void => {
  if (outputPath && isInsidePath(repoRoot, outputPath) && !allowRepoOutputForTests) {
    throw new Error(
      `Refusing to write ${artifactLabel} inside the repository. Use an outside path or --allow-repo-output-for-tests.`,
    );
  }
};

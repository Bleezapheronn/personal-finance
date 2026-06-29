import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverRoot = path.resolve(__dirname, "..", "..");
export const repoRoot = path.resolve(serverRoot, "..");

export const basename = (filePath: string): string => path.basename(filePath);

export const isInsidePath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const assertFileExists = (filePath: string, label: string): void => {
  if (!existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${basename(filePath)}`);
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

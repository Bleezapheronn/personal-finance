import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDataDir, getTokenFilePath, TOKEN_FILE_NAME } from "./config.js";

const generateTokenValue = (): string => randomBytes(32).toString("hex");

export const getTokenPath = (): string => {
  return getTokenFilePath() ?? join(getDataDir(), TOKEN_FILE_NAME);
};

export const readOrCreateToken = async (): Promise<string> => {
  const tokenPath = getTokenPath();

  try {
    return (await readFile(tokenPath, "utf8")).trim();
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const token = generateTokenValue();
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${token}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  return token;
};

export const rotateToken = async (): Promise<string> => {
  const tokenPath = getTokenPath();
  const token = generateTokenValue();

  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${token}\n`, {
    encoding: "utf8",
    flag: "w",
  });

  return token;
};

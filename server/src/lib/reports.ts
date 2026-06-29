import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const writeJsonReport = (outputPath: string, report: unknown): void => {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

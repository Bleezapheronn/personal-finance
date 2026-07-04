import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcRoot = resolve(repoRoot, "src");

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const approvedFiles = new Set(
  [
    "src/api/localApiClient.ts",
    "src/pages/AccountsManagement.tsx",
    "src/pages/BudgetHistory.tsx",
    "src/pages/BucketsManagement.tsx",
    "src/pages/LocalApiDiagnostics.tsx",
    "src/pages/RecipientsManagement.tsx",
    "src/pages/SmsImportTemplatesManagement.tsx",
    "src/pages/Transactions.tsx",
    "src/repositories/adapterSelection.ts",
    "src/repositories/accountsReadExperimentDiagnostics.ts",
    "src/repositories/backendSelectionDiagnostics.ts",
    "src/repositories/bucketsCategoriesReadExperimentDiagnostics.ts",
    "src/repositories/index.ts",
    "src/repositories/recipientsReadExperimentDiagnostics.ts",
    "src/repositories/selectedReadOrderingDiagnostics.ts",
    "src/repositories/selectedReadRepositories.ts",
    "src/repositories/selectedReadRepositoryDiagnostics.ts",
    "src/repositories/smsTemplatesReadExperimentDiagnostics.ts",
    "src/repositories/transactionsReadParityDiagnostics.ts",
  ].map((path) => path.replaceAll("/", sep)),
);

const approvedDirectoryPrefixes = [
  `src${sep}repositories${sep}http${sep}`,
];

const forbiddenMarkers = [
  "selectedReadRepositories",
  "getSelectedReadRepositories",
  "getSelectedReadRepositoriesForBackend",
  "/repositories/http/",
  "../repositories/http/",
  "../../repositories/http/",
  "./repositories/http/",
  "localApiClient",
  "VITE_PERSONAL_FINANCE_REPOSITORY_BACKEND",
];

const sourceFiles = [];

const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const absolutePath = resolve(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    const extension = entry.slice(entry.lastIndexOf("."));
    if (sourceExtensions.has(extension)) {
      sourceFiles.push(absolutePath);
    }
  }
};

const isApprovedFile = (relativePath) =>
  approvedFiles.has(relativePath) ||
  approvedDirectoryPrefixes.some((prefix) => relativePath.startsWith(prefix));

walk(srcRoot);

const unexpectedFiles = [];

for (const absolutePath of sourceFiles) {
  const relativePath = relative(repoRoot, absolutePath);
  const source = readFileSync(absolutePath, "utf8");
  const matchedMarkers = forbiddenMarkers.filter((marker) =>
    source.includes(marker),
  );

  if (matchedMarkers.length === 0 || isApprovedFile(relativePath)) {
    continue;
  }

  unexpectedFiles.push({
    path: relativePath.split(sep).join("/"),
    markers: matchedMarkers,
  });
}

if (unexpectedFiles.length > 0) {
  console.error("Selected-read import guard: FAIL");
  console.error(`Unexpected files: ${unexpectedFiles.length}`);
  for (const file of unexpectedFiles) {
    console.error(`  ${file.path} (${file.markers.join(", ")})`);
  }
  process.exitCode = 1;
} else {
  console.log("Selected-read import guard: PASS");
  console.log(`Scanned files: ${sourceFiles.length}`);
  console.log("Unexpected files: 0");
}

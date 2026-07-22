import { readFileSync } from "node:fs";
import { isDirectRun, safeCliErrorMessage } from "./lib/cli.js";
import {
  SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS,
  WRITE_CAPABILITY_KEYS,
} from "./lib/writeCapabilities.js";

interface Args {
  baseUrl: string;
  token?: string;
  tokenFile?: string;
  help: boolean;
}

export const verifySqliteAuthorityUsage = `Usage:
  npm run verify:sqlite-authority -- -- --token-file <path> [--base-url http://127.0.0.1:3147]

Options:
  --base-url <url>       Running local API URL.
  --token <token>        Local API token; --token-file is preferred.
  --token-file <path>    Outside-repository token file.
  --help                 Show this help text.
`;

export const parseVerifySqliteAuthorityArgs = (argv: string[]): Args => {
  const args: Args = { baseUrl: "http://127.0.0.1:3147", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (["--base-url", "--token", "--token-file"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--base-url") args.baseUrl = value;
      if (arg === "--token") args.token = value;
      if (arg === "--token-file") args.tokenFile = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseVerifySqliteAuthorityArgs(process.argv.slice(2));
  if (args.help) {
    console.log(verifySqliteAuthorityUsage);
    return;
  }
  if (args.token && args.tokenFile) throw new Error("token_source_ambiguous");
  const token = args.tokenFile
    ? readFileSync(args.tokenFile, "utf8").trim()
    : args.token?.trim();
  if (!token) {
    console.error(verifySqliteAuthorityUsage);
    throw new Error("token_required");
  }
  const baseUrl = new URL(args.baseUrl);
  const getJson = async (pathname: string, protectedRequest = true) => {
    let response: Response;
    try {
      response = await fetch(new URL(pathname, baseUrl), {
        headers: protectedRequest
          ? { "x-personal-finance-token": token }
          : undefined,
      });
    } catch {
      throw new Error("local_api_unavailable");
    }
    if (!response.ok) throw new Error(`request_failed_${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };

  const checks: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "health",
      run: async () => {
        const value = await getJson("/health", false);
        if (value.ok !== true || value.mode !== "prototype") throw new Error("health_invalid");
      },
    },
    {
      name: "metadata",
      run: async () => {
        const value = await getJson("/metadata");
        if (
          value.storageMode !== "sqlite-authoritative" ||
          value.authoritative !== true ||
          value.cutoverVerified !== true
        ) throw new Error("metadata_authority_invalid");
      },
    },
    {
      name: "authoritative readiness",
      run: async () => {
        const value = await getJson("/prototype/sqlite/authority-readiness");
        if (
          value.ready !== true ||
          value.cutoverVerified !== true ||
          value.backupVerified !== true ||
          value.rollbackAvailable !== true ||
          !Array.isArray(value.missingRequirements) ||
          value.missingRequirements.length !== 0
        ) throw new Error("authority_readiness_invalid");
      },
    },
    {
      name: "write capabilities",
      run: async () => {
        const value = await getJson("/prototype/write-capabilities");
        const capabilities = value.capabilities as Record<string, unknown> | undefined;
        const unsupportedOperations = value.unsupportedOperations;
        if (
          value.storageMode !== "sqlite-authoritative" ||
          value.authoritative !== true ||
          !capabilities ||
          WRITE_CAPABILITY_KEYS.some((key) => capabilities[key] !== true) ||
          Object.keys(capabilities).length !== WRITE_CAPABILITY_KEYS.length ||
          !Array.isArray(unsupportedOperations) ||
          SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS.some(
            (operation) => !unsupportedOperations.includes(operation),
          ) ||
          unsupportedOperations.length !==
            SQLITE_REHEARSAL_UNSUPPORTED_OPERATIONS.length
        ) throw new Error("authority_capabilities_invalid");
      },
    },
    {
      name: "row counts",
      run: async () => {
        const value = await getJson("/prototype/sqlite/row-counts");
        if (value.ok !== true || typeof value.tables !== "object" || value.tables === null) {
          throw new Error("row_counts_invalid");
        }
      },
    },
  ];

  let failed = 0;
  console.log("SQLite authority verification:");
  for (const check of checks) {
    try {
      await check.run();
      console.log(`  PASS ${check.name}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${check.name}`);
    }
  }
  console.log(`Checks: ${checks.length}`);
  console.log(`Passed: ${checks.length - failed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
};

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliErrorMessage(error, "sqlite_authority_verification_failed"));
    process.exitCode = 1;
  });
}

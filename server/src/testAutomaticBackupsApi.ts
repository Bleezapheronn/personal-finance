import Fastify from "fastify";
import Database from "better-sqlite3";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
  writeAuthorityOpsProfileAtomic,
  type AuthorityOpsProfile,
} from "./lib/authorityOpsProfile.js";
import { serverRoot } from "./lib/paths.js";
import { registerAutomaticBackupsRoutes } from "./lib/automaticBackups.js";
import { registerLocalApiAuthentication } from "./lib/localApiAuthentication.js";
import {
  backupConfigPathForProfile,
  initializeBackupSettings,
  inventoryScheduledBackups,
} from "./lib/scheduledSqliteBackup.js";

const TOKEN_HEADER = "x-personal-finance-token";
const AUTH_TOKEN = "test-token";

const checks: Array<{ name: string; ok: boolean }> = [];

const assert = (value: unknown): asserts value => {
  if (!value) throw new Error("assertion_failed");
};

const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch {
    checks.push({ name, ok: false });
  }
};

const makeDb = (file: string): void => {
  const db = new Database(file);
  try {
    db.exec(
      readFileSync(
        path.join(serverRoot, "schema", "prototype-schema.sql"),
        "utf8",
      ),
    );
  } finally {
    db.close();
  }
};

const main = async () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "pf-automatic-backups-api-test-"),
  );
  const oldEnv = { ...process.env };
  let app = Fastify();

  try {
    const runtime = path.join(root, "runtime");
    const checkpoint = path.join(root, "checkpoints");
    const configRoot = path.join(root, "data");
    const destination = path.join(root, "destination");
    const destination2 = path.join(root, "destination-2");
    const staging = path.join(root, "staging");
    const sqlite = path.join(runtime, "active.sqlite");
    const token = path.join(root, "token");
    const profilePath = path.join(root, "profiles", "authority-profile.json");

    mkdirSync(runtime, { recursive: true });
    mkdirSync(checkpoint, { recursive: true });
    mkdirSync(destination2, { recursive: true });
    writeFileSync(token, "test-token");
    makeDb(sqlite);

    const profile: AuthorityOpsProfile = {
      schemaVersion: AUTHORITY_OPS_PROFILE_SCHEMA_VERSION,
      mode: "rehearsal",
      activeDatabasePath: sqlite,
      authorityManifestPath: null,
      sourceBackupPath: null,
      tokenFilePath: token,
      backupDirectory: checkpoint,
      apiHost: "127.0.0.1",
      apiPort: 3160,
      viteHost: "localhost",
      vitePort: 5173,
      enabledWriteCapabilities: [],
    };

    writeAuthorityOpsProfileAtomic(profilePath, profile, {
      allowRepoPathsForTests: true,
    });
    process.env.PERSONAL_FINANCE_DATA_ROOT = configRoot;
    process.env.PERSONAL_FINANCE_TOKEN_FILE_PATH = token;
    process.env.PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH = profilePath;
    process.env.PF_BACKUP_TEST_SIMULATE_SCHEDULER = "true";
    process.env.PF_BACKUP_TEST_SKIP_EXPLORER = "true";

    initializeBackupSettings(profilePath, {
      destinationDirectory: destination,
      stagingDirectory: staging,
      taskName: "PF disposable backup api test",
    });

    app = Fastify();
    registerLocalApiAuthentication(app);
    registerAutomaticBackupsRoutes(app);

    const authed = (method: "GET" | "POST", url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as never }),
        headers: { [TOKEN_HEADER]: AUTH_TOKEN },
      });

    await check("unauthenticated requests rejected", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/prototype/settings/automatic-backups/state",
      });
      if (response.statusCode !== 401) throw new Error("assertion_failed");
    });

    await check("incorrect token rejected before handler", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/prototype/settings/automatic-backups/state",
        headers: { [TOKEN_HEADER]: "incorrect-token" },
      });
      if (response.statusCode !== 401) throw new Error("assertion_failed");
    });

    await check("unconfigured state is safe and read-only", async () => {
      const configPath = backupConfigPathForProfile(profilePath);
      rmSync(configPath, { force: true });
      const response = await authed("GET", "/prototype/settings/automatic-backups/state");
      if (response.statusCode !== 200) throw new Error("assertion_failed");
      const body = response.json() as { state: { configuration: { enabled: boolean; destinationDirectory: string }; scheduler: { installed: boolean } } };
      if (body.state.configuration.enabled || body.state.configuration.destinationDirectory !== "" || body.state.scheduler.installed) throw new Error("assertion_failed");
      if (existsSync(configPath)) throw new Error("assertion_failed");
      process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT = destination2;
      const selected = await authed("POST", "/prototype/settings/automatic-backups/browse-destination", {});
      if (selected.statusCode !== 200 || selected.json().selection.destinationDirectory !== destination2) throw new Error("assertion_failed");
      if (existsSync(configPath)) throw new Error("assertion_failed");
      process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT = "cancel";
      const cancelled = await authed("POST", "/prototype/settings/automatic-backups/browse-destination", {});
      if (cancelled.statusCode !== 200 || cancelled.json().selection.cancelled !== true) throw new Error("assertion_failed");
      delete process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT;
      const firstSave = await authed("POST", "/prototype/settings/automatic-backups/save-settings", { destinationDirectory: destination2, dailyLocalTime: "03:15" });
      if (firstSave.statusCode !== 200 || firstSave.json().settings.dailyLocalTime !== "03:15") throw new Error("assertion_failed");
      const savedState = await authed("GET", "/prototype/settings/automatic-backups/state");
      if (savedState.statusCode !== 200 || savedState.json().state.configuration.enabled !== false || savedState.json().state.scheduler.installed !== false) throw new Error("assertion_failed");
      rmSync(configPath, { force: true });
      initializeBackupSettings(profilePath, { destinationDirectory: destination, stagingDirectory: staging, taskName: "PF disposable backup api test" });
    });

    await check("profile resolves from explicit production path", async () => {
      process.env.PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH = profilePath;
      const response = await authed("GET", "/prototype/settings/automatic-backups/state");
      if (response.statusCode !== 200) throw new Error("assertion_failed");
    });

    await check("missing profile returns a specific safe code", async () => {
      process.env.PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH = path.join(root, "missing-profile.json");
      const response = await authed("GET", "/prototype/settings/automatic-backups/state");
      if (response.statusCode !== 409 || response.json().code !== "authority_profile_not_found") throw new Error("assertion_failed");
      process.env.PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH = profilePath;
    });

    await check("configuration and status reads", async () => {
      const state = await authed(
        "GET",
        "/prototype/settings/automatic-backups/state",
      );
      if (state.statusCode !== 200) throw new Error("assertion_failed");
      const body = state.json() as {
        state: { configuration: { destinationDirectory: string } };
      };
      if (body.state.configuration.destinationDirectory !== destination)
        throw new Error("assertion_failed");

      const recent = await authed(
        "GET",
        "/prototype/settings/automatic-backups/recent?limit=5",
      );
      if (recent.statusCode !== 200) throw new Error("assertion_failed");
    });

    await check("destination validation", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/validate-destination",
        { destinationDirectory: destination2 },
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
    });

    await check("cancelled folder picker", async () => {
      process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT = "cancel";
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/browse-destination",
        {},
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
      const body = response.json() as { selection: { cancelled: boolean } };
      if (body.selection.cancelled !== true)
        throw new Error("assertion_failed");
      delete process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT;
    });

    await check("empty destination is rejected safely", async () => {
      for (const value of ["", "   "]) {
        const response = await authed("POST", "/prototype/settings/automatic-backups/validate-destination", { destinationDirectory: value });
        if (response.statusCode !== 400 || response.json().code !== "backup_destination_required") throw new Error("assertion_failed");
        const save = await authed("POST", "/prototype/settings/automatic-backups/save-settings", { destinationDirectory: value, dailyLocalTime: "03:00" });
        if (save.statusCode !== 400 || save.json().code !== "backup_destination_required") throw new Error("assertion_failed");
      }
    });

    await check("picker failures are specific and script input is ignored", async () => {
      for (const failure of ["process_failed", "timeout", "noninteractive"]) {
        process.env.PF_BACKUP_TEST_FOLDER_PICKER_FAILURE = failure;
        const response = await authed("POST", "/prototype/settings/automatic-backups/browse-destination", {
          script: "Start-Process calc.exe",
        });
        if (response.statusCode !== 409 || response.json().code !== `folder_picker_${failure}`) throw new Error("assertion_failed");
      }
      delete process.env.PF_BACKUP_TEST_FOLDER_PICKER_FAILURE;
    });

    await check("invalid folder selection", async () => {
      process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT = sqlite;
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/browse-destination",
        {},
      );
      if (response.statusCode < 400) throw new Error("assertion_failed");
      const body = response.json() as { code?: string };
      if (typeof body.code !== "string") throw new Error("assertion_failed");
      delete process.env.PF_BACKUP_TEST_FOLDER_PICKER_RESULT;
    });

    await check("atomic settings save", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/save-settings",
        { destinationDirectory: destination2, dailyLocalTime: "03:45" },
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");

      const state = await authed(
        "GET",
        "/prototype/settings/automatic-backups/state",
      );
      const body = state.json() as {
        state: {
          configuration: {
            destinationDirectory: string;
            dailyLocalTime: string;
          };
        };
      };
      if (body.state.configuration.destinationDirectory !== destination2)
        throw new Error("assertion_failed");
      if (body.state.configuration.dailyLocalTime !== "03:45")
        throw new Error("assertion_failed");
    });

    await check(
      "enable installs scheduler before setting enabled",
      async () => {
        const response = await authed(
          "POST",
          "/prototype/settings/automatic-backups/enable",
          {},
        );
        if (response.statusCode !== 200) throw new Error("assertion_failed");
        const body = response.json() as {
          state: {
            configuration: { enabled: boolean };
            scheduler: { installed: boolean };
          };
        };
        if (body.state.scheduler.installed !== true)
          throw new Error("assertion_failed");
        if (body.state.configuration.enabled !== true)
          throw new Error("assertion_failed");
      },
    );

    await check("saving enabled settings updates configuration after scheduler update", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/save-settings",
        { destinationDirectory: destination2, dailyLocalTime: "04:15" },
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
      const state = await authed("GET", "/prototype/settings/automatic-backups/state");
      const body = state.json() as { state: { configuration: { enabled: boolean; dailyLocalTime: string }; scheduler: { installed: boolean } } };
      if (!body.state.configuration.enabled || !body.state.scheduler.installed || body.state.configuration.dailyLocalTime !== "04:15") throw new Error("assertion_failed");
    });

    await check("config-write failure restores scheduler and prior config", async () => {
      process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL = "true";
      const failed = await authed("POST", "/prototype/settings/automatic-backups/save-settings", { destinationDirectory: destination, dailyLocalTime: "05:15" });
      delete process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL;
      if (failed.statusCode < 400) throw new Error("assertion_failed");
      const state = await authed("GET", "/prototype/settings/automatic-backups/state");
      const body = state.json() as { state: { configuration: { dailyLocalTime: string }; scheduler: { installed: boolean } } };
      if (body.state.configuration.dailyLocalTime !== "04:15" || !body.state.scheduler.installed) throw new Error("assertion_failed");
    });

    await check("scheduler failure leaves enabled false", async () => {
      await authed("POST", "/prototype/settings/automatic-backups/disable", {});
      process.env.PF_BACKUP_TEST_FORCE_SCHEDULER_FAIL = "true";
      const failed = await authed(
        "POST",
        "/prototype/settings/automatic-backups/enable",
        {},
      );
      if (failed.statusCode < 400) throw new Error("assertion_failed");
      delete process.env.PF_BACKUP_TEST_FORCE_SCHEDULER_FAIL;

      const state = await authed(
        "GET",
        "/prototype/settings/automatic-backups/state",
      );
      const body = state.json() as {
        state: { configuration: { enabled: boolean } };
      };
      if (body.state.configuration.enabled !== false)
        throw new Error("assertion_failed");
    });

    await check("enable and disable config-write failures preserve scheduler consistency", async () => {
      process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL = "true";
      const enableFailed = await authed("POST", "/prototype/settings/automatic-backups/enable", {});
      delete process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL;
      if (enableFailed.statusCode < 400) throw new Error("assertion_failed");
      await authed("POST", "/prototype/settings/automatic-backups/enable", {});
      process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL = "true";
      const disableFailed = await authed("POST", "/prototype/settings/automatic-backups/disable", {});
      delete process.env.PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL;
      if (disableFailed.statusCode < 400) throw new Error("assertion_failed");
      const state = await authed("GET", "/prototype/settings/automatic-backups/state");
      const body = state.json() as { state: { configuration: { enabled: boolean }; scheduler: { installed: boolean } } };
      if (!body.state.configuration.enabled || !body.state.scheduler.installed) throw new Error("assertion_failed");
    });

    await check("run-now calls engine exactly once", async () => {
      await authed("POST", "/prototype/settings/automatic-backups/enable", {});
      const before = inventoryScheduledBackups(profilePath).length;
      const run = await authed(
        "POST",
        "/prototype/settings/automatic-backups/run-now",
        {},
      );
      if (run.statusCode !== 200) throw new Error("assertion_failed");
      const after = inventoryScheduledBackups(profilePath).length;
      if (after !== before + 1) throw new Error("assertion_failed");
    });

    await check("overlapping run-now rejected", async () => {
      const one = authed(
        "POST",
        "/prototype/settings/automatic-backups/run-now",
        {},
      );
      const two = authed(
        "POST",
        "/prototype/settings/automatic-backups/run-now",
        {},
      );
      const responses = await Promise.all([one, two]);
      if (!responses.some((entry) => entry.statusCode === 409))
        throw new Error("assertion_failed");
    });

    await check("verify-latest behavior", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/verify-latest",
        {},
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
      const body = response.json() as { result: { available: boolean } };
      if (body.result.available !== true) throw new Error("assertion_failed");
    });

    await check("disable removes scheduler and preserves backups", async () => {
      const before = inventoryScheduledBackups(profilePath).length;
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/disable",
        {},
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
      const body = response.json() as {
        state: {
          configuration: { enabled: boolean };
          scheduler: { installed: boolean };
        };
      };
      if (body.state.configuration.enabled !== false)
        throw new Error("assertion_failed");
      if (body.state.scheduler.installed !== false)
        throw new Error("assertion_failed");
      const after = inventoryScheduledBackups(profilePath).length;
      if (after !== before) throw new Error("assertion_failed");
    });

    await check("open-folder uses configured destination only", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/open-folder",
        {},
      );
      if (response.statusCode !== 200) throw new Error("assertion_failed");
    });

    await check("open-folder spawn failure is safe", async () => {
      process.env.PF_BACKUP_TEST_EXPLORER_FAILURE = "true";
      const response = await authed("POST", "/prototype/settings/automatic-backups/open-folder", { destinationDirectory: "C:/arbitrary" });
      if (response.statusCode !== 500 || response.json().code !== "backup_folder_open_failed") throw new Error("assertion_failed");
      delete process.env.PF_BACKUP_TEST_EXPLORER_FAILURE;
    });

    await check("safe error and path handling", async () => {
      const response = await authed(
        "POST",
        "/prototype/settings/automatic-backups/validate-destination",
        { destinationDirectory: sqlite },
      );
      if (response.statusCode < 400) throw new Error("assertion_failed");
      if (response.body.includes(root)) throw new Error("assertion_failed");
    });
  } finally {
    try {
      await app.close();
    } catch {
      // Ignore close errors during teardown.
    }

    Object.keys(process.env).forEach((key) => {
      if (
        key.startsWith("PF_BACKUP_TEST_") ||
        key.startsWith("PERSONAL_FINANCE_")
      ) {
        if (oldEnv[key] === undefined) delete process.env[key];
      }
    });
    Object.entries(oldEnv).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value;
    });

    rmSync(root, { recursive: true, force: true });
  }

  for (const result of checks) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  }
  const failed = checks.filter((entry) => !entry.ok).length;
  console.log(
    `Automatic backup API checks: total=${checks.length} passed=${checks.length - failed} failed=${failed}`,
  );
  if (failed) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

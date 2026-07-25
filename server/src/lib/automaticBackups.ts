import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";
import {
  backupStatusPathForProfile,
  backupConfigPathForProfile,
  initializeBackupSettings,
  inventoryScheduledBackups,
  readBackupSettings,
  runScheduledSqliteBackup,
  schedulerInstall,
  nextTime,
  updateBackupSettings,
  validateBackupDestination,
  validateBackupDestinationPath,
  type BackupSettings,
  type BackupStatusRecord,
} from "./scheduledSqliteBackup.js";
import { readAuthorityOpsProfile } from "./authorityOpsProfile.js";
import { getSqlitePath } from "../config.js";

const AUTHORITY_PROFILE_PATH_ENV_VAR =
  "PERSONAL_FINANCE_AUTHORITY_PROFILE_PATH" as const;

const RETENTION_SUMMARY =
  "One verified daily backup for the latest 30 days, then one verified monthly backup for older months.";
const BACKUP_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const OPERATION_TIMEOUT_MS = 10 * 1000;
const FOLDER_PICKER_TIMEOUT_MS = 30 * 1000;
const SIMULATE_SCHEDULER_ENV_VAR = "PF_BACKUP_TEST_SIMULATE_SCHEDULER" as const;
const FOLDER_PICKER_RESULT_ENV_VAR =
  "PF_BACKUP_TEST_FOLDER_PICKER_RESULT" as const;
const FOLDER_PICKER_FAILURE_ENV_VAR =
  "PF_BACKUP_TEST_FOLDER_PICKER_FAILURE" as const;
const WINDOWS_POWERSHELL = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const SKIP_EXPLORER_ENV_VAR = "PF_BACKUP_TEST_SKIP_EXPLORER" as const;
const FORCE_SCHEDULER_FAIL_ENV_VAR =
  "PF_BACKUP_TEST_FORCE_SCHEDULER_FAIL" as const;
const FORCE_CONFIG_WRITE_FAIL_ENV_VAR =
  "PF_BACKUP_TEST_FORCE_CONFIG_WRITE_FAIL" as const;

type BackupClassification = "daily" | "monthly";

interface SchedulerStatus {
  taskName: string;
  platform: string;
  supported: boolean;
  installed: boolean;
}

interface AutomaticBackupsReadState {
  configuration: {
    enabled: boolean;
    destinationDirectory: string;
    dailyLocalTime: string;
    updatedAt: string;
  };
  status: {
    lastAttemptedAt?: string;
    lastSuccessfulAt?: string;
    lastResultCode?: string;
    nextScheduledLocalTime?: string;
  };
  scheduler: SchedulerStatus;
  latestSuccessfulBackup?: {
    basename: string;
    createdAt?: string;
    classification?: BackupClassification;
  };
  latestVerification: {
    available: boolean;
    verified: boolean;
    basename?: string;
    reason?: string;
  };
  retentionPolicy: {
    dailyRetentionDays: 30;
    monthlyRetentionEnabled: true;
    summary: string;
  };
  warnings: string[];
}

interface AutomaticBackupsRecentSummary {
  basename: string;
  classification: BackupClassification;
  createdAt: string;
  normalizedLocalDay: string;
  sqliteSizeBytes: number;
}

interface ValidateDestinationResult {
  destinationDirectory: string;
  valid: boolean;
}

interface BrowseDestinationResult {
  cancelled: boolean;
  destinationDirectory?: string;
  validation?: ValidateDestinationResult;
}

interface SaveSettingsResult {
  destinationDirectory: string;
  dailyLocalTime: string;
  updatedAt: string;
}

interface VerifyLatestResult {
  available: boolean;
  verified: boolean;
  basename?: string;
  reason?: string;
}

interface RunBackupNowResult {
  basename: string;
  verificationStatus: "pass";
}

interface AutomaticBackupsService {
  readState: () => AutomaticBackupsReadState;
  listRecentValidBackups: (limit: number) => AutomaticBackupsRecentSummary[];
  validateDestination: (
    destinationDirectory: string,
  ) => ValidateDestinationResult;
  browseDestination: () => BrowseDestinationResult;
  saveSettings: (
    destinationDirectory: string,
    dailyLocalTime: string,
  ) => SaveSettingsResult;
  runBackupNow: () => Promise<RunBackupNowResult>;
  verifyLatestBackup: () => VerifyLatestResult;
  installOrUpdateScheduler: () => SchedulerStatus;
  removeScheduler: () => SchedulerStatus;
  enableAutomaticBackups: () => AutomaticBackupsReadState;
  disableAutomaticBackups: () => AutomaticBackupsReadState;
  openConfiguredDestinationFolder: () => Promise<{ opened: true }>;
}

interface RouteError {
  httpStatus: number;
  code: string;
}

const routeError = (httpStatus: number, code: string): RouteError => ({
  httpStatus,
  code,
});

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(code));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const toCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("folder_picker_")) return code;
  }
  return error instanceof Error && error.message
    ? path.basename(error.message)
    : "automatic_backups_operation_failed";
};

const taskExists = (taskName: string): boolean => {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("schtasks.exe", ["/Query", "/TN", taskName], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: OPERATION_TIMEOUT_MS,
      encoding: "utf8",
    });
    return true;
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout?: Buffer | string }).stdout ?? "")
        : "";
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? "")
        : "";
    const output = `${stdout}\n${stderr}`.toLowerCase();
    if (
      output.includes("cannot find the file") ||
      output.includes("does not exist")
    ) {
      return false;
    }
    throw new Error("scheduler_query_failed");
  }
};

const readStatus = (profilePath: string): BackupStatusRecord => {
  const file = backupStatusPathForProfile(profilePath);
  if (!existsSync(file)) return { statusVersion: 1 };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as BackupStatusRecord;
    if (parsed && parsed.statusVersion === 1) return parsed;
    return { statusVersion: 1 };
  } catch {
    return { statusVersion: 1 };
  }
};

const schedulerStatus = (profilePath: string): SchedulerStatus => {
  const settings = readBackupSettings(profilePath);
  if (schedulerSimulationEnabled()) {
    return {
      taskName: settings.taskName,
      platform: process.platform,
      supported: true,
      installed: simulatedSchedulerInstalled,
    };
  }
  return {
    taskName: settings.taskName,
    platform: process.platform,
    supported: process.platform === "win32",
    installed:
      process.platform === "win32" ? taskExists(settings.taskName) : false,
  };
};

const readState = (profilePath: string): AutomaticBackupsReadState => {
  const settings = readBackupSettings(profilePath);
  const status = readStatus(profilePath);
  const scheduler = schedulerStatus(profilePath);
  const inventory = inventoryScheduledBackups(profilePath);
  const latest = inventory[0];
  const latestValid = inventory.find((item) => item.valid && item.manifest);
  const warnings: string[] = [];
  if (settings.enabled !== scheduler.installed) {
    warnings.push("configuration_scheduler_mismatch");
  }
  return {
    configuration: {
      enabled: settings.enabled,
      destinationDirectory: settings.destinationDirectory,
      dailyLocalTime: settings.dailyLocalTime,
      updatedAt: settings.updatedAt,
    },
    status: {
      lastAttemptedAt: status.lastAttemptedAt,
      lastSuccessfulAt: status.lastSuccessfulAt,
      lastResultCode: status.lastResultCode,
      nextScheduledLocalTime: scheduler.installed ? nextTime(settings.dailyLocalTime) : undefined,
    },
    scheduler,
    latestSuccessfulBackup: latestValid?.manifest
      ? {
          basename: latestValid.basename,
          createdAt: latestValid.manifest.createdAt,
          classification: latestValid.manifest.classification,
        }
      : undefined,
    latestVerification: latest
      ? {
          available: true,
          verified: latest.valid,
          basename: latest.basename,
          ...(latest.valid
            ? {}
            : { reason: latest.reason ?? "backup_invalid" }),
        }
      : {
          available: false,
          verified: false,
        },
    retentionPolicy: {
      dailyRetentionDays: 30,
      monthlyRetentionEnabled: true,
      summary: RETENTION_SUMMARY,
    },
    warnings,
  };
};

const listRecentValidBackups = (
  profilePath: string,
  limit: number,
): AutomaticBackupsRecentSummary[] =>
  inventoryScheduledBackups(profilePath)
    .filter((item) => item.valid && item.manifest)
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map((item) => ({
      basename: item.basename,
      classification: item.manifest!.classification,
      createdAt: item.manifest!.createdAt,
      normalizedLocalDay: item.manifest!.normalizedLocalDay,
      sqliteSizeBytes: item.manifest!.sqliteSizeBytes,
    }));

const browseDestinationWindows = (startPath?: string): string | undefined => {
  const simulatedSelection = process.env[FOLDER_PICKER_RESULT_ENV_VAR];
  if (simulatedSelection !== undefined) {
    const trimmed = simulatedSelection.trim();
    if (trimmed === "cancel") return undefined;
    return trimmed;
  }
  if (process.platform !== "win32") {
    throw new Error("folder_picker_windows_only");
  }
  const simulatedFailure = process.env[FOLDER_PICKER_FAILURE_ENV_VAR];
  if (simulatedFailure === "timeout" || simulatedFailure === "process_failed" || simulatedFailure === "noninteractive") {
    throw new Error(`folder_picker_${simulatedFailure}`);
  }
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select backup destination folder'",
    "$dialog.ShowNewFolderButton = $true",
    "$start = [Environment]::GetEnvironmentVariable('PF_BACKUP_BROWSE_START')",
    "if ($start -and (Test-Path -LiteralPath $start -PathType Container)) { $dialog.SelectedPath = $start }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ('PATH::' + $dialog.SelectedPath) } else { Write-Output 'CANCELLED' }",
  ].join("; ");
  const scriptPath = path.join(os.tmpdir(), `pf-folder-picker-${process.pid}-${Date.now()}.ps1`);
  try {
    writeFileSync(scriptPath, script, { encoding: "utf8", flag: "wx" });
    const output = execFileSync(
      WINDOWS_POWERSHELL,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-File",
        scriptPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: FOLDER_PICKER_TIMEOUT_MS,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          PF_BACKUP_BROWSE_START: startPath ?? "",
        },
      },
    ).trim();
    if (output === "CANCELLED") return undefined;
    if (output.startsWith("PATH::")) {
      return output.slice("PATH::".length).trim();
    }
    throw new Error("folder_picker_process_failed");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("folder_picker_")) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    const safeCode = code === "ETIMEDOUT" ? "folder_picker_timeout" : "folder_picker_process_failed";
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const summary = stderr.replace(/[A-Za-z]:\\[^\r\n ]*/g, "<path>").replace(/\s+/g, " ").trim().slice(0, 160);
    console.warn(`[automatic-backups] ${safeCode} spawn=${code ? "yes" : "no"} stderr=${summary || "<none>"}`);
    throw new Error(safeCode);
  } finally {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
  }
};

let manualBackupInFlight = false;
let simulatedSchedulerInstalled = false;
let simulatedSchedulerSettings: BackupSettings | undefined;

const schedulerSimulationEnabled = (): boolean =>
  process.env[SIMULATE_SCHEDULER_ENV_VAR] === "true";

const applySchedulerAction = (
  profilePath: string,
  mode: "install" | "update" | "remove",
  settings?: BackupSettings,
): void => {
  if (process.env[FORCE_SCHEDULER_FAIL_ENV_VAR] === "true") {
    throw new Error("scheduler_operation_failed");
  }
  if (!schedulerSimulationEnabled()) {
    schedulerInstall(profilePath, mode, settings);
    return;
  }
  if (mode === "remove") {
    simulatedSchedulerInstalled = false;
    simulatedSchedulerSettings = undefined;
    return;
  }
  simulatedSchedulerInstalled = true;
  simulatedSchedulerSettings = settings ?? readBackupSettings(profilePath);
};

const writeSettings = (
  profilePath: string,
  change: Partial<Pick<BackupSettings, "destinationDirectory" | "dailyLocalTime" | "enabled">>,
): BackupSettings => {
  if (process.env[FORCE_CONFIG_WRITE_FAIL_ENV_VAR] === "true") {
    throw new Error("backup_configuration_write_failed");
  }
  return updateBackupSettings(profilePath, change);
};

const candidateSettings = (
  profilePath: string,
  current: BackupSettings,
  destinationDirectory: string,
  dailyLocalTime: string,
): BackupSettings => {
  const validated = validateBackupDestination(profilePath, destinationDirectory, false);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyLocalTime)) {
    throw new Error("backup_time_invalid");
  }
  return { ...current, ...validated, dailyLocalTime, updatedAt: new Date().toISOString() };
};

const restoreScheduler = (profilePath: string, previous: BackupSettings): void => {
  applySchedulerAction(profilePath, "update", previous);
  if (!schedulerStatus(profilePath).installed) {
    throw new Error("automatic_backups_repair_required");
  }
};

const createService = (profilePath: string): AutomaticBackupsService => ({
  readState: () => readState(profilePath),
  listRecentValidBackups: (limit) => listRecentValidBackups(profilePath, limit),
  validateDestination: (destinationDirectory) => {
    const settings = validateBackupDestination(
      profilePath,
      destinationDirectory,
      false,
    );
    return {
      destinationDirectory: settings.destinationDirectory,
      valid: true,
    };
  },
  browseDestination: () => {
    const configExists = existsSync(backupConfigPathForProfile(profilePath));
    const current = configExists ? readBackupSettings(profilePath) : undefined;
    const selectedPath = browseDestinationWindows(current?.destinationDirectory);
    if (!selectedPath) {
      return { cancelled: true };
    }
    const validatedDestination = configExists
      ? validateBackupDestination(profilePath, selectedPath, false).destinationDirectory
      : validateBackupDestinationPath(profilePath, selectedPath);
    return {
      cancelled: false,
      destinationDirectory: validatedDestination,
      validation: {
        destinationDirectory: validatedDestination,
        valid: true,
      },
    };
  },
  saveSettings: (destinationDirectory, dailyLocalTime) => {
    if (!existsSync(backupConfigPathForProfile(profilePath))) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyLocalTime)) throw new Error("backup_time_invalid");
      const created = initializeBackupSettings(profilePath, {
        destinationDirectory,
        dailyLocalTime,
      });
      return {
        destinationDirectory: created.destinationDirectory,
        dailyLocalTime: created.dailyLocalTime,
        updatedAt: created.updatedAt,
      };
    }
    const previous = readBackupSettings(profilePath);
    const proposed = candidateSettings(profilePath, previous, destinationDirectory, dailyLocalTime);
    let schedulerChanged = false;
    try {
      if (previous.enabled) {
        applySchedulerAction(profilePath, "update", proposed);
        schedulerChanged = true;
        if (!schedulerStatus(profilePath).installed) throw new Error("scheduler_install_confirmation_failed");
      }
      const updated = writeSettings(profilePath, { destinationDirectory: proposed.destinationDirectory, dailyLocalTime: proposed.dailyLocalTime });
      return {
        destinationDirectory: updated.destinationDirectory,
        dailyLocalTime: updated.dailyLocalTime,
        updatedAt: updated.updatedAt,
      };
    } catch (error) {
      if (schedulerChanged) restoreScheduler(profilePath, previous);
      throw error;
    }
  },
  runBackupNow: async () => {
    if (manualBackupInFlight) {
      throw new Error("backup_run_in_progress");
    }
    manualBackupInFlight = true;
    try {
      const result = await withTimeout(
        runScheduledSqliteBackup(profilePath, "daily", {
          allowDisabledForManualRun: true,
        }),
        BACKUP_RUN_TIMEOUT_MS,
        "backup_run_timeout",
      );
      return {
        basename: result.basename,
        verificationStatus: result.manifest.verificationStatus,
      };
    } finally {
      manualBackupInFlight = false;
    }
  },
  verifyLatestBackup: () => {
    const latest = inventoryScheduledBackups(profilePath)[0];
    if (!latest) {
      return { available: false, verified: false };
    }
    return {
      available: true,
      verified: latest.valid,
      basename: latest.basename,
      ...(latest.valid ? {} : { reason: latest.reason ?? "backup_invalid" }),
    };
  },
  installOrUpdateScheduler: () => {
    if (process.platform !== "win32") {
      throw new Error("windows_scheduler_unsupported");
    }
    const before = schedulerStatus(profilePath);
    applySchedulerAction(profilePath, before.installed ? "update" : "install");
    const after = schedulerStatus(profilePath);
    if (!after.installed) {
      throw new Error("scheduler_install_confirmation_failed");
    }
    return after;
  },
  removeScheduler: () => {
    if (process.platform !== "win32") {
      throw new Error("windows_scheduler_unsupported");
    }
    const before = schedulerStatus(profilePath);
    if (before.installed) {
      applySchedulerAction(profilePath, "remove");
    }
    const after = schedulerStatus(profilePath);
    if (after.installed) {
      throw new Error("scheduler_remove_confirmation_failed");
    }
    return after;
  },
  enableAutomaticBackups: () => {
    const current = readBackupSettings(profilePath);
    validateBackupDestination(profilePath, current.destinationDirectory, false);
    const before = schedulerStatus(profilePath);
    applySchedulerAction(profilePath, before.installed ? "update" : "install", current);
    const after = schedulerStatus(profilePath);
    if (!after.installed) {
      throw new Error("scheduler_install_confirmation_failed");
    }
    try { writeSettings(profilePath, { enabled: true }); } catch (error) { if (!before.installed) { applySchedulerAction(profilePath, "remove", current); } else { restoreScheduler(profilePath, current); } throw error; }
    return readState(profilePath);
  },
  disableAutomaticBackups: () => {
    const before = schedulerStatus(profilePath);
    if (before.installed) {
      applySchedulerAction(profilePath, "remove");
    }
    const after = schedulerStatus(profilePath);
    if (after.installed) {
      throw new Error("scheduler_remove_confirmation_failed");
    }
    try { writeSettings(profilePath, { enabled: false }); } catch (error) { restoreScheduler(profilePath, { ...readBackupSettings(profilePath), enabled: true }); throw error; }
    return readState(profilePath);
  },
  openConfiguredDestinationFolder: async () => {
    const current = readBackupSettings(profilePath);
    const validated = validateBackupDestination(
      profilePath,
      current.destinationDirectory,
      false,
    );
    if (process.platform !== "win32") {
      throw new Error("open_folder_windows_only");
    }
    if (process.env.PF_BACKUP_TEST_EXPLORER_FAILURE === "true") throw new Error("backup_folder_open_failed");
    if (process.env[SKIP_EXPLORER_ENV_VAR] === "true") {
      return { opened: true as const };
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn("explorer.exe", [validated.destinationDirectory], {
        detached: true,
        shell: false,
        windowsHide: false,
        stdio: "ignore",
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve();
      });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        reject(new Error("backup_folder_open_failed"));
      });
    });
    return { opened: true as const };
  },
});

const profilePathFromEnvironment = (): string => {
  const profilePath = process.env[AUTHORITY_PROFILE_PATH_ENV_VAR]?.trim();
  if (!profilePath) {
    throw new Error("authority_profile_path_missing");
  }
  if (!path.isAbsolute(profilePath)) {
    throw new Error("authority_profile_path_invalid");
  }
  if (!existsSync(profilePath)) throw new Error("authority_profile_not_found");
  try {
    const profile = readAuthorityOpsProfile(profilePath);
    const configuredSqlite = getSqlitePath();
    if (configuredSqlite && path.resolve(configuredSqlite) !== path.resolve(profile.activeDatabasePath)) {
      throw new Error("authority_profile_runtime_mismatch");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("authority_profile_")) throw error;
    throw new Error("authority_profile_not_found");
  }
  return profilePath;
};

const initialState = (): AutomaticBackupsReadState => ({
  configuration: {
    enabled: false,
    destinationDirectory: "",
    dailyLocalTime: "02:30",
    updatedAt: "",
  },
  status: {},
  scheduler: {
    taskName: "Personal Finance Verified SQLite Backup",
    platform: process.platform,
    supported: process.platform === "win32",
    installed: false,
  },
  latestVerification: { available: false, verified: false },
  retentionPolicy: {
    dailyRetentionDays: 30,
    monthlyRetentionEnabled: true,
    summary: RETENTION_SUMMARY,
  },
  warnings: [],
});

const mapError = (error: unknown): RouteError => {
  const code = toCode(error);
  if (code === "backup_run_in_progress") return routeError(409, code);
  if (code === "backup_run_timeout") return routeError(504, code);
  if (code.startsWith("folder_picker_")) return routeError(409, code);
  if (code.startsWith("authority_profile_")) return routeError(409, code);
  if (code === "backup_folder_open_failed") return routeError(500, code);
  if (code.includes("invalid") || code.includes("required")) {
    return routeError(400, code);
  }
  if (
    code.includes("unsupported") ||
    code.includes("missing") ||
    code.includes("not_available")
  ) {
    return routeError(409, code);
  }
  return routeError(500, "automatic_backups_operation_failed");
};

const parseLimit = (value: unknown): number => {
  if (value === undefined) return 10;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("limit_invalid");
  }
  return Math.max(1, Math.min(Number(value), 20));
};

export const registerAutomaticBackupsRoutes = (
  server: FastifyInstance,
): void => {
  const service = (): AutomaticBackupsService =>
    createService(profilePathFromEnvironment());

  server.get(
    "/prototype/settings/automatic-backups/state",
    async (_request, reply) => {
      try {
        const profilePath = profilePathFromEnvironment();
        if (!existsSync(backupConfigPathForProfile(profilePath))) {
          return { ok: true, state: initialState() };
        }
        return {
          ok: true,
          state: createService(profilePath).readState(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.get<{
    Querystring: { limit?: string };
  }>("/prototype/settings/automatic-backups/recent", async (request, reply) => {
    try {
      const limit = parseLimit(request.query.limit);
      return {
        ok: true,
        rows: service().listRecentValidBackups(limit),
      };
    } catch (error) {
      const mapped = mapError(error);
      return reply
        .code(mapped.httpStatus)
        .send({ ok: false, code: mapped.code });
    }
  });

  server.post<{ Body: { destinationDirectory?: unknown } }>(
    "/prototype/settings/automatic-backups/validate-destination",
    async (request, reply) => {
      try {
        if (typeof request.body?.destinationDirectory !== "string" || request.body.destinationDirectory.trim() === "") {
          throw new Error("backup_destination_required");
        }
        const validation = service().validateDestination(
          request.body.destinationDirectory.trim(),
        );
        return {
          ok: true,
          validation,
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/browse-destination",
    async (_request, reply) => {
      try {
        const selection = service().browseDestination();
        return {
          ok: true,
          selection,
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post<{
    Body: { destinationDirectory?: unknown; dailyLocalTime?: unknown };
  }>(
    "/prototype/settings/automatic-backups/save-settings",
    async (request, reply) => {
      try {
        if (typeof request.body?.destinationDirectory !== "string" || request.body.destinationDirectory.trim() === "") {
          throw new Error("backup_destination_required");
        }
        if (typeof request.body?.dailyLocalTime !== "string") {
          throw new Error("backup_time_required");
        }
        const settings = service().saveSettings(
          request.body.destinationDirectory.trim(),
          request.body.dailyLocalTime,
        );
        return {
          ok: true,
          settings,
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/run-now",
    async (_request, reply) => {
      try {
        const result = await service().runBackupNow();
        return { ok: true, result };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/verify-latest",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          result: service().verifyLatestBackup(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/scheduler/install-or-update",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          scheduler: service().installOrUpdateScheduler(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/scheduler/remove",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          scheduler: service().removeScheduler(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/enable",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          state: service().enableAutomaticBackups(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/disable",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          state: service().disableAutomaticBackups(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );

  server.post(
    "/prototype/settings/automatic-backups/open-folder",
    async (_request, reply) => {
      try {
        return {
          ok: true,
          result: await service().openConfiguredDestinationFolder(),
        };
      } catch (error) {
        const mapped = mapError(error);
        return reply
          .code(mapped.httpStatus)
          .send({ ok: false, code: mapped.code });
      }
    },
  );
};

export { createService as createAutomaticBackupsService };

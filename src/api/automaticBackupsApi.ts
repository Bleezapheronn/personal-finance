import { localApiGet, localApiPost } from "./localApiClient";

export interface AutomaticBackupsState {
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
  scheduler: {
    taskName: string;
    platform: string;
    supported: boolean;
    installed: boolean;
  };
  latestSuccessfulBackup?: {
    basename: string;
    createdAt?: string;
    classification?: "daily" | "monthly";
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

export interface AutomaticBackupsRecentRow {
  basename: string;
  classification: "daily" | "monthly";
  createdAt: string;
  normalizedLocalDay: string;
  sqliteSizeBytes: number;
}

interface StateResponse {
  ok: true;
  state: AutomaticBackupsState;
}

interface RecentResponse {
  ok: true;
  rows: AutomaticBackupsRecentRow[];
}

interface ValidationResponse {
  ok: true;
  validation: {
    destinationDirectory: string;
    valid: boolean;
  };
}

interface BrowseResponse {
  ok: true;
  selection: {
    cancelled: boolean;
    destinationDirectory?: string;
    validation?: {
      destinationDirectory: string;
      valid: boolean;
    };
  };
}

interface SaveResponse {
  ok: true;
  settings: {
    destinationDirectory: string;
    dailyLocalTime: string;
    updatedAt: string;
  };
}

interface RunResponse {
  ok: true;
  result: {
    basename: string;
    verificationStatus: "pass";
  };
}

interface VerifyResponse {
  ok: true;
  result: {
    available: boolean;
    verified: boolean;
    basename?: string;
    reason?: string;
  };
}

interface SchedulerResponse {
  ok: true;
  scheduler: {
    taskName: string;
    platform: string;
    supported: boolean;
    installed: boolean;
  };
}

export const readAutomaticBackupsState =
  async (): Promise<AutomaticBackupsState> => {
    const response = await localApiGet<StateResponse>(
      "/prototype/settings/automatic-backups/state",
    );
    return response.state;
  };

export const listRecentAutomaticBackups = async (
  limit = 10,
): Promise<AutomaticBackupsRecentRow[]> => {
  const response = await localApiGet<RecentResponse>(
    "/prototype/settings/automatic-backups/recent",
    { query: { limit } },
  );
  return response.rows;
};

export const validateAutomaticBackupDestination = async (
  destinationDirectory: string,
): Promise<ValidationResponse["validation"]> => {
  const response = await localApiPost<ValidationResponse>(
    "/prototype/settings/automatic-backups/validate-destination",
    { destinationDirectory },
  );
  return response.validation;
};

export const browseAutomaticBackupDestination = async (): Promise<
  BrowseResponse["selection"]
> => {
  const response = await localApiPost<BrowseResponse>(
    "/prototype/settings/automatic-backups/browse-destination",
    {},
  );
  return response.selection;
};

export const saveAutomaticBackupSettings = async (
  destinationDirectory: string,
  dailyLocalTime: string,
): Promise<SaveResponse["settings"]> => {
  const response = await localApiPost<SaveResponse>(
    "/prototype/settings/automatic-backups/save-settings",
    {
      destinationDirectory,
      dailyLocalTime,
    },
  );
  return response.settings;
};

export const enableAutomaticBackups =
  async (): Promise<AutomaticBackupsState> => {
    const response = await localApiPost<{
      ok: true;
      state: AutomaticBackupsState;
    }>("/prototype/settings/automatic-backups/enable", {});
    return response.state;
  };

export const disableAutomaticBackups =
  async (): Promise<AutomaticBackupsState> => {
    const response = await localApiPost<{
      ok: true;
      state: AutomaticBackupsState;
    }>("/prototype/settings/automatic-backups/disable", {});
    return response.state;
  };

export const runAutomaticBackupNow = async (): Promise<
  RunResponse["result"]
> => {
  const response = await localApiPost<RunResponse>(
    "/prototype/settings/automatic-backups/run-now",
    {},
  );
  return response.result;
};

export const verifyLatestAutomaticBackup = async (): Promise<
  VerifyResponse["result"]
> => {
  const response = await localApiPost<VerifyResponse>(
    "/prototype/settings/automatic-backups/verify-latest",
    {},
  );
  return response.result;
};

export const installOrUpdateAutomaticBackupScheduler = async (): Promise<
  SchedulerResponse["scheduler"]
> => {
  const response = await localApiPost<SchedulerResponse>(
    "/prototype/settings/automatic-backups/scheduler/install-or-update",
    {},
  );
  return response.scheduler;
};

export const removeAutomaticBackupScheduler = async (): Promise<
  SchedulerResponse["scheduler"]
> => {
  const response = await localApiPost<SchedulerResponse>(
    "/prototype/settings/automatic-backups/scheduler/remove",
    {},
  );
  return response.scheduler;
};

export const openAutomaticBackupFolder = async (): Promise<void> => {
  await localApiPost<{ ok: true; result: { opened: true } }>(
    "/prototype/settings/automatic-backups/open-folder",
    {},
  );
};

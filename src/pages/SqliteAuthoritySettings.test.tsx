import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SqliteAuthoritySettings from "./SqliteAuthoritySettings";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import * as backupApi from "../api/automaticBackupsApi";

vi.mock("../contexts/SqliteAuthorityRehearsalContext", () => ({
  useSqliteAuthorityRehearsal: vi.fn(),
}));

vi.mock("../api/automaticBackupsApi", () => ({
  readAutomaticBackupsState: vi.fn(),
  browseAutomaticBackupDestination: vi.fn(),
  validateAutomaticBackupDestination: vi.fn(),
  saveAutomaticBackupSettings: vi.fn(),
  enableAutomaticBackups: vi.fn(),
  disableAutomaticBackups: vi.fn(),
  runAutomaticBackupNow: vi.fn(),
  verifyLatestAutomaticBackup: vi.fn(),
  openAutomaticBackupFolder: vi.fn(),
}));

const mockedReadiness = vi.mocked(useSqliteAuthorityRehearsal);
const mockedApi = {
  read: vi.mocked(backupApi.readAutomaticBackupsState),
  browse: vi.mocked(backupApi.browseAutomaticBackupDestination),
  validate: vi.mocked(backupApi.validateAutomaticBackupDestination),
  save: vi.mocked(backupApi.saveAutomaticBackupSettings),
  enable: vi.mocked(backupApi.enableAutomaticBackups),
  disable: vi.mocked(backupApi.disableAutomaticBackups),
  runNow: vi.mocked(backupApi.runAutomaticBackupNow),
  verify: vi.mocked(backupApi.verifyLatestAutomaticBackup),
  openFolder: vi.mocked(backupApi.openAutomaticBackupFolder),
};

const baseState = {
  configuration: {
    enabled: false,
    destinationDirectory: "C:/Backups",
    dailyLocalTime: "02:30",
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  status: {
    lastAttemptedAt: "2026-07-25T10:00:00.000Z",
    lastSuccessfulAt: "2026-07-25T10:01:00.000Z",
    nextScheduledLocalTime: "2026-07-26T02:30:00.000Z",
  },
  scheduler: {
    taskName: "PF Backup",
    platform: "win32",
    supported: true,
    installed: false,
  },
  latestSuccessfulBackup: {
    basename: "backup.sqlite",
    createdAt: "2026-07-25T10:01:00.000Z",
    classification: "daily" as const,
  },
  latestVerification: {
    available: true,
    verified: true,
    basename: "backup.sqlite",
  },
  retentionPolicy: {
    dailyRetentionDays: 30 as const,
    monthlyRetentionEnabled: true as const,
    summary:
      "One verified daily backup for the latest 30 days, then one verified monthly backup for older months.",
  },
  warnings: [] as string[],
};

const withEnabledState = {
  ...baseState,
  configuration: {
    ...baseState.configuration,
    enabled: true,
  },
  scheduler: {
    ...baseState.scheduler,
    installed: true,
  },
};

const createDeferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const getButtonInTestId = (testId: string): HTMLElement => {
  const button = screen.getByTestId(testId).querySelector("ion-button");
  expect(button).not.toBeNull();
  return button as HTMLElement;
};

const getBrowseButton = (): HTMLElement =>
  getButtonInTestId("destination-editor-row");

const getRunNowButton = (): HTMLElement =>
  getButtonInTestId("next-scheduled-run-actions");

const getOpenFolderButton = (): HTMLElement =>
  getButtonInTestId("last-successful-backup-actions");

const getVerifyLatestButton = (): HTMLElement =>
  getButtonInTestId("last-verification-actions");

const getSaveSettingsButton = (): HTMLElement => {
  const button = screen.getByTestId("page-settings-actions").querySelector("ion-button");
  expect(button).not.toBeNull();
  return button as HTMLElement;
};

const clickButton = (button: HTMLElement): void => {
  fireEvent.click(button);
};

const expectDisabled = (element: HTMLElement): void => {
  expect(
    element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
  ).toBe(true);
};

const setIonInput = (ariaLabel: string, value: string): void => {
  const input = ariaLabel === "Destination folder input"
    ? document.querySelector("ion-input[data-testid=destination-input]")
    : Array.from(document.querySelectorAll("ion-input")).find((element) => element.getAttribute("aria-label") === ariaLabel);
  if (!input) throw new Error(`Missing Ionic input: ${ariaLabel}`);
  fireEvent(
    input,
    new CustomEvent("ionInput", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
};

const setAutomaticBackupsToggle = (checked: boolean): void => {
  const toggle = document.querySelector("ion-toggle");
  expect(toggle).not.toBeNull();
  fireEvent(
    toggle as Element,
    new CustomEvent("ionChange", {
      detail: { checked },
      bubbles: true,
      composed: true,
    }),
  );
};

const readIonInputValue = (ariaLabel: string): string => {
  const input = (ariaLabel === "Destination folder input"
    ? document.querySelector("ion-input[data-testid=destination-input]")
    : Array.from(document.querySelectorAll("ion-input")).find((element) => element.getAttribute("aria-label") === ariaLabel)) as (HTMLElement & {
    value?: string;
  }) | null;
  expect(input).not.toBeNull();
  return String(input!.value ?? input!.getAttribute("value") ?? "");
};

const getStatusByText = (text: string): HTMLElement => {
  const card = screen.getByText("Automatic Backups").closest("ion-card");
  expect(card).not.toBeNull();
  const match = Array.from(card!.querySelectorAll("ion-text, p, h2, ion-note, span"))
    .find((element) => (element.textContent ?? "").includes(text));
  expect(match).not.toBeUndefined();
  return match as HTMLElement;
};

const waitForBackupsReady = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByTestId("destination-editor-row")).toBeInTheDocument();
  });
};

describe("SqliteAuthoritySettings automatic backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedReadiness.mockReturnValue({
      mode: "http-sqlite-authoritative",
      selected: true,
      authoritativeMode: true,
      acknowledged: true,
      checking: false,
      ready: true,
      apiAvailable: true,
      missingCapabilities: [],
      missingRequirements: [],
      unsupportedOperations: [],
      transactionDeleteWritesAvailable: true,
      budgetLifecycleWritesAvailable: true,
      budgetSnapshotOccurrenceWritesAvailable: true,
      budgetDeleteWritesAvailable: true,
      recipientDeleteMergeWritesAvailable: true,
      accountDeleteMergeWritesAvailable: true,
      categoryDeleteMergeWritesAvailable: true,
      bucketDeleteMergeWritesAvailable: true,
      message: "ready",
      refresh: async () => undefined,
    });

    mockedApi.read.mockResolvedValue({ ...baseState });
    mockedApi.browse.mockResolvedValue({ cancelled: true });
    mockedApi.validate.mockResolvedValue({
      destinationDirectory: "C:/Backups",
      valid: true,
    });
    mockedApi.save.mockResolvedValue({
      destinationDirectory: "C:/Backups",
      dailyLocalTime: "02:30",
      updatedAt: "2026-07-25T10:00:00.000Z",
    });
    mockedApi.enable.mockResolvedValue({ ...withEnabledState });
    mockedApi.disable.mockResolvedValue({ ...baseState });
    mockedApi.runNow.mockResolvedValue({
      basename: "backup.sqlite",
      verificationStatus: "pass",
    });
    mockedApi.verify.mockResolvedValue({
      available: true,
      verified: true,
      basename: "backup.sqlite",
    });
    mockedApi.openFolder.mockResolvedValue();
  });

  test("toggle renders current state and old enable/disable buttons are removed", async () => {
    render(<SqliteAuthoritySettings />);

    await waitFor(() => {
      expect(document.querySelector("ion-toggle")).not.toBeNull();
      expect(getStatusByText("Scheduler not installed")).toBeInTheDocument();
    });

    expect(screen.queryByText("Enable Automatic Backups")).toBeNull();
    expect(screen.queryByText("Disable Automatic Backups")).toBeNull();
  });

  test("browse is adjacent to destination input and auto-validates", async () => {
    mockedApi.browse.mockResolvedValueOnce({
      cancelled: false,
      destinationDirectory: "C:/Backups/New",
      validation: { destinationDirectory: "C:/Backups/New", valid: true },
    });
    mockedApi.validate.mockResolvedValueOnce({
      destinationDirectory: "C:/Backups/New",
      valid: true,
    });

    render(<SqliteAuthoritySettings />);

    await waitFor(() => {
      expect(getBrowseButton()).toBeInTheDocument();
    });

    const input = document.querySelector("ion-input[data-testid=destination-input]");
    expect(input).not.toBeNull();
    expect(input!.closest('[data-testid="destination-editor-row"]')).toBe(
      getBrowseButton().closest('[data-testid="destination-editor-row"]'),
    );

    clickButton(getBrowseButton());

    await waitFor(() => {
      expect(mockedApi.validate).toHaveBeenCalledWith("C:/Backups/New");
      expect(screen.getByText("Destination validated.")).toBeInTheDocument();
    });
  });

  test("manual editing clears validation success and no Validate button exists", async () => {
    mockedApi.browse.mockResolvedValueOnce({
      cancelled: false,
      destinationDirectory: "C:/Backups/New",
      validation: { destinationDirectory: "C:/Backups/New", valid: true },
    });
    mockedApi.validate.mockResolvedValueOnce({
      destinationDirectory: "C:/Backups/New",
      valid: true,
    });

    render(<SqliteAuthoritySettings />);

    await waitFor(() => {
      expect(getBrowseButton()).toBeInTheDocument();
    });
    clickButton(getBrowseButton());

    await waitFor(() => {
      expect(screen.getByText("Destination validated.")).toBeInTheDocument();
    });

    setIonInput("Destination folder input", "C:/Backups/Edited");

    await waitFor(() => {
      expect(screen.queryByText("Destination validated.")).toBeNull();
    });

    expect(screen.queryByText(/^Validate$/)).toBeNull();
  });

  test("page-level Save Settings stays outside the card and is disabled when not dirty", async () => {
    render(<SqliteAuthoritySettings />);

    await waitFor(() => {
      expect(getSaveSettingsButton()).toBeInTheDocument();
    });

    const automaticBackupsCard = screen.getByText("Automatic Backups").closest("ion-card");
    expect(automaticBackupsCard).not.toBeNull();
    expect(automaticBackupsCard).not.toContain(getSaveSettingsButton());

    expect(getSaveSettingsButton()).toHaveAttribute("disabled");
  });

  test("editing destination or time marks page dirty", async () => {
    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(getSaveSettingsButton()).toHaveAttribute("disabled");
    });

    setIonInput("Destination folder input", "C:/Backups/Changed");
    await waitFor(() => {
      expect(getSaveSettingsButton()).not.toHaveAttribute("disabled");
    });

    clickButton(getSaveSettingsButton());
    await waitFor(() => {
      expect(getSaveSettingsButton()).toHaveAttribute("disabled");
    });

    setIonInput("Daily backup time", "03:45");
    await waitFor(() => {
      expect(getSaveSettingsButton()).not.toHaveAttribute("disabled");
    });
  });

  test("save validates automatically and successful save clears dirty state", async () => {
    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    setIonInput("Destination folder input", "C:/Backups/Updated");
    mockedApi.validate.mockResolvedValueOnce({
      destinationDirectory: "C:/Backups/Updated",
      valid: true,
    });

    clickButton(getSaveSettingsButton());

    await waitFor(() => {
      expect(mockedApi.validate).toHaveBeenCalledWith("C:/Backups/Updated");
      expect(mockedApi.save).toHaveBeenCalledWith("C:/Backups/Updated", "02:30");
    });

    const validateOrder = mockedApi.validate.mock.invocationCallOrder.at(-1) ?? 0;
    const saveOrder = mockedApi.save.mock.invocationCallOrder.at(-1) ?? 0;
    expect(validateOrder).toBeLessThan(saveOrder);

    await waitFor(() => {
      expect(getSaveSettingsButton()).toHaveAttribute("disabled");
    });
  });

  test("failed save preserves draft and dirty state", async () => {
    mockedApi.save.mockRejectedValueOnce(new Error("save failed"));

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    setIonInput("Destination folder input", "C:/Backups/StillDirty");
    clickButton(getSaveSettingsButton());

    await waitFor(() => {
      expect(mockedApi.save).toHaveBeenCalled();
      expect(screen.getByText("Automatic backup operation failed.")).toBeInTheDocument();
    });

    expect(mockedApi.validate).toHaveBeenCalledWith("C:/Backups/StillDirty");
    expect(getSaveSettingsButton()).not.toHaveAttribute("disabled");
  });

  test("toggle on validates and saves dirty drafts before enabling", async () => {
    mockedApi.read
      .mockResolvedValueOnce({ ...baseState })
      .mockResolvedValueOnce({ ...withEnabledState });

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    setIonInput("Destination folder input", "C:/Backups/EnablePath");
    setAutomaticBackupsToggle(true);

    await waitFor(() => {
      expect(mockedApi.enable).toHaveBeenCalledTimes(1);
    });

    const validateOrder = mockedApi.validate.mock.invocationCallOrder.at(-1) ?? 0;
    const saveOrder = mockedApi.save.mock.invocationCallOrder.at(-1) ?? 0;
    const enableOrder = mockedApi.enable.mock.invocationCallOrder.at(-1) ?? 0;
    expect(validateOrder).toBeGreaterThan(0);
    expect(validateOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(enableOrder);
  });

  test("toggle remains visually off until enable succeeds and failed enable leaves off", async () => {
    const deferredEnable = createDeferred<typeof withEnabledState>();
    mockedApi.read
      .mockResolvedValueOnce({ ...baseState })
      .mockResolvedValueOnce({ ...withEnabledState });
    mockedApi.enable.mockReturnValueOnce(deferredEnable.promise);

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(getStatusByText("Scheduler not installed")).toBeInTheDocument();
    });
    setAutomaticBackupsToggle(true);

    expect(getStatusByText("Scheduler not installed")).toBeInTheDocument();

    deferredEnable.resolve({ ...withEnabledState });
    await waitFor(() => {
      expect(getStatusByText("Scheduler installed")).toBeInTheDocument();
    });

    mockedApi.enable.mockRejectedValueOnce(new Error("enable failed"));
    setAutomaticBackupsToggle(false);
    await waitFor(() => {
      expect(mockedApi.disable).toHaveBeenCalled();
    });

    setAutomaticBackupsToggle(true);
    await waitFor(() => {
      expect(screen.getByText("Automatic backup operation failed.")).toBeInTheDocument();
      expect(getStatusByText("Scheduler not installed")).toBeInTheDocument();
    });
  });

  test("toggle off calls disable and preserves configuration", async () => {
    mockedApi.read
      .mockResolvedValueOnce({ ...withEnabledState })
      .mockResolvedValueOnce({
        ...baseState,
        configuration: {
          ...baseState.configuration,
          destinationDirectory: "C:/Backups",
          dailyLocalTime: "02:30",
          enabled: false,
        },
      });

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    setAutomaticBackupsToggle(false);

    await waitFor(() => {
      expect(mockedApi.disable).toHaveBeenCalledTimes(1);
      expect(mockedApi.save).not.toHaveBeenCalled();
      expect(getStatusByText("Scheduler not installed")).toBeInTheDocument();
    });

    expect(readIonInputValue("Destination folder input")).toBe("C:/Backups");
  });

  test("inline actions are positioned with related rows and controls disable during action refresh", async () => {
    const refreshDeferred = createDeferred<typeof baseState>();
    mockedApi.read
      .mockResolvedValueOnce({ ...baseState })
      .mockReturnValueOnce(refreshDeferred.promise);

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(getRunNowButton()).toBeInTheDocument();
      expect(getOpenFolderButton()).toBeInTheDocument();
      expect(getVerifyLatestButton()).toBeInTheDocument();
    });

    expect(getRunNowButton().closest("ion-item")?.textContent).toContain("Next scheduled run");
    expect(getOpenFolderButton().closest("ion-item")?.textContent).toContain("Last successful backup");
    expect(getVerifyLatestButton().closest("ion-item")?.textContent).toContain("Last verification result");

    clickButton(getRunNowButton());
    await waitFor(() => {
      expect(mockedApi.runNow).toHaveBeenCalledTimes(1);
      expect(getRunNowButton()).toHaveAttribute("disabled");
  const toggle = document.querySelector("ion-toggle[data-testid=automatic-backups-toggle]");
      expect(toggle).not.toBeNull();
      expectDisabled(toggle as HTMLElement);
      expectDisabled(getSaveSettingsButton());
    });

    refreshDeferred.resolve({ ...baseState });
    await waitFor(() => {
      expect(getRunNowButton()).not.toHaveAttribute("disabled");
      const toggle = document.querySelector("ion-toggle");
      expect(toggle).not.toBeNull();
      expect(toggle).not.toHaveAttribute("disabled");
    });
  });

  test("narrow-screen layout wrappers are present and wrap actions", async () => {
    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(screen.getByTestId("destination-editor-row")).toBeInTheDocument();
      expect(screen.getByTestId("next-scheduled-run-actions")).toBeInTheDocument();
      expect(screen.getByTestId("last-successful-backup-actions")).toBeInTheDocument();
      expect(screen.getByTestId("last-verification-actions")).toBeInTheDocument();
    });

    expect(screen.getByTestId("destination-editor-row").getAttribute("style") ?? "").toContain("flex-wrap");
    expect(screen.getByTestId("next-scheduled-run-actions").getAttribute("style") ?? "").toContain("flex-wrap");
    expect(screen.getByTestId("last-successful-backup-actions").getAttribute("style") ?? "").toContain("flex-wrap");
    expect(screen.getByTestId("last-verification-actions").getAttribute("style") ?? "").toContain("flex-wrap");
  });

  test("run verify open wording stays accurate and mismatch warning remains", async () => {
    mockedApi.read
      .mockResolvedValueOnce({
        ...baseState,
        warnings: ["configuration_scheduler_mismatch"],
      })
      .mockResolvedValue({
        ...baseState,
        warnings: ["configuration_scheduler_mismatch"],
      });

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Configuration and scheduler state are currently inconsistent.",
        ),
      ).toBeInTheDocument();
    });

    clickButton(getRunNowButton());
    await waitFor(() => {
      expect(mockedApi.runNow).toHaveBeenCalled();
    });

    expect(
      screen.getByText(
        "Backup verified locally and placed in the configured folder. OneDrive manages cloud synchronization.",
      ),
    ).toBeInTheDocument();

    clickButton(getVerifyLatestButton());
    await waitFor(() => {
      expect(mockedApi.verify).toHaveBeenCalled();
    });

    clickButton(getOpenFolderButton());
    await waitFor(() => {
      expect(mockedApi.openFolder).toHaveBeenCalled();
    });

    expect(screen.queryByText(/x-personal-finance-token/i)).toBeNull();
    expect(screen.queryByText(/Error:\s*\{/i)).toBeNull();
  });

  test("last run result surfaces native module mismatch safely", async () => {
    mockedApi.read.mockResolvedValueOnce({
      ...baseState,
      status: {
        ...baseState.status,
        lastResultCode:
          "The module '\\\\?\\C:\\dev\\personal-finance\\server\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127.",
      },
    });

    render(<SqliteAuthoritySettings />);
    await waitForBackupsReady();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Failed: Native SQLite module is incompatible with the scheduler Node runtime.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(/better_sqlite3\.node/i)).toBeNull();
  });
});

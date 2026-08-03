import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import RuntimeSettings from "./RuntimeSettings";

vi.mock("../api/automaticBackupsApi", () => ({
  readAutomaticBackupsState: vi.fn().mockResolvedValue({
    configuration: {
      enabled: true,
      destinationDirectory: "C:/Backups",
      dailyLocalTime: "04:30",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
    status: {},
    scheduler: { taskName: "PF Backup", platform: "win32", supported: true, installed: true },
    latestVerification: { available: true, verified: true },
    retentionPolicy: { dailyRetentionDays: 30, monthlyRetentionEnabled: true, summary: "retained" },
    warnings: [],
  }),
  browseAutomaticBackupDestination: vi.fn(),
  disableAutomaticBackups: vi.fn(),
  enableAutomaticBackups: vi.fn(),
  openAutomaticBackupFolder: vi.fn(),
  runAutomaticBackupNow: vi.fn(),
  saveAutomaticBackupSettings: vi.fn(),
  validateAutomaticBackupDestination: vi.fn(),
  verifyLatestAutomaticBackup: vi.fn(),
}));

describe("RuntimeSettings", () => {
  test("shows ordinary automatic backup settings without authority status", async () => {
    render(<RuntimeSettings />);
    await waitFor(() => expect(screen.getByText("Automatic Backups")).toBeInTheDocument());
    expect(screen.queryByText(/authority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/readiness/i)).not.toBeInTheDocument();
  });
});

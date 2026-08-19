import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import RuntimeSettings from "./RuntimeSettings";
import { readRestoreControlState } from "../api/restoreControlApi";

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

vi.mock("../api/restoreControlApi", () => ({
  readRestoreControlState: vi.fn().mockResolvedValue({
    candidates: [],
    excludedInvalidCount: 0,
  }),
  prepareRestoreCandidate: vi.fn(),
  armRestoreHandoff: vi.fn(),
  acceptRestoredState: vi.fn(),
}));

describe("RuntimeSettings", () => {
  test("shows ordinary automatic backup settings without authority status", async () => {
    render(<RuntimeSettings />);
    await waitFor(() => expect(screen.getByText("Automatic Backups")).toBeInTheDocument());
    expect(screen.getByText("Restore from Backup")).toBeInTheDocument();
    expect(screen.getByText("No backup is selected automatically.")).toBeInTheDocument();
    expect(screen.queryByText(/authority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/readiness/i)).not.toBeInTheDocument();
  });

  test("requires a passed rehearsal before showing typed live confirmation", async () => {
    const candidate = {
      candidateId: "a".repeat(64),
      basename: "personal-finance-daily-2026-08-19-120000.sqlite",
      classification: "daily" as const,
      createdAt: "2026-08-19T12:00:00.000Z",
      normalizedLocalDay: "2026-08-19",
      sqliteSizeBytes: 1024,
      schemaVersion: 7,
      sqliteSha256Short: "123456789abc",
      databaseFingerprintShort: "abcdef123456",
      verificationStatus: "pass" as const,
    };
    vi.mocked(readRestoreControlState).mockResolvedValueOnce({
      candidates: [candidate],
      excludedInvalidCount: 0,
      session: {
        statusVersion: 1,
        sessionId: "session-1",
        planId: "b".repeat(64),
        phase: "prepared",
        selected: candidate,
        preparedAt: "2026-08-19T12:01:00.000Z",
        updatedAt: "2026-08-19T12:01:00.000Z",
        lastAction: "restore",
        rehearsalStatus: "pass",
      },
    });
    render(<RuntimeSettings />);
    const continueButton = await screen.findByText("Continue to Restore Confirmation");
    expect(screen.queryByLabelText("Restore confirmation text")).not.toBeInTheDocument();
    await act(async () => {
      continueButton.click();
    });
    expect(await screen.findByLabelText("Restore confirmation text")).toBeInTheDocument();
    expect(
      screen.getByText(`RESTORE ${candidate.basename}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Restore and Restart").closest("ion-button"))
      .toHaveAttribute("disabled");
  });

  test("keeps the guarded rollback action available after acceptance", async () => {
    const candidate = {
      candidateId: "c".repeat(64),
      basename: "personal-finance-daily-2026-08-14-043003.sqlite",
      classification: "daily" as const,
      createdAt: "2026-08-14T01:30:03.158Z",
      normalizedLocalDay: "2026-08-14",
      sqliteSizeBytes: 1024,
      schemaVersion: 2,
      sqliteSha256Short: "123456789abc",
      databaseFingerprintShort: "abcdef123456",
      verificationStatus: "pass" as const,
    };
    vi.mocked(readRestoreControlState).mockResolvedValueOnce({
      candidates: [candidate],
      excludedInvalidCount: 0,
      session: {
        statusVersion: 1,
        sessionId: "accepted-session",
        planId: "d".repeat(64),
        phase: "accepted",
        selected: candidate,
        preparedAt: "2026-08-19T12:01:00.000Z",
        updatedAt: "2026-08-19T12:10:00.000Z",
        lastAction: "restore",
        rehearsalStatus: "pass",
        rollback: {
          basename: "personal-finance-pre-restore.sqlite",
          manifestBasename: "personal-finance-pre-restore.manifest.json",
          createdAt: "2026-08-19T12:05:00.000Z",
          verificationStatus: "pass",
          planId: "e".repeat(64),
        },
      },
    });
    render(<RuntimeSettings />);
    const rollbackButton = await screen.findByText("Roll Back to Previous State");
    await act(async () => {
      rollbackButton.click();
    });
    expect(await screen.findByLabelText("Restore confirmation text")).toBeInTheDocument();
    expect(screen.getByText("ROLL BACK personal-finance-pre-restore.sqlite"))
      .toBeInTheDocument();
  });
});

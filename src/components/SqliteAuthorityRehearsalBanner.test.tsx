import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  IonButton,
  IonButtons,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import {
  SqliteAuthorityToolbarStatus,
  default as SqliteAuthorityRehearsalBanner,
} from "./SqliteAuthorityRehearsalBanner";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";

vi.mock("../contexts/SqliteAuthorityRehearsalContext", () => ({
  useSqliteAuthorityRehearsal: vi.fn(),
}));

const mockedReadiness = vi.mocked(useSqliteAuthorityRehearsal);
const baseReadiness = {
  mode: "http-sqlite-authoritative" as const,
  selected: true,
  ready: true,
  checking: false,
  authoritativeMode: true,
  acknowledged: true,
  apiAvailable: true,
  missingRequirements: [],
  missingCapabilities: [],
  unsupportedOperations: [],
  transactionDeleteWritesAvailable: true,
  budgetLifecycleWritesAvailable: true,
  budgetDeleteWritesAvailable: true,
  recipientDeleteMergeWritesAvailable: true,
  accountDeleteMergeWritesAvailable: true,
  categoryDeleteMergeWritesAvailable: true,
  bucketDeleteMergeWritesAvailable: true,
  message: "ready",
  refresh: async () => undefined,
};

describe("SqliteAuthorityRehearsalBanner", () => {
  beforeEach(() => {
    mockedReadiness.mockReturnValue(baseReadiness);
  });

  test("renders healthy authority only in the toolbar status", () => {
    const banner = render(<SqliteAuthorityRehearsalBanner />);
    expect(banner.container).toBeEmptyDOMElement();

    render(<SqliteAuthorityToolbarStatus />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sqlite-authority-toolbar-status");
    expect(status).toHaveAttribute("slot", "end");
    expect(status).toHaveTextContent("SQLite authoritative");
  });

  test("keeps healthy rehearsal mode prominent", () => {
    mockedReadiness.mockReturnValue({
      ...baseReadiness,
      authoritativeMode: false,
    });
    render(<SqliteAuthorityRehearsalBanner />);

    const status = screen.getByRole("status");
    expect(status).toHaveClass("sqlite-authority-indicator-rehearsal");
    expect(status).toHaveTextContent("SQLite authority rehearsal is active");
    expect(render(<SqliteAuthorityToolbarStatus />).container).toBeEmptyDOMElement();
  });

  test("keeps blocked authority mode as an alert", () => {
    mockedReadiness.mockReturnValue({
      ...baseReadiness,
      ready: false,
      missingCapabilities: ["transactionBasicWrites"],
    });
    render(<SqliteAuthorityRehearsalBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("sqlite-authority-indicator-blocked");
    expect(alert).toHaveTextContent("failed verification");
    expect(alert).toHaveTextContent("transactionBasicWrites");
    expect(render(<SqliteAuthorityToolbarStatus />).container).toBeEmptyDOMElement();
  });

  test("renders nothing when Dexie is selected", () => {
    mockedReadiness.mockReturnValue({
      ...baseReadiness,
      selected: false,
    });
    const { container } = render(<SqliteAuthorityRehearsalBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  test("reserves separate Budget toolbar slots for status and history", () => {
    const { container } = render(
      <IonToolbar>
        <IonTitle>Budget</IonTitle>
        <SqliteAuthorityToolbarStatus />
        <IonButtons slot="end">
          <IonButton aria-label="Budget History">History</IonButton>
        </IonButtons>
      </IonToolbar>,
    );

    const status = screen.getByRole("status");
    const history = container.querySelector(
      'ion-button[aria-label="Budget History"]',
    );
    expect(history).not.toBeNull();
    expect(status).toHaveAttribute("slot", "end");
    expect(history?.closest("ion-buttons")).toHaveAttribute("slot", "end");
    expect(status.closest("ion-buttons")).toBeNull();
    expect(status.parentElement).toBe(history?.closest("ion-toolbar"));
  });
});

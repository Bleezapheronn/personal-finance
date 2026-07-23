import React from "react";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";

export interface SqliteAuthorityIndicatorState {
  selected: boolean;
  ready: boolean;
  authoritativeMode: boolean;
}

export const sqliteAuthorityIndicatorClassName = (
  state: SqliteAuthorityIndicatorState,
): string => {
  return `sqlite-authority-indicator ${
    state.ready
      ? "sqlite-authority-indicator-rehearsal"
      : "sqlite-authority-indicator-blocked"
  }`;
};

const SqliteAuthorityRehearsalBanner: React.FC = () => {
  const readiness = useSqliteAuthorityRehearsal();

  if (
    !readiness.selected ||
    (readiness.ready && readiness.authoritativeMode)
  ) {
    return null;
  }

  const missing = [
    ...readiness.missingRequirements,
    ...readiness.missingCapabilities,
  ];
  const activeTitle = readiness.authoritativeMode
    ? "SQLite authoritative mode is active."
    : "SQLite authority rehearsal is active.";
  const blockedTitle = readiness.authoritativeMode
    ? "SQLite authoritative mode failed verification."
    : "SQLite authority rehearsal is not ready.";
  const activeMessage = readiness.authoritativeMode
    ? " Reads and supported writes use the verified local SQLite database. Dexie is retained only as a rollback source and is not being changed."
    : " Supported reads and writes use disposable local SQLite only. Dexie is not being changed. Unsupported operations remain disabled. Return to Dexie mode and restart the app to roll back.";
  const blockedMessage = readiness.authoritativeMode
    ? " Writes are disabled. Restore the verified backup or return to Dexie mode."
    : " Writes are disabled because required local API capabilities are missing or unavailable.";
  return (
    <div
      className={sqliteAuthorityIndicatorClassName(readiness)}
      role={readiness.ready ? "status" : "alert"}
    >
      <strong>{readiness.ready ? activeTitle : blockedTitle}</strong>{" "}
      {readiness.ready ? activeMessage : blockedMessage}
      {readiness.checking && " Checking local API capabilities."}
      {missing.length > 0 && (
        <span className="sqlite-authority-indicator-missing">
          Missing: {missing.join(", ")}.
        </span>
      )}
    </div>
  );
};

export const SqliteAuthorityToolbarStatus: React.FC = () => {
  const readiness = useSqliteAuthorityRehearsal();

  if (
    !readiness.selected ||
    !readiness.ready ||
    !readiness.authoritativeMode
  ) {
    return null;
  }

  return (
    <span
      className="sqlite-authority-toolbar-status"
      slot="end"
      role="status"
      aria-label="SQLite authoritative mode is active"
    >
      <span>SQLite</span>
      <span className="sqlite-authority-toolbar-status-detail">
        {" "}authoritative
      </span>
    </span>
  );
};

export default SqliteAuthorityRehearsalBanner;

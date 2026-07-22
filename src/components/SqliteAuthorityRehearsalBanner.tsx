import React from "react";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";

const SqliteAuthorityRehearsalBanner: React.FC = () => {
  const readiness = useSqliteAuthorityRehearsal();

  if (!readiness.selected) {
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
      className={`sqlite-rehearsal-banner ${
        readiness.ready ? "sqlite-rehearsal-banner-ready" : "sqlite-rehearsal-banner-blocked"
      }`}
      role={readiness.ready ? "status" : "alert"}
    >
      <strong>
        {readiness.ready
          ? activeTitle
          : blockedTitle}
      </strong>{" "}
      {readiness.ready ? activeMessage : blockedMessage}
      {readiness.checking && " Checking local API capabilities."}
      {missing.length > 0 && (
        <span className="sqlite-rehearsal-banner-missing">
          Missing: {missing.join(", ")}.
        </span>
      )}
    </div>
  );
};

export default SqliteAuthorityRehearsalBanner;

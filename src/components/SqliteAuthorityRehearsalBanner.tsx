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

  return (
    <div
      className={`sqlite-rehearsal-banner ${
        readiness.ready ? "sqlite-rehearsal-banner-ready" : "sqlite-rehearsal-banner-blocked"
      }`}
      role={readiness.ready ? "status" : "alert"}
    >
      <strong>
        {readiness.ready
          ? "SQLite authority rehearsal is active."
          : "SQLite authority rehearsal is not ready."}
      </strong>{" "}
      {readiness.ready
        ? "Supported reads and writes use disposable local SQLite only. Dexie is not being changed. Unsupported operations remain disabled. Return to Dexie mode and restart the app to roll back."
        : "Writes are disabled because required local API capabilities are missing or unavailable."}
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

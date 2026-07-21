import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getInitialSqliteAuthorityRehearsalReadiness,
  loadSqliteAuthorityRehearsalReadiness,
  type SqliteAuthorityRehearsalReadiness,
} from "../repositories/sqliteAuthorityRehearsal";

interface SqliteAuthorityRehearsalContextValue
  extends SqliteAuthorityRehearsalReadiness {
  refresh: () => Promise<void>;
}

const initial = getInitialSqliteAuthorityRehearsalReadiness();

const SqliteAuthorityRehearsalContext =
  createContext<SqliteAuthorityRehearsalContextValue>({
    ...initial,
    refresh: async () => undefined,
  });

export const SqliteAuthorityRehearsalProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [readiness, setReadiness] =
    useState<SqliteAuthorityRehearsalReadiness>(initial);

  const refresh = async () => {
    const next = await loadSqliteAuthorityRehearsalReadiness();
    setReadiness(next);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(
    () => ({ ...readiness, refresh }),
    [readiness],
  );

  return (
    <SqliteAuthorityRehearsalContext.Provider value={value}>
      {children}
    </SqliteAuthorityRehearsalContext.Provider>
  );
};

export const useSqliteAuthorityRehearsal =
  (): SqliteAuthorityRehearsalContextValue =>
    useContext(SqliteAuthorityRehearsalContext);

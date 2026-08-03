import React, { createContext, useContext } from "react";

interface LocalSqliteRuntime {
  selected: boolean;
  ready: true;
  authoritativeMode: true;
  budgetLifecycleWritesAvailable: true;
  budgetSnapshotOccurrenceWritesAvailable: true;
  budgetDeleteWritesAvailable: true;
  transactionDeleteWritesAvailable: true;
  accountDeleteMergeWritesAvailable: true;
  categoryDeleteMergeWritesAvailable: true;
  bucketDeleteMergeWritesAvailable: true;
  recipientDeleteMergeWritesAvailable: true;
  lookupActiveStateWritesAvailable: true;
  bucketReorderWritesAvailable: true;
}

const localSqliteRuntime: LocalSqliteRuntime = {
  selected: true,
  ready: true,
  authoritativeMode: true,
  budgetLifecycleWritesAvailable: true,
  budgetSnapshotOccurrenceWritesAvailable: true,
  budgetDeleteWritesAvailable: true,
  transactionDeleteWritesAvailable: true,
  accountDeleteMergeWritesAvailable: true,
  categoryDeleteMergeWritesAvailable: true,
  bucketDeleteMergeWritesAvailable: true,
  recipientDeleteMergeWritesAvailable: true,
  lookupActiveStateWritesAvailable: true,
  bucketReorderWritesAvailable: true,
};

const LocalSqliteRuntimeContext = createContext(localSqliteRuntime);

export const LocalSqliteRuntimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LocalSqliteRuntimeContext.Provider value={localSqliteRuntime}>
    {children}
  </LocalSqliteRuntimeContext.Provider>
);

export const useLocalSqliteRuntime = (): LocalSqliteRuntime =>
  useContext(LocalSqliteRuntimeContext);

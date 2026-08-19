import { localApiGet, localApiPost } from "./localApiClient";

export interface RestoreCandidateSummary {
  candidateId: string;
  basename: string;
  classification: "daily" | "monthly";
  createdAt: string;
  normalizedLocalDay: string;
  sqliteSizeBytes: number;
  schemaVersion: number;
  sqliteSha256Short: string;
  databaseFingerprintShort: string;
  verificationStatus: "pass";
}

export type RestoreSessionPhase =
  | "prepared"
  | "handoff-armed"
  | "restarting"
  | "awaiting-verification"
  | "rolled-back"
  | "failed-before-replacement"
  | "recovery-required"
  | "accepted";

export interface RestoreSessionStatus {
  statusVersion: 1;
  sessionId: string;
  planId: string;
  phase: RestoreSessionPhase;
  selected: RestoreCandidateSummary;
  preparedAt: string;
  updatedAt: string;
  lastAction: "restore" | "rollback";
  rehearsalStatus: "pass";
  rollback?: {
    basename: string;
    manifestBasename: string;
    createdAt: string;
    verificationStatus: "pass";
    planId: string;
  };
  resultCode?: string;
}

export interface RestoreControlState {
  candidates: RestoreCandidateSummary[];
  excludedInvalidCount: number;
  session?: RestoreSessionStatus;
}

export const readRestoreControlState = async (): Promise<RestoreControlState> => {
  const response = await localApiGet<{ ok: true; state: RestoreControlState }>(
    "/prototype/settings/restore/state",
  );
  return response.state;
};

export const prepareRestoreCandidate = async (
  candidateId: string,
): Promise<RestoreSessionStatus> => {
  const response = await localApiPost<{ ok: true; session: RestoreSessionStatus }>(
    "/prototype/settings/restore/prepare",
    { candidateId },
  );
  return response.session;
};

export const armRestoreHandoff = async (input: {
  action: "restore" | "rollback";
  sessionId: string;
  planId: string;
  confirmationText: string;
}): Promise<RestoreSessionStatus> => {
  const response = await localApiPost<{ ok: true; session: RestoreSessionStatus }>(
    "/prototype/settings/restore/arm",
    input,
  );
  return response.session;
};

export const acceptRestoredState = async (
  sessionId: string,
): Promise<RestoreSessionStatus> => {
  const response = await localApiPost<{ ok: true; session: RestoreSessionStatus }>(
    "/prototype/settings/restore/accept",
    { sessionId },
  );
  return response.session;
};

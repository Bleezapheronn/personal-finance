import React, { useEffect, useRef, useState } from "react";
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonPage,
  IonInput,
  IonItem,
  IonText,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonSpinner,
  IonList,
  IonLabel,
  IonNote,
  IonToggle,
  IonRadio,
  IonRadioGroup,
} from "@ionic/react";
import {
  browseAutomaticBackupDestination,
  disableAutomaticBackups,
  enableAutomaticBackups,
  openAutomaticBackupFolder,
  readAutomaticBackupsState,
  runAutomaticBackupNow,
  saveAutomaticBackupSettings,
  validateAutomaticBackupDestination,
  verifyLatestAutomaticBackup,
  type AutomaticBackupsState,
} from "../api/automaticBackupsApi";
import { LocalApiError } from "../api/localApiClient";
import {
  acceptRestoredState,
  armRestoreHandoff,
  prepareRestoreCandidate,
  readRestoreControlState,
  type RestoreCandidateSummary,
  type RestoreControlState,
} from "../api/restoreControlApi";

const BACKUP_SUCCESS_WORDING =
  "Backup verified locally and placed in the configured folder. OneDrive manages cloud synchronization.";

const friendlyError = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    switch (error.code) {
      case "backup_run_in_progress":
        return "A backup is already running.";
      case "folder_picker_no_interactive_desktop":
        return "Folder selection requires an interactive Windows desktop session.";
      case "folder_picker_timeout":
        return "Folder selection timed out. Try again.";
      case "folder_picker_process_failed":
        return "Windows folder selection could not be opened.";
      case "folder_picker_noninteractive":
        return "Folder selection requires an interactive Windows desktop session.";
      case "backup_directory_missing":
        return "The selected folder does not exist.";
      case "backup_directory_unwritable":
        return "The selected folder is not writable.";
      case "scheduler_install_confirmation_failed":
        return "Scheduler install did not confirm successfully.";
      case "scheduler_remove_confirmation_failed":
        return "Scheduler removal did not confirm successfully.";
      default:
        return "Automatic backup operation failed.";
    }
  }
  return "Automatic backup operation failed.";
};

const dateText = (value?: string): string =>
  value ? new Date(value).toLocaleString() : "Not available";

const backupResultText = (code?: string): string => {
  if (!code) return "Not available";
  if (code === "pass") return "Pass";
  if (code === "running") return "Running";
  if (
    code.includes("compiled against a different Node.js version") ||
    code.includes("NODE_MODULE_VERSION")
  ) {
    return "Failed: Native SQLite module is incompatible with the scheduler Node runtime.";
  }
  const summary = code.trim();
  if (!summary) return "Failed";
  return `Failed: ${summary.slice(0, 140)}${summary.length > 140 ? "..." : ""}`;
};

const backupResultColor = (code?: string): "success" | "warning" | "danger" | "medium" => {
  if (!code) return "medium";
  if (code === "pass") return "success";
  if (code === "running") return "warning";
  return "danger";
};

const friendlyRestoreError = (error: unknown): string => {
  if (error instanceof LocalApiError) {
    switch (error.code) {
      case "restore_candidate_not_found":
      case "restore_candidate_changed":
      case "restore_plan_stale":
        return "The selected backup changed. Refresh and rehearse it again.";
      case "restore_handoff_pending":
        return "A restore handoff is already pending.";
      case "restore_confirmation_invalid":
      case "restore_rollback_confirmation_invalid":
        return "The confirmation text does not exactly match.";
      case "restore_live_sidecar_present":
        return "Restore stopped because a SQLite sidecar requires separate investigation.";
      default:
        return "Restore operation failed safely before approval could continue.";
    }
  }
  return "Restore operation failed safely before approval could continue.";
};

const sizeText = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const restorePhaseText = (phase: string): string => {
  switch (phase) {
    case "prepared": return "Rehearsal passed — ready for confirmation";
    case "handoff-armed": return "Restore handoff armed";
    case "restarting": return "Restore applied — runtime restarting";
    case "awaiting-verification": return "Awaiting verification — rollback retained";
    case "rolled-back": return "Previous state restored — rollback verified";
    case "failed-before-replacement": return "Stopped safely before live replacement";
    case "recovery-required": return "Restore state requires technical recovery; do not retry";
    case "accepted": return "Accepted — rollback retained";
    default: return phase;
  }
};

const styledRowEnd: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "0.5rem",
  flexWrap: "wrap",
  textAlign: "right",
};

const editorRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  flexWrap: "wrap",
};

const inputStyle: React.CSSProperties = {
  flex: "1 1 20rem",
  minWidth: "14rem",
};

const RuntimeSettings: React.FC = () => {
  const [state, setState] = useState<AutomaticBackupsState | null>(null);
  const [destinationDirectoryDraft, setDestinationDirectoryDraft] = useState("");
  const [dailyLocalTime, setDailyLocalTime] = useState("02:30");
  const [refreshingState, setRefreshingState] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [activityErrorMessage, setActivityErrorMessage] = useState<string | null>(null);
  const [pageSaveMessage, setPageSaveMessage] = useState<string | null>(null);
  const [pageSaveErrorMessage, setPageSaveErrorMessage] = useState<string | null>(null);
  const [destinationValidationMessage, setDestinationValidationMessage] = useState<string | null>(null);
  const [destinationValidationError, setDestinationValidationError] = useState<string | null>(null);
  const destinationInputRef = useRef<HTMLIonInputElement | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreControlState | null>(null);
  const [selectedRestoreCandidateId, setSelectedRestoreCandidateId] = useState("");
  const [restoreBusyAction, setRestoreBusyAction] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreErrorMessage, setRestoreErrorMessage] = useState<string | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<"restore" | "rollback" | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const busy = busyAction !== null || refreshingState;

  const backupSettingsDirty = state
    ? destinationDirectoryDraft !== state.configuration.destinationDirectory
      || dailyLocalTime !== state.configuration.dailyLocalTime
    : false;
  const pageDirtySections = {
    automaticBackups: backupSettingsDirty,
  };
  const pageDirty = Object.values(pageDirtySections).some(Boolean);
  const toggleStatusText = state
    ? `${state.configuration.enabled ? "Enabled" : "Disabled"} · ${state.scheduler.installed ? "Scheduler installed" : "Scheduler not installed"}`
    : "Not available";

  const focusDestinationField = () => {
    const field = destinationInputRef.current;
    if (!field) return;
    if (typeof field.scrollIntoView === "function") {
      field.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (typeof field.setFocus === "function") {
      void field.setFocus();
    }
  };

  const resetActivityNotices = () => {
    setActivityMessage(null);
    setActivityErrorMessage(null);
  };

  const resetPageSaveNotices = () => {
    setPageSaveMessage(null);
    setPageSaveErrorMessage(null);
  };

  const refreshBackups = async (updateDraft = true) => {
    setRefreshingState(true);
    setActivityErrorMessage(null);
    try {
      const latest = await readAutomaticBackupsState();
      setState(latest);
      if (updateDraft) setDestinationDirectoryDraft(latest.configuration.destinationDirectory);
      setDailyLocalTime(latest.configuration.dailyLocalTime);
    } catch (error) {
      setState(null);
      setActivityErrorMessage(friendlyError(error));
      throw error;
    } finally {
      setRefreshingState(false);
    }
  };

  useEffect(() => {
    void refreshBackups().catch(() => undefined);
    void refreshRestoreState().catch(() => undefined);
  }, []);

  const refreshRestoreState = async () => {
    setRestoreBusyAction((current) => current ?? "refresh");
    setRestoreErrorMessage(null);
    try {
      setRestoreState(await readRestoreControlState());
    } catch (error) {
      setRestoreState(null);
      setRestoreErrorMessage(friendlyRestoreError(error));
      throw error;
    } finally {
      setRestoreBusyAction((current) => current === "refresh" ? null : current);
    }
  };

  const selectedRestoreCandidate: RestoreCandidateSummary | undefined =
    restoreState?.candidates.find(
      (candidate) => candidate.candidateId === selectedRestoreCandidateId,
    );
  const requiredConfirmationText = confirmationAction && restoreState?.session
    ? confirmationAction === "restore"
      ? `RESTORE ${restoreState.session.selected.basename}`
      : `ROLL BACK ${restoreState.session.rollback?.basename ?? ""}`
    : "";

  const onPrepareRestore = async () => {
    if (!selectedRestoreCandidate || restoreBusyAction) return;
    setRestoreBusyAction("prepare");
    setRestoreMessage(null);
    setRestoreErrorMessage(null);
    setConfirmationAction(null);
    setConfirmationText("");
    try {
      const session = await prepareRestoreCandidate(selectedRestoreCandidate.candidateId);
      setRestoreState((current) => current ? { ...current, session } : current);
      setRestoreMessage("Backup verification and disposable restore rehearsal passed.");
    } catch (error) {
      setRestoreErrorMessage(friendlyRestoreError(error));
    } finally {
      setRestoreBusyAction(null);
    }
  };

  const onArmRestore = async (action: "restore" | "rollback") => {
    const session = restoreState?.session;
    if (!session || restoreBusyAction) return;
    const planId = action === "restore" ? session.planId : session.rollback?.planId;
    if (!planId) return;
    setRestoreBusyAction(`arm-${action}`);
    setRestoreMessage(null);
    setRestoreErrorMessage(null);
    try {
      const armed = await armRestoreHandoff({
        action,
        sessionId: session.sessionId,
        planId,
        confirmationText,
      });
      setRestoreState((current) => current ? { ...current, session: armed } : current);
      setRestoreMessage(
        "Handoff armed. Keep the owner terminal open. Personal Finance will stop and restart; refresh this page after the terminal reports completion.",
      );
      setConfirmationAction(null);
      setConfirmationText("");
    } catch (error) {
      setRestoreErrorMessage(friendlyRestoreError(error));
    } finally {
      setRestoreBusyAction(null);
    }
  };

  const onAcceptRestore = async () => {
    const session = restoreState?.session;
    if (!session || restoreBusyAction) return;
    setRestoreBusyAction("accept");
    setRestoreErrorMessage(null);
    try {
      const accepted = await acceptRestoredState(session.sessionId);
      setRestoreState((current) => current ? { ...current, session: accepted } : current);
      setRestoreMessage("Restored state accepted. The verified rollback remains retained.");
    } catch (error) {
      setRestoreErrorMessage(friendlyRestoreError(error));
    } finally {
      setRestoreBusyAction(null);
    }
  };

  const validateDestinationDraft = async (
    draft = destinationDirectoryDraft,
    updateDraft = true,
  ): Promise<boolean> => {
    setDestinationValidationMessage(null);
    setDestinationValidationError(null);
    try {
      const validation = await validateAutomaticBackupDestination(draft);
      if (updateDraft) setDestinationDirectoryDraft(validation.destinationDirectory);
      if (validation.valid) {
        setDestinationValidationMessage("Destination validated.");
        return true;
      }
      setDestinationValidationError("Destination validation failed. Select a different folder.");
      focusDestinationField();
      return false;
    } catch (error) {
      setDestinationValidationError(friendlyError(error));
      focusDestinationField();
      return false;
    }
  };

  const saveDraftConfiguration = async (): Promise<boolean> => {
    const valid = await validateDestinationDraft(destinationDirectoryDraft, false);
    if (!valid) {
      setPageSaveErrorMessage("Save failed. Fix destination validation and try again.");
      return false;
    }
    try {
      await saveAutomaticBackupSettings(destinationDirectoryDraft, dailyLocalTime);
      setPageSaveMessage("Configuration saved.");
      return true;
    } catch (error) {
      setPageSaveErrorMessage(friendlyError(error));
      return false;
    }
  };

  const runAction = async (name: string, action: () => Promise<void>, refresh = true, updateDraft = true) => {
    if (busy) return;
    setBusyAction(name);
    resetActivityNotices();
    try {
      await action();
      if (refresh) await refreshBackups(updateDraft);
    } catch (error) {
      setActivityErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const onBrowse = async () => {
    await runAction("browse", async () => {
      const result = await browseAutomaticBackupDestination();
      if (result.cancelled) {
        setActivityMessage("Folder selection cancelled.");
        return;
      }
      if (result.destinationDirectory) {
        setDestinationDirectoryDraft(result.destinationDirectory);
        const valid = await validateDestinationDraft(result.destinationDirectory);
        if (valid) {
          setActivityMessage("Folder selected. Save Settings to persist this configuration.");
        }
      }
    }, false);
  };

  const onSaveSettings = async () => {
    if (busy || !pageDirty) return;
    setBusyAction("save-settings");
    resetPageSaveNotices();
    resetActivityNotices();
    try {
      const saved = await saveDraftConfiguration();
      if (!saved) return;
      await refreshBackups(true);
    } catch (error) {
      setPageSaveErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const onEnable = async () => {
    if (!state || busy) return;
    setBusyAction("enable");
    resetActivityNotices();
    resetPageSaveNotices();
    try {
      if (backupSettingsDirty) {
        const saved = await saveDraftConfiguration();
        if (!saved) return;
      }
      await enableAutomaticBackups();
      await refreshBackups(true);
      setActivityMessage("Automatic backups enabled after scheduler confirmation.");
    } catch (error) {
      setActivityErrorMessage(friendlyError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const onDisable = async () => {
    if (!state || busy) return;
    await runAction("disable", async () => {
      await disableAutomaticBackups();
      setActivityMessage("Automatic backups disabled after scheduler confirmation.");
    });
  };

  const onToggleAutomaticBackups = async (
    event: CustomEvent<{ checked: boolean }>,
  ) => {
    if (!state || busy) return;
    const requestedState = Boolean(event.detail.checked);
    if (requestedState === state.configuration.enabled) return;
    if (requestedState) {
      await onEnable();
      return;
    }
    await onDisable();
  };

  const onRunNow = async () => {
    await runAction("run-now", async () => {
      await runAutomaticBackupNow();
      setActivityMessage(BACKUP_SUCCESS_WORDING);
    });
  };

  const onVerifyLatest = async () => {
    await runAction("verify", async () => {
      const verification = await verifyLatestAutomaticBackup();
      if (!verification.available) {
        setActivityMessage("No backup is available to verify yet.");
        return;
      }
      setActivityMessage(
        verification.verified
          ? BACKUP_SUCCESS_WORDING
          : "Latest backup verification reported an invalid result.",
      );
    });
  };

  const onOpenFolder = async () => {
    await runAction("open-folder", async () => {
      await openAutomaticBackupFolder();
      setActivityMessage("Opened the configured backup folder.");
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Settings & Status</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>Automatic Backups</IonCardHeader>
          <IonCardContent>
            {!state ? (
              <IonText>
                {activityErrorMessage ? (
                  <>
                    <p>{activityErrorMessage}</p>
                    <IonButton onClick={() => void refreshBackups().catch(() => undefined)}>
                      Retry
                    </IonButton>
                  </>
                ) : (
                  <p><IonSpinner name="dots" /> Loading backup status...</p>
                )}
              </IonText>
            ) : (
              <>
                <IonList lines="full">
                  <IonItem>
                    <IonLabel>
                      <h3>Automatic backups</h3>
                      <p>{toggleStatusText}</p>
                    </IonLabel>
                    <div slot="end" style={styledRowEnd}>
                      {(busyAction === "enable" || busyAction === "disable") && (
                        <IonSpinner name="crescent" aria-label="Updating automatic backups" />
                      )}
                      <IonToggle
                        data-testid="automatic-backups-toggle"
                        aria-label="Automatic backups toggle"
                        checked={state.configuration.enabled}
                        disabled={busy}
                        onIonChange={(event) => {
                          void onToggleAutomaticBackups(
                            event as CustomEvent<{ checked: boolean }>,
                          );
                        }}
                      />
                    </div>
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Destination folder</IonLabel>
                    <div style={editorRowStyle} data-testid="destination-editor-row">
                      <IonInput
                        data-testid="destination-input"
                        ref={destinationInputRef}
                        aria-label="Destination folder input"
                        style={inputStyle}
                        value={destinationDirectoryDraft}
                        onIonInput={(event) => {
                          setDestinationValidationMessage(null);
                          setDestinationValidationError(null);
                          resetActivityNotices();
                          resetPageSaveNotices();
                          setDestinationDirectoryDraft(String(event.detail.value ?? ""));
                        }}
                        disabled={busy}
                      />
                      <IonButton
                        aria-label="Browse destination folder"
                        onClick={() => void onBrowse()}
                        disabled={busy}
                      >
                        {busyAction === "browse" ? (
                          <>
                            <IonSpinner name="crescent" />
                            Browsing...
                          </>
                        ) : (
                          "Browse"
                        )}
                      </IonButton>
                    </div>
                  </IonItem>
                  {destinationValidationMessage && (
                    <IonText color="success">
                      <p>{destinationValidationMessage}</p>
                    </IonText>
                  )}
                  {destinationValidationError && (
                    <IonText color="danger">
                      <p>{destinationValidationError}</p>
                    </IonText>
                  )}
                  <IonItem>
                    <IonLabel position="stacked">Daily backup time</IonLabel>
                    <IonInput
                      aria-label="Daily backup time"
                      type="time"
                      value={dailyLocalTime}
                      onIonInput={(event) => {
                        resetActivityNotices();
                        resetPageSaveNotices();
                        setDailyLocalTime(String(event.detail.value ?? ""));
                      }}
                      disabled={busy}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel>Next scheduled run</IonLabel>
                    <div
                      slot="end"
                      style={styledRowEnd}
                      data-testid="next-scheduled-run-actions"
                    >
                      <IonNote>{dateText(state.status.nextScheduledLocalTime)}</IonNote>
                      <IonButton
                        aria-label="Run backup now"
                        size="small"
                        onClick={() => void onRunNow()}
                        disabled={busy}
                      >
                        {busyAction === "run-now" ? (
                          <>
                            <IonSpinner name="crescent" />
                            Running...
                          </>
                        ) : (
                          "Run Now"
                        )}
                      </IonButton>
                    </div>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Last attempted run</IonLabel>
                    <IonNote slot="end">
                      {dateText(state.status.lastAttemptedAt)}
                    </IonNote>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Last run result</IonLabel>
                    <IonText color={backupResultColor(state.status.lastResultCode)} slot="end">
                      {backupResultText(state.status.lastResultCode)}
                    </IonText>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Last successful backup</IonLabel>
                    <div
                      slot="end"
                      style={styledRowEnd}
                      data-testid="last-successful-backup-actions"
                    >
                      <IonNote>
                        {state.latestSuccessfulBackup
                          ? `${state.latestSuccessfulBackup.basename} (${dateText(state.latestSuccessfulBackup.createdAt)})`
                          : "Not available"}
                      </IonNote>
                      <IonButton
                        aria-label="Open backup folder"
                        size="small"
                        onClick={() => void onOpenFolder()}
                        disabled={busy}
                      >
                        {busyAction === "open-folder" ? (
                          <>
                            <IonSpinner name="crescent" />
                            Opening...
                          </>
                        ) : (
                          "Open Folder"
                        )}
                      </IonButton>
                    </div>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Last verification result</IonLabel>
                    <div
                      slot="end"
                      style={styledRowEnd}
                      data-testid="last-verification-actions"
                    >
                      <IonText
                        color={
                          state.latestVerification.available
                            ? state.latestVerification.verified
                              ? "success"
                              : "danger"
                            : "medium"
                        }
                      >
                        {state.latestVerification.available
                          ? state.latestVerification.verified
                            ? "Pass"
                            : "Failed"
                          : "Not available"}
                      </IonText>
                      <IonButton
                        aria-label="Verify latest backup"
                        size="small"
                        onClick={() => void onVerifyLatest()}
                        disabled={busy}
                      >
                        {busyAction === "verify" ? (
                          <>
                            <IonSpinner name="crescent" />
                            Verifying...
                          </>
                        ) : (
                          "Verify Latest"
                        )}
                      </IonButton>
                    </div>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Retention policy</IonLabel>
                    <IonNote slot="end">
                      {state.retentionPolicy.summary}
                    </IonNote>
                  </IonItem>
                </IonList>

                {state.warnings.includes(
                  "configuration_scheduler_mismatch",
                ) && (
                  <IonText color="warning">
                    <p>
                      Configuration and scheduler state are currently
                      inconsistent.
                    </p>
                  </IonText>
                )}

                {activityMessage && (
                  <IonText color="success">
                    <p>{activityMessage}</p>
                  </IonText>
                )}
                {activityErrorMessage && (
                  <IonText color="danger">
                    <p>{activityErrorMessage}</p>
                  </IonText>
                )}
              </>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard data-testid="restore-from-backup-card">
          <IonCardHeader>Restore from Backup</IonCardHeader>
          <IonCardContent>
            <IonText color="warning">
              <p>
                Restore replaces the current Personal Finance database only after a
                verified disposable rehearsal, explicit confirmation, and creation of
                a verified rollback.
              </p>
            </IonText>

            {!restoreState ? (
              <IonText>
                <p>
                  {restoreErrorMessage ?? "Loading verified restore candidates..."}
                </p>
                <IonButton
                  size="small"
                  onClick={() => void refreshRestoreState().catch(() => undefined)}
                  disabled={restoreBusyAction !== null}
                >
                  Retry
                </IonButton>
              </IonText>
            ) : (
              <>
                {restoreState.session && (
                  <IonItem lines="full" data-testid="restore-session-status">
                    <IonLabel>
                      <h3>Restore status</h3>
                      <p>{restorePhaseText(restoreState.session.phase)}</p>
                      <p>{restoreState.session.selected.basename}</p>
                    </IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      fill="outline"
                      onClick={() => void refreshRestoreState().catch(() => undefined)}
                      disabled={restoreBusyAction !== null}
                    >
                      Refresh
                    </IonButton>
                  </IonItem>
                )}

                <IonList lines="full">
                  <IonItem>
                    <IonLabel>
                      <h3>Choose a verified backup</h3>
                      <p>No backup is selected automatically.</p>
                    </IonLabel>
                  </IonItem>
                  {restoreState.candidates.length === 0 ? (
                    <IonItem>
                      <IonLabel>No verified scheduled backups are available.</IonLabel>
                    </IonItem>
                  ) : (
                    <IonRadioGroup
                      value={selectedRestoreCandidateId}
                      onIonChange={(event) => {
                        setSelectedRestoreCandidateId(String(event.detail.value ?? ""));
                        setRestoreMessage(null);
                        setRestoreErrorMessage(null);
                        setConfirmationAction(null);
                        setConfirmationText("");
                      }}
                    >
                      {restoreState.candidates.map((candidate) => (
                        <IonItem key={candidate.candidateId}>
                          <IonRadio
                            slot="start"
                            value={candidate.candidateId}
                            aria-label={`Select ${candidate.basename}`}
                          />
                          <IonLabel>
                            <h3>{candidate.basename}</h3>
                            <p>
                              {candidate.classification === "daily" ? "Daily" : "Monthly"}
                              {" · "}{dateText(candidate.createdAt)}
                              {" · "}{sizeText(candidate.sqliteSizeBytes)}
                            </p>
                            <p>
                              Backup date {candidate.normalizedLocalDay}
                              {" · schema "}{candidate.schemaVersion}
                              {" · SHA "}{candidate.sqliteSha256Short}
                              {" · DB "}{candidate.databaseFingerprintShort}
                            </p>
                          </IonLabel>
                          <IonText color="success" slot="end">Verified</IonText>
                        </IonItem>
                      ))}
                    </IonRadioGroup>
                  )}
                </IonList>

                {restoreState.excludedInvalidCount > 0 && (
                  <IonText color="warning">
                    <p>
                      {restoreState.excludedInvalidCount} invalid or incomplete backup
                      pair{restoreState.excludedInvalidCount === 1 ? " was" : "s were"}
                      {" "}excluded from selection.
                    </p>
                  </IonText>
                )}

                {selectedRestoreCandidate && (
                  <div data-testid="selected-restore-review" style={{ marginTop: "1rem" }}>
                    <IonText>
                      <h3>Selected backup</h3>
                      <p><strong>{selectedRestoreCandidate.basename}</strong></p>
                      <p>
                        Created {dateText(selectedRestoreCandidate.createdAt)}; normalized
                        backup date {selectedRestoreCandidate.normalizedLocalDay}. Current
                        manifest, checksum, logical verification, and disposable restore
                        must all pass before cutover can be confirmed.
                      </p>
                    </IonText>
                    <IonButton
                      expand="block"
                      onClick={() => void onPrepareRestore()}
                      disabled={restoreBusyAction !== null}
                    >
                      {restoreBusyAction === "prepare" ? (
                        <><IonSpinner name="crescent" /> Verifying and rehearsing...</>
                      ) : (
                        "Verify and Rehearse"
                      )}
                    </IonButton>
                  </div>
                )}

                {restoreState.session?.phase === "prepared" && (
                  <div data-testid="restore-rehearsal-pass" style={{ marginTop: "1rem" }}>
                    <IonText color="success">
                      <p>
                        Rehearsal PASS for {restoreState.session.selected.basename}. No live
                        data has been replaced. Plan {restoreState.session.planId.slice(0, 12)}.
                      </p>
                    </IonText>
                    <IonButton
                      color="danger"
                      expand="block"
                      onClick={() => {
                        setConfirmationAction("restore");
                        setConfirmationText("");
                      }}
                      disabled={restoreBusyAction !== null}
                    >
                      Continue to Restore Confirmation
                    </IonButton>
                  </div>
                )}

                {restoreState.session?.phase === "awaiting-verification" && (
                  <div data-testid="restore-awaiting-acceptance" style={{ marginTop: "1rem" }}>
                    <IonText color="warning">
                      <p>
                        The restored runtime is technically available. Keep the rollback
                        retained until Codex completes browser, network, and console review
                        and Jeffrey confirms the intended historical state in Transactions,
                        Budgets and Budget History, and Reports.
                      </p>
                      {restoreState.session.rollback && (
                        <p>Rollback: {restoreState.session.rollback.basename} — verified</p>
                      )}
                    </IonText>
                    <IonButton
                      color="danger"
                      fill="outline"
                      expand="block"
                      onClick={() => {
                        setConfirmationAction("rollback");
                        setConfirmationText("");
                      }}
                      disabled={!restoreState.session.rollback || restoreBusyAction !== null}
                    >
                      Roll Back to Previous State
                    </IonButton>
                    <IonButton
                      color="success"
                      expand="block"
                      onClick={() => void onAcceptRestore()}
                      disabled={restoreBusyAction !== null}
                    >
                      {restoreBusyAction === "accept" ? (
                        <><IonSpinner name="crescent" /> Accepting...</>
                      ) : (
                        "Accept Restored State"
                      )}
                    </IonButton>
                  </div>
                )}

                {restoreState.session?.phase === "accepted" && restoreState.session.rollback && (
                  <div data-testid="accepted-restore-rollback" style={{ marginTop: "1rem" }}>
                    <IonText color="success">
                      <p>
                        Restored state accepted. Rollback {restoreState.session.rollback.basename}
                        remains retained and is not part of automatic retention.
                      </p>
                    </IonText>
                    <IonButton
                      color="danger"
                      fill="outline"
                      expand="block"
                      onClick={() => {
                        setConfirmationAction("rollback");
                        setConfirmationText("");
                      }}
                      disabled={restoreBusyAction !== null}
                    >
                      Roll Back to Previous State
                    </IonButton>
                  </div>
                )}

                {confirmationAction && restoreState.session && (
                  <div
                    data-testid="restore-confirmation-panel"
                    style={{ border: "1px solid var(--ion-color-danger)", padding: "1rem", marginTop: "1rem" }}
                  >
                    <IonText color="danger">
                      <h3>{confirmationAction === "restore" ? "Confirm live restore" : "Confirm rollback"}</h3>
                      <p>
                        After pressing the destructive action below, stop using this page but
                        keep the Personal Finance owner terminal open. The launcher will close
                        the API and frontend, run the verified operation, and restart them.
                        Refresh this page after the terminal reports completion.
                      </p>
                      <p>
                        Type exactly: <strong>{requiredConfirmationText}</strong>
                      </p>
                    </IonText>
                    <IonInput
                      aria-label="Restore confirmation text"
                      value={confirmationText}
                      onIonInput={(event) => setConfirmationText(String(event.detail.value ?? ""))}
                      disabled={restoreBusyAction !== null}
                    />
                    <IonButton
                      color="danger"
                      expand="block"
                      onClick={() => void onArmRestore(confirmationAction)}
                      disabled={
                        restoreBusyAction !== null
                        || confirmationText !== requiredConfirmationText
                      }
                    >
                      {restoreBusyAction?.startsWith("arm-") ? (
                        <><IonSpinner name="crescent" /> Arming handoff...</>
                      ) : confirmationAction === "restore" ? (
                        "Restore and Restart"
                      ) : (
                        "Roll Back and Restart"
                      )}
                    </IonButton>
                    <IonButton
                      fill="clear"
                      expand="block"
                      onClick={() => {
                        setConfirmationAction(null);
                        setConfirmationText("");
                      }}
                      disabled={restoreBusyAction !== null}
                    >
                      Cancel
                    </IonButton>
                  </div>
                )}

                {restoreMessage && <IonText color="success"><p>{restoreMessage}</p></IonText>}
                {restoreErrorMessage && <IonText color="danger"><p>{restoreErrorMessage}</p></IonText>}
              </>
            )}
          </IonCardContent>
        </IonCard>

        <div
          data-testid="page-settings-actions"
          style={{ marginTop: "1rem", paddingBottom: "1.5rem" }}
        >
          <IonButton
            aria-label="Save Settings"
            expand="block"
            onClick={() => void onSaveSettings()}
            disabled={busy || !pageDirty}
          >
            {busyAction === "save-settings" ? (
              <>
                <IonSpinner name="crescent" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </IonButton>
          {pageSaveMessage && (
            <IonText color="success">
              <p>{pageSaveMessage}</p>
            </IonText>
          )}
          {pageSaveErrorMessage && (
            <IonText color="danger">
              <p>{pageSaveErrorMessage}</p>
            </IonText>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default RuntimeSettings;

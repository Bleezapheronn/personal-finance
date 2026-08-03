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
  }, []);

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

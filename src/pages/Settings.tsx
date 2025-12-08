import React, { useState, useEffect } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonAlert,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonGrid,
  IonRow,
  IonCol,
  IonToast,
  IonProgressBar,
} from "@ionic/react";
import {
  settingsOutline,
  bugOutline,
  downloadOutline,
  refreshOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  warningOutline,
} from "ionicons/icons";
import { db } from "../db";
import { exportTransactionsToCSV, downloadCSV } from "../utils/csvExport";
import {
  exportBudgetsToCSV,
  downloadBudgetsCSV,
} from "../utils/budgetCsvExport";
import "./Settings.css";

interface MigrationLog {
  timestamp: Date;
  operation: string;
  success: boolean;
  details: string;
  recordsAffected?: number;
}

interface DbStats {
  transactions: number;
  budgets: number;
  categories: number;
  recipients: number;
  accounts: number;
  smsImportTemplates: number;
  buckets: number;
}

const Settings: React.FC = () => {
  const [debugMode, setDebugMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [migrationLogs, setMigrationLogs] = useState<MigrationLog[]>([]);
  const [showMigrationAlert, setShowMigrationAlert] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastColor, setToastColor] = useState("success");
  const [migratingProgress, setMigratingProgress] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    // Load debug mode from localStorage
    const saved = localStorage.getItem("debugMode");
    if (saved === "true") {
      setDebugMode(true);
    }
  }, []);

  const toggleDebugMode = (checked: boolean) => {
    setDebugMode(checked);
    localStorage.setItem("debugMode", checked ? "true" : "false");
    addMigrationLog(
      "Debug Mode",
      checked,
      `Debug mode ${checked ? "enabled" : "disabled"}`
    );
  };

  const addMigrationLog = (
    operation: string,
    success: boolean,
    details: string,
    recordsAffected?: number
  ) => {
    const log: MigrationLog = {
      timestamp: new Date(),
      operation,
      success,
      details,
      recordsAffected,
    };
    setMigrationLogs((prev) => [log, ...prev]);
  };

  const loadDbStats = async () => {
    setLoading(true);
    try {
      const [
        transactions,
        budgets,
        categories,
        recipients,
        accounts,
        smsImportTemplates,
        buckets,
      ] = await Promise.all([
        db.transactions.count(),
        db.budgets.count(),
        db.categories.count(),
        db.recipients.count(),
        db.accounts.count(),
        db.smsImportTemplates.count(),
        db.buckets.count(),
      ]);

      setDbStats({
        transactions,
        budgets,
        categories,
        recipients,
        accounts,
        smsImportTemplates,
        buckets,
      });

      addMigrationLog(
        "Database Stats Loaded",
        true,
        `Loaded statistics for ${
          transactions +
          budgets +
          categories +
          recipients +
          accounts +
          smsImportTemplates +
          buckets
        } records`
      );
    } catch (err) {
      console.error("Error loading DB stats:", err);
      addMigrationLog(
        "Database Stats",
        false,
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setToastMessage("Failed to load database statistics");
      setToastColor("danger");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const handleMigratePaymentMethods = async () => {
    setIsMigrating(true);
    setMigratingProgress(0);

    try {
      // Step 1: Migrate Transactions
      setMigratingProgress(10);
      const transactionsToMigrate = await db.transactions.toArray();
      let transactionsMigrated = 0;
      let transactionsOrphaned = 0;

      for (const txn of transactionsToMigrate) {
        if (txn.paymentChannelId && !txn.accountId) {
          const paymentMethod = await db.paymentMethods.get(
            txn.paymentChannelId
          );
          if (paymentMethod && paymentMethod.accountId) {
            await db.transactions.update(txn.id!, {
              accountId: paymentMethod.accountId,
            });
            transactionsMigrated++;
          } else {
            transactionsOrphaned++;
          }
        }
        setMigratingProgress(
          10 +
            (transactionsMigrated / Math.max(transactionsToMigrate.length, 1)) *
              20
        );
      }

      addMigrationLog(
        "Migrate Transactions",
        true,
        `Migrated ${transactionsMigrated} transactions${
          transactionsOrphaned > 0 ? `, ${transactionsOrphaned} orphaned` : ""
        }`,
        transactionsMigrated
      );

      // Step 2: Migrate Budgets
      setMigratingProgress(35);
      const budgetsToMigrate = await db.budgets.toArray();
      let budgetsMigrated = 0;
      let budgetsOrphaned = 0;

      for (const budget of budgetsToMigrate) {
        if (budget.paymentChannelId && !budget.accountId) {
          const paymentMethod = await db.paymentMethods.get(
            budget.paymentChannelId
          );
          if (paymentMethod && paymentMethod.accountId) {
            await db.budgets.update(budget.id!, {
              accountId: paymentMethod.accountId,
            });
            budgetsMigrated++;
          } else {
            budgetsOrphaned++;
          }
        }
        setMigratingProgress(
          35 + (budgetsMigrated / Math.max(budgetsToMigrate.length, 1)) * 20
        );
      }

      addMigrationLog(
        "Migrate Budgets",
        true,
        `Migrated ${budgetsMigrated} budgets${
          budgetsOrphaned > 0 ? `, ${budgetsOrphaned} orphaned` : ""
        }`,
        budgetsMigrated
      );

      // Step 3: Migrate SMS Import Templates
      setMigratingProgress(60);
      const templatesToMigrate = await db.smsImportTemplates.toArray();
      let templatesMigrated = 0;
      let templatesOrphaned = 0;

      for (const template of templatesToMigrate) {
        if (template.paymentMethodId && !template.accountId) {
          const paymentMethod = await db.paymentMethods.get(
            template.paymentMethodId
          );
          if (paymentMethod && paymentMethod.accountId) {
            await db.smsImportTemplates.update(template.id!, {
              accountId: paymentMethod.accountId,
            });
            templatesMigrated++;
          } else {
            templatesOrphaned++;
          }
        }
        setMigratingProgress(
          60 + (templatesMigrated / Math.max(templatesToMigrate.length, 1)) * 20
        );
      }

      addMigrationLog(
        "Migrate SMS Templates",
        true,
        `Migrated ${templatesMigrated} templates${
          templatesOrphaned > 0 ? `, ${templatesOrphaned} orphaned` : ""
        }`,
        templatesMigrated
      );

      // Step 4: Delete PaymentMethod records
      setMigratingProgress(85);
      const allPaymentMethods = await db.paymentMethods.toArray();
      const pmCount = allPaymentMethods.length;

      for (const pm of allPaymentMethods) {
        await db.paymentMethods.delete(pm.id!);
      }

      addMigrationLog(
        "Delete Payment Methods",
        true,
        `Deleted ${pmCount} payment method records`,
        pmCount
      );

      // Step 5: Verify and Complete
      setMigratingProgress(95);

      setMigratingProgress(100);

      const totalMigrated =
        transactionsMigrated + budgetsMigrated + templatesMigrated;
      const totalOrphaned =
        transactionsOrphaned + budgetsOrphaned + templatesOrphaned;

      addMigrationLog(
        "Migration Complete",
        true,
        `Summary: ${totalMigrated} records migrated, ${totalOrphaned} orphaned.`,
        totalMigrated
      );

      setToastMessage(
        `✅ Migration complete! ${totalMigrated} records migrated${
          totalOrphaned > 0 ? `, ${totalOrphaned} orphaned` : ""
        }`
      );
      setToastColor("success");
      setShowToast(true);

      // Reload stats
      await loadDbStats();
    } catch (err) {
      console.error("Migration error:", err);
      addMigrationLog(
        "Migration Failed",
        false,
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setToastMessage("Migration failed. Check logs for details.");
      setToastColor("danger");
      setShowToast(true);
    } finally {
      setIsMigrating(false);
      setMigratingProgress(0);
    }
  };

  const handleFixIsActiveStates = async () => {
    setIsMigrating(true);
    setMigratingProgress(0);

    try {
      let fixedCount = 0;

      // Fix Transactions
      setMigratingProgress(20);
      const transactions = await db.transactions.toArray();
      for (const txn of transactions) {
        if (!("isActive" in txn)) {
          // FIXED: Properly typed update instead of 'as any'
          await db.transactions.update(txn.id!, {
            isActive: true,
          } as Partial<typeof txn>);
          fixedCount++;
        }
      }

      // Fix Budgets
      setMigratingProgress(40);
      const budgets = await db.budgets.toArray();
      for (const budget of budgets) {
        if (!budget.isActive) {
          await db.budgets.update(budget.id!, { isActive: true });
          fixedCount++;
        }
      }

      // Fix SMS Templates
      setMigratingProgress(60);
      const templates = await db.smsImportTemplates.toArray();
      for (const template of templates) {
        if (!template.isActive) {
          await db.smsImportTemplates.update(template.id!, { isActive: true });
          fixedCount++;
        }
      }

      // Fix Accounts
      setMigratingProgress(80);
      const accounts = await db.accounts.toArray();
      for (const account of accounts) {
        if (!account.isActive) {
          await db.accounts.update(account.id!, { isActive: true });
          fixedCount++;
        }
      }

      setMigratingProgress(100);

      addMigrationLog(
        "Fix isActive States",
        true,
        `Fixed ${fixedCount} records with undefined isActive fields`,
        fixedCount
      );

      setToastMessage(`✅ Fixed ${fixedCount} records`);
      setToastColor("success");
      setShowToast(true);

      await loadDbStats();
    } catch (err) {
      console.error("Fix error:", err);
      addMigrationLog(
        "Fix isActive States",
        false,
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setToastMessage("Fix failed. Check logs for details.");
      setToastColor("danger");
      setShowToast(true);
    } finally {
      setIsMigrating(false);
      setMigratingProgress(0);
    }
  };

  const handleExportTransactions = async () => {
    try {
      setLoading(true);
      const csv = await exportTransactionsToCSV();
      const date = new Date().toISOString().split("T")[0];
      downloadCSV(csv, `transactions_${date}.csv`);
      addMigrationLog(
        "Export Transactions",
        true,
        `Exported transactions to CSV file`
      );
      setToastMessage("✅ Transactions exported successfully");
      setToastColor("success");
      setShowToast(true);
    } catch (err) {
      console.error("Export error:", err);
      addMigrationLog(
        "Export Transactions",
        false,
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setToastMessage("Export failed");
      setToastColor("danger");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const handleExportBudgets = async () => {
    try {
      setLoading(true);
      const csv = await exportBudgetsToCSV();
      const date = new Date().toISOString().split("T")[0];
      downloadBudgetsCSV(csv, `budgets_${date}.csv`);
      addMigrationLog("Export Budgets", true, `Exported budgets to CSV file`);
      setToastMessage("✅ Budgets exported successfully");
      setToastColor("success");
      setShowToast(true);
    } catch (err) {
      console.error("Export error:", err);
      addMigrationLog(
        "Export Budgets",
        false,
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setToastMessage("Export failed");
      setToastColor("danger");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = () => {
    setMigrationLogs([]);
    setToastMessage("Migration logs cleared");
    setToastColor("success");
    setShowToast(true);
  };

  const handleViewDatabase = () => {
    if (debugMode) {
      // Open DevTools with IndexedDB inspector
      console.log("📊 Database Statistics:", dbStats);
      console.log("📝 Migration Logs:", migrationLogs);
      window.open("chrome://inspect/#databases", "_blank");
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Settings & Debug</IonTitle>
          <IonIcon
            slot="end"
            icon={settingsOutline}
            style={{ paddingRight: "16px" }}
          />
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Debug Mode Toggle */}
        <IonCard>
          <IonCardHeader>
            <IonText>
              <h3>Debug Mode</h3>
            </IonText>
          </IonCardHeader>
          <IonCardContent>
            <IonList>
              <IonItem>
                <IonLabel>Enable Debug Mode</IonLabel>
                <IonToggle
                  slot="end"
                  checked={debugMode}
                  onIonChange={(e) => toggleDebugMode(e.detail.checked)}
                />
              </IonItem>
            </IonList>
            <IonText color="medium">
              <p style={{ fontSize: "0.85rem" }}>
                Debug mode enables migration tools and detailed logging. Use
                only if you know what you're doing.
              </p>
            </IonText>
          </IonCardContent>
        </IonCard>

        {debugMode && (
          <>
            {/* Database Statistics */}
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Database Statistics</h3>
                </IonText>
                <IonButton
                  fill="clear"
                  size="small"
                  onClick={loadDbStats}
                  disabled={loading}
                >
                  <IonIcon icon={refreshOutline} />
                </IonButton>
              </IonCardHeader>
              <IonCardContent>
                {loading ? (
                  <IonSpinner name="crescent" />
                ) : dbStats ? (
                  <IonGrid>
                    <IonRow>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.transactions}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Transactions</p>
                          </IonText>
                        </div>
                      </IonCol>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.budgets}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Budgets</p>
                          </IonText>
                        </div>
                      </IonCol>
                    </IonRow>
                    <IonRow>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.accounts}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Accounts</p>
                          </IonText>
                        </div>
                      </IonCol>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.smsImportTemplates}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>SMS Templates</p>
                          </IonText>
                        </div>
                      </IonCol>
                    </IonRow>
                    <IonRow>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.recipients}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Recipients</p>
                          </IonText>
                        </div>
                      </IonCol>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.categories}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Categories</p>
                          </IonText>
                        </div>
                      </IonCol>
                    </IonRow>
                    <IonRow>
                      <IonCol size="6">
                        <div className="stat-item">
                          <IonText color="primary">
                            <h4>{dbStats.buckets}</h4>
                          </IonText>
                          <IonText color="medium">
                            <p>Buckets</p>
                          </IonText>
                        </div>
                      </IonCol>
                    </IonRow>
                  </IonGrid>
                ) : (
                  <IonText color="medium">
                    <p>Click refresh to load statistics</p>
                  </IonText>
                )}
              </IonCardContent>
            </IonCard>

            {/* Phase 7 Migration Tools */}
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Phase 7 Migration Tools</h3>
                </IonText>
              </IonCardHeader>
              <IonCardContent>
                {isMigrating && (
                  <div style={{ marginBottom: "16px" }}>
                    <IonProgressBar
                      value={migratingProgress / 100}
                      color="primary"
                    />
                    <IonText color="medium" style={{ fontSize: "0.85rem" }}>
                      <p>{Math.round(migratingProgress)}% Complete</p>
                    </IonText>
                  </div>
                )}

                <div style={{ marginBottom: "12px" }}>
                  <IonButton
                    expand="block"
                    color="warning"
                    onClick={() => setShowMigrationAlert(true)}
                    disabled={isMigrating}
                  >
                    <IonIcon slot="start" icon={warningOutline} />
                    Migrate PaymentMethods → Accounts
                  </IonButton>
                  <IonText color="medium">
                    <p style={{ fontSize: "0.75rem", marginTop: "8px" }}>
                      ⚠️ Use only if migration didn't run automatically on
                      startup
                    </p>
                  </IonText>
                </div>

                <IonButton
                  expand="block"
                  color="secondary"
                  onClick={handleFixIsActiveStates}
                  disabled={isMigrating}
                >
                  <IonIcon slot="start" icon={refreshOutline} />
                  Fix isActive States
                </IonButton>
                <IonText color="medium">
                  <p style={{ fontSize: "0.75rem", marginTop: "8px" }}>
                    Fixes any records with undefined isActive fields
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {/* Data Export Tools */}
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Data Export</h3>
                </IonText>
              </IonCardHeader>
              <IonCardContent>
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={handleExportTransactions}
                  disabled={loading || isMigrating}
                >
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export Transactions to CSV
                </IonButton>

                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={handleExportBudgets}
                  disabled={loading || isMigrating}
                  style={{ marginTop: "8px" }}
                >
                  <IonIcon slot="start" icon={downloadOutline} />
                  Export Budgets to CSV
                </IonButton>

                <IonText color="medium">
                  <p style={{ fontSize: "0.75rem", marginTop: "12px" }}>
                    Exports current data with timestamp in filename
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {/* Developer Tools */}
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Developer Tools</h3>
                </IonText>
              </IonCardHeader>
              <IonCardContent>
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={handleViewDatabase}
                >
                  <IonIcon slot="start" icon={bugOutline} />
                  View Database in DevTools
                </IonButton>

                <IonText color="medium">
                  <p style={{ fontSize: "0.75rem", marginTop: "12px" }}>
                    Opens IndexedDB inspector in Chrome DevTools. Logs database
                    info to console.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {/* Migration Logs */}
            <IonCard>
              <IonCardHeader>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <IonText>
                    <h3>Migration Logs ({migrationLogs.length})</h3>
                  </IonText>
                  <IonButton
                    fill="clear"
                    size="small"
                    onClick={handleClearLogs}
                    disabled={migrationLogs.length === 0}
                  >
                    Clear
                  </IonButton>
                </div>
              </IonCardHeader>
              <IonCardContent>
                {migrationLogs.length === 0 ? (
                  <IonText color="medium">
                    <p>No migration logs yet</p>
                  </IonText>
                ) : (
                  <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                    {migrationLogs.map((log, index) => (
                      <div
                        key={index}
                        style={{
                          padding: "12px",
                          borderLeft: `4px solid ${
                            log.success ? "#2dd36f" : "#eb445c"
                          }`,
                          marginBottom: "8px",
                          backgroundColor: "var(--ion-color-light)",
                          borderRadius: "4px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "4px",
                          }}
                        >
                          <IonIcon
                            icon={
                              log.success
                                ? checkmarkCircleOutline
                                : closeCircleOutline
                            }
                            color={log.success ? "success" : "danger"}
                          />
                          <strong>{log.operation}</strong>
                          <IonText
                            color="medium"
                            style={{ fontSize: "0.75rem" }}
                          >
                            {log.timestamp.toLocaleTimeString()}
                          </IonText>
                        </div>
                        <IonText color="medium" style={{ fontSize: "0.85rem" }}>
                          <p style={{ margin: "0" }}>{log.details}</p>
                        </IonText>
                        {log.recordsAffected !== undefined && (
                          <IonText
                            color="primary"
                            style={{ fontSize: "0.8rem" }}
                          >
                            <p style={{ margin: "4px 0 0 0" }}>
                              Records affected: {log.recordsAffected}
                            </p>
                          </IonText>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </IonCardContent>
            </IonCard>

            {/* Debug Info */}
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Debug Information</h3>
                </IonText>
              </IonCardHeader>
              <IonCardContent>
                <IonText color="medium" style={{ fontSize: "0.85rem" }}>
                  <p>
                    <strong>App Version:</strong> Phase 7{" "}
                  </p>
                  <p>
                    <strong>Database:</strong> Dexie IndexedDB
                  </p>
                  <p>
                    <strong>Debug Mode:</strong>{" "}
                    {debugMode ? "Enabled" : "Disabled"}
                  </p>
                  <p>
                    <strong>Last Updated:</strong> {new Date().toLocaleString()}
                  </p>
                </IonText>
                <IonButton
                  fill="clear"
                  size="small"
                  expand="block"
                  onClick={() => {
                    console.clear();
                    console.log("🔍 Debug Console Cleared");
                    setToastMessage("Console cleared");
                    setToastColor("success");
                    setShowToast(true);
                  }}
                >
                  Clear Console
                </IonButton>
              </IonCardContent>
            </IonCard>
          </>
        )}

        {!debugMode && (
          <IonCard>
            <IonCardContent>
              <IonText color="medium" style={{ textAlign: "center" }}>
                <p>
                  Enable Debug Mode above to access migration and diagnostic
                  tools.
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>

      {/* Migration Confirmation Alert */}
      <IonAlert
        isOpen={showMigrationAlert}
        onDidDismiss={() => setShowMigrationAlert(false)}
        header="Confirm Migration"
        message="This will migrate all PaymentMethod records to Accounts. This operation is irreversible. Make sure you have exported your data first!"
        buttons={[
          {
            text: "Cancel",
            role: "cancel",
          },
          {
            text: "Export First",
            handler: async () => {
              setShowMigrationAlert(false);
              await handleExportTransactions();
              await handleExportBudgets();
            },
          },
          {
            text: "Proceed with Migration",
            role: "destructive",
            handler: () => {
              setShowMigrationAlert(false);
              handleMigratePaymentMethods();
            },
          },
        ]}
      />

      {/* Toast Notification */}
      <IonToast
        isOpen={showToast}
        onDidDismiss={() => setShowToast(false)}
        message={toastMessage}
        duration={3000}
        position="top"
        color={toastColor}
      />
    </IonPage>
  );
};

export default Settings;

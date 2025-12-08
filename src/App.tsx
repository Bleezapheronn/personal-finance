import React, { useEffect } from "react";
import { Redirect, Route, useLocation } from "react-router-dom";
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
  IonMenu,
  IonContent,
  IonList,
  IonItem,
  IonMenuToggle,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonListHeader,
} from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { list, barChart, calendar, settingsOutline } from "ionicons/icons";

import Transactions from "./pages/Transactions";
import AddTransaction from "./pages/AddTransaction";
import TransactionDetails from "./pages/TransactionDetails";
import Budget from "./pages/Budget";
import AddBudget from "./pages/AddBudget";
import BucketsManagement from "./pages/BucketsManagement";
import AccountsManagement from "./pages/AccountsManagement";
import RecipientsManagement from "./pages/RecipientsManagement";
import SmsImportTemplatesManagement from "./pages/SmsImportTemplatesManagement";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings"; // NEW

import { migrateIsActiveStates, migratePaymentMethodsToAccounts } from "./db";

/* Core CSS required for Ionic components to work properly */
import "@ionic/react/css/core.css";

/* Basic CSS for apps built with Ionic */
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";

/* Optional CSS utils that can be commented out */
import "@ionic/react/css/padding.css";
import "@ionic/react/css/float-elements.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/text-transformation.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";

/* Ionic Dark Mode */
import "@ionic/react/css/palettes/dark.system.css";

/* Theme variables */
import "./theme/variables.css";
import "./styles/forms.css";
import "./styles/global.css";

setupIonicReact();

const InnerApp: React.FC = () => {
  const location = useLocation();

  return (
    <IonApp>
      <IonReactRouter>
        {/* Side menu */}
        <IonMenu side="start" contentId="main">
          <IonHeader>
            <IonToolbar>
              <IonTitle>Manage</IonTitle>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList>
              <IonListHeader>Manage</IonListHeader>
              <IonMenuToggle autoHide={true}>
                <IonItem button routerLink="/accounts-management">
                  <IonLabel>Accounts</IonLabel>
                </IonItem>
                <IonItem button routerLink="/buckets-management">
                  <IonLabel>Buckets</IonLabel>
                </IonItem>
                <IonItem button routerLink="/recipients-management">
                  <IonLabel>Recipients</IonLabel>
                </IonItem>
                <IonItem button routerLink="/sms-import-templates">
                  <IonLabel>SMS Import Templates</IonLabel>
                </IonItem>
              </IonMenuToggle>
            </IonList>
            {/* NEW: Settings section */}
            <IonList>
              <IonListHeader>System</IonListHeader>
              <IonMenuToggle autoHide={true}>
                <IonItem button routerLink="/settings">
                  <IonIcon
                    aria-hidden="true"
                    icon={settingsOutline}
                    slot="start"
                  />
                  <IonLabel>Settings & Debug</IonLabel>
                </IonItem>
              </IonMenuToggle>
            </IonList>
          </IonContent>
        </IonMenu>

        <IonTabs>
          <IonRouterOutlet id="main">
            <Route
              exact
              path="/transactions"
              render={(props) => <Transactions key={location.key} {...props} />}
            />
            <Route exact path="/add">
              <AddTransaction />
            </Route>
            <Route exact path="/edit/:id">
              <AddTransaction />
            </Route>
            <Route exact path="/transaction-details/:id">
              <TransactionDetails />
            </Route>
            <Route
              exact
              path="/budget"
              render={(props) => <Budget key={location.key} {...props} />}
            />
            <Route exact path="/budget/add">
              <AddBudget />
            </Route>
            <Route exact path="/budget/edit/:id">
              <AddBudget />
            </Route>
            <Route exact path="/budget/from-transaction/:transactionId">
              <AddBudget />
            </Route>
            <Route path="/buckets-management">
              <BucketsManagement />
            </Route>
            <Route path="/accounts-management">
              <AccountsManagement />
            </Route>
            <Route path="/recipients-management">
              <RecipientsManagement />
            </Route>
            <Route path="/sms-import-templates">
              <SmsImportTemplatesManagement />
            </Route>
            <Route path="/reports">
              <Reports />
            </Route>
            {/* NEW: Settings route */}
            <Route path="/settings">
              <Settings />
            </Route>
            <Route exact path="/">
              <Redirect to="/transactions" />
            </Route>
          </IonRouterOutlet>
          <IonTabBar slot="bottom">
            <IonTabButton tab="transactions" href="/transactions">
              <IonIcon aria-hidden="true" icon={list} />
              <IonLabel>Transactions</IonLabel>
            </IonTabButton>
            <IonTabButton tab="budget" href="/budget">
              <IonIcon aria-hidden="true" icon={calendar} />
              <IonLabel>Budget</IonLabel>
            </IonTabButton>
            <IonTabButton tab="reports" href="/reports">
              <IonIcon aria-hidden="true" icon={barChart} />
              <IonLabel>Reports</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
      </IonReactRouter>
    </IonApp>
  );
};

const App: React.FC = () => {
  // Run migrations on app startup
  useEffect(() => {
    const runMigrations = async () => {
      try {
        console.log("🚀 Starting database migrations...");

        // Run Payment Methods migration first (Phase 7)
        console.log("📋 Running Phase 7: PaymentMethod → Account migration...");
        await migratePaymentMethodsToAccounts();

        // Then run isActive migration (Phase 5)
        console.log("📋 Running Phase 5: Fixing isActive states...");
        await migrateIsActiveStates();

        console.log("✨ All migrations completed successfully!");
      } catch (error) {
        console.error("❌ Migration error:", error);
        // Don't block app startup if migrations fail
        // Users can manually trigger from Settings/Debug page
      }
    };

    runMigrations();
  }, []); // Run once on mount

  return (
    <IonApp>
      <IonReactRouter>
        <InnerApp />
      </IonReactRouter>
    </IonApp>
  );
};

export default App;

import React from "react";
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
  IonButtons,
} from "@ionic/react";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { SqliteAuthorityToolbarStatus } from "../components/SqliteAuthorityRehearsalBanner";

const SqliteAuthoritySettings: React.FC = () => {
  const authority = useSqliteAuthorityRehearsal();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Settings & Status</IonTitle>
          <SqliteAuthorityToolbarStatus />
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>SQLite authority status</IonCardHeader>
          <IonCardContent>
            <IonText color={authority.ready ? "success" : "danger"}>
              <h2>{authority.ready ? "Verified and ready" : "Not ready"}</h2>
            </IonText>
            <p>{authority.message}</p>
            <IonButton
              onClick={() => void authority.refresh()}
              disabled={authority.checking}
            >
              {authority.checking ? "Checking..." : "Check status"}
            </IonButton>
          </IonCardContent>
        </IonCard>

        <IonCard>
          <IonCardHeader>Diagnostics</IonCardHeader>
          <IonCardContent>
            <IonList lines="full">
              <IonItem>
                <IonLabel>API available</IonLabel>
                <IonText color={authority.apiAvailable ? "success" : "danger"}>
                  {authority.apiAvailable ? "Yes" : "No"}
                </IonText>
              </IonItem>
              <IonItem>
                <IonLabel>Authority verification</IonLabel>
                <IonText color={authority.ready ? "success" : "danger"}>
                  {authority.ready ? "Passed" : "Failed"}
                </IonText>
              </IonItem>
              <IonItem>
                <IonLabel>Required capabilities</IonLabel>
                <IonText
                  color={
                    authority.missingCapabilities.length === 0
                      ? "success"
                      : "danger"
                  }
                >
                  {authority.missingCapabilities.length === 0
                    ? "Available"
                    : `${authority.missingCapabilities.length} missing`}
                </IonText>
              </IonItem>
              <IonItem>
                <IonLabel>Restart safety requirements</IonLabel>
                <IonText
                  color={
                    authority.missingRequirements.length === 0
                      ? "success"
                      : "warning"
                  }
                >
                  {authority.missingRequirements.length === 0
                    ? "Satisfied"
                    : `${authority.missingRequirements.length} pending`}
                </IonText>
              </IonItem>
            </IonList>
            {authority.code && (
              <IonText color="danger">
                <p>Error code: {authority.code}</p>
              </IonText>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard>
          <IonCardHeader>Backup and restore</IonCardHeader>
          <IonCardContent>
            <p>
              User-facing SQLite backup, import, and restore are deferred while
              the operational checkpoint workflow remains the recovery path.
            </p>
            <IonButton disabled>Export backup</IonButton>
            <IonButton disabled>Import backup</IonButton>
            <IonButton disabled>Restore backup</IonButton>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

export default SqliteAuthoritySettings;

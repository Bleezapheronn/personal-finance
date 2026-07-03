import React from "react";
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
} from "@ionic/react";

interface SelectedReadPreviewCardProps {
  title?: string;
  resourceLabel: string;
  loading: boolean;
  onLoad: () => void;
  children?: React.ReactNode;
  description: string;
}

export const SelectedReadPreviewCard: React.FC<SelectedReadPreviewCardProps> = ({
  title = "Experimental selected-read preview",
  resourceLabel,
  loading,
  onLoad,
  children,
  description,
}) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>{title}</h3>
      </IonText>
      <IonBadge color="warning">Read-only</IonBadge>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>
            <h3>Dexie remains authoritative</h3>
            <p>{description}</p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>{resourceLabel}</IonLabel>
          <IonButton
            slot="end"
            size="small"
            onClick={onLoad}
            disabled={loading}
          >
            Load preview
          </IonButton>
          {loading && <IonSpinner name="crescent" slot="end" />}
        </IonItem>
      </IonList>

      {children}
    </IonCardContent>
  </IonCard>
);

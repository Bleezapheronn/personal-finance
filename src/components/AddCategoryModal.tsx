import React, { useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonAlert,
} from "@ionic/react";
import { db, Category, Bucket } from "../db";

interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryAdded: (category: Category) => void;
  buckets: Bucket[];
}

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
  isOpen,
  onClose,
  onCategoryAdded,
  buckets,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);
  const [isActive, setIsActive] = useState(true);
  const [alertMessage, setAlertMessage] = useState("");

  const resetForm = () => {
    setName("");
    setDescription("");
    setBucketId(undefined);
    setIsActive(true);
    setAlertMessage("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setAlertMessage("Category name is required");
      return;
    }
    if (bucketId == null) {
      setAlertMessage("Bucket is required");
      return;
    }

    try {
      const now = new Date();
      const newCategory: Omit<Category, "id"> = {
        name: name.trim(),
        bucketId: bucketId,
        description: description.trim() || undefined,
        isActive: isActive,
        createdAt: now,
        updatedAt: now,
      };

      const id = await db.categories.add(newCategory);
      const saved = await db.categories.get(id);

      if (saved) {
        onCategoryAdded(saved);
        resetForm();
        onClose();
      }
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to add category");
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add Category</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {alertMessage && (
          <IonAlert
            isOpen={!!alertMessage}
            onDidDismiss={() => setAlertMessage("")}
            header="Alert"
            message={alertMessage}
            buttons={["OK"]}
          />
        )}
        <IonGrid>
          <IonRow>
            <IonCol>
              <IonInput
                label="Category Name"
                labelPlacement="stacked"
                fill="outline"
                placeholder="e.g., Groceries"
                value={name}
                onIonChange={(e) => setName(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonInput
                label="Description (optional)"
                labelPlacement="stacked"
                fill="outline"
                placeholder="Category description"
                value={description}
                onIonChange={(e) => setDescription(e.detail.value ?? "")}
              />
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonSelect
                label="Bucket"
                placeholder="Select bucket"
                interface="popover"
                value={bucketId}
                onIonChange={(e) =>
                  setBucketId(e.detail.value as number | undefined)
                }
                labelPlacement="stacked"
                fill="outline"
              >
                {buckets.map((b) => (
                  <IonSelectOption key={b.id} value={b.id}>
                    {b.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol>
              <IonButton expand="block" onClick={handleSave}>
                Add Category
              </IonButton>
            </IonCol>
            <IonCol>
              <IonButton expand="block" color="medium" onClick={handleClose}>
                Cancel
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

import React, { useState, useEffect } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonInput,
  IonAlert,
  IonIcon,
} from "@ionic/react";
import { close } from "ionicons/icons";
import { db, Category, Bucket } from "../db";
import { SelectableDropdown } from "./SelectableDropdown";

interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryAdded: (category: Category) => void;
  buckets: Bucket[];
  preSelectedBucketId?: number;
  editingCategory?: Category;
}

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
  isOpen,
  onClose,
  onCategoryAdded,
  buckets,
  preSelectedBucketId,
  editingCategory,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bucketId, setBucketId] = useState<number | undefined>(
    preSelectedBucketId
  );
  const [isActive, setIsActive] = useState(true);
  const [alertMessage, setAlertMessage] = useState("");

  // Set pre-selected bucket when modal opens
  useEffect(() => {
    if (isOpen && preSelectedBucketId) {
      setBucketId(preSelectedBucketId);
    }

    if (editingCategory) {
      setName(editingCategory.name || "");
      setDescription(editingCategory.description || "");
      setBucketId(editingCategory.bucketId);
      setIsActive(editingCategory.isActive !== false);
    }
  }, [isOpen, preSelectedBucketId, editingCategory]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setBucketId(preSelectedBucketId);
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

      if (editingCategory?.id) {
        // UPDATE MODE
        await db.categories.update(editingCategory.id, {
          name: name.trim(),
          bucketId: bucketId,
          description: description.trim() || undefined,
          isActive: isActive,
          updatedAt: now,
        });

        const updated = await db.categories.get(editingCategory.id);
        if (updated) {
          onCategoryAdded(updated);
        }
      } else {
        // ADD MODE
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
        }
      }

      resetForm();
      onClose();
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to save category");
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
          <IonTitle>
            {editingCategory ? "Edit Category" : "Add Category"}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleClose}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
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
          {/* Bucket - UPDATED: Using SelectableDropdown */}
          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Bucket</label>
                <SelectableDropdown
                  label="Bucket"
                  placeholder="Select bucket"
                  value={
                    bucketId
                      ? buckets.find((b) => b.id === bucketId)?.id?.toString()
                      : undefined
                  }
                  options={buckets.map((bucket) => ({
                    value: bucket.id!.toString(),
                    label: bucket.name || "Unnamed Bucket",
                  }))}
                  onValueChange={(selectedBucketId) => {
                    setBucketId(parseInt(selectedBucketId, 10));
                  }}
                />
              </div>
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Category Name</label>
                <IonInput
                  className="form-input"
                  placeholder="e.g., Groceries"
                  value={name}
                  onIonChange={(e) => setName(e.detail.value ?? "")}
                />
              </div>
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <div className="form-input-wrapper">
                <label className="form-label">Description (optional)</label>
                <IonInput
                  className="form-input"
                  placeholder="Category description"
                  value={description}
                  onIonChange={(e) => setDescription(e.detail.value ?? "")}
                />
              </div>
            </IonCol>
          </IonRow>

          <IonRow>
            <IonCol>
              <IonButton expand="block" onClick={handleSave}>
                {editingCategory ? "Save Changes" : "Add Category"}
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonModal>
  );
};

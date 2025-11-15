import React, { useEffect, useState } from "react";
import {
  IonButton,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonCardTitle,
  IonAlert,
  IonIcon,
  IonAccordion,
  IonAccordionGroup,
} from "@ionic/react";
import {
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
} from "ionicons/icons";
import { db, Bucket, Category } from "../db";

/**
 * BucketsManagement
 * - captures all fields in the Bucket table:
 *   id, name, description, minPercentage, maxPercentage,
 *   minFixedAmount, isActive, createdAt, updatedAt
 *
 * - lists categories under their respective bucket and provides
 *   add / edit / delete functionality for categories.
 */

const BucketsManagement: React.FC = () => {
  // buckets state
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketId, setBucketId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minPercentage, setMinPercentage] = useState<number | undefined>(
    undefined
  );
  const [maxPercentage, setMaxPercentage] = useState<number | undefined>(
    undefined
  );
  const [minFixedAmount, setMinFixedAmount] = useState<number | undefined>(
    undefined
  );
  const [isActive, setIsActive] = useState<boolean>(true);

  // categories state + form
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryBucketId, setCategoryBucketId] = useState<number | null>(null);
  const [categoryIsActive, setCategoryIsActive] = useState<boolean>(true);

  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [deleteBucketId, setDeleteBucketId] = useState<number | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<number | null>(null);

  useEffect(() => {
    fetchBuckets();
    fetchCategories();
  }, []);

  const fetchBuckets = async () => {
    try {
      const all = await db.buckets.toArray();
      setBuckets(all);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to load buckets");
      setShowAlert(true);
    }
  };

  const fetchCategories = async () => {
    try {
      const all = await db.categories.toArray();
      setCategories(all);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to load categories");
      setShowAlert(true);
    }
  };

  const resetForm = () => {
    setBucketId(null);
    setName("");
    setDescription("");
    setMinPercentage(undefined);
    setMaxPercentage(undefined);
    setMinFixedAmount(undefined);
    setIsActive(true);
  };

  const validatePercent = (v?: number) =>
    v === undefined || (v >= 0 && v <= 100);

  const saveBucket = async () => {
    if (!name.trim()) {
      setAlertMessage("Bucket name is required");
      setShowAlert(true);
      return;
    }
    if (!validatePercent(minPercentage) || !validatePercent(maxPercentage)) {
      setAlertMessage("Percentages must be between 0 and 100");
      setShowAlert(true);
      return;
    }
    if (
      typeof minPercentage === "number" &&
      typeof maxPercentage === "number" &&
      minPercentage > maxPercentage
    ) {
      setAlertMessage("minPercentage cannot be greater than maxPercentage");
      setShowAlert(true);
      return;
    }

    const now = new Date();
    try {
      if (bucketId !== null) {
        // update existing
        await db.buckets.update(bucketId, {
          name: name.trim(),
          description: description.trim() || undefined,
          minPercentage: minPercentage ?? 0,
          maxPercentage: maxPercentage ?? 100,
          minFixedAmount: minFixedAmount ?? undefined,
          isActive,
          updatedAt: now,
        } as Partial<Bucket>);
        setAlertMessage("Bucket updated");
      } else {
        // add new
        const newBucket: Omit<Bucket, "id"> = {
          name: name.trim(),
          description: description.trim() || undefined,
          minPercentage: minPercentage ?? 0,
          maxPercentage: maxPercentage ?? 100,
          minFixedAmount: minFixedAmount ?? undefined,
          isActive,
          createdAt: now,
          updatedAt: now,
        };
        await db.buckets.add(newBucket);
        setAlertMessage("Bucket created");
      }
      resetForm();
      await fetchBuckets();
      setShowAlert(true);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to save bucket");
      setShowAlert(true);
    }
  };

  const editBucket = (b: Bucket) => {
    setBucketId(b.id ?? null);
    setName(b.name ?? "");
    setDescription(b.description ?? "");
    setMinPercentage(b.minPercentage);
    setMaxPercentage(b.maxPercentage);
    setMinFixedAmount(b.minFixedAmount);
    setIsActive(Boolean(b.isActive));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteBucket = async (id?: number) => {
    if (!id) return;
    try {
      // delete categories belonging to the bucket first
      await db.transaction("rw", db.categories, db.buckets, async () => {
        await db.categories.where("bucketId").equals(id).delete();
        await db.buckets.delete(id);
      });
      await fetchBuckets();
      await fetchCategories();
      setAlertMessage("Bucket and its categories deleted");
      setShowAlert(true);
      setDeleteBucketId(null);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to delete bucket");
      setShowAlert(true);
    }
  };

  // new: toggle bucket active state
  const toggleBucketActive = async (b: Bucket) => {
    if (b.id == null) return;
    try {
      const now = new Date();
      await db.buckets.update(b.id, {
        isActive: !b.isActive,
        updatedAt: now,
      } as Partial<Bucket>);
      await fetchBuckets();
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to update bucket");
      setShowAlert(true);
    }
  };

  // ========== Categories CRUD ==========

  const resetCategoryForm = () => {
    setCategoryId(null);
    setCategoryName("");
    setCategoryDescription("");
    setCategoryBucketId(null);
    setCategoryIsActive(true);
  };

  // new: toggle category active state
  const toggleCategoryActive = async (c: Category) => {
    if (c.id == null) return;
    try {
      const now = new Date();
      await db.categories.update(c.id, {
        isActive: !c.isActive,
        updatedAt: now,
      } as Partial<Category>);
      await fetchCategories();
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to update category");
      setShowAlert(true);
    }
  };

  const handleAddOrUpdateCategory = async () => {
    if (!categoryName.trim()) {
      setAlertMessage("Category name is required");
      setShowAlert(true);
      return;
    }
    if (categoryBucketId == null) {
      setAlertMessage("Select a bucket for this category");
      setShowAlert(true);
      return;
    }

    const now = new Date();
    try {
      if (categoryId !== null) {
        await db.categories.update(categoryId, {
          name: categoryName.trim(),
          description: categoryDescription.trim() || undefined,
          isActive: categoryIsActive,
          updatedAt: now,
        } as Partial<Category>);
        setAlertMessage("Category updated");
      } else {
        const newCategory: Omit<Category, "id"> = {
          name: categoryName.trim(),
          bucketId: categoryBucketId,
          description: categoryDescription.trim() || undefined,
          isActive: categoryIsActive,
          createdAt: now,
          updatedAt: now,
        };
        await db.categories.add(newCategory);
        setAlertMessage("Category created");
      }
      resetCategoryForm();
      await fetchCategories();
      setShowAlert(true);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to save category");
      setShowAlert(true);
    }
  };

  const editCategory = (c: Category) => {
    setCategoryId(c.id ?? null);
    setCategoryName(c.name ?? "");
    setCategoryDescription(c.description ?? "");
    setCategoryBucketId(c.bucketId ?? null);
    setCategoryIsActive(Boolean(c.isActive));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteCategory = async (id?: number) => {
    if (!id) return;
    try {
      await db.categories.delete(id);
      await fetchCategories();
      setAlertMessage("Category deleted");
      setShowAlert(true);
      setDeleteCategoryId(null);
    } catch (err) {
      console.error(err);
      setAlertMessage("Failed to delete category");
      setShowAlert(true);
    }
  };

  const getCategoriesForBucket = (bId?: number) =>
    categories.filter((c) => c.bucketId === bId);

  // ========== Render ==========
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Manage Buckets</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Bucket form */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {bucketId ? "Edit Bucket" : "Add Bucket"}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">Name</IonLabel>
                    <IonInput
                      value={name}
                      onIonChange={(e) => setName(e.detail.value ?? "")}
                      placeholder="e.g., Essentials"
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">
                      Description (optional)
                    </IonLabel>
                    <IonInput
                      value={description}
                      onIonChange={(e) => setDescription(e.detail.value ?? "")}
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonItem>
                    <IonLabel position="stacked">Min Percentage</IonLabel>
                    <IonInput
                      type="number"
                      value={minPercentage ?? ""}
                      onIonChange={(e) =>
                        setMinPercentage(
                          e.detail.value ? Number(e.detail.value) : undefined
                        )
                      }
                      placeholder="0"
                      min={0}
                      max={100}
                    />
                  </IonItem>
                </IonCol>
                <IonCol size="6">
                  <IonItem>
                    <IonLabel position="stacked">Max Percentage</IonLabel>
                    <IonInput
                      type="number"
                      value={maxPercentage ?? ""}
                      onIonChange={(e) =>
                        setMaxPercentage(
                          e.detail.value ? Number(e.detail.value) : undefined
                        )
                      }
                      placeholder="100"
                      min={0}
                      max={100}
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">
                      Min Fixed Amount (optional)
                    </IonLabel>
                    <IonInput
                      type="number"
                      value={minFixedAmount ?? ""}
                      onIonChange={(e) =>
                        setMinFixedAmount(
                          e.detail.value ? Number(e.detail.value) : undefined
                        )
                      }
                      placeholder="e.g., 20,000"
                      min={0}
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem lines="none">
                    <IonLabel>Active</IonLabel>
                    <IonCheckbox
                      checked={isActive}
                      onIonChange={(e) =>
                        setIsActive(Boolean(e.detail.checked))
                      }
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton expand="block" onClick={saveBucket}>
                    {bucketId ? "Update Bucket" : "Add Bucket"}
                  </IonButton>
                </IonCol>
                {bucketId && (
                  <IonCol>
                    <IonButton
                      expand="block"
                      color="medium"
                      onClick={resetForm}
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* Category form */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              {categoryId ? "Edit Category" : "Add Category"}
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">Bucket</IonLabel>
                    <IonSelect
                      value={categoryBucketId ?? undefined}
                      onIonChange={(e) =>
                        setCategoryBucketId(e.detail.value ?? null)
                      }
                    >
                      <IonSelectOption value={null}>
                        -- select --
                      </IonSelectOption>
                      {buckets.map((b) => (
                        <IonSelectOption key={b.id} value={b.id}>
                          {b.name}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">Name</IonLabel>
                    <IonInput
                      value={categoryName}
                      onIonChange={(e) => setCategoryName(e.detail.value ?? "")}
                      placeholder="e.g., Rent"
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem>
                    <IonLabel position="stacked">
                      Description (optional)
                    </IonLabel>
                    <IonInput
                      value={categoryDescription}
                      onIonChange={(e) =>
                        setCategoryDescription(e.detail.value ?? "")
                      }
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonItem lines="none">
                    <IonLabel>Active</IonLabel>
                    <IonCheckbox
                      checked={categoryIsActive}
                      onIonChange={(e) =>
                        setCategoryIsActive(Boolean(e.detail.checked))
                      }
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonButton expand="block" onClick={handleAddOrUpdateCategory}>
                    {categoryId ? "Update Category" : "Add Category"}
                  </IonButton>
                </IonCol>
                {categoryId && (
                  <IonCol>
                    <IonButton
                      expand="block"
                      color="medium"
                      onClick={resetCategoryForm}
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* Buckets list with categories nested as accordions */}
        <IonAccordionGroup>
          {buckets.map((b) => {
            const bucketCategories = getCategoriesForBucket(b.id);
            return (
              <IonAccordion key={b.id} value={`bucket-${b.id}`}>
                <IonItem slot="header">
                  <IonGrid className="ion-no-padding" style={{ width: "100%" }}>
                    <IonRow style={{ alignItems: "center" }}>
                      {/* Bucket info in center/expand */}
                      <IonCol>
                        <IonLabel style={{ lineHeight: 1 }}>
                          <strong>{b.name}</strong>
                          <p
                            style={{
                              fontSize: "0.85rem",
                              color: "#666",
                              margin: "4px 0 0",
                            }}
                          >
                            {bucketCategories.length}{" "}
                            {bucketCategories.length === 1
                              ? "category"
                              : "categories"}
                          </p>
                        </IonLabel>
                      </IonCol>

                      {/* Buttons on the left */}
                      <IonCol size="auto">
                        <IonButton
                          fill="clear"
                          size="small"
                          color="light"
                          onClick={(e) => {
                            e.stopPropagation();
                            editBucket(b);
                          }}
                          aria-label={`Edit ${b.name}`}
                          title="Edit"
                        >
                          <IonIcon icon={createOutline} />
                        </IonButton>

                        <IonButton
                          fill="clear"
                          size="small"
                          color="light"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBucketActive(b);
                          }}
                          aria-label={
                            b.isActive
                              ? `Deactivate ${b.name}`
                              : `Activate ${b.name}`
                          }
                          title={
                            b.isActive
                              ? "Active (click to deactivate)"
                              : "Inactive (click to activate)"
                          }
                        >
                          <IonIcon
                            icon={
                              b.isActive
                                ? checkmarkCircleOutline
                                : closeCircleOutline
                            }
                          />
                        </IonButton>

                        <IonButton
                          fill="clear"
                          size="small"
                          color="danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteBucketId(b.id ?? null);
                          }}
                          aria-label={`Delete ${b.name}`}
                          title="Delete"
                        >
                          <IonIcon icon={trashOutline} />
                        </IonButton>
                      </IonCol>
                    </IonRow>
                  </IonGrid>
                </IonItem>

                <div slot="content">
                  {getCategoriesForBucket(b.id).length === 0 ? (
                    <div style={{ padding: 16, color: "#666" }}>
                      No categories for this bucket.
                    </div>
                  ) : (
                    <IonList>
                      {getCategoriesForBucket(b.id).map((c) => (
                        <IonItem key={c.id}>
                          <IonLabel>
                            {c.name}
                            {c.description && (
                              <div style={{ fontSize: 12, color: "#666" }}>
                                {c.description}
                              </div>
                            )}
                          </IonLabel>

                          <IonButton
                            slot="end"
                            color="light"
                            fill="clear"
                            onClick={() => editCategory(c)}
                            aria-label={`Edit category ${c.name}`}
                            title="Edit"
                          >
                            <IonIcon icon={createOutline} />
                          </IonButton>
                          <IonButton
                            slot="end"
                            color="light"
                            fill="clear"
                            onClick={() => toggleCategoryActive(c)}
                            aria-label={
                              c.isActive
                                ? `Deactivate ${c.name}`
                                : `Activate ${c.name}`
                            }
                            title={
                              c.isActive
                                ? "Active (click to deactivate)"
                                : "Inactive (click to activate)"
                            }
                          >
                            <IonIcon
                              icon={
                                c.isActive
                                  ? checkmarkCircleOutline
                                  : closeCircleOutline
                              }
                            />
                          </IonButton>
                          <IonButton
                            slot="end"
                            color="danger"
                            fill="clear"
                            onClick={() => setDeleteCategoryId(c.id ?? null)}
                            aria-label={`Delete category ${c.name}`}
                            title="Delete"
                          >
                            <IonIcon icon={trashOutline} />
                          </IonButton>
                        </IonItem>
                      ))}
                    </IonList>
                  )}
                </div>
              </IonAccordion>
            );
          })}
        </IonAccordionGroup>

        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header="Notice"
          message={alertMessage}
          buttons={["OK"]}
        />

        {/* Delete bucket confirmation */}
        <IonAlert
          isOpen={deleteBucketId !== null}
          onDidDismiss={() => setDeleteBucketId(null)}
          header="Confirm Delete"
          message="Are you sure you want to delete this bucket? All associated categories will also be deleted."
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteBucketId) {
                  deleteBucket(deleteBucketId);
                }
              },
            },
          ]}
        />

        {/* Delete category confirmation */}
        <IonAlert
          isOpen={deleteCategoryId !== null}
          onDidDismiss={() => setDeleteCategoryId(null)}
          header="Confirm Delete"
          message="Are you sure you want to delete this category?"
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteCategoryId) {
                  deleteCategory(deleteCategoryId);
                }
              },
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default BucketsManagement;

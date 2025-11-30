import "./BucketsManagement.css";
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
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonIcon,
  IonAccordion,
  IonAccordionGroup,
  IonModal,
  IonFab,
  IonFabButton,
  IonToast,
  IonReorder,
  IonReorderGroup,
  ItemReorderEventDetail,
} from "@ionic/react";
import {
  add,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  close,
  reorderThree,
} from "ionicons/icons";
import { db, Bucket, Category } from "../db";
import { AddCategoryModal } from "../components/AddCategoryModal";

/**
 * BucketsManagement
 * - captures all fields in the Bucket table:
 *   id, name, description, minPercentage, maxPercentage,
 *   minFixedAmount, isActive, createdAt, updatedAt
 *
 * - lists categories under their respective bucket and provides
 *   add / edit / delete functionality for categories.
 */

type DeleteBucketState =
  | { type: "none" }
  | { type: "used"; bucketId: number; bucketName: string }
  | { type: "used_deactivated"; bucketId: number; bucketName: string }
  | { type: "delete"; bucketId: number; bucketName: string };

type DeleteCategoryState =
  | { type: "none" }
  | { type: "used"; categoryId: number; categoryName: string }
  | { type: "used_deactivated"; categoryId: number; categoryName: string }
  | { type: "delete"; categoryId: number; categoryName: string };

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
  const [excludeFromReports, setExcludeFromReports] = useState<boolean>(false);

  // categories state - ADD THIS BACK
  const [categories, setCategories] = useState<Category[]>([]);

  // delete state - ADD THIS BACK
  const [deleteBucketState, setDeleteBucketState] = useState<DeleteBucketState>(
    { type: "none" }
  );
  const [deleteCategoryState, setDeleteCategoryState] =
    useState<DeleteCategoryState>({ type: "none" });

  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [alertMessage] = useState("");
  const [showAlert, setShowAlert] = useState(false);

  // modal states
  const [showBucketModal, setShowBucketModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategoryBucket, setSelectedCategoryBucket] = useState<
    number | undefined
  >(undefined);
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(
    undefined
  );

  useEffect(() => {
    fetchBuckets();
    fetchCategories();
  }, []);

  const fetchBuckets = async () => {
    try {
      const all = await db.buckets.toArray();
      // Sort by displayOrder
      all.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      setBuckets(all);
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to load buckets");
      setShowToast(true);
    }
  };

  const fetchCategories = async () => {
    try {
      const all = await db.categories.toArray();
      setCategories(all);
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to load categories");
      setShowToast(true);
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
    setExcludeFromReports(false);
  };

  const resetCategoryForm = () => {
    setEditingCategory(undefined);
    setSelectedCategoryBucket(undefined);
  };

  const validatePercent = (v?: number) =>
    v === undefined || (v >= 0 && v <= 100);

  const saveBucket = async () => {
    if (!name.trim()) {
      setToastMessage("Bucket name is required");
      setShowToast(true);
      return;
    }
    if (!validatePercent(minPercentage) || !validatePercent(maxPercentage)) {
      setToastMessage("Percentages must be between 0 and 100");
      setShowToast(true);
      return;
    }
    if (
      typeof minPercentage === "number" &&
      typeof maxPercentage === "number" &&
      minPercentage > maxPercentage
    ) {
      setToastMessage("minPercentage cannot be greater than maxPercentage");
      setShowToast(true);
      return;
    }

    const now = new Date();
    const isEditMode = bucketId !== null; // Capture this BEFORE resetting

    try {
      if (isEditMode) {
        // UPDATE MODE: Keep existing displayOrder
        await db.buckets.update(bucketId!, {
          name: name.trim(),
          description: description.trim() || undefined,
          minPercentage: minPercentage ?? 0,
          maxPercentage: maxPercentage ?? 100,
          minFixedAmount: minFixedAmount ?? undefined,
          isActive,
          // displayOrder stays the same (not editable)
          excludeFromReports,
          updatedAt: now,
        } as Partial<Bucket>);
        setToastMessage("Bucket updated");
      } else {
        // ADD MODE: Auto-calculate displayOrder based on bucket count
        const allBuckets = await db.buckets.toArray();
        const newDisplayOrder = allBuckets.length;

        const newBucket: Omit<Bucket, "id"> = {
          name: name.trim(),
          description: description.trim() || undefined,
          minPercentage: minPercentage ?? 0,
          maxPercentage: maxPercentage ?? 100,
          minFixedAmount: minFixedAmount ?? undefined,
          isActive,
          displayOrder: newDisplayOrder,
          excludeFromReports,
          createdAt: now,
          updatedAt: now,
        };
        await db.buckets.add(newBucket);
        setToastMessage("Bucket created");
      }

      // MOVED: Only reset form if we're in add mode
      if (!isEditMode) {
        resetForm();
      }

      await fetchBuckets();
      setShowToast(true);

      // Close modal after successful save (both add and edit)
      handleCloseBucketModal();
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to save bucket");
      setShowToast(true);
    }
  };

  const editBucket = (b: Bucket) => {
    setBucketId(b.id ?? null);
    setName(b.name ?? "");
    setDescription(b.description ?? "");
    setMinPercentage(b.minPercentage);
    setMaxPercentage(b.maxPercentage);
    setMinFixedAmount(b.minFixedAmount);
    setExcludeFromReports(Boolean(b.excludeFromReports));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleBucketActive = async (b: Bucket) => {
    if (b.id == null) return;
    try {
      const now = new Date();
      await db.buckets.update(b.id, {
        isActive: !b.isActive,
        updatedAt: now,
      } as Partial<Bucket>);
      await fetchBuckets();
      setToastMessage(`Bucket ${b.isActive ? "deactivated" : "activated"}`);
      setShowToast(true);
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to update bucket");
      setShowToast(true);
    }
  };

  /**
   * toggleCategoryActive - Toggles category active/inactive status
   */
  const toggleCategoryActive = async (c: Category) => {
    if (c.id == null) return;
    try {
      const now = new Date();
      await db.categories.update(c.id, {
        isActive: !c.isActive,
        updatedAt: now,
      } as Partial<Category>);
      await fetchCategories();
      setToastMessage(`Category ${c.isActive ? "deactivated" : "activated"}`);
      setShowToast(true);
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to update category");
      setShowToast(true);
    }
  };

  const handleCategoryAdded = async (isEdit: boolean = false) => {
    setEditingCategory(undefined);
    setSelectedCategoryBucket(undefined);
    setToastMessage(
      isEdit ? "Category updated successfully!" : "Category added successfully!"
    );
    setShowToast(true);
    await fetchCategories();
  };

  const handleCloseCategoryModal = () => {
    setEditingCategory(undefined);
    setSelectedCategoryBucket(undefined);
    setShowCategoryModal(false);
  };

  const deleteBucket = async (id?: number) => {
    if (!id) return;
    try {
      await db.transaction("rw", db.categories, db.buckets, async () => {
        await db.categories.where("bucketId").equals(id).delete();
        await db.buckets.delete(id);
      });
      await fetchBuckets();
      await fetchCategories();
      setToastMessage("Bucket and its categories deleted");
      setShowToast(true);
      setDeleteBucketState({ type: "none" });
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to delete bucket");
      setShowToast(true);
    }
  };

  const deleteCategory = async (id?: number) => {
    if (!id) return;
    try {
      await db.categories.delete(id);
      await fetchCategories();
      setToastMessage("Category deleted");
      setShowToast(true);
      setDeleteCategoryState({ type: "none" });
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to delete category");
      setShowToast(true);
    }
  };

  const getCategoriesForBucket = (bId?: number) =>
    categories.filter((c) => c.bucketId === bId);

  const handleOpenBucketModal = () => {
    resetForm();
    setShowBucketModal(true);
  };

  const handleCloseBucketModal = () => {
    resetForm();
    setShowBucketModal(false);
  };

  const handleSaveBucket = async () => {
    await saveBucket();
    // Remove the conditional check - let saveBucket handle it
  };

  const handleReorderBuckets = async (
    event: CustomEvent<ItemReorderEventDetail>
  ) => {
    const { from, to } = event.detail;

    // Create a new array with reordered items
    const reorderedBuckets = [...buckets];
    const [movedBucket] = reorderedBuckets.splice(from, 1);
    reorderedBuckets.splice(to, 0, movedBucket);

    // Update displayOrder for all buckets based on new position
    try {
      for (let i = 0; i < reorderedBuckets.length; i++) {
        const bucket = reorderedBuckets[i];
        if (bucket.id) {
          await db.buckets.update(bucket.id, {
            displayOrder: i,
            updatedAt: new Date(),
          } as Partial<Bucket>);
        }
      }
      // Update local state
      setBuckets(reorderedBuckets);
      setToastMessage("Bucket order updated");
      setShowToast(true);
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to update bucket order");
      setShowToast(true);
      await fetchBuckets(); // Reload to revert changes
    }
  };

  /**
   * checkBucketUsage - Determines if bucket has been used in transactions
   */
  const checkBucketUsage = async (bucketId: number): Promise<boolean> => {
    try {
      const transactions = await db.transactions.toArray();
      const categories = await db.categories
        .where("bucketId")
        .equals(bucketId)
        .toArray();
      const categoryIds = categories.map((c) => c.id);
      return transactions.some((txn) => categoryIds.includes(txn.categoryId));
    } catch (error) {
      console.error("Error checking bucket usage:", error);
      return false;
    }
  };

  /**
   * checkCategoryUsage - Determines if category has been used in transactions
   */
  const checkCategoryUsage = async (categoryId: number): Promise<boolean> => {
    try {
      const transactions = await db.transactions.toArray();
      return transactions.some((txn) => txn.categoryId === categoryId);
    } catch (error) {
      console.error("Error checking category usage:", error);
      return false;
    }
  };

  /**
   * initiateBucketDelete - Check bucket usage and show appropriate alert
   */
  const initiateBucketDelete = async (bucket: Bucket) => {
    try {
      const isUsed = await checkBucketUsage(bucket.id!);
      const isDeactivated = bucket.isActive === false;

      if (isUsed && !isDeactivated) {
        // Bucket is ACTIVE and has been used in transactions
        setDeleteBucketState({
          type: "used",
          bucketId: bucket.id!,
          bucketName: bucket.name || "Unknown",
        });
      } else if (isUsed && isDeactivated) {
        // Bucket is DEACTIVATED and has been used in transactions
        // Show informational alert, no deactivate option
        setDeleteBucketState({
          type: "used_deactivated",
          bucketId: bucket.id!,
          bucketName: bucket.name || "Unknown",
        });
      } else {
        // Bucket is unused, safe to delete
        setDeleteBucketState({
          type: "delete",
          bucketId: bucket.id!,
          bucketName: bucket.name || "Unknown",
        });
      }
    } catch (error) {
      console.error("Error checking bucket usage:", error);
    }
  };

  /**
   * initiateCategoryDelete - Check category usage and show appropriate alert
   */
  const initiateCategoryDelete = async (category: Category) => {
    try {
      const isUsed = await checkCategoryUsage(category.id!);
      const isDeactivated = category.isActive === false;

      if (isUsed && !isDeactivated) {
        // Category is ACTIVE and has been used in transactions
        setDeleteCategoryState({
          type: "used",
          categoryId: category.id!,
          categoryName: category.name || "Unknown",
        });
      } else if (isUsed && isDeactivated) {
        // Category is DEACTIVATED and has been used in transactions
        // Show informational alert, no deactivate option
        setDeleteCategoryState({
          type: "used_deactivated",
          categoryId: category.id!,
          categoryName: category.name || "Unknown",
        });
      } else {
        // Category is unused, safe to delete
        setDeleteCategoryState({
          type: "delete",
          categoryId: category.id!,
          categoryName: category.name || "Unknown",
        });
      }
    } catch (error) {
      console.error("Error checking category usage:", error);
    }
  };

  /**
   * handleDeactivateBucket - Deactivates a bucket instead of deleting
   */
  const handleDeactivateBucket = async (bucketId: number) => {
    try {
      const now = new Date();
      await db.buckets.update(bucketId, {
        isActive: false,
        updatedAt: now,
      } as Partial<Bucket>);
      setDeleteBucketState({ type: "none" });
      setToastMessage("Bucket deactivated successfully!");
      setShowToast(true);
      await fetchBuckets();
    } catch (error) {
      console.error("Error deactivating bucket:", error);
      setToastMessage("Failed to deactivate bucket");
      setShowToast(true);
    }
  };

  /**
   * handleDeactivateCategory - Deactivates a category instead of deleting
   */
  const handleDeactivateCategory = async (categoryId: number) => {
    try {
      const now = new Date();
      await db.categories.update(categoryId, {
        isActive: false,
        updatedAt: now,
      } as Partial<Category>);
      setDeleteCategoryState({ type: "none" });
      setToastMessage("Category deactivated successfully!");
      setShowToast(true);
      await fetchCategories();
    } catch (error) {
      console.error("Error deactivating category:", error);
      setToastMessage("Failed to deactivate category");
      setShowToast(true);
    }
  };

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
        {/* FAB button for adding buckets */}
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton onClick={handleOpenBucketModal} title="Add Bucket">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        {/* Buckets list with categories nested as accordions */}
        <IonAccordionGroup>
          <IonReorderGroup
            disabled={false}
            onIonItemReorder={handleReorderBuckets}
          >
            {buckets.map((b) => {
              const bucketCategories = getCategoriesForBucket(b.id);
              const isInactiveBucket = b.isActive === false;
              return (
                <IonAccordion key={b.id} value={`bucket-${b.id}`}>
                  <IonItem slot="header">
                    <IonReorder slot="start">
                      <IonIcon icon={reorderThree} style={{ cursor: "grab" }} />
                    </IonReorder>

                    <IonGrid
                      className="ion-no-padding"
                      style={{ width: "100%" }}
                    >
                      <IonRow style={{ alignItems: "center" }}>
                        {/* Bucket info in center/expand */}
                        <IonCol>
                          <IonLabel style={{ lineHeight: 1 }}>
                            <strong
                              style={{ opacity: isInactiveBucket ? 0.6 : 1 }}
                            >
                              {b.name}
                            </strong>
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

                        {/* Buttons on the right */}
                        <IonCol size="auto">
                          <IonButton
                            fill="clear"
                            size="small"
                            color="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetCategoryForm();
                              setSelectedCategoryBucket(b.id);
                              setShowCategoryModal(true);
                            }}
                            aria-label={`Add category to ${b.name}`}
                            title="Add Category"
                          >
                            <IonIcon icon={add} />
                          </IonButton>

                          <IonButton
                            fill="clear"
                            size="small"
                            color="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              editBucket(b);
                              setShowBucketModal(true);
                            }}
                            aria-label={`Edit ${b.name}`}
                            title="Edit"
                          >
                            <IonIcon icon={createOutline} />
                          </IonButton>

                          <IonButton
                            fill="clear"
                            size="small"
                            color={b.isActive ? "success" : "medium"}
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
                              initiateBucketDelete(b);
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
                        {getCategoriesForBucket(b.id).map((c) => {
                          const isInactiveCategory = c.isActive === false;
                          return (
                            <IonItem key={c.id}>
                              <IonLabel
                                style={{
                                  opacity: isInactiveCategory ? 0.6 : 1,
                                }}
                              >
                                {c.name}
                                {c.description && (
                                  <div style={{ fontSize: 12, color: "#666" }}>
                                    {c.description}
                                  </div>
                                )}
                              </IonLabel>

                              <IonButton
                                slot="end"
                                color="secondary"
                                fill="clear"
                                onClick={() => {
                                  setEditingCategory(c);
                                  setShowCategoryModal(true);
                                }}
                                aria-label={`Edit category ${c.name}`}
                                title="Edit"
                              >
                                <IonIcon icon={createOutline} />
                              </IonButton>
                              <IonButton
                                slot="end"
                                color={c.isActive ? "success" : "medium"}
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
                                onClick={() => initiateCategoryDelete(c)}
                                aria-label={`Delete category ${c.name}`}
                                title="Delete"
                              >
                                <IonIcon icon={trashOutline} />
                              </IonButton>
                            </IonItem>
                          );
                        })}
                      </IonList>
                    )}
                  </div>
                </IonAccordion>
              );
            })}
          </IonReorderGroup>
        </IonAccordionGroup>

        {/* Bucket Modal */}
        <IonModal
          isOpen={showBucketModal}
          onDidDismiss={handleCloseBucketModal}
        >
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="end">
                <IonButton onClick={handleCloseBucketModal}>
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
              <IonTitle>{bucketId ? "Edit Bucket" : "Add Bucket"}</IonTitle>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonGrid>
              <IonRow>
                <IonCol>
                  <IonInput
                    label="Name"
                    labelPlacement="stacked"
                    fill="outline"
                    value={name}
                    onIonChange={(e) => setName(e.detail.value ?? "")}
                    placeholder="e.g., Essentials"
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol>
                  <IonInput
                    label="Description (optional)"
                    labelPlacement="stacked"
                    fill="outline"
                    value={description}
                    onIonChange={(e) => setDescription(e.detail.value ?? "")}
                  />
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol size="6">
                  <IonInput
                    label="Min Percentage"
                    labelPlacement="stacked"
                    fill="outline"
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
                </IonCol>
                <IonCol size="6">
                  <IonInput
                    label="Max Percentage"
                    labelPlacement="stacked"
                    fill="outline"
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
                </IonCol>
              </IonRow>

              <IonRow>
                <IonCol sizeMd="6">
                  <IonInput
                    label="Min Fixed Amount (optional)"
                    labelPlacement="stacked"
                    fill="outline"
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
                </IonCol>
                <IonCol size="6">
                  <IonItem lines="none">
                    <IonLabel>Exclude from Reports</IonLabel>
                    <IonCheckbox
                      checked={excludeFromReports}
                      onIonChange={(e) =>
                        setExcludeFromReports(Boolean(e.detail.checked))
                      }
                    />
                  </IonItem>
                </IonCol>
              </IonRow>

              {/* REMOVED: Active checkbox - buckets are toggled via the toggle button in the list */}
              {/* This checkbox should not appear in either add or edit mode */}

              <IonRow>
                <IonCol>
                  <IonButton expand="block" onClick={handleSaveBucket}>
                    {bucketId ? "Update Bucket" : "Add Bucket"}
                  </IonButton>
                </IonCol>
              </IonRow>
            </IonGrid>
          </IonContent>
        </IonModal>

        {/* Replace inline category form with AddCategoryModal component */}
        <AddCategoryModal
          isOpen={showCategoryModal}
          onClose={handleCloseCategoryModal}
          onCategoryAdded={() => handleCategoryAdded(!!editingCategory)}
          buckets={buckets}
          preSelectedBucketId={selectedCategoryBucket}
          editingCategory={editingCategory}
        />

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMessage}
          duration={2000}
          position="top"
          color="success"
        />

        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header="Notice"
          message={alertMessage}
          buttons={["OK"]}
        />

        {/* Delete bucket confirmation */}
        <IonAlert
          isOpen={deleteBucketState.type === "used_deactivated"}
          onDidDismiss={() => setDeleteBucketState({ type: "none" })}
          header="Cannot Delete Used Bucket"
          message={`This bucket (${
            deleteBucketState.type === "used_deactivated"
              ? deleteBucketState.bucketName
              : ""
          }) has been used in transactions and cannot be deleted. Deactivated buckets will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "OK",
              role: "cancel",
            },
          ]}
        />

        {/* ALERT: Active bucket has been used in transactions (offer to deactivate) */}
        <IonAlert
          isOpen={deleteBucketState.type === "used"}
          onDidDismiss={() => setDeleteBucketState({ type: "none" })}
          header="Cannot Delete Used Bucket"
          message={`This bucket (${
            deleteBucketState.type === "used"
              ? deleteBucketState.bucketName
              : ""
          }) has been used in transactions and cannot be deleted. Would you like to deactivate it instead? Deactivated buckets will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Deactivate",
              role: "destructive",
              handler: () => {
                if (deleteBucketState.type === "used") {
                  handleDeactivateBucket(deleteBucketState.bucketId);
                }
              },
            },
          ]}
        />

        {/* ALERT: Delete unused bucket */}
        <IonAlert
          isOpen={deleteBucketState.type === "delete"}
          onDidDismiss={() => setDeleteBucketState({ type: "none" })}
          header="Confirm Delete"
          message={`Are you sure you want to delete "${
            deleteBucketState.type === "delete"
              ? deleteBucketState.bucketName
              : ""
          }"? All associated categories will also be deleted. This action cannot be undone.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteBucketState.type === "delete") {
                  deleteBucket(deleteBucketState.bucketId);
                }
              },
            },
          ]}
        />

        {/* ALERTS FOR CATEGORIES */}

        {/* ALERT: Deactivated category has been used in transactions */}
        <IonAlert
          isOpen={deleteCategoryState.type === "used_deactivated"}
          onDidDismiss={() => setDeleteCategoryState({ type: "none" })}
          header="Cannot Delete Used Category"
          message={`This category (${
            deleteCategoryState.type === "used_deactivated"
              ? deleteCategoryState.categoryName
              : ""
          }) has been used in transactions and cannot be deleted. Deactivated categories will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "OK",
              role: "cancel",
            },
          ]}
        />

        {/* ALERT: Active category has been used in transactions (offer to deactivate) */}
        <IonAlert
          isOpen={deleteCategoryState.type === "used"}
          onDidDismiss={() => setDeleteCategoryState({ type: "none" })}
          header="Cannot Delete Used Category"
          message={`This category (${
            deleteCategoryState.type === "used"
              ? deleteCategoryState.categoryName
              : ""
          }) has been used in transactions and cannot be deleted. Would you like to deactivate it instead? Deactivated categories will no longer appear in dropdowns but will remain in your records.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Deactivate",
              role: "destructive",
              handler: () => {
                if (deleteCategoryState.type === "used") {
                  handleDeactivateCategory(deleteCategoryState.categoryId);
                }
              },
            },
          ]}
        />

        {/* ALERT: Delete unused category */}
        <IonAlert
          isOpen={deleteCategoryState.type === "delete"}
          onDidDismiss={() => setDeleteCategoryState({ type: "none" })}
          header="Confirm Delete"
          message={`Are you sure you want to delete "${
            deleteCategoryState.type === "delete"
              ? deleteCategoryState.categoryName
              : ""
          }"? This action cannot be undone.`}
          buttons={[
            {
              text: "Cancel",
              role: "cancel",
            },
            {
              text: "Delete",
              role: "destructive",
              handler: () => {
                if (deleteCategoryState.type === "delete") {
                  deleteCategory(deleteCategoryState.categoryId);
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

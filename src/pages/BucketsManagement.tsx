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
  IonCard,
  IonCardContent,
  IonText,
  IonBadge,
  IonSpinner,
  IonSelect,
  IonSelectOption,
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
  warningOutline,
  gitMergeOutline,
} from "ionicons/icons";
import { db, Bucket, Category } from "../db";
import {
  AddCategoryModal,
  type CategoryFormValues,
} from "../components/AddCategoryModal";
import { SqliteAuthorityToolbarStatus } from "../components/SqliteAuthorityRehearsalBanner";
import {
  getRepositoryBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { useSqliteAuthorityRehearsal } from "../contexts/SqliteAuthorityRehearsalContext";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { categoryRepository, transactionRepository } from "../repositories";
import { SelectedReadPreviewCard } from "../components/dev/SelectedReadPreviewCard";
import {
  booleanValue,
  type DevPreviewListResult,
  isSelectedReadPreviewsEnabled,
  numberValue,
  previewCount,
  previewRows,
  safePreviewErrorCode,
  sampledIds,
  stringValue,
} from "../utils/devPreview";
import {
  bucketCategoryWriteErrorCode,
  createBucketInDisposableSqlite,
  createCategoryInDisposableSqlite,
  isBucketsCategoriesWriteExperimentEnabled,
  type BucketWriteInput,
  updateBucketInDisposableSqlite,
  updateCategoryInDisposableSqlite,
} from "../repositories/http/bucketCategoryWriteExperiment";
import {
  categoryLifecycleErrorCode,
  dryRunCategoryDelete,
  dryRunCategoryMerge,
  isCategoryDeleteMergeWriteExperimentEnabled,
  writeCategoryDelete,
  writeCategoryMerge,
} from "../repositories/http/categoryDeleteMergeWriteExperiment";
import {
  bucketLifecycleErrorCode,
  dryRunBucketDelete,
  dryRunBucketMerge,
  isBucketDeleteMergeWriteExperimentEnabled,
  writeBucketDelete,
  writeBucketMerge,
} from "../repositories/http/bucketDeleteMergeWriteExperiment";

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
  | {
      type: "delete";
      bucketId: number;
      bucketName: string;
      planFingerprint?: string;
    };

type DeleteCategoryState =
  | { type: "none" }
  | { type: "used"; categoryId: number; categoryName: string }
  | { type: "used_deactivated"; categoryId: number; categoryName: string }
  | {
      type: "delete";
      categoryId: number;
      categoryName: string;
      planFingerprint?: string;
    };

interface SelectedReadPreviewRow {
  id?: number;
}

interface SelectedReadCategoryPreviewRow extends SelectedReadPreviewRow {
  bucketId?: number;
  isActive?: boolean | null;
}

interface SelectedReadBucketPreviewRow extends SelectedReadPreviewRow {
  displayOrder?: number;
  isActive?: boolean | null;
}

interface SelectedReadCategoriesPreview {
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  categories: {
    count?: number;
    loadedRowCount?: number;
    sampledIds?: number[];
    rows: SelectedReadCategoryPreviewRow[];
  };
  buckets: {
    count?: number;
    loadedRowCount?: number;
    sampledIds?: number[];
    rows: SelectedReadBucketPreviewRow[];
  };
  errorCode?: string;
}

const SELECTED_READ_PREVIEW_LIMIT = 20;
const BUCKETS_CATEGORIES_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_BUCKETS_CATEGORIES_READ_EXPERIMENT";
const BUCKETS_CATEGORIES_READ_EXPERIMENT_LIMIT = 500;

const isBucketsCategoriesReadExperimentEnabled = (): boolean => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[BUCKETS_CATEGORIES_READ_EXPERIMENT_FLAG]?.trim() === "true";
};

const dateValue = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
};

const selectedReadRowToBucket = (row: { id?: unknown }): Bucket => {
  const source = row as Record<string, unknown>;

  return {
    id: numberValue(source.id),
    name: stringValue(source.name),
    description: stringValue(source.description),
    minPercentage: numberValue(source.minPercentage) ?? 0,
    maxPercentage: numberValue(source.maxPercentage) ?? 100,
    minFixedAmount: numberValue(source.minFixedAmount),
    isActive: booleanValue(source.isActive) !== false,
    displayOrder: numberValue(source.displayOrder) ?? 0,
    excludeFromReports: booleanValue(source.excludeFromReports) === true,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

const selectedReadRowToCategory = (row: { id?: unknown }): Category => {
  const source = row as Record<string, unknown>;

  return {
    id: numberValue(source.id),
    name: stringValue(source.name),
    bucketId: numberValue(source.bucketId) ?? 0,
    description: stringValue(source.description),
    isActive: booleanValue(source.isActive) !== false,
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt),
  };
};

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
  const showSelectedReadPreview = isSelectedReadPreviewsEnabled();
  const [selectedReadPreview, setSelectedReadPreview] =
    useState<SelectedReadCategoriesPreview | null>(null);
  const [selectedReadPreviewLoading, setSelectedReadPreviewLoading] =
    useState(false);
  const [bucketsReadExperimentCount, setBucketsReadExperimentCount] =
    useState<number | undefined>(undefined);
  const [categoriesReadExperimentCount, setCategoriesReadExperimentCount] =
    useState<number | undefined>(undefined);
  const [mergeSourceCategory, setMergeSourceCategory] =
    useState<Category | null>(null);
  const [mergeTargetCategoryId, setMergeTargetCategoryId] =
    useState<number | undefined>(undefined);
  const [categoryLifecycleBusy, setCategoryLifecycleBusy] = useState(false);
  const [mergeSourceBucket, setMergeSourceBucket] = useState<Bucket | null>(null);
  const [mergeTargetBucketId, setMergeTargetBucketId] = useState<
    number | undefined
  >(undefined);
  const [bucketLifecycleBusy, setBucketLifecycleBusy] = useState(false);

  // modal states
  const [showBucketModal, setShowBucketModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategoryBucket, setSelectedCategoryBucket] = useState<
    number | undefined
  >(undefined);
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(
    undefined
  );

  const selectedBackend = getRepositoryBackend();
  const rehearsal = useSqliteAuthorityRehearsal();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(selectedBackend);
  const bucketsCategoriesReadExperimentEnabled =
    isBucketsCategoriesReadExperimentEnabled();
  const bucketsCategoriesWriteExperimentEnabled =
    isBucketsCategoriesWriteExperimentEnabled();
  const categoryDeleteMergeWriteExperimentEnabled =
    isCategoryDeleteMergeWriteExperimentEnabled();
  const bucketDeleteMergeWriteExperimentEnabled =
    isBucketDeleteMergeWriteExperimentEnabled();
  const bucketsCategoriesSqliteWriteExperimentActive =
    (bucketsCategoriesWriteExperimentEnabled &&
      selectedBackend === "http-readonly") ||
    (rehearsalSelected && rehearsal.ready);
  const bucketsCategoriesReadExperimentHttpReadonly =
    rehearsalSelected ||
    ((bucketsCategoriesReadExperimentEnabled ||
      bucketsCategoriesWriteExperimentEnabled) &&
      selectedBackend === "http-readonly");
  const bucketsCategoriesHttpReadonlyWithoutWrites =
    bucketsCategoriesReadExperimentHttpReadonly &&
    !bucketsCategoriesSqliteWriteExperimentActive;
  const categoryDeleteMergeWriteExperimentActive =
    rehearsalSelected &&
    rehearsal.ready &&
    rehearsal.categoryDeleteMergeWritesAvailable &&
    categoryDeleteMergeWriteExperimentEnabled;
  const bucketDeleteMergeWriteExperimentActive =
    rehearsalSelected &&
    rehearsal.ready &&
    rehearsal.bucketDeleteMergeWritesAvailable &&
    bucketDeleteMergeWriteExperimentEnabled;

  const showReadExperimentWriteDisabledToast = () => {
    setToastMessage(
      "Enable the Buckets/Categories write experiment or switch back to Dexie",
    );
    setShowToast(true);
  };

  const safeBucketCategoryWriteMessage = (error: unknown): string => {
    const code = bucketCategoryWriteErrorCode(error);
    if (code === "bucket_category_writes_disabled") {
      return "Server Buckets/Categories write flag is off.";
    }
    if (
      code === "local_api_base_url_missing" ||
      code === "local_api_token_missing" ||
      code === "local_api_request_failed"
    ) {
      return "Local API is unavailable or not configured.";
    }
    return `Bucket/category write failed: ${code}`;
  };

  const safeCategoryLifecycleMessage = (error: unknown): string => {
    const code = categoryLifecycleErrorCode(error);
    if (code === "category_delete_merge_writes_disabled") {
      return "Server Category delete/merge flag is off.";
    }
    if (
      code === "local_api_base_url_missing" ||
      code === "local_api_token_missing" ||
      code === "local_api_request_failed"
    ) {
      return "Local API is unavailable or not configured.";
    }
    return `Category lifecycle failed: ${code}`;
  };

  const safeBucketLifecycleMessage = (error: unknown): string => {
    const code = bucketLifecycleErrorCode(error);
    if (code === "bucket_delete_merge_writes_disabled") {
      return "Server Bucket delete/merge flag is off.";
    }
    if (
      code === "local_api_base_url_missing" ||
      code === "local_api_token_missing" ||
      code === "local_api_request_failed"
    ) {
      return "Local API is unavailable or not configured.";
    }
    return `Bucket lifecycle failed: ${code}`;
  };

  useEffect(() => {
    fetchBuckets();
    fetchCategories();
  }, []);

  const fetchBuckets = async () => {
    try {
      let all: Bucket[];
      let selectedReadCount: number | undefined;

      if (bucketsCategoriesReadExperimentHttpReadonly) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.buckets.list({
          limit: BUCKETS_CATEGORIES_READ_EXPERIMENT_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_buckets_read_experiment_response");
        }

        all = rows.map(selectedReadRowToBucket);
        selectedReadCount = previewCount(result as DevPreviewListResult);
      } else {
        all = await categoryRepository.listBuckets();
      }

      setBucketsReadExperimentCount(selectedReadCount);
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
      let all: Category[];
      let selectedReadCount: number | undefined;

      if (bucketsCategoriesReadExperimentHttpReadonly) {
        const repositories = getSelectedReadRepositories(selectedBackend);
        const result = await repositories.categories.list({
          limit: BUCKETS_CATEGORIES_READ_EXPERIMENT_LIMIT,
          offset: 0,
        });
        const rows = previewRows(result as DevPreviewListResult);

        if (!rows) {
          throw new Error("invalid_categories_read_experiment_response");
        }

        all = rows
          .map(selectedReadRowToCategory)
          .sort(
            (left, right) =>
              (left.id ?? Number.MAX_SAFE_INTEGER) -
              (right.id ?? Number.MAX_SAFE_INTEGER),
          );
        selectedReadCount = previewCount(result as DevPreviewListResult);
      } else {
        all = await categoryRepository.listCategories();
      }

      setCategoriesReadExperimentCount(selectedReadCount);
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
    if (bucketsCategoriesHttpReadonlyWithoutWrites) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
      if (bucketsCategoriesSqliteWriteExperimentActive) {
        const input: BucketWriteInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          minPercentage: minPercentage ?? 0,
          maxPercentage: maxPercentage ?? 100,
          minFixedAmount,
          excludeFromReports,
        };
        if (isEditMode) {
          await updateBucketInDisposableSqlite(bucketId!, input);
          setToastMessage(rehearsal.authoritativeMode ? "Bucket updated in authoritative SQLite" : "Bucket updated in disposable SQLite");
        } else {
          await createBucketInDisposableSqlite(input);
          setToastMessage(rehearsal.authoritativeMode ? "Bucket created in authoritative SQLite" : "Bucket created in disposable SQLite");
        }
      } else if (isEditMode) {
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
      setToastMessage(
        bucketsCategoriesSqliteWriteExperimentActive
          ? safeBucketCategoryWriteMessage(err)
          : "Failed to save bucket",
      );
      setShowToast(true);
    }
  };

  const editBucket = (b: Bucket) => {
    if (bucketsCategoriesHttpReadonlyWithoutWrites) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      return;
    }

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
    if (bucketsCategoriesHttpReadonlyWithoutWrites) {
      showReadExperimentWriteDisabledToast();
      return;
    }

    setEditingCategory(undefined);
    setSelectedCategoryBucket(undefined);
    setToastMessage(
      isEdit ? "Category updated successfully!" : "Category added successfully!"
    );
    setShowToast(true);
    await fetchCategories();
  };

  const handleSqliteCategorySave = async (
    input: CategoryFormValues,
    currentCategory?: Category,
  ) => {
    try {
      if (currentCategory?.id) {
        await updateCategoryInDisposableSqlite(currentCategory.id, input);
        setToastMessage(rehearsal.authoritativeMode ? "Category updated in authoritative SQLite" : "Category updated in disposable SQLite");
      } else {
        await createCategoryInDisposableSqlite(input);
        setToastMessage(rehearsal.authoritativeMode ? "Category created in authoritative SQLite" : "Category created in disposable SQLite");
      }
      await fetchCategories();
      setShowToast(true);
    } catch (error) {
      const message = safeBucketCategoryWriteMessage(error);
      setToastMessage(message);
      setShowToast(true);
      throw new Error(message);
    }
  };

  const handleCloseCategoryModal = () => {
    setEditingCategory(undefined);
    setSelectedCategoryBucket(undefined);
    setShowCategoryModal(false);
  };

  const deleteBucket = async (id?: number, planFingerprint?: string) => {
    if (
      bucketsCategoriesReadExperimentHttpReadonly &&
      !bucketDeleteMergeWriteExperimentActive
    ) {
      showReadExperimentWriteDisabledToast();
      setDeleteBucketState({ type: "none" });
      return;
    }

    if (!id) return;
    try {
      if (bucketDeleteMergeWriteExperimentActive) {
        if (!planFingerprint) throw new Error("bucket_delete_plan_missing");
        await writeBucketDelete(id, planFingerprint);
        try {
          await refreshBucketLifecycleReads();
          setToastMessage(
            rehearsal.authoritativeMode
              ? "Empty Bucket deleted in authoritative SQLite. Rotate the checkpoint before restart."
              : "Empty Bucket deleted in disposable SQLite.",
          );
        } catch {
          setToastMessage(
            "Bucket was written to SQLite, but refresh failed. SQLite may already have changed.",
          );
        }
      } else {
        await db.transaction("rw", db.categories, db.buckets, async () => {
          await db.categories.where("bucketId").equals(id).delete();
          await db.buckets.delete(id);
        });
        await fetchBuckets();
        await fetchCategories();
        setToastMessage("Bucket and its categories deleted");
      }
      setShowToast(true);
      setDeleteBucketState({ type: "none" });
    } catch (err) {
      console.error(err);
      setToastMessage(
        bucketDeleteMergeWriteExperimentActive
          ? safeBucketLifecycleMessage(err)
          : "Failed to delete bucket",
      );
      setShowToast(true);
    }
  };

  const refreshCategoryLifecycleReads = async (): Promise<void> => {
    const repositories = getSelectedReadRepositories(selectedBackend);
    await Promise.all([
      fetchCategories(),
      repositories.transactions.list({ limit: 1, offset: 0 }),
      repositories.budgets.list({ limit: 1, offset: 0 }),
      repositories.budgetSnapshots.list({ limit: 1, offset: 0 }),
    ]);
  };

  const refreshBucketLifecycleReads = async (): Promise<void> => {
    const repositories = getSelectedReadRepositories(selectedBackend);
    await Promise.all([
      fetchBuckets(),
      fetchCategories(),
      repositories.transactions.list({ limit: 1, offset: 0 }),
      repositories.budgets.list({ limit: 1, offset: 0 }),
      repositories.budgetSnapshots.list({ limit: 1, offset: 0 }),
    ]);
  };

  const deleteCategory = async (
    id?: number,
    planFingerprint?: string,
  ) => {
    if (
      bucketsCategoriesReadExperimentHttpReadonly &&
      !categoryDeleteMergeWriteExperimentActive
    ) {
      showReadExperimentWriteDisabledToast();
      setDeleteCategoryState({ type: "none" });
      return;
    }

    if (!id) return;
    try {
      if (categoryDeleteMergeWriteExperimentActive) {
        if (!planFingerprint) throw new Error("category_delete_plan_missing");
        await writeCategoryDelete(id, planFingerprint);
        try {
          await refreshCategoryLifecycleReads();
          setToastMessage(
            rehearsal.authoritativeMode
              ? "Category deleted in authoritative SQLite. Rotate the checkpoint before restart."
              : "Unused Category deleted in disposable SQLite.",
          );
        } catch {
          setToastMessage(
            "Category was written to SQLite, but refresh failed. SQLite may already have changed.",
          );
        }
      } else {
        await db.categories.delete(id);
        await fetchCategories();
        setToastMessage("Category deleted");
      }
      setShowToast(true);
      setDeleteCategoryState({ type: "none" });
    } catch (err) {
      console.error(err);
      setToastMessage(
        categoryDeleteMergeWriteExperimentActive
          ? safeCategoryLifecycleMessage(err)
          : "Failed to delete category",
      );
      setShowToast(true);
    }
  };

  const getCategoriesForBucket = (bId?: number) =>
    categories.filter((c) => c.bucketId === bId);

  const loadSelectedReadPreview = async () => {
    setSelectedReadPreviewLoading(true);
    setSelectedReadPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const listOptions = {
        limit: SELECTED_READ_PREVIEW_LIMIT,
        offset: 0,
      };
      const [categoryResult, bucketResult] = await Promise.all([
        repositories.categories.list(listOptions),
        repositories.buckets.list(listOptions),
      ]);
      const categoryRows = previewRows(
        categoryResult as DevPreviewListResult,
      );
      const bucketRows = previewRows(
        bucketResult as DevPreviewListResult,
      );

      if (!categoryRows || !bucketRows) {
        setSelectedReadPreview({
          status: "fail",
          backend,
          source,
          categories: { rows: [] },
          buckets: { rows: [] },
          errorCode: "invalid_selected_read_preview_response",
        });
        return;
      }

      const categoryPreviewRows = categoryRows.slice(
        0,
        SELECTED_READ_PREVIEW_LIMIT,
      );
      const bucketPreviewRows = bucketRows.slice(
        0,
        SELECTED_READ_PREVIEW_LIMIT,
      );

      setSelectedReadPreview({
        status: "pass",
        backend,
        source,
        categories: {
          count: previewCount(categoryResult as DevPreviewListResult),
          loadedRowCount: categoryPreviewRows.length,
          sampledIds: sampledIds(categoryPreviewRows, SELECTED_READ_PREVIEW_LIMIT),
          rows: categoryPreviewRows.map((row) => ({
            id: numberValue(row.id),
            bucketId: numberValue((row as { bucketId?: unknown }).bucketId),
            isActive: booleanValue((row as { isActive?: unknown }).isActive),
          })),
        },
        buckets: {
          count: previewCount(bucketResult as DevPreviewListResult),
          loadedRowCount: bucketPreviewRows.length,
          sampledIds: sampledIds(bucketPreviewRows, SELECTED_READ_PREVIEW_LIMIT),
          rows: bucketPreviewRows.map((row) => ({
            id: numberValue(row.id),
            displayOrder: numberValue(
              (row as { displayOrder?: unknown }).displayOrder,
            ),
            isActive: booleanValue((row as { isActive?: unknown }).isActive),
          })),
        },
      });
    } catch (error) {
      setSelectedReadPreview({
        status: "fail",
        backend,
        source,
        categories: { rows: [] },
        buckets: { rows: [] },
        errorCode: safePreviewErrorCode(error),
      });
    } finally {
      setSelectedReadPreviewLoading(false);
    }
  };

  const handleOpenBucketModal = () => {
    if (bucketsCategoriesHttpReadonlyWithoutWrites) {
      showReadExperimentWriteDisabledToast();
      return;
    }

    resetForm();
    setShowBucketModal(true);
  };

  const handleCloseBucketModal = () => {
    resetForm();
    setShowBucketModal(false);
  };

  const handleSaveBucket = async () => {
    if (bucketsCategoriesHttpReadonlyWithoutWrites) {
      showReadExperimentWriteDisabledToast();
      return;
    }

    await saveBucket();
    // Remove the conditional check - let saveBucket handle it
  };

  const handleReorderBuckets = async (
    event: CustomEvent<ItemReorderEventDetail>
  ) => {
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      event.detail.complete();
      showReadExperimentWriteDisabledToast();
      return;
    }

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
      const categories = await categoryRepository.listCategoriesForBucket(
        bucketId
      );
      const categoryIds = categories.map((c) => c.id);
      return transactionRepository.categoriesHaveTransactions(categoryIds);
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
      return transactionRepository.categoryHasTransactions(categoryId);
    } catch (error) {
      console.error("Error checking category usage:", error);
      return false;
    }
  };

  /**
   * initiateBucketDelete - Check bucket usage and show appropriate alert
   */
  const initiateBucketDelete = async (bucket: Bucket) => {
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      if (!bucketDeleteMergeWriteExperimentActive || !bucket.id) {
        showReadExperimentWriteDisabledToast();
        return;
      }
      setBucketLifecycleBusy(true);
      try {
        const dryRun = await dryRunBucketDelete(bucket.id);
        if (!dryRun.eligible) {
          setToastMessage(
            `Bucket cannot be deleted: ${dryRun.categoryCount} Categories and ` +
              `${dryRun.sourceReferenceCount} direct references remain. Merge or clean up manually.`,
          );
          setShowToast(true);
          return;
        }
        setDeleteBucketState({
          type: "delete",
          bucketId: bucket.id,
          bucketName: bucket.name || "Unknown",
          planFingerprint: dryRun.planFingerprint,
        });
      } catch (error) {
        setToastMessage(safeBucketLifecycleMessage(error));
        setShowToast(true);
      } finally {
        setBucketLifecycleBusy(false);
      }
      return;
    }

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

  const openBucketMerge = (bucket: Bucket) => {
    if (!bucketDeleteMergeWriteExperimentActive || !bucket.id) {
      showReadExperimentWriteDisabledToast();
      return;
    }
    setMergeSourceBucket(bucket);
    setMergeTargetBucketId(undefined);
  };

  const runBucketMerge = async () => {
    const sourceId = mergeSourceBucket?.id;
    const targetId = mergeTargetBucketId;
    if (!sourceId || !targetId) {
      setToastMessage("Choose a compatible target Bucket.");
      setShowToast(true);
      return;
    }

    setBucketLifecycleBusy(true);
    try {
      const dryRun = await dryRunBucketMerge(sourceId, targetId);
      const counts = dryRun.referenceCountsByEntity;
      const confirmed = window.confirm(
        `Move ${dryRun.categoriesProposedForMove} Categories to the selected target? ` +
          `Direct references: transactions ${counts.transactions}, budgets ${counts.budgets}, ` +
          `snapshots ${counts.budgetSnapshots}, SMS templates ${counts.smsImportTemplates}. ` +
          "The source Bucket will be permanently removed, Category IDs and metadata remain " +
          "unchanged, the target remains unchanged, and Bucket-grouped history consolidates " +
          "under the target.",
      );
      if (!confirmed) return;

      await writeBucketMerge(sourceId, targetId, dryRun.planFingerprint!);
      setMergeSourceBucket(null);
      setMergeTargetBucketId(undefined);
      try {
        await refreshBucketLifecycleReads();
        setToastMessage(
          rehearsal.authoritativeMode
            ? "Buckets merged in authoritative SQLite. Rotate the checkpoint before restart."
            : "Buckets merged in disposable SQLite.",
        );
      } catch {
        setToastMessage(
          "Bucket merge completed, but refresh failed. SQLite may already have changed.",
        );
      }
      setShowToast(true);
    } catch (error) {
      setToastMessage(safeBucketLifecycleMessage(error));
      setShowToast(true);
    } finally {
      setBucketLifecycleBusy(false);
    }
  };

  /**
   * initiateCategoryDelete - Check category usage and show appropriate alert
   */
  const initiateCategoryDelete = async (category: Category) => {
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      if (!categoryDeleteMergeWriteExperimentActive || !category.id) {
        showReadExperimentWriteDisabledToast();
        return;
      }
      setCategoryLifecycleBusy(true);
      try {
        const dryRun = await dryRunCategoryDelete(category.id);
        if (!dryRun.eligible) {
          const counts = dryRun.referenceCountsByEntity;
          setToastMessage(
            `Category is referenced and cannot be deleted (transactions ${counts.transactions}, budgets ${counts.budgets}, snapshots ${counts.budgetSnapshots}). Merge or clean up manually.`,
          );
          setShowToast(true);
          return;
        }
        setDeleteCategoryState({
          type: "delete",
          categoryId: category.id,
          categoryName: category.name || "Unknown",
          planFingerprint: dryRun.planFingerprint,
        });
      } catch (error) {
        setToastMessage(safeCategoryLifecycleMessage(error));
        setShowToast(true);
      } finally {
        setCategoryLifecycleBusy(false);
      }
      return;
    }

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

  const openCategoryMerge = (category: Category) => {
    if (!categoryDeleteMergeWriteExperimentActive || !category.id) {
      showReadExperimentWriteDisabledToast();
      return;
    }
    setMergeSourceCategory(category);
    setMergeTargetCategoryId(undefined);
  };

  const runCategoryMerge = async () => {
    const sourceId = mergeSourceCategory?.id;
    const targetId = mergeTargetCategoryId;
    if (!sourceId || !targetId) {
      setToastMessage("Choose a target Category in the same Bucket.");
      setShowToast(true);
      return;
    }

    setCategoryLifecycleBusy(true);
    try {
      const dryRun = await dryRunCategoryMerge(sourceId, targetId);
      const counts = dryRun.referenceCountsByEntity;
      const confirmed = window.confirm(
        `Merge ${dryRun.sourceReferenceCount} references into the selected target? ` +
          `Transactions: ${counts.transactions}; Budgets: ${counts.budgets}; ` +
          `Budget snapshots: ${counts.budgetSnapshots}. The source Category will be ` +
          "permanently removed, target fields remain unchanged, and categorized history " +
          "will consolidate under the target.",
      );
      if (!confirmed) return;

      await writeCategoryMerge(sourceId, targetId, dryRun.planFingerprint!);
      setMergeSourceCategory(null);
      setMergeTargetCategoryId(undefined);
      try {
        await refreshCategoryLifecycleReads();
        setToastMessage(
          rehearsal.authoritativeMode
            ? "Categories merged in authoritative SQLite. Rotate the checkpoint before restart."
            : "Categories merged in disposable SQLite.",
        );
      } catch {
        setToastMessage(
          "Category merge completed, but refresh failed. SQLite may already have changed.",
        );
      }
      setShowToast(true);
    } catch (error) {
      setToastMessage(safeCategoryLifecycleMessage(error));
      setShowToast(true);
    } finally {
      setCategoryLifecycleBusy(false);
    }
  };

  /**
   * handleDeactivateBucket - Deactivates a bucket instead of deleting
   */
  const handleDeactivateBucket = async (bucketId: number) => {
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      setDeleteBucketState({ type: "none" });
      return;
    }

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
    if (bucketsCategoriesReadExperimentHttpReadonly) {
      showReadExperimentWriteDisabledToast();
      setDeleteCategoryState({ type: "none" });
      return;
    }

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
          <SqliteAuthorityToolbarStatus />
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* FAB button for adding buckets */}
        {(!bucketsCategoriesReadExperimentHttpReadonly ||
          bucketsCategoriesSqliteWriteExperimentActive) && (
          <IonFab vertical="bottom" horizontal="end" slot="fixed">
            <IonFabButton onClick={handleOpenBucketModal} title="Add Bucket">
              <IonIcon icon={add} />
            </IonFabButton>
          </IonFab>
        )}

        {showSelectedReadPreview && (
          <SelectedReadPreviewCard
            resourceLabel="Selected-read categories and buckets"
            loading={selectedReadPreviewLoading}
            onLoad={() => void loadSelectedReadPreview()}
            description="This preview uses the selected read facade only when manually loaded. It does not replace this management screen or change create, edit, delete, or reorder actions."
          >
              {selectedReadPreview && (
                <IonList>
                  <IonItem>
                    <IonLabel>Backend / source</IonLabel>
                    <IonText slot="end">
                      {selectedReadPreview.backend} /{" "}
                      {selectedReadPreview.source}
                    </IonText>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Status</IonLabel>
                    <IonBadge
                      color={
                        selectedReadPreview.status === "pass"
                          ? "success"
                          : "danger"
                      }
                      slot="end"
                    >
                      {selectedReadPreview.status === "pass" ? "Pass" : "Fail"}
                    </IonBadge>
                  </IonItem>
                  {selectedReadPreview.errorCode && (
                    <IonItem>
                      <IonLabel>Safe error code</IonLabel>
                      <IonText slot="end">
                        {selectedReadPreview.errorCode}
                      </IonText>
                    </IonItem>
                  )}
                  <IonItem>
                    <IonLabel>
                      <h3>Categories</h3>
                      <p>
                        count={selectedReadPreview.categories.count ?? "-"}{" "}
                        loaded=
                        {selectedReadPreview.categories.loadedRowCount ?? "-"}{" "}
                        sampledIds=
                        {selectedReadPreview.categories.sampledIds?.length
                          ? selectedReadPreview.categories.sampledIds.join(", ")
                          : "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                  {selectedReadPreview.categories.rows.map((category) => (
                    <IonItem key={`selected-category-${category.id ?? "none"}`}>
                      <IonLabel>
                        <h3>category id={category.id ?? "-"}</h3>
                        <p>
                          bucketId={category.bucketId ?? "-"} isActive=
                          {category.isActive === undefined
                            ? "-"
                            : String(category.isActive)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                  <IonItem>
                    <IonLabel>
                      <h3>Buckets</h3>
                      <p>
                        count={selectedReadPreview.buckets.count ?? "-"} loaded=
                        {selectedReadPreview.buckets.loadedRowCount ?? "-"}{" "}
                        sampledIds=
                        {selectedReadPreview.buckets.sampledIds?.length
                          ? selectedReadPreview.buckets.sampledIds.join(", ")
                          : "-"}
                      </p>
                    </IonLabel>
                  </IonItem>
                  {selectedReadPreview.buckets.rows.map((bucket) => (
                    <IonItem key={`selected-bucket-${bucket.id ?? "none"}`}>
                      <IonLabel>
                        <h3>bucket id={bucket.id ?? "-"}</h3>
                        <p>
                          displayOrder={bucket.displayOrder ?? "-"} isActive=
                          {bucket.isActive === undefined
                            ? "-"
                            : String(bucket.isActive)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  ))}
                </IonList>
              )}
          </SelectedReadPreviewCard>
        )}

        {(bucketsCategoriesReadExperimentEnabled ||
          bucketsCategoriesWriteExperimentEnabled) && (
          <IonCard
            style={{
              marginBottom: "16px",
              borderLeft: bucketsCategoriesReadExperimentHttpReadonly
                ? "4px solid var(--ion-color-warning)"
                : "4px solid var(--ion-color-medium)",
            }}
          >
            <IonCardContent>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <IonIcon
                  icon={warningOutline}
                  style={{
                    color: bucketsCategoriesReadExperimentHttpReadonly
                      ? "var(--ion-color-warning)"
                      : "var(--ion-color-medium)",
                    fontSize: "1.5rem",
                  }}
                />
                <div>
                  <p
                    style={{
                      margin: "0 0 6px 0",
                      fontWeight: 600,
                    }}
                  >
                    {bucketsCategoriesSqliteWriteExperimentActive
                      ? rehearsal.authoritativeMode
                        ? bucketDeleteMergeWriteExperimentActive
                          ? "SQLite authoritative mode is active. Bucket delete/merge is dry-run-first and exact-ID only; reordering remains disabled. Rotate the checkpoint after lifecycle writes."
                          : categoryDeleteMergeWriteExperimentActive
                            ? "SQLite authoritative mode is active. Category delete/merge is dry-run-first and exact-ID only; Bucket delete and reorder remain disabled. Rotate the checkpoint after lifecycle writes."
                          : "SQLite authoritative mode is active. Supported Bucket and Category create/update writes use the verified local SQLite database; delete, merge, and reorder remain disabled."
                        : "Buckets and Categories SQLite write experiment is active. Writes go to disposable local SQLite only. Dexie remains authoritative. Re-import SQLite from backup before clean parity checks."
                      : bucketsCategoriesReadExperimentHttpReadonly
                        ? "Buckets/Categories read experiment is active. List is loaded through selected-read `http-readonly`; writes and reorder actions are disabled. Switch back to Dexie to edit."
                      : "Buckets/Categories experiment flag is active with the Dexie backend. Existing Dexie write and reorder behavior remains available."}
                  </p>
                  <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>
                    Backend: {selectedBackend}
                    {bucketsCategoriesSqliteWriteExperimentActive &&
                      !bucketDeleteMergeWriteExperimentActive &&
                      "; Bucket create/update only; active-state, delete, merge, and reorder actions remain unavailable."}
                    {bucketDeleteMergeWriteExperimentActive &&
                      "; Bucket delete/merge enabled; active-state and reorder actions remain unavailable."}
                    {bucketsCategoriesReadExperimentHttpReadonly &&
                      bucketsReadExperimentCount !== undefined &&
                      bucketsReadExperimentCount > buckets.length &&
                      `; loaded first ${buckets.length} of ${bucketsReadExperimentCount} buckets.`}
                    {bucketsCategoriesReadExperimentHttpReadonly &&
                      categoriesReadExperimentCount !== undefined &&
                      categoriesReadExperimentCount > categories.length &&
                      `; loaded first ${categories.length} of ${categoriesReadExperimentCount} categories.`}
                  </p>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        )}

        {/* Buckets list with categories nested as accordions */}
        <IonAccordionGroup>
          <IonReorderGroup
            disabled={bucketsCategoriesReadExperimentHttpReadonly}
            onIonItemReorder={handleReorderBuckets}
          >
            {buckets.map((b) => {
              const bucketCategories = getCategoriesForBucket(b.id);
              const isInactiveBucket = b.isActive === false;
              return (
                <IonAccordion key={b.id} value={`bucket-${b.id}`}>
                  <IonItem slot="header">
                    {!bucketsCategoriesReadExperimentHttpReadonly && (
                      <IonReorder slot="start">
                        <IonIcon
                          icon={reorderThree}
                          style={{ cursor: "grab" }}
                        />
                      </IonReorder>
                    )}

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
                        {(!bucketsCategoriesReadExperimentHttpReadonly ||
                          bucketsCategoriesSqliteWriteExperimentActive) && (
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

                            {!bucketsCategoriesReadExperimentHttpReadonly && (
                              <>
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
                              </>
                            )}
                            {bucketDeleteMergeWriteExperimentActive && (
                              <>
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  color="secondary"
                                  disabled={bucketLifecycleBusy}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openBucketMerge(b);
                                  }}
                                  aria-label={`Merge Bucket ${b.name}`}
                                  title="Merge Bucket"
                                >
                                  <IonIcon icon={gitMergeOutline} />
                                </IonButton>
                                <IonButton
                                  fill="clear"
                                  size="small"
                                  color="danger"
                                  disabled={bucketLifecycleBusy}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    initiateBucketDelete(b);
                                  }}
                                  aria-label={`Delete unused Bucket ${b.name}`}
                                  title="Delete empty Bucket"
                                >
                                  <IonIcon icon={trashOutline} />
                                </IonButton>
                              </>
                            )}
                          </IonCol>
                        )}
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

                              {(!bucketsCategoriesReadExperimentHttpReadonly ||
                                bucketsCategoriesSqliteWriteExperimentActive) && (
                                <>
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
                                  {!bucketsCategoriesReadExperimentHttpReadonly && (
                                    <>
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
                                    </>
                                  )}
                                  {categoryDeleteMergeWriteExperimentActive && (
                                    <>
                                      <IonButton
                                        slot="end"
                                        color="secondary"
                                        fill="clear"
                                        disabled={categoryLifecycleBusy}
                                        onClick={() => openCategoryMerge(c)}
                                        aria-label={`Merge category ${c.name}`}
                                        title="Merge"
                                      >
                                        <IonIcon icon={gitMergeOutline} />
                                      </IonButton>
                                      <IonButton
                                        slot="end"
                                        color="danger"
                                        fill="clear"
                                        disabled={categoryLifecycleBusy}
                                        onClick={() => initiateCategoryDelete(c)}
                                        aria-label={`Delete category ${c.name}`}
                                        title="Delete unused Category"
                                      >
                                        <IonIcon icon={trashOutline} />
                                      </IonButton>
                                    </>
                                  )}
                                </>
                              )}
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
        {(!bucketsCategoriesReadExperimentHttpReadonly ||
          bucketsCategoriesSqliteWriteExperimentActive) && (
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
        )}

        {/* Replace inline category form with AddCategoryModal component */}
        {(!bucketsCategoriesReadExperimentHttpReadonly ||
          bucketsCategoriesSqliteWriteExperimentActive) && (
          <AddCategoryModal
            isOpen={showCategoryModal}
            onClose={handleCloseCategoryModal}
            onCategoryAdded={() => handleCategoryAdded(!!editingCategory)}
            buckets={buckets}
            preSelectedBucketId={selectedCategoryBucket}
            editingCategory={editingCategory}
            onSaveCategory={
              bucketsCategoriesSqliteWriteExperimentActive
                ? handleSqliteCategorySave
                : undefined
            }
          />
        )}

        <IonModal
          isOpen={mergeSourceBucket !== null}
          onDidDismiss={() => {
            setMergeSourceBucket(null);
            setMergeTargetBucketId(undefined);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Merge Bucket</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setMergeSourceBucket(null);
                    setMergeTargetBucketId(undefined);
                  }}
                >
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonText>
              <p>
                Select a compatible target. Source Categories will move without
                changing IDs or metadata, the source will be removed, and the
                target fields and ordering remain unchanged.
              </p>
            </IonText>
            <IonSelect
              label="Target Bucket"
              labelPlacement="stacked"
              fill="outline"
              value={mergeTargetBucketId}
              onIonChange={(event) =>
                setMergeTargetBucketId(numberValue(event.detail.value))
              }
            >
              {buckets
                .filter(
                  (bucket) =>
                    bucket.id !== mergeSourceBucket?.id &&
                    bucket.isActive === mergeSourceBucket?.isActive &&
                    !bucket.excludeFromReports &&
                    !mergeSourceBucket?.excludeFromReports,
                )
                .map((bucket) => (
                  <IonSelectOption key={bucket.id} value={bucket.id}>
                    {bucket.name || `Bucket ${bucket.id}`}
                  </IonSelectOption>
                ))}
            </IonSelect>
            <IonButton
              expand="block"
              color="danger"
              disabled={bucketLifecycleBusy || !mergeTargetBucketId}
              onClick={runBucketMerge}
              style={{ marginTop: 16 }}
            >
              {bucketLifecycleBusy ? <IonSpinner /> : "Review Merge"}
            </IonButton>
          </IonContent>
        </IonModal>

        <IonModal
          isOpen={mergeSourceCategory !== null}
          onDidDismiss={() => {
            setMergeSourceCategory(null);
            setMergeTargetCategoryId(undefined);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Merge Category</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setMergeSourceCategory(null);
                    setMergeTargetCategoryId(undefined);
                  }}
                >
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonText>
              <p>
                Select a target in the same Bucket. The source will be removed,
                exact references will move, and the target fields will remain
                unchanged.
              </p>
            </IonText>
            <IonSelect
              label="Target Category"
              labelPlacement="stacked"
              fill="outline"
              value={mergeTargetCategoryId}
              onIonChange={(event) =>
                setMergeTargetCategoryId(numberValue(event.detail.value))
              }
            >
              {categories
                .filter(
                  (category) =>
                    category.id !== mergeSourceCategory?.id &&
                    category.bucketId === mergeSourceCategory?.bucketId,
                )
                .map((category) => (
                  <IonSelectOption key={category.id} value={category.id}>
                    {category.name || `Category ${category.id}`}
                  </IonSelectOption>
                ))}
            </IonSelect>
            <IonButton
              expand="block"
              color="danger"
              disabled={categoryLifecycleBusy || !mergeTargetCategoryId}
              onClick={runCategoryMerge}
              style={{ marginTop: 16 }}
            >
              {categoryLifecycleBusy ? <IonSpinner /> : "Review Merge"}
            </IonButton>
          </IonContent>
        </IonModal>

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
          message={
            bucketDeleteMergeWriteExperimentActive
              ? `Delete "${
                  deleteBucketState.type === "delete"
                    ? deleteBucketState.bucketName
                    : ""
                }"? The dry-run confirmed it has no Categories or references. Only this Bucket will be removed. This action cannot be undone.`
              : `Are you sure you want to delete "${
                  deleteBucketState.type === "delete"
                    ? deleteBucketState.bucketName
                    : ""
                }"? All associated categories will also be deleted. This action cannot be undone.`
          }
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
                  deleteBucket(
                    deleteBucketState.bucketId,
                    deleteBucketState.planFingerprint,
                  );
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
          message={`${categoryDeleteMergeWriteExperimentActive ? "The dry-run confirms this Category is unused. " : ""}Are you sure you want to delete "${
            deleteCategoryState.type === "delete"
              ? deleteCategoryState.categoryName
              : ""
          }"? This action cannot be undone.${categoryDeleteMergeWriteExperimentActive && rehearsal.authoritativeMode ? " Rotate the authoritative checkpoint before restart." : ""}`}
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
                  deleteCategory(
                    deleteCategoryState.categoryId,
                    deleteCategoryState.planFingerprint,
                  );
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

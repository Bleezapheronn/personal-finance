import React, { useMemo, useState } from "react";
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import {
  bugOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  flaskOutline,
  playCircleOutline,
} from "ionicons/icons";

import {
  getRepositoryBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { runRepositoryBackendSelectionDiagnostics } from "../repositories/backendSelectionDiagnostics";
import { runSelectedReadRepositoryDiagnostics } from "../repositories/selectedReadRepositoryDiagnostics";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { runLocalApiReadParityDiagnostics } from "../repositories/http/localApiParityDiagnostics";

const LOCAL_API_DIAGNOSTICS_FLAG =
  "VITE_PERSONAL_FINANCE_SHOW_LOCAL_API_DIAGNOSTICS";
const PREVIEW_LIMIT = 5;
const CATEGORIES_PREVIEW_LIMIT = 20;

type DiagnosticStatus = "idle" | "running" | "pass" | "fail";

interface DiagnosticSummary {
  key: string;
  title: string;
  status: DiagnosticStatus;
  ok?: boolean;
  comparedChecks?: number;
  failedChecks?: number;
  totalMismatches?: number;
  sampledIds?: number[];
  codes?: string[];
  errorCode?: string;
}

interface PreviewSummary {
  resource: string;
  status: "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  errorCode?: string;
}

interface CategoryPreviewRow {
  id?: number;
  bucketId?: number;
  isActive?: boolean | null;
}

interface BucketPreviewRow {
  id?: number;
  displayOrder?: number;
  isActive?: boolean | null;
}

interface CategoriesPreviewSummary {
  status: "idle" | "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  categories: {
    count?: number;
    loadedRowCount?: number;
    sampledIds?: number[];
    rows: CategoryPreviewRow[];
  };
  buckets: {
    count?: number;
    loadedRowCount?: number;
    sampledIds?: number[];
    rows: BucketPreviewRow[];
  };
  errorCode?: string;
}

type PreviewListResult = Array<{ id?: unknown }> | {
  count?: unknown;
  rows?: unknown;
};

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const isLocalApiDiagnosticsEnabled = (): boolean =>
  getEnvValue(LOCAL_API_DIAGNOSTICS_FLAG) === "true";

const safeErrorCode = (error: unknown): string => {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }

  if (error instanceof TypeError) {
    return "local_api_unavailable";
  }

  return "diagnostic_failed";
};

const uniqueCodes = (
  checks: Array<{
    code?: string;
    mismatches?: Array<{ code?: string }>;
  }>,
): string[] => {
  const codes = new Set<string>();

  for (const check of checks) {
    if (check.code) {
      codes.add(check.code);
    }

    for (const mismatch of check.mismatches ?? []) {
      if (mismatch.code) {
        codes.add(mismatch.code);
      }
    }
  }

  return Array.from(codes).sort();
};

const sampledIds = (checks: Array<{ sampledIds?: number[] }>): number[] => {
  const ids = new Set<number>();

  for (const check of checks) {
    for (const id of check.sampledIds ?? []) {
      ids.add(id);
    }
  }

  return Array.from(ids).sort((left, right) => left - right).slice(0, 12);
};

const previewRows = (
  result: PreviewListResult,
): Array<{ id?: unknown }> | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  return Array.isArray(result.rows)
    ? (result.rows as Array<{ id?: unknown }>)
    : undefined;
};

const previewCount = (
  result: PreviewListResult,
  _rows: Array<{ id?: unknown }>,
): number | undefined => {
  if (Array.isArray(result)) {
    return undefined;
  }

  return typeof result.count === "number" ? result.count : undefined;
};

const previewSampledIds = (rows: Array<{ id?: unknown }>): number[] =>
  rows
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, PREVIEW_LIMIT);

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown): boolean | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return undefined;
};

const statusColor = (summary: DiagnosticSummary): string => {
  if (summary.status === "pass") {
    return "success";
  }

  if (summary.status === "fail") {
    return "danger";
  }

  if (summary.status === "running") {
    return "warning";
  }

  return "medium";
};

const statusText = (summary: DiagnosticSummary): string => {
  if (summary.status === "running") {
    return "Running";
  }

  if (summary.status === "pass") {
    return "Pass";
  }

  if (summary.status === "fail") {
    return "Fail";
  }

  return "Not run";
};

const previewStatusColor = (summary: PreviewSummary): string =>
  summary.status === "pass" ? "success" : "danger";

const ResultCard: React.FC<{
  summary: DiagnosticSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>{summary.title}</h3>
      </IonText>
      <IonBadge color={statusColor(summary)}>{statusText(summary)}</IonBadge>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>OK</IonLabel>
          <IonText slot="end">{summary.ok === undefined ? "-" : String(summary.ok)}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Compared checks</IonLabel>
          <IonText slot="end">{summary.comparedChecks ?? "-"}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Failed checks</IonLabel>
          <IonText slot="end">{summary.failedChecks ?? "-"}</IonText>
        </IonItem>
        {summary.totalMismatches !== undefined && (
          <IonItem>
            <IonLabel>Total mismatches</IonLabel>
            <IonText slot="end">{summary.totalMismatches}</IonText>
          </IonItem>
        )}
        {summary.errorCode && (
          <IonItem>
            <IonLabel>Safe error code</IonLabel>
            <IonText slot="end">{summary.errorCode}</IonText>
          </IonItem>
        )}
        {summary.codes && summary.codes.length > 0 && (
          <IonItem>
            <IonLabel>Result codes</IonLabel>
            <IonText slot="end">{summary.codes.join(", ")}</IonText>
          </IonItem>
        )}
        {summary.sampledIds && summary.sampledIds.length > 0 && (
          <IonItem>
            <IonLabel>Sampled IDs</IonLabel>
            <IonText slot="end">{summary.sampledIds.join(", ")}</IonText>
          </IonItem>
        )}
      </IonList>
    </IonCardContent>
  </IonCard>
);

const PreviewResultCard: React.FC<{
  summaries: PreviewSummary[];
}> = ({ summaries }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Selected Read Preview Results</h3>
      </IonText>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        {summaries.map((summary) => (
          <IonItem key={summary.resource}>
            <IonLabel>
              <h3>{summary.resource}</h3>
              <p>
                backend={summary.backend} source={summary.source}
              </p>
              <p>
                count={summary.count ?? "-"} loaded=
                {summary.loadedRowCount ?? "-"} sampledIds=
                {summary.sampledIds?.length
                  ? summary.sampledIds.join(", ")
                  : "-"}
              </p>
              {summary.errorCode && <p>code={summary.errorCode}</p>}
            </IonLabel>
            <IonBadge color={previewStatusColor(summary)} slot="end">
              {summary.status === "pass" ? "Pass" : "Fail"}
            </IonBadge>
          </IonItem>
        ))}
      </IonList>
    </IonCardContent>
  </IonCard>
);

const CategoriesPreviewCard: React.FC<{
  summary: CategoriesPreviewSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Categories Preview Results</h3>
      </IonText>
      <IonBadge color={summary.status === "pass" ? "success" : "danger"}>
        {summary.status === "pass" ? "Pass" : "Fail"}
      </IonBadge>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>Backend / source</IonLabel>
          <IonText slot="end">
            {summary.backend} / {summary.source}
          </IonText>
        </IonItem>
        {summary.errorCode && (
          <IonItem>
            <IonLabel>Safe error code</IonLabel>
            <IonText slot="end">{summary.errorCode}</IonText>
          </IonItem>
        )}
        <IonItem>
          <IonLabel>
            <h3>Categories</h3>
            <p>
              count={summary.categories.count ?? "-"} loaded=
              {summary.categories.loadedRowCount ?? "-"} sampledIds=
              {summary.categories.sampledIds?.length
                ? summary.categories.sampledIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        {summary.categories.rows.map((category) => (
          <IonItem key={`category-${category.id ?? "unknown"}`}>
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
              count={summary.buckets.count ?? "-"} loaded=
              {summary.buckets.loadedRowCount ?? "-"} sampledIds=
              {summary.buckets.sampledIds?.length
                ? summary.buckets.sampledIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        {summary.buckets.rows.map((bucket) => (
          <IonItem key={`bucket-${bucket.id ?? "unknown"}`}>
            <IonLabel>
              <h3>bucket id={bucket.id ?? "-"}</h3>
              <p>
                displayOrder={bucket.displayOrder ?? "-"} isActive=
                {bucket.isActive === undefined ? "-" : String(bucket.isActive)}
              </p>
            </IonLabel>
          </IonItem>
        ))}
      </IonList>
    </IonCardContent>
  </IonCard>
);

const LocalApiDiagnostics: React.FC = () => {
  const enabled = isLocalApiDiagnosticsEnabled();
  const currentBackend = getRepositoryBackend();
  const selectedSource = useMemo(
    () => getSelectedReadRepositories(currentBackend).source,
    [currentBackend],
  );
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [previewSummaries, setPreviewSummaries] = useState<PreviewSummary[]>([]);
  const [categoriesPreview, setCategoriesPreview] =
    useState<CategoriesPreviewSummary | null>(null);
  const [summaries, setSummaries] = useState<Record<string, DiagnosticSummary>>({
    backend: {
      key: "backend",
      title: "Backend Selection",
      status: "idle",
    },
    selectedRead: {
      key: "selectedRead",
      title: "Selected Read Facade",
      status: "idle",
    },
    parity: {
      key: "parity",
      title: "Dexie vs HTTP Parity",
      status: "idle",
    },
  });

  const updateSummary = (summary: DiagnosticSummary): void => {
    setSummaries((current) => ({
      ...current,
      [summary.key]: summary,
    }));
  };

  const loadPreviewResource = async (
    resource: string,
    load: () => Promise<unknown>,
    backend: RepositoryBackend,
    source: string,
  ): Promise<PreviewSummary> => {
    try {
      const result = await load();
      const rows = previewRows(result as PreviewListResult);

      if (!rows) {
        return {
          resource,
          status: "fail",
          backend,
          source,
          errorCode: "invalid_preview_response",
        };
      }

      return {
        resource,
        status: "pass",
        backend,
        source,
        count: previewCount(result as PreviewListResult, rows),
        loadedRowCount: Math.min(rows.length, PREVIEW_LIMIT),
        sampledIds: previewSampledIds(rows.slice(0, PREVIEW_LIMIT)),
      };
    } catch (error) {
      return {
        resource,
        status: "fail",
        backend,
        source,
        errorCode: safeErrorCode(error),
      };
    }
  };

  const loadSelectedReadPreview = async (): Promise<void> => {
    const key = "preview";
    setRunningKey(key);
    setPreviewSummaries([]);

    try {
      const backend = getRepositoryBackend();
      const repositories = getSelectedReadRepositories(backend);
      const source = repositories.source;
      const listOptions = { limit: PREVIEW_LIMIT, offset: 0 };
      const results = await Promise.all([
        loadPreviewResource(
          "transactions",
          () => repositories.transactions.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "accounts",
          () => repositories.accounts.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "buckets",
          () => repositories.buckets.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "categories",
          () => repositories.categories.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "recipients",
          () => repositories.recipients.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "budgets",
          () => repositories.budgets.list(listOptions),
          backend,
          source,
        ),
        loadPreviewResource(
          "budget snapshots",
          () => repositories.budgetSnapshots.list(listOptions),
          backend,
          source,
        ),
      ]);

      setPreviewSummaries(results);
    } finally {
      setRunningKey(null);
    }
  };

  const loadCategoriesPreview = async (): Promise<void> => {
    const key = "categoriesPreview";
    setRunningKey(key);
    setCategoriesPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;

    try {
      const listOptions = { limit: CATEGORIES_PREVIEW_LIMIT, offset: 0 };
      const [categoryResult, bucketResult] = await Promise.all([
        repositories.categories.list(listOptions),
        repositories.buckets.list(listOptions),
      ]);
      const categoryRows = previewRows(categoryResult as PreviewListResult);
      const bucketRows = previewRows(bucketResult as PreviewListResult);

      if (!categoryRows || !bucketRows) {
        setCategoriesPreview({
          status: "fail",
          backend,
          source,
          categories: { rows: [] },
          buckets: { rows: [] },
          errorCode: "invalid_categories_preview_response",
        });
        return;
      }

      const visibleCategoryRows = categoryRows.slice(0, CATEGORIES_PREVIEW_LIMIT);
      const visibleBucketRows = bucketRows.slice(0, CATEGORIES_PREVIEW_LIMIT);

      setCategoriesPreview({
        status: "pass",
        backend,
        source,
        categories: {
          count: previewCount(categoryResult as PreviewListResult, categoryRows),
          loadedRowCount: visibleCategoryRows.length,
          sampledIds: previewSampledIds(visibleCategoryRows),
          rows: visibleCategoryRows.map((row) => ({
            id: numberValue(row.id),
            bucketId: numberValue((row as { bucketId?: unknown }).bucketId),
            isActive: booleanValue((row as { isActive?: unknown }).isActive),
          })),
        },
        buckets: {
          count: previewCount(bucketResult as PreviewListResult, bucketRows),
          loadedRowCount: visibleBucketRows.length,
          sampledIds: previewSampledIds(visibleBucketRows),
          rows: visibleBucketRows.map((row) => ({
            id: numberValue(row.id),
            displayOrder: numberValue(
              (row as { displayOrder?: unknown }).displayOrder,
            ),
            isActive: booleanValue((row as { isActive?: unknown }).isActive),
          })),
        },
      });
    } catch (error) {
      setCategoriesPreview({
        status: "fail",
        backend,
        source,
        categories: { rows: [] },
        buckets: { rows: [] },
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const runBackendDiagnostic = (): void => {
    const key = "backend";
    setRunningKey(key);
    updateSummary({ ...summaries[key], status: "running" });

    try {
      const result = runRepositoryBackendSelectionDiagnostics();
      updateSummary({
        key,
        title: "Backend Selection",
        status: result.ok ? "pass" : "fail",
        ok: result.ok,
        comparedChecks: result.comparedChecks,
        failedChecks: result.failedChecks,
        codes: uniqueCodes(result.checks),
      });
    } catch (error) {
      updateSummary({
        key,
        title: "Backend Selection",
        status: "fail",
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const runSelectedReadDiagnostic = async (): Promise<void> => {
    const key = "selectedRead";
    setRunningKey(key);
    updateSummary({ ...summaries[key], status: "running" });

    try {
      const result = await runSelectedReadRepositoryDiagnostics();
      updateSummary({
        key,
        title: "Selected Read Facade",
        status: result.ok ? "pass" : "fail",
        ok: result.ok,
        comparedChecks: result.comparedChecks,
        failedChecks: result.failedChecks,
        sampledIds: sampledIds(result.checks),
        codes: uniqueCodes(result.checks),
      });
    } catch (error) {
      updateSummary({
        key,
        title: "Selected Read Facade",
        status: "fail",
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const runParityDiagnostic = async (): Promise<void> => {
    const key = "parity";
    setRunningKey(key);
    updateSummary({ ...summaries[key], status: "running" });

    try {
      const result = await runLocalApiReadParityDiagnostics();
      updateSummary({
        key,
        title: "Dexie vs HTTP Parity",
        status: result.ok ? "pass" : "fail",
        ok: result.ok,
        comparedChecks: result.comparedChecks,
        failedChecks: result.failedChecks,
        totalMismatches: result.totalMismatches,
        sampledIds: sampledIds(result.checks),
        codes: uniqueCodes(result.checks),
      });
    } catch (error) {
      updateSummary({
        key,
        title: "Dexie vs HTTP Parity",
        status: "fail",
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const isRunning = runningKey !== null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Local API Diagnostics</IonTitle>
          <IonIcon
            aria-hidden="true"
            icon={flaskOutline}
            slot="end"
            style={{ paddingRight: "16px" }}
          />
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {!enabled ? (
          <IonCard>
            <IonCardHeader>
              <IonText>
                <h3>Diagnostics Disabled</h3>
              </IonText>
            </IonCardHeader>
            <IonCardContent>
              <IonText color="medium">
                <p>
                  Local API diagnostics are hidden by default. Enable them only
                  for local development with the documented Vite environment
                  flag.
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        ) : (
          <>
            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Prototype Status</h3>
                </IonText>
                <IonBadge color="warning">Dev only</IonBadge>
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  <IonItem>
                    <IonLabel>Repository backend</IonLabel>
                    <IonText slot="end">{currentBackend}</IonText>
                  </IonItem>
                  <IonItem>
                    <IonLabel>Selected source</IonLabel>
                    <IonText slot="end">{selectedSource}</IonText>
                  </IonItem>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={checkmarkCircleOutline}
                      slot="start"
                      color="success"
                    />
                    <IonLabel>Dexie remains authoritative</IonLabel>
                  </IonItem>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={bugOutline}
                      slot="start"
                      color="warning"
                    />
                    <IonLabel>HTTP mode is read-only and experimental</IonLabel>
                  </IonItem>
                </IonList>
              </IonCardContent>
            </IonCard>

            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Manual Checks</h3>
                </IonText>
                {isRunning && <IonSpinner name="crescent" />}
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>Backend selection diagnostic</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={runBackendDiagnostic}
                      disabled={isRunning}
                    >
                      Run
                    </IonButton>
                  </IonItem>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>Selected read facade diagnostic</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void runSelectedReadDiagnostic()}
                      disabled={isRunning}
                    >
                      Run
                    </IonButton>
                  </IonItem>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>Dexie vs HTTP parity diagnostic</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void runParityDiagnostic()}
                      disabled={isRunning}
                    >
                      Run
                    </IonButton>
                  </IonItem>
                </IonList>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    Diagnostics run only when selected. Results below are
                    summary-only and omit raw finance rows.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {Object.values(summaries).map((summary) => (
              <ResultCard key={summary.key} summary={summary} />
            ))}

            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Selected Read Preview</h3>
                </IonText>
                {runningKey === "preview" && <IonSpinner name="crescent" />}
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>Load small selected-read resource summaries</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void loadSelectedReadPreview()}
                      disabled={isRunning}
                    >
                      Load
                    </IonButton>
                  </IonItem>
                </IonList>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    Loads up to five rows per resource through the selected read
                    facade and displays only counts, sampled IDs, status, and
                    safe error codes.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {previewSummaries.length > 0 && (
              <PreviewResultCard summaries={previewSummaries} />
            )}

            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Categories Preview</h3>
                </IonText>
                {runningKey === "categoriesPreview" && (
                  <IonSpinner name="crescent" />
                )}
              </IonCardHeader>
              <IonCardContent>
                <IonList>
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>
                      Load selected-read categories and buckets structure
                    </IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void loadCategoriesPreview()}
                      disabled={isRunning}
                    >
                      Load
                    </IonButton>
                  </IonItem>
                </IonList>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    Loads a small read-only preview of categories and buckets
                    through the selected read facade. Names, descriptions, and
                    raw rows are not shown.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {categoriesPreview && (
              <CategoriesPreviewCard summary={categoriesPreview} />
            )}

            {Object.values(summaries).some(
              (summary) => summary.status === "fail",
            ) && (
              <IonCard>
                <IonCardHeader>
                  <IonIcon
                    aria-hidden="true"
                    icon={closeCircleOutline}
                    color="danger"
                  />
                  <IonText>
                    <h3>Failure Notes</h3>
                  </IonText>
                </IonCardHeader>
                <IonCardContent>
                  <IonText color="medium">
                    <p>
                      HTTP diagnostic failures usually mean the local API URL,
                      token, server, CORS origin, or disposable SQLite
                      configuration is missing. This screen does not display
                      those values.
                    </p>
                  </IonText>
                </IonCardContent>
              </IonCard>
            )}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default LocalApiDiagnostics;

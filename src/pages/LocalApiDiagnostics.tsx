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
import {
  runSelectedReadOrderingDiagnostics,
  type SelectedReadOrderingCheck,
} from "../repositories/selectedReadOrderingDiagnostics";
import {
  runRecipientsReadExperimentDiagnostics,
  type RecipientsReadExperimentDiagnosticResult,
} from "../repositories/recipientsReadExperimentDiagnostics";
import {
  runBucketsCategoriesReadExperimentDiagnostics,
  type BucketsCategoriesReadExperimentDiagnosticResult,
} from "../repositories/bucketsCategoriesReadExperimentDiagnostics";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import { runLocalApiReadParityDiagnostics } from "../repositories/http/localApiParityDiagnostics";
import {
  booleanValue,
  type DevPreviewListResult,
  numberValue,
  previewCount,
  previewRows,
  safePreviewErrorCode,
  sampledIds as previewSampledIds,
} from "../utils/devPreview";

const LOCAL_API_DIAGNOSTICS_FLAG =
  "VITE_PERSONAL_FINANCE_SHOW_LOCAL_API_DIAGNOSTICS";
const PREVIEW_LIMIT = 5;
const CATEGORIES_PREVIEW_LIMIT = 20;
const REPORTS_PREVIEW_LIMIT = 50;

type DiagnosticStatus = "idle" | "running" | "pass" | "fail";

interface DiagnosticSummary {
  key: string;
  title: string;
  status: DiagnosticStatus;
  ok?: boolean;
  comparedChecks?: number;
  failedChecks?: number;
  totalMismatches?: number;
  sampledIds?: Array<number | string>;
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

interface ReportsPreviewSummary {
  status: "idle" | "pass" | "fail";
  backend: RepositoryBackend;
  source: string;
  window: string;
  count?: number;
  loadedRowCount?: number;
  sampledIds?: number[];
  incomeCount?: number;
  expenseCount?: number;
  transferCount?: number;
  incomeTotal?: number;
  expenseTotal?: number;
  netTotal?: number;
  limitation: string;
  errorCode?: string;
}

interface OrderingDiagnosticSummary {
  sampleLimit: number;
  comparisonUsesNormalizedIds: boolean;
  checks: SelectedReadOrderingCheck[];
}

type RecipientsReadExperimentSummary =
  RecipientsReadExperimentDiagnosticResult;
type BucketsCategoriesReadExperimentSummary =
  BucketsCategoriesReadExperimentDiagnosticResult;

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

export const isLocalApiDiagnosticsEnabled = (): boolean =>
  getEnvValue(LOCAL_API_DIAGNOSTICS_FLAG) === "true";

const safeErrorCode = (error: unknown): string =>
  safePreviewErrorCode(error, "diagnostic_failed");

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

const roundCurrencyTotal = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const reportAmount = (row: { amount?: unknown; transactionCost?: unknown }) => {
  const amount = numberValue(row.amount) ?? 0;
  const transactionCost = numberValue(row.transactionCost) ?? 0;
  return amount + transactionCost;
};

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

const ReportsPreviewCard: React.FC<{
  summary: ReportsPreviewSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Reports Diagnostic Results</h3>
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
        <IonItem>
          <IonLabel>Window</IonLabel>
          <IonText slot="end">{summary.window}</IonText>
        </IonItem>
        {summary.errorCode && (
          <IonItem>
            <IonLabel>Safe error code</IonLabel>
            <IonText slot="end">{summary.errorCode}</IonText>
          </IonItem>
        )}
        <IonItem>
          <IonLabel>
            <h3>Sample</h3>
            <p>
              count={summary.count ?? "-"} loaded=
              {summary.loadedRowCount ?? "-"} sampledIds=
              {summary.sampledIds?.length
                ? summary.sampledIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Report-style counts</h3>
            <p>
              income={summary.incomeCount ?? "-"} expense=
              {summary.expenseCount ?? "-"} transfer=
              {summary.transferCount ?? "-"}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Rounded sample totals</h3>
            <p>
              income={summary.incomeTotal ?? "-"} expense=
              {summary.expenseTotal ?? "-"} net={summary.netTotal ?? "-"}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Limitation</h3>
            <p>{summary.limitation}</p>
          </IonLabel>
        </IonItem>
      </IonList>
    </IonCardContent>
  </IonCard>
);

const OrderingResultCard: React.FC<{
  summary: OrderingDiagnosticSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Selected Read Ordering Results</h3>
      </IonText>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>Sample limit</IonLabel>
          <IonText slot="end">{summary.sampleLimit}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Normalized ID comparison</IonLabel>
          <IonText slot="end">
            {summary.comparisonUsesNormalizedIds ? "true" : "false"}
          </IonText>
        </IonItem>
        {summary.checks.map((check) => (
          <IonItem key={check.resource}>
            <IonLabel>
              <h3>{check.resource}</h3>
              <p>
                normalizedOrderMatch={String(check.matchesExactly)} dexieCount=
                {check.dexieCount ?? "unavailable"} httpCount=
                {check.httpCount ?? "unavailable"}
              </p>
              <p>
                dexieIds=
                {check.dexieSampledIds?.length
                  ? check.dexieSampledIds.join(", ")
                  : "-"}
              </p>
              <p>
                httpIds=
                {check.httpSampledIds?.length
                  ? check.httpSampledIds.join(", ")
                  : "-"}
              </p>
              {check.code && <p>code={check.code}</p>}
            </IonLabel>
            <IonBadge
              color={check.status === "pass" ? "success" : "warning"}
              slot="end"
            >
              {check.status === "pass" ? "Match" : "Diff"}
            </IonBadge>
          </IonItem>
        ))}
      </IonList>
    </IonCardContent>
  </IonCard>
);

const RecipientsReadExperimentResultCard: React.FC<{
  summary: RecipientsReadExperimentSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Recipients Read Experiment Results</h3>
      </IonText>
      <IonBadge color={summary.ok ? "success" : "danger"}>
        {summary.ok ? "Pass" : "Fail"}
      </IonBadge>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>Limit</IonLabel>
          <IonText slot="end">{summary.limit}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Compared checks</IonLabel>
          <IonText slot="end">{summary.comparedChecks}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Failed checks</IonLabel>
          <IonText slot="end">{summary.failedChecks}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Counts</h3>
            <p>
              dexieDerived={summary.dexieDerivedCount} dexieLoaded=
              {summary.dexieLoadedCount} httpReported=
              {summary.httpReportedCount ?? "unavailable"} httpLoaded=
              {summary.httpLoadedCount}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Match flags</h3>
            <p>
              loadedIdsMatch={String(summary.loadedIdsMatch)} displayOrderMatch=
              {String(summary.displayOrderMatches)} activeCountsMatch=
              {String(summary.activeStateCountsMatch)}
            </p>
            <p>
              httpRowsNormalized={String(summary.allHttpRowsNormalized)}{" "}
              httpTruncated={String(summary.httpTruncated)}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Sampled IDs</h3>
            <p>
              dexieIds=
              {summary.sampledDexieIds.length
                ? summary.sampledDexieIds.join(", ")
                : "-"}
            </p>
            <p>
              httpIds=
              {summary.sampledHttpIds.length
                ? summary.sampledHttpIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        {summary.checks.map((check) => (
          <IonItem key={check.name}>
            <IonLabel>
              <h3>{check.name}</h3>
              {check.code && <p>code={check.code}</p>}
            </IonLabel>
            <IonBadge
              color={check.status === "pass" ? "success" : "warning"}
              slot="end"
            >
              {check.status === "pass" ? "Pass" : "Fail"}
            </IonBadge>
          </IonItem>
        ))}
      </IonList>
    </IonCardContent>
  </IonCard>
);

const BucketsCategoriesReadExperimentResultCard: React.FC<{
  summary: BucketsCategoriesReadExperimentSummary;
}> = ({ summary }) => (
  <IonCard>
    <IonCardHeader>
      <IonText>
        <h3>Buckets/Categories Read Experiment Results</h3>
      </IonText>
      <IonBadge color={summary.ok ? "success" : "danger"}>
        {summary.ok ? "Pass" : "Fail"}
      </IonBadge>
    </IonCardHeader>
    <IonCardContent>
      <IonList>
        <IonItem>
          <IonLabel>Limit</IonLabel>
          <IonText slot="end">{summary.limit}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Compared checks</IonLabel>
          <IonText slot="end">{summary.comparedChecks}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>Failed checks</IonLabel>
          <IonText slot="end">{summary.failedChecks}</IonText>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Bucket counts</h3>
            <p>
              dexieDerived={summary.dexieBucketDerivedCount} dexieLoaded=
              {summary.dexieBucketLoadedCount} httpReported=
              {summary.httpBucketReportedCount ?? "unavailable"} httpLoaded=
              {summary.httpBucketLoadedCount}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Category counts</h3>
            <p>
              dexieDerived={summary.dexieCategoryDerivedCount} dexieLoaded=
              {summary.dexieCategoryLoadedCount} httpReported=
              {summary.httpCategoryReportedCount ?? "unavailable"} httpLoaded=
              {summary.httpCategoryLoadedCount}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Match flags</h3>
            <p>
              bucketIdsMatch={String(summary.bucketIdsMatch)} categoryIdsMatch=
              {String(summary.categoryIdsMatch)}
            </p>
            <p>
              bucketOrderMatch={String(summary.bucketOrderMatches)}{" "}
              categoryOrderMatch={String(summary.categoryOrderMatches)}
            </p>
            <p>
              groupingMatch={String(summary.categoryGroupingMatches)}{" "}
              countsByBucketMatch=
              {String(summary.categoryCountsByBucketMatch)}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Normalization and caps</h3>
            <p>
              httpBucketsNormalized=
              {String(summary.allHttpBucketsNormalized)}{" "}
              httpCategoriesNormalized=
              {String(summary.allHttpCategoriesNormalized)}
            </p>
            <p>
              httpBucketsTruncated={String(summary.httpBucketsTruncated)}{" "}
              httpCategoriesTruncated=
              {String(summary.httpCategoriesTruncated)}
            </p>
            <p>
              bucketActiveCountsMatch=
              {String(summary.bucketActiveStateCountsMatch)}{" "}
              categoryActiveCountsMatch=
              {String(summary.categoryActiveStateCountsMatch)}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Sampled bucket IDs</h3>
            <p>
              dexieIds=
              {summary.sampledDexieBucketIds.length
                ? summary.sampledDexieBucketIds.join(", ")
                : "-"}
            </p>
            <p>
              httpIds=
              {summary.sampledHttpBucketIds.length
                ? summary.sampledHttpBucketIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        <IonItem>
          <IonLabel>
            <h3>Sampled category IDs</h3>
            <p>
              dexieIds=
              {summary.sampledDexieCategoryIds.length
                ? summary.sampledDexieCategoryIds.join(", ")
                : "-"}
            </p>
            <p>
              httpIds=
              {summary.sampledHttpCategoryIds.length
                ? summary.sampledHttpCategoryIds.join(", ")
                : "-"}
            </p>
          </IonLabel>
        </IonItem>
        {summary.checks.map((check) => (
          <IonItem key={check.name}>
            <IonLabel>
              <h3>{check.name}</h3>
              {check.code && <p>code={check.code}</p>}
            </IonLabel>
            <IonBadge
              color={check.status === "pass" ? "success" : "warning"}
              slot="end"
            >
              {check.status === "pass" ? "Pass" : "Fail"}
            </IonBadge>
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
  const [reportsPreview, setReportsPreview] =
    useState<ReportsPreviewSummary | null>(null);
  const [orderingSummary, setOrderingSummary] =
    useState<OrderingDiagnosticSummary | null>(null);
  const [recipientsReadExperimentSummary, setRecipientsReadExperimentSummary] =
    useState<RecipientsReadExperimentSummary | null>(null);
  const [
    bucketsCategoriesReadExperimentSummary,
    setBucketsCategoriesReadExperimentSummary,
  ] = useState<BucketsCategoriesReadExperimentSummary | null>(null);
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
    ordering: {
      key: "ordering",
      title: "Selected Read Ordering",
      status: "idle",
    },
    recipientsReadExperiment: {
      key: "recipientsReadExperiment",
      title: "Recipients Read Experiment",
      status: "idle",
    },
    bucketsCategoriesReadExperiment: {
      key: "bucketsCategoriesReadExperiment",
      title: "Buckets/Categories Read Experiment",
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
      const rows = previewRows(result as DevPreviewListResult);

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
        count: previewCount(result as DevPreviewListResult),
        loadedRowCount: Math.min(rows.length, PREVIEW_LIMIT),
        sampledIds: previewSampledIds(rows.slice(0, PREVIEW_LIMIT), PREVIEW_LIMIT),
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
          "sms import templates",
          () => repositories.smsImportTemplates.list(listOptions),
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
      const categoryRows = previewRows(categoryResult as DevPreviewListResult);
      const bucketRows = previewRows(bucketResult as DevPreviewListResult);

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
          count: previewCount(categoryResult as DevPreviewListResult),
          loadedRowCount: visibleCategoryRows.length,
          sampledIds: previewSampledIds(visibleCategoryRows, PREVIEW_LIMIT),
          rows: visibleCategoryRows.map((row) => ({
            id: numberValue(row.id),
            bucketId: numberValue((row as { bucketId?: unknown }).bucketId),
            isActive: booleanValue((row as { isActive?: unknown }).isActive),
          })),
        },
        buckets: {
          count: previewCount(bucketResult as DevPreviewListResult),
          loadedRowCount: visibleBucketRows.length,
          sampledIds: previewSampledIds(visibleBucketRows, PREVIEW_LIMIT),
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

  const loadReportsPreview = async (): Promise<void> => {
    const key = "reportsPreview";
    setRunningKey(key);
    setReportsPreview(null);

    const backend = getRepositoryBackend();
    const repositories = getSelectedReadRepositories(backend);
    const source = repositories.source;
    const window = `repository default order, first ${REPORTS_PREVIEW_LIMIT} transactions`;
    const limitation =
      "Limited structural preview only; it does not apply full report period, bucket exclusion, or chart semantics.";

    try {
      const [count, result] = await Promise.all([
        repositories.transactions.count(),
        repositories.transactions.list({
          limit: REPORTS_PREVIEW_LIMIT,
          offset: 0,
        }),
      ]);
      const rows = previewRows(result as DevPreviewListResult);

      if (!rows) {
        setReportsPreview({
          status: "fail",
          backend,
          source,
          window,
          limitation,
          errorCode: "invalid_reports_preview_response",
        });
        return;
      }

      const visibleRows = rows.slice(0, REPORTS_PREVIEW_LIMIT);
      let incomeCount = 0;
      let expenseCount = 0;
      let transferCount = 0;
      let incomeTotal = 0;
      let expenseTotal = 0;

      for (const row of visibleRows) {
        const netAmount = reportAmount(
          row as { amount?: unknown; transactionCost?: unknown },
        );
        const isTransfer = booleanValue(
          (row as { isTransfer?: unknown }).isTransfer,
        );

        if (isTransfer) {
          transferCount += 1;
        }

        if (netAmount >= 0) {
          incomeCount += 1;
          incomeTotal += netAmount;
        } else {
          expenseCount += 1;
          expenseTotal += netAmount;
        }
      }

      setReportsPreview({
        status: "pass",
        backend,
        source,
        window,
        count,
        loadedRowCount: visibleRows.length,
        sampledIds: previewSampledIds(visibleRows, PREVIEW_LIMIT),
        incomeCount,
        expenseCount,
        transferCount,
        incomeTotal: roundCurrencyTotal(incomeTotal),
        expenseTotal: roundCurrencyTotal(expenseTotal),
        netTotal: roundCurrencyTotal(incomeTotal + expenseTotal),
        limitation,
      });
    } catch (error) {
      setReportsPreview({
        status: "fail",
        backend,
        source,
        window,
        limitation,
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

  const runOrderingDiagnostic = async (): Promise<void> => {
    const key = "ordering";
    setRunningKey(key);
    updateSummary({ ...summaries[key], status: "running" });
    setOrderingSummary(null);

    try {
      const result = await runSelectedReadOrderingDiagnostics();
      setOrderingSummary({
        sampleLimit: result.sampleLimit,
        comparisonUsesNormalizedIds: result.checks.every(
          (check) => check.comparisonUsesNormalizedIds,
        ),
        checks: result.checks,
      });
      updateSummary({
        key,
        title: "Selected Read Ordering",
        status: result.ok ? "pass" : "fail",
        ok: result.ok,
        comparedChecks: result.comparedChecks,
        failedChecks: result.failedChecks,
        sampledIds: [
          ...new Set(
            result.checks.flatMap((check) => [
              ...(check.dexieSampledIds ?? []),
              ...(check.httpSampledIds ?? []),
            ]),
          ),
        ]
          .sort((left, right) => String(left).localeCompare(String(right)))
          .slice(0, 12),
        codes: uniqueCodes(
          result.checks.map((check) => ({
            code: check.code,
          })),
        ),
      });
    } catch (error) {
      updateSummary({
        key,
        title: "Selected Read Ordering",
        status: "fail",
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const runRecipientsReadExperimentDiagnostic = async (): Promise<void> => {
    const key = "recipientsReadExperiment";
    setRunningKey(key);
    updateSummary({ ...summaries[key], status: "running" });
    setRecipientsReadExperimentSummary(null);

    try {
      const result = await runRecipientsReadExperimentDiagnostics();
      setRecipientsReadExperimentSummary(result);
      updateSummary({
        key,
        title: "Recipients Read Experiment",
        status: result.ok ? "pass" : "fail",
        ok: result.ok,
        comparedChecks: result.comparedChecks,
        failedChecks: result.failedChecks,
        sampledIds: [
          ...new Set([...result.sampledDexieIds, ...result.sampledHttpIds]),
        ].slice(0, 12),
        codes: uniqueCodes(
          result.checks.map((check) => ({
            code: check.code,
          })),
        ),
      });
    } catch (error) {
      updateSummary({
        key,
        title: "Recipients Read Experiment",
        status: "fail",
        errorCode: safeErrorCode(error),
      });
    } finally {
      setRunningKey(null);
    }
  };

  const runBucketsCategoriesReadExperimentDiagnostic =
    async (): Promise<void> => {
      const key = "bucketsCategoriesReadExperiment";
      setRunningKey(key);
      updateSummary({ ...summaries[key], status: "running" });
      setBucketsCategoriesReadExperimentSummary(null);

      try {
        const result = await runBucketsCategoriesReadExperimentDiagnostics();
        setBucketsCategoriesReadExperimentSummary(result);
        updateSummary({
          key,
          title: "Buckets/Categories Read Experiment",
          status: result.ok ? "pass" : "fail",
          ok: result.ok,
          comparedChecks: result.comparedChecks,
          failedChecks: result.failedChecks,
          sampledIds: [
            ...new Set([
              ...result.sampledDexieBucketIds,
              ...result.sampledHttpBucketIds,
              ...result.sampledDexieCategoryIds,
              ...result.sampledHttpCategoryIds,
            ]),
          ].slice(0, 12),
          codes: uniqueCodes(
            result.checks.map((check) => ({
              code: check.code,
            })),
          ),
        });
      } catch (error) {
        updateSummary({
          key,
          title: "Buckets/Categories Read Experiment",
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
                  <IonItem>
                    <IonIcon
                      aria-hidden="true"
                      icon={playCircleOutline}
                      slot="start"
                    />
                    <IonLabel>Selected-read ordering diagnostic</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void runOrderingDiagnostic()}
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
                    <IonLabel>Recipients read experiment diagnostic</IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() =>
                        void runRecipientsReadExperimentDiagnostic()
                      }
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
                    <IonLabel>
                      Buckets/Categories read experiment diagnostic
                    </IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() =>
                        void runBucketsCategoriesReadExperimentDiagnostic()
                      }
                      disabled={isRunning}
                    >
                      Run
                    </IonButton>
                  </IonItem>
                </IonList>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    Diagnostics run only when selected. Results below are
                    summary-only and omit raw finance rows. The ordering
                    diagnostic compares sampled IDs only, not full row parity.
                    The Recipients experiment diagnostic compares counts,
                    normalized IDs, and display-pipeline ordering only.
                    The Buckets/Categories experiment diagnostic compares
                    counts, normalized IDs, grouping, active-state counts, and
                    display-pipeline ordering only.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {Object.values(summaries).map((summary) => (
              <ResultCard key={summary.key} summary={summary} />
            ))}

            {orderingSummary && (
              <OrderingResultCard summary={orderingSummary} />
            )}

            {recipientsReadExperimentSummary && (
              <RecipientsReadExperimentResultCard
                summary={recipientsReadExperimentSummary}
              />
            )}

            {bucketsCategoriesReadExperimentSummary && (
              <BucketsCategoriesReadExperimentResultCard
                summary={bucketsCategoriesReadExperimentSummary}
              />
            )}

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

            <IonCard>
              <IonCardHeader>
                <IonText>
                  <h3>Experimental Reports Diagnostic</h3>
                </IonText>
                <IonBadge color="warning">Read-only</IonBadge>
                {runningKey === "reportsPreview" && (
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
                      Load a limited report-style transaction sample
                    </IonLabel>
                    <IonButton
                      slot="end"
                      size="small"
                      onClick={() => void loadReportsPreview()}
                      disabled={isRunning}
                    >
                      Load
                    </IonButton>
                  </IonItem>
                  <IonItem>
                    <IonLabel>
                      <h3>Dexie remains authoritative</h3>
                      <p>
                        This diagnostic stays inside Local API Diagnostics and
                        does not replace the real Reports page or its report
                        calculations.
                      </p>
                    </IonLabel>
                  </IonItem>
                </IonList>
                <IonText color="medium">
                  <p style={{ fontSize: "0.85rem" }}>
                    Loads a capped selected-read transaction sample and shows
                    only summary counts and rounded sample totals. It is a
                    structural preview, not full report parity.
                  </p>
                </IonText>
              </IonCardContent>
            </IonCard>

            {reportsPreview && (
              <ReportsPreviewCard summary={reportsPreview} />
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

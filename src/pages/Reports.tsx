import React, { useState, useEffect, useCallback } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner,
  IonText,
  useIonViewWillEnter,
} from "@ionic/react";
import { chevronBack, chevronForward } from "ionicons/icons";
import {
  getPreviousPeriod,
  getNextPeriod,
  PeriodReport,
  PeriodType,
  formatCurrency,
  generatePeriodReportFromInputs,
  getDateRangeForPeriod,
  type ReportBucketInput,
  type ReportCategoryInput,
  type ReportTransactionInput,
} from "../utils/reportService";
import { reportRepository } from "../repositories";
import {
  getRepositoryBackend,
  isSqliteAuthorityControlledBackend,
  type RepositoryBackend,
} from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";
import BucketCategoryPieModal from "../components/BucketCategoryPieModal";
import SpendingChart from "../components/SpendingChart";
import "./Reports.css";

const REPORTS_READ_EXPERIMENT_FLAG =
  "VITE_PERSONAL_FINANCE_REPORTS_READ_EXPERIMENT";
const REPORT_INPUT_LIMIT = 5000;
const REPORT_INPUT_PAGE_SIZE = 200;

type ListResult<Row> =
  | Row[]
  | {
      count?: number;
      rows?: Row[];
    };

interface ReportInputLoadMeta {
  backend: RepositoryBackend;
  source: string;
  loadedCount: number;
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
}

const getEnvValue = (key: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const isReportsReadExperimentEnabled = (): boolean =>
  getEnvValue(REPORTS_READ_EXPERIMENT_FLAG) === "true";

const rowsFromListResult = <Row,>(result: ListResult<Row>): Row[] | undefined => {
  if (Array.isArray(result)) {
    return result;
  }

  return Array.isArray(result.rows) ? result.rows : undefined;
};

const countFromListResult = <Row,>(
  result: ListResult<Row>,
): number | undefined =>
  Array.isArray(result) || typeof result.count !== "number"
    ? undefined
    : result.count;

const loadPagedRows = async <Row,>(
  list: (options: { limit: number; offset: number }) => Promise<unknown>,
  maxRows: number = REPORT_INPUT_LIMIT,
  pageSize: number = REPORT_INPUT_PAGE_SIZE,
): Promise<{
  rows: Row[];
  reportedCount?: number;
  pagesLoaded: number;
  truncated: boolean;
}> => {
  const rows: Row[] = [];
  let reportedCount: number | undefined;
  let pagesLoaded = 0;

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const result = (await list({ limit, offset: rows.length })) as ListResult<Row>;
    const pageRows = rowsFromListResult(result);

    if (!pageRows) {
      throw new Error("invalid_reports_read_experiment_page_response");
    }

    reportedCount ??= countFromListResult(result);
    pagesLoaded += 1;
    rows.push(...pageRows);

    if (pageRows.length === 0) {
      break;
    }

    if (reportedCount !== undefined && rows.length >= reportedCount) {
      break;
    }

    if (pageRows.length < limit) {
      break;
    }
  }

  return {
    rows,
    reportedCount,
    pagesLoaded,
    truncated: reportedCount !== undefined ? rows.length < reportedCount : false,
  };
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringOrDateValue = (value: unknown): Date | string | undefined =>
  value instanceof Date || typeof value === "string" ? value : undefined;

const normalizeTransactionInput = (
  row: unknown,
): ReportTransactionInput | undefined => {
  const source = row as Record<string, unknown>;
  const categoryId = numberValue(source.categoryId);
  const amount = numberValue(source.amount);
  const date = stringOrDateValue(source.date);

  if (categoryId === undefined || amount === undefined || date === undefined) {
    return undefined;
  }

  return {
    categoryId,
    date,
    amount,
    transactionCost: numberValue(source.transactionCost) ?? null,
  };
};

const normalizeCategoryInput = (row: unknown): ReportCategoryInput | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const bucketId = numberValue(source.bucketId);

  if (id === undefined || bucketId === undefined) {
    return undefined;
  }

  return {
    id,
    bucketId,
    name: typeof source.name === "string" ? source.name : null,
    isActive:
      typeof source.isActive === "boolean" || typeof source.isActive === "number"
        ? source.isActive
        : undefined,
  };
};

const normalizeBucketInput = (row: unknown): ReportBucketInput | undefined => {
  const source = row as Record<string, unknown>;
  const id = numberValue(source.id);
  const minPercentage = numberValue(source.minPercentage);
  const maxPercentage = numberValue(source.maxPercentage);
  const displayOrder = numberValue(source.displayOrder);
  const isActive = source.isActive;
  const excludeFromReports = source.excludeFromReports;

  if (
    id === undefined ||
    minPercentage === undefined ||
    maxPercentage === undefined ||
    displayOrder === undefined ||
    (typeof isActive !== "boolean" && typeof isActive !== "number") ||
    (typeof excludeFromReports !== "boolean" &&
      typeof excludeFromReports !== "number")
  ) {
    return undefined;
  }

  return {
    id,
    name: typeof source.name === "string" ? source.name : null,
    minPercentage,
    maxPercentage,
    minFixedAmount: numberValue(source.minFixedAmount) ?? null,
    isActive,
    displayOrder,
    excludeFromReports,
  };
};

const Reports: React.FC = () => {
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reportInputMeta, setReportInputMeta] =
    useState<ReportInputLoadMeta | null>(null);
  const [selectedBucketForPie, setSelectedBucketForPie] = useState<{
    bucketId: number;
    bucketName: string;
  } | null>(null);
  const reportsExperimentEnabled = isReportsReadExperimentEnabled();
  const repositoryBackend = getRepositoryBackend();
  const rehearsalSelected = isSqliteAuthorityControlledBackend(repositoryBackend);
  const reportsHttpReadonlyExperimentActive =
    rehearsalSelected ||
    (reportsExperimentEnabled && repositoryBackend === "http-readonly");

  // Load report whenever period type or date changes
  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    setReportInputMeta(null);
    try {
      let newReport: PeriodReport;

      if (!reportsHttpReadonlyExperimentActive) {
        newReport = await reportRepository.generatePeriodReport(
          periodType,
          currentDate,
        );
      } else {
        const repositories = getSelectedReadRepositories(repositoryBackend);
        const { start, end } = getDateRangeForPeriod(periodType, currentDate);
        const [transactionLoad, categoryLoad, bucketLoad] = await Promise.all([
          loadPagedRows<unknown>(
            (options) =>
              repositories.transactions.list({
                ...options,
                dateFrom: start.toISOString(),
                dateTo: end.toISOString(),
              }),
            REPORT_INPUT_LIMIT,
            REPORT_INPUT_PAGE_SIZE,
          ),
          loadPagedRows<unknown>(
            repositories.categories.list,
            REPORT_INPUT_LIMIT,
            REPORT_INPUT_PAGE_SIZE,
          ),
          loadPagedRows<unknown>(
            repositories.buckets.list,
            REPORT_INPUT_LIMIT,
            REPORT_INPUT_PAGE_SIZE,
          ),
        ]);
        const transactions = transactionLoad.rows
          .map(normalizeTransactionInput)
          .filter((row): row is ReportTransactionInput => row !== undefined);
        const categories = categoryLoad.rows
          .map(normalizeCategoryInput)
          .filter((row): row is ReportCategoryInput => row !== undefined);
        const buckets = bucketLoad.rows
          .map(normalizeBucketInput)
          .filter((row): row is ReportBucketInput => row !== undefined);

        if (
          transactions.length !== transactionLoad.rows.length ||
          categories.length !== categoryLoad.rows.length ||
          buckets.length !== bucketLoad.rows.length
        ) {
          throw new Error("reports_read_experiment_input_normalization_failed");
        }

        setReportInputMeta({
          backend: repositoryBackend,
          source: repositories.source,
          loadedCount: transactionLoad.rows.length,
          reportedCount: transactionLoad.reportedCount,
          pagesLoaded: transactionLoad.pagesLoaded,
          truncated: transactionLoad.truncated,
        });
        newReport = generatePeriodReportFromInputs(
          periodType,
          currentDate,
          transactions,
          buckets,
          categories,
        );
      }

      setReport(newReport);
    } catch (err) {
      setError("Failed to generate report. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [periodType, currentDate, reportsHttpReadonlyExperimentActive, repositoryBackend]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handlePreviousPeriod = () => {
    setCurrentDate(getPreviousPeriod(periodType, currentDate));
  };

  const handleNextPeriod = () => {
    setCurrentDate(getNextPeriod(periodType, currentDate));
  };

  const handleBucketClick = (bucketId: number, bucketName: string) => {
    if (reportsHttpReadonlyExperimentActive) {
      return;
    }

    setSelectedBucketForPie({ bucketId, bucketName });
  };

  const handleCloseBucketPie = () => {
    setSelectedBucketForPie(null);
  };

  const handleIncomeSummaryClick = async () => {
    if (reportsHttpReadonlyExperimentActive) {
      return;
    }

    if (!report) {
      return;
    }

    try {
      const incomeBucket = await reportRepository.getExcludedReportBucket();

      if (!incomeBucket?.id) {
        return;
      }

      setSelectedBucketForPie({
        bucketId: incomeBucket.id,
        bucketName: "Total Income",
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Get status label
  const getStatusLabel = (status: string): string => {
    switch (status) {
      case "on-target":
        return "On Target";
      case "above-max":
        return "Above Max";
      case "below-min-fixed":
        return "Below Min (Fixed)";
      case "below-min-percentage":
        return "Below Min (%)";
      default:
        return "Unknown";
    }
  };

  // Get progress bar color based on status
  const getProgressBarColor = (status: string): string => {
    switch (status) {
      case "on-target":
        return "#2dd36f";
      case "above-max":
        return "#eb445c";
      case "below-min-fixed":
      case "below-min-percentage":
        return "#ffc409";
      default:
        return "#999999";
    }
  };

  useIonViewWillEnter(() => {
    // Refresh report when page comes into view
    loadReport();
  });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Reports</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        {/* Period Type Selector */}
        <IonSegment
          value={periodType}
          onIonChange={(e) => setPeriodType(e.detail.value as PeriodType)}
          className="reports-segment"
        >
          <IonSegmentButton value="month">
            <IonLabel>Monthly</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="quarter">
            <IonLabel>Quarterly</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="year">
            <IonLabel>Yearly</IonLabel>
          </IonSegmentButton>
        </IonSegment>

        {/* Period Navigation */}
        <div className="period-navigation">
          <IonButton fill="clear" onClick={handlePreviousPeriod}>
            <IonIcon slot="start" icon={chevronBack} />
          </IonButton>

          <IonText className="period-label">
            <h3>{report?.periodLabel || "Loading..."}</h3>
          </IonText>

          <IonButton fill="clear" onClick={handleNextPeriod}>
            <IonIcon slot="start" icon={chevronForward} />
          </IonButton>
        </div>

        {/* Error Message */}
        {reportsExperimentEnabled && (
          <IonCard color={reportsHttpReadonlyExperimentActive ? "warning" : undefined}>
            <IonCardContent>
              <IonText>
                <h3>Reports read experiment is active</h3>
                <p>
                  Backend: {repositoryBackend}.{" "}
                  {reportsHttpReadonlyExperimentActive
                    ? "Report inputs are loaded through selected-read http-readonly. Export, chart, and drilldown actions are disabled. Switch back to Dexie for normal Reports behavior."
                    : "The experiment flag is on, but the selected backend is Dexie, so Reports use the existing Dexie report path."}
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        )}

        {reportsHttpReadonlyExperimentActive && reportInputMeta && (
          <IonCard color={reportInputMeta.truncated ? "danger" : "light"}>
            <IonCardContent>
              <IonText>
                <p>
                  Selected-read report inputs: loaded{" "}
                  {reportInputMeta.loadedCount}
                  {reportInputMeta.reportedCount !== undefined
                    ? ` of ${reportInputMeta.reportedCount}`
                    : ""}{" "}
                  transactions over {reportInputMeta.pagesLoaded} pages.
                  {reportInputMeta.truncated
                    ? " Results are capped and should not be treated as full-confidence report totals."
                    : " Results are not truncated."}
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        )}

        {error && (
          <IonCard color="danger" className="error-card">
            <IonCardContent>
              <IonText color="light">{error}</IonText>
            </IonCardContent>
          </IonCard>
        )}

        {/* Loading State */}
        {loading && (
          <div className="loading-container">
            <IonSpinner name="crescent" />
          </div>
        )}

        {/* Summary Section */}
        {report && !loading && (
          <>
            <IonCard className="summary-card">
              <IonCardContent>
                <IonGrid>
                  <IonRow>
                    <IonCol size="4">
                      <button
                        type="button"
                        className="summary-item summary-item-button"
                        onClick={handleIncomeSummaryClick}
                        disabled={reportsHttpReadonlyExperimentActive}
                      >
                        <IonText color="medium" className="summary-label">
                          Total Income
                        </IonText>
                        <IonText className="summary-value income">
                          {formatCurrency(report.totalIncome)}
                        </IonText>
                      </button>
                    </IonCol>
                    <IonCol size="4">
                      <button
                        type="button"
                        className="summary-item summary-item-button"
                        onClick={handleIncomeSummaryClick}
                        disabled={reportsHttpReadonlyExperimentActive}
                      >
                        <IonText color="medium" className="summary-label">
                          Total Expense
                        </IonText>
                        <IonText className="summary-value expense">
                          {formatCurrency(report.totalExpense)}
                        </IonText>
                      </button>
                    </IonCol>
                    <IonCol size="4">
                      <button
                        type="button"
                        className="summary-item summary-item-button"
                        onClick={handleIncomeSummaryClick}
                        disabled={reportsHttpReadonlyExperimentActive}
                      >
                        <IonText color="medium" className="summary-label">
                          Net Total
                        </IonText>
                        <IonText
                          className={`summary-value ${
                            report.netTotal >= 0 ? "income" : "expense"
                          }`}
                        >
                          {formatCurrency(report.netTotal)}
                        </IonText>
                      </button>
                    </IonCol>
                  </IonRow>
                </IonGrid>
              </IonCardContent>
            </IonCard>

            {/* Buckets List */}
            <div className="buckets-container">
              {report.bucketReports.length === 0 ? (
                <IonCard>
                  <IonCardContent>
                    <IonText color="medium">No buckets to display</IonText>
                  </IonCardContent>
                </IonCard>
              ) : (
                report.bucketReports.map((bucket) => (
                  <IonCard key={bucket.bucketId} className="bucket-card">
                    <IonCardHeader>
                      <div className="bucket-header">
                        <div>
                          <button
                            type="button"
                            className="bucket-name-button"
                            onClick={() =>
                              handleBucketClick(
                                bucket.bucketId,
                                bucket.bucketName,
                              )
                            }
                            disabled={reportsHttpReadonlyExperimentActive}
                          >
                            <IonText>
                              <h5 className="bucket-name">
                                {bucket.bucketName}
                              </h5>
                            </IonText>
                          </button>
                        </div>
                        <span
                          className={`status-badge status-${bucket.status}`}
                        >
                          {getStatusLabel(bucket.status)}
                        </span>
                      </div>
                    </IonCardHeader>

                    <IonCardContent>
                      <IonGrid>
                        <IonRow>
                          <IonCol size="4">
                            <div className="metric">
                              <IonText color="medium" className="metric-label">
                                Amount
                              </IonText>
                              <IonText className="metric-value">
                                {formatCurrency(bucket.totalAmount)}
                              </IonText>
                              <IonText
                                color="medium"
                                className="metric-subtext"
                              >
                                {formatCurrency(
                                  (bucket.minPercentage / 100) *
                                    report.totalIncome,
                                )}
                                {" - "}
                                {formatCurrency(
                                  (bucket.maxPercentage / 100) *
                                    report.totalIncome,
                                )}
                              </IonText>
                            </div>
                          </IonCol>
                          <IonCol size="4">
                            <div
                              className="metric"
                              style={{
                                alignItems: "center",
                                textAlign: "center",
                              }}
                            >
                              <IonText color="medium" className="metric-label">
                                % of Total
                              </IonText>
                              <IonText className="metric-value">
                                {bucket.actualPercentage.toFixed(1)}%
                              </IonText>
                              <IonText
                                color="medium"
                                className="metric-subtext"
                              >
                                {bucket.minPercentage}% - {bucket.maxPercentage}
                                %
                              </IonText>
                            </div>
                          </IonCol>
                          <IonCol size="4">
                            <div
                              className="metric"
                              style={{
                                alignItems: "flex-end",
                                textAlign: "right",
                              }}
                            >
                              <IonText color="medium" className="metric-label">
                                Remaining
                              </IonText>
                              <IonText className="metric-value">
                                {formatCurrency(
                                  (bucket.minPercentage / 100) *
                                    report.totalIncome +
                                    bucket.totalAmount,
                                )}
                              </IonText>
                              <IonText
                                color="medium"
                                className="metric-subtext"
                              >
                                Max:{" "}
                                {formatCurrency(
                                  (bucket.maxPercentage / 100) *
                                    report.totalIncome +
                                    bucket.totalAmount,
                                )}
                              </IonText>
                            </div>
                          </IonCol>
                        </IonRow>

                        {/* Progress Bar */}
                        <IonRow>
                          <IonCol size="12">
                            <div className="progress-container">
                              <div className="progress-bar-wrapper">
                                <div
                                  className="progress-bar-fill"
                                  style={{
                                    width: `${Math.min(
                                      bucket.actualPercentage,
                                      100,
                                    )}%`,
                                    backgroundColor: getProgressBarColor(
                                      bucket.status,
                                    ),
                                  }}
                                />
                              </div>
                            </div>
                          </IonCol>
                        </IonRow>
                      </IonGrid>
                    </IonCardContent>
                  </IonCard>
                ))
              )}
            </div>

            {reportsHttpReadonlyExperimentActive ? (
              <IonCard>
                <IonCardContent>
                  <IonText color="medium">
                    Monthly spending chart and category drilldowns are disabled
                    in the Reports `http-readonly` experiment because those
                    paths still use Dexie-backed report helpers.
                  </IonText>
                </IonCardContent>
              </IonCard>
            ) : (
              <SpendingChart />
            )}

            {!reportsHttpReadonlyExperimentActive && (
              <BucketCategoryPieModal
                isOpen={selectedBucketForPie !== null}
                bucketId={selectedBucketForPie?.bucketId ?? null}
                bucketName={selectedBucketForPie?.bucketName ?? "Bucket"}
                periodType={periodType}
                periodDate={currentDate}
                includeExcludedBucket={
                  selectedBucketForPie?.bucketName === "Total Income"
                }
                onClose={handleCloseBucketPie}
              />
            )}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Reports;

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
  generatePeriodReport,
  getPreviousPeriod,
  getNextPeriod,
  PeriodReport,
  PeriodType,
  formatCurrency,
} from "../utils/reportService";
import "./Reports.css";

const Reports: React.FC = () => {
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load report whenever period type or date changes
  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const newReport = await generatePeriodReport(periodType, currentDate);
      setReport(newReport);
    } catch (err) {
      setError("Failed to generate report. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [periodType, currentDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handlePreviousPeriod = () => {
    setCurrentDate(getPreviousPeriod(periodType, currentDate));
  };

  const handleNextPeriod = () => {
    setCurrentDate(getNextPeriod(periodType, currentDate));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
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
        return "#ffc409";
      case "below-min-fixed":
      case "below-min-percentage":
        return "#eb445c";
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

        {/* Today Button */}
        <div className="today-button-container">
          <IonButton size="small" fill="outline" onClick={handleToday}>
            Today
          </IonButton>
        </div>

        {/* Error Message */}
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
                      <div className="summary-item">
                        <IonText color="medium" className="summary-label">
                          Total Income
                        </IonText>
                        <IonText className="summary-value income">
                          {formatCurrency(report.totalIncome)}
                        </IonText>
                      </div>
                    </IonCol>
                    <IonCol size="4">
                      <div className="summary-item">
                        <IonText color="medium" className="summary-label">
                          Total Expense
                        </IonText>
                        <IonText className="summary-value expense">
                          {formatCurrency(report.totalExpense)}
                        </IonText>
                      </div>
                    </IonCol>
                    <IonCol size="4">
                      <div className="summary-item">
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
                      </div>
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
                          <IonText>
                            <h5 className="bucket-name">{bucket.bucketName}</h5>
                          </IonText>
                          <IonText color="medium" className="bucket-range">
                            Target: {bucket.minPercentage}% -{" "}
                            {bucket.maxPercentage}%
                            {bucket.minFixedAmount &&
                              ` (Min: ${bucket.minFixedAmount.toFixed(2)})`}
                          </IonText>
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
                          <IonCol size="6">
                            <div className="metric">
                              <IonText color="medium" className="metric-label">
                                Amount
                              </IonText>
                              <IonText className="metric-value">
                                {formatCurrency(bucket.totalAmount)}
                              </IonText>
                            </div>
                          </IonCol>
                          <IonCol size="6">
                            <div className="metric">
                              <IonText color="medium" className="metric-label">
                                % of Total
                              </IonText>
                              <IonText className="metric-value">
                                {bucket.actualPercentage.toFixed(1)}%
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
                                      100
                                    )}%`,
                                    backgroundColor: getProgressBarColor(
                                      bucket.status
                                    ),
                                  }}
                                />
                              </div>
                              <div className="progress-labels">
                                <span className="min-label">
                                  {bucket.minPercentage}%
                                </span>
                                <span className="max-label">
                                  {bucket.maxPercentage}%
                                </span>
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
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Reports;

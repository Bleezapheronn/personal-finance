import React, { useEffect, useMemo, useState } from "react";
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { close } from "ionicons/icons";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  BucketCategoryBreakdownResult,
  formatCurrency,
  getCategoryBreakdownForBucket,
  PeriodType,
} from "../utils/reportService";
import "./BucketCategoryPieModal.css";

interface BucketCategoryPieModalProps {
  isOpen: boolean;
  bucketId: number | null;
  bucketName: string;
  periodType: PeriodType;
  periodDate: Date;
  onClose: () => void;
}

const PIE_COLORS = [
  "#0f766e",
  "#2563eb",
  "#ea580c",
  "#be123c",
  "#0d9488",
  "#6d28d9",
  "#15803d",
  "#7c2d12",
  "#0369a1",
  "#a16207",
  "#475569",
  "#4338ca",
  "#b91c1c",
  "#1d4ed8",
  "#4d7c0f",
];

const BucketCategoryPieModal: React.FC<BucketCategoryPieModalProps> = ({
  isOpen,
  bucketId,
  bucketName,
  periodType,
  periodDate,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [breakdown, setBreakdown] =
    useState<BucketCategoryBreakdownResult | null>(null);

  const title = useMemo(() => {
    return `${bucketName} Breakdown`;
  }, [bucketName]);

  useEffect(() => {
    if (!isOpen || bucketId === null) {
      setBreakdown(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadBreakdown = async () => {
      setLoading(true);
      setError("");

      try {
        const result = await getCategoryBreakdownForBucket(
          periodType,
          periodDate,
          bucketId,
        );

        if (!cancelled) {
          setBreakdown(result);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Unable to load category breakdown.");
          setBreakdown(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadBreakdown();

    return () => {
      cancelled = true;
    };
  }, [bucketId, isOpen, periodDate, periodType]);

  const handleDismiss = () => {
    onClose();
  };

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={handleDismiss}
      className="bucket-pie-modal"
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleDismiss} aria-label="Close modal">
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding bucket-pie-modal-content">
        <div className="bucket-pie-modal-header">
          <IonText color="medium">
            <p>{breakdown?.periodLabel || "Selected period"}</p>
          </IonText>
        </div>

        {loading ? (
          <div className="bucket-pie-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : error ? (
          <IonText color="danger">
            <p className="bucket-pie-error">{error}</p>
          </IonText>
        ) : !breakdown || breakdown.items.length === 0 ? (
          <IonText color="medium">
            <p className="bucket-pie-empty">
              No category data for this period.
            </p>
          </IonText>
        ) : (
          <>
            <div className="bucket-pie-chart-wrap">
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={breakdown.items}
                    dataKey="amount"
                    nameKey="categoryName"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    innerRadius={55}
                    paddingAngle={2}
                  >
                    {breakdown.items.map((entry, index) => (
                      <Cell
                        key={entry.categoryId}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | string, name, props) => {
                      const item = props.payload as {
                        amount: number;
                        percentage: number;
                        categoryName: string;
                      };

                      return [
                        `${formatCurrency(Number(value) || 0)} (${item.percentage.toFixed(1)}%)`,
                        String(name),
                      ];
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bucket-pie-summary">
              <div className="bucket-pie-summary-header">
                <span>Category</span>
                <span>% of bucket</span>
                <span>Amount</span>
              </div>

              {breakdown.items.map((item, index) => (
                <div key={item.categoryId} className="bucket-pie-summary-row">
                  <div className="bucket-pie-category-name">
                    <span
                      className="bucket-pie-swatch"
                      style={{
                        backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                      }}
                    />
                    <span>{item.categoryName}</span>
                  </div>
                  <span>{item.percentage.toFixed(1)}%</span>
                  <span>{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </IonContent>
    </IonModal>
  );
};

export default BucketCategoryPieModal;

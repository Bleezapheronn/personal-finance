import React, { useEffect, useMemo, useState } from "react";
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCheckbox,
  IonSpinner,
  IonText,
} from "@ionic/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "../db";
import {
  formatCurrency,
  getMonthlyChartData,
  MonthlyChartRow,
} from "../utils/reportService";
import { SearchableFilterSelect } from "./SearchableFilterSelect";
import "./SpendingChart.css";

interface BucketOption {
  id: number;
  name: string;
}

interface CategoryOption {
  id: number;
  name: string;
}

const CHART_COLORS = [
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

const getMonthInputValue = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};

const getDefaultMonthRange = (): { startMonth: string; endMonth: string } => {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  return {
    startMonth: getMonthInputValue(start),
    endMonth: getMonthInputValue(end),
  };
};

const SpendingChart: React.FC = () => {
  const [buckets, setBuckets] = useState<BucketOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedBucketId, setSelectedBucketId] = useState<
    number | undefined
  >();
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [chartRows, setChartRows] = useState<MonthlyChartRow[]>([]);
  const [seriesKeys, setSeriesKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const defaults = useMemo(() => getDefaultMonthRange(), []);
  const [startMonth, setStartMonth] = useState(defaults.startMonth);
  const [endMonth, setEndMonth] = useState(defaults.endMonth);

  useEffect(() => {
    const loadBuckets = async () => {
      const activeBuckets = (await db.buckets.toArray())
        .filter(
          (bucket) =>
            bucket.isActive && !bucket.excludeFromReports && bucket.id,
        )
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((bucket) => ({
          id: bucket.id as number,
          name: bucket.name || "Unnamed",
        }));

      setBuckets(activeBuckets);
      if (activeBuckets.length > 0) {
        setSelectedBucketId((prev) => prev ?? activeBuckets[0].id);
      }
    };

    loadBuckets();
  }, []);

  useEffect(() => {
    const loadCategories = async () => {
      if (!selectedBucketId) {
        setCategories([]);
        setSelectedCategoryIds([]);
        return;
      }

      const bucketCategories = (
        await db.categories.where("bucketId").equals(selectedBucketId).toArray()
      )
        .filter((category) => category.isActive && category.id)
        .map((category) => ({
          id: category.id as number,
          name: category.name || "Unnamed",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setCategories(bucketCategories);
      setSelectedCategoryIds([]);
    };

    loadCategories();
  }, [selectedBucketId]);

  useEffect(() => {
    const loadChartData = async () => {
      if (!selectedBucketId || !startMonth || !endMonth) {
        setChartRows([]);
        setSeriesKeys([]);
        return;
      }

      if (startMonth > endMonth) {
        setError("Start month must be before or equal to end month.");
        setChartRows([]);
        setSeriesKeys([]);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const result = await getMonthlyChartData({
          bucketId: selectedBucketId,
          categoryIds: selectedCategoryIds,
          startMonth,
          endMonth,
        });

        setChartRows(result.rows);
        setSeriesKeys(result.seriesKeys);
      } catch (err) {
        console.error(err);
        setError("Unable to load chart data. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadChartData();
  }, [selectedBucketId, selectedCategoryIds, startMonth, endMonth]);

  const bucketFilterOptions = buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
  }));

  const allCategoriesSelected =
    categories.length > 0 && selectedCategoryIds.length === categories.length;

  const handleCategoryToggle = (categoryId: number, checked: boolean) => {
    setSelectedCategoryIds((prev) => {
      if (checked) {
        return prev.includes(categoryId) ? prev : [...prev, categoryId];
      }
      return prev.filter((id) => id !== categoryId);
    });
  };

  const handleSelectAllCategories = () => {
    setSelectedCategoryIds(categories.map((category) => category.id));
  };

  const handleClearAllCategories = () => {
    setSelectedCategoryIds([]);
  };

  return (
    <IonCard className="spending-chart-card">
      <IonCardHeader>
        <h4 className="spending-chart-title">Monthly Spending Visualization</h4>
      </IonCardHeader>

      <IonCardContent>
        <div className="spending-chart-filters-row">
          <div className="spending-chart-filter-group">
            <label className="spending-chart-filter-label">Bucket</label>
            <SearchableFilterSelect
              label="Bucket"
              placeholder="Select bucket..."
              value={selectedBucketId}
              options={bucketFilterOptions}
              onIonChange={(value) => setSelectedBucketId(value)}
            />
          </div>

          <div className="spending-chart-filter-group">
            <label
              className="spending-chart-filter-label"
              htmlFor="start-month-input"
            >
              Start Month
            </label>
            <input
              id="start-month-input"
              type="month"
              className="spending-chart-month-input"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </div>

          <div className="spending-chart-filter-group">
            <label
              className="spending-chart-filter-label"
              htmlFor="end-month-input"
            >
              End Month
            </label>
            <input
              id="end-month-input"
              type="month"
              className="spending-chart-month-input"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
            />
          </div>
        </div>

        <div className="spending-chart-category-panel">
          <div className="spending-chart-category-header">
            <h5>Categories (optional)</h5>
            <div className="spending-chart-category-actions">
              <IonButton
                size="small"
                fill="outline"
                onClick={handleSelectAllCategories}
                disabled={categories.length === 0 || allCategoriesSelected}
              >
                Select All
              </IonButton>
              <IonButton
                size="small"
                fill="clear"
                onClick={handleClearAllCategories}
                disabled={selectedCategoryIds.length === 0}
              >
                Clear All
              </IonButton>
            </div>
          </div>

          {categories.length === 0 ? (
            <IonText color="medium">
              <p className="spending-chart-hint">
                No active categories in this bucket.
              </p>
            </IonText>
          ) : (
            <div className="spending-chart-category-list">
              {categories.map((category) => (
                <label
                  key={category.id}
                  className="spending-chart-category-item"
                >
                  <IonCheckbox
                    checked={selectedCategoryIds.includes(category.id)}
                    onIonChange={(e) =>
                      handleCategoryToggle(category.id, e.detail.checked)
                    }
                  />
                  <span>{category.name}</span>
                </label>
              ))}
            </div>
          )}

          <IonText color="medium">
            <p className="spending-chart-hint">
              Leave categories unselected to plot the total for the selected
              bucket.
            </p>
          </IonText>
        </div>

        {error && (
          <IonText color="danger">
            <p className="spending-chart-error">{error}</p>
          </IonText>
        )}

        {loading ? (
          <div className="spending-chart-loading">
            <IonSpinner name="crescent" />
          </div>
        ) : chartRows.length === 0 || seriesKeys.length === 0 ? (
          <IonText color="medium">
            <p className="spending-chart-empty">No data for this period.</p>
          </IonText>
        ) : (
          <div className="spending-chart-plot-area">
            <ResponsiveContainer width="100%" height={360}>
              <BarChart
                data={chartRows}
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis
                  tickFormatter={(value) => formatCurrency(Number(value) || 0)}
                />
                <Tooltip
                  formatter={(value: number | string, name) => [
                    formatCurrency(Number(value) || 0),
                    String(name),
                  ]}
                  labelFormatter={(label) => `${label}`}
                />
                <Legend />
                {seriesKeys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                    radius={[6, 6, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </IonCardContent>
    </IonCard>
  );
};

export default SpendingChart;

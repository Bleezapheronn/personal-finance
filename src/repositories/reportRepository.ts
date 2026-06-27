import { Bucket } from "../db";
import * as categoryRepository from "./categoryRepository";
import {
  generatePeriodReport as generatePeriodReportFromService,
  getCategoryBreakdownForBucket as getCategoryBreakdownForBucketFromService,
  getMonthlyChartData as getMonthlyChartDataFromService,
} from "../utils/reportService";
import type {
  BucketCategoryBreakdownResult,
  MonthlyChartDataOptions,
  MonthlyChartDataResult,
  PeriodReport,
  PeriodType,
} from "../utils/reportService";

export type {
  BucketCategoryBreakdownResult,
  MonthlyChartDataOptions,
  MonthlyChartDataResult,
  MonthlyChartRow,
  PeriodReport,
  PeriodType,
} from "../utils/reportService";

export interface ReportBucketOption {
  id: number;
  name: string;
}

export interface ReportCategoryOption {
  id: number;
  name: string;
}

export const generatePeriodReport = async (
  periodType: PeriodType,
  date: Date = new Date(),
): Promise<PeriodReport> => {
  return generatePeriodReportFromService(periodType, date);
};

export const getMonthlyChartData = async (
  options: MonthlyChartDataOptions,
): Promise<MonthlyChartDataResult> => {
  return getMonthlyChartDataFromService(options);
};

export const getCategoryBreakdownForBucket = async (
  periodType: PeriodType,
  date: Date,
  bucketId: number,
  includeExcludedBucket: boolean = false,
): Promise<BucketCategoryBreakdownResult> => {
  return getCategoryBreakdownForBucketFromService(
    periodType,
    date,
    bucketId,
    includeExcludedBucket,
  );
};

export const getBucketCategoryBreakdown = getCategoryBreakdownForBucket;

export const getExcludedReportBucket = async (): Promise<
  Bucket | undefined
> => {
  const buckets = await categoryRepository.listBuckets();
  return buckets.find((bucket) => bucket.excludeFromReports);
};

export const listActiveReportBuckets = async (): Promise<
  ReportBucketOption[]
> => {
  const buckets = await categoryRepository.listBuckets();

  return buckets
    .filter(
      (bucket) => bucket.isActive && !bucket.excludeFromReports && bucket.id,
    )
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((bucket) => ({
      id: bucket.id as number,
      name: bucket.name || "Unnamed",
    }));
};

export const listActiveCategoriesForBucket = async (
  bucketId: number,
): Promise<ReportCategoryOption[]> => {
  const categories = await categoryRepository.listCategories();

  return categories
    .filter(
      (category) =>
        category.id && category.bucketId === bucketId && category.isActive,
    )
    .map((category) => ({
      id: category.id as number,
      name: category.name || "Unnamed",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

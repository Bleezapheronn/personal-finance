import { LocalApiError, localApiPost } from "../../api/localApiClient";

export interface BudgetScheduleSuccessorInput {
  budgetId: number;
  asOf: string;
  definition: Record<string, unknown>;
}

interface Response {
  ok: boolean;
  code?: string;
  successorId?: number;
  planFingerprint?: string;
  transferredOccurrenceCount?: number;
  remainingCyclesTotal?: number | null;
}

const review = async (input: BudgetScheduleSuccessorInput): Promise<Response> => {
  const result = await localApiPost<Response>(
    "/prototype/repositories/budgets/schedule-successor/dry-run",
    input,
  );
  if (!result.ok || !result.planFingerprint) {
    throw new LocalApiError(result.code ?? "schedule_successor_review_failed", "Budget schedule change review failed.");
  }
  return result;
};

export const createBudgetScheduleSuccessor = async (input: BudgetScheduleSuccessorInput): Promise<Response> => {
  const dryRun = await review(input);
  const result = await localApiPost<Response>(
    "/prototype/repositories/budgets/schedule-successor/write",
    {
      ...input,
      dryRunReviewed: true,
      confirmation: "create budget schedule successor in sqlite",
      expectedPlanFingerprint: dryRun.planFingerprint,
    },
  );
  if (!result.ok) {
    throw new LocalApiError(result.code ?? "schedule_successor_write_failed", "Budget schedule change failed.");
  }
  return result;
};

export const dryRunBudgetScheduleSuccessor = review;

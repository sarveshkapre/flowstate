import type { FailureReasonCode, ReviewDecisionRecord, ReviewDecisionValue } from "@flowstate/types";

type DecisionCounts = Record<ReviewDecisionValue, number>;

export type ReviewDecisionSummary = {
  total: number;
  by_decision: DecisionCounts;
  error_rate: number;
  failure_hotspots: Array<{ reason: FailureReasonCode; count: number }>;
  field_hotspots: Array<{ field_name: string; total: number; non_correct: number }>;
  reviewer_activity: Array<{ reviewer: string; count: number }>;
};

const EMPTY_DECISION_COUNTS: DecisionCounts = {
  correct: 0,
  incorrect: 0,
  missing: 0,
  uncertain: 0,
};

function sortByCountThenName<T extends { count: number }>(entries: T[], nameOf: (entry: T) => string) {
  return entries.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return nameOf(a).localeCompare(nameOf(b));
  });
}

export function summarizeReviewDecisions(decisions: ReviewDecisionRecord[]): ReviewDecisionSummary {
  const byDecision: DecisionCounts = { ...EMPTY_DECISION_COUNTS };
  const failureCounts = new Map<FailureReasonCode, number>();
  const fieldCounts = new Map<string, { total: number; nonCorrect: number }>();
  const reviewerCounts = new Map<string, number>();

  for (const decision of decisions) {
    byDecision[decision.decision] += 1;

    if (decision.failure_reason) {
      failureCounts.set(decision.failure_reason, (failureCounts.get(decision.failure_reason) ?? 0) + 1);
    }

    const fieldKey = decision.field_name.trim().toLowerCase();
    const currentField = fieldCounts.get(fieldKey) ?? { total: 0, nonCorrect: 0 };
    currentField.total += 1;
    if (decision.decision !== "correct") {
      currentField.nonCorrect += 1;
    }
    fieldCounts.set(fieldKey, currentField);

    const reviewer = decision.reviewer?.trim().toLowerCase() || "unassigned";
    reviewerCounts.set(reviewer, (reviewerCounts.get(reviewer) ?? 0) + 1);
  }

  const total = decisions.length;
  const nonCorrectCount = byDecision.incorrect + byDecision.missing + byDecision.uncertain;
  const errorRate = total > 0 ? nonCorrectCount / total : 0;

  const failureHotspots = sortByCountThenName(
    [...failureCounts.entries()].map(([reason, count]) => ({ reason, count })),
    (entry) => entry.reason,
  );
  const fieldHotspots = sortByCountThenName(
    [...fieldCounts.entries()].map(([fieldName, value]) => ({
      field_name: fieldName,
      total: value.total,
      non_correct: value.nonCorrect,
      count: value.nonCorrect,
    })),
    (entry) => entry.field_name,
  ).map(({ field_name, total, non_correct }) => ({ field_name, total, non_correct }));
  const reviewerActivity = sortByCountThenName(
    [...reviewerCounts.entries()].map(([reviewer, count]) => ({ reviewer, count })),
    (entry) => entry.reviewer,
  );

  return {
    total,
    by_decision: byDecision,
    error_rate: Number(errorRate.toFixed(4)),
    failure_hotspots: failureHotspots.slice(0, 5),
    field_hotspots: fieldHotspots.slice(0, 5),
    reviewer_activity: reviewerActivity.slice(0, 5),
  };
}

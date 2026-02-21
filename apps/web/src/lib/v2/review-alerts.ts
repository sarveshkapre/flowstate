export type ReviewAlertSummary = {
  unreviewed_queues: number;
  at_risk_queues: number;
  stale_queues: number;
  avg_error_rate: number;
};

export type ReviewAlertThresholds = {
  minUnreviewedQueues: number;
  minAtRiskQueues: number;
  minStaleQueues: number;
  minAvgErrorRate: number;
};

export type ReviewAlertEvaluation = {
  should_alert: boolean;
  reasons: string[];
};

function roundRate(value: number) {
  return Number(value.toFixed(4));
}

export function normalizeReviewAlertThresholds(input: Partial<ReviewAlertThresholds>): ReviewAlertThresholds {
  const minUnreviewedQueues = Number.isFinite(input.minUnreviewedQueues) ? Math.max(0, Math.floor(input.minUnreviewedQueues ?? 0)) : 0;
  const minAtRiskQueues = Number.isFinite(input.minAtRiskQueues) ? Math.max(0, Math.floor(input.minAtRiskQueues ?? 0)) : 0;
  const minStaleQueues = Number.isFinite(input.minStaleQueues) ? Math.max(0, Math.floor(input.minStaleQueues ?? 0)) : 0;
  const minAvgErrorRateRaw = Number.isFinite(input.minAvgErrorRate) ? (input.minAvgErrorRate ?? 0) : 0;
  const minAvgErrorRate = Math.max(0, Math.min(1, roundRate(minAvgErrorRateRaw)));

  return {
    minUnreviewedQueues,
    minAtRiskQueues,
    minStaleQueues,
    minAvgErrorRate,
  };
}

export function evaluateReviewAlert(input: {
  summary: ReviewAlertSummary;
  thresholds: ReviewAlertThresholds;
}): ReviewAlertEvaluation {
  const thresholds = normalizeReviewAlertThresholds(input.thresholds);
  const reasons: string[] = [];

  if (input.summary.unreviewed_queues >= thresholds.minUnreviewedQueues && thresholds.minUnreviewedQueues > 0) {
    reasons.push(`unreviewed_queues >= ${thresholds.minUnreviewedQueues}`);
  }

  if (input.summary.at_risk_queues >= thresholds.minAtRiskQueues && thresholds.minAtRiskQueues > 0) {
    reasons.push(`at_risk_queues >= ${thresholds.minAtRiskQueues}`);
  }

  if (input.summary.stale_queues >= thresholds.minStaleQueues && thresholds.minStaleQueues > 0) {
    reasons.push(`stale_queues >= ${thresholds.minStaleQueues}`);
  }

  if (input.summary.avg_error_rate >= thresholds.minAvgErrorRate && thresholds.minAvgErrorRate > 0) {
    reasons.push(`avg_error_rate >= ${thresholds.minAvgErrorRate}`);
  }

  return {
    should_alert: reasons.length > 0,
    reasons,
  };
}

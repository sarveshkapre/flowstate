import type { ConnectorInsights } from "@/lib/v2/connector-insights";

type ConnectorDeliverySummary = {
  total: number;
  queued: number;
  retrying: number;
  delivered: number;
  dead_lettered: number;
  due_now: number;
  earliest_next_attempt_at: string | null;
};

export type ConnectorReliabilityRecommendation = "healthy" | "process_queue" | "redrive_dead_letters";
export type ConnectorReliabilityTrend = "improving" | "worsening" | "stable";

export type ConnectorReliabilityReason =
  | "dead_letters_present"
  | "retries_due_now"
  | "queue_backlog"
  | "low_delivery_success"
  | "low_attempt_success"
  | "high_error_volume"
  | "high_attempt_count";

export type ConnectorRiskBreakdown = {
  dead_letter_pressure: number;
  due_now_pressure: number;
  retry_pressure: number;
  queued_pressure: number;
  max_attempt_pressure: number;
  delivery_failure_pressure: number;
  attempt_failure_pressure: number;
  error_pressure: number;
  total: number;
};

export type ConnectorReliabilityItem = {
  connector_type: string;
  risk_score: number;
  recommendation: ConnectorReliabilityRecommendation;
  risk_reasons: ConnectorReliabilityReason[];
  risk_breakdown: ConnectorRiskBreakdown;
  summary: ConnectorDeliverySummary;
  insights: ConnectorInsights;
};

export type ConnectorReliabilityTrendComparison = {
  baseline_risk_score: number;
  risk_delta: number;
  risk_trend: ConnectorReliabilityTrend;
};

type ReliabilityInput = {
  connector_type: string;
  summary: ConnectorDeliverySummary;
  insights: ConnectorInsights;
};

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

function recommendAction(summary: ConnectorDeliverySummary): ConnectorReliabilityRecommendation {
  if (summary.dead_lettered > 0) {
    return "redrive_dead_letters";
  }
  if (summary.retrying > 0 || summary.queued > 0 || summary.due_now > 0) {
    return "process_queue";
  }
  return "healthy";
}

function computeRiskBreakdown(input: ReliabilityInput): ConnectorRiskBreakdown {
  const deliveryFailure = 1 - input.insights.delivery_success_rate;
  const attemptFailure = input.insights.attempt_success_rate === null ? 0 : 1 - input.insights.attempt_success_rate;
  const errorPressure = Math.min(input.insights.top_errors.reduce((sum, entry) => sum + entry.count, 0), 50);

  const breakdown = {
    dead_letter_pressure: round(input.summary.dead_lettered * 10, 2),
    due_now_pressure: round(input.summary.due_now * 6, 2),
    retry_pressure: round(input.summary.retrying * 4, 2),
    queued_pressure: round(input.summary.queued * 2, 2),
    max_attempt_pressure: round(input.insights.max_attempts_observed * 1.5, 2),
    delivery_failure_pressure: round(deliveryFailure * 40, 2),
    attempt_failure_pressure: round(attemptFailure * 20, 2),
    error_pressure: round(errorPressure * 0.5, 2),
    total: 0,
  } satisfies Omit<ConnectorRiskBreakdown, "total"> & { total: number };

  breakdown.total = round(
    Math.max(
      0,
      breakdown.dead_letter_pressure +
        breakdown.due_now_pressure +
        breakdown.retry_pressure +
        breakdown.queued_pressure +
        breakdown.max_attempt_pressure +
        breakdown.delivery_failure_pressure +
        breakdown.attempt_failure_pressure +
        breakdown.error_pressure,
    ),
    2,
  );

  return breakdown;
}

function computeRiskReasons(input: ReliabilityInput): ConnectorReliabilityReason[] {
  const reasons: ConnectorReliabilityReason[] = [];
  if (input.summary.dead_lettered > 0) {
    reasons.push("dead_letters_present");
  }
  if (input.summary.due_now > 0 || input.summary.retrying > 0) {
    reasons.push("retries_due_now");
  }
  if (input.summary.queued > 0) {
    reasons.push("queue_backlog");
  }
  if (input.insights.delivery_success_rate < 0.95) {
    reasons.push("low_delivery_success");
  }
  if (input.insights.attempt_success_rate !== null && input.insights.attempt_success_rate < 0.9) {
    reasons.push("low_attempt_success");
  }
  if (input.insights.top_errors.reduce((sum, entry) => sum + entry.count, 0) >= 5) {
    reasons.push("high_error_volume");
  }
  if (input.insights.max_attempts_observed >= 3) {
    reasons.push("high_attempt_count");
  }

  return reasons;
}

export function resolveConnectorReliabilityTrend(input: {
  riskScore: number;
  baselineRiskScore: number;
  stableDelta?: number;
}): ConnectorReliabilityTrendComparison {
  const stableDelta = Math.max(0, input.stableDelta ?? 3);
  const delta = round(input.riskScore - input.baselineRiskScore, 2);
  let trend: ConnectorReliabilityTrend = "stable";

  if (delta > stableDelta) {
    trend = "worsening";
  } else if (delta < -stableDelta) {
    trend = "improving";
  }

  return {
    baseline_risk_score: round(Math.max(0, input.baselineRiskScore), 2),
    risk_delta: delta,
    risk_trend: trend,
  };
}

export function rankConnectorReliability(inputs: ReliabilityInput[]): ConnectorReliabilityItem[] {
  return inputs
    .map((input) => {
      const riskBreakdown = computeRiskBreakdown(input);
      return {
      connector_type: input.connector_type,
      risk_score: riskBreakdown.total,
      recommendation: recommendAction(input.summary),
      risk_reasons: computeRiskReasons(input),
      risk_breakdown: riskBreakdown,
      summary: input.summary,
      insights: input.insights,
      };
    })
    .sort((left, right) => {
      if (right.risk_score !== left.risk_score) {
        return right.risk_score - left.risk_score;
      }
      return left.connector_type.localeCompare(right.connector_type);
    });
}

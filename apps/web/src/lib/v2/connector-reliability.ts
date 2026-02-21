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

export type ConnectorReliabilityItem = {
  connector_type: string;
  risk_score: number;
  recommendation: ConnectorReliabilityRecommendation;
  summary: ConnectorDeliverySummary;
  insights: ConnectorInsights;
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

function computeRiskScore(input: ReliabilityInput) {
  const deliveryFailure = 1 - input.insights.delivery_success_rate;
  const attemptFailure = input.insights.attempt_success_rate === null ? 0 : 1 - input.insights.attempt_success_rate;
  const errorPressure = Math.min(input.insights.top_errors.reduce((sum, entry) => sum + entry.count, 0), 50);

  const weighted =
    input.summary.dead_lettered * 10 +
    input.summary.due_now * 6 +
    input.summary.retrying * 4 +
    input.summary.queued * 2 +
    input.insights.max_attempts_observed * 1.5 +
    deliveryFailure * 40 +
    attemptFailure * 20 +
    errorPressure * 0.5;

  return round(Math.max(0, weighted), 2);
}

export function rankConnectorReliability(inputs: ReliabilityInput[]): ConnectorReliabilityItem[] {
  return inputs
    .map((input) => ({
      connector_type: input.connector_type,
      risk_score: computeRiskScore(input),
      recommendation: recommendAction(input.summary),
      summary: input.summary,
      insights: input.insights,
    }))
    .sort((left, right) => {
      if (right.risk_score !== left.risk_score) {
        return right.risk_score - left.risk_score;
      }
      return left.connector_type.localeCompare(right.connector_type);
    });
}

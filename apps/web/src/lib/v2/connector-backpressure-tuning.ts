import type { ConnectorQueuePressureSummary } from "@/lib/v2/connector-backpressure";

export type ConnectorBackpressurePressureTier = "low" | "medium" | "high";

export type ConnectorBackpressureRecommendation = {
  enabled: boolean;
  maxRetrying: number;
  maxDueNow: number;
  minLimit: number;
};

export type ConnectorBackpressureSuggestionItem = {
  connector_type: string;
  pressure_tier: ConnectorBackpressurePressureTier;
  summary: ConnectorQueuePressureSummary & { outstanding: number };
  recommendation: ConnectorBackpressureRecommendation;
};

export type ConnectorBackpressureSuggestions = {
  recommendation: ConnectorBackpressureRecommendation;
  by_connector: ConnectorBackpressureSuggestionItem[];
};

const DEFAULT_RECOMMENDATION: ConnectorBackpressureRecommendation = {
  enabled: true,
  maxRetrying: 50,
  maxDueNow: 100,
  minLimit: 1,
};

function clampPositiveInt(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function clampNonNegativeInt(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function tierForSummary(summary: ConnectorQueuePressureSummary & { outstanding: number }): ConnectorBackpressurePressureTier {
  const retryRatio = summary.retrying / Math.max(summary.outstanding, 1);
  const dueRatio = summary.due_now / Math.max(summary.outstanding, 1);

  if (
    summary.retrying >= 50 ||
    summary.due_now >= 100 ||
    summary.outstanding >= 200 ||
    retryRatio >= 0.6 ||
    dueRatio >= 0.8
  ) {
    return "high";
  }

  if (
    summary.retrying >= 20 ||
    summary.due_now >= 40 ||
    summary.outstanding >= 80 ||
    retryRatio >= 0.35 ||
    dueRatio >= 0.5
  ) {
    return "medium";
  }

  return "low";
}

function recommendationForSummary(summary: ConnectorQueuePressureSummary & { outstanding: number }) {
  const tier = tierForSummary(summary);
  const maxRetrying = clampPositiveInt(roundUp(Math.max(50, summary.retrying * 2), 5), 50, 10_000);
  const maxDueNow = clampPositiveInt(roundUp(Math.max(100, summary.due_now * 2), 10), 100, 10_000);
  const minLimit = tier === "high" ? 1 : tier === "medium" ? 2 : 3;

  return {
    tier,
    recommendation: {
      enabled: true,
      maxRetrying,
      maxDueNow,
      minLimit,
    } satisfies ConnectorBackpressureRecommendation,
  };
}

export function suggestConnectorBackpressureSettings(input: {
  summaries: Array<{
    connectorType: string;
    summary: ConnectorQueuePressureSummary;
  }>;
}): ConnectorBackpressureSuggestions {
  if (!Array.isArray(input.summaries) || input.summaries.length === 0) {
    return {
      recommendation: DEFAULT_RECOMMENDATION,
      by_connector: [],
    };
  }

  const byConnector = input.summaries
    .map((item) => {
      const normalizedSummary = {
        queued: clampNonNegativeInt(item.summary.queued),
        retrying: clampNonNegativeInt(item.summary.retrying),
        due_now: clampNonNegativeInt(item.summary.due_now),
        outstanding: clampNonNegativeInt(item.summary.queued + item.summary.retrying),
      };
      const result = recommendationForSummary(normalizedSummary);

      return {
        connector_type: item.connectorType,
        pressure_tier: result.tier,
        summary: normalizedSummary,
        recommendation: result.recommendation,
      } satisfies ConnectorBackpressureSuggestionItem;
    })
    .sort((left, right) => {
      const tierScore = (tier: ConnectorBackpressurePressureTier) => (tier === "high" ? 3 : tier === "medium" ? 2 : 1);
      const tierDelta = tierScore(right.pressure_tier) - tierScore(left.pressure_tier);
      if (tierDelta !== 0) {
        return tierDelta;
      }
      return right.summary.outstanding - left.summary.outstanding;
    });

  return {
    recommendation: {
      enabled: true,
      maxRetrying: Math.max(...byConnector.map((item) => item.recommendation.maxRetrying)),
      maxDueNow: Math.max(...byConnector.map((item) => item.recommendation.maxDueNow)),
      minLimit: Math.min(...byConnector.map((item) => item.recommendation.minLimit)),
    },
    by_connector: byConnector,
  };
}

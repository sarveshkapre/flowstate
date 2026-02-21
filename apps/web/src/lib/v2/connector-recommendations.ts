import type {
  ConnectorReliabilityItem,
  ConnectorReliabilityReason,
  ConnectorReliabilityRecommendation,
} from "@/lib/v2/connector-reliability";

export type ConnectorRecommendationAction = {
  connector_type: string;
  recommendation: Exclude<ConnectorReliabilityRecommendation, "healthy">;
  risk_score: number;
  risk_reasons: ConnectorReliabilityReason[];
};

export type ConnectorRecommendationSkipReason = "cooldown_active";

export type ConnectorRecommendationSkippedAction = {
  connector_type: string;
  recommendation: Exclude<ConnectorReliabilityRecommendation, "healthy">;
  risk_score: number;
  risk_reasons: ConnectorReliabilityReason[];
  reason: ConnectorRecommendationSkipReason;
  last_action_at: string;
  retry_after_seconds: number;
};

export function selectConnectorRecommendationActions(input: {
  connectors: ConnectorReliabilityItem[];
  riskThreshold: number;
  maxActions: number;
  allowProcessQueue: boolean;
  allowRedriveDeadLetters: boolean;
}) {
  const sorted = [...input.connectors].sort((left, right) => right.risk_score - left.risk_score);

  const selected: ConnectorRecommendationAction[] = [];
  const threshold = Number.isFinite(input.riskThreshold) ? input.riskThreshold : 0;
  const maxActions = Math.max(1, Math.min(Math.floor(input.maxActions || 1), 20));

  for (const connector of sorted) {
    if (connector.risk_score < threshold) {
      continue;
    }

    if (connector.recommendation === "healthy") {
      continue;
    }

    if (connector.recommendation === "process_queue" && !input.allowProcessQueue) {
      continue;
    }

    if (connector.recommendation === "redrive_dead_letters" && !input.allowRedriveDeadLetters) {
      continue;
    }

    selected.push({
      connector_type: connector.connector_type,
      recommendation: connector.recommendation,
      risk_score: connector.risk_score,
      risk_reasons: connector.risk_reasons,
    });

    if (selected.length >= maxActions) {
      break;
    }
  }

  return selected;
}

export function filterConnectorRecommendationCooldown(input: {
  actions: ConnectorRecommendationAction[];
  latestActionAtByConnector: Record<string, string | undefined>;
  cooldownMinutes: number;
  nowMs?: number;
}) {
  const cooldownMinutes = Math.max(0, input.cooldownMinutes);
  if (cooldownMinutes === 0) {
    return {
      eligible: input.actions,
      skipped: [] as ConnectorRecommendationSkippedAction[],
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const eligible: ConnectorRecommendationAction[] = [];
  const skipped: ConnectorRecommendationSkippedAction[] = [];

  for (const action of input.actions) {
    const lastActionAt = input.latestActionAtByConnector[action.connector_type];
    if (!lastActionAt) {
      eligible.push(action);
      continue;
    }

    const lastActionMs = Date.parse(lastActionAt);
    if (Number.isNaN(lastActionMs)) {
      eligible.push(action);
      continue;
    }

    const elapsedMs = Math.max(0, nowMs - lastActionMs);
    if (elapsedMs >= cooldownMs) {
      eligible.push(action);
      continue;
    }

    skipped.push({
      connector_type: action.connector_type,
      recommendation: action.recommendation,
      risk_score: action.risk_score,
      risk_reasons: action.risk_reasons,
      reason: "cooldown_active",
      last_action_at: lastActionAt,
      retry_after_seconds: Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000)),
    });
  }

  return {
    eligible,
    skipped,
  };
}

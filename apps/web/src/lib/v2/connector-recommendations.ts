import type { ConnectorReliabilityItem, ConnectorReliabilityRecommendation } from "@/lib/v2/connector-reliability";

export type ConnectorRecommendationAction = {
  connector_type: string;
  recommendation: Exclude<ConnectorReliabilityRecommendation, "healthy">;
  risk_score: number;
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
    });

    if (selected.length >= maxActions) {
      break;
    }
  }

  return selected;
}

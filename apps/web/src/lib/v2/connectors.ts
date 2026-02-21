export const SUPPORTED_CONNECTOR_TYPES = ["webhook", "slack", "jira", "sqs", "db"] as const;
export type SupportedConnectorType = (typeof SUPPORTED_CONNECTOR_TYPES)[number];

const SUPPORTED_CONNECTOR_TYPE_SET = new Set<string>(SUPPORTED_CONNECTOR_TYPES);

const CONNECTOR_TYPE_ALIASES: Record<string, SupportedConnectorType> = {
  slack_webhook: "slack",
  jira_issue: "jira",
  sink_sqs: "sqs",
  aws_sqs: "sqs",
  sink_db: "db",
  database: "db",
};

export function canonicalConnectorType(rawType: string): SupportedConnectorType | null {
  const value = rawType.trim().toLowerCase();
  const mapped = CONNECTOR_TYPE_ALIASES[value] ?? value;

  if (SUPPORTED_CONNECTOR_TYPE_SET.has(mapped)) {
    return mapped as SupportedConnectorType;
  }

  return null;
}

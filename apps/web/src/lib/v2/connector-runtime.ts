type JsonRecord = Record<string, unknown>;

export type ConnectorNormalizedType = "webhook" | "slack" | "jira";

export type ConnectorDeliveryResult = {
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  responseBody: string | null;
};

type ConnectorValidationResult = {
  ok: boolean;
  connectorType: ConnectorNormalizedType | null;
  errors: string[];
  sanitizedConfig: JsonRecord;
};

type ResolvedWebhookConfig = {
  targetUrl: string;
};

type ResolvedSlackConfig = {
  webhookUrl: string;
};

type ResolvedJiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFromConfigOrEnv(config: JsonRecord, key: string, envKey: string): string | null {
  return readString(config, key) ?? readString(config, envKey) ?? (process.env[envKey]?.trim() || null);
}

function redactSecrets(value: unknown, parentKey = "", depth = 0): unknown {
  if (depth > 8) {
    return "[max-depth]";
  }

  const secretPattern = /(token|secret|password|authorization|api[_-]?key)/i;

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (secretPattern.test(parentKey)) {
      return "[redacted]";
    }
    if (value.length > 120) {
      return `${value.slice(0, 120)}...[truncated]`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => redactSecrets(item, parentKey, depth + 1));
  }

  if (typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, item] of Object.entries(value as JsonRecord).slice(0, 100)) {
      out[key] = secretPattern.test(key) ? "[redacted]" : redactSecrets(item, key, depth + 1);
    }
    return out;
  }

  return String(value);
}

function parseHeaders(config: JsonRecord): Record<string, string> {
  const headersRecord = asRecord(config.headers);
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(headersRecord)) {
    if (typeof value !== "string") {
      continue;
    }

    const name = key.trim();
    const headerValue = value.trim();
    if (!name || !headerValue) {
      continue;
    }

    headers[name] = headerValue;
  }

  return headers;
}

export function normalizeConnectorType(rawType: string): ConnectorNormalizedType | null {
  const value = rawType.trim().toLowerCase();

  if (value === "webhook") {
    return "webhook";
  }
  if (value === "slack" || value === "slack_webhook") {
    return "slack";
  }
  if (value === "jira" || value === "jira_issue") {
    return "jira";
  }

  return null;
}

function resolveWebhookConfig(config: JsonRecord): ResolvedWebhookConfig | null {
  const targetUrl = readFromConfigOrEnv(config, "targetUrl", "FLOWSTATE_CONNECTOR_WEBHOOK_URL");

  if (!targetUrl) {
    return null;
  }

  return { targetUrl };
}

function resolveSlackConfig(config: JsonRecord): ResolvedSlackConfig | null {
  const webhookUrl =
    readFromConfigOrEnv(config, "webhookUrl", "FLOWSTATE_CONNECTOR_SLACK_WEBHOOK_URL") ??
    readFromConfigOrEnv(config, "targetUrl", "FLOWSTATE_CONNECTOR_SLACK_WEBHOOK_URL");

  if (!webhookUrl) {
    return null;
  }

  return { webhookUrl };
}

function resolveJiraConfig(config: JsonRecord): ResolvedJiraConfig | null {
  const baseUrl = readFromConfigOrEnv(config, "baseUrl", "FLOWSTATE_CONNECTOR_JIRA_BASE_URL");
  const email = readFromConfigOrEnv(config, "email", "FLOWSTATE_CONNECTOR_JIRA_EMAIL");
  const apiToken = readFromConfigOrEnv(config, "apiToken", "FLOWSTATE_CONNECTOR_JIRA_API_TOKEN");
  const projectKey = readFromConfigOrEnv(config, "projectKey", "FLOWSTATE_CONNECTOR_JIRA_PROJECT_KEY");
  const issueType = readFromConfigOrEnv(config, "issueType", "FLOWSTATE_CONNECTOR_JIRA_ISSUE_TYPE") ?? "Task";

  if (!baseUrl || !email || !apiToken || !projectKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/g, ""),
    email,
    apiToken,
    projectKey,
    issueType,
  };
}

function validateHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateConnectorConfig(connectorTypeRaw: string, configInput: unknown): ConnectorValidationResult {
  const connectorType = normalizeConnectorType(connectorTypeRaw);
  const config = asRecord(configInput);
  const errors: string[] = [];

  if (!connectorType) {
    return {
      ok: false,
      connectorType: null,
      errors: ["Unsupported connector type. Supported: webhook, slack, jira."],
      sanitizedConfig: redactSecrets(config) as JsonRecord,
    };
  }

  if (connectorType === "webhook") {
    const resolved = resolveWebhookConfig(config);
    if (!resolved) {
      errors.push("Missing webhook target URL. Provide config.targetUrl or FLOWSTATE_CONNECTOR_WEBHOOK_URL.");
    } else if (!validateHttpUrl(resolved.targetUrl)) {
      errors.push("Webhook target URL must be a valid http(s) URL.");
    }
  }

  if (connectorType === "slack") {
    const resolved = resolveSlackConfig(config);
    if (!resolved) {
      errors.push("Missing Slack webhook URL. Provide config.webhookUrl or FLOWSTATE_CONNECTOR_SLACK_WEBHOOK_URL.");
    } else if (!validateHttpUrl(resolved.webhookUrl)) {
      errors.push("Slack webhook URL must be a valid http(s) URL.");
    }
  }

  if (connectorType === "jira") {
    const resolved = resolveJiraConfig(config);
    if (!resolved) {
      errors.push(
        "Missing Jira config. Required: baseUrl/email/apiToken/projectKey, or FLOWSTATE_CONNECTOR_JIRA_* env vars.",
      );
    } else if (!validateHttpUrl(resolved.baseUrl)) {
      errors.push("Jira baseUrl must be a valid http(s) URL.");
    }
  }

  return {
    ok: errors.length === 0,
    connectorType,
    errors,
    sanitizedConfig: redactSecrets(config) as JsonRecord,
  };
}

function normalizeResponseText(text: string | null): string | null {
  if (!text) {
    return null;
  }

  if (text.length <= 2_000) {
    return text;
  }

  return `${text.slice(0, 2_000)}...[truncated]`;
}

function toSlackPayload(payload: unknown): JsonRecord {
  const record = asRecord(payload);
  const text = readString(record, "text");

  if (text) {
    return {
      ...record,
      text,
    };
  }

  return {
    ...record,
    text: JSON.stringify(payload),
  };
}

function toJiraPayload(payload: unknown, projectKey: string, issueType: string) {
  const record = asRecord(payload);
  const summary =
    readString(record, "summary") ?? readString(record, "title") ?? `Flowstate event ${new Date().toISOString()}`;
  const description = readString(record, "description") ?? JSON.stringify(payload, null, 2);

  return {
    fields: {
      project: { key: projectKey },
      summary,
      description: description.slice(0, 6_000),
      issuetype: { name: issueType },
    },
  };
}

async function executeHttpPost(url: string, body: unknown, headers?: Record<string, string>): Promise<ConnectorDeliveryResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await response.text().catch(() => "");
    return {
      success: response.ok,
      statusCode: response.status,
      errorMessage: response.ok ? null : `Remote endpoint returned ${response.status}`,
      responseBody: normalizeResponseText(text || null),
    };
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      errorMessage: error instanceof Error ? error.message : "Connector request failed",
      responseBody: null,
    };
  }
}

export async function dispatchConnectorDelivery(input: {
  connectorTypeRaw: string;
  payload: unknown;
  config?: unknown;
}): Promise<ConnectorDeliveryResult> {
  const validation = validateConnectorConfig(input.connectorTypeRaw, input.config ?? {});

  if (!validation.ok || !validation.connectorType) {
    return {
      success: false,
      statusCode: null,
      errorMessage: validation.errors.join(" "),
      responseBody: null,
    };
  }

  const config = asRecord(input.config);

  if (validation.connectorType === "webhook") {
    const webhookConfig = resolveWebhookConfig(config);
    if (!webhookConfig) {
      return {
        success: false,
        statusCode: null,
        errorMessage: "Missing webhook configuration",
        responseBody: null,
      };
    }

    return executeHttpPost(webhookConfig.targetUrl, input.payload, parseHeaders(config));
  }

  if (validation.connectorType === "slack") {
    const slackConfig = resolveSlackConfig(config);
    if (!slackConfig) {
      return {
        success: false,
        statusCode: null,
        errorMessage: "Missing Slack webhook configuration",
        responseBody: null,
      };
    }

    return executeHttpPost(slackConfig.webhookUrl, toSlackPayload(input.payload), parseHeaders(config));
  }

  const jiraConfig = resolveJiraConfig(config);
  if (!jiraConfig) {
    return {
      success: false,
      statusCode: null,
      errorMessage: "Missing Jira configuration",
      responseBody: null,
    };
  }

  const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString("base64");
  return executeHttpPost(
    `${jiraConfig.baseUrl}/rest/api/2/issue`,
    toJiraPayload(input.payload, jiraConfig.projectKey, jiraConfig.issueType),
    {
      authorization: `Basic ${auth}`,
      accept: "application/json",
    },
  );
}

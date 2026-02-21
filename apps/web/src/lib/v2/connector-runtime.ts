import { createHash, createHmac } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type ConnectorNormalizedType = "webhook" | "slack" | "jira" | "sqs" | "db";

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

type ResolvedSqsConfig = {
  queueUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  messageGroupId: string | null;
  delaySeconds: number | null;
};

type ResolvedDbConfig = {
  ingestUrl: string;
  table: string;
  apiKey: string | null;
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
  if (value === "sqs" || value === "sink_sqs" || value === "aws_sqs") {
    return "sqs";
  }
  if (value === "db" || value === "sink_db" || value === "database") {
    return "db";
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

function inferAwsRegionFromQueueUrl(queueUrl: string): string | null {
  try {
    const parsed = new URL(queueUrl);
    const host = parsed.hostname.toLowerCase();
    const match = host.match(/\.sqs[.-]([a-z0-9-]+)\./);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readIntegerFromConfigOrEnv(config: JsonRecord, key: string, envKey: string): number | null {
  const value = readString(config, key) ?? (process.env[envKey]?.trim() || null);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed);
}

function resolveSqsConfig(config: JsonRecord): ResolvedSqsConfig | null {
  const queueUrl = readFromConfigOrEnv(config, "queueUrl", "FLOWSTATE_CONNECTOR_SQS_QUEUE_URL");
  const accessKeyId = readFromConfigOrEnv(config, "accessKeyId", "FLOWSTATE_CONNECTOR_SQS_ACCESS_KEY_ID");
  const secretAccessKey = readFromConfigOrEnv(config, "secretAccessKey", "FLOWSTATE_CONNECTOR_SQS_SECRET_ACCESS_KEY");
  const explicitRegion = readFromConfigOrEnv(config, "region", "FLOWSTATE_CONNECTOR_SQS_REGION");
  const inferredRegion = queueUrl ? inferAwsRegionFromQueueUrl(queueUrl) : null;
  const region = explicitRegion ?? inferredRegion ?? "us-east-1";
  const sessionToken = readFromConfigOrEnv(config, "sessionToken", "FLOWSTATE_CONNECTOR_SQS_SESSION_TOKEN");
  const messageGroupId = readFromConfigOrEnv(config, "messageGroupId", "FLOWSTATE_CONNECTOR_SQS_MESSAGE_GROUP_ID");
  const delaySeconds = readIntegerFromConfigOrEnv(config, "delaySeconds", "FLOWSTATE_CONNECTOR_SQS_DELAY_SECONDS");

  if (!queueUrl || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    queueUrl,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    messageGroupId,
    delaySeconds,
  };
}

function resolveDbConfig(config: JsonRecord): ResolvedDbConfig | null {
  const ingestUrl =
    readFromConfigOrEnv(config, "ingestUrl", "FLOWSTATE_CONNECTOR_DB_INGEST_URL") ??
    readFromConfigOrEnv(config, "targetUrl", "FLOWSTATE_CONNECTOR_DB_INGEST_URL");
  const table = readFromConfigOrEnv(config, "table", "FLOWSTATE_CONNECTOR_DB_TABLE") ?? "flowstate_events";
  const apiKey = readFromConfigOrEnv(config, "apiKey", "FLOWSTATE_CONNECTOR_DB_API_KEY");

  if (!ingestUrl || !table) {
    return null;
  }

  return {
    ingestUrl,
    table,
    apiKey,
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
      errors: ["Unsupported connector type. Supported: webhook, slack, jira, sqs, db."],
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

  if (connectorType === "sqs") {
    const resolved = resolveSqsConfig(config);
    if (!resolved) {
      errors.push(
        "Missing SQS config. Required: queueUrl/accessKeyId/secretAccessKey, or FLOWSTATE_CONNECTOR_SQS_* env vars.",
      );
    } else {
      if (!validateHttpUrl(resolved.queueUrl)) {
        errors.push("SQS queueUrl must be a valid http(s) URL.");
      }
      if (!/^[a-z0-9-]+$/i.test(resolved.region)) {
        errors.push("SQS region must contain only letters, numbers, and hyphens.");
      }
      if (resolved.delaySeconds !== null && (resolved.delaySeconds < 0 || resolved.delaySeconds > 900)) {
        errors.push("SQS delaySeconds must be between 0 and 900.");
      }
      if (resolved.queueUrl.toLowerCase().endsWith(".fifo") && !resolved.messageGroupId) {
        errors.push("SQS FIFO queues require messageGroupId (config.messageGroupId or FLOWSTATE_CONNECTOR_SQS_MESSAGE_GROUP_ID).");
      }
    }
  }

  if (connectorType === "db") {
    const resolved = resolveDbConfig(config);
    if (!resolved) {
      errors.push("Missing DB config. Required: ingestUrl (or targetUrl), and optional table/apiKey.");
    } else if (!validateHttpUrl(resolved.ingestUrl)) {
      errors.push("DB ingestUrl must be a valid http(s) URL.");
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

function toDbPayload(payload: unknown, table: string) {
  return {
    table,
    record: payload,
    inserted_at: new Date().toISOString(),
    source: "flowstate.connector.db",
  };
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toAmzDate(date: Date) {
  const iso = date.toISOString();
  return {
    amzDate: iso.replace(/[:-]|\.\d{3}/g, ""),
    dateStamp: iso.slice(0, 10).replace(/-/g, ""),
  };
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(url: URL) {
  const pairs = [...url.searchParams.entries()].map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const);
  pairs.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

async function executeSqsSendMessage(config: ResolvedSqsConfig, payload: unknown): Promise<ConnectorDeliveryResult> {
  try {
    const queueUrl = new URL(config.queueUrl);
    const bodyParams = new URLSearchParams();
    bodyParams.set("Action", "SendMessage");
    bodyParams.set("Version", "2012-11-05");
    bodyParams.set("MessageBody", JSON.stringify(payload));

    if (config.messageGroupId) {
      bodyParams.set("MessageGroupId", config.messageGroupId);
      bodyParams.set("MessageDeduplicationId", sha256Hex(JSON.stringify(payload)).slice(0, 128));
    }
    if (config.delaySeconds !== null) {
      bodyParams.set("DelaySeconds", String(config.delaySeconds));
    }

    const requestBody = bodyParams.toString();
    const { amzDate, dateStamp } = toAmzDate(new Date());
    const canonicalUri = queueUrl.pathname || "/";
    const query = canonicalQueryString(queueUrl);
    const payloadHash = sha256Hex(requestBody);
    const host = queueUrl.host;
    const credentialScope = `${dateStamp}/${config.region}/sqs/aws4_request`;

    const headersForSig: Array<[string, string]> = [
      ["content-type", "application/x-www-form-urlencoded; charset=utf-8"],
      ["host", host],
      ["x-amz-date", amzDate],
    ];
    if (config.sessionToken) {
      headersForSig.push(["x-amz-security-token", config.sessionToken]);
    }
    headersForSig.sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalHeaders = headersForSig.map(([k, v]) => `${k}:${v}`).join("\n");
    const signedHeaders = headersForSig.map(([k]) => k).join(";");
    const canonicalRequest = [
      "POST",
      canonicalUri,
      query,
      `${canonicalHeaders}\n`,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region, "sqs"))
      .update(stringToSign, "utf8")
      .digest("hex");

    const authorization = [
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const response = await fetch(queueUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        "x-amz-date": amzDate,
        ...(config.sessionToken ? { "x-amz-security-token": config.sessionToken } : {}),
        authorization,
      },
      body: requestBody,
      signal: AbortSignal.timeout(10_000),
    });

    const text = await response.text().catch(() => "");
    return {
      success: response.ok,
      statusCode: response.status,
      errorMessage: response.ok ? null : `SQS SendMessage failed with ${response.status}`,
      responseBody: normalizeResponseText(text || null),
    };
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      errorMessage: error instanceof Error ? error.message : "SQS request failed",
      responseBody: null,
    };
  }
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

  if (validation.connectorType === "sqs") {
    const sqsConfig = resolveSqsConfig(config);
    if (!sqsConfig) {
      return {
        success: false,
        statusCode: null,
        errorMessage: "Missing SQS configuration",
        responseBody: null,
      };
    }

    return executeSqsSendMessage(sqsConfig, input.payload);
  }

  if (validation.connectorType === "db") {
    const dbConfig = resolveDbConfig(config);
    if (!dbConfig) {
      return {
        success: false,
        statusCode: null,
        errorMessage: "Missing DB configuration",
        responseBody: null,
      };
    }

    return executeHttpPost(dbConfig.ingestUrl, toDbPayload(input.payload, dbConfig.table), {
      ...(dbConfig.apiKey ? { authorization: `Bearer ${dbConfig.apiKey}` } : {}),
      ...parseHeaders(config),
    });
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

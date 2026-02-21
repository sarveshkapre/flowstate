type Logger = Pick<Console, "info" | "warn" | "error">;

export type ConnectorRedriveConfig = {
  apiBaseUrl: string;
  connectorTypes: string[];
  projectIds: string[];
  organizationId: string | null;
  apiKey: string | null;
  actorEmail: string | null;
  pollMs: number;
  redriveLimit: number;
  minDeadLetterCount: number;
  minDeadLetterMinutes: number;
  processAfterRedrive: boolean;
};

export type ConnectorRedriveResult = {
  project_count: number;
  connector_count: number;
  redriven_count: number;
  processed_count: number;
  skipped_count: number;
  failures: string[];
};

const DEFAULT_TYPES = ["webhook", "slack", "jira", "sqs", "db"];
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_REDRIVE_LIMIT = 10;
const DEFAULT_MIN_DEAD_LETTER = 3;
const DEFAULT_MIN_DEAD_LETTER_MINUTES = 15;

function parseCsv(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function parsePositiveInt(input: string | undefined, fallback: number, max: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function parseBoolean(input: string | undefined, fallback = true) {
  if (!input) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeBaseUrl(url: string | undefined) {
  const fallback = "http://localhost:3000";
  const trimmed = url?.trim() || fallback;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function normalizeProjectIds(value: string | undefined) {
  return unique(
    parseCsv(value)
      .map((id) => id.replace(/\s+/g, ""))
      .filter(Boolean),
  );
}

async function parseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function authHeaders(config: ConnectorRedriveConfig) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  if (config.actorEmail) {
    headers["x-flowstate-actor-email"] = config.actorEmail;
  }

  return headers;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function listProjectIds(input: {
  config: ConnectorRedriveConfig;
  fetchImpl: typeof fetch;
}): Promise<string[]> {
  if (input.config.projectIds.length > 0) {
    return input.config.projectIds;
  }

  const url = new URL("/api/v2/projects", input.config.apiBaseUrl);
  if (input.config.organizationId) {
    url.searchParams.set("organizationId", input.config.organizationId);
  }

  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: authHeaders(input.config),
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
    throw new Error(`Unable to list projects (${reason})`);
  }

  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  return unique(
    projects
      .map((project) => {
        if (project && typeof project === "object" && typeof (project as { id?: unknown }).id === "string") {
          return (project as { id: string }).id;
        }
        return "";
      })
      .filter(Boolean),
  );
}

export function parseConnectorRedriveConfig(env: NodeJS.ProcessEnv = process.env): ConnectorRedriveConfig {
  const connectorTypes = unique(parseCsv(env.FLOWSTATE_CONNECTOR_REDRIVE_TYPES));

  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    connectorTypes: connectorTypes.length > 0 ? connectorTypes : DEFAULT_TYPES,
    projectIds: normalizeProjectIds(env.FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS),
    organizationId: env.FLOWSTATE_CONNECTOR_REDRIVE_ORGANIZATION_ID?.trim() || null,
    apiKey: env.FLOWSTATE_CONNECTOR_REDRIVE_API_KEY?.trim() || null,
    actorEmail: env.FLOWSTATE_CONNECTOR_REDRIVE_ACTOR_EMAIL?.trim() || null,
    pollMs: parsePositiveInt(env.FLOWSTATE_CONNECTOR_REDRIVE_POLL_MS, DEFAULT_POLL_MS, 60 * 60 * 1000),
    redriveLimit: parsePositiveInt(env.FLOWSTATE_CONNECTOR_REDRIVE_LIMIT, DEFAULT_REDRIVE_LIMIT, 100),
    minDeadLetterCount: parsePositiveInt(env.FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER, DEFAULT_MIN_DEAD_LETTER, 500),
    minDeadLetterMinutes: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER_MINUTES,
      DEFAULT_MIN_DEAD_LETTER_MINUTES,
      7 * 24 * 60,
    ),
    processAfterRedrive: parseBoolean(env.FLOWSTATE_CONNECTOR_REDRIVE_PROCESS_AFTER_REDRIVE, true),
  };
}

export async function runConnectorRedriveOnce(input: {
  config: ConnectorRedriveConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}): Promise<ConnectorRedriveResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const projectIds = await listProjectIds({
    config: input.config,
    fetchImpl,
  });
  const failures: string[] = [];
  let connectorCount = 0;
  let redrivenCount = 0;
  let processedCount = 0;
  let skipped = 0;

  for (const projectId of projectIds) {
    for (const connectorType of input.config.connectorTypes) {
      connectorCount += 1;

      const listUrl = new URL(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver`, input.config.apiBaseUrl);
      listUrl.searchParams.set("projectId", projectId);
      listUrl.searchParams.set("status", "dead_lettered");
      listUrl.searchParams.set("limit", "1");

      const listResponse = await fetchImpl(listUrl, {
        method: "GET",
        headers: authHeaders(input.config),
      });
      const listPayload = await parseJson(listResponse);

      if (!listResponse.ok) {
        const reason = typeof listPayload.error === "string" ? listPayload.error : `status ${listResponse.status}`;
        failures.push(`${projectId}/${connectorType}: failed to inspect dead-letter queue (${reason})`);
        continue;
      }

      const summary =
        listPayload.summary && typeof listPayload.summary === "object"
          ? (listPayload.summary as Record<string, unknown>)
          : {};
      const deadLettered = asNumber(summary.dead_lettered);

      if (deadLettered < input.config.minDeadLetterCount) {
        skipped += 1;
        continue;
      }

      const redriveUrl = new URL(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver`, input.config.apiBaseUrl);
      redriveUrl.searchParams.set("action", "redrive_batch");
      const redriveResponse = await fetchImpl(redriveUrl, {
        method: "PATCH",
        headers: authHeaders(input.config),
        body: JSON.stringify({
          projectId,
          limit: input.config.redriveLimit,
          minDeadLetterMinutes: input.config.minDeadLetterMinutes,
        }),
      });
      const redrivePayload = await parseJson(redriveResponse);

      if (!redriveResponse.ok) {
        const reason = typeof redrivePayload.error === "string" ? redrivePayload.error : `status ${redriveResponse.status}`;
        failures.push(`${projectId}/${connectorType}: failed to redrive batch (${reason})`);
        continue;
      }

      const redriven = asNumber(redrivePayload.redriven_count);
      redrivenCount += redriven;

      if (redriven <= 0) {
        skipped += 1;
        continue;
      }

      if (!input.config.processAfterRedrive) {
        logger.info(`[connector-redrive] redriven ${redriven} delivery(s) for ${projectId}/${connectorType}`);
        continue;
      }

      const processUrl = new URL(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver`, input.config.apiBaseUrl);
      processUrl.searchParams.set("action", "process");
      const processResponse = await fetchImpl(processUrl, {
        method: "PATCH",
        headers: authHeaders(input.config),
        body: JSON.stringify({
          projectId,
          limit: redriven,
        }),
      });
      const processPayload = await parseJson(processResponse);

      if (!processResponse.ok) {
        const reason = typeof processPayload.error === "string" ? processPayload.error : `status ${processResponse.status}`;
        failures.push(`${projectId}/${connectorType}: redriven but failed processing (${reason})`);
        continue;
      }

      const processed = asNumber(processPayload.processed_count);
      processedCount += processed;
      logger.info(`[connector-redrive] redriven=${redriven} processed=${processed} for ${projectId}/${connectorType}`);
    }
  }

  return {
    project_count: projectIds.length,
    connector_count: connectorCount,
    redriven_count: redrivenCount,
    processed_count: processedCount,
    skipped_count: skipped,
    failures,
  };
}

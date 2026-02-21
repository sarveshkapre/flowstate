type Logger = Pick<Console, "info" | "warn" | "error">;

export type ConnectorPumpConfig = {
  apiBaseUrl: string;
  connectorTypes: string[];
  limit: number;
  backpressureEnabled: boolean;
  backpressureMaxRetrying: number;
  backpressureMaxDueNow: number;
  backpressureMinLimit: number;
  pollMs: number;
  projectIds: string[];
  organizationId: string | null;
  apiKey: string | null;
  actorEmail: string | null;
};

export type ConnectorPumpResult = {
  project_count: number;
  connector_count: number;
  processed_count: number;
  failures: string[];
};

const DEFAULT_TYPES = ["webhook", "slack", "jira", "sqs", "db"];
const SUPPORTED_CONNECTOR_TYPES = new Set(DEFAULT_TYPES);
const DEFAULT_LIMIT = 25;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_BACKPRESSURE_MAX_RETRYING = 50;
const DEFAULT_BACKPRESSURE_MAX_DUE_NOW = 100;
const DEFAULT_BACKPRESSURE_MIN_LIMIT = 1;

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

function normalizeProjectIds(value: string | undefined) {
  return unique(parseCsv(value).map((id) => id.replace(/\s+/g, "")));
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

function parsePositiveInt(input: string | undefined, fallback: number, max: number) {
  const parsed = Number(input);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

async function parseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function authHeaders(config: ConnectorPumpConfig) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  if (config.actorEmail) {
    headers["x-flowstate-actor-email"] = config.actorEmail;
  }

  return headers;
}

function normalizeBaseUrl(url: string | undefined) {
  const fallback = "http://localhost:3000";
  const trimmed = url?.trim() || fallback;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function parseConnectorPumpConfig(env: NodeJS.ProcessEnv = process.env): ConnectorPumpConfig {
  const connectorTypes = unique(parseCsv(env.FLOWSTATE_CONNECTOR_PUMP_TYPES)).filter((type) =>
    SUPPORTED_CONNECTOR_TYPES.has(type),
  );

  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    connectorTypes: connectorTypes.length > 0 ? connectorTypes : DEFAULT_TYPES,
    limit: parsePositiveInt(env.FLOWSTATE_CONNECTOR_PUMP_LIMIT, DEFAULT_LIMIT, 100),
    backpressureEnabled: parseBoolean(env.FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_ENABLED, true),
    backpressureMaxRetrying: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MAX_RETRYING,
      DEFAULT_BACKPRESSURE_MAX_RETRYING,
      10_000,
    ),
    backpressureMaxDueNow: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MAX_DUE_NOW,
      DEFAULT_BACKPRESSURE_MAX_DUE_NOW,
      10_000,
    ),
    backpressureMinLimit: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MIN_LIMIT,
      DEFAULT_BACKPRESSURE_MIN_LIMIT,
      100,
    ),
    pollMs: parsePositiveInt(env.FLOWSTATE_CONNECTOR_PUMP_POLL_MS, DEFAULT_POLL_MS, 300_000),
    projectIds: normalizeProjectIds(env.FLOWSTATE_CONNECTOR_PUMP_PROJECT_IDS),
    organizationId: env.FLOWSTATE_CONNECTOR_PUMP_ORGANIZATION_ID?.trim() || null,
    apiKey: env.FLOWSTATE_CONNECTOR_PUMP_API_KEY?.trim() || null,
    actorEmail: env.FLOWSTATE_CONNECTOR_PUMP_ACTOR_EMAIL?.trim() || null,
  };
}

async function listProjectIds(input: {
  config: ConnectorPumpConfig;
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
    const message = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
    throw new Error(`Unable to list projects (${message})`);
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

export async function pumpConnectorQueuesOnce(input: {
  config: ConnectorPumpConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}): Promise<ConnectorPumpResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const projectIds = await listProjectIds({ config: input.config, fetchImpl });
  const failures: string[] = [];
  let processedCount = 0;
  let connectorCount = 0;

  if (projectIds.length === 0) {
    logger.warn("[connector-pump] no projects available, skipping tick");
    return {
      project_count: 0,
      connector_count: 0,
      processed_count: 0,
      failures,
    };
  }

  for (const projectId of projectIds) {
    connectorCount += input.config.connectorTypes.length;

    const url = new URL("/api/v2/connectors/process", input.config.apiBaseUrl);

    const response = await fetchImpl(url, {
      method: "POST",
      headers: authHeaders(input.config),
      body: JSON.stringify({
        projectId,
        connectorTypes: input.config.connectorTypes,
        limit: input.config.limit,
        backpressure: {
          enabled: input.config.backpressureEnabled,
          maxRetrying: input.config.backpressureMaxRetrying,
          maxDueNow: input.config.backpressureMaxDueNow,
          minLimit: input.config.backpressureMinLimit,
        },
      }),
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
      failures.push(`${projectId}: ${reason}`);
      continue;
    }

    const processed = typeof payload.processed_count === "number" ? payload.processed_count : 0;
    processedCount += processed;
    if (processed > 0) {
      logger.info(
        `[connector-pump] processed ${processed} delivery(s) for ${projectId} across ${input.config.connectorTypes.length} connector types`,
      );
    }
  }

  return {
    project_count: projectIds.length,
    connector_count: connectorCount,
    processed_count: processedCount,
    failures,
  };
}

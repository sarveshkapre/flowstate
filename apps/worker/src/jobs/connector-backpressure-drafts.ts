type Logger = Pick<Console, "info" | "warn" | "error">;

export type ConnectorBackpressureDraftActivationConfig = {
  apiBaseUrl: string;
  projectIds: string[];
  organizationId: string | null;
  apiKey: string | null;
  actorEmail: string | null;
  pollMs: number;
  limit: number;
  dryRun: boolean;
};

export type ConnectorBackpressureDraftActivationResult = {
  project_count: number;
  total_draft_count: number;
  scanned_draft_count: number;
  ready_count: number;
  blocked_count: number;
  applied_count: number;
  failed_count: number;
  failures: string[];
};

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LIMIT = 100;

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
  return unique(
    parseCsv(value)
      .map((id) => id.replace(/\s+/g, ""))
      .filter(Boolean),
  );
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

async function parseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function authHeaders(config: ConnectorBackpressureDraftActivationConfig) {
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

async function listProjectIdsByOrganization(input: {
  config: ConnectorBackpressureDraftActivationConfig;
  fetchImpl: typeof fetch;
}): Promise<string[]> {
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

export function parseConnectorBackpressureDraftActivationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConnectorBackpressureDraftActivationConfig {
  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    projectIds: normalizeProjectIds(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_PROJECT_IDS),
    organizationId: env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_ORGANIZATION_ID?.trim() || null,
    apiKey: env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_API_KEY?.trim() || null,
    actorEmail:
      env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_ACTOR_EMAIL?.trim() ||
      "connector-backpressure-drafts@flowstate.dev",
    pollMs: parsePositiveInt(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_POLL_MS, DEFAULT_POLL_MS, 60 * 60 * 1000),
    limit: parsePositiveInt(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_LIMIT, DEFAULT_LIMIT, 500),
    dryRun: parseBoolean(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_DRY_RUN, false),
  };
}

export async function runConnectorBackpressureDraftActivationOnce(input: {
  config: ConnectorBackpressureDraftActivationConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}): Promise<ConnectorBackpressureDraftActivationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const failures: string[] = [];

  let scopedProjectIds = input.config.projectIds;
  if (scopedProjectIds.length === 0 && input.config.organizationId) {
    scopedProjectIds = await listProjectIdsByOrganization({
      config: input.config,
      fetchImpl,
    });

    if (scopedProjectIds.length === 0) {
      logger.warn("[connector-backpressure-drafts] no projects in organization scope, skipping tick");
      return {
        project_count: 0,
        total_draft_count: 0,
        scanned_draft_count: 0,
        ready_count: 0,
        blocked_count: 0,
        applied_count: 0,
        failed_count: 0,
        failures,
      };
    }
  }

  const url = new URL("/api/v2/connectors/backpressure/drafts/activate", input.config.apiBaseUrl);
  const requestBody: Record<string, unknown> = {
    dryRun: input.config.dryRun,
    limit: input.config.limit,
  };
  if (scopedProjectIds.length > 0) {
    requestBody.projectIds = scopedProjectIds;
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: authHeaders(input.config),
    body: JSON.stringify(requestBody),
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
    failures.push(`failed to activate connector backpressure drafts (${reason})`);
    return {
      project_count: scopedProjectIds.length,
      total_draft_count: 0,
      scanned_draft_count: 0,
      ready_count: 0,
      blocked_count: 0,
      applied_count: 0,
      failed_count: 0,
      failures,
    };
  }

  const result = {
    project_count: asNumber(payload.project_count, scopedProjectIds.length),
    total_draft_count: asNumber(payload.total_draft_count),
    scanned_draft_count: asNumber(payload.scanned_draft_count),
    ready_count: asNumber(payload.ready_count),
    blocked_count: asNumber(payload.blocked_count),
    applied_count: asNumber(payload.applied_count),
    failed_count: asNumber(payload.failed_count),
    failures,
  };

  if (result.applied_count > 0 || result.ready_count > 0) {
    logger.info(
      `[connector-backpressure-drafts] scanned=${result.scanned_draft_count} ready=${result.ready_count} applied=${result.applied_count} blocked=${result.blocked_count} failed=${result.failed_count}`,
    );
  }

  return result;
}

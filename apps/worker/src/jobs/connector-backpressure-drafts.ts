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
  notifyBlockedDrafts: boolean;
  notifyConnectorType: string;
  notifyMaxProjects: number;
};

export type ConnectorBackpressureDraftActivationResult = {
  project_count: number;
  total_draft_count: number;
  scanned_draft_count: number;
  ready_count: number;
  blocked_count: number;
  applied_count: number;
  failed_count: number;
  notification_sent_count: number;
  notification_failed_count: number;
  failures: string[];
};

type ActivationResultItem = {
  project_id: string;
  project_name?: string | null;
  status: "ready" | "blocked" | "applied" | "failed";
  reason?: string | null;
  message?: string | null;
};

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LIMIT = 100;
const DEFAULT_NOTIFY_MAX_PROJECTS = 20;
const DEFAULT_NOTIFY_CONNECTOR_TYPE = "slack";
const SUPPORTED_CONNECTOR_TYPES = new Set(["webhook", "slack", "jira", "sqs", "db"]);

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

function normalizeConnectorType(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() || DEFAULT_NOTIFY_CONNECTOR_TYPE;
  if (!SUPPORTED_CONNECTOR_TYPES.has(normalized)) {
    return DEFAULT_NOTIFY_CONNECTOR_TYPE;
  }
  return normalized;
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

function asActivationResultItems(value: unknown): ActivationResultItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: ActivationResultItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const projectId = typeof record.project_id === "string" ? record.project_id : "";
    const status = record.status;

    if (!projectId || !["ready", "blocked", "applied", "failed"].includes(String(status))) {
      continue;
    }

    const projectName =
      typeof record.project_name === "string"
        ? record.project_name
        : record.project_name === null
          ? null
          : undefined;
    const reason = typeof record.reason === "string" ? record.reason : record.reason === null ? null : undefined;
    const message = typeof record.message === "string" ? record.message : record.message === null ? null : undefined;

    items.push({
      project_id: projectId,
      project_name: projectName,
      status: status as ActivationResultItem["status"],
      reason,
      message,
    });
  }

  return items;
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

async function dispatchBlockedDraftNotifications(input: {
  config: ConnectorBackpressureDraftActivationConfig;
  fetchImpl: typeof fetch;
  logger: Logger;
  items: ActivationResultItem[];
  failures: string[];
}) {
  if (!input.config.notifyBlockedDrafts || input.items.length === 0) {
    return { sentCount: 0, failedCount: 0 };
  }

  const blockedByProject = new Map<
    string,
    {
      projectName: string | null;
      blockedCount: number;
      reasons: string[];
    }
  >();

  for (const item of input.items) {
    if (item.status !== "blocked") {
      continue;
    }

    const existing = blockedByProject.get(item.project_id);
    const reason = item.reason ?? "unknown";
    if (!existing) {
      blockedByProject.set(item.project_id, {
        projectName: item.project_name ?? null,
        blockedCount: 1,
        reasons: [reason],
      });
      continue;
    }

    existing.blockedCount += 1;
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
  }

  const payloadEntries = [...blockedByProject.entries()].slice(0, input.config.notifyMaxProjects);
  let sentCount = 0;
  let failedCount = 0;

  for (const [projectId, summary] of payloadEntries) {
    const url = new URL(`/api/v2/connectors/${encodeURIComponent(input.config.notifyConnectorType)}/deliver`, input.config.apiBaseUrl);
    const response = await input.fetchImpl(url, {
      method: "POST",
      headers: authHeaders(input.config),
      body: JSON.stringify({
        projectId,
        mode: "enqueue",
        idempotencyKey: `connector-backpressure-draft-blocked:${projectId}:${new Date().toISOString().slice(0, 13)}`,
        payload: {
          event: "connector.backpressure_draft.blocked",
          source: "connector-backpressure-drafts-worker",
          project_id: projectId,
          project_name: summary.projectName,
          blocked_draft_count: summary.blockedCount,
          blocked_reasons: summary.reasons,
          generated_at: new Date().toISOString(),
        },
      }),
    });
    const responsePayload = await parseJson(response);

    if (!response.ok) {
      const reason = typeof responsePayload.error === "string" ? responsePayload.error : `status ${response.status}`;
      input.failures.push(`${projectId}: failed to dispatch blocked draft notification (${reason})`);
      failedCount += 1;
      continue;
    }

    sentCount += 1;
    input.logger.info(
      `[connector-backpressure-drafts] notified ${projectId} of ${summary.blockedCount} blocked draft(s) via ${input.config.notifyConnectorType}`,
    );
  }

  return {
    sentCount,
    failedCount,
  };
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
    notifyBlockedDrafts: parseBoolean(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_NOTIFY_BLOCKED, false),
    notifyConnectorType: normalizeConnectorType(env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_NOTIFY_CONNECTOR_TYPE),
    notifyMaxProjects: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_NOTIFY_MAX_PROJECTS,
      DEFAULT_NOTIFY_MAX_PROJECTS,
      200,
    ),
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
        notification_sent_count: 0,
        notification_failed_count: 0,
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
      notification_sent_count: 0,
      notification_failed_count: 0,
      failures,
    };
  }

  const results = asActivationResultItems(payload.results);
  const notifications = await dispatchBlockedDraftNotifications({
    config: input.config,
    fetchImpl,
    logger,
    items: results,
    failures,
  });

  const result = {
    project_count: asNumber(payload.project_count, scopedProjectIds.length),
    total_draft_count: asNumber(payload.total_draft_count),
    scanned_draft_count: asNumber(payload.scanned_draft_count),
    ready_count: asNumber(payload.ready_count),
    blocked_count: asNumber(payload.blocked_count),
    applied_count: asNumber(payload.applied_count),
    failed_count: asNumber(payload.failed_count),
    notification_sent_count: notifications.sentCount,
    notification_failed_count: notifications.failedCount,
    failures,
  };

  if (result.applied_count > 0 || result.ready_count > 0 || result.notification_sent_count > 0) {
    logger.info(
      `[connector-backpressure-drafts] scanned=${result.scanned_draft_count} ready=${result.ready_count} applied=${result.applied_count} blocked=${result.blocked_count} failed=${result.failed_count} notifications_sent=${result.notification_sent_count}`,
    );
  }

  return result;
}

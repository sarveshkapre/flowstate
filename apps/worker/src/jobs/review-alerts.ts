type Logger = Pick<Console, "info" | "warn" | "error">;

type ReviewQueueSummary = {
  total_queues: number;
  unreviewed_queues: number;
  at_risk_queues: number;
  stale_queues: number;
  healthy_queues: number;
  total_decisions: number;
  total_evidence_regions: number;
  avg_error_rate: number;
};

type ReviewQueueItem = {
  run_id: string;
  health: "unreviewed" | "at_risk" | "stale" | "healthy";
  error_rate: number;
  non_correct_count: number;
  decisions_total: number;
};

export type ReviewAlertsConfig = {
  apiBaseUrl: string;
  connectorType: string;
  useProjectPolicies: boolean;
  pollMs: number;
  projectIds: string[];
  organizationId: string | null;
  apiKey: string | null;
  actorEmail: string | null;
  staleHours: number;
  queueLimit: number;
  minUnreviewedQueues: number;
  minAtRiskQueues: number;
  minStaleQueues: number;
  minAvgErrorRate: number;
  idempotencyWindowMinutes: number;
};

export type ReviewAlertsResult = {
  project_count: number;
  evaluated_count: number;
  alerted_count: number;
  skipped_count: number;
  failures: string[];
};

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_QUEUE_LIMIT = 50;
const DEFAULT_STALE_HOURS = 24;
const DEFAULT_MIN_UNREVIEWED = 5;
const DEFAULT_MIN_AT_RISK = 3;
const DEFAULT_MIN_STALE = 3;
const DEFAULT_MIN_AVG_ERROR_RATE = 0.35;
const DEFAULT_WINDOW_MINUTES = 30;
const DEFAULT_CONNECTOR_TYPE = "slack";
const SUPPORTED_CONNECTOR_TYPES = new Set(["webhook", "slack", "jira", "sqs", "db"]);

function parseCsv(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
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

function parseRate(input: string | undefined, fallback: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function normalizeBaseUrl(url: string | undefined) {
  const fallback = "http://localhost:3000";
  const trimmed = url?.trim() || fallback;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function authHeaders(config: ReviewAlertsConfig) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  if (config.actorEmail) {
    headers["x-flowstate-actor-email"] = config.actorEmail;
  }

  return headers;
}

async function parseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeProjectIds(value: string | undefined) {
  return unique(parseCsv(value).map((item) => item.replace(/\s+/g, "")));
}

function numeric(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function clampNonNegativeInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value < 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function clampRate(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || typeof value !== "number") {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function normalizeConnectorType(value: string | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return fallback;
  }
  return SUPPORTED_CONNECTOR_TYPES.has(normalized) ? normalized : fallback;
}

type ProjectReviewAlertPolicy = {
  isEnabled: boolean;
  connectorType: string;
  staleHours: number;
  queueLimit: number;
  minUnreviewedQueues: number;
  minAtRiskQueues: number;
  minStaleQueues: number;
  minAvgErrorRate: number;
  idempotencyWindowMinutes: number;
};

function asProjectReviewAlertPolicy(raw: unknown): ProjectReviewAlertPolicy | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  return {
    isEnabled: value.is_enabled !== false,
    connectorType: normalizeConnectorType(
      typeof value.connector_type === "string" ? value.connector_type : undefined,
      DEFAULT_CONNECTOR_TYPE,
    ),
    staleHours: clampPositiveInt(asFiniteNumber(value.stale_hours), DEFAULT_STALE_HOURS, 24 * 30),
    queueLimit: clampPositiveInt(asFiniteNumber(value.queue_limit), DEFAULT_QUEUE_LIMIT, 200),
    minUnreviewedQueues: clampNonNegativeInt(asFiniteNumber(value.min_unreviewed_queues), DEFAULT_MIN_UNREVIEWED, 500),
    minAtRiskQueues: clampNonNegativeInt(asFiniteNumber(value.min_at_risk_queues), DEFAULT_MIN_AT_RISK, 500),
    minStaleQueues: clampNonNegativeInt(asFiniteNumber(value.min_stale_queues), DEFAULT_MIN_STALE, 500),
    minAvgErrorRate: clampRate(asFiniteNumber(value.min_avg_error_rate), DEFAULT_MIN_AVG_ERROR_RATE),
    idempotencyWindowMinutes: clampPositiveInt(
      asFiniteNumber(value.idempotency_window_minutes),
      DEFAULT_WINDOW_MINUTES,
      24 * 60,
    ),
  };
}

function resolveProjectConfig(input: {
  config: ReviewAlertsConfig;
  policy: ProjectReviewAlertPolicy | null;
}): ProjectReviewAlertPolicy {
  if (!input.policy) {
    return {
      isEnabled: true,
      connectorType: input.config.connectorType,
      staleHours: input.config.staleHours,
      queueLimit: input.config.queueLimit,
      minUnreviewedQueues: input.config.minUnreviewedQueues,
      minAtRiskQueues: input.config.minAtRiskQueues,
      minStaleQueues: input.config.minStaleQueues,
      minAvgErrorRate: input.config.minAvgErrorRate,
      idempotencyWindowMinutes: input.config.idempotencyWindowMinutes,
    };
  }

  return input.policy;
}

function asReviewSummary(raw: unknown): ReviewQueueSummary {
  if (!raw || typeof raw !== "object") {
    return {
      total_queues: 0,
      unreviewed_queues: 0,
      at_risk_queues: 0,
      stale_queues: 0,
      healthy_queues: 0,
      total_decisions: 0,
      total_evidence_regions: 0,
      avg_error_rate: 0,
    };
  }

  const value = raw as Record<string, unknown>;
  return {
    total_queues: numeric(value.total_queues),
    unreviewed_queues: numeric(value.unreviewed_queues),
    at_risk_queues: numeric(value.at_risk_queues),
    stale_queues: numeric(value.stale_queues),
    healthy_queues: numeric(value.healthy_queues),
    total_decisions: numeric(value.total_decisions),
    total_evidence_regions: numeric(value.total_evidence_regions),
    avg_error_rate: parseRate(String(numeric(value.avg_error_rate)), 0),
  };
}

function asReviewQueues(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as ReviewQueueItem[];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const value = item as Record<string, unknown>;
      const runId = typeof value.run_id === "string" ? value.run_id : "";
      const health = value.health;
      if (!runId || !["unreviewed", "at_risk", "stale", "healthy"].includes(String(health))) {
        return null;
      }

      return {
        run_id: runId,
        health: health as ReviewQueueItem["health"],
        error_rate: numeric(value.error_rate),
        non_correct_count: numeric(value.non_correct_count),
        decisions_total: numeric(value.decisions_total),
      } satisfies ReviewQueueItem;
    })
    .filter((item): item is ReviewQueueItem => item !== null);
}

export function parseReviewAlertsConfig(env: NodeJS.ProcessEnv = process.env): ReviewAlertsConfig {
  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    connectorType: normalizeConnectorType(env.FLOWSTATE_REVIEW_ALERTS_CONNECTOR_TYPE, DEFAULT_CONNECTOR_TYPE),
    useProjectPolicies: parseBoolean(env.FLOWSTATE_REVIEW_ALERTS_USE_PROJECT_POLICIES, true),
    pollMs: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_POLL_MS, DEFAULT_POLL_MS, 60 * 60 * 1000),
    projectIds: normalizeProjectIds(env.FLOWSTATE_REVIEW_ALERTS_PROJECT_IDS),
    organizationId: env.FLOWSTATE_REVIEW_ALERTS_ORGANIZATION_ID?.trim() || null,
    apiKey: env.FLOWSTATE_REVIEW_ALERTS_API_KEY?.trim() || null,
    actorEmail: env.FLOWSTATE_REVIEW_ALERTS_ACTOR_EMAIL?.trim() || null,
    staleHours: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_STALE_HOURS, DEFAULT_STALE_HOURS, 24 * 30),
    queueLimit: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT, 200),
    minUnreviewedQueues: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_MIN_UNREVIEWED, DEFAULT_MIN_UNREVIEWED, 200),
    minAtRiskQueues: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_MIN_AT_RISK, DEFAULT_MIN_AT_RISK, 200),
    minStaleQueues: parsePositiveInt(env.FLOWSTATE_REVIEW_ALERTS_MIN_STALE, DEFAULT_MIN_STALE, 200),
    minAvgErrorRate: parseRate(env.FLOWSTATE_REVIEW_ALERTS_MIN_AVG_ERROR_RATE, DEFAULT_MIN_AVG_ERROR_RATE),
    idempotencyWindowMinutes: parsePositiveInt(
      env.FLOWSTATE_REVIEW_ALERTS_IDEMPOTENCY_WINDOW_MINUTES,
      DEFAULT_WINDOW_MINUTES,
      24 * 60,
    ),
  };
}

export function shouldDispatchReviewAlert(input: {
  summary: ReviewQueueSummary;
  minUnreviewedQueues: number;
  minAtRiskQueues: number;
  minStaleQueues: number;
  minAvgErrorRate: number;
}) {
  return (
    input.summary.unreviewed_queues >= input.minUnreviewedQueues ||
    input.summary.at_risk_queues >= input.minAtRiskQueues ||
    input.summary.stale_queues >= input.minStaleQueues ||
    input.summary.avg_error_rate >= input.minAvgErrorRate
  );
}

async function fetchProjectPolicy(input: {
  config: ReviewAlertsConfig;
  projectId: string;
  fetchImpl: typeof fetch;
}): Promise<{ policy: ProjectReviewAlertPolicy | null; warning: string | null }> {
  if (!input.config.useProjectPolicies) {
    return { policy: null, warning: null };
  }

  const url = new URL(`/api/v2/projects/${encodeURIComponent(input.projectId)}/review-alert-policy`, input.config.apiBaseUrl);
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: authHeaders(input.config),
  });
  const payload = await parseJson(response);

  if (response.status === 401 || response.status === 403) {
    return { policy: null, warning: "policy lookup denied by auth, using environment defaults" };
  }

  if (!response.ok) {
    const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
    return { policy: null, warning: `policy lookup failed (${reason}), using environment defaults` };
  }

  return {
    policy: asProjectReviewAlertPolicy(payload.policy),
    warning: null,
  };
}

export function buildReviewAlertIdempotencyKey(input: {
  projectId: string;
  connectorType: string;
  summary: ReviewQueueSummary;
  nowMs: number;
  windowMinutes: number;
}) {
  const windowMs = Math.max(1, input.windowMinutes) * 60_000;
  const bucket = Math.floor(input.nowMs / windowMs);
  return [
    "review-alert",
    input.projectId,
    input.connectorType,
    bucket,
    input.summary.unreviewed_queues,
    input.summary.at_risk_queues,
    input.summary.stale_queues,
    Math.round(input.summary.avg_error_rate * 1000),
  ].join(":");
}

async function listProjectIds(input: {
  config: ReviewAlertsConfig;
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

export async function dispatchReviewAlertsOnce(input: {
  config: ReviewAlertsConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  nowMs?: number;
}): Promise<ReviewAlertsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const nowMs = input.nowMs ?? Date.now();
  const projectIds = await listProjectIds({
    config: input.config,
    fetchImpl,
  });
  const failures: string[] = [];
  let evaluated = 0;
  let alerted = 0;
  let skipped = 0;

  for (const projectId of projectIds) {
    const { policy, warning } = await fetchProjectPolicy({
      config: input.config,
      projectId,
      fetchImpl,
    });
    if (warning) {
      logger.warn(`[review-alerts] ${projectId}: ${warning}`);
    }

    const projectConfig = resolveProjectConfig({
      config: input.config,
      policy,
    });

    if (!projectConfig.isEnabled) {
      skipped += 1;
      logger.info(`[review-alerts] ${projectId}: policy disabled, skipping`);
      continue;
    }

    const reviewUrl = new URL("/api/v2/reviews/queues", input.config.apiBaseUrl);
    reviewUrl.searchParams.set("projectId", projectId);
    reviewUrl.searchParams.set("limit", String(projectConfig.queueLimit));
    reviewUrl.searchParams.set("staleHours", String(projectConfig.staleHours));

    const reviewResponse = await fetchImpl(reviewUrl, {
      method: "GET",
      headers: authHeaders(input.config),
    });
    const reviewPayload = await parseJson(reviewResponse);

    if (!reviewResponse.ok) {
      const reason = typeof reviewPayload.error === "string" ? reviewPayload.error : `status ${reviewResponse.status}`;
      failures.push(`${projectId}: unable to fetch review queues (${reason})`);
      continue;
    }

    evaluated += 1;
    const summary = asReviewSummary(reviewPayload.summary);
    const queues = asReviewQueues(reviewPayload.queues);

    if (
      !shouldDispatchReviewAlert({
        summary,
        minUnreviewedQueues: projectConfig.minUnreviewedQueues,
        minAtRiskQueues: projectConfig.minAtRiskQueues,
        minStaleQueues: projectConfig.minStaleQueues,
        minAvgErrorRate: projectConfig.minAvgErrorRate,
      })
    ) {
      skipped += 1;
      continue;
    }

    const idempotencyKey = buildReviewAlertIdempotencyKey({
      projectId,
      connectorType: projectConfig.connectorType,
      summary,
      nowMs,
      windowMinutes: projectConfig.idempotencyWindowMinutes,
    });
    const hotQueues = queues
      .filter((queue) => queue.health !== "healthy")
      .slice(0, 5)
      .map((queue) => ({
        run_id: queue.run_id,
        health: queue.health,
        error_rate: queue.error_rate,
        non_correct_count: queue.non_correct_count,
        decisions_total: queue.decisions_total,
      }));

    const dispatchUrl = new URL(
      `/api/v2/connectors/${encodeURIComponent(projectConfig.connectorType)}/deliver`,
      input.config.apiBaseUrl,
    );
    const dispatchResponse = await fetchImpl(dispatchUrl, {
      method: "POST",
      headers: authHeaders(input.config),
      body: JSON.stringify({
        projectId,
        mode: "enqueue",
        idempotencyKey,
        payload: {
          event: "review.ops.alert",
          projectId,
          summary,
          thresholds: {
            min_unreviewed_queues: projectConfig.minUnreviewedQueues,
            min_at_risk_queues: projectConfig.minAtRiskQueues,
            min_stale_queues: projectConfig.minStaleQueues,
            min_avg_error_rate: projectConfig.minAvgErrorRate,
          },
          hot_queues: hotQueues,
          generated_at: new Date(nowMs).toISOString(),
        },
      }),
    });
    const dispatchPayload = await parseJson(dispatchResponse);

    if (!dispatchResponse.ok) {
      const reason =
        typeof dispatchPayload.error === "string" ? dispatchPayload.error : `status ${dispatchResponse.status}`;
      failures.push(`${projectId}: unable to dispatch alert (${reason})`);
      continue;
    }

    alerted += 1;
    logger.info(
      `[review-alerts] alert queued for ${projectId} (unreviewed=${summary.unreviewed_queues}, atRisk=${summary.at_risk_queues}, stale=${summary.stale_queues}, errorRate=${summary.avg_error_rate.toFixed(3)})`,
    );
  }

  return {
    project_count: projectIds.length,
    evaluated_count: evaluated,
    alerted_count: alerted,
    skipped_count: skipped,
    failures,
  };
}

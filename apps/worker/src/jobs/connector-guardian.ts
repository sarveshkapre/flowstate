type Logger = Pick<Console, "info" | "warn" | "error">;

export type ConnectorGuardianConfig = {
  apiBaseUrl: string;
  connectorTypes: string[];
  projectIds: string[];
  organizationId: string | null;
  apiKey: string | null;
  actorEmail: string | null;
  pollMs: number;
  lookbackHours: number;
  riskThreshold: number;
  maxActionsPerProject: number;
  actionLimit: number;
  cooldownMinutes: number;
  minDeadLetterMinutes: number;
  allowProcessQueue: boolean;
  allowRedriveDeadLetters: boolean;
};

export type ConnectorGuardianResult = {
  project_count: number;
  connector_count: number;
  candidate_count: number;
  actioned_count: number;
  process_actions: number;
  redrive_actions: number;
  skipped_count: number;
  failures: string[];
};

type Recommendation = "healthy" | "process_queue" | "redrive_dead_letters";

type ConnectorReliabilityItem = {
  recommendation: Recommendation;
};

const DEFAULT_TYPES = ["webhook", "slack", "jira", "sqs", "db"];
const SUPPORTED_CONNECTOR_TYPES = new Set(DEFAULT_TYPES);
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_RISK_THRESHOLD = 20;
const DEFAULT_MAX_ACTIONS_PER_PROJECT = 2;
const DEFAULT_ACTION_LIMIT = 10;
const DEFAULT_COOLDOWN_MINUTES = 10;
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

function normalizeProjectIds(value: string | undefined) {
  return unique(parseCsv(value).map((id) => id.replace(/\s+/g, "")));
}

function parsePositiveInt(input: string | undefined, fallback: number, max: number) {
  const parsed = Number(input);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function parsePositiveNumber(input: string | undefined, fallback: number, max: number) {
  const parsed = Number(input);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
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

function authHeaders(config: ConnectorGuardianConfig) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  if (config.actorEmail) {
    headers["x-flowstate-actor-email"] = config.actorEmail;
  }

  return headers;
}

function asConnectorActionResults(value: unknown): ConnectorReliabilityItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const recommendation = record.recommendation;
      if (!["healthy", "process_queue", "redrive_dead_letters"].includes(String(recommendation))) {
        return null;
      }

      return {
        recommendation: recommendation as Recommendation,
      };
    })
    .filter((item): item is ConnectorReliabilityItem => item !== null);
}

async function listProjectIds(input: {
  config: ConnectorGuardianConfig;
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

export function parseConnectorGuardianConfig(env: NodeJS.ProcessEnv = process.env): ConnectorGuardianConfig {
  const connectorTypes = unique(parseCsv(env.FLOWSTATE_CONNECTOR_GUARDIAN_TYPES)).filter((type) =>
    SUPPORTED_CONNECTOR_TYPES.has(type),
  );

  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    connectorTypes: connectorTypes.length > 0 ? connectorTypes : DEFAULT_TYPES,
    projectIds: normalizeProjectIds(env.FLOWSTATE_CONNECTOR_GUARDIAN_PROJECT_IDS),
    organizationId: env.FLOWSTATE_CONNECTOR_GUARDIAN_ORGANIZATION_ID?.trim() || null,
    apiKey: env.FLOWSTATE_CONNECTOR_GUARDIAN_API_KEY?.trim() || null,
    actorEmail: env.FLOWSTATE_CONNECTOR_GUARDIAN_ACTOR_EMAIL?.trim() || null,
    pollMs: parsePositiveInt(env.FLOWSTATE_CONNECTOR_GUARDIAN_POLL_MS, DEFAULT_POLL_MS, 60 * 60 * 1000),
    lookbackHours: parsePositiveInt(env.FLOWSTATE_CONNECTOR_GUARDIAN_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS, 24 * 30),
    riskThreshold: parsePositiveNumber(env.FLOWSTATE_CONNECTOR_GUARDIAN_RISK_THRESHOLD, DEFAULT_RISK_THRESHOLD, 500),
    maxActionsPerProject: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_GUARDIAN_MAX_ACTIONS_PER_PROJECT,
      DEFAULT_MAX_ACTIONS_PER_PROJECT,
      20,
    ),
    actionLimit: parsePositiveInt(env.FLOWSTATE_CONNECTOR_GUARDIAN_ACTION_LIMIT, DEFAULT_ACTION_LIMIT, 100),
    cooldownMinutes: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_GUARDIAN_COOLDOWN_MINUTES,
      DEFAULT_COOLDOWN_MINUTES,
      24 * 60,
    ),
    minDeadLetterMinutes: parsePositiveInt(
      env.FLOWSTATE_CONNECTOR_GUARDIAN_MIN_DEAD_LETTER_MINUTES,
      DEFAULT_MIN_DEAD_LETTER_MINUTES,
      7 * 24 * 60,
    ),
    allowProcessQueue: parseBoolean(env.FLOWSTATE_CONNECTOR_GUARDIAN_ALLOW_PROCESS_QUEUE, true),
    allowRedriveDeadLetters: parseBoolean(env.FLOWSTATE_CONNECTOR_GUARDIAN_ALLOW_REDRIVE_DEAD_LETTERS, true),
  };
}

export async function runConnectorGuardianOnce(input: {
  config: ConnectorGuardianConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}): Promise<ConnectorGuardianResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const projectIds = await listProjectIds({
    config: input.config,
    fetchImpl,
  });

  const failures: string[] = [];
  let connectorCount = 0;
  let candidateCount = 0;
  let actionedCount = 0;
  let processActions = 0;
  let redriveActions = 0;
  let skipped = 0;

  for (const projectId of projectIds) {
    connectorCount += input.config.connectorTypes.length;

    const runUrl = new URL("/api/v2/connectors/recommendations/run", input.config.apiBaseUrl);
    const runResponse = await fetchImpl(runUrl, {
      method: "POST",
      headers: authHeaders(input.config),
      body: JSON.stringify({
        projectId,
        connectorTypes: input.config.connectorTypes,
        lookbackHours: input.config.lookbackHours,
        limit: input.config.actionLimit,
        minDeadLetterMinutes: input.config.minDeadLetterMinutes,
        riskThreshold: input.config.riskThreshold,
        maxActions: input.config.maxActionsPerProject,
        cooldownMinutes: input.config.cooldownMinutes,
        allowProcessQueue: input.config.allowProcessQueue,
        allowRedriveDeadLetters: input.config.allowRedriveDeadLetters,
      }),
    });
    const runPayload = await parseJson(runResponse);

    if (!runResponse.ok) {
      const reason = typeof runPayload.error === "string" ? runPayload.error : `status ${runResponse.status}`;
      failures.push(`${projectId}: failed to run connector recommendations (${reason})`);
      continue;
    }

    const selected = Array.isArray(runPayload.selected_actions) ? runPayload.selected_actions : [];
    const actionResults = asConnectorActionResults(runPayload.action_results);
    candidateCount += selected.length;

    if (actionResults.length === 0) {
      skipped += 1;
      continue;
    }

    for (const action of actionResults) {
      actionedCount += 1;
      if (action.recommendation === "process_queue") {
        processActions += 1;
      } else if (action.recommendation === "redrive_dead_letters") {
        redriveActions += 1;
      }
    }
    logger.info(`[connector-guardian] actioned ${actionResults.length} recommendation(s) for ${projectId}`);
  }

  return {
    project_count: projectIds.length,
    connector_count: connectorCount,
    candidate_count: candidateCount,
    actioned_count: actionedCount,
    process_actions: processActions,
    redrive_actions: redriveActions,
    skipped_count: skipped,
    failures,
  };
}

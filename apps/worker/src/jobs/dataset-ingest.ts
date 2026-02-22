type Logger = Pick<Console, "info" | "warn" | "error">;

type JsonRecord = Record<string, unknown>;

export type DatasetIngestConfig = {
  apiBaseUrl: string;
  projectIds: string[];
  organizationId: string | null;
  datasetIds: string[];
  batchIds: string[];
  pollMs: number;
  maxVideoFrames: number;
  force: boolean;
  apiKey: string | null;
  actorEmail: string | null;
};

export type DatasetIngestResult = {
  project_count: number;
  dataset_count: number;
  candidate_batch_count: number;
  ingested_batch_count: number;
  skipped_batch_count: number;
  created_asset_count: number;
  failures: string[];
};

const DEFAULT_POLL_MS = 30_000;
const DEFAULT_MAX_VIDEO_FRAMES = 10;

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

function parseBoolean(input: string | undefined, fallback = false) {
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

function normalizeBaseUrl(url: string | undefined) {
  const fallback = "http://localhost:3000";
  const trimmed = url?.trim() || fallback;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function parseJson(response: Response): Promise<JsonRecord> {
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    return {};
  }
}

function authHeaders(config: DatasetIngestConfig) {
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  if (config.actorEmail) {
    headers["x-flowstate-actor-email"] = config.actorEmail;
  }

  return headers;
}

export function parseDatasetIngestConfig(env: NodeJS.ProcessEnv = process.env): DatasetIngestConfig {
  return {
    apiBaseUrl: normalizeBaseUrl(env.FLOWSTATE_LOCAL_API_BASE),
    projectIds: unique(parseCsv(env.FLOWSTATE_DATASET_INGEST_PROJECT_IDS)),
    organizationId: env.FLOWSTATE_DATASET_INGEST_ORGANIZATION_ID?.trim() || null,
    datasetIds: unique(parseCsv(env.FLOWSTATE_DATASET_INGEST_DATASET_IDS)),
    batchIds: unique(parseCsv(env.FLOWSTATE_DATASET_INGEST_BATCH_IDS)),
    pollMs: parsePositiveInt(env.FLOWSTATE_DATASET_INGEST_POLL_MS, DEFAULT_POLL_MS, 300_000),
    maxVideoFrames: parsePositiveInt(env.FLOWSTATE_DATASET_INGEST_MAX_VIDEO_FRAMES, DEFAULT_MAX_VIDEO_FRAMES, 120),
    force: parseBoolean(env.FLOWSTATE_DATASET_INGEST_FORCE, false),
    apiKey: env.FLOWSTATE_DATASET_INGEST_API_KEY?.trim() || null,
    actorEmail: env.FLOWSTATE_DATASET_INGEST_ACTOR_EMAIL?.trim() || null,
  };
}

async function listProjectIds(input: {
  config: DatasetIngestConfig;
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

async function listDatasetIds(input: {
  config: DatasetIngestConfig;
  fetchImpl: typeof fetch;
  projectIds: string[];
  failures: string[];
}): Promise<string[]> {
  if (input.config.datasetIds.length > 0) {
    return input.config.datasetIds;
  }

  const datasetIds: string[] = [];
  for (const projectId of input.projectIds) {
    const url = new URL("/api/v2/datasets", input.config.apiBaseUrl);
    url.searchParams.set("projectId", projectId);

    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: authHeaders(input.config),
    });
    const payload = await parseJson(response);

    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
      input.failures.push(`project ${projectId}: unable to list datasets (${reason})`);
      continue;
    }

    const datasets = Array.isArray(payload.datasets) ? payload.datasets : [];
    for (const dataset of datasets) {
      if (dataset && typeof dataset === "object" && typeof (dataset as { id?: unknown }).id === "string") {
        datasetIds.push((dataset as { id: string }).id);
      }
    }
  }

  return unique(datasetIds);
}

async function listCandidateBatchIds(input: {
  config: DatasetIngestConfig;
  fetchImpl: typeof fetch;
  datasetIds: string[];
  failures: string[];
}): Promise<string[]> {
  if (input.config.batchIds.length > 0) {
    return input.config.batchIds;
  }

  const batchIds: string[] = [];
  for (const datasetId of input.datasetIds) {
    const url = new URL(`/api/v2/datasets/${datasetId}/batches`, input.config.apiBaseUrl);
    url.searchParams.set("status", "uploaded");
    url.searchParams.set("limit", "500");

    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: authHeaders(input.config),
    });
    const payload = await parseJson(response);

    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
      input.failures.push(`dataset ${datasetId}: unable to list batches (${reason})`);
      continue;
    }

    const batches = Array.isArray(payload.batches) ? payload.batches : [];
    for (const batch of batches) {
      if (batch && typeof batch === "object" && typeof (batch as { id?: unknown }).id === "string") {
        batchIds.push((batch as { id: string }).id);
      }
    }
  }

  return unique(batchIds);
}

export async function runDatasetBatchIngestOnce(input: {
  config: DatasetIngestConfig;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}): Promise<DatasetIngestResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const logger = input.logger ?? console;
  const failures: string[] = [];
  const hasExplicitBatchScope = input.config.batchIds.length > 0;
  const hasExplicitDatasetScope = input.config.datasetIds.length > 0;

  let projectIds: string[] = [];
  if (!hasExplicitBatchScope && !hasExplicitDatasetScope) {
    try {
      projectIds = await listProjectIds({ config: input.config, fetchImpl });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      failures.push(reason);
    }
  }

  const datasetIds = hasExplicitBatchScope
    ? hasExplicitDatasetScope
      ? input.config.datasetIds
      : []
    : await listDatasetIds({
        config: input.config,
        fetchImpl,
        projectIds,
        failures,
      });
  const batchIds = await listCandidateBatchIds({
    config: input.config,
    fetchImpl,
    datasetIds,
    failures,
  });

  let ingestedBatchCount = 0;
  let skippedBatchCount = 0;
  let createdAssetCount = 0;

  for (const batchId of batchIds) {
    const url = new URL(`/api/v2/batches/${batchId}/ingest`, input.config.apiBaseUrl);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: authHeaders(input.config),
      body: JSON.stringify({
        force: input.config.force,
        maxVideoFrames: input.config.maxVideoFrames,
      }),
    });
    const payload = await parseJson(response);

    if (response.status === 409) {
      skippedBatchCount += 1;
      continue;
    }

    if (!response.ok) {
      const reason = typeof payload.error === "string" ? payload.error : `status ${response.status}`;
      failures.push(`batch ${batchId}: ingest failed (${reason})`);
      continue;
    }

    const result = payload.result && typeof payload.result === "object" ? (payload.result as JsonRecord) : {};
    const created = typeof result.created_assets_count === "number" ? result.created_assets_count : 0;
    ingestedBatchCount += 1;
    createdAssetCount += created;
  }

  if (ingestedBatchCount > 0) {
    logger.info(`[dataset-ingest] ingested ${ingestedBatchCount} batch(es), created ${createdAssetCount} assets`);
  }

  return {
    project_count: projectIds.length,
    dataset_count: datasetIds.length,
    candidate_batch_count: batchIds.length,
    ingested_batch_count: ingestedBatchCount,
    skipped_batch_count: skippedBatchCount,
    created_asset_count: createdAssetCount,
    failures,
  };
}

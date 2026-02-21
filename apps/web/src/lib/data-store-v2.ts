import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  apiKeyRecordSchema,
  type ApiKeyRecord,
  datasetRecordSchema,
  type DatasetRecord,
  datasetVersionRecordSchema,
  type DatasetVersionRecord,
  connectorDeliveryAttemptRecordSchema,
  type ConnectorDeliveryAttemptRecord,
  connectorDeliveryRecordSchema,
  type ConnectorDeliveryRecord,
  edgeAgentEventRecordSchema,
  type EdgeAgentEventRecord,
  edgeAgentRecordSchema,
  type EdgeAgentRecord,
  edgeAgentConfigRecordSchema,
  type EdgeAgentConfigRecord,
  edgeAgentCommandRecordSchema,
  type EdgeAgentCommandRecord,
  type EdgeAgentCommandStatus,
  evidenceRegionRecordSchema,
  type EvidenceRegionRecord,
  evalPackRecordSchema,
  type EvalPackRecord,
  flowDeploymentRecordSchema,
  type FlowDeploymentRecord,
  flowGraphSchema,
  flowRecordV2Schema,
  type FlowRecordV2,
  flowVersionRecordSchema,
  type FlowVersionRecord,
  magicLinkRecordSchema,
  type MagicLinkRecord,
  projectMembershipRecordSchema,
  type ProjectMembershipRecord,
  projectRecordSchema,
  type ProjectRecord,
  type ProjectMemberRole,
  reviewDecisionRecordSchema,
  type ReviewDecisionRecord,
  runRecordV2Schema,
  type RunRecordV2,
  runTraceRecordSchema,
  type RunTraceRecord,
  syncCheckpointRecordSchema,
  type SyncCheckpointRecord,
  type ApiKeyScope,
  type FailureReasonCode,
  type ReviewDecisionValue,
  type AuditEventRecord,
  auditEventRecordSchema,
  type AuditEventType,
} from "@flowstate/types";

import { getOrganization } from "@/lib/data-store";

type DbStateV2 = {
  projects: ProjectRecord[];
  project_memberships: ProjectMembershipRecord[];
  api_keys: ApiKeyRecord[];
  magic_links: MagicLinkRecord[];
  flows: FlowRecordV2[];
  flow_versions: FlowVersionRecord[];
  flow_deployments: FlowDeploymentRecord[];
  runs: RunRecordV2[];
  run_traces: RunTraceRecord[];
  datasets: DatasetRecord[];
  dataset_versions: DatasetVersionRecord[];
  review_decisions: ReviewDecisionRecord[];
  evidence_regions: EvidenceRegionRecord[];
  eval_packs: EvalPackRecord[];
  connector_deliveries: ConnectorDeliveryRecord[];
  connector_delivery_attempts: ConnectorDeliveryAttemptRecord[];
  edge_agents: EdgeAgentRecord[];
  edge_agent_events: EdgeAgentEventRecord[];
  edge_agent_configs: EdgeAgentConfigRecord[];
  edge_agent_commands: EdgeAgentCommandRecord[];
  sync_checkpoints: SyncCheckpointRecord[];
  audit_events: AuditEventRecord[];
};

const DEFAULT_STATE: DbStateV2 = {
  projects: [],
  project_memberships: [],
  api_keys: [],
  magic_links: [],
  flows: [],
  flow_versions: [],
  flow_deployments: [],
  runs: [],
  run_traces: [],
  datasets: [],
  dataset_versions: [],
  review_decisions: [],
  evidence_regions: [],
  eval_packs: [],
  connector_deliveries: [],
  connector_delivery_attempts: [],
  edge_agents: [],
  edge_agent_events: [],
  edge_agent_configs: [],
  edge_agent_commands: [],
  sync_checkpoints: [],
  audit_events: [],
};

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const DATA_DIR = process.env.FLOWSTATE_DATA_DIR
  ? path.resolve(process.env.FLOWSTATE_DATA_DIR)
  : path.join(WORKSPACE_ROOT, ".flowstate-data");
const DB_FILE = path.join(DATA_DIR, "db.v2.json");
const DATASETS_DIR = path.join(DATA_DIR, "datasets-v2");
const EDGE_HEARTBEAT_STALE_MS = Number(process.env.FLOWSTATE_EDGE_HEARTBEAT_STALE_MS || 60_000);
const EDGE_COMMAND_LEASE_MS = Number(process.env.FLOWSTATE_EDGE_COMMAND_LEASE_MS || 30_000);
const DB_READ_CACHE_MS = Number(process.env.FLOWSTATE_DB_READ_CACHE_MS || 250);

let writeChain = Promise.resolve();
let readCache: { state: DbStateV2; expires_at_ms: number } | null = null;

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPayload(payload: unknown): string {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(text).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function connectorSimulationFromPayload(payload: unknown) {
  const record = asRecord(payload);
  const failureCountValue = record.__simulateFailureCount;
  const alwaysFailValue = record.__simulateAlwaysFail;
  const statusCodeValue = record.__simulateStatusCode;
  const errorValue = record.__simulateErrorMessage;

  return {
    failureCount:
      typeof failureCountValue === "number" && Number.isFinite(failureCountValue) && failureCountValue > 0
        ? Math.floor(failureCountValue)
        : 0,
    alwaysFail: alwaysFailValue === true,
    statusCode:
      typeof statusCodeValue === "number" && Number.isFinite(statusCodeValue) && statusCodeValue >= 100
        ? Math.floor(statusCodeValue)
        : 503,
    errorMessage: typeof errorValue === "string" && errorValue.trim().length > 0 ? errorValue.trim() : "Connector delivery failed",
  };
}

function withDerivedAgentStatus(agent: EdgeAgentRecord, nowMs = Date.now()): EdgeAgentRecord {
  const heartbeatMs = agent.last_heartbeat_at ? Date.parse(agent.last_heartbeat_at) : null;
  const stale = heartbeatMs === null || nowMs - heartbeatMs > EDGE_HEARTBEAT_STALE_MS;

  return edgeAgentRecordSchema.parse({
    ...agent,
    status: stale ? "offline" : "online",
  });
}

async function ensureInfrastructure() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(DATASETS_DIR, { recursive: true });

  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2), "utf8");
  }
}

async function readState(): Promise<DbStateV2> {
  const nowMs = Date.now();

  if (readCache && readCache.expires_at_ms > nowMs) {
    return structuredClone(readCache.state);
  }

  await ensureInfrastructure();
  const raw = await fs.readFile(DB_FILE, "utf8");
  const parsed = JSON.parse(raw) as Partial<DbStateV2>;
  const state = {
    projects: (parsed.projects ?? []).map((item) => projectRecordSchema.parse(item)),
    project_memberships: (parsed.project_memberships ?? []).map((item) => projectMembershipRecordSchema.parse(item)),
    api_keys: (parsed.api_keys ?? []).map((item) => apiKeyRecordSchema.parse(item)),
    magic_links: (parsed.magic_links ?? []).map((item) => magicLinkRecordSchema.parse(item)),
    flows: (parsed.flows ?? []).map((item) => flowRecordV2Schema.parse(item)),
    flow_versions: (parsed.flow_versions ?? []).map((item) => flowVersionRecordSchema.parse(item)),
    flow_deployments: (parsed.flow_deployments ?? []).map((item) => flowDeploymentRecordSchema.parse(item)),
    runs: (parsed.runs ?? []).map((item) => runRecordV2Schema.parse(item)),
    run_traces: (parsed.run_traces ?? []).map((item) => runTraceRecordSchema.parse(item)),
    datasets: (parsed.datasets ?? []).map((item) => datasetRecordSchema.parse(item)),
    dataset_versions: (parsed.dataset_versions ?? []).map((item) => datasetVersionRecordSchema.parse(item)),
    review_decisions: (parsed.review_decisions ?? []).map((item) => reviewDecisionRecordSchema.parse(item)),
    evidence_regions: (parsed.evidence_regions ?? []).map((item) => evidenceRegionRecordSchema.parse(item)),
    eval_packs: (parsed.eval_packs ?? []).map((item) => evalPackRecordSchema.parse(item)),
    connector_deliveries: (parsed.connector_deliveries ?? []).map((item) => connectorDeliveryRecordSchema.parse(item)),
    connector_delivery_attempts: (parsed.connector_delivery_attempts ?? []).map((item) =>
      connectorDeliveryAttemptRecordSchema.parse(item),
    ),
    edge_agents: (parsed.edge_agents ?? []).map((item) => edgeAgentRecordSchema.parse(item)),
    edge_agent_events: (parsed.edge_agent_events ?? []).map((item) => edgeAgentEventRecordSchema.parse(item)),
    edge_agent_configs: (parsed.edge_agent_configs ?? []).map((item) => edgeAgentConfigRecordSchema.parse(item)),
    edge_agent_commands: (parsed.edge_agent_commands ?? []).map((item) => edgeAgentCommandRecordSchema.parse(item)),
    sync_checkpoints: (parsed.sync_checkpoints ?? []).map((item) => syncCheckpointRecordSchema.parse(item)),
    audit_events: (parsed.audit_events ?? []).map((item) => auditEventRecordSchema.parse(item)),
  };

  readCache = {
    state: structuredClone(state),
    expires_at_ms: nowMs + Math.max(0, DB_READ_CACHE_MS),
  };

  return state;
}

async function writeState(state: DbStateV2) {
  const tmpPath = `${DB_FILE}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmpPath, DB_FILE);
}

async function withWriteLock<T>(fn: (state: DbStateV2) => Promise<T> | T): Promise<T> {
  const resultPromise = writeChain.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await writeState(state);
    readCache = {
      state: structuredClone(state),
      expires_at_ms: Date.now() + Math.max(0, DB_READ_CACHE_MS),
    };
    return result;
  });

  writeChain = resultPromise.then(
    () => undefined,
    () => undefined,
  );

  return resultPromise;
}

function appendAuditEvent(state: DbStateV2, input: {
  eventType: AuditEventType;
  actor?: string | null;
  metadata?: unknown;
}) {
  const event = auditEventRecordSchema.parse({
    id: randomUUID(),
    job_id: null,
    event_type: input.eventType,
    actor: input.actor ?? null,
    metadata: input.metadata ?? null,
    created_at: new Date().toISOString(),
  });

  state.audit_events.unshift(event);
  return event;
}

export async function listV2AuditEvents(limit = 100) {
  const state = await readState();
  return state.audit_events.slice(0, limit);
}

export async function createProject(input: {
  organizationId: string;
  name: string;
  slug?: string;
  description?: string;
  actor?: string;
}): Promise<ProjectRecord> {
  const organization = await getOrganization(input.organizationId);

  if (!organization) {
    throw new Error("Organization not found");
  }

  return withWriteLock(async (state) => {
    const timestamp = new Date().toISOString();
    const baseSlug = normalizeSlug(input.slug?.trim() || input.name);
    const safeBaseSlug = baseSlug || `project-${randomUUID().slice(0, 8)}`;

    let slug = safeBaseSlug;
    let counter = 1;

    while (state.projects.some((project) => project.organization_id === input.organizationId && project.slug === slug)) {
      counter += 1;
      slug = `${safeBaseSlug}-${counter}`;
    }

    const project = projectRecordSchema.parse({
      id: randomUUID(),
      organization_id: input.organizationId,
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp,
    });

    state.projects.unshift(project);
    appendAuditEvent(state, {
      eventType: "project_created",
      actor: input.actor ?? "system",
      metadata: { project_id: project.id, organization_id: project.organization_id },
    });

    return project;
  });
}

export async function listProjects(filters?: {
  organizationId?: string;
  isActive?: boolean;
}) {
  const state = await readState();

  return state.projects.filter((project) => {
    if (filters?.organizationId && project.organization_id !== filters.organizationId) {
      return false;
    }

    if (typeof filters?.isActive === "boolean" && project.is_active !== filters.isActive) {
      return false;
    }

    return true;
  });
}

export async function getProject(projectId: string) {
  const state = await readState();
  return state.projects.find((project) => project.id === projectId) ?? null;
}

export async function assignProjectMember(input: {
  projectId: string;
  userEmail: string;
  role: ProjectMemberRole;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    const timestamp = new Date().toISOString();
    const normalizedEmail = input.userEmail.trim().toLowerCase();

    const existing = state.project_memberships.find(
      (membership) => membership.project_id === input.projectId && membership.user_email === normalizedEmail,
    );

    const membership = projectMembershipRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      project_id: input.projectId,
      user_email: normalizedEmail,
      role: input.role,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    });

    if (existing) {
      const index = state.project_memberships.findIndex((membershipItem) => membershipItem.id === existing.id);
      state.project_memberships[index] = membership;
    } else {
      state.project_memberships.unshift(membership);
    }

    appendAuditEvent(state, {
      eventType: "project_member_assigned",
      actor: input.actor ?? "system",
      metadata: {
        project_id: input.projectId,
        user_email: membership.user_email,
        role: membership.role,
      },
    });

    return membership;
  });
}

export async function listProjectMembers(projectId: string) {
  const state = await readState();
  return state.project_memberships.filter((membership) => membership.project_id === projectId);
}

export async function getProjectMembership(projectId: string, userEmail: string) {
  const state = await readState();
  const normalized = userEmail.trim().toLowerCase();
  return (
    state.project_memberships.find(
      (membership) => membership.project_id === projectId && membership.user_email === normalized,
    ) ?? null
  );
}

function generateApiKeyToken() {
  return `fsk_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
}

export async function createApiKey(input: {
  organizationId: string;
  projectId?: string;
  name: string;
  role: ProjectMemberRole;
  scopes: ApiKeyScope[];
  expiresAt?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const token = generateApiKeyToken();
    const timestamp = new Date().toISOString();
    const record = apiKeyRecordSchema.parse({
      id: randomUUID(),
      organization_id: input.organizationId,
      project_id: input.projectId ?? null,
      name: input.name.trim(),
      key_prefix: token.slice(0, 14),
      key_hash: hashToken(token),
      role: input.role,
      scopes: input.scopes,
      is_active: true,
      last_used_at: null,
      expires_at: input.expiresAt ?? null,
      created_at: timestamp,
    });

    state.api_keys.unshift(record);
    appendAuditEvent(state, {
      eventType: "api_key_created",
      actor: input.actor ?? "system",
      metadata: {
        key_id: record.id,
        project_id: record.project_id,
        scopes: record.scopes,
      },
    });

    return {
      record,
      token,
    };
  });
}

export async function listApiKeys(filters?: {
  organizationId?: string;
  projectId?: string;
  activeOnly?: boolean;
}) {
  const state = await readState();

  return state.api_keys.filter((key) => {
    if (filters?.organizationId && key.organization_id !== filters.organizationId) {
      return false;
    }

    if (filters?.projectId && key.project_id !== filters.projectId) {
      return false;
    }

    if (filters?.activeOnly && !key.is_active) {
      return false;
    }

    return true;
  });
}

export async function authenticateApiKey(token: string) {
  const state = await readState();
  const hashed = hashToken(token);
  const now = Date.now();

  const key = state.api_keys.find((candidate) => {
    if (!candidate.is_active) {
      return false;
    }

    if (candidate.key_hash !== hashed) {
      return false;
    }

    if (candidate.expires_at && Date.parse(candidate.expires_at) <= now) {
      return false;
    }

    return true;
  });

  return key ?? null;
}

export async function markApiKeyUsed(apiKeyId: string, actor = "system") {
  return withWriteLock(async (state) => {
    const key = state.api_keys.find((item) => item.id === apiKeyId);

    if (!key) {
      return null;
    }

    key.last_used_at = new Date().toISOString();
    appendAuditEvent(state, {
      eventType: "api_key_used",
      actor,
      metadata: { key_id: key.id, project_id: key.project_id },
    });

    return key;
  });
}

function generateMagicLinkToken() {
  return `fsl_${randomUUID().replace(/-/g, "")}`;
}

export async function requestMagicLink(input: {
  email: string;
  actor?: string;
  ttlMinutes?: number;
}) {
  return withWriteLock(async (state) => {
    const ttlMs = (input.ttlMinutes ?? 15) * 60_000;
    const now = Date.now();
    const token = generateMagicLinkToken();

    const record = magicLinkRecordSchema.parse({
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      token_hash: hashToken(token),
      expires_at: new Date(now + ttlMs).toISOString(),
      consumed_at: null,
      created_at: new Date(now).toISOString(),
    });

    state.magic_links.unshift(record);

    appendAuditEvent(state, {
      eventType: "magic_link_requested",
      actor: input.actor ?? record.email,
      metadata: { email: record.email, expires_at: record.expires_at },
    });

    return {
      record,
      token,
    };
  });
}

export async function verifyMagicLinkToken(token: string) {
  return withWriteLock(async (state) => {
    const hashed = hashToken(token);
    const now = Date.now();

    const record = state.magic_links.find((item) => item.token_hash === hashed && item.consumed_at === null);

    if (!record) {
      return null;
    }

    if (Date.parse(record.expires_at) <= now) {
      return null;
    }

    record.consumed_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "magic_link_verified",
      actor: record.email,
      metadata: { email: record.email },
    });

    return record;
  });
}

export async function createFlowV2(input: {
  projectId: string;
  name: string;
  description?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    const timestamp = new Date().toISOString();
    const flow = flowRecordV2Schema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_active: true,
      current_version_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    state.flows.unshift(flow);

    appendAuditEvent(state, {
      eventType: "flow_created_v2",
      actor: input.actor ?? "system",
      metadata: { flow_id: flow.id, project_id: flow.project_id },
    });

    return flow;
  });
}

export async function listFlowsV2(projectId: string) {
  const state = await readState();
  return state.flows.filter((flow) => flow.project_id === projectId);
}

export async function getFlowV2(flowId: string) {
  const state = await readState();
  return state.flows.find((flow) => flow.id === flowId) ?? null;
}

export async function createFlowVersion(input: {
  flowId: string;
  graph: unknown;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const flow = state.flows.find((item) => item.id === input.flowId);

    if (!flow) {
      throw new Error("Flow not found");
    }

    const currentMaxVersion = state.flow_versions
      .filter((version) => version.flow_id === flow.id)
      .reduce((max, version) => Math.max(max, version.version_number), 0);

    const graph = flowGraphSchema.parse(input.graph);

    const version = flowVersionRecordSchema.parse({
      id: randomUUID(),
      flow_id: flow.id,
      version_number: currentMaxVersion + 1,
      graph,
      created_by: input.actor ?? null,
      created_at: new Date().toISOString(),
    });

    state.flow_versions.unshift(version);
    flow.current_version_id = version.id;
    flow.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "flow_version_created",
      actor: input.actor ?? "system",
      metadata: { flow_id: flow.id, flow_version_id: version.id, version: version.version_number },
    });

    return version;
  });
}

export async function listFlowVersions(flowId: string) {
  const state = await readState();
  return state.flow_versions.filter((version) => version.flow_id === flowId);
}

export async function getFlowVersion(flowVersionId: string) {
  const state = await readState();
  return state.flow_versions.find((version) => version.id === flowVersionId) ?? null;
}

export async function createFlowDeployment(input: {
  flowId: string;
  flowVersionId: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const flow = state.flows.find((item) => item.id === input.flowId);

    if (!flow) {
      throw new Error("Flow not found");
    }

    const version = state.flow_versions.find(
      (candidate) => candidate.id === input.flowVersionId && candidate.flow_id === input.flowId,
    );

    if (!version) {
      throw new Error("Flow version not found");
    }

    for (const deployment of state.flow_deployments) {
      if (deployment.flow_id === input.flowId && deployment.is_active) {
        deployment.is_active = false;
      }
    }

    const deployment = flowDeploymentRecordSchema.parse({
      id: randomUUID(),
      flow_id: input.flowId,
      flow_version_id: input.flowVersionId,
      deployment_key: `dpl_${randomUUID().replace(/-/g, "")}`,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    state.flow_deployments.unshift(deployment);

    appendAuditEvent(state, {
      eventType: "flow_deployed_v2",
      actor: input.actor ?? "system",
      metadata: {
        flow_id: deployment.flow_id,
        flow_version_id: deployment.flow_version_id,
        deployment_id: deployment.id,
      },
    });

    return deployment;
  });
}

export async function listFlowDeployments(flowId: string) {
  const state = await readState();
  return state.flow_deployments.filter((deployment) => deployment.flow_id === flowId);
}

export async function getFlowDeploymentById(deploymentId: string) {
  const state = await readState();
  return state.flow_deployments.find((deployment) => deployment.id === deploymentId) ?? null;
}

export async function getFlowDeploymentByKey(deploymentKey: string) {
  const state = await readState();
  return state.flow_deployments.find((deployment) => deployment.deployment_key === deploymentKey) ?? null;
}

export async function createRunV2(input: {
  projectId: string;
  flowId: string;
  flowVersionId: string;
  deploymentId?: string;
  inputRef?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const run = runRecordV2Schema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      flow_id: input.flowId,
      flow_version_id: input.flowVersionId,
      deployment_id: input.deploymentId ?? null,
      status: "queued",
      input_ref: input.inputRef ?? null,
      output_ref: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    state.runs.unshift(run);

    appendAuditEvent(state, {
      eventType: "run_created_v2",
      actor: input.actor ?? "system",
      metadata: { run_id: run.id, flow_id: run.flow_id, flow_version_id: run.flow_version_id },
    });

    return run;
  });
}

export async function setRunV2Running(runId: string) {
  return withWriteLock(async (state) => {
    const run = state.runs.find((item) => item.id === runId);

    if (!run) {
      return null;
    }

    run.status = "running";
    run.updated_at = new Date().toISOString();

    return runRecordV2Schema.parse(run);
  });
}

export async function setRunV2Completed(input: {
  runId: string;
  outputRef?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const run = state.runs.find((item) => item.id === input.runId);

    if (!run) {
      return null;
    }

    run.status = "completed";
    run.output_ref = input.outputRef ?? run.output_ref;
    run.error_message = null;
    run.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "run_completed_v2",
      actor: input.actor ?? "system",
      metadata: { run_id: run.id, flow_id: run.flow_id },
    });

    return runRecordV2Schema.parse(run);
  });
}

export async function setRunV2Failed(input: {
  runId: string;
  errorMessage: string;
}) {
  return withWriteLock(async (state) => {
    const run = state.runs.find((item) => item.id === input.runId);

    if (!run) {
      return null;
    }

    run.status = "failed";
    run.error_message = input.errorMessage;
    run.updated_at = new Date().toISOString();

    return runRecordV2Schema.parse(run);
  });
}

export async function listRunsV2(filters?: {
  projectId?: string;
  flowId?: string;
  limit?: number;
}) {
  const state = await readState();

  const runs = state.runs.filter((run) => {
    if (filters?.projectId && run.project_id !== filters.projectId) {
      return false;
    }

    if (filters?.flowId && run.flow_id !== filters.flowId) {
      return false;
    }

    return true;
  });

  if (filters?.limit) {
    return runs.slice(0, filters.limit);
  }

  return runs;
}

export async function getRunV2(runId: string) {
  const state = await readState();
  return state.runs.find((run) => run.id === runId) ?? null;
}

export async function createRunTrace(input: {
  runId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  metadata?: unknown;
}) {
  return withWriteLock(async (state) => {
    const trace = runTraceRecordSchema.parse({
      id: randomUUID(),
      run_id: input.runId,
      model: input.model ?? null,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      cost_usd: input.costUsd ?? 0,
      latency_ms: input.latencyMs ?? 0,
      metadata: input.metadata ?? null,
      created_at: new Date().toISOString(),
    });

    state.run_traces.unshift(trace);
    return trace;
  });
}

export async function listRunTraces(runId: string) {
  const state = await readState();
  return state.run_traces.filter((trace) => trace.run_id === runId);
}

export async function createDataset(input: {
  projectId: string;
  name: string;
  description?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const dataset = datasetRecordSchema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    state.datasets.unshift(dataset);

    appendAuditEvent(state, {
      eventType: "dataset_created_v2",
      actor: input.actor ?? "system",
      metadata: { dataset_id: dataset.id, project_id: dataset.project_id },
    });

    return dataset;
  });
}

export async function listDatasets(projectId: string) {
  const state = await readState();
  return state.datasets.filter((dataset) => dataset.project_id === projectId);
}

export async function getDataset(datasetId: string) {
  const state = await readState();
  return state.datasets.find((dataset) => dataset.id === datasetId) ?? null;
}

export async function createDatasetVersion(input: {
  datasetId: string;
  itemCount: number;
  lines: string[];
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const dataset = state.datasets.find((item) => item.id === input.datasetId);

    if (!dataset) {
      throw new Error("Dataset not found");
    }

    const versionNumber =
      state.dataset_versions
        .filter((version) => version.dataset_id === input.datasetId)
        .reduce((max, version) => Math.max(max, version.version_number), 0) + 1;

    const fileName = `dataset-${dataset.id}-v${versionNumber}-${Date.now()}.jsonl`;
    await fs.writeFile(path.join(DATASETS_DIR, fileName), `${input.lines.join("\n")}\n`, "utf8");

    const version = datasetVersionRecordSchema.parse({
      id: randomUUID(),
      dataset_id: input.datasetId,
      version_number: versionNumber,
      item_count: input.itemCount,
      file_name: fileName,
      created_at: new Date().toISOString(),
    });

    state.dataset_versions.unshift(version);

    appendAuditEvent(state, {
      eventType: "dataset_version_created_v2",
      actor: input.actor ?? "system",
      metadata: {
        dataset_id: input.datasetId,
        dataset_version_id: version.id,
        version: version.version_number,
      },
    });

    return version;
  });
}

export async function listDatasetVersions(datasetId: string) {
  const state = await readState();
  return state.dataset_versions.filter((version) => version.dataset_id === datasetId);
}

export async function getDatasetVersion(datasetVersionId: string) {
  const state = await readState();
  return state.dataset_versions.find((version) => version.id === datasetVersionId) ?? null;
}

export async function readDatasetVersionLines(datasetVersionId: string) {
  const version = await getDatasetVersion(datasetVersionId);

  if (!version) {
    return null;
  }

  try {
    const raw = await fs.readFile(path.join(DATASETS_DIR, version.file_name), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export async function createReviewDecision(input: {
  projectId: string;
  runId: string;
  fieldName: string;
  decision: ReviewDecisionValue;
  failureReason?: FailureReasonCode;
  reviewer?: string;
  notes?: string;
}) {
  return withWriteLock(async (state) => {
    const decision = reviewDecisionRecordSchema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      run_id: input.runId,
      field_name: input.fieldName,
      decision: input.decision,
      failure_reason: input.failureReason ?? null,
      reviewer: input.reviewer ?? null,
      notes: input.notes?.trim() || null,
      created_at: new Date().toISOString(),
    });

    state.review_decisions.unshift(decision);

    appendAuditEvent(state, {
      eventType: "review_decision_v2",
      actor: input.reviewer ?? "system",
      metadata: {
        review_decision_id: decision.id,
        run_id: decision.run_id,
        field_name: decision.field_name,
        decision: decision.decision,
      },
    });

    return decision;
  });
}

export async function attachEvidenceRegion(input: {
  reviewDecisionId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return withWriteLock(async (state) => {
    const decision = state.review_decisions.find((item) => item.id === input.reviewDecisionId);

    if (!decision) {
      throw new Error("Review decision not found");
    }

    const evidence = evidenceRegionRecordSchema.parse({
      id: randomUUID(),
      review_decision_id: input.reviewDecisionId,
      page: input.page,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      created_at: new Date().toISOString(),
    });

    state.evidence_regions.unshift(evidence);

    appendAuditEvent(state, {
      eventType: "evidence_attached_v2",
      actor: decision.reviewer,
      metadata: { review_decision_id: decision.id, evidence_id: evidence.id },
    });

    return evidence;
  });
}

export async function listReviewDecisions(runId: string) {
  const state = await readState();
  return state.review_decisions.filter((decision) => decision.run_id === runId);
}

export async function getReviewDecision(reviewDecisionId: string) {
  const state = await readState();
  return state.review_decisions.find((decision) => decision.id === reviewDecisionId) ?? null;
}

export async function listEvidenceRegions(reviewDecisionId: string) {
  const state = await readState();
  return state.evidence_regions.filter((evidence) => evidence.review_decision_id === reviewDecisionId);
}

export async function createEvalPack(input: {
  projectId: string;
  name: string;
  candidateRunIds: string[];
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const pack = evalPackRecordSchema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      name: input.name.trim(),
      candidate_run_ids: input.candidateRunIds,
      created_at: new Date().toISOString(),
    });

    state.eval_packs.unshift(pack);

    appendAuditEvent(state, {
      eventType: "eval_pack_created_v2",
      actor: input.actor ?? "system",
      metadata: {
        eval_pack_id: pack.id,
        project_id: pack.project_id,
        candidates: pack.candidate_run_ids.length,
      },
    });

    return pack;
  });
}

export async function listEvalPacks(projectId: string) {
  const state = await readState();
  return state.eval_packs.filter((pack) => pack.project_id === projectId);
}

export async function listActiveLearningCandidatesV2(input: {
  projectId: string;
  limit?: number;
}) {
  const state = await readState();
  const decisionsByRun = new Map<string, ReviewDecisionRecord[]>();
  const tracesByRun = new Map<string, RunTraceRecord[]>();

  for (const decision of state.review_decisions) {
    const existing = decisionsByRun.get(decision.run_id) ?? [];
    existing.push(decision);
    decisionsByRun.set(decision.run_id, existing);
  }

  for (const trace of state.run_traces) {
    const existing = tracesByRun.get(trace.run_id) ?? [];
    existing.push(trace);
    tracesByRun.set(trace.run_id, existing);
  }

  const scored = state.runs
    .filter((run) => run.project_id === input.projectId && run.status === "completed")
    .map((run) => {
      const decisions = decisionsByRun.get(run.id) ?? [];
      const traces = tracesByRun.get(run.id) ?? [];

      const incorrectCount = decisions.filter((item) => item.decision === "incorrect" || item.decision === "missing").length;
      const uncertainCount = decisions.filter((item) => item.decision === "uncertain").length;
      const averageLatency = traces.length
        ? traces.reduce((sum, trace) => sum + trace.latency_ms, 0) / traces.length
        : 0;
      const cost = traces.reduce((sum, trace) => sum + trace.cost_usd, 0);

      const score = incorrectCount * 4 + uncertainCount * 2 + Math.min(averageLatency / 1000, 3) + Math.min(cost * 10, 3);

      return {
        run,
        score,
        incorrect_count: incorrectCount,
        uncertain_count: uncertainCount,
        avg_latency_ms: averageLatency,
        cost_usd: cost,
      };
    })
    .sort((left, right) => right.score - left.score);

  if (input.limit) {
    return scored.slice(0, input.limit);
  }

  return scored;
}

export async function processConnectorDelivery(input: {
  projectId: string;
  connectorType: string;
  payload: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const now = new Date().toISOString();
    const normalizedType = input.connectorType.trim().toLowerCase();
    const normalizedIdempotencyKey = input.idempotencyKey?.trim() || null;
    const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 10));
    const initialBackoffMs = Math.max(100, Math.min(input.initialBackoffMs ?? 500, 60_000));
    const payloadHash = hashPayload(input.payload);

    const existing =
      normalizedIdempotencyKey === null
        ? null
        : state.connector_deliveries.find(
            (delivery) =>
              delivery.project_id === input.projectId &&
              delivery.connector_type === normalizedType &&
              delivery.idempotency_key === normalizedIdempotencyKey,
          ) ?? null;

    if (existing) {
      const attempts = state.connector_delivery_attempts
        .filter((attempt) => attempt.delivery_id === existing.id)
        .sort((left, right) => left.attempt_number - right.attempt_number);

      return {
        delivery: connectorDeliveryRecordSchema.parse(existing),
        attempts: attempts.map((attempt) => connectorDeliveryAttemptRecordSchema.parse(attempt)),
        duplicate: true,
      };
    }

    const delivery = connectorDeliveryRecordSchema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      connector_type: normalizedType,
      idempotency_key: normalizedIdempotencyKey,
      payload_hash: payloadHash,
      status: "queued",
      attempt_count: 0,
      max_attempts: maxAttempts,
      last_status_code: null,
      last_error: null,
      next_attempt_at: null,
      dead_letter_reason: null,
      delivered_at: null,
      created_at: now,
      updated_at: now,
    });

    state.connector_deliveries.unshift(delivery);
    appendAuditEvent(state, {
      eventType: "connector_delivery_queued_v2",
      actor: input.actor ?? "system",
      metadata: {
        delivery_id: delivery.id,
        connector_type: delivery.connector_type,
        project_id: delivery.project_id,
      },
    });

    const simulation = connectorSimulationFromPayload(input.payload);

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const attemptNow = new Date().toISOString();
      const failThisAttempt = simulation.alwaysFail || attemptNumber <= simulation.failureCount;
      const statusCode = failThisAttempt ? simulation.statusCode : 200;
      const errorMessage = failThisAttempt ? simulation.errorMessage : null;

      const attempt = connectorDeliveryAttemptRecordSchema.parse({
        id: randomUUID(),
        delivery_id: delivery.id,
        attempt_number: attemptNumber,
        success: !failThisAttempt,
        status_code: statusCode,
        error_message: errorMessage,
        response_body: failThisAttempt ? null : JSON.stringify({ accepted: true }),
        created_at: attemptNow,
      });
      state.connector_delivery_attempts.unshift(attempt);

      delivery.attempt_count = attemptNumber;
      delivery.last_status_code = statusCode;
      delivery.last_error = errorMessage;
      delivery.updated_at = attemptNow;

      appendAuditEvent(state, {
        eventType: "connector_delivery_attempted_v2",
        actor: input.actor ?? "system",
        metadata: {
          delivery_id: delivery.id,
          attempt_number: attempt.attempt_number,
          success: attempt.success,
          status_code: attempt.status_code,
        },
      });

      if (!failThisAttempt) {
        delivery.status = "delivered";
        delivery.next_attempt_at = null;
        delivery.dead_letter_reason = null;
        delivery.delivered_at = attemptNow;

        appendAuditEvent(state, {
          eventType: "connector_delivered_v2",
          actor: input.actor ?? "system",
          metadata: {
            delivery_id: delivery.id,
            attempts: attempt.attempt_number,
            connector_type: delivery.connector_type,
          },
        });
        break;
      }

      if (attemptNumber >= maxAttempts) {
        delivery.status = "dead_lettered";
        delivery.next_attempt_at = null;
        delivery.dead_letter_reason = errorMessage ?? "Connector delivery exhausted retries";

        appendAuditEvent(state, {
          eventType: "connector_dead_lettered_v2",
          actor: input.actor ?? "system",
          metadata: {
            delivery_id: delivery.id,
            attempts: attempt.attempt_number,
            connector_type: delivery.connector_type,
            reason: delivery.dead_letter_reason,
          },
        });
        break;
      }

      delivery.status = "retrying";
      const backoffMs = initialBackoffMs * 2 ** (attemptNumber - 1);
      delivery.next_attempt_at = new Date(Date.now() + backoffMs).toISOString();
    }

    const attempts = state.connector_delivery_attempts
      .filter((attempt) => attempt.delivery_id === delivery.id)
      .sort((left, right) => left.attempt_number - right.attempt_number);

    return {
      delivery: connectorDeliveryRecordSchema.parse(delivery),
      attempts: attempts.map((attempt) => connectorDeliveryAttemptRecordSchema.parse(attempt)),
      duplicate: false,
    };
  });
}

export async function listConnectorDeliveries(filters: {
  projectId: string;
  connectorType?: string;
  status?: "queued" | "retrying" | "delivered" | "dead_lettered";
  limit?: number;
}) {
  const state = await readState();
  const normalizedType = filters.connectorType?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));

  return state.connector_deliveries
    .filter((delivery) => {
      if (delivery.project_id !== filters.projectId) {
        return false;
      }
      if (normalizedType && delivery.connector_type !== normalizedType) {
        return false;
      }
      if (filters.status && delivery.status !== filters.status) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function listConnectorDeliveryAttempts(deliveryId: string) {
  const state = await readState();
  return state.connector_delivery_attempts
    .filter((attempt) => attempt.delivery_id === deliveryId)
    .sort((left, right) => left.attempt_number - right.attempt_number);
}

export async function registerEdgeAgent(input: {
  projectId: string;
  name: string;
  platform: string;
}) {
  return withWriteLock(async (state) => {
    const now = new Date().toISOString();
    const agent = edgeAgentRecordSchema.parse({
      id: randomUUID(),
      project_id: input.projectId,
      name: input.name.trim(),
      platform: input.platform.trim(),
      status: "online",
      last_heartbeat_at: now,
      created_at: now,
    });

    state.edge_agents.unshift(agent);
    return agent;
  });
}

export async function listEdgeAgents(projectId?: string) {
  const state = await readState();
  const nowMs = Date.now();

  if (!projectId) {
    return state.edge_agents.map((agent) => withDerivedAgentStatus(agent, nowMs));
  }

  return state.edge_agents
    .filter((agent) => agent.project_id === projectId)
    .map((agent) => withDerivedAgentStatus(agent, nowMs));
}

export async function getEdgeAgent(agentId: string) {
  const state = await readState();
  const agent = state.edge_agents.find((item) => item.id === agentId) ?? null;

  if (!agent) {
    return null;
  }

  return withDerivedAgentStatus(agent);
}

export async function touchEdgeAgentHeartbeat(input: {
  agentId: string;
  checkpoint?: { key: string; value: string };
}) {
  return withWriteLock(async (state) => {
    const agent = state.edge_agents.find((item) => item.id === input.agentId);

    if (!agent) {
      return null;
    }

    agent.status = "online";
    agent.last_heartbeat_at = new Date().toISOString();

    if (input.checkpoint) {
      const existing = state.sync_checkpoints.find(
        (item) => item.agent_id === input.agentId && item.checkpoint_key === input.checkpoint?.key,
      );
      const checkpoint = syncCheckpointRecordSchema.parse({
        id: existing?.id ?? randomUUID(),
        agent_id: input.agentId,
        checkpoint_key: input.checkpoint.key,
        checkpoint_value: input.checkpoint.value,
        updated_at: new Date().toISOString(),
      });

      if (existing) {
        const index = state.sync_checkpoints.findIndex((item) => item.id === existing.id);
        state.sync_checkpoints[index] = checkpoint;
      } else {
        state.sync_checkpoints.unshift(checkpoint);
      }
    }

    return edgeAgentRecordSchema.parse(agent);
  });
}

export async function appendEdgeAgentEvent(input: {
  agentId: string;
  eventType: string;
  payload: unknown;
}) {
  return withWriteLock(async (state) => {
    const agent = state.edge_agents.find((item) => item.id === input.agentId);

    if (!agent) {
      return null;
    }

    const event = edgeAgentEventRecordSchema.parse({
      id: randomUUID(),
      agent_id: input.agentId,
      event_type: input.eventType,
      payload: input.payload,
      created_at: new Date().toISOString(),
    });

    state.edge_agent_events.unshift(event);
    return event;
  });
}

export async function listEdgeAgentEvents(input: {
  agentId: string;
  eventType?: string;
  limit?: number;
}) {
  const state = await readState();
  const normalizedType = input.eventType?.trim();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));

  return state.edge_agent_events
    .filter((event) => {
      if (event.agent_id !== input.agentId) {
        return false;
      }
      if (normalizedType && event.event_type !== normalizedType) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function getEdgeAgentHealth(agentId: string) {
  const state = await readState();
  const nowMs = Date.now();
  const agent = state.edge_agents.find((item) => item.id === agentId) ?? null;

  if (!agent) {
    return null;
  }

  const heartbeatMs = agent.last_heartbeat_at ? Date.parse(agent.last_heartbeat_at) : null;
  const heartbeatLagMs = heartbeatMs === null ? null : Math.max(0, nowMs - heartbeatMs);
  const isStale = heartbeatLagMs === null || heartbeatLagMs > EDGE_HEARTBEAT_STALE_MS;
  const commands = state.edge_agent_commands.filter((command) => command.agent_id === agentId);
  const pendingCount = commands.filter((command) => command.status === "pending").length;
  const claimedCount = commands.filter((command) => command.status === "claimed").length;
  const failedCount = commands.filter((command) => command.status === "failed").length;
  const acknowledgedCount = commands.filter((command) => command.status === "acknowledged").length;
  const checkpoints = state.sync_checkpoints
    .filter((checkpoint) => checkpoint.agent_id === agentId)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(0, 5);
  const recentEvents = state.edge_agent_events
    .filter((event) => event.agent_id === agentId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 10);

  return {
    agent: withDerivedAgentStatus(agent, nowMs),
    heartbeat_lag_ms: heartbeatLagMs,
    stale_threshold_ms: EDGE_HEARTBEAT_STALE_MS,
    is_stale: isStale,
    commands: {
      pending: pendingCount,
      claimed: claimedCount,
      failed: failedCount,
      acknowledged: acknowledgedCount,
    },
    checkpoints,
    recent_events: recentEvents,
  };
}

export async function createEdgeAgentConfig(input: {
  agentId: string;
  config: unknown;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const agent = state.edge_agents.find((item) => item.id === input.agentId);

    if (!agent) {
      return null;
    }

    const latestVersion = state.edge_agent_configs
      .filter((config) => config.agent_id === input.agentId)
      .reduce((max, config) => Math.max(max, config.version_number), 0);

    const record = edgeAgentConfigRecordSchema.parse({
      id: randomUUID(),
      agent_id: input.agentId,
      version_number: latestVersion + 1,
      config: input.config,
      created_by: input.actor ?? null,
      created_at: new Date().toISOString(),
    });

    state.edge_agent_configs.unshift(record);
    appendAuditEvent(state, {
      eventType: "edge_agent_config_updated_v2",
      actor: input.actor ?? "system",
      metadata: {
        agent_id: input.agentId,
        version_number: record.version_number,
      },
    });

    return record;
  });
}

export async function getLatestEdgeAgentConfig(agentId: string) {
  const state = await readState();
  return (
    state.edge_agent_configs
      .filter((config) => config.agent_id === agentId)
      .sort((left, right) => right.version_number - left.version_number)[0] ?? null
  );
}

export async function enqueueEdgeAgentCommand(input: {
  agentId: string;
  commandType: string;
  payload: unknown;
  expiresAt?: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const agent = state.edge_agents.find((item) => item.id === input.agentId);

    if (!agent) {
      return null;
    }

    const now = new Date().toISOString();
    const command = edgeAgentCommandRecordSchema.parse({
      id: randomUUID(),
      agent_id: input.agentId,
      command_type: input.commandType.trim(),
      payload: input.payload,
      status: "pending",
      claimed_at: null,
      acknowledged_at: null,
      result: null,
      created_by: input.actor ?? null,
      expires_at: input.expiresAt ?? null,
      created_at: now,
      updated_at: now,
    });

    state.edge_agent_commands.unshift(command);
    appendAuditEvent(state, {
      eventType: "edge_agent_command_enqueued_v2",
      actor: input.actor ?? "system",
      metadata: {
        agent_id: input.agentId,
        command_id: command.id,
        command_type: command.command_type,
      },
    });

    return command;
  });
}

export async function listEdgeAgentCommands(input: {
  agentId: string;
  status?: EdgeAgentCommandStatus;
  limit?: number;
}) {
  const state = await readState();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));

  return state.edge_agent_commands
    .filter((command) => {
      if (command.agent_id !== input.agentId) {
        return false;
      }
      if (input.status && command.status !== input.status) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function claimEdgeAgentCommands(input: {
  agentId: string;
  limit?: number;
}) {
  return withWriteLock(async (state) => {
    const agent = state.edge_agents.find((item) => item.id === input.agentId);

    if (!agent) {
      return null;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));

    const candidates = state.edge_agent_commands
      .filter((command) => {
        if (command.agent_id !== input.agentId) {
          return false;
        }
        const isPending = command.status === "pending";
        const isClaimedAndExpired =
          command.status === "claimed" &&
          command.claimed_at !== null &&
          nowMs - Date.parse(command.claimed_at) > EDGE_COMMAND_LEASE_MS;

        if (!isPending && !isClaimedAndExpired) {
          return false;
        }
        if (command.expires_at && Date.parse(command.expires_at) <= nowMs) {
          return false;
        }
        return true;
      })
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
      .slice(0, limit);

    for (const command of candidates) {
      command.status = "claimed";
      command.claimed_at = nowIso;
      command.updated_at = nowIso;
    }

    return candidates.map((command) => edgeAgentCommandRecordSchema.parse(command));
  });
}

export async function acknowledgeEdgeAgentCommand(input: {
  agentId: string;
  commandId: string;
  status: "acknowledged" | "failed";
  result?: unknown;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const command = state.edge_agent_commands.find((item) => item.id === input.commandId && item.agent_id === input.agentId);

    if (!command) {
      return null;
    }

    if (command.status === "acknowledged" || command.status === "failed") {
      return edgeAgentCommandRecordSchema.parse(command);
    }

    const now = new Date().toISOString();
    command.status = input.status;
    command.acknowledged_at = now;
    command.updated_at = now;
    command.result = input.result ?? null;

    appendAuditEvent(state, {
      eventType: "edge_agent_command_acknowledged_v2",
      actor: input.actor ?? "system",
      metadata: {
        command_id: command.id,
        agent_id: input.agentId,
        status: command.status,
      },
    });

    return edgeAgentCommandRecordSchema.parse(command);
  });
}

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
  reviewAlertPolicyRecordSchema,
  type ReviewAlertPolicyRecord,
  connectorBackpressurePolicyRecordSchema,
  type ConnectorBackpressurePolicyRecord,
  connectorBackpressurePolicyDraftRecordSchema,
  type ConnectorBackpressurePolicyDraftRecord,
  connectorGuardianPolicyRecordSchema,
  type ConnectorGuardianPolicyRecord,
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
import {
  connectorRedriveResetFields,
  computeRetryBackoffMs,
  isConnectorDeadLetterEligibleForRedrive,
  isConnectorDeliveryDue,
  type ConnectorDeliveryStatus,
} from "@/lib/v2/connector-queue";
import { summarizeReviewQueues } from "@/lib/v2/review-ops";
import { dispatchConnectorDelivery } from "@/lib/v2/connector-runtime";
import { canonicalConnectorType } from "@/lib/v2/connectors";
import { computeConnectorBackpressureDraftReadiness } from "@/lib/v2/connector-backpressure-draft";

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
  review_alert_policies: ReviewAlertPolicyRecord[];
  connector_backpressure_policies: ConnectorBackpressurePolicyRecord[];
  connector_backpressure_policy_drafts: ConnectorBackpressurePolicyDraftRecord[];
  connector_guardian_policies: ConnectorGuardianPolicyRecord[];
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
  review_alert_policies: [],
  connector_backpressure_policies: [],
  connector_backpressure_policy_drafts: [],
  connector_guardian_policies: [],
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
const CONNECTOR_INPUTS_DIR = path.join(DATA_DIR, "connector-inputs-v2");
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
  await fs.mkdir(CONNECTOR_INPUTS_DIR, { recursive: true });

  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2), "utf8");
  }
}

type ConnectorDeliveryInputRecord = {
  payload: unknown;
  config?: unknown;
  initialBackoffMs?: number;
};

function connectorInputFilePath(deliveryId: string) {
  return path.join(CONNECTOR_INPUTS_DIR, `${deliveryId}.json`);
}

async function writeConnectorInput(input: {
  deliveryId: string;
  payload: unknown;
  config?: unknown;
  initialBackoffMs?: number;
}) {
  const record: ConnectorDeliveryInputRecord = {
    payload: input.payload,
    config: input.config ?? {},
    initialBackoffMs: input.initialBackoffMs,
  };
  await fs.writeFile(connectorInputFilePath(input.deliveryId), JSON.stringify(record), "utf8");
}

async function readConnectorInput(deliveryId: string): Promise<ConnectorDeliveryInputRecord | null> {
  try {
    const raw = await fs.readFile(connectorInputFilePath(deliveryId), "utf8");
    const parsed = JSON.parse(raw) as ConnectorDeliveryInputRecord;
    return parsed;
  } catch {
    return null;
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
    review_alert_policies: (parsed.review_alert_policies ?? []).map((item) => reviewAlertPolicyRecordSchema.parse(item)),
    connector_backpressure_policies: (parsed.connector_backpressure_policies ?? []).map((item) =>
      connectorBackpressurePolicyRecordSchema.parse(item),
    ),
    connector_backpressure_policy_drafts: (parsed.connector_backpressure_policy_drafts ?? []).map((item) =>
      connectorBackpressurePolicyDraftRecordSchema.parse(item),
    ),
    connector_guardian_policies: (parsed.connector_guardian_policies ?? []).map((item) =>
      connectorGuardianPolicyRecordSchema.parse({
        dry_run: false,
        ...(item as Record<string, unknown>),
      }),
    ),
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

export async function listReviewQueuesV2(input: {
  projectId: string;
  limit?: number;
  staleAfterMs?: number;
}) {
  const state = await readState();
  const runs = state.runs.filter((run) => run.project_id === input.projectId);
  const runIds = new Set(runs.map((run) => run.id));
  const decisions = state.review_decisions.filter(
    (decision) => decision.project_id === input.projectId && runIds.has(decision.run_id),
  );
  const decisionIds = new Set(decisions.map((decision) => decision.id));
  const evidenceRegions = state.evidence_regions.filter((evidence) => decisionIds.has(evidence.review_decision_id));

  return summarizeReviewQueues({
    runs,
    decisions,
    evidenceRegions,
    staleAfterMs: input.staleAfterMs,
    limit: input.limit,
  });
}

const REVIEW_ALERT_POLICY_DEFAULTS = {
  isEnabled: true,
  connectorType: "slack",
  staleHours: 24,
  queueLimit: 50,
  minUnreviewedQueues: 5,
  minAtRiskQueues: 3,
  minStaleQueues: 3,
  minAvgErrorRate: 0.35,
  idempotencyWindowMinutes: 30,
} as const;

const CONNECTOR_GUARDIAN_POLICY_DEFAULTS = {
  isEnabled: true,
  dryRun: false,
  lookbackHours: 24,
  riskThreshold: 20,
  maxActionsPerProject: 2,
  actionLimit: 10,
  cooldownMinutes: 10,
  minDeadLetterMinutes: 15,
  allowProcessQueue: true,
  allowRedriveDeadLetters: true,
} as const;

const CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS = {
  isEnabled: true,
  maxRetrying: 50,
  maxDueNow: 100,
  minLimit: 1,
} as const;

function clampPositiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function clampPositiveNumber(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }
  return Math.min(Number(value.toFixed(4)), max);
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
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeConnectorBackpressureOverrides(input: {
  overrides: Record<
    string,
    {
      isEnabled: boolean;
      maxRetrying: number;
      maxDueNow: number;
      minLimit: number;
    }
  >;
  existingOverrides?: ConnectorBackpressurePolicyRecord["connector_overrides"];
}): ConnectorBackpressurePolicyRecord["connector_overrides"] {
  const normalized: ConnectorBackpressurePolicyRecord["connector_overrides"] = {};

  for (const [rawType, override] of Object.entries(input.overrides)) {
    const connectorType = canonicalConnectorType(rawType);
    if (!connectorType) {
      continue;
    }

    const existing = input.existingOverrides?.[connectorType];
    normalized[connectorType] = {
      is_enabled: override.isEnabled,
      max_retrying: clampPositiveInt(
        override.maxRetrying,
        existing?.max_retrying ?? CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxRetrying,
        10_000,
      ),
      max_due_now: clampPositiveInt(
        override.maxDueNow,
        existing?.max_due_now ?? CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxDueNow,
        10_000,
      ),
      min_limit: clampPositiveInt(override.minLimit, existing?.min_limit ?? CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.minLimit, 100),
    };
  }

  return normalized;
}

export async function getReviewAlertPolicy(projectId: string) {
  const state = await readState();
  return state.review_alert_policies.find((policy) => policy.project_id === projectId) ?? null;
}

export async function upsertReviewAlertPolicy(input: {
  projectId: string;
  isEnabled?: boolean;
  connectorType?: string;
  staleHours?: number;
  queueLimit?: number;
  minUnreviewedQueues?: number;
  minAtRiskQueues?: number;
  minStaleQueues?: number;
  minAvgErrorRate?: number;
  idempotencyWindowMinutes?: number;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const existing = state.review_alert_policies.find((policy) => policy.project_id === input.projectId) ?? null;
    const now = new Date().toISOString();

    const policy = reviewAlertPolicyRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      project_id: input.projectId,
      is_enabled: input.isEnabled ?? existing?.is_enabled ?? REVIEW_ALERT_POLICY_DEFAULTS.isEnabled,
      connector_type: normalizeConnectorType(
        input.connectorType,
        existing?.connector_type ?? REVIEW_ALERT_POLICY_DEFAULTS.connectorType,
      ),
      stale_hours: clampPositiveInt(
        input.staleHours ?? existing?.stale_hours,
        REVIEW_ALERT_POLICY_DEFAULTS.staleHours,
        24 * 30,
      ),
      queue_limit: clampPositiveInt(input.queueLimit ?? existing?.queue_limit, REVIEW_ALERT_POLICY_DEFAULTS.queueLimit, 200),
      min_unreviewed_queues: clampNonNegativeInt(
        input.minUnreviewedQueues ?? existing?.min_unreviewed_queues,
        REVIEW_ALERT_POLICY_DEFAULTS.minUnreviewedQueues,
        500,
      ),
      min_at_risk_queues: clampNonNegativeInt(
        input.minAtRiskQueues ?? existing?.min_at_risk_queues,
        REVIEW_ALERT_POLICY_DEFAULTS.minAtRiskQueues,
        500,
      ),
      min_stale_queues: clampNonNegativeInt(
        input.minStaleQueues ?? existing?.min_stale_queues,
        REVIEW_ALERT_POLICY_DEFAULTS.minStaleQueues,
        500,
      ),
      min_avg_error_rate: clampRate(
        input.minAvgErrorRate ?? existing?.min_avg_error_rate,
        REVIEW_ALERT_POLICY_DEFAULTS.minAvgErrorRate,
      ),
      idempotency_window_minutes: clampPositiveInt(
        input.idempotencyWindowMinutes ?? existing?.idempotency_window_minutes,
        REVIEW_ALERT_POLICY_DEFAULTS.idempotencyWindowMinutes,
        24 * 60,
      ),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    const existingIndex = state.review_alert_policies.findIndex((item) => item.project_id === input.projectId);
    if (existingIndex >= 0) {
      state.review_alert_policies[existingIndex] = policy;
    } else {
      state.review_alert_policies.unshift(policy);
    }

    appendAuditEvent(state, {
      eventType: "review_alert_policy_updated_v2",
      actor: input.actor ?? "system",
      metadata: {
        policy_id: policy.id,
        project_id: policy.project_id,
        is_enabled: policy.is_enabled,
        connector_type: policy.connector_type,
      },
    });

    return policy;
  });
}

export async function getConnectorGuardianPolicy(projectId: string) {
  const state = await readState();
  return state.connector_guardian_policies.find((policy) => policy.project_id === projectId) ?? null;
}

export async function getConnectorBackpressurePolicy(projectId: string) {
  const state = await readState();
  return state.connector_backpressure_policies.find((policy) => policy.project_id === projectId) ?? null;
}

export async function getConnectorBackpressurePolicyDraft(projectId: string) {
  const state = await readState();
  return state.connector_backpressure_policy_drafts.find((policy) => policy.project_id === projectId) ?? null;
}

export async function upsertConnectorGuardianPolicy(input: {
  projectId: string;
  isEnabled?: boolean;
  dryRun?: boolean;
  lookbackHours?: number;
  riskThreshold?: number;
  maxActionsPerProject?: number;
  actionLimit?: number;
  cooldownMinutes?: number;
  minDeadLetterMinutes?: number;
  allowProcessQueue?: boolean;
  allowRedriveDeadLetters?: boolean;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const existing = state.connector_guardian_policies.find((policy) => policy.project_id === input.projectId) ?? null;
    const now = new Date().toISOString();

    const policy = connectorGuardianPolicyRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      project_id: input.projectId,
      is_enabled: input.isEnabled ?? existing?.is_enabled ?? CONNECTOR_GUARDIAN_POLICY_DEFAULTS.isEnabled,
      dry_run: input.dryRun ?? existing?.dry_run ?? CONNECTOR_GUARDIAN_POLICY_DEFAULTS.dryRun,
      lookback_hours: clampPositiveInt(
        input.lookbackHours ?? existing?.lookback_hours,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.lookbackHours,
        24 * 30,
      ),
      risk_threshold: clampPositiveNumber(
        input.riskThreshold ?? existing?.risk_threshold,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.riskThreshold,
        500,
      ),
      max_actions_per_project: clampPositiveInt(
        input.maxActionsPerProject ?? existing?.max_actions_per_project,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.maxActionsPerProject,
        20,
      ),
      action_limit: clampPositiveInt(
        input.actionLimit ?? existing?.action_limit,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.actionLimit,
        100,
      ),
      cooldown_minutes: clampNonNegativeInt(
        input.cooldownMinutes ?? existing?.cooldown_minutes,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.cooldownMinutes,
        24 * 60,
      ),
      min_dead_letter_minutes: clampNonNegativeInt(
        input.minDeadLetterMinutes ?? existing?.min_dead_letter_minutes,
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.minDeadLetterMinutes,
        7 * 24 * 60,
      ),
      allow_process_queue:
        input.allowProcessQueue ?? existing?.allow_process_queue ?? CONNECTOR_GUARDIAN_POLICY_DEFAULTS.allowProcessQueue,
      allow_redrive_dead_letters:
        input.allowRedriveDeadLetters ??
        existing?.allow_redrive_dead_letters ??
        CONNECTOR_GUARDIAN_POLICY_DEFAULTS.allowRedriveDeadLetters,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    const existingIndex = state.connector_guardian_policies.findIndex((item) => item.project_id === input.projectId);
    if (existingIndex >= 0) {
      state.connector_guardian_policies[existingIndex] = policy;
    } else {
      state.connector_guardian_policies.unshift(policy);
    }

    appendAuditEvent(state, {
      eventType: "connector_guardian_policy_updated_v2",
      actor: input.actor ?? "system",
      metadata: {
        policy_id: policy.id,
        project_id: policy.project_id,
        is_enabled: policy.is_enabled,
        dry_run: policy.dry_run,
        risk_threshold: policy.risk_threshold,
        max_actions_per_project: policy.max_actions_per_project,
      },
    });

    return policy;
  });
}

export async function upsertConnectorBackpressurePolicy(input: {
  projectId: string;
  isEnabled?: boolean;
  maxRetrying?: number;
  maxDueNow?: number;
  minLimit?: number;
  connectorOverrides?: Record<
    string,
    {
      isEnabled: boolean;
      maxRetrying: number;
      maxDueNow: number;
      minLimit: number;
    }
  >;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const existing = state.connector_backpressure_policies.find((policy) => policy.project_id === input.projectId) ?? null;
    const now = new Date().toISOString();

    const policy = connectorBackpressurePolicyRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      project_id: input.projectId,
      is_enabled: input.isEnabled ?? existing?.is_enabled ?? CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.isEnabled,
      max_retrying: clampPositiveInt(
        input.maxRetrying ?? existing?.max_retrying,
        CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxRetrying,
        10_000,
      ),
      max_due_now: clampPositiveInt(
        input.maxDueNow ?? existing?.max_due_now,
        CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxDueNow,
        10_000,
      ),
      min_limit: clampPositiveInt(input.minLimit ?? existing?.min_limit, CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.minLimit, 100),
      connector_overrides:
        input.connectorOverrides === undefined
          ? existing?.connector_overrides ?? {}
          : normalizeConnectorBackpressureOverrides({
              overrides: input.connectorOverrides,
              existingOverrides: existing?.connector_overrides,
            }),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    const existingIndex = state.connector_backpressure_policies.findIndex((item) => item.project_id === input.projectId);
    if (existingIndex >= 0) {
      state.connector_backpressure_policies[existingIndex] = policy;
    } else {
      state.connector_backpressure_policies.unshift(policy);
    }

    appendAuditEvent(state, {
      eventType: "connector_backpressure_policy_updated_v2",
      actor: input.actor ?? "system",
      metadata: {
        policy_id: policy.id,
        project_id: policy.project_id,
        is_enabled: policy.is_enabled,
        max_retrying: policy.max_retrying,
        max_due_now: policy.max_due_now,
        min_limit: policy.min_limit,
        connector_override_count: Object.keys(policy.connector_overrides).length,
        connector_overrides: policy.connector_overrides,
      },
    });

    return policy;
  });
}

export async function upsertConnectorBackpressurePolicyDraft(input: {
  projectId: string;
  isEnabled?: boolean;
  maxRetrying?: number;
  maxDueNow?: number;
  minLimit?: number;
  requiredApprovals?: number;
  activateAt?: string | null;
  connectorOverrides?: Record<
    string,
    {
      isEnabled: boolean;
      maxRetrying: number;
      maxDueNow: number;
      minLimit: number;
    }
  >;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const existing =
      state.connector_backpressure_policy_drafts.find((policy) => policy.project_id === input.projectId) ?? null;
    const now = new Date().toISOString();
    const activateAtMs = input.activateAt ? Date.parse(input.activateAt) : Number.NaN;

    const policy = connectorBackpressurePolicyDraftRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      project_id: input.projectId,
      is_enabled: input.isEnabled ?? existing?.is_enabled ?? CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.isEnabled,
      max_retrying: clampPositiveInt(
        input.maxRetrying ?? existing?.max_retrying,
        CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxRetrying,
        10_000,
      ),
      max_due_now: clampPositiveInt(
        input.maxDueNow ?? existing?.max_due_now,
        CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.maxDueNow,
        10_000,
      ),
      min_limit: clampPositiveInt(input.minLimit ?? existing?.min_limit, CONNECTOR_BACKPRESSURE_POLICY_DEFAULTS.minLimit, 100),
      connector_overrides:
        input.connectorOverrides === undefined
          ? existing?.connector_overrides ?? {}
          : normalizeConnectorBackpressureOverrides({
              overrides: input.connectorOverrides,
              existingOverrides: existing?.connector_overrides,
            }),
      required_approvals: clampPositiveInt(input.requiredApprovals ?? existing?.required_approvals, 1, 10),
      approvals: existing?.approvals ?? [],
      activate_at:
        input.activateAt === undefined
          ? existing?.activate_at ?? null
          : Number.isFinite(activateAtMs)
            ? new Date(activateAtMs).toISOString()
            : null,
      created_by: input.actor ?? existing?.created_by ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    const existingIndex = state.connector_backpressure_policy_drafts.findIndex((item) => item.project_id === input.projectId);
    if (existingIndex >= 0) {
      state.connector_backpressure_policy_drafts[existingIndex] = policy;
    } else {
      state.connector_backpressure_policy_drafts.unshift(policy);
    }

    return policy;
  });
}

export async function approveConnectorBackpressurePolicyDraft(input: {
  projectId: string;
  actor: string;
}) {
  return withWriteLock(async (state) => {
    const existing =
      state.connector_backpressure_policy_drafts.find((policy) => policy.project_id === input.projectId) ?? null;
    if (!existing) {
      throw new Error("Backpressure policy draft not found");
    }

    const actor = input.actor.trim().toLowerCase();
    if (!actor) {
      throw new Error("Draft approval actor is required");
    }

    const now = new Date().toISOString();
    const deduped = [
      ...existing.approvals.filter((approval) => approval.actor.trim().toLowerCase() !== actor),
      { actor, approved_at: now },
    ];

    const updated = connectorBackpressurePolicyDraftRecordSchema.parse({
      ...existing,
      approvals: deduped,
      updated_at: now,
    });

    const index = state.connector_backpressure_policy_drafts.findIndex((item) => item.project_id === input.projectId);
    state.connector_backpressure_policy_drafts[index] = updated;
    return updated;
  });
}

export async function deleteConnectorBackpressurePolicyDraft(input: { projectId: string }) {
  return withWriteLock(async (state) => {
    const existingIndex = state.connector_backpressure_policy_drafts.findIndex((item) => item.project_id === input.projectId);
    if (existingIndex < 0) {
      return false;
    }

    state.connector_backpressure_policy_drafts.splice(existingIndex, 1);
    return true;
  });
}

export async function applyConnectorBackpressurePolicyDraft(input: { projectId: string; actor?: string }) {
  const draft = await getConnectorBackpressurePolicyDraft(input.projectId);
  if (!draft) {
    throw new Error("Backpressure policy draft not found");
  }

  const readiness = computeConnectorBackpressureDraftReadiness({
    draft,
    actor: input.actor ?? null,
  });
  if (!readiness.activation_ready) {
    throw new Error("Backpressure policy draft activation time not reached");
  }
  if (readiness.approvals_remaining > 0) {
    throw new Error(`Backpressure policy draft requires ${readiness.approvals_remaining} more approval(s)`);
  }

  const policy = await upsertConnectorBackpressurePolicy({
    projectId: input.projectId,
    isEnabled: draft.is_enabled,
    maxRetrying: draft.max_retrying,
    maxDueNow: draft.max_due_now,
    minLimit: draft.min_limit,
    connectorOverrides: Object.fromEntries(
      Object.entries(draft.connector_overrides).map(([connectorType, override]) => [
        connectorType,
        {
          isEnabled: override.is_enabled,
          maxRetrying: override.max_retrying,
          maxDueNow: override.max_due_now,
          minLimit: override.min_limit,
        },
      ]),
    ),
    actor: input.actor,
  });

  await deleteConnectorBackpressurePolicyDraft({
    projectId: input.projectId,
  });

  return policy;
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

function createConnectorDeliveryRecord(input: {
  projectId: string;
  connectorType: string;
  payload: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
}) {
  const now = new Date().toISOString();
  const normalizedType = input.connectorType.trim().toLowerCase();
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || null;
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 10));

  const delivery = connectorDeliveryRecordSchema.parse({
    id: randomUUID(),
    project_id: input.projectId,
    connector_type: normalizedType,
    idempotency_key: normalizedIdempotencyKey,
    payload_hash: hashPayload(input.payload),
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

  return {
    delivery,
    normalizedType,
    normalizedIdempotencyKey,
  };
}

function listAttemptsForDelivery(state: DbStateV2, deliveryId: string) {
  return state.connector_delivery_attempts
    .filter((attempt) => attempt.delivery_id === deliveryId)
    .sort((left, right) => left.attempt_number - right.attempt_number)
    .map((attempt) => connectorDeliveryAttemptRecordSchema.parse(attempt));
}

async function executeConnectorAttempt(input: {
  state: DbStateV2;
  delivery: ConnectorDeliveryRecord;
  payload: unknown;
  config?: unknown;
  initialBackoffMs: number;
  actor?: string;
}) {
  if (!isConnectorDeliveryDue({ status: input.delivery.status as ConnectorDeliveryStatus, nextAttemptAt: input.delivery.next_attempt_at })) {
    return null;
  }

  const attemptNow = new Date().toISOString();
  const attemptNumber = input.delivery.attempt_count + 1;
  const simulation = connectorSimulationFromPayload(input.payload);
  const forceFailure = simulation.alwaysFail || attemptNumber <= simulation.failureCount;
  const runtimeResult = forceFailure
    ? {
        success: false,
        statusCode: simulation.statusCode,
        errorMessage: simulation.errorMessage,
        responseBody: null,
      }
    : await dispatchConnectorDelivery({
        connectorTypeRaw: input.delivery.connector_type,
        payload: input.payload,
        config: input.config,
      });

  const failed = !runtimeResult.success;
  const statusCode = runtimeResult.statusCode ?? (failed ? 503 : 200);
  const errorMessage = failed ? runtimeResult.errorMessage ?? "Connector delivery failed" : null;

  const attempt = connectorDeliveryAttemptRecordSchema.parse({
    id: randomUUID(),
    delivery_id: input.delivery.id,
    attempt_number: attemptNumber,
    success: !failed,
    status_code: statusCode,
    error_message: errorMessage,
    response_body: runtimeResult.responseBody,
    created_at: attemptNow,
  });
  input.state.connector_delivery_attempts.unshift(attempt);

  input.delivery.attempt_count = attemptNumber;
  input.delivery.last_status_code = statusCode;
  input.delivery.last_error = errorMessage;
  input.delivery.updated_at = attemptNow;

  appendAuditEvent(input.state, {
    eventType: "connector_delivery_attempted_v2",
    actor: input.actor ?? "system",
    metadata: {
      delivery_id: input.delivery.id,
      project_id: input.delivery.project_id,
      connector_type: input.delivery.connector_type,
      attempt_number: attempt.attempt_number,
      success: attempt.success,
      status_code: attempt.status_code,
    },
  });

  if (!failed) {
    input.delivery.status = "delivered";
    input.delivery.next_attempt_at = null;
    input.delivery.dead_letter_reason = null;
    input.delivery.delivered_at = attemptNow;

    appendAuditEvent(input.state, {
      eventType: "connector_delivered_v2",
      actor: input.actor ?? "system",
      metadata: {
        delivery_id: input.delivery.id,
        attempts: attempt.attempt_number,
        project_id: input.delivery.project_id,
        connector_type: input.delivery.connector_type,
      },
    });

    return attempt;
  }

  if (attemptNumber >= input.delivery.max_attempts) {
    input.delivery.status = "dead_lettered";
    input.delivery.next_attempt_at = null;
    input.delivery.dead_letter_reason = errorMessage ?? "Connector delivery exhausted retries";

    appendAuditEvent(input.state, {
      eventType: "connector_dead_lettered_v2",
      actor: input.actor ?? "system",
      metadata: {
        delivery_id: input.delivery.id,
        attempts: attempt.attempt_number,
        project_id: input.delivery.project_id,
        connector_type: input.delivery.connector_type,
        reason: input.delivery.dead_letter_reason,
      },
    });

    return attempt;
  }

  input.delivery.status = "retrying";
  const backoffMs = computeRetryBackoffMs(input.initialBackoffMs, attemptNumber);
  input.delivery.next_attempt_at = new Date(Date.now() + backoffMs).toISOString();

  return attempt;
}

export async function enqueueConnectorDelivery(input: {
  projectId: string;
  connectorType: string;
  payload: unknown;
  config?: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const { delivery, normalizedType, normalizedIdempotencyKey } = createConnectorDeliveryRecord(input);

    const existing =
      normalizedIdempotencyKey === null
        ? null
        : state.connector_deliveries.find(
            (item) =>
              item.project_id === input.projectId &&
              item.connector_type === normalizedType &&
              item.idempotency_key === normalizedIdempotencyKey,
          ) ?? null;

    if (existing) {
      return {
        delivery: connectorDeliveryRecordSchema.parse(existing),
        attempts: listAttemptsForDelivery(state, existing.id),
        duplicate: true,
      };
    }

    state.connector_deliveries.unshift(delivery);
    await writeConnectorInput({
      deliveryId: delivery.id,
      payload: input.payload,
      config: input.config,
      initialBackoffMs: input.initialBackoffMs,
    });

    appendAuditEvent(state, {
      eventType: "connector_delivery_queued_v2",
      actor: input.actor ?? "system",
      metadata: {
        delivery_id: delivery.id,
        connector_type: delivery.connector_type,
        project_id: delivery.project_id,
      },
    });

    return {
      delivery: connectorDeliveryRecordSchema.parse(delivery),
      attempts: [] as ConnectorDeliveryAttemptRecord[],
      duplicate: false,
    };
  });
}

export async function processConnectorDelivery(input: {
  projectId: string;
  connectorType: string;
  payload: unknown;
  config?: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  actor?: string;
  mode?: "sync" | "enqueue";
}) {
  const queued = await enqueueConnectorDelivery(input);

  if (queued.duplicate || input.mode === "enqueue") {
    return queued;
  }

  const delivery = await processConnectorDeliveryQueue({
    projectId: input.projectId,
    connectorType: input.connectorType,
    limit: 1,
    forceDeliveryIds: [queued.delivery.id],
    actor: input.actor,
    ignoreSchedule: true,
  });

  const first = delivery.deliveries[0];
  if (!first) {
    return queued;
  }

  let iterations = 0;
  while (first.status === "retrying" && first.attempt_count < first.max_attempts && iterations < first.max_attempts) {
    iterations += 1;
    const processed = await processConnectorDeliveryQueue({
      projectId: input.projectId,
      connectorType: input.connectorType,
      limit: 1,
      forceDeliveryIds: [first.id],
      actor: input.actor,
      ignoreSchedule: true,
    });

    if (!processed.deliveries[0] || processed.deliveries[0].status === first.status) {
      break;
    }

    first.status = processed.deliveries[0].status;
    first.attempt_count = processed.deliveries[0].attempt_count;
    first.last_error = processed.deliveries[0].last_error;
  }

  const attempts = await listConnectorDeliveryAttempts(first.id);
  return {
    delivery: first,
    attempts,
    duplicate: false,
  };
}

export async function processConnectorDeliveryQueue(input: {
  projectId: string;
  connectorType: string;
  limit?: number;
  forceDeliveryIds?: string[];
  actor?: string;
  ignoreSchedule?: boolean;
}) {
  return withWriteLock(async (state) => {
    const nowMs = Date.now();
    const normalizedType = input.connectorType.trim().toLowerCase();
    const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
    const forcedIdSet = new Set(input.forceDeliveryIds ?? []);

    const candidates = state.connector_deliveries
      .filter((delivery) => {
        if (delivery.project_id !== input.projectId || delivery.connector_type !== normalizedType) {
          return false;
        }
        if (forcedIdSet.size > 0) {
          return forcedIdSet.has(delivery.id);
        }
        if (input.ignoreSchedule) {
          return delivery.status === "queued" || delivery.status === "retrying";
        }
        return isConnectorDeliveryDue({
          status: delivery.status as ConnectorDeliveryStatus,
          nextAttemptAt: delivery.next_attempt_at,
          nowMs,
        });
      })
      .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at))
      .slice(0, limit);

    const processed: ConnectorDeliveryRecord[] = [];

    for (const delivery of candidates) {
      const connectorInput = await readConnectorInput(delivery.id);
      if (!connectorInput) {
        delivery.status = "dead_lettered";
        delivery.dead_letter_reason = "Connector input missing";
        delivery.next_attempt_at = null;
        delivery.updated_at = new Date().toISOString();
        processed.push(connectorDeliveryRecordSchema.parse(delivery));
        continue;
      }

      const initialBackoffMs = Math.max(100, Math.min(connectorInput.initialBackoffMs ?? 500, 60_000));
      await executeConnectorAttempt({
        state,
        delivery,
        payload: connectorInput.payload,
        config: connectorInput.config,
        initialBackoffMs,
        actor: input.actor,
      });
      processed.push(connectorDeliveryRecordSchema.parse(delivery));
    }

    return {
      processed_count: processed.length,
      deliveries: processed,
    };
  });
}

export async function getConnectorDelivery(deliveryId: string) {
  const state = await readState();
  return state.connector_deliveries.find((delivery) => delivery.id === deliveryId) ?? null;
}

export async function redriveConnectorDelivery(input: {
  deliveryId: string;
  projectId: string;
  connectorType: string;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const normalizedType = input.connectorType.trim().toLowerCase();
    const delivery = state.connector_deliveries.find((item) => item.id === input.deliveryId) ?? null;

    if (!delivery || delivery.project_id !== input.projectId || delivery.connector_type !== normalizedType) {
      return null;
    }

    if (delivery.status !== "dead_lettered") {
      return connectorDeliveryRecordSchema.parse(delivery);
    }

    Object.assign(delivery, connectorRedriveResetFields(new Date().toISOString()));

    appendAuditEvent(state, {
      eventType: "connector_delivery_queued_v2",
      actor: input.actor ?? "system",
      metadata: {
        delivery_id: delivery.id,
        connector_type: delivery.connector_type,
        project_id: delivery.project_id,
        redrive: true,
      },
    });

    return connectorDeliveryRecordSchema.parse(delivery);
  });
}

export async function redriveConnectorDeliveryBatch(input: {
  projectId: string;
  connectorType: string;
  limit?: number;
  minDeadLetterMinutes?: number;
  actor?: string;
}) {
  return withWriteLock(async (state) => {
    const normalizedType = input.connectorType.trim().toLowerCase();
    const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
    const nowMs = Date.now();

    const redriven = state.connector_deliveries
      .filter((delivery) => {
        if (delivery.project_id !== input.projectId || delivery.connector_type !== normalizedType) {
          return false;
        }

        return isConnectorDeadLetterEligibleForRedrive({
          status: delivery.status as ConnectorDeliveryStatus,
          updatedAt: delivery.updated_at,
          minDeadLetterMinutes: input.minDeadLetterMinutes,
          nowMs,
        });
      })
      .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at))
      .slice(0, limit);

    const redriveNow = new Date(nowMs).toISOString();

    for (const delivery of redriven) {
      Object.assign(delivery, connectorRedriveResetFields(redriveNow));

      appendAuditEvent(state, {
        eventType: "connector_delivery_queued_v2",
        actor: input.actor ?? "system",
        metadata: {
          delivery_id: delivery.id,
          connector_type: delivery.connector_type,
          project_id: delivery.project_id,
          redrive: true,
          batch: true,
        },
      });
    }

    return {
      redriven_count: redriven.length,
      deliveries: redriven.map((delivery) => connectorDeliveryRecordSchema.parse(delivery)),
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

export async function summarizeConnectorDeliveries(input: {
  projectId: string;
  connectorType?: string;
}) {
  const state = await readState();
  const normalizedType = input.connectorType?.trim().toLowerCase();
  const nowMs = Date.now();
  let earliestNextAttemptAt: string | null = null;

  const summary = {
    total: 0,
    queued: 0,
    retrying: 0,
    delivered: 0,
    dead_lettered: 0,
    due_now: 0,
  };

  for (const delivery of state.connector_deliveries) {
    if (delivery.project_id !== input.projectId) {
      continue;
    }
    if (normalizedType && delivery.connector_type !== normalizedType) {
      continue;
    }

    summary.total += 1;
    if (delivery.status === "queued") {
      summary.queued += 1;
    } else if (delivery.status === "retrying") {
      summary.retrying += 1;
    } else if (delivery.status === "delivered") {
      summary.delivered += 1;
    } else if (delivery.status === "dead_lettered") {
      summary.dead_lettered += 1;
    }

    if (
      isConnectorDeliveryDue({
        status: delivery.status as ConnectorDeliveryStatus,
        nextAttemptAt: delivery.next_attempt_at,
        nowMs,
      })
    ) {
      summary.due_now += 1;
    }

    if (delivery.status === "retrying" && delivery.next_attempt_at) {
      if (!earliestNextAttemptAt || Date.parse(delivery.next_attempt_at) < Date.parse(earliestNextAttemptAt)) {
        earliestNextAttemptAt = delivery.next_attempt_at;
      }
    }
  }

  return {
    ...summary,
    earliest_next_attempt_at: earliestNextAttemptAt,
  };
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

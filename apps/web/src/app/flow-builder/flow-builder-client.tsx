/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { FlowGraph, FlowNodeType } from "@flowstate/types";

import { selectTopCandidateRunIds } from "@/lib/v2/eval-pack";

type Organization = {
  id: string;
  name: string;
  slug: string;
};

type Project = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type Flow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  is_active: boolean;
};

type FlowVersion = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: FlowGraph;
  created_at: string;
};

type FlowDeployment = {
  id: string;
  flow_id: string;
  flow_version_id: string;
  deployment_key: string;
  is_active: boolean;
  created_at: string;
};

type Dataset = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type DatasetVersion = {
  id: string;
  dataset_id: string;
  version_number: number;
  item_count: number;
  file_name: string;
  created_at: string;
};

type RunRecordV2 = {
  id: string;
  project_id: string;
  flow_id: string;
  flow_version_id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
};

type ReviewDecisionValue = "correct" | "incorrect" | "missing" | "uncertain";
type FailureReasonCode =
  | "missing_field"
  | "math_mismatch"
  | "hallucinated_entity"
  | "wrong_currency"
  | "wrong_date"
  | "wrong_class"
  | "other";

type ReviewDecisionRecord = {
  id: string;
  project_id: string;
  run_id: string;
  field_name: string;
  decision: ReviewDecisionValue;
  failure_reason: FailureReasonCode | null;
  reviewer: string | null;
  notes: string | null;
  created_at: string;
};

type EvidenceRegionRecord = {
  id: string;
  review_decision_id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: string;
};

type DraftEvidenceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ConnectorDelivery = {
  id: string;
  connector_type: string;
  idempotency_key: string | null;
  status: "queued" | "retrying" | "delivered" | "dead_lettered";
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  dead_letter_reason: string | null;
  updated_at: string;
};

type ConnectorDeliverySummary = {
  total: number;
  queued: number;
  retrying: number;
  delivered: number;
  dead_lettered: number;
  due_now: number;
  earliest_next_attempt_at: string | null;
};

type ReviewDecisionSummary = {
  total: number;
  by_decision: Record<ReviewDecisionValue, number>;
  error_rate: number;
  failure_hotspots: Array<{ reason: FailureReasonCode; count: number }>;
  field_hotspots: Array<{ field_name: string; total: number; non_correct: number }>;
  reviewer_activity: Array<{ reviewer: string; count: number }>;
};

type ReviewQueueHealth = "unreviewed" | "at_risk" | "stale" | "healthy";

type ReviewQueueOpsItem = {
  run_id: string;
  run_status: RunRecordV2["status"];
  decisions_total: number;
  non_correct_count: number;
  evidence_count: number;
  error_rate: number;
  last_reviewed_at: string | null;
  health: ReviewQueueHealth;
};

type ReviewQueueOpsSummary = {
  total_queues: number;
  unreviewed_queues: number;
  at_risk_queues: number;
  stale_queues: number;
  healthy_queues: number;
  total_decisions: number;
  total_evidence_regions: number;
  avg_error_rate: number;
};

type ActiveLearningCandidate = {
  run: RunRecordV2;
  score: number;
  incorrect_count: number;
  uncertain_count: number;
  avg_latency_ms: number;
  cost_usd: number;
};

type EvalPack = {
  id: string;
  project_id: string;
  name: string;
  candidate_run_ids: string[];
  created_at: string;
};

type ProjectMemberRole = "owner" | "admin" | "builder" | "reviewer" | "viewer";

type ApiKeyScope =
  | "manage_projects"
  | "manage_members"
  | "manage_keys"
  | "create_flow"
  | "deploy_flow"
  | "run_flow"
  | "review_queue"
  | "read_project";

type ProjectMember = {
  id: string;
  project_id: string;
  user_email: string;
  role: ProjectMemberRole;
  updated_at: string;
};

type ApiKeyRecord = {
  id: string;
  project_id: string;
  name: string;
  role: ProjectMemberRole;
  scopes: ApiKeyScope[];
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

type GraphNodeDraft = {
  id: string;
  type: FlowNodeType;
  label: string;
  configText: string;
};

type GraphEdgeDraft = {
  id: string;
  source: string;
  target: string;
  condition: string;
};

const NODE_TYPES: FlowNodeType[] = [
  "source_upload",
  "source_webhook",
  "source_folder",
  "source_rtsp",
  "extract",
  "validate",
  "dedupe",
  "redact",
  "classify",
  "route",
  "human_review",
  "sink_webhook",
  "sink_slack",
  "sink_jira",
  "sink_sqs",
  "sink_db",
];

const ROLE_OPTIONS: ProjectMemberRole[] = ["owner", "admin", "builder", "reviewer", "viewer"];

const API_KEY_SCOPES: ApiKeyScope[] = [
  "manage_projects",
  "manage_members",
  "manage_keys",
  "create_flow",
  "deploy_flow",
  "run_flow",
  "review_queue",
  "read_project",
];

const REVIEW_DECISION_OPTIONS: ReviewDecisionValue[] = ["incorrect", "missing", "uncertain", "correct"];
const FAILURE_REASON_OPTIONS: FailureReasonCode[] = [
  "missing_field",
  "math_mismatch",
  "hallucinated_entity",
  "wrong_currency",
  "wrong_date",
  "wrong_class",
  "other",
];

const EMPTY_CONNECTOR_SUMMARY: ConnectorDeliverySummary = {
  total: 0,
  queued: 0,
  retrying: 0,
  delivered: 0,
  dead_lettered: 0,
  due_now: 0,
  earliest_next_attempt_at: null,
};

const EMPTY_REVIEW_SUMMARY: ReviewDecisionSummary = {
  total: 0,
  by_decision: {
    correct: 0,
    incorrect: 0,
    missing: 0,
    uncertain: 0,
  },
  error_rate: 0,
  failure_hotspots: [],
  field_hotspots: [],
  reviewer_activity: [],
};

const EMPTY_REVIEW_QUEUE_SUMMARY: ReviewQueueOpsSummary = {
  total_queues: 0,
  unreviewed_queues: 0,
  at_risk_queues: 0,
  stale_queues: 0,
  healthy_queues: 0,
  total_decisions: 0,
  total_evidence_regions: 0,
  avg_error_rate: 0,
};

const TEMPLATE_GRAPH: { name: string; graph: FlowGraph } = {
  name: "Document Intake",
  graph: {
    nodes: [
      { id: "src_webhook", type: "source_webhook", label: "Inbound Webhook", config: {} },
      { id: "extract", type: "extract", label: "Extract Fields", config: { fields: ["vendor", "date", "total"] } },
      { id: "validate", type: "validate", label: "Validate Required Fields", config: { required: ["vendor", "total"] } },
      { id: "route", type: "route", label: "Route Decisions", config: { rules: ["valid", "needs_review"] } },
      { id: "human", type: "human_review", label: "Human Review", config: {} },
      { id: "sink", type: "sink_webhook", label: "Webhook Sink", config: { destination: "https://example.com/hook" } },
    ],
    edges: [
      { id: "e1", source: "src_webhook", target: "extract", condition: null },
      { id: "e2", source: "extract", target: "validate", condition: null },
      { id: "e3", source: "validate", target: "route", condition: null },
      { id: "e4", source: "route", target: "sink", condition: "valid" },
      { id: "e5", source: "route", target: "human", condition: "needs_review" },
      { id: "e6", source: "human", target: "sink", condition: "approved" },
    ],
  },
};

function makeId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${random}`;
}

function isSourceNode(type: FlowNodeType) {
  return type.startsWith("source_");
}

function isSinkNode(type: FlowNodeType) {
  return type.startsWith("sink_");
}

function normalizeNodeId(raw: string, fallbackType: FlowNodeType) {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || makeId(fallbackType);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): DraftEvidenceRegion {
  const left = clamp01(Math.min(start.x, end.x));
  const top = clamp01(Math.min(start.y, end.y));
  const right = clamp01(Math.max(start.x, end.x));
  const bottom = clamp01(Math.max(start.y, end.y));

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function connectorConfigTemplate(type: string) {
  const normalized = type.trim().toLowerCase();

  if (normalized === "slack" || normalized === "slack_webhook") {
    return JSON.stringify(
      {
        webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXX",
      },
      null,
      2,
    );
  }

  if (normalized === "jira" || normalized === "jira_issue") {
    return JSON.stringify(
      {
        baseUrl: "https://your-company.atlassian.net",
        email: "ops@company.com",
        apiToken: "jira_api_token",
        projectKey: "OPS",
        issueType: "Task",
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      targetUrl: "https://example.com/webhook",
      headers: {
        Authorization: "Bearer <token>",
      },
    },
    null,
    2,
  );
}

function toDraftGraph(graph: FlowGraph): { nodes: GraphNodeDraft[]; edges: GraphEdgeDraft[] } {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      configText: JSON.stringify(node.config ?? {}, null, 2),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: edge.condition ?? "",
    })),
  };
}

function validateGraph(nodes: GraphNodeDraft[], edges: GraphEdgeDraft[]) {
  const errors: string[] = [];
  const nodeIdSet = new Set<string>();
  const parsedNodes: FlowGraph["nodes"] = [];

  if (nodes.length === 0) {
    errors.push("Add at least one node.");
    return { errors, graph: null };
  }

  for (const node of nodes) {
    const normalizedId = normalizeNodeId(node.id, node.type);
    if (nodeIdSet.has(normalizedId)) {
      errors.push(`Duplicate node id: ${normalizedId}`);
      continue;
    }

    nodeIdSet.add(normalizedId);

    let parsedConfig: unknown = {};
    if (node.configText.trim()) {
      try {
        parsedConfig = JSON.parse(node.configText);
      } catch {
        errors.push(`Invalid JSON config for node "${node.label || normalizedId}"`);
      }
    }

    parsedNodes.push({
      id: normalizedId,
      type: node.type,
      label: node.label.trim() || normalizedId,
      config: parsedConfig,
    });
  }

  const sourceCount = parsedNodes.filter((node) => isSourceNode(node.type)).length;
  const sinkCount = parsedNodes.filter((node) => isSinkNode(node.type)).length;

  if (sourceCount < 1) {
    errors.push("Flow requires at least one source node.");
  }
  if (sinkCount < 1) {
    errors.push("Flow requires at least one sink node.");
  }

  const parsedEdges: FlowGraph["edges"] = [];
  const edgeIdSet = new Set<string>();
  const adjacency = new Map<string, string[]>();

  for (const node of parsedNodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    const edgeId = edge.id.trim() || makeId("edge");
    if (edgeIdSet.has(edgeId)) {
      errors.push(`Duplicate edge id: ${edgeId}`);
      continue;
    }
    edgeIdSet.add(edgeId);

    const source = normalizeNodeId(edge.source, "route");
    const target = normalizeNodeId(edge.target, "route");

    if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
      errors.push(`Edge "${edgeId}" references unknown nodes.`);
      continue;
    }

    if (source === target) {
      errors.push(`Edge "${edgeId}" cannot self-reference node "${source}".`);
      continue;
    }

    adjacency.get(source)?.push(target);

    parsedEdges.push({
      id: edgeId,
      source,
      target,
      condition: edge.condition.trim() ? edge.condition.trim() : null,
    });
  }

  const colors = new Map<string, 0 | 1 | 2>();
  let hasCycle = false;

  const walk = (nodeId: string) => {
    if (hasCycle) {
      return;
    }

    colors.set(nodeId, 1);
    for (const next of adjacency.get(nodeId) ?? []) {
      const color = colors.get(next) ?? 0;
      if (color === 0) {
        walk(next);
      } else if (color === 1) {
        hasCycle = true;
        return;
      }
    }
    colors.set(nodeId, 2);
  };

  for (const node of parsedNodes) {
    if ((colors.get(node.id) ?? 0) === 0) {
      walk(node.id);
    }
  }

  if (hasCycle) {
    errors.push("Flow graph must be acyclic.");
  }

  if (errors.length > 0) {
    return { errors, graph: null };
  }

  return {
    errors: [],
    graph: {
      nodes: parsedNodes,
      edges: parsedEdges,
    } satisfies FlowGraph,
  };
}

export function FlowBuilderClient() {
  const [apiKey, setApiKey] = useState("");
  const [actorEmail, setActorEmail] = useState("local@flowstate.dev");
  const [actorRole, setActorRole] = useState<ProjectMemberRole>("owner");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [deployments, setDeployments] = useState<FlowDeployment[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersion[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedDeploymentKey, setSelectedDeploymentKey] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedDatasetVersionId, setSelectedDatasetVersionId] = useState("");
  const [baselineVersionId, setBaselineVersionId] = useState("");

  const [newProjectName, setNewProjectName] = useState("Ops Project");
  const [newProjectDescription, setNewProjectDescription] = useState("Flowstate v2 control plane project");
  const [newFlowName, setNewFlowName] = useState("Document Intake Flow");
  const [newFlowDescription, setNewFlowDescription] = useState("Extract, validate, and route documents.");
  const [newDatasetName, setNewDatasetName] = useState("Intake Dataset");
  const [newDatasetDescription, setNewDatasetDescription] = useState("Versioned replay/eval source data.");
  const [newMemberEmail, setNewMemberEmail] = useState("reviewer@flowstate.dev");
  const [newMemberRole, setNewMemberRole] = useState<ProjectMemberRole>("reviewer");
  const [newKeyName, setNewKeyName] = useState("builder-key");
  const [newKeyRole, setNewKeyRole] = useState<ProjectMemberRole>("builder");
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>(["read_project", "create_flow", "deploy_flow", "run_flow"]);
  const [issuedApiToken, setIssuedApiToken] = useState("");

  const [nodes, setNodes] = useState<GraphNodeDraft[]>([]);
  const [edges, setEdges] = useState<GraphEdgeDraft[]>([]);
  const [graphErrors, setGraphErrors] = useState<string[]>([]);

  const [testPayloadText, setTestPayloadText] = useState('{"vendor":"Acme","date":"2026-02-17","total":42.12}');
  const [testResult, setTestResult] = useState<string>("");
  const [datasetLinesText, setDatasetLinesText] = useState(
    '{"vendor":"Acme","total":42.12,"expected":{"vendor":"Acme","total":42.12}}\n{"vendor":"Globex","total":18.5,"expected":{"vendor":"Globex","total":18.5}}',
  );
  const [replayLimit, setReplayLimit] = useState("20");
  const [promotionMinCandidateSuccess, setPromotionMinCandidateSuccess] = useState("0.95");
  const [promotionMaxChangedVsBaseline, setPromotionMaxChangedVsBaseline] = useState("0.1");
  const [promotionMinFieldAccuracy, setPromotionMinFieldAccuracy] = useState("0.9");
  const [promotionMinExpectedSamples, setPromotionMinExpectedSamples] = useState("10");
  const [replayResult, setReplayResult] = useState<string>("");
  const [connectorType, setConnectorType] = useState("webhook");
  const [connectorMode, setConnectorMode] = useState<"sync" | "enqueue">("sync");
  const [connectorPayloadText, setConnectorPayloadText] = useState('{"event":"ticket.created","severity":"high"}');
  const [connectorConfigText, setConnectorConfigText] = useState(connectorConfigTemplate("webhook"));
  const [connectorIdempotencyKey, setConnectorIdempotencyKey] = useState("");
  const [connectorMaxAttempts, setConnectorMaxAttempts] = useState("3");
  const [connectorProcessLimit, setConnectorProcessLimit] = useState("10");
  const [connectorResult, setConnectorResult] = useState("");
  const [connectorDeliveries, setConnectorDeliveries] = useState<ConnectorDelivery[]>([]);
  const [connectorSummary, setConnectorSummary] = useState<ConnectorDeliverySummary>(EMPTY_CONNECTOR_SUMMARY);
  const [runs, setRuns] = useState<RunRecordV2[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewDecisionSummary>(EMPTY_REVIEW_SUMMARY);
  const [reviewQueues, setReviewQueues] = useState<ReviewQueueOpsItem[]>([]);
  const [reviewQueueSummary, setReviewQueueSummary] = useState<ReviewQueueOpsSummary>(EMPTY_REVIEW_QUEUE_SUMMARY);
  const [reviewStaleHours, setReviewStaleHours] = useState("24");
  const [selectedReviewDecisionId, setSelectedReviewDecisionId] = useState("");
  const [newReviewFieldName, setNewReviewFieldName] = useState("total");
  const [newReviewDecision, setNewReviewDecision] = useState<ReviewDecisionValue>("incorrect");
  const [newReviewFailureReason, setNewReviewFailureReason] = useState<FailureReasonCode>("math_mismatch");
  const [newReviewNotes, setNewReviewNotes] = useState("");
  const [evidenceRegions, setEvidenceRegions] = useState<EvidenceRegionRecord[]>([]);
  const [evidencePage, setEvidencePage] = useState("0");
  const [evidencePreviewUrl, setEvidencePreviewUrl] = useState("https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?q=80&w=1400&auto=format&fit=crop");
  const [draftEvidence, setDraftEvidence] = useState<DraftEvidenceRegion | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [activeLearningCandidates, setActiveLearningCandidates] = useState<ActiveLearningCandidate[]>([]);
  const [evalPacks, setEvalPacks] = useState<EvalPack[]>([]);
  const [newEvalPackName, setNewEvalPackName] = useState("Priority Eval Pack");
  const [evalPackCandidateCount, setEvalPackCandidateCount] = useState("10");

  function setInfo(message: string) {
    setStatusTone("info");
    setStatusMessage(message);
  }

  function setSuccess(message: string) {
    setStatusTone("success");
    setStatusMessage(message);
  }

  function setError(message: string) {
    setStatusTone("error");
    setStatusMessage(message);
  }

  const authHeaders = useCallback(
    (withJson: boolean) => {
      const headers: Record<string, string> = {};

      if (apiKey.trim()) {
        headers.authorization = `Bearer ${apiKey.trim()}`;
      } else {
        headers["x-flowstate-actor-email"] = actorEmail.trim() || "local@flowstate.dev";
        headers["x-flowstate-actor-role"] = actorRole;
      }

      if (withJson) {
        headers["content-type"] = "application/json";
      }

      return headers;
    },
    [actorEmail, actorRole, apiKey],
  );

  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  );

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const selectedReviewDecision = useMemo(
    () => reviewDecisions.find((decision) => decision.id === selectedReviewDecisionId) ?? null,
    [reviewDecisions, selectedReviewDecisionId],
  );

  const selectedEvidencePage = useMemo(() => {
    const parsed = Number(evidencePage);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.floor(parsed);
  }, [evidencePage]);

  const visibleEvidenceRegions = useMemo(
    () => evidenceRegions.filter((item) => item.page === selectedEvidencePage),
    [evidenceRegions, selectedEvidencePage],
  );

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", {
      cache: "no-store",
      headers: authHeaders(false),
    });
    const payload = (await response.json()) as { organizations?: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [authHeaders, selectedOrganizationId]);

  const loadProjects = useCallback(
    async (organizationId: string) => {
      const query = `/api/v2/projects?organizationId=${encodeURIComponent(organizationId)}`;
      const response = await fetch(query, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { projects?: Project[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load projects.");
        setProjects([]);
        return;
      }

      const nextProjects = payload.projects ?? [];
      setProjects(nextProjects);

      if (!nextProjects.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId(nextProjects[0]?.id ?? "");
      }
    },
    [authHeaders, selectedProjectId],
  );

  const loadFlows = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setFlows([]);
        setSelectedFlowId("");
        return;
      }

      const response = await fetch(`/api/v2/flows?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { flows?: Flow[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load flows.");
        setFlows([]);
        return;
      }

      const nextFlows = payload.flows ?? [];
      setFlows(nextFlows);

      if (!nextFlows.some((flow) => flow.id === selectedFlowId)) {
        setSelectedFlowId(nextFlows[0]?.id ?? "");
      }
    },
    [authHeaders, selectedFlowId],
  );

  const loadDatasets = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setDatasets([]);
        setSelectedDatasetId("");
        return;
      }

      const response = await fetch(`/api/v2/datasets?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { datasets?: Dataset[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load datasets.");
        setDatasets([]);
        return;
      }

      const nextDatasets = payload.datasets ?? [];
      setDatasets(nextDatasets);

      if (!nextDatasets.some((dataset) => dataset.id === selectedDatasetId)) {
        setSelectedDatasetId(nextDatasets[0]?.id ?? "");
      }
    },
    [authHeaders, selectedDatasetId],
  );

  const loadRuns = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setRuns([]);
        setSelectedRunId("");
        return;
      }

      const response = await fetch(`/api/v2/runs?projectId=${encodeURIComponent(projectId)}&limit=50`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { runs?: RunRecordV2[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load runs.");
        setRuns([]);
        return;
      }

      const nextRuns = payload.runs ?? [];
      setRuns(nextRuns);
      if (!nextRuns.some((run) => run.id === selectedRunId)) {
        setSelectedRunId(nextRuns[0]?.id ?? "");
      }
    },
    [authHeaders, selectedRunId],
  );

  const loadReviewQueues = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setReviewQueues([]);
        setReviewQueueSummary(EMPTY_REVIEW_QUEUE_SUMMARY);
        return;
      }

      const parsedStaleHours = Number(reviewStaleHours);
      const staleHours =
        Number.isFinite(parsedStaleHours) && parsedStaleHours > 0 ? Math.min(Math.floor(parsedStaleHours), 24 * 30) : 24;

      const query = new URLSearchParams({
        projectId,
        limit: "50",
        staleHours: String(staleHours),
      });

      const response = await fetch(`/api/v2/reviews/queues?${query.toString()}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as {
        queues?: ReviewQueueOpsItem[];
        summary?: ReviewQueueOpsSummary;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error || "Unable to load review queue summary.");
        setReviewQueues([]);
        setReviewQueueSummary(EMPTY_REVIEW_QUEUE_SUMMARY);
        return;
      }

      setReviewQueues(payload.queues ?? []);
      setReviewQueueSummary(payload.summary ?? EMPTY_REVIEW_QUEUE_SUMMARY);
    },
    [authHeaders, reviewStaleHours],
  );

  const loadActiveLearning = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setActiveLearningCandidates([]);
        setEvalPacks([]);
        return;
      }

      const [candidatesResponse, packsResponse] = await Promise.all([
        fetch(`/api/v2/active-learning/candidates?projectId=${encodeURIComponent(projectId)}&limit=50`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
        fetch(`/api/v2/active-learning/eval-packs?projectId=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
      ]);

      const candidatesPayload = (await candidatesResponse.json()) as {
        candidates?: ActiveLearningCandidate[];
        error?: string;
      };
      const packsPayload = (await packsResponse.json()) as { packs?: EvalPack[]; error?: string };

      if (!candidatesResponse.ok) {
        setError(candidatesPayload.error || "Unable to load active learning candidates.");
        setActiveLearningCandidates([]);
      } else {
        setActiveLearningCandidates(candidatesPayload.candidates ?? []);
      }

      if (!packsResponse.ok) {
        setError(packsPayload.error || "Unable to load eval packs.");
        setEvalPacks([]);
      } else {
        setEvalPacks(packsPayload.packs ?? []);
      }
    },
    [authHeaders],
  );

  const loadReviewDecisions = useCallback(
    async (runId: string) => {
      if (!runId) {
        setReviewDecisions([]);
        setReviewSummary(EMPTY_REVIEW_SUMMARY);
        setSelectedReviewDecisionId("");
        return;
      }

      const response = await fetch(`/api/v2/reviews/${runId}/decisions`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as {
        decisions?: ReviewDecisionRecord[];
        summary?: ReviewDecisionSummary;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error || "Unable to load review decisions.");
        setReviewDecisions([]);
        setReviewSummary(EMPTY_REVIEW_SUMMARY);
        return;
      }

      const nextDecisions = payload.decisions ?? [];
      setReviewDecisions(nextDecisions);
      setReviewSummary(payload.summary ?? EMPTY_REVIEW_SUMMARY);
      if (!nextDecisions.some((decision) => decision.id === selectedReviewDecisionId)) {
        setSelectedReviewDecisionId(nextDecisions[0]?.id ?? "");
      }
    },
    [authHeaders, selectedReviewDecisionId],
  );

  const loadEvidenceRegions = useCallback(
    async (runId: string, reviewDecisionId: string) => {
      if (!runId || !reviewDecisionId || !selectedProjectId) {
        setEvidenceRegions([]);
        return;
      }

      const query = new URLSearchParams({
        projectId: selectedProjectId,
        reviewDecisionId,
      });

      const response = await fetch(`/api/v2/reviews/${runId}/evidence?${query.toString()}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { evidence?: EvidenceRegionRecord[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load evidence regions.");
        setEvidenceRegions([]);
        return;
      }

      setEvidenceRegions(payload.evidence ?? []);
    },
    [authHeaders, selectedProjectId],
  );

  const loadDatasetVersions = useCallback(
    async (datasetId: string) => {
      if (!datasetId) {
        setDatasetVersions([]);
        setSelectedDatasetVersionId("");
        return;
      }

      const response = await fetch(`/api/v2/datasets/${datasetId}/versions`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { versions?: DatasetVersion[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load dataset versions.");
        setDatasetVersions([]);
        return;
      }

      const nextVersions = payload.versions ?? [];
      setDatasetVersions(nextVersions);

      if (!nextVersions.some((version) => version.id === selectedDatasetVersionId)) {
        setSelectedDatasetVersionId(nextVersions[0]?.id ?? "");
      }
    },
    [authHeaders, selectedDatasetVersionId],
  );

  const loadMembersAndKeys = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setMembers([]);
        setApiKeys([]);
        return;
      }

      const [membersResponse, keysResponse] = await Promise.all([
        fetch(`/api/v2/projects/${projectId}/members`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
        fetch(`/api/v2/projects/${projectId}/keys`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
      ]);

      const membersPayload = (await membersResponse.json()) as { members?: ProjectMember[]; error?: string };
      const keysPayload = (await keysResponse.json()) as { keys?: ApiKeyRecord[]; error?: string };

      if (!membersResponse.ok) {
        setError(membersPayload.error || "Unable to load project members.");
        setMembers([]);
      } else {
        setMembers(membersPayload.members ?? []);
      }

      if (!keysResponse.ok) {
        setError(keysPayload.error || "Unable to load API keys.");
        setApiKeys([]);
      } else {
        setApiKeys(keysPayload.keys ?? []);
      }
    },
    [authHeaders],
  );

  const loadVersionsAndDeployments = useCallback(
    async (flowId: string) => {
      if (!flowId) {
        setVersions([]);
        setDeployments([]);
        setSelectedVersionId("");
        setSelectedDeploymentKey("");
        return;
      }

      const [versionsResponse, deploymentsResponse] = await Promise.all([
        fetch(`/api/v2/flows/${flowId}/versions`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
        fetch(`/api/v2/flows/${flowId}/deploy`, {
          cache: "no-store",
          headers: authHeaders(false),
        }),
      ]);

      const versionsPayload = (await versionsResponse.json()) as { versions?: FlowVersion[]; error?: string };
      const deploymentsPayload = (await deploymentsResponse.json()) as {
        deployments?: FlowDeployment[];
        error?: string;
      };

      if (!versionsResponse.ok) {
        setError(versionsPayload.error || "Unable to load versions.");
        setVersions([]);
      } else {
        const nextVersions = versionsPayload.versions ?? [];
        setVersions(nextVersions);
        if (!nextVersions.some((version) => version.id === selectedVersionId)) {
          setSelectedVersionId(nextVersions[0]?.id ?? "");
        }
      }

      if (!deploymentsResponse.ok) {
        setError(deploymentsPayload.error || "Unable to load deployments.");
        setDeployments([]);
      } else {
        const nextDeployments = deploymentsPayload.deployments ?? [];
        setDeployments(nextDeployments);
        if (!nextDeployments.some((deployment) => deployment.deployment_key === selectedDeploymentKey)) {
          setSelectedDeploymentKey(nextDeployments[0]?.deployment_key ?? "");
        }
      }
    },
    [authHeaders, selectedDeploymentKey, selectedVersionId],
  );

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (!selectedOrganizationId) {
      setProjects([]);
      setSelectedProjectId("");
      return;
    }
    void loadProjects(selectedOrganizationId);
  }, [loadProjects, selectedOrganizationId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setFlows([]);
      setSelectedFlowId("");
      setDatasets([]);
      setSelectedDatasetId("");
      setRuns([]);
      setSelectedRunId("");
      setReviewQueues([]);
      setReviewQueueSummary(EMPTY_REVIEW_QUEUE_SUMMARY);
      setReviewDecisions([]);
      setSelectedReviewDecisionId("");
      setEvidenceRegions([]);
      setActiveLearningCandidates([]);
      setEvalPacks([]);
      setMembers([]);
      setApiKeys([]);
      return;
    }
    void loadFlows(selectedProjectId);
    void loadDatasets(selectedProjectId);
    void loadRuns(selectedProjectId);
    void loadReviewQueues(selectedProjectId);
    void loadActiveLearning(selectedProjectId);
    void loadMembersAndKeys(selectedProjectId);
  }, [loadActiveLearning, loadDatasets, loadFlows, loadMembersAndKeys, loadReviewQueues, loadRuns, selectedProjectId]);

  useEffect(() => {
    void loadDatasetVersions(selectedDatasetId);
  }, [loadDatasetVersions, selectedDatasetId]);

  useEffect(() => {
    void loadReviewDecisions(selectedRunId);
    setDraftEvidence(null);
  }, [loadReviewDecisions, selectedRunId]);

  useEffect(() => {
    void loadEvidenceRegions(selectedRunId, selectedReviewDecisionId);
    setDraftEvidence(null);
  }, [loadEvidenceRegions, selectedReviewDecisionId, selectedRunId]);

  useEffect(() => {
    if (!versions.some((version) => version.id === baselineVersionId)) {
      setBaselineVersionId("");
    }
  }, [baselineVersionId, versions]);

  useEffect(() => {
    void loadVersionsAndDeployments(selectedFlowId);
  }, [loadVersionsAndDeployments, selectedFlowId]);

  function applyTemplate() {
    const draft = toDraftGraph(TEMPLATE_GRAPH.graph);
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setGraphErrors([]);
    setInfo(`Loaded template: ${TEMPLATE_GRAPH.name}`);
  }

  function addNode(type: FlowNodeType) {
    const nodeId = makeId(type.replace("source_", "src").replace("sink_", "out"));
    setNodes((current) => [
      ...current,
      {
        id: nodeId,
        type,
        label: type.replace(/_/g, " "),
        configText: "{}",
      },
    ]);
  }

  function removeNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }

  function addEdge() {
    const firstNode = nodes[0];
    const secondNode = nodes[1];

    if (!firstNode || !secondNode) {
      setError("Add at least two nodes before connecting edges.");
      return;
    }

    setEdges((current) => [
      ...current,
      {
        id: makeId("edge"),
        source: firstNode.id,
        target: secondNode.id,
        condition: "",
      },
    ]);
  }

  function loadVersionIntoEditor() {
    if (!selectedVersion) {
      setError("Select a flow version to load.");
      return;
    }

    const draft = toDraftGraph(selectedVersion.graph);
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setGraphErrors([]);
    setInfo(`Loaded flow version v${selectedVersion.version_number} into editor.`);
  }

  async function createProject() {
    if (!selectedOrganizationId || !newProjectName.trim()) {
      setError("Pick an organization and enter a project name.");
      return;
    }

    setBusyAction("create_project");
    const response = await fetch("/api/v2/projects", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        organizationId: selectedOrganizationId,
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as { project?: Project; error?: string };

    if (!response.ok || !payload.project) {
      setError(payload.error || "Failed to create project.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Project created: ${payload.project.name}`);
    await loadProjects(selectedOrganizationId);
    setSelectedProjectId(payload.project.id);
    setBusyAction(null);
  }

  async function createFlow() {
    if (!selectedProjectId || !newFlowName.trim()) {
      setError("Pick a project and enter a flow name.");
      return;
    }

    setBusyAction("create_flow");
    const response = await fetch("/api/v2/flows", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        name: newFlowName.trim(),
        description: newFlowDescription.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as { flow?: Flow; error?: string };

    if (!response.ok || !payload.flow) {
      setError(payload.error || "Failed to create flow.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Flow created: ${payload.flow.name}`);
    await loadFlows(selectedProjectId);
    setSelectedFlowId(payload.flow.id);
    setBusyAction(null);
  }

  async function createDataset() {
    if (!selectedProjectId || !newDatasetName.trim()) {
      setError("Pick a project and enter a dataset name.");
      return;
    }

    setBusyAction("create_dataset");
    const response = await fetch("/api/v2/datasets", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        name: newDatasetName.trim(),
        description: newDatasetDescription.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as { dataset?: Dataset; error?: string };

    if (!response.ok || !payload.dataset) {
      setError(payload.error || "Failed to create dataset.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Dataset created: ${payload.dataset.name}`);
    await loadDatasets(selectedProjectId);
    setSelectedDatasetId(payload.dataset.id);
    setBusyAction(null);
  }

  async function createDatasetVersion() {
    if (!selectedDatasetId) {
      setError("Select a dataset first.");
      return;
    }

    const lines = datasetLinesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setError("Add at least one JSONL line.");
      return;
    }

    for (const [index, line] of lines.entries()) {
      try {
        JSON.parse(line);
      } catch {
        setError(`Dataset line ${index + 1} is not valid JSON.`);
        return;
      }
    }

    setBusyAction("create_dataset_version");
    const response = await fetch(`/api/v2/datasets/${selectedDatasetId}/versions`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        lines,
      }),
    });
    const payload = (await response.json()) as { version?: DatasetVersion; error?: string };

    if (!response.ok || !payload.version) {
      setError(payload.error || "Failed to create dataset version.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Dataset version created: v${payload.version.version_number}`);
    await loadDatasetVersions(selectedDatasetId);
    setSelectedDatasetVersionId(payload.version.id);
    setBusyAction(null);
  }

  async function assignMember() {
    if (!selectedProjectId || !newMemberEmail.trim()) {
      setError("Select a project and enter member email.");
      return;
    }

    const response = await fetch(`/api/v2/projects/${selectedProjectId}/members`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        userEmail: newMemberEmail.trim(),
        role: newMemberRole,
      }),
    });
    const payload = (await response.json()) as { member?: ProjectMember; error?: string };

    if (!response.ok || !payload.member) {
      setError(payload.error || "Failed to assign member.");
      return;
    }

    setSuccess(`Member assigned: ${payload.member.user_email} (${payload.member.role})`);
    await loadMembersAndKeys(selectedProjectId);
  }

  function toggleKeyScope(scope: ApiKeyScope) {
    setNewKeyScopes((current) => {
      if (current.includes(scope)) {
        return current.filter((item) => item !== scope);
      }
      return [...current, scope];
    });
  }

  async function createProjectKey() {
    if (!selectedProjectId || !newKeyName.trim() || newKeyScopes.length === 0) {
      setError("Select project, key name, and at least one scope.");
      return;
    }

    const response = await fetch(`/api/v2/projects/${selectedProjectId}/keys`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        name: newKeyName.trim(),
        role: newKeyRole,
        scopes: newKeyScopes,
      }),
    });
    const payload = (await response.json()) as {
      apiKey?: ApiKeyRecord;
      token?: string;
      error?: string;
    };

    if (!response.ok || !payload.apiKey) {
      setError(payload.error || "Failed to create API key.");
      return;
    }

    setSuccess(`API key created: ${payload.apiKey.name}`);
    setIssuedApiToken(payload.token ?? "");
    await loadMembersAndKeys(selectedProjectId);
  }

  async function saveFlowVersion() {
    if (!selectedFlowId) {
      setError("Select a flow first.");
      return;
    }

    const validated = validateGraph(nodes, edges);
    setGraphErrors(validated.errors);

    if (!validated.graph) {
      setError("Graph validation failed. Resolve errors and retry.");
      return;
    }

    setBusyAction("save_flow_version");
    const response = await fetch(`/api/v2/flows/${selectedFlowId}/versions`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        graph: validated.graph,
      }),
    });

    const payload = (await response.json()) as { version?: FlowVersion; error?: string };

    if (!response.ok || !payload.version) {
      setError(payload.error || "Failed to save flow version.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Saved flow version v${payload.version.version_number}.`);
    await loadVersionsAndDeployments(selectedFlowId);
    setSelectedVersionId(payload.version.id);
    setBusyAction(null);
  }

  async function deploySelectedVersion() {
    if (!selectedFlowId || !selectedVersionId) {
      setError("Select a flow and version to deploy.");
      return;
    }

    setBusyAction("deploy_version");
    const response = await fetch(`/api/v2/flows/${selectedFlowId}/deploy`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        flowVersionId: selectedVersionId,
      }),
    });
    const payload = (await response.json()) as { deployment?: FlowDeployment; error?: string };

    if (!response.ok || !payload.deployment) {
      setError(payload.error || "Failed to deploy flow version.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Deployed version. Endpoint key: ${payload.deployment.deployment_key}`);
    await loadVersionsAndDeployments(selectedFlowId);
    setSelectedDeploymentKey(payload.deployment.deployment_key);
    setBusyAction(null);
  }

  async function sendWebhookTest() {
    if (!selectedDeploymentKey) {
      setError("Select or create a deployment first.");
      return;
    }

    let parsedBody: unknown = {};
    try {
      parsedBody = JSON.parse(testPayloadText);
    } catch {
      setError("Test payload must be valid JSON.");
      return;
    }

    setBusyAction("webhook_test");
    const response = await fetch(`/api/v2/sources/webhook/${encodeURIComponent(selectedDeploymentKey)}`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(parsedBody),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "Webhook execution failed.");
      setTestResult(JSON.stringify(payload, null, 2));
      setBusyAction(null);
      return;
    }

    setSuccess("Webhook test run succeeded.");
    setTestResult(JSON.stringify(payload, null, 2));
    setBusyAction(null);
  }

  async function runReplay() {
    if (!selectedProjectId || !selectedFlowId || !selectedVersionId || !selectedDatasetVersionId) {
      setError("Select project, flow, candidate version, and dataset version.");
      return;
    }

    const parsedLimit = Number(replayLimit);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : undefined;
    const promotionGates: Record<string, number> = {};

    if (promotionMinCandidateSuccess.trim()) {
      const value = Number(promotionMinCandidateSuccess);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        setError("Min candidate success must be a number between 0 and 1.");
        return;
      }
      promotionGates.minCandidateSuccessRate = value;
    }

    if (promotionMaxChangedVsBaseline.trim()) {
      const value = Number(promotionMaxChangedVsBaseline);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        setError("Max changed-vs-baseline rate must be a number between 0 and 1.");
        return;
      }
      promotionGates.maxChangedVsBaselineRate = value;
    }

    if (promotionMinFieldAccuracy.trim()) {
      const value = Number(promotionMinFieldAccuracy);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        setError("Min field accuracy must be a number between 0 and 1.");
        return;
      }
      promotionGates.minFieldAccuracy = value;
    }

    if (promotionMinExpectedSamples.trim()) {
      const value = Number(promotionMinExpectedSamples);
      if (!Number.isFinite(value) || value < 0) {
        setError("Min expected samples must be zero or a positive number.");
        return;
      }
      promotionGates.minComparedWithExpectedCount = Math.floor(value);
    }

    setBusyAction("replay");
    const response = await fetch("/api/v2/replay", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        flowId: selectedFlowId,
        flowVersionId: selectedVersionId,
        baselineFlowVersionId: baselineVersionId || undefined,
        datasetVersionId: selectedDatasetVersionId,
        limit: safeLimit,
        promotionGates: Object.keys(promotionGates).length > 0 ? promotionGates : undefined,
      }),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setError(typeof payload.error === "string" ? payload.error : "Replay failed.");
      setReplayResult(JSON.stringify(payload, null, 2));
      setBusyAction(null);
      return;
    }

    const promotion = payload.promotion as { passed?: unknown } | null | undefined;
    if (promotion && typeof promotion === "object" && typeof promotion.passed === "boolean") {
      if (promotion.passed) {
        setSuccess("Replay completed. Promotion gates passed.");
      } else {
        setError("Replay completed. Promotion gates failed.");
      }
    } else {
      setSuccess("Replay completed.");
    }

    setReplayResult(JSON.stringify(payload, null, 2));
    setBusyAction(null);
  }

  async function createEvalPackFromCandidates() {
    if (!selectedProjectId || !newEvalPackName.trim()) {
      setError("Select a project and provide an eval pack name.");
      return;
    }

    const parsedCount = Number(evalPackCandidateCount);
    const candidateCount =
      Number.isFinite(parsedCount) && parsedCount > 0 ? Math.min(Math.floor(parsedCount), 100) : 10;

    const selectedRunIds = selectTopCandidateRunIds({
      candidates: activeLearningCandidates,
      count: candidateCount,
    });
    const fallbackRunIds = reviewQueues
      .filter((queue) => queue.health === "at_risk" || queue.health === "unreviewed")
      .map((queue) => queue.run_id);
    const candidateRunIds = selectedRunIds.length > 0 ? selectedRunIds : [...new Set(fallbackRunIds)].slice(0, candidateCount);

    if (candidateRunIds.length === 0) {
      setError("No candidate runs are available to build an eval pack.");
      return;
    }

    setBusyAction("create_eval_pack");
    const response = await fetch("/api/v2/active-learning/eval-packs", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        name: newEvalPackName.trim(),
        candidateRunIds,
      }),
    });
    const payload = (await response.json()) as { pack?: EvalPack; error?: string };

    if (!response.ok || !payload.pack) {
      setError(payload.error || "Unable to create eval pack.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Eval pack created with ${payload.pack.candidate_run_ids.length} candidate runs.`);
    await loadActiveLearning(selectedProjectId);
    setBusyAction(null);
  }

  async function createReviewDecisionEntry() {
    if (!selectedProjectId || !selectedRunId || !newReviewFieldName.trim()) {
      setError("Select project/run and enter a field name.");
      return;
    }

    setBusyAction("create_review_decision");
    const response = await fetch(`/api/v2/reviews/${selectedRunId}/decisions`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        fieldName: newReviewFieldName.trim(),
        decision: newReviewDecision,
        failureReason: newReviewDecision === "correct" ? undefined : newReviewFailureReason,
        notes: newReviewNotes.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as { decision?: ReviewDecisionRecord; error?: string };

    if (!response.ok || !payload.decision) {
      setError(payload.error || "Unable to create review decision.");
      setBusyAction(null);
      return;
    }

    setSuccess(`Decision added for field "${payload.decision.field_name}".`);
    await loadReviewDecisions(selectedRunId);
    await loadReviewQueues(selectedProjectId);
    setSelectedReviewDecisionId(payload.decision.id);
    setBusyAction(null);
  }

  function toRelativePosition(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    return { x, y };
  }

  function onEvidenceMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!selectedReviewDecisionId) {
      setError("Select a review decision before drawing evidence.");
      return;
    }

    const point = toRelativePosition(event);
    setDragStart(point);
    setDraftEvidence({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  }

  function onEvidenceMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    const point = toRelativePosition(event);
    setDraftEvidence(normalizeRect(dragStart, point));
  }

  function onEvidenceMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    const point = toRelativePosition(event);
    const rect = normalizeRect(dragStart, point);
    setDragStart(null);

    if (rect.width < 0.01 || rect.height < 0.01) {
      setDraftEvidence(null);
      setInfo("Ignored tiny evidence box. Drag a larger area.");
      return;
    }

    setDraftEvidence(rect);
  }

  async function attachDraftEvidence() {
    if (!selectedProjectId || !selectedRunId || !selectedReviewDecisionId || !draftEvidence) {
      setError("Select project/run/decision and draw an evidence region first.");
      return;
    }

    setBusyAction("attach_evidence");
    const response = await fetch(`/api/v2/reviews/${selectedRunId}/evidence`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        reviewDecisionId: selectedReviewDecisionId,
        page: selectedEvidencePage,
        x: draftEvidence.x,
        y: draftEvidence.y,
        width: draftEvidence.width,
        height: draftEvidence.height,
      }),
    });
    const payload = (await response.json()) as { evidence?: EvidenceRegionRecord; error?: string };

    if (!response.ok || !payload.evidence) {
      setError(payload.error || "Unable to attach evidence region.");
      setBusyAction(null);
      return;
    }

    setSuccess("Evidence region attached.");
    setDraftEvidence(null);
    await loadEvidenceRegions(selectedRunId, selectedReviewDecisionId);
    await loadReviewQueues(selectedProjectId);
    setBusyAction(null);
  }

  const loadConnectorDeliveries = useCallback(async () => {
    if (!selectedProjectId) {
      setConnectorDeliveries([]);
      setConnectorSummary(EMPTY_CONNECTOR_SUMMARY);
      return;
    }

    const query = `/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver?projectId=${encodeURIComponent(selectedProjectId)}&limit=20`;
    const response = await fetch(query, {
      cache: "no-store",
      headers: authHeaders(false),
    });
    const payload = (await response.json()) as {
      deliveries?: Array<{ id: string; status: ConnectorDelivery["status"]; attempts?: unknown[] } & ConnectorDelivery>;
      summary?: ConnectorDeliverySummary;
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error || "Unable to load connector deliveries.");
      setConnectorDeliveries([]);
      setConnectorSummary(EMPTY_CONNECTOR_SUMMARY);
      return;
    }

    setConnectorDeliveries(payload.deliveries ?? []);
    setConnectorSummary(payload.summary ?? EMPTY_CONNECTOR_SUMMARY);
  }, [authHeaders, connectorType, selectedProjectId]);

  useEffect(() => {
    void loadConnectorDeliveries();
  }, [loadConnectorDeliveries]);

  async function testConnectorConfig() {
    if (!selectedProjectId) {
      setError("Select a project before connector config test.");
      return;
    }

    let config: Record<string, unknown> = {};
    try {
      config = connectorConfigText.trim() ? (JSON.parse(connectorConfigText) as Record<string, unknown>) : {};
    } catch {
      setError("Connector config must be valid JSON.");
      return;
    }

    setBusyAction("connector_test");
    const response = await fetch(`/api/v2/connectors/${encodeURIComponent(connectorType)}/test`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        config,
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setError(typeof result.error === "string" ? result.error : "Connector config test failed.");
      setConnectorResult(JSON.stringify(result, null, 2));
      setBusyAction(null);
      return;
    }

    setSuccess("Connector config validated.");
    setConnectorResult(JSON.stringify(result, null, 2));
    setBusyAction(null);
  }

  async function processConnectorQueue() {
    if (!selectedProjectId) {
      setError("Select a project before queue processing.");
      return;
    }

    const parsedLimit = Number(connectorProcessLimit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 10;

    setBusyAction("connector_process_queue");
    const response = await fetch(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver?action=process`, {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        limit,
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setError(typeof result.error === "string" ? result.error : "Connector queue processing failed.");
      setConnectorResult(JSON.stringify(result, null, 2));
      setBusyAction(null);
      return;
    }

    setSuccess("Connector queue processed.");
    setConnectorResult(JSON.stringify(result, null, 2));
    await loadConnectorDeliveries();
    setBusyAction(null);
  }

  async function redriveConnectorDeliveryEntry(deliveryId: string) {
    if (!selectedProjectId) {
      setError("Select a project before redrive.");
      return;
    }

    setBusyAction(`connector_redrive_${deliveryId}`);
    const response = await fetch(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver?action=redrive`, {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        deliveryId,
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setError(typeof result.error === "string" ? result.error : "Connector redrive failed.");
      setConnectorResult(JSON.stringify(result, null, 2));
      setBusyAction(null);
      return;
    }

    setSuccess("Connector delivery redriven.");
    setConnectorResult(JSON.stringify(result, null, 2));
    await loadConnectorDeliveries();
    setBusyAction(null);
  }

  async function deliverConnector() {
    if (!selectedProjectId) {
      setError("Select a project before connector delivery.");
      return;
    }

    let payload: unknown = {};
    let config: Record<string, unknown> = {};
    try {
      payload = JSON.parse(connectorPayloadText);
    } catch {
      setError("Connector payload must be valid JSON.");
      return;
    }
    try {
      config = connectorConfigText.trim() ? (JSON.parse(connectorConfigText) as Record<string, unknown>) : {};
    } catch {
      setError("Connector config must be valid JSON.");
      return;
    }

    const parsedMaxAttempts = Number(connectorMaxAttempts);
    const maxAttempts =
      Number.isFinite(parsedMaxAttempts) && parsedMaxAttempts > 0 ? Math.floor(parsedMaxAttempts) : undefined;

    setBusyAction("connector_deliver");
    const response = await fetch(`/api/v2/connectors/${encodeURIComponent(connectorType)}/deliver`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        payload,
        config,
        idempotencyKey: connectorIdempotencyKey.trim() || undefined,
        mode: connectorMode,
        maxAttempts,
      }),
    });

    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setError(typeof result.error === "string" ? result.error : "Connector delivery failed.");
      setConnectorResult(JSON.stringify(result, null, 2));
      setBusyAction(null);
      return;
    }

    setSuccess(connectorMode === "enqueue" ? "Connector delivery queued." : "Connector delivery processed.");
    setConnectorResult(JSON.stringify(result, null, 2));
    await loadConnectorDeliveries();
    setBusyAction(null);
  }

  return (
    <section className="panel stack">
      <h2>Flow Builder v2</h2>
      <p className="muted">Create projects, author no-code flow graphs, version them, deploy, and test runtime webhooks.</p>

      <article className="card stack">
        <h3>Access Context</h3>
        <div className="grid two-col">
          <label className="field">
            <span>API Key (optional in local mode)</span>
            <input
              type="password"
              placeholder="fsk_..."
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Local Actor Email</span>
            <input value={actorEmail} onChange={(event) => setActorEmail(event.target.value)} />
          </label>
        </div>

        <label className="field small">
          <span>Local Actor Role</span>
          <select value={actorRole} onChange={(event) => setActorRole(event.target.value as ProjectMemberRole)}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </article>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Project Scope</h3>

          <label className="field">
            <span>Organization</span>
            <select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}>
              <option value="">Select organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Create Project Name</span>
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
          </label>

          <label className="field">
            <span>Description</span>
            <input value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} />
          </label>

          <div className="row wrap">
            <button className="button" disabled={busyAction !== null} onClick={() => void createProject()}>
              {busyAction === "create_project" ? "Creating..." : "Create Project"}
            </button>
            <button className="button secondary" onClick={() => void loadProjects(selectedOrganizationId)}>
              Refresh Projects
            </button>
          </div>

          <label className="field">
            <span>Active Project</span>
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="card stack">
          <h3>Flow Scope</h3>

          <label className="field">
            <span>Create Flow Name</span>
            <input value={newFlowName} onChange={(event) => setNewFlowName(event.target.value)} />
          </label>

          <label className="field">
            <span>Description</span>
            <input value={newFlowDescription} onChange={(event) => setNewFlowDescription(event.target.value)} />
          </label>

          <div className="row wrap">
            <button className="button" disabled={busyAction !== null} onClick={() => void createFlow()}>
              {busyAction === "create_flow" ? "Creating..." : "Create Flow"}
            </button>
            <button className="button secondary" onClick={() => void loadFlows(selectedProjectId)}>
              Refresh Flows
            </button>
          </div>

          <label className="field">
            <span>Active Flow</span>
            <select value={selectedFlowId} onChange={(event) => setSelectedFlowId(event.target.value)}>
              <option value="">Select flow</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
            </select>
          </label>

          {selectedFlow ? (
            <p className="muted">
              Current version: <span className="mono">{selectedFlow.current_version_id ?? "none"}</span>
            </p>
          ) : null}
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Members</h3>

          <label className="field">
            <span>Member Email</span>
            <input value={newMemberEmail} onChange={(event) => setNewMemberEmail(event.target.value)} />
          </label>

          <label className="field small">
            <span>Role</span>
            <select value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value as ProjectMemberRole)}>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <div className="row wrap">
            <button className="button" onClick={() => void assignMember()}>
              Assign Member
            </button>
            <button className="button secondary" onClick={() => void loadMembersAndKeys(selectedProjectId)}>
              Refresh Members/Keys
            </button>
          </div>

          {members.length === 0 ? (
            <p className="muted">No members yet.</p>
          ) : (
            <ul className="list">
              {members.map((member) => (
                <li key={member.id}>
                  <span className="mono">{member.user_email}</span> - {member.role}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card stack">
          <h3>API Keys</h3>

          <label className="field">
            <span>Key Name</span>
            <input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
          </label>

          <label className="field small">
            <span>Key Role</span>
            <select value={newKeyRole} onChange={(event) => setNewKeyRole(event.target.value as ProjectMemberRole)}>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <div className="stack">
            <p className="muted">Scopes</p>
            <div className="row wrap">
              {API_KEY_SCOPES.map((scope) => (
                <label key={scope} className="row">
                  <input
                    type="checkbox"
                    checked={newKeyScopes.includes(scope)}
                    onChange={() => toggleKeyScope(scope)}
                  />
                  <span className="mono">{scope}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="button" onClick={() => void createProjectKey()}>
            Create API Key
          </button>

          {issuedApiToken ? (
            <div className="stack">
              <p className="muted">New key token (shown once)</p>
              <pre className="json small">{issuedApiToken}</pre>
            </div>
          ) : null}

          {apiKeys.length === 0 ? (
            <p className="muted">No API keys yet.</p>
          ) : (
            <ul className="list">
              {apiKeys.map((key) => (
                <li key={key.id}>
                  <span className="mono">{key.name}</span> - {key.role} ({key.is_active ? "active" : "inactive"})
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <article className="card stack">
        <div className="row between wrap">
          <h3>Graph Editor</h3>
          <div className="row wrap">
            <button className="button secondary" onClick={applyTemplate}>
              Load Template
            </button>
            <button className="button secondary" onClick={addEdge}>
              Add Edge
            </button>
            <button className="button" disabled={busyAction !== null} onClick={() => void saveFlowVersion()}>
              {busyAction === "save_flow_version" ? "Saving..." : "Save Flow Version"}
            </button>
          </div>
        </div>

        <p className="muted">
          Node palette:
          {NODE_TYPES.map((type) => (
            <button key={type} className="button secondary" onClick={() => addNode(type)} style={{ marginLeft: "0.5rem" }}>
              {type}
            </button>
          ))}
        </p>

        <div className="grid two-col">
          <div className="stack">
            <h3>Nodes</h3>
            {nodes.length === 0 ? <p className="muted">No nodes yet.</p> : null}
            {nodes.map((node, index) => (
              <article className="result-card stack" key={node.id}>
                <div className="row between wrap">
                  <strong>
                    Node {index + 1}: <span className="mono">{node.id}</span>
                  </strong>
                  <button className="button secondary" onClick={() => removeNode(node.id)}>
                    Remove
                  </button>
                </div>

                <div className="grid two-col">
                  <label className="field">
                    <span>Node ID</span>
                    <input
                      value={node.id}
                      onChange={(event) =>
                        setNodes((current) =>
                          current.map((item) => (item.id === node.id ? { ...item, id: event.target.value } : item)),
                        )
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Type</span>
                    <select
                      value={node.type}
                      onChange={(event) =>
                        setNodes((current) =>
                          current.map((item) =>
                            item.id === node.id ? { ...item, type: event.target.value as FlowNodeType } : item,
                          ),
                        )
                      }
                    >
                      {NODE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Label</span>
                  <input
                    value={node.label}
                    onChange={(event) =>
                      setNodes((current) =>
                        current.map((item) => (item.id === node.id ? { ...item, label: event.target.value } : item)),
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Config (JSON)</span>
                  <textarea
                    rows={5}
                    value={node.configText}
                    onChange={(event) =>
                      setNodes((current) =>
                        current.map((item) => (item.id === node.id ? { ...item, configText: event.target.value } : item)),
                      )
                    }
                  />
                </label>
              </article>
            ))}
          </div>

          <div className="stack">
            <h3>Edges</h3>
            {edges.length === 0 ? <p className="muted">No edges yet.</p> : null}
            {edges.map((edge) => (
              <article className="result-card stack" key={edge.id}>
                <div className="row between wrap">
                  <strong className="mono">{edge.id}</strong>
                  <button
                    className="button secondary"
                    onClick={() => setEdges((current) => current.filter((item) => item.id !== edge.id))}
                  >
                    Remove
                  </button>
                </div>

                <div className="grid two-col">
                  <label className="field">
                    <span>Source</span>
                    <select
                      value={edge.source}
                      onChange={(event) =>
                        setEdges((current) =>
                          current.map((item) => (item.id === edge.id ? { ...item, source: event.target.value } : item)),
                        )
                      }
                    >
                      {nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Target</span>
                    <select
                      value={edge.target}
                      onChange={(event) =>
                        setEdges((current) =>
                          current.map((item) => (item.id === edge.id ? { ...item, target: event.target.value } : item)),
                        )
                      }
                    >
                      {nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Condition (optional)</span>
                  <input
                    value={edge.condition}
                    onChange={(event) =>
                      setEdges((current) =>
                        current.map((item) => (item.id === edge.id ? { ...item, condition: event.target.value } : item)),
                      )
                    }
                  />
                </label>
              </article>
            ))}
          </div>
        </div>

        {graphErrors.length > 0 ? (
          <ul className="issue-list">
            {graphErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Graph validation status: ready.</p>
        )}
      </article>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Versions + Deployments</h3>
          <div className="row wrap">
            <button className="button secondary" onClick={() => void loadVersionsAndDeployments(selectedFlowId)}>
              Refresh
            </button>
            <button className="button secondary" onClick={loadVersionIntoEditor}>
              Load Version Into Editor
            </button>
            <button className="button" disabled={busyAction !== null} onClick={() => void deploySelectedVersion()}>
              {busyAction === "deploy_version" ? "Deploying..." : "Deploy Selected Version"}
            </button>
          </div>

          <label className="field">
            <span>Flow Version</span>
            <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
              <option value="">Select version</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version_number} ({new Date(version.created_at).toLocaleString()})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Deployment Key</span>
            <select value={selectedDeploymentKey} onChange={(event) => setSelectedDeploymentKey(event.target.value)}>
              <option value="">Select deployment</option>
              {deployments.map((deployment) => (
                <option key={deployment.id} value={deployment.deployment_key}>
                  {deployment.deployment_key} {deployment.is_active ? "(active)" : ""}
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="card stack">
          <h3>Webhook Runtime Test</h3>
          <p className="muted mono">
            POST /api/v2/sources/webhook/{selectedDeploymentKey || "{deployment_key}"}
          </p>

          <label className="field">
            <span>Payload JSON</span>
            <textarea rows={7} value={testPayloadText} onChange={(event) => setTestPayloadText(event.target.value)} />
          </label>

          <button className="button" disabled={busyAction !== null} onClick={() => void sendWebhookTest()}>
            {busyAction === "webhook_test" ? "Running..." : "Run Test"}
          </button>

          {testResult ? <pre className="json small">{testResult}</pre> : <p className="muted">No test run yet.</p>}
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Datasets + Versions</h3>

          <label className="field">
            <span>Create Dataset Name</span>
            <input value={newDatasetName} onChange={(event) => setNewDatasetName(event.target.value)} />
          </label>

          <label className="field">
            <span>Description</span>
            <input value={newDatasetDescription} onChange={(event) => setNewDatasetDescription(event.target.value)} />
          </label>

          <div className="row wrap">
            <button className="button" disabled={busyAction !== null} onClick={() => void createDataset()}>
              {busyAction === "create_dataset" ? "Creating..." : "Create Dataset"}
            </button>
            <button className="button secondary" onClick={() => void loadDatasets(selectedProjectId)}>
              Refresh Datasets
            </button>
          </div>

          <label className="field">
            <span>Dataset</span>
            <select value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>
              <option value="">Select dataset</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Dataset Version JSONL (one JSON per line)</span>
            <textarea rows={7} value={datasetLinesText} onChange={(event) => setDatasetLinesText(event.target.value)} />
          </label>

          <button className="button secondary" disabled={busyAction !== null} onClick={() => void createDatasetVersion()}>
            {busyAction === "create_dataset_version" ? "Creating..." : "Create Dataset Version"}
          </button>

          <label className="field">
            <span>Selected Dataset Version</span>
            <select value={selectedDatasetVersionId} onChange={(event) => setSelectedDatasetVersionId(event.target.value)}>
              <option value="">Select dataset version</option>
              {datasetVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version_number} ({version.item_count} items)
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="card stack">
          <h3>Replay + Diff</h3>

          <label className="field">
            <span>Candidate Version</span>
            <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
              <option value="">Select candidate version</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version_number}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Baseline Version (optional)</span>
            <select value={baselineVersionId} onChange={(event) => setBaselineVersionId(event.target.value)}>
              <option value="">None</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version_number}
                </option>
              ))}
            </select>
          </label>

          <label className="field small">
            <span>Replay Limit</span>
            <input value={replayLimit} onChange={(event) => setReplayLimit(event.target.value)} />
          </label>

          <div className="grid two-col">
            <label className="field small">
              <span>Gate: Min Candidate Success</span>
              <input
                value={promotionMinCandidateSuccess}
                onChange={(event) => setPromotionMinCandidateSuccess(event.target.value)}
              />
            </label>
            <label className="field small">
              <span>Gate: Max Changed-vs-Baseline</span>
              <input
                value={promotionMaxChangedVsBaseline}
                onChange={(event) => setPromotionMaxChangedVsBaseline(event.target.value)}
              />
            </label>
            <label className="field small">
              <span>Gate: Min Field Accuracy</span>
              <input value={promotionMinFieldAccuracy} onChange={(event) => setPromotionMinFieldAccuracy(event.target.value)} />
            </label>
            <label className="field small">
              <span>Gate: Min Expected Samples</span>
              <input
                value={promotionMinExpectedSamples}
                onChange={(event) => setPromotionMinExpectedSamples(event.target.value)}
              />
            </label>
          </div>

          <p className="muted">
            Gates evaluate replay output for promotion readiness. Use empty values to disable specific gates.
          </p>

          <button className="button" disabled={busyAction !== null} onClick={() => void runReplay()}>
            {busyAction === "replay" ? "Running..." : "Run Replay"}
          </button>

          {replayResult ? <pre className="json small">{replayResult}</pre> : <p className="muted">No replay result yet.</p>}
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Active Learning Candidates</h3>
          <p className="muted">
            Rank completed runs by review failures, uncertainty, latency, and cost. Create eval packs from top candidates.
          </p>

          <div className="grid two-col">
            <label className="field small">
              <span>Eval Pack Name</span>
              <input value={newEvalPackName} onChange={(event) => setNewEvalPackName(event.target.value)} />
            </label>
            <label className="field small">
              <span>Candidate Count</span>
              <input value={evalPackCandidateCount} onChange={(event) => setEvalPackCandidateCount(event.target.value)} />
            </label>
          </div>

          <div className="row wrap">
            <button className="button secondary" onClick={() => void loadActiveLearning(selectedProjectId)}>
              Refresh Candidates
            </button>
            <button className="button" disabled={busyAction !== null} onClick={() => void createEvalPackFromCandidates()}>
              {busyAction === "create_eval_pack" ? "Creating..." : "Create Eval Pack From Top Candidates"}
            </button>
          </div>

          {activeLearningCandidates.length === 0 ? (
            <p className="muted">No active learning candidates available.</p>
          ) : (
            <ul className="list">
              {activeLearningCandidates.slice(0, 10).map((candidate) => (
                <li key={candidate.run.id}>
                  <span className="mono">{candidate.run.id.slice(0, 8)}</span> - score {candidate.score.toFixed(2)} - incorrect{" "}
                  {candidate.incorrect_count} - uncertain {candidate.uncertain_count} - latency{" "}
                  {candidate.avg_latency_ms.toFixed(0)}ms - cost ${candidate.cost_usd.toFixed(4)}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card stack">
          <h3>Eval Pack History</h3>
          <p className="muted">Track created eval packs and candidate volume over time.</p>
          <button className="button secondary" onClick={() => void loadActiveLearning(selectedProjectId)}>
            Refresh Packs
          </button>
          {evalPacks.length === 0 ? (
            <p className="muted">No eval packs created yet.</p>
          ) : (
            <ul className="list">
              {evalPacks.map((pack) => (
                <li key={pack.id}>
                  <span className="mono">{pack.id.slice(0, 8)}</span> - {pack.name} - {pack.candidate_run_ids.length} runs -{" "}
                  {new Date(pack.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Review Decisions v2</h3>
          <p className="muted">Create field-level review outcomes for a run queue before attaching evidence regions.</p>
          <p className="muted">
            total {reviewSummary.total} | correct {reviewSummary.by_decision.correct} | incorrect {reviewSummary.by_decision.incorrect}
          </p>
          <p className="muted">
            missing {reviewSummary.by_decision.missing} | uncertain {reviewSummary.by_decision.uncertain} | error rate{" "}
            {(reviewSummary.error_rate * 100).toFixed(1)}%
          </p>
          <p className="muted">
            top failures:{" "}
            {reviewSummary.failure_hotspots.length > 0
              ? reviewSummary.failure_hotspots.map((item) => `${item.reason} (${item.count})`).join(" | ")
              : "none"}
          </p>
          <p className="muted">
            hot fields:{" "}
            {reviewSummary.field_hotspots.length > 0
              ? reviewSummary.field_hotspots.map((item) => `${item.field_name} (${item.non_correct}/${item.total})`).join(" | ")
              : "none"}
          </p>

          <label className="field small">
            <span>Stale Threshold (hours)</span>
            <input value={reviewStaleHours} onChange={(event) => setReviewStaleHours(event.target.value)} />
          </label>
          <div className="row wrap">
            <button className="button secondary" onClick={() => void loadReviewQueues(selectedProjectId)}>
              Refresh Queue Ops
            </button>
            <p className="muted">
              queues {reviewQueueSummary.total_queues} | unreviewed {reviewQueueSummary.unreviewed_queues} | at-risk{" "}
              {reviewQueueSummary.at_risk_queues} | stale {reviewQueueSummary.stale_queues}
            </p>
          </div>
          <p className="muted">
            healthy {reviewQueueSummary.healthy_queues} | decisions {reviewQueueSummary.total_decisions} | evidence{" "}
            {reviewQueueSummary.total_evidence_regions} | avg error {(reviewQueueSummary.avg_error_rate * 100).toFixed(1)}%
          </p>
          {reviewQueues.length === 0 ? (
            <p className="muted">No review queues available.</p>
          ) : (
            <ul className="list">
              {reviewQueues.slice(0, 8).map((queue) => (
                <li key={queue.run_id}>
                  <span className="mono">{queue.run_id.slice(0, 8)}</span> - {queue.health} - {queue.run_status} - errors{" "}
                  {queue.non_correct_count}/{queue.decisions_total} ({(queue.error_rate * 100).toFixed(1)}%) - evidence{" "}
                  {queue.evidence_count}
                  {queue.last_reviewed_at ? ` - last ${new Date(queue.last_reviewed_at).toLocaleString()}` : " - not reviewed yet"}
                  <button
                    className="button secondary"
                    disabled={queue.run_id === selectedRunId}
                    onClick={() => setSelectedRunId(queue.run_id)}
                  >
                    {queue.run_id === selectedRunId ? "Selected" : "Select"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="field">
            <span>Run Queue</span>
            <select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
              <option value="">Select run</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id.slice(0, 8)} • {run.status}
                </option>
              ))}
            </select>
          </label>

          <div className="row wrap">
            <button className="button secondary" onClick={() => void loadRuns(selectedProjectId)}>
              Refresh Runs
            </button>
            <button className="button secondary" onClick={() => void loadReviewQueues(selectedProjectId)}>
              Refresh Queues
            </button>
            <button className="button secondary" onClick={() => void loadReviewDecisions(selectedRunId)}>
              Refresh Decisions
            </button>
          </div>

          <div className="grid two-col">
            <label className="field">
              <span>Field Name</span>
              <input value={newReviewFieldName} onChange={(event) => setNewReviewFieldName(event.target.value)} />
            </label>
            <label className="field">
              <span>Decision</span>
              <select
                value={newReviewDecision}
                onChange={(event) => setNewReviewDecision(event.target.value as ReviewDecisionValue)}
              >
                {REVIEW_DECISION_OPTIONS.map((decision) => (
                  <option key={decision} value={decision}>
                    {decision}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Failure Reason</span>
              <select
                value={newReviewFailureReason}
                disabled={newReviewDecision === "correct"}
                onChange={(event) => setNewReviewFailureReason(event.target.value as FailureReasonCode)}
              >
                {FAILURE_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <input value={newReviewNotes} onChange={(event) => setNewReviewNotes(event.target.value)} />
            </label>
          </div>

          <button className="button" disabled={busyAction !== null} onClick={() => void createReviewDecisionEntry()}>
            {busyAction === "create_review_decision" ? "Saving..." : "Create Decision"}
          </button>

          <label className="field">
            <span>Active Review Decision</span>
            <select value={selectedReviewDecisionId} onChange={(event) => setSelectedReviewDecisionId(event.target.value)}>
              <option value="">Select decision</option>
              {reviewDecisions.map((decision) => (
                <option key={decision.id} value={decision.id}>
                  {decision.field_name} • {decision.decision}
                </option>
              ))}
            </select>
          </label>

          {selectedReviewDecision ? (
            <p className="muted">
              reviewer: {selectedReviewDecision.reviewer ?? "n/a"} | failure: {selectedReviewDecision.failure_reason ?? "none"}
            </p>
          ) : (
            <p className="muted">No decision selected.</p>
          )}
        </article>

        <article className="card stack">
          <h3>Evidence Studio</h3>
          <p className="muted">Draw bounding boxes directly on the preview to attach normalized evidence regions (0-1).</p>

          <div className="grid two-col">
            <label className="field">
              <span>Preview Image URL</span>
              <input value={evidencePreviewUrl} onChange={(event) => setEvidencePreviewUrl(event.target.value)} />
            </label>
            <label className="field">
              <span>Page Index</span>
              <input value={evidencePage} onChange={(event) => setEvidencePage(event.target.value)} />
            </label>
          </div>

          <div
            className="annotation-board"
            style={{ backgroundImage: `url(${evidencePreviewUrl})` }}
            onMouseDown={onEvidenceMouseDown}
            onMouseMove={onEvidenceMouseMove}
            onMouseUp={onEvidenceMouseUp}
            onMouseLeave={() => setDragStart(null)}
          >
            {visibleEvidenceRegions.map((region) => (
                <div
                  key={region.id}
                  className="annotation-box"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                />
              ))}
            {draftEvidence ? (
              <div
                className="annotation-box draft"
                style={{
                  left: `${draftEvidence.x * 100}%`,
                  top: `${draftEvidence.y * 100}%`,
                  width: `${draftEvidence.width * 100}%`,
                  height: `${draftEvidence.height * 100}%`,
                }}
              />
            ) : null}
          </div>

          <div className="row wrap">
            <button
              className="button"
              disabled={busyAction !== null || !draftEvidence}
              onClick={() => void attachDraftEvidence()}
            >
              {busyAction === "attach_evidence" ? "Attaching..." : "Attach Draft Evidence"}
            </button>
            <button className="button secondary" onClick={() => setDraftEvidence(null)}>
              Clear Draft
            </button>
            <button className="button secondary" onClick={() => void loadEvidenceRegions(selectedRunId, selectedReviewDecisionId)}>
              Refresh Evidence
            </button>
          </div>

          {draftEvidence ? (
            <p className="muted mono">
              draft: x={draftEvidence.x.toFixed(4)} y={draftEvidence.y.toFixed(4)} w={draftEvidence.width.toFixed(4)} h=
              {draftEvidence.height.toFixed(4)}
            </p>
          ) : (
            <p className="muted">No draft evidence box. Click and drag on the preview.</p>
          )}

          <p className="muted">Persisted evidence regions for selected page: {visibleEvidenceRegions.length}</p>
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Connector Delivery Lab</h3>
          <p className="muted">
            Validate connector config and deliver events to webhook/slack/jira transports. You can still simulate failures
            using `__simulateFailureCount` or `__simulateAlwaysFail` in payload.
          </p>

          <label className="field small">
            <span>Connector Type</span>
            <input value={connectorType} onChange={(event) => setConnectorType(event.target.value)} />
          </label>
          <label className="field small">
            <span>Delivery Mode</span>
            <select value={connectorMode} onChange={(event) => setConnectorMode(event.target.value as "sync" | "enqueue")}>
              <option value="sync">sync (process now)</option>
              <option value="enqueue">enqueue (process later)</option>
            </select>
          </label>
          <button
            className="button secondary"
            onClick={() => setConnectorConfigText(connectorConfigTemplate(connectorType))}
          >
            Load Config Template
          </button>

          <label className="field">
            <span>Payload JSON</span>
            <textarea
              rows={7}
              value={connectorPayloadText}
              onChange={(event) => setConnectorPayloadText(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Connector Config JSON</span>
            <textarea
              rows={6}
              value={connectorConfigText}
              onChange={(event) => setConnectorConfigText(event.target.value)}
            />
          </label>

          <div className="grid two-col">
            <label className="field">
              <span>Idempotency Key (optional)</span>
              <input value={connectorIdempotencyKey} onChange={(event) => setConnectorIdempotencyKey(event.target.value)} />
            </label>

            <label className="field">
              <span>Max Attempts</span>
              <input value={connectorMaxAttempts} onChange={(event) => setConnectorMaxAttempts(event.target.value)} />
            </label>
            <label className="field">
              <span>Queue Process Limit</span>
              <input value={connectorProcessLimit} onChange={(event) => setConnectorProcessLimit(event.target.value)} />
            </label>
          </div>

          <div className="row wrap">
            <button className="button secondary" disabled={busyAction !== null} onClick={() => void testConnectorConfig()}>
              {busyAction === "connector_test" ? "Testing..." : "Test Config"}
            </button>
            <button className="button" disabled={busyAction !== null} onClick={() => void deliverConnector()}>
              {busyAction === "connector_deliver" ? "Delivering..." : "Deliver Event"}
            </button>
            <button className="button secondary" disabled={busyAction !== null} onClick={() => void processConnectorQueue()}>
              {busyAction === "connector_process_queue" ? "Processing..." : "Process Queue"}
            </button>
            <button className="button secondary" onClick={() => void loadConnectorDeliveries()}>
              Refresh History
            </button>
          </div>

          {connectorResult ? <pre className="json small">{connectorResult}</pre> : <p className="muted">No connector result yet.</p>}
        </article>

        <article className="card stack">
          <h3>Connector History</h3>
          <p className="muted">
            total {connectorSummary.total} | due now {connectorSummary.due_now} | dead-letter {connectorSummary.dead_lettered}
          </p>
          <p className="muted">
            queued {connectorSummary.queued} | retrying {connectorSummary.retrying} | delivered {connectorSummary.delivered}
          </p>
          <p className="muted">
            earliest retry:{" "}
            {connectorSummary.earliest_next_attempt_at
              ? new Date(connectorSummary.earliest_next_attempt_at).toLocaleString()
              : "n/a"}
          </p>
          {connectorDeliveries.length === 0 ? (
            <p className="muted">No deliveries yet.</p>
          ) : (
            <ul className="list">
              {connectorDeliveries.map((delivery) => (
                <li key={delivery.id}>
                  <span className="mono">{delivery.id}</span> - {delivery.status} ({delivery.attempt_count}/{delivery.max_attempts})
                  {delivery.last_error ? ` - ${delivery.last_error}` : ""}
                  {delivery.status === "dead_lettered" ? (
                    <>
                      {" "}
                      <button
                        className="button secondary"
                        disabled={busyAction !== null}
                        onClick={() => void redriveConnectorDeliveryEntry(delivery.id)}
                      >
                        {busyAction === `connector_redrive_${delivery.id}` ? "Redriving..." : "Redrive"}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {statusMessage ? <p className={`status ${statusTone}`}>{statusMessage}</p> : null}
    </section>
  );
}

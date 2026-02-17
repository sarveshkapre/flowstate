/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowGraph, FlowNodeType } from "@flowstate/types";

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
  const [actorRole, setActorRole] = useState("owner");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [deployments, setDeployments] = useState<FlowDeployment[]>([]);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedDeploymentKey, setSelectedDeploymentKey] = useState("");

  const [newProjectName, setNewProjectName] = useState("Ops Project");
  const [newProjectDescription, setNewProjectDescription] = useState("Flowstate v2 control plane project");
  const [newFlowName, setNewFlowName] = useState("Document Intake Flow");
  const [newFlowDescription, setNewFlowDescription] = useState("Extract, validate, and route documents.");

  const [nodes, setNodes] = useState<GraphNodeDraft[]>([]);
  const [edges, setEdges] = useState<GraphEdgeDraft[]>([]);
  const [graphErrors, setGraphErrors] = useState<string[]>([]);

  const [testPayloadText, setTestPayloadText] = useState('{"vendor":"Acme","date":"2026-02-17","total":42.12}');
  const [testResult, setTestResult] = useState<string>("");

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

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store" });
    const payload = (await response.json()) as { organizations?: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [selectedOrganizationId]);

  const loadProjects = useCallback(
    async (organizationId: string) => {
      const query = `/api/v2/projects?organizationId=${encodeURIComponent(organizationId)}`;
      const response = await fetch(query, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { projects?: Project[]; error?: string };

      if (!response.ok) {
        setStatusMessage(payload.error || "Unable to load projects.");
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
        setStatusMessage(payload.error || "Unable to load flows.");
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
        setStatusMessage(versionsPayload.error || "Unable to load versions.");
        setVersions([]);
      } else {
        const nextVersions = versionsPayload.versions ?? [];
        setVersions(nextVersions);
        if (!nextVersions.some((version) => version.id === selectedVersionId)) {
          setSelectedVersionId(nextVersions[0]?.id ?? "");
        }
      }

      if (!deploymentsResponse.ok) {
        setStatusMessage(deploymentsPayload.error || "Unable to load deployments.");
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
      return;
    }
    void loadFlows(selectedProjectId);
  }, [loadFlows, selectedProjectId]);

  useEffect(() => {
    void loadVersionsAndDeployments(selectedFlowId);
  }, [loadVersionsAndDeployments, selectedFlowId]);

  function applyTemplate() {
    const draft = toDraftGraph(TEMPLATE_GRAPH.graph);
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setGraphErrors([]);
    setStatusMessage(`Loaded template: ${TEMPLATE_GRAPH.name}`);
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
      setStatusMessage("Add at least two nodes before connecting edges.");
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
      setStatusMessage("Select a flow version to load.");
      return;
    }

    const draft = toDraftGraph(selectedVersion.graph);
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setGraphErrors([]);
    setStatusMessage(`Loaded flow version v${selectedVersion.version_number} into editor.`);
  }

  async function createProject() {
    if (!selectedOrganizationId || !newProjectName.trim()) {
      setStatusMessage("Pick an organization and enter a project name.");
      return;
    }

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
      setStatusMessage(payload.error || "Failed to create project.");
      return;
    }

    setStatusMessage(`Project created: ${payload.project.name}`);
    await loadProjects(selectedOrganizationId);
    setSelectedProjectId(payload.project.id);
  }

  async function createFlow() {
    if (!selectedProjectId || !newFlowName.trim()) {
      setStatusMessage("Pick a project and enter a flow name.");
      return;
    }

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
      setStatusMessage(payload.error || "Failed to create flow.");
      return;
    }

    setStatusMessage(`Flow created: ${payload.flow.name}`);
    await loadFlows(selectedProjectId);
    setSelectedFlowId(payload.flow.id);
  }

  async function saveFlowVersion() {
    if (!selectedFlowId) {
      setStatusMessage("Select a flow first.");
      return;
    }

    const validated = validateGraph(nodes, edges);
    setGraphErrors(validated.errors);

    if (!validated.graph) {
      setStatusMessage("Graph validation failed. Resolve errors and retry.");
      return;
    }

    const response = await fetch(`/api/v2/flows/${selectedFlowId}/versions`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        graph: validated.graph,
      }),
    });

    const payload = (await response.json()) as { version?: FlowVersion; error?: string };

    if (!response.ok || !payload.version) {
      setStatusMessage(payload.error || "Failed to save flow version.");
      return;
    }

    setStatusMessage(`Saved flow version v${payload.version.version_number}.`);
    await loadVersionsAndDeployments(selectedFlowId);
    setSelectedVersionId(payload.version.id);
  }

  async function deploySelectedVersion() {
    if (!selectedFlowId || !selectedVersionId) {
      setStatusMessage("Select a flow and version to deploy.");
      return;
    }

    const response = await fetch(`/api/v2/flows/${selectedFlowId}/deploy`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        flowVersionId: selectedVersionId,
      }),
    });
    const payload = (await response.json()) as { deployment?: FlowDeployment; error?: string };

    if (!response.ok || !payload.deployment) {
      setStatusMessage(payload.error || "Failed to deploy flow version.");
      return;
    }

    setStatusMessage(`Deployed version. Endpoint key: ${payload.deployment.deployment_key}`);
    await loadVersionsAndDeployments(selectedFlowId);
    setSelectedDeploymentKey(payload.deployment.deployment_key);
  }

  async function sendWebhookTest() {
    if (!selectedDeploymentKey) {
      setStatusMessage("Select or create a deployment first.");
      return;
    }

    let parsedBody: unknown = {};
    try {
      parsedBody = JSON.parse(testPayloadText);
    } catch {
      setStatusMessage("Test payload must be valid JSON.");
      return;
    }

    const response = await fetch(`/api/v2/sources/webhook/${encodeURIComponent(selectedDeploymentKey)}`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(parsedBody),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      setStatusMessage(typeof payload.error === "string" ? payload.error : "Webhook execution failed.");
      setTestResult(JSON.stringify(payload, null, 2));
      return;
    }

    setStatusMessage("Webhook test run succeeded.");
    setTestResult(JSON.stringify(payload, null, 2));
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
          <select value={actorRole} onChange={(event) => setActorRole(event.target.value)}>
            <option value="owner">owner</option>
            <option value="admin">admin</option>
            <option value="builder">builder</option>
            <option value="reviewer">reviewer</option>
            <option value="viewer">viewer</option>
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
            <button className="button" onClick={() => void createProject()}>
              Create Project
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
            <button className="button" onClick={() => void createFlow()}>
              Create Flow
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
            <button className="button" onClick={() => void saveFlowVersion()}>
              Save Flow Version
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
            <button className="button" onClick={() => void deploySelectedVersion()}>
              Deploy Selected Version
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

          <button className="button" onClick={() => void sendWebhookTest()}>
            Run Test
          </button>

          {testResult ? <pre className="json small">{testResult}</pre> : <p className="muted">No test run yet.</p>}
        </article>
      </div>

      {statusMessage ? <p className="muted">{statusMessage}</p> : null}
    </section>
  );
}

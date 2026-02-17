/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";

type Organization = {
  id: string;
  name: string;
};

type Project = {
  id: string;
  name: string;
};

type EdgeAgent = {
  id: string;
  project_id: string;
  name: string;
  platform: string;
  status: "online" | "offline";
  last_heartbeat_at: string | null;
};

type EdgeAgentConfig = {
  id: string;
  version_number: number;
  config: unknown;
  created_at: string;
};

type EdgeAgentCommand = {
  id: string;
  command_type: string;
  status: "pending" | "claimed" | "acknowledged" | "failed";
  payload: unknown;
  created_at: string;
  acknowledged_at: string | null;
};

type Role = "owner" | "admin" | "builder" | "reviewer" | "viewer";

const ROLES: Role[] = ["owner", "admin", "builder", "reviewer", "viewer"];

export function EdgeControlClient() {
  const [apiKey, setApiKey] = useState("");
  const [actorEmail, setActorEmail] = useState("local@flowstate.dev");
  const [actorRole, setActorRole] = useState<Role>("owner");

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<EdgeAgent[]>([]);
  const [commands, setCommands] = useState<EdgeAgentCommand[]>([]);
  const [activeConfig, setActiveConfig] = useState<EdgeAgentConfig | null>(null);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const [newAgentName, setNewAgentName] = useState("Mac Mini Runner");
  const [newAgentPlatform, setNewAgentPlatform] = useState("macOS");
  const [configText, setConfigText] = useState('{"flowVersionId":"latest","samplingIntervalMs":1000}');
  const [commandType, setCommandType] = useState("reload_flow");
  const [commandPayloadText, setCommandPayloadText] = useState('{"reason":"manual_update"}');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [responsePayload, setResponsePayload] = useState("");

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

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store" });
    const payload = (await response.json()) as { organizations?: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [selectedOrganizationId]);

  const loadProjects = useCallback(async () => {
    if (!selectedOrganizationId) {
      setProjects([]);
      setSelectedProjectId("");
      return;
    }

    const response = await fetch(`/api/v2/projects?organizationId=${encodeURIComponent(selectedOrganizationId)}`, {
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
  }, [authHeaders, selectedOrganizationId, selectedProjectId]);

  const loadAgents = useCallback(async () => {
    if (!selectedProjectId) {
      setAgents([]);
      setSelectedAgentId("");
      return;
    }

    const response = await fetch(`/api/v2/edge/agents?projectId=${encodeURIComponent(selectedProjectId)}`, {
      cache: "no-store",
      headers: authHeaders(false),
    });
    const payload = (await response.json()) as { agents?: EdgeAgent[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error || "Unable to load edge agents.");
      setAgents([]);
      return;
    }

    const nextAgents = payload.agents ?? [];
    setAgents(nextAgents);

    if (!nextAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(nextAgents[0]?.id ?? "");
    }
  }, [authHeaders, selectedAgentId, selectedProjectId]);

  const loadCommands = useCallback(async () => {
    if (!selectedAgentId) {
      setCommands([]);
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands?limit=20`, {
      cache: "no-store",
      headers: authHeaders(false),
    });
    const payload = (await response.json()) as { commands?: EdgeAgentCommand[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error || "Unable to load commands.");
      setCommands([]);
      return;
    }

    setCommands(payload.commands ?? []);
  }, [authHeaders, selectedAgentId]);

  const loadConfig = useCallback(async () => {
    if (!selectedAgentId) {
      setActiveConfig(null);
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/config`, {
      cache: "no-store",
      headers: authHeaders(false),
    });
    const payload = (await response.json()) as { config?: EdgeAgentConfig | null; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error || "Unable to load config.");
      setActiveConfig(null);
      return;
    }

    setActiveConfig(payload.config ?? null);
  }, [authHeaders, selectedAgentId]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadCommands();
    void loadConfig();
  }, [loadCommands, loadConfig]);

  async function registerAgent() {
    if (!selectedProjectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const response = await fetch("/api/v2/edge/agents/register", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        projectId: selectedProjectId,
        name: newAgentName.trim(),
        platform: newAgentPlatform.trim(),
      }),
    });
    const payload = (await response.json()) as { agent?: EdgeAgent; error?: string };

    if (!response.ok || !payload.agent) {
      setStatusMessage(payload.error || "Failed to register edge agent.");
      return;
    }

    setStatusMessage(`Agent registered: ${payload.agent.name}`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadAgents();
    setSelectedAgentId(payload.agent.id);
  }

  async function saveConfig() {
    if (!selectedAgentId) {
      setStatusMessage("Select an agent first.");
      return;
    }

    let config: unknown;
    try {
      config = JSON.parse(configText);
    } catch {
      setStatusMessage("Config must be valid JSON.");
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/config`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ config }),
    });
    const payload = (await response.json()) as { config?: EdgeAgentConfig; error?: string };

    if (!response.ok || !payload.config) {
      setStatusMessage(payload.error || "Failed to save agent config.");
      return;
    }

    setStatusMessage(`Config saved (v${payload.config.version_number}).`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadConfig();
  }

  async function enqueueCommand() {
    if (!selectedAgentId) {
      setStatusMessage("Select an agent first.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(commandPayloadText);
    } catch {
      setStatusMessage("Command payload must be valid JSON.");
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        commandType: commandType.trim(),
        payload,
      }),
    });
    const body = (await response.json()) as { command?: EdgeAgentCommand; error?: string };

    if (!response.ok || !body.command) {
      setStatusMessage(body.error || "Failed to enqueue command.");
      return;
    }

    setStatusMessage(`Command queued: ${body.command.command_type}`);
    setResponsePayload(JSON.stringify(body, null, 2));
    await loadCommands();
  }

  async function pullCommands() {
    if (!selectedAgentId) {
      setStatusMessage("Select an agent first.");
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands/pull`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ limit: 10 }),
    });
    const payload = (await response.json()) as { commands?: EdgeAgentCommand[]; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error || "Command pull failed.");
      return;
    }

    setStatusMessage(`Pulled ${payload.commands?.length ?? 0} command(s).`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadCommands();
  }

  async function acknowledgeCommand(commandId: string, status: "acknowledged" | "failed") {
    if (!selectedAgentId) {
      setStatusMessage("Select an agent first.");
      return;
    }

    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands/${commandId}/ack`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        status,
        result: { at: new Date().toISOString(), source: "edge-control-ui" },
      }),
    });
    const payload = (await response.json()) as { command?: EdgeAgentCommand; error?: string };

    if (!response.ok) {
      setStatusMessage(payload.error || "Failed to acknowledge command.");
      return;
    }

    setStatusMessage(`Command ${status}.`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadCommands();
  }

  return (
    <section className="panel stack">
      <h2>Edge Control v2</h2>
      <p className="muted">Manage edge agents, config versions, and command queue lifecycle on top of v2 APIs.</p>

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
          <select value={actorRole} onChange={(event) => setActorRole(event.target.value as Role)}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </article>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Scope</h3>
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
            <span>Project</span>
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Agent</span>
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
              <option value="">Select agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.platform})
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="card stack">
          <h3>Register Agent</h3>
          <label className="field">
            <span>Agent Name</span>
            <input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} />
          </label>
          <label className="field">
            <span>Platform</span>
            <input value={newAgentPlatform} onChange={(event) => setNewAgentPlatform(event.target.value)} />
          </label>
          <button className="button" onClick={() => void registerAgent()}>
            Register Agent
          </button>
        </article>
      </div>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Agent Config</h3>
          <label className="field">
            <span>Config JSON</span>
            <textarea rows={6} value={configText} onChange={(event) => setConfigText(event.target.value)} />
          </label>
          <button className="button" onClick={() => void saveConfig()}>
            Save Config
          </button>
          {activeConfig ? (
            <p className="muted">
              Active config version: <span className="mono">v{activeConfig.version_number}</span>
            </p>
          ) : (
            <p className="muted">No config version stored yet.</p>
          )}
        </article>

        <article className="card stack">
          <h3>Command Queue</h3>
          <label className="field">
            <span>Command Type</span>
            <input value={commandType} onChange={(event) => setCommandType(event.target.value)} />
          </label>
          <label className="field">
            <span>Payload JSON</span>
            <textarea rows={6} value={commandPayloadText} onChange={(event) => setCommandPayloadText(event.target.value)} />
          </label>
          <div className="row wrap">
            <button className="button" onClick={() => void enqueueCommand()}>
              Enqueue
            </button>
            <button className="button secondary" onClick={() => void pullCommands()}>
              Pull (Claim)
            </button>
            <button className="button secondary" onClick={() => void loadCommands()}>
              Refresh
            </button>
          </div>

          {commands.length === 0 ? (
            <p className="muted">No commands yet.</p>
          ) : (
            <ul className="list">
              {commands.map((command) => (
                <li key={command.id}>
                  <span className="mono">{command.command_type}</span> - {command.status}
                  {command.status === "claimed" || command.status === "pending" ? (
                    <>
                      {" "}
                      <button className="button secondary" onClick={() => void acknowledgeCommand(command.id, "acknowledged")}>
                        Ack
                      </button>
                      <button className="button secondary" onClick={() => void acknowledgeCommand(command.id, "failed")}>
                        Fail
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {statusMessage ? <p className="muted">{statusMessage}</p> : null}
      {responsePayload ? <pre className="json small">{responsePayload}</pre> : null}
    </section>
  );
}

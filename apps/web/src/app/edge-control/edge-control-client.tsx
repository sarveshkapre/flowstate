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

type SyncCheckpoint = {
  id: string;
  agent_id: string;
  checkpoint_key: string;
  checkpoint_value: string;
  updated_at: string;
};

type EdgeAgentEvent = {
  id: string;
  agent_id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
};

type EdgeAgentHealth = {
  agent: EdgeAgent;
  heartbeat_lag_ms: number | null;
  stale_threshold_ms: number;
  is_stale: boolean;
  commands: {
    pending: number;
    claimed: number;
    failed: number;
    acknowledged: number;
  };
  checkpoints: SyncCheckpoint[];
  recent_events: EdgeAgentEvent[];
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
  const [events, setEvents] = useState<EdgeAgentEvent[]>([]);
  const [activeConfig, setActiveConfig] = useState<EdgeAgentConfig | null>(null);
  const [activeHealth, setActiveHealth] = useState<EdgeAgentHealth | null>(null);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [commandStatusFilter, setCommandStatusFilter] = useState<
    "all" | "pending" | "claimed" | "acknowledged" | "failed"
  >("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [eventLimit, setEventLimit] = useState("20");

  const [newAgentName, setNewAgentName] = useState("Mac Mini Runner");
  const [newAgentPlatform, setNewAgentPlatform] = useState("macOS");
  const [configText, setConfigText] = useState('{"flowVersionId":"latest","samplingIntervalMs":1000}');
  const [commandType, setCommandType] = useState("reload_flow");
  const [commandPayloadText, setCommandPayloadText] = useState('{"reason":"manual_update"}');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");
  const [responsePayload, setResponsePayload] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isLoadingCommands, setIsLoadingCommands] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store", headers: authHeaders(false) });
    const payload = (await response.json()) as { organizations?: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [authHeaders, selectedOrganizationId]);

  const loadProjects = useCallback(async () => {
    if (!selectedOrganizationId) {
      setProjects([]);
      setSelectedProjectId("");
      return;
    }

    setIsLoadingProjects(true);
    try {
      const response = await fetch(`/api/v2/projects?organizationId=${encodeURIComponent(selectedOrganizationId)}`, {
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
    } finally {
      setIsLoadingProjects(false);
    }
  }, [authHeaders, selectedOrganizationId, selectedProjectId]);

  const loadAgents = useCallback(async () => {
    if (!selectedProjectId) {
      setAgents([]);
      setSelectedAgentId("");
      return;
    }

    setIsLoadingAgents(true);
    try {
      const response = await fetch(`/api/v2/edge/agents?projectId=${encodeURIComponent(selectedProjectId)}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { agents?: EdgeAgent[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load edge agents.");
        setAgents([]);
        return;
      }

      const nextAgents = payload.agents ?? [];
      setAgents(nextAgents);

      if (!nextAgents.some((agent) => agent.id === selectedAgentId)) {
        setSelectedAgentId(nextAgents[0]?.id ?? "");
      }
    } finally {
      setIsLoadingAgents(false);
    }
  }, [authHeaders, selectedAgentId, selectedProjectId]);

  const loadCommands = useCallback(async () => {
    if (!selectedAgentId) {
      setCommands([]);
      return;
    }

    setIsLoadingCommands(true);
    try {
      const statusQuery = commandStatusFilter === "all" ? "" : `&status=${commandStatusFilter}`;
      const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands?limit=20${statusQuery}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { commands?: EdgeAgentCommand[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load commands.");
        setCommands([]);
        return;
      }

      setCommands(payload.commands ?? []);
    } finally {
      setIsLoadingCommands(false);
    }
  }, [authHeaders, commandStatusFilter, selectedAgentId]);

  const loadConfig = useCallback(async () => {
    if (!selectedAgentId) {
      setActiveConfig(null);
      return;
    }

    setIsLoadingConfig(true);
    try {
      const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/config`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { config?: EdgeAgentConfig | null; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load config.");
        setActiveConfig(null);
        return;
      }

      setActiveConfig(payload.config ?? null);
    } finally {
      setIsLoadingConfig(false);
    }
  }, [authHeaders, selectedAgentId]);

  const loadHealth = useCallback(async () => {
    if (!selectedAgentId) {
      setActiveHealth(null);
      return;
    }

    setIsLoadingHealth(true);
    try {
      const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/health`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { health?: EdgeAgentHealth; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load health.");
        setActiveHealth(null);
        return;
      }

      setActiveHealth(payload.health ?? null);
    } finally {
      setIsLoadingHealth(false);
    }
  }, [authHeaders, selectedAgentId]);

  const loadEvents = useCallback(async () => {
    if (!selectedAgentId) {
      setEvents([]);
      return;
    }

    const parsedLimit = Number(eventLimit);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 100) : 20;
    const query = new URLSearchParams({
      limit: String(safeLimit),
    });

    if (eventTypeFilter.trim()) {
      query.set("eventType", eventTypeFilter.trim());
    }

    setIsLoadingEvents(true);
    try {
      const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/events?${query.toString()}`, {
        cache: "no-store",
        headers: authHeaders(false),
      });
      const payload = (await response.json()) as { events?: EdgeAgentEvent[]; error?: string };

      if (!response.ok) {
        setError(payload.error || "Unable to load agent events.");
        setEvents([]);
        return;
      }

      setEvents(payload.events ?? []);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [authHeaders, eventLimit, eventTypeFilter, selectedAgentId]);

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
    void loadHealth();
    void loadEvents();
  }, [loadCommands, loadConfig, loadEvents, loadHealth]);

  async function registerAgent() {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setIsSubmitting(true);
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
      setError(payload.error || "Failed to register edge agent.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Agent registered: ${payload.agent.name}`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadAgents();
    setSelectedAgentId(payload.agent.id);
    setIsSubmitting(false);
  }

  async function saveConfig() {
    if (!selectedAgentId) {
      setError("Select an agent first.");
      return;
    }

    let config: unknown;
    try {
      config = JSON.parse(configText);
    } catch {
      setError("Config must be valid JSON.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/config`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ config }),
    });
    const payload = (await response.json()) as { config?: EdgeAgentConfig; error?: string };

    if (!response.ok || !payload.config) {
      setError(payload.error || "Failed to save agent config.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Config saved (v${payload.config.version_number}).`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadConfig();
    await loadHealth();
    setIsSubmitting(false);
  }

  async function enqueueCommand() {
    if (!selectedAgentId) {
      setError("Select an agent first.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(commandPayloadText);
    } catch {
      setError("Command payload must be valid JSON.");
      return;
    }

    setIsSubmitting(true);
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
      setError(body.error || "Failed to enqueue command.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Command queued: ${body.command.command_type}`);
    setResponsePayload(JSON.stringify(body, null, 2));
    await loadCommands();
    await loadHealth();
    setIsSubmitting(false);
  }

  async function pullCommands() {
    if (!selectedAgentId) {
      setError("Select an agent first.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands/pull`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ limit: 10 }),
    });
    const payload = (await response.json()) as { commands?: EdgeAgentCommand[]; error?: string };

    if (!response.ok) {
      setError(payload.error || "Command pull failed.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Pulled ${payload.commands?.length ?? 0} command(s).`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadCommands();
    await loadHealth();
    setIsSubmitting(false);
  }

  async function acknowledgeCommand(commandId: string, status: "acknowledged" | "failed") {
    if (!selectedAgentId) {
      setError("Select an agent first.");
      return;
    }

    setIsSubmitting(true);
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
      setError(payload.error || "Failed to acknowledge command.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Command ${status}.`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadCommands();
    await loadHealth();
    await loadEvents();
    setIsSubmitting(false);
  }

  async function enqueueDiagnosticCommand(command: "collect_diagnostics" | "flush_logs" | "restart_runtime") {
    if (!selectedAgentId) {
      setError("Select an agent first.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(`/api/v2/edge/agents/${selectedAgentId}/commands`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        commandType: command,
        payload: {
          requested_at: new Date().toISOString(),
          source: "edge-control-ui",
        },
      }),
    });
    const payload = (await response.json()) as { command?: EdgeAgentCommand; error?: string };

    if (!response.ok || !payload.command) {
      setError(payload.error || "Failed to enqueue diagnostic command.");
      setIsSubmitting(false);
      return;
    }

    setSuccess(`Diagnostic command queued: ${command}`);
    setResponsePayload(JSON.stringify(payload, null, 2));
    await loadCommands();
    await loadHealth();
    await loadEvents();
    setIsSubmitting(false);
  }

  return (
    <section className="panel stack">
      <h2>Edge Control v2</h2>
      <p className="muted">Manage edge agents, config versions, and command queue lifecycle on top of v2 APIs.</p>

      <article className="card stack">
        <h3>Access Context</h3>
        <div className="legacy-grid two-col">
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

      <div className="legacy-grid two-col">
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
          <p className="muted">
            {isLoadingProjects ? "Loading projects..." : null}
            {isLoadingAgents ? " Loading agents..." : null}
          </p>
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
          <button className="button" disabled={isSubmitting} onClick={() => void registerAgent()}>
            {isSubmitting ? "Working..." : "Register Agent"}
          </button>
        </article>
      </div>

      <div className="legacy-grid two-col">
        <article className="card stack">
          <h3>Agent Config</h3>
          <label className="field">
            <span>Config JSON</span>
            <textarea rows={6} value={configText} onChange={(event) => setConfigText(event.target.value)} />
          </label>
          <button className="button" disabled={isSubmitting || isLoadingConfig} onClick={() => void saveConfig()}>
            {isSubmitting ? "Saving..." : "Save Config"}
          </button>
          {activeConfig ? (
            <p className="muted">
              Active config version: <span className="mono">v{activeConfig.version_number}</span>
            </p>
          ) : (
            <p className="muted">No config version stored yet.</p>
          )}
          <div className="row wrap">
            <span className={`badge ${activeHealth?.is_stale ? "bad" : "good"}`}>
              {activeHealth?.is_stale ? "stale" : "healthy"}
            </span>
            <span className="mono">
              heartbeat lag:{" "}
              {activeHealth?.heartbeat_lag_ms === null || activeHealth?.heartbeat_lag_ms === undefined
                ? "n/a"
                : `${Math.round(activeHealth.heartbeat_lag_ms / 1000)}s`}
            </span>
            {isLoadingHealth ? <span className="muted">loading health...</span> : null}
          </div>
          {activeHealth ? (
            <>
              <p className="muted">
                commands: pending {activeHealth.commands.pending}, claimed {activeHealth.commands.claimed}, failed{" "}
                {activeHealth.commands.failed}, acked {activeHealth.commands.acknowledged}
              </p>
              <p className="muted">
                stale threshold: {Math.round(activeHealth.stale_threshold_ms / 1000)}s | last heartbeat:{" "}
                {activeHealth.agent.last_heartbeat_at ? new Date(activeHealth.agent.last_heartbeat_at).toLocaleString() : "never"}
              </p>
            </>
          ) : null}

          <div className="stack">
            <p className="muted">Recent checkpoints</p>
            {!activeHealth?.checkpoints?.length ? (
              <p className="muted">No checkpoints published by agent.</p>
            ) : (
              <ul className="list">
                {activeHealth.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <span className="mono">{checkpoint.checkpoint_key}</span>: {checkpoint.checkpoint_value}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        <article className="card stack">
          <h3>Command Queue</h3>
          <label className="field small">
            <span>Status Filter</span>
            <select
              value={commandStatusFilter}
              onChange={(event) =>
                setCommandStatusFilter(
                  event.target.value as "all" | "pending" | "claimed" | "acknowledged" | "failed",
                )
              }
            >
              <option value="all">all</option>
              <option value="pending">pending</option>
              <option value="claimed">claimed</option>
              <option value="acknowledged">acknowledged</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label className="field">
            <span>Command Type</span>
            <input value={commandType} onChange={(event) => setCommandType(event.target.value)} />
          </label>
          <label className="field">
            <span>Payload JSON</span>
            <textarea rows={6} value={commandPayloadText} onChange={(event) => setCommandPayloadText(event.target.value)} />
          </label>
          <div className="row wrap">
            <button className="button" disabled={isSubmitting} onClick={() => void enqueueCommand()}>
              {isSubmitting ? "Working..." : "Enqueue"}
            </button>
            <button className="button secondary" disabled={isSubmitting} onClick={() => void pullCommands()}>
              Pull (Claim)
            </button>
            <button className="button secondary" disabled={isLoadingCommands} onClick={() => void loadCommands()}>
              Refresh
            </button>
          </div>
          {isLoadingCommands ? <p className="muted">Loading commands...</p> : null}

          {commands.length === 0 ? (
            <p className="muted">No commands yet.</p>
          ) : (
            <ul className="list">
              {commands.map((command) => (
                <li key={command.id}>
                  <span className="mono">{command.command_type}</span>{" "}
                  <span
                    className={`badge ${
                      command.status === "acknowledged"
                        ? "good"
                        : command.status === "failed"
                          ? "bad"
                          : "warn"
                    }`}
                  >
                    {command.status}
                  </span>
                  {command.status === "claimed" || command.status === "pending" ? (
                    <>
                      {" "}
                      <button
                        className="button secondary"
                        disabled={isSubmitting}
                        onClick={() => void acknowledgeCommand(command.id, "acknowledged")}
                      >
                        Ack
                      </button>
                      <button
                        className="button secondary"
                        disabled={isSubmitting}
                        onClick={() => void acknowledgeCommand(command.id, "failed")}
                      >
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

      <div className="legacy-grid two-col">
        <article className="card stack">
          <h3>Remote Diagnostics</h3>
          <p className="muted">Queue common diagnostics commands without editing JSON payloads manually.</p>
          <div className="row wrap">
            <button
              className="button secondary"
              disabled={isSubmitting}
              onClick={() => void enqueueDiagnosticCommand("collect_diagnostics")}
            >
              Collect Diagnostics
            </button>
            <button
              className="button secondary"
              disabled={isSubmitting}
              onClick={() => void enqueueDiagnosticCommand("flush_logs")}
            >
              Flush Logs
            </button>
            <button
              className="button secondary"
              disabled={isSubmitting}
              onClick={() => void enqueueDiagnosticCommand("restart_runtime")}
            >
              Restart Runtime
            </button>
          </div>
          <p className="muted">
            Latest health signal:{" "}
            <span className={`badge ${activeHealth?.is_stale ? "bad" : "good"}`}>
              {activeHealth?.is_stale ? "stale" : "healthy"}
            </span>
          </p>
        </article>

        <article className="card stack">
          <h3>Event Stream</h3>
          <div className="legacy-grid two-col">
            <label className="field">
              <span>Event Type Filter</span>
              <input value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} />
            </label>
            <label className="field small">
              <span>Limit</span>
              <input value={eventLimit} onChange={(event) => setEventLimit(event.target.value)} />
            </label>
          </div>
          <button className="button secondary" disabled={isLoadingEvents} onClick={() => void loadEvents()}>
            {isLoadingEvents ? "Loading..." : "Refresh Events"}
          </button>
          {events.length === 0 ? (
            <p className="muted">No events for selected filter.</p>
          ) : (
            <ul className="list">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="mono">{event.event_type}</span> - {new Date(event.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {statusMessage ? <p className={`status ${statusTone}`}>{statusMessage}</p> : null}
      {responsePayload ? <pre className="json small">{responsePayload}</pre> : null}
    </section>
  );
}

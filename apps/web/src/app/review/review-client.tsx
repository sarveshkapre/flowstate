"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@flowstate/ui";

type QueueJob = {
  id: string;
  artifact_id: string;
  document_type: string;
  status: string;
  review_status: "pending" | "approved" | "rejected";
  reviewer: string | null;
  review_notes: string | null;
  result: unknown;
  validation: {
    is_valid: boolean;
    confidence: number;
    issues: Array<{ code: string; message: string; severity: "warning" | "error" }>;
  } | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  artifact_file_url?: string;
};

type AuditEvent = {
  id: string;
  event_type: string;
  job_id: string | null;
  actor: string | null;
  created_at: string;
};

export function ReviewClient() {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("ops@flowstate.local");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/v1/extractions?status=completed", { cache: "no-store" });
    const payload = (await response.json()) as { jobs: QueueJob[] };
    setJobs(payload.jobs ?? []);
  }, []);

  const loadEvents = useCallback(async () => {
    const response = await fetch("/api/v1/audit-events?limit=8", { cache: "no-store" });
    const payload = (await response.json()) as { events: AuditEvent[] };
    setRecentEvents(payload.events ?? []);
  }, []);

  useEffect(() => {
    void loadJobs();
    void loadEvents();
  }, [loadJobs, loadEvents]);

  const pendingCount = useMemo(
    () => jobs.filter((job) => job.review_status === "pending").length,
    [jobs],
  );

  async function review(jobId: string, reviewStatus: "approved" | "rejected") {
    setBusyJobId(jobId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/v1/extractions/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", reviewStatus, reviewer }),
      });

      if (!response.ok) {
        throw new Error("Failed to update review status.");
      }

      await loadJobs();
      await loadEvents();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown review error");
    } finally {
      setBusyJobId(null);
    }
  }

  async function assign(jobId: string) {
    setBusyJobId(jobId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/v1/extractions/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "assign", reviewer }),
      });

      if (!response.ok) {
        throw new Error("Failed to assign reviewer.");
      }

      await loadJobs();
      await loadEvents();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown assignment error");
    } finally {
      setBusyJobId(null);
    }
  }

  async function createSnapshot() {
    setStatusMessage(null);

    try {
      const response = await fetch("/api/v1/datasets/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewStatus: "approved" }),
      });

      const payload = (await response.json()) as {
        snapshot?: { file_name: string; item_count: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create snapshot");
      }

      setStatusMessage(
        `Snapshot created (${payload.snapshot?.item_count ?? 0} items): ${payload.snapshot?.file_name ?? ""}`,
      );
      await loadEvents();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown snapshot error");
    }
  }

  async function sendWebhook() {
    setStatusMessage(null);

    try {
      const response = await fetch("/api/v1/exports/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUrl: webhookUrl, reviewStatus: "approved" }),
      });

      const payload = (await response.json()) as { success?: boolean; error?: string; sent?: number };

      if (!response.ok) {
        throw new Error(payload.error || "Webhook dispatch failed.");
      }

      setStatusMessage(`Webhook sent successfully (${payload.sent ?? 0} records).`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown webhook error");
    }
  }

  return (
    <section className="panel stack">
      <div className="row between">
        <div>
          <h2>Review Queue</h2>
          <p className="muted">Completed extractions awaiting approval: {pendingCount}</p>
        </div>
        <Button variant="outline" onClick={() => void loadJobs()}>
          Refresh
        </Button>
      </div>

      <label className="field small">
        <span>Reviewer Name / Email</span>
        <Input value={reviewer} onChange={(event) => setReviewer(event.target.value)} />
      </label>

      <div className="stack">
        {jobs.length === 0 && <p className="muted">No completed jobs yet.</p>}

        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <div className="row between">
                <div>
                  <CardTitle>Job {job.id.slice(0, 8)}</CardTitle>
                  <p className="muted">{job.document_type}</p>
                </div>
                <div className="row wrap">
                  <Badge variant="outline">review: {job.review_status}</Badge>
                  <Badge variant="secondary">confidence: {job.validation?.confidence ?? "-"}</Badge>
                  <Badge variant="outline">reviewer: {job.reviewer ?? "unassigned"}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="stack">
              <div className="row wrap">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyJobId === job.id || !reviewer.trim()}
                  onClick={() => void assign(job.id)}
                >
                  Assign
                </Button>
                <Button
                  size="sm"
                  disabled={busyJobId === job.id}
                  onClick={() => void review(job.id, "approved")}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyJobId === job.id}
                  onClick={() => void review(job.id, "rejected")}
                >
                  Reject
                </Button>
              </div>

              {job.artifact_file_url && (
                <Button asChild variant="link" className="w-fit p-0">
                  <a href={job.artifact_file_url} target="_blank" rel="noreferrer">
                    Open artifact
                  </a>
                </Button>
              )}

              <pre className="json small">{JSON.stringify(job.result, null, 2)}</pre>

              {job.validation?.issues?.length ? (
                <ul className="issue-list">
                  {job.validation.issues.map((issue) => (
                    <li key={`${job.id}-${issue.code}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No validation issues.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="divider" />

      <h3>Export</h3>
      <div className="row wrap">
        <Button asChild variant="outline">
          <a href="/api/v1/exports/csv?reviewStatus=approved">Download Approved CSV</a>
        </Button>
        <Button variant="outline" onClick={() => void createSnapshot()}>
          Create Approved Snapshot
        </Button>
      </div>

      <label className="field">
        <span>Webhook URL</span>
        <Input
          placeholder="https://example.com/webhooks/flowstate"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
        />
      </label>
      <Button disabled={!webhookUrl.trim()} onClick={() => void sendWebhook()}>
        Send Approved Records to Webhook
      </Button>

      {statusMessage && <p className="muted">{statusMessage}</p>}

      <div className="divider" />
      <h3>Recent Audit Events</h3>
      <div className="stack">
        {recentEvents.map((event) => (
          <p key={event.id} className="mono">
            {event.created_at} • {event.event_type} • {event.actor ?? "system"} • {event.job_id ?? "-"}
          </p>
        ))}
      </div>
    </section>
  );
}

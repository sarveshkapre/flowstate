/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect } from "@flowstate/ui";

type EvalRun = {
  id: string;
  organization_id: string;
  review_status: "pending" | "approved" | "rejected";
  sample_limit: number;
  sample_count: number;
  avg_confidence: number;
  avg_field_coverage: number;
  error_rate: number;
  warning_rate: number;
  created_at: string;
};

type Organization = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
};

export function EvalsClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected" | "pending">("approved");
  const [sampleLimit, setSampleLimit] = useState(100);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sampledJobIds, setSampledJobIds] = useState<string[]>([]);

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store" });
    const payload = (await response.json()) as { organizations: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [selectedOrganizationId]);

  const loadRuns = useCallback(async () => {
    const query = selectedOrganizationId
      ? `/api/v1/evals/runs?organizationId=${encodeURIComponent(selectedOrganizationId)}&limit=50`
      : "/api/v1/evals/runs?limit=50";
    const response = await fetch(query, { cache: "no-store" });
    const payload = (await response.json()) as { runs: EvalRun[] };
    setRuns(payload.runs ?? []);
  }, [selectedOrganizationId]);

  useEffect(() => {
    void loadOrganizations();
    void loadRuns();
  }, [loadOrganizations, loadRuns]);

  async function createRun() {
    setStatusMessage(null);

    const response = await fetch("/api/v1/evals/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: selectedOrganizationId || undefined,
        reviewStatus,
        sampleLimit,
      }),
    });

    const payload = (await response.json()) as {
      run?: EvalRun;
      sampledJobIds?: string[];
      error?: string;
    };

    if (!response.ok || !payload.run) {
      setStatusMessage(payload.error || "Failed to run evaluation.");
      return;
    }

    setStatusMessage(
      `Eval run complete. confidence=${payload.run.avg_confidence.toFixed(3)} coverage=${payload.run.avg_field_coverage.toFixed(3)}`,
    );
    setSampledJobIds(payload.sampledJobIds ?? []);
    await loadRuns();
  }

  return (
    <section className="panel stack">
      <h2>Evaluation Runs</h2>
      <p className="muted">Generate repeatable quality baselines from reviewed extraction jobs.</p>

      <Card className="stack">
        <CardHeader>
          <CardTitle>Create Run</CardTitle>
        </CardHeader>
        <CardContent className="stack">

          <label className="field small">
            <span>Organization</span>
            <NativeSelect value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}>
              <option value="">Select organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </label>

          <label className="field small">
            <span>Review Status Slice</span>
            <NativeSelect value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as typeof reviewStatus)}>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
            </NativeSelect>
          </label>

          <label className="field small">
            <span>Sample Limit</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={sampleLimit}
              onChange={(event) => setSampleLimit(Number(event.target.value))}
            />
          </label>

          <Button onClick={() => void createRun()}>Run Evaluation</Button>

          {statusMessage && <p className="muted">{statusMessage}</p>}
          {sampledJobIds.length > 0 && (
            <p className="mono">sampled jobs: {sampledJobIds.slice(0, 10).join(", ")}</p>
          )}
        </CardContent>
      </Card>

      <div className="divider" />
      <h3>History</h3>
      <div className="stack">
        {runs.length === 0 && <p className="muted">No eval runs yet.</p>}
        {runs.map((run) => (
          <Card key={run.id}>
            <CardContent className="stack pt-5">
              <p className="mono">run {run.id.slice(0, 8)}</p>
              <p className="muted">
                status slice: {run.review_status} • sample: {run.sample_count}/{run.sample_limit}
              </p>
              <p className="muted">
                confidence: {run.avg_confidence.toFixed(3)} • coverage: {run.avg_field_coverage.toFixed(3)}
              </p>
              <p className="muted">
                error rate: {run.error_rate.toFixed(3)} • warning rate: {run.warning_rate.toFixed(3)}
              </p>
              <p className="muted">created: {run.created_at}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

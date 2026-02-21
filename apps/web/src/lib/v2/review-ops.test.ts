import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRegionRecord, ReviewDecisionRecord, RunRecordV2 } from "@flowstate/types";

import { summarizeReviewQueues } from "./review-ops.ts";

const NOW_MS = Date.parse("2026-02-21T12:00:00.000Z");

function run(overrides: Partial<RunRecordV2>): RunRecordV2 {
  return {
    id: "run-id",
    project_id: "project-id",
    flow_id: "flow-id",
    flow_version_id: "flow-version-id",
    deployment_id: null,
    status: "completed",
    input_ref: null,
    output_ref: null,
    error_message: null,
    created_at: "2026-02-21T09:00:00.000Z",
    updated_at: "2026-02-21T09:00:00.000Z",
    ...overrides,
  };
}

function decision(overrides: Partial<ReviewDecisionRecord>): ReviewDecisionRecord {
  return {
    id: "decision-id",
    project_id: "project-id",
    run_id: "run-id",
    field_name: "total",
    decision: "correct",
    failure_reason: null,
    reviewer: "reviewer@flowstate.dev",
    notes: null,
    created_at: "2026-02-21T10:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRegionRecord>): EvidenceRegionRecord {
  return {
    id: "evidence-id",
    review_decision_id: "decision-id",
    page: 0,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
    created_at: "2026-02-21T10:01:00.000Z",
    ...overrides,
  };
}

test("summarizeReviewQueues prioritizes unreviewed and at-risk queues", () => {
  const result = summarizeReviewQueues({
    nowMs: NOW_MS,
    staleAfterMs: 90 * 60 * 1000,
    runs: [
      run({ id: "run-unreviewed", created_at: "2026-02-21T08:00:00.000Z" }),
      run({ id: "run-at-risk", created_at: "2026-02-21T08:30:00.000Z" }),
      run({ id: "run-healthy", created_at: "2026-02-21T08:45:00.000Z" }),
      run({ id: "run-stale", created_at: "2026-02-21T07:00:00.000Z" }),
    ],
    decisions: [
      decision({ id: "d1", run_id: "run-at-risk", decision: "incorrect", created_at: "2026-02-21T11:30:00.000Z" }),
      decision({ id: "d2", run_id: "run-at-risk", decision: "correct", created_at: "2026-02-21T11:31:00.000Z" }),
      decision({ id: "d3", run_id: "run-healthy", decision: "correct", created_at: "2026-02-21T11:35:00.000Z" }),
      decision({ id: "d4", run_id: "run-stale", decision: "correct", created_at: "2026-02-21T08:30:00.000Z" }),
    ],
    evidenceRegions: [
      evidence({ id: "e1", review_decision_id: "d1" }),
      evidence({ id: "e2", review_decision_id: "d2" }),
      evidence({ id: "e3", review_decision_id: "d4" }),
    ],
  });

  assert.equal(result.summary.total_queues, 4);
  assert.equal(result.summary.unreviewed_queues, 1);
  assert.equal(result.summary.at_risk_queues, 1);
  assert.equal(result.summary.stale_queues, 1);
  assert.equal(result.summary.healthy_queues, 1);
  assert.equal(result.summary.total_decisions, 4);
  assert.equal(result.summary.total_evidence_regions, 3);
  assert.equal(result.summary.avg_error_rate, 0.25);

  assert.equal(result.queues[0]?.run_id, "run-unreviewed");
  assert.equal(result.queues[0]?.health, "unreviewed");
  assert.equal(result.queues[1]?.run_id, "run-at-risk");
  assert.equal(result.queues[1]?.health, "at_risk");
  assert.equal(result.queues[2]?.run_id, "run-stale");
  assert.equal(result.queues[2]?.health, "stale");
  assert.equal(result.queues[3]?.run_id, "run-healthy");
  assert.equal(result.queues[3]?.health, "healthy");
});

test("summarizeReviewQueues respects queue limit after sorting", () => {
  const result = summarizeReviewQueues({
    nowMs: NOW_MS,
    limit: 2,
    runs: [
      run({ id: "run-1" }),
      run({ id: "run-2" }),
      run({ id: "run-3" }),
    ],
    decisions: [
      decision({ id: "d1", run_id: "run-2", decision: "incorrect" }),
      decision({ id: "d2", run_id: "run-3", decision: "correct" }),
    ],
    evidenceRegions: [],
  });

  assert.equal(result.summary.total_queues, 2);
  assert.equal(result.queues.length, 2);
  assert.equal(result.queues[0]?.run_id, "run-1");
  assert.equal(result.queues[1]?.run_id, "run-2");
});

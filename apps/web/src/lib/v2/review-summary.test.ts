import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewDecisionRecord } from "@flowstate/types";

import { summarizeReviewDecisions } from "./review-summary.ts";

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
    created_at: "2026-02-21T00:00:00.000Z",
    ...overrides,
  };
}

test("summarizeReviewDecisions returns an empty summary for no decisions", () => {
  const summary = summarizeReviewDecisions([]);

  assert.equal(summary.total, 0);
  assert.equal(summary.error_rate, 0);
  assert.equal(summary.by_decision.correct, 0);
  assert.equal(summary.by_decision.incorrect, 0);
  assert.equal(summary.failure_hotspots.length, 0);
  assert.equal(summary.field_hotspots.length, 0);
});

test("summarizeReviewDecisions aggregates decisions, hotspots, and reviewer activity", () => {
  const summary = summarizeReviewDecisions([
    decision({ id: "d1", field_name: "total", decision: "incorrect", failure_reason: "math_mismatch" }),
    decision({ id: "d2", field_name: "total", decision: "incorrect", failure_reason: "math_mismatch" }),
    decision({ id: "d3", field_name: "vendor", decision: "missing", failure_reason: "missing_field" }),
    decision({ id: "d4", field_name: "date", decision: "correct", failure_reason: null, reviewer: "qa@flowstate.dev" }),
    decision({ id: "d5", field_name: "vendor", decision: "uncertain", failure_reason: "wrong_date", reviewer: null }),
  ]);

  assert.equal(summary.total, 5);
  assert.equal(summary.error_rate, 0.8);
  assert.deepEqual(summary.by_decision, {
    correct: 1,
    incorrect: 2,
    missing: 1,
    uncertain: 1,
  });
  assert.deepEqual(summary.failure_hotspots[0], { reason: "math_mismatch", count: 2 });
  assert.deepEqual(summary.field_hotspots[0], { field_name: "total", total: 2, non_correct: 2 });
  assert.deepEqual(summary.reviewer_activity[0], { reviewer: "reviewer@flowstate.dev", count: 3 });
  assert.ok(summary.reviewer_activity.some((entry) => entry.reviewer === "unassigned"));
});

import type { EvidenceRegionRecord, ReviewDecisionRecord, RunRecordV2 } from "@flowstate/types";

export type ReviewQueueHealth = "unreviewed" | "at_risk" | "stale" | "healthy";

export type ReviewQueueOpsItem = {
  run_id: string;
  run_status: RunRecordV2["status"];
  created_at: string;
  updated_at: string;
  decisions_total: number;
  correct_count: number;
  non_correct_count: number;
  uncertain_count: number;
  evidence_count: number;
  error_rate: number;
  last_reviewed_at: string | null;
  minutes_since_review: number | null;
  health: ReviewQueueHealth;
};

export type ReviewQueueOpsSummary = {
  total_queues: number;
  unreviewed_queues: number;
  at_risk_queues: number;
  stale_queues: number;
  healthy_queues: number;
  total_decisions: number;
  total_evidence_regions: number;
  avg_error_rate: number;
};

export type ReviewQueueOpsResult = {
  summary: ReviewQueueOpsSummary;
  queues: ReviewQueueOpsItem[];
};

function asTimestamp(iso: string | null) {
  if (!iso) {
    return null;
  }

  const value = Date.parse(iso);
  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function computeHealth(input: {
  decisionsTotal: number;
  nonCorrectCount: number;
  stale: boolean;
}): ReviewQueueHealth {
  if (input.decisionsTotal === 0) {
    return "unreviewed";
  }

  if (input.nonCorrectCount > 0) {
    return "at_risk";
  }

  if (input.stale) {
    return "stale";
  }

  return "healthy";
}

const HEALTH_PRIORITY: Record<ReviewQueueHealth, number> = {
  unreviewed: 0,
  at_risk: 1,
  stale: 2,
  healthy: 3,
};

export function summarizeReviewQueues(input: {
  runs: RunRecordV2[];
  decisions: ReviewDecisionRecord[];
  evidenceRegions: EvidenceRegionRecord[];
  staleAfterMs?: number;
  nowMs?: number;
  limit?: number;
}): ReviewQueueOpsResult {
  const staleAfterMs = input.staleAfterMs ?? 24 * 60 * 60 * 1000;
  const nowMs = input.nowMs ?? Date.now();
  const decisionsByRun = new Map<string, ReviewDecisionRecord[]>();
  const decisionToRun = new Map<string, string>();

  for (const decision of input.decisions) {
    const existing = decisionsByRun.get(decision.run_id) ?? [];
    existing.push(decision);
    decisionsByRun.set(decision.run_id, existing);
    decisionToRun.set(decision.id, decision.run_id);
  }

  const evidenceCountByRun = new Map<string, number>();
  for (const evidence of input.evidenceRegions) {
    const runId = decisionToRun.get(evidence.review_decision_id);
    if (!runId) {
      continue;
    }
    evidenceCountByRun.set(runId, (evidenceCountByRun.get(runId) ?? 0) + 1);
  }

  const queues = input.runs.map((run) => {
    const decisions = decisionsByRun.get(run.id) ?? [];
    let correctCount = 0;
    let uncertainCount = 0;
    let nonCorrectCount = 0;
    let lastReviewedAt: string | null = null;
    let lastReviewedTs: number | null = null;

    for (const decision of decisions) {
      if (decision.decision === "correct") {
        correctCount += 1;
      } else if (decision.decision === "uncertain") {
        uncertainCount += 1;
        nonCorrectCount += 1;
      } else {
        nonCorrectCount += 1;
      }

      const ts = asTimestamp(decision.created_at);
      if (ts !== null && (lastReviewedTs === null || ts > lastReviewedTs)) {
        lastReviewedTs = ts;
        lastReviewedAt = decision.created_at;
      }
    }

    const decisionsTotal = decisions.length;
    const errorRate = decisionsTotal > 0 ? nonCorrectCount / decisionsTotal : 0;
    const stale = lastReviewedTs !== null && nowMs - lastReviewedTs > staleAfterMs;
    const minutesSinceReview = lastReviewedTs === null ? null : Math.max(0, Math.floor((nowMs - lastReviewedTs) / 60_000));

    return {
      run_id: run.id,
      run_status: run.status,
      created_at: run.created_at,
      updated_at: run.updated_at,
      decisions_total: decisionsTotal,
      correct_count: correctCount,
      non_correct_count: nonCorrectCount,
      uncertain_count: uncertainCount,
      evidence_count: evidenceCountByRun.get(run.id) ?? 0,
      error_rate: Number(errorRate.toFixed(4)),
      last_reviewed_at: lastReviewedAt,
      minutes_since_review: minutesSinceReview,
      health: computeHealth({
        decisionsTotal,
        nonCorrectCount,
        stale,
      }),
    } satisfies ReviewQueueOpsItem;
  });

  queues.sort((a, b) => {
    const healthDelta = HEALTH_PRIORITY[a.health] - HEALTH_PRIORITY[b.health];
    if (healthDelta !== 0) {
      return healthDelta;
    }

    if (b.non_correct_count !== a.non_correct_count) {
      return b.non_correct_count - a.non_correct_count;
    }

    if (b.error_rate !== a.error_rate) {
      return b.error_rate - a.error_rate;
    }

    const aAge = a.minutes_since_review ?? Math.max(0, Math.floor((nowMs - (asTimestamp(a.created_at) ?? nowMs)) / 60_000));
    const bAge = b.minutes_since_review ?? Math.max(0, Math.floor((nowMs - (asTimestamp(b.created_at) ?? nowMs)) / 60_000));
    if (bAge !== aAge) {
      return bAge - aAge;
    }

    return a.run_id.localeCompare(b.run_id);
  });

  const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : undefined;
  const limitedQueues = limit ? queues.slice(0, limit) : queues;

  let totalDecisions = 0;
  let totalNonCorrect = 0;
  let totalEvidenceRegions = 0;
  let unreviewed = 0;
  let atRisk = 0;
  let stale = 0;
  let healthy = 0;

  for (const queue of limitedQueues) {
    totalDecisions += queue.decisions_total;
    totalNonCorrect += queue.non_correct_count;
    totalEvidenceRegions += queue.evidence_count;

    if (queue.health === "unreviewed") {
      unreviewed += 1;
    } else if (queue.health === "at_risk") {
      atRisk += 1;
    } else if (queue.health === "stale") {
      stale += 1;
    } else {
      healthy += 1;
    }
  }

  return {
    summary: {
      total_queues: limitedQueues.length,
      unreviewed_queues: unreviewed,
      at_risk_queues: atRisk,
      stale_queues: stale,
      healthy_queues: healthy,
      total_decisions: totalDecisions,
      total_evidence_regions: totalEvidenceRegions,
      avg_error_rate: totalDecisions > 0 ? Number((totalNonCorrect / totalDecisions).toFixed(4)) : 0,
    },
    queues: limitedQueues,
  };
}

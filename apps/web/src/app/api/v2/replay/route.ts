import { NextResponse } from "next/server";
import { z } from "zod";

import { getFlowV2, getFlowVersion, readDatasetVersionLines } from "@/lib/data-store-v2";
import { executeFlowVersionRun } from "@/lib/v2/flow-runtime";
import { requirePermission } from "@/lib/v2/auth";

const replaySchema = z.object({
  projectId: z.string().min(1),
  flowId: z.string().min(1),
  flowVersionId: z.string().min(1),
  baselineFlowVersionId: z.string().min(1).optional(),
  datasetVersionId: z.string().min(1),
  limit: z.number().int().positive().max(1000).optional(),
});

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function expectedFromInput(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  const expected = record.expected ?? record.ground_truth;

  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return null;
  }

  return expected as JsonRecord;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b));
    const mapped = entries.map(([key, item]) => `"${key}":${stableStringify(item)}`);
    return `{${mapped.join(",")}}`;
  }

  return JSON.stringify(value);
}

function extractFinalOutput(value: unknown): JsonRecord {
  const root = asRecord(value);
  return asRecord(root.final);
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = replaySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const flow = await getFlowV2(parsed.data.flowId);
  const flowVersion = await getFlowVersion(parsed.data.flowVersionId);

  if (!flow || flow.project_id !== parsed.data.projectId) {
    return NextResponse.json({ error: "Flow not found in project" }, { status: 404 });
  }

  if (!flowVersion || flowVersion.flow_id !== flow.id) {
    return NextResponse.json({ error: "Flow version not found" }, { status: 404 });
  }

  const baselineVersion = parsed.data.baselineFlowVersionId
    ? await getFlowVersion(parsed.data.baselineFlowVersionId)
    : null;

  if (parsed.data.baselineFlowVersionId && (!baselineVersion || baselineVersion.flow_id !== flow.id)) {
    return NextResponse.json({ error: "Baseline flow version not found" }, { status: 404 });
  }

  const lines = await readDatasetVersionLines(parsed.data.datasetVersionId);

  if (!lines) {
    return NextResponse.json({ error: "Dataset version not found" }, { status: 404 });
  }

  const lineLimit = parsed.data.limit ?? lines.length;
  const selected = lines.slice(0, lineLimit);

  const runs = [] as Array<{
    index: number;
    candidate_run_id: string | null;
    candidate_status: string | null;
    baseline_run_id: string | null;
    baseline_status: string | null;
    changed_fields: string[];
    expected_mismatches: string[];
  }>;
  const fieldStats = new Map<string, { total: number; correct: number }>();

  let candidateSuccessCount = 0;
  let baselineSuccessCount = 0;
  let comparedWithExpectedCount = 0;
  let changedVsBaselineCount = 0;

  for (const [index, line] of selected.entries()) {
    const parsedLine = JSON.parse(line) as unknown;
    const candidate = await executeFlowVersionRun({
      projectId: parsed.data.projectId,
      flowId: flow.id,
      flowVersion,
      payload: parsedLine,
    });

    const baseline = baselineVersion
      ? await executeFlowVersionRun({
          projectId: parsed.data.projectId,
          flowId: flow.id,
          flowVersion: baselineVersion,
          payload: parsedLine,
        })
      : null;

    if (candidate.run?.status === "completed") {
      candidateSuccessCount += 1;
    }

    if (baseline?.run?.status === "completed") {
      baselineSuccessCount += 1;
    }

    const candidateOutput = extractFinalOutput(candidate.output);
    const baselineOutput = extractFinalOutput(baseline?.output);
    const expected = expectedFromInput(parsedLine);
    const changedFields: string[] = [];
    const expectedMismatches: string[] = [];

    if (baseline) {
      const comparisonFields = new Set<string>([...Object.keys(candidateOutput), ...Object.keys(baselineOutput)]);
      for (const field of comparisonFields) {
        if (stableStringify(candidateOutput[field]) !== stableStringify(baselineOutput[field])) {
          changedFields.push(field);
        }
      }

      if (changedFields.length > 0) {
        changedVsBaselineCount += 1;
      }
    }

    if (expected) {
      comparedWithExpectedCount += 1;
      const fields = new Set<string>([...Object.keys(expected), ...Object.keys(candidateOutput)]);

      for (const field of fields) {
        const stats = fieldStats.get(field) ?? { total: 0, correct: 0 };
        stats.total += 1;
        const isCorrect = stableStringify(candidateOutput[field]) === stableStringify(expected[field]);
        if (isCorrect) {
          stats.correct += 1;
        } else {
          expectedMismatches.push(field);
        }
        fieldStats.set(field, stats);
      }
    }

    runs.push({
      index,
      candidate_run_id: candidate.run?.id ?? null,
      candidate_status: candidate.run?.status ?? null,
      baseline_run_id: baseline?.run?.id ?? null,
      baseline_status: baseline?.run?.status ?? null,
      changed_fields: changedFields,
      expected_mismatches: expectedMismatches,
    });
  }

  const comparedCount = runs.length || 1;
  const field_accuracy = Array.from(fieldStats.entries())
    .map(([field, stats]) => ({
      field,
      correct: stats.correct,
      total: stats.total,
      accuracy: Number((stats.correct / Math.max(stats.total, 1)).toFixed(4)),
    }))
    .sort((a, b) => a.field.localeCompare(b.field));

  return NextResponse.json({
    replay_count: runs.length,
    flow_id: flow.id,
    flow_version_id: flowVersion.id,
    baseline_flow_version_id: baselineVersion?.id ?? null,
    summary: {
      candidate_success_rate: Number((candidateSuccessCount / comparedCount).toFixed(4)),
      baseline_success_rate: baselineVersion ? Number((baselineSuccessCount / comparedCount).toFixed(4)) : null,
      changed_vs_baseline_count: baselineVersion ? changedVsBaselineCount : null,
      compared_with_expected_count: comparedWithExpectedCount,
      field_accuracy,
    },
    runs,
  });
}

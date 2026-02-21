import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyConnectorBackpressurePolicyDraft,
  listConnectorBackpressurePolicyDrafts,
  listProjects,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { evaluateConnectorBackpressureDraftActivation } from "@/lib/v2/connector-backpressure-draft-activation";

const activateDraftsSchema = z.object({
  dryRun: z.boolean().default(false),
  projectIds: z.array(z.string().min(1)).max(500).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

type ActivationResult = {
  project_id: string;
  project_name: string | null;
  draft_id: string;
  status: "ready" | "blocked" | "applied" | "failed";
  reason: "activation_time_pending" | "approvals_pending" | "apply_failed" | null;
  message: string | null;
  activate_at: string | null;
  required_approvals: number;
  approval_count: number;
  approvals_remaining: number;
  activation_ready: boolean;
  policy_id: string | null;
};

function sortByActivationAndUpdatedAt<T extends { activate_at: string | null; updated_at: string }>(drafts: T[]) {
  return [...drafts].sort((left, right) => {
    const leftActivationMs = left.activate_at ? Date.parse(left.activate_at) : Number.NEGATIVE_INFINITY;
    const rightActivationMs = right.activate_at ? Date.parse(right.activate_at) : Number.NEGATIVE_INFINITY;

    if (leftActivationMs !== rightActivationMs) {
      return leftActivationMs - rightActivationMs;
    }

    return Date.parse(left.updated_at) - Date.parse(right.updated_at);
  });
}

export async function POST(request: Request) {
  const auth = await requirePermission({
    request,
    permission: "manage_project",
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = (await request.json().catch(() => null)) ?? {};
  const parsed = activateDraftsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const actor = auth.actor.email ?? "api-key";
  const requestedProjectIds = parsed.data.projectIds ? [...new Set(parsed.data.projectIds)] : null;

  const projects = await listProjects({
    organizationId: auth.actor.type === "api_key" ? (auth.actor.organizationId ?? undefined) : undefined,
    isActive: true,
  });

  let visibleProjectIds = projects.map((project) => project.id);

  if (auth.actor.type === "api_key" && auth.actor.projectId) {
    visibleProjectIds = visibleProjectIds.filter((projectId) => projectId === auth.actor.projectId);
  }

  if (requestedProjectIds) {
    const requestedSet = new Set(requestedProjectIds);
    visibleProjectIds = visibleProjectIds.filter((projectId) => requestedSet.has(projectId));
  }

  const visibleProjectIdSet = new Set(visibleProjectIds);
  const projectNameById = new Map(
    projects
      .filter((project) => visibleProjectIdSet.has(project.id))
      .map((project) => [project.id, project.name] as const),
  );

  if (visibleProjectIds.length === 0) {
    return NextResponse.json({
      dry_run: parsed.data.dryRun,
      limit: parsed.data.limit,
      project_count: 0,
      total_draft_count: 0,
      scanned_draft_count: 0,
      limited: false,
      ready_count: 0,
      blocked_count: 0,
      applied_count: 0,
      failed_count: 0,
      results: [] as ActivationResult[],
    });
  }

  const drafts = await listConnectorBackpressurePolicyDrafts({
    projectIds: visibleProjectIds,
  });

  const sorted = sortByActivationAndUpdatedAt(drafts);
  const selectedDrafts = sorted.slice(0, parsed.data.limit);
  const results: ActivationResult[] = [];

  for (const draft of selectedDrafts) {
    const decision = evaluateConnectorBackpressureDraftActivation({
      draft,
    });

    if (!decision.ready) {
      results.push({
        project_id: draft.project_id,
        project_name: projectNameById.get(draft.project_id) ?? null,
        draft_id: draft.id,
        status: "blocked",
        reason: decision.reason,
        message:
          decision.reason === "activation_time_pending"
            ? draft.activate_at
              ? `Activation scheduled for ${new Date(draft.activate_at).toISOString()}`
              : "Activation time is not yet available"
            : `${decision.approvals_remaining} approval(s) remaining`,
        activate_at: draft.activate_at,
        required_approvals: decision.required_approvals,
        approval_count: decision.approval_count,
        approvals_remaining: decision.approvals_remaining,
        activation_ready: decision.activation_ready,
        policy_id: null,
      });
      continue;
    }

    if (parsed.data.dryRun) {
      results.push({
        project_id: draft.project_id,
        project_name: projectNameById.get(draft.project_id) ?? null,
        draft_id: draft.id,
        status: "ready",
        reason: null,
        message: "Draft is ready to activate",
        activate_at: draft.activate_at,
        required_approvals: decision.required_approvals,
        approval_count: decision.approval_count,
        approvals_remaining: decision.approvals_remaining,
        activation_ready: decision.activation_ready,
        policy_id: null,
      });
      continue;
    }

    try {
      const policy = await applyConnectorBackpressurePolicyDraft({
        projectId: draft.project_id,
        actor,
        creditActorApproval: false,
      });

      results.push({
        project_id: draft.project_id,
        project_name: projectNameById.get(draft.project_id) ?? null,
        draft_id: draft.id,
        status: "applied",
        reason: null,
        message: "Draft activated",
        activate_at: draft.activate_at,
        required_approvals: decision.required_approvals,
        approval_count: decision.approval_count,
        approvals_remaining: 0,
        activation_ready: decision.activation_ready,
        policy_id: policy.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply connector backpressure draft";
      results.push({
        project_id: draft.project_id,
        project_name: projectNameById.get(draft.project_id) ?? null,
        draft_id: draft.id,
        status: "failed",
        reason: "apply_failed",
        message,
        activate_at: draft.activate_at,
        required_approvals: decision.required_approvals,
        approval_count: decision.approval_count,
        approvals_remaining: decision.approvals_remaining,
        activation_ready: decision.activation_ready,
        policy_id: null,
      });
    }
  }

  const readyCount = results.filter((item) => item.status === "ready").length;
  const blockedCount = results.filter((item) => item.status === "blocked").length;
  const appliedCount = results.filter((item) => item.status === "applied").length;
  const failedCount = results.filter((item) => item.status === "failed").length;

  return NextResponse.json({
    dry_run: parsed.data.dryRun,
    limit: parsed.data.limit,
    project_count: visibleProjectIds.length,
    total_draft_count: drafts.length,
    scanned_draft_count: selectedDrafts.length,
    limited: drafts.length > selectedDrafts.length,
    ready_count: readyCount,
    blocked_count: blockedCount,
    applied_count: appliedCount,
    failed_count: failedCount,
    results,
  });
}

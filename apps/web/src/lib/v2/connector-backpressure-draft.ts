export type ConnectorBackpressureDraftApproval = {
  actor: string;
  approved_at: string;
};

export type ConnectorBackpressureDraftConstraints = {
  required_approvals: number;
  approvals: ConnectorBackpressureDraftApproval[];
  activate_at: string | null;
};

export type ConnectorBackpressureDraftReadiness = {
  approval_count: number;
  required_approvals: number;
  approvals_remaining: number;
  actor_counted: boolean;
  activation_ready: boolean;
  ready: boolean;
};

function parseActivationMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const activationMs = Date.parse(value);
  return Number.isFinite(activationMs) ? activationMs : null;
}

export function computeConnectorBackpressureDraftReadiness(input: {
  draft: ConnectorBackpressureDraftConstraints;
  actor?: string | null;
  nowMs?: number;
}): ConnectorBackpressureDraftReadiness {
  const nowMs = input.nowMs ?? Date.now();
  const approvalActors = new Set(
    input.draft.approvals
      .map((approval) => approval.actor.trim().toLowerCase())
      .filter((actor) => actor.length > 0),
  );

  const actor = input.actor?.trim().toLowerCase() ?? "";
  let actorCounted = false;
  if (actor.length > 0 && !approvalActors.has(actor)) {
    approvalActors.add(actor);
    actorCounted = true;
  }

  const approvalCount = approvalActors.size;
  const requiredApprovals = Math.max(1, Math.min(10, Math.floor(input.draft.required_approvals || 1)));
  const approvalsRemaining = Math.max(0, requiredApprovals - approvalCount);

  const activationMs = parseActivationMs(input.draft.activate_at);
  const activationReady = activationMs === null || activationMs <= nowMs;

  return {
    approval_count: approvalCount,
    required_approvals: requiredApprovals,
    approvals_remaining: approvalsRemaining,
    actor_counted: actorCounted,
    activation_ready: activationReady,
    ready: approvalsRemaining === 0 && activationReady,
  };
}

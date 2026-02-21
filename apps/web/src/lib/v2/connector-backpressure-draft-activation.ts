import type { ConnectorBackpressurePolicyDraftRecord } from "@flowstate/types";

import { computeConnectorBackpressureDraftReadiness } from "./connector-backpressure-draft.ts";

export type ConnectorBackpressureDraftActivationBlockReason =
  | "activation_time_pending"
  | "approvals_pending"
  | null;

export type ConnectorBackpressureDraftActivationDecision = {
  ready: boolean;
  reason: ConnectorBackpressureDraftActivationBlockReason;
  approval_count: number;
  required_approvals: number;
  approvals_remaining: number;
  activation_ready: boolean;
};

export function evaluateConnectorBackpressureDraftActivation(input: {
  draft: Pick<ConnectorBackpressurePolicyDraftRecord, "required_approvals" | "approvals" | "activate_at">;
  nowMs?: number;
}): ConnectorBackpressureDraftActivationDecision {
  const readiness = computeConnectorBackpressureDraftReadiness({
    draft: input.draft,
    actor: null,
    nowMs: input.nowMs,
  });

  if (!readiness.activation_ready) {
    return {
      ready: false,
      reason: "activation_time_pending",
      approval_count: readiness.approval_count,
      required_approvals: readiness.required_approvals,
      approvals_remaining: readiness.approvals_remaining,
      activation_ready: readiness.activation_ready,
    };
  }

  if (readiness.approvals_remaining > 0) {
    return {
      ready: false,
      reason: "approvals_pending",
      approval_count: readiness.approval_count,
      required_approvals: readiness.required_approvals,
      approvals_remaining: readiness.approvals_remaining,
      activation_ready: readiness.activation_ready,
    };
  }

  return {
    ready: true,
    reason: null,
    approval_count: readiness.approval_count,
    required_approvals: readiness.required_approvals,
    approvals_remaining: readiness.approvals_remaining,
    activation_ready: readiness.activation_ready,
  };
}

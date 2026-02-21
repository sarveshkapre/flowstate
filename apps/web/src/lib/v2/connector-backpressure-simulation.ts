import type { ConnectorBackpressurePolicyRecord } from "@flowstate/types";

import { resolveConnectorProcessBackpressure, type ConnectorQueuePressureSummary } from "./connector-backpressure.ts";
import { resolveConnectorBackpressureConfig, type ConnectorBackpressureRequestConfig } from "./connector-backpressure-policy.ts";
import { canonicalConnectorType } from "./connectors.ts";

const DEFAULT_POLICY = {
  is_enabled: true,
  max_retrying: 50,
  max_due_now: 100,
  min_limit: 1,
} as const;

function clampPositiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function clampNonNegativeInt(value: number | undefined) {
  if (!Number.isFinite(value) || typeof value !== "number" || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

type ConnectorOverrideRecord = {
  is_enabled: boolean;
  max_retrying: number;
  max_due_now: number;
  min_limit: number;
};

type ConnectorOverridePatch = {
  isEnabled?: boolean;
  enabled?: boolean;
  maxRetrying?: number;
  maxDueNow?: number;
  minLimit?: number;
};

function normalizeConnectorOverrides(input: {
  overrides?: Record<string, ConnectorOverridePatch>;
  basePolicy: ConnectorBackpressurePolicyRecord | null;
}): Record<string, ConnectorOverrideRecord> {
  if (!input.overrides) {
    return input.basePolicy?.connector_overrides ?? {};
  }

  const next: Record<string, ConnectorOverrideRecord> = {};
  for (const [rawConnectorType, overridePatch] of Object.entries(input.overrides)) {
    const connectorType = canonicalConnectorType(rawConnectorType);
    if (!connectorType) {
      continue;
    }

    const baseOverride = input.basePolicy?.connector_overrides?.[connectorType];
    const fallbackEnabled = baseOverride?.is_enabled ?? input.basePolicy?.is_enabled ?? DEFAULT_POLICY.is_enabled;
    const fallbackMaxRetrying = baseOverride?.max_retrying ?? input.basePolicy?.max_retrying ?? DEFAULT_POLICY.max_retrying;
    const fallbackMaxDueNow = baseOverride?.max_due_now ?? input.basePolicy?.max_due_now ?? DEFAULT_POLICY.max_due_now;
    const fallbackMinLimit = baseOverride?.min_limit ?? input.basePolicy?.min_limit ?? DEFAULT_POLICY.min_limit;

    next[connectorType] = {
      is_enabled: overridePatch.isEnabled ?? overridePatch.enabled ?? fallbackEnabled,
      max_retrying: clampPositiveInt(overridePatch.maxRetrying, fallbackMaxRetrying, 10_000),
      max_due_now: clampPositiveInt(overridePatch.maxDueNow, fallbackMaxDueNow, 10_000),
      min_limit: clampPositiveInt(overridePatch.minLimit, fallbackMinLimit, 100),
    };
  }

  return next;
}

export function buildConnectorBackpressureCandidatePolicy(input: {
  projectId: string;
  basePolicy: ConnectorBackpressurePolicyRecord | null;
  update: ConnectorBackpressureRequestConfig;
}): ConnectorBackpressurePolicyRecord {
  const now = new Date().toISOString();
  const base = input.basePolicy;
  const normalizedOverrides = normalizeConnectorOverrides({
    overrides: input.update.byConnector,
    basePolicy: base,
  });

  return {
    id: base?.id ?? "simulated-policy",
    project_id: input.projectId,
    is_enabled: input.update.enabled ?? base?.is_enabled ?? DEFAULT_POLICY.is_enabled,
    max_retrying: clampPositiveInt(input.update.maxRetrying, base?.max_retrying ?? DEFAULT_POLICY.max_retrying, 10_000),
    max_due_now: clampPositiveInt(input.update.maxDueNow, base?.max_due_now ?? DEFAULT_POLICY.max_due_now, 10_000),
    min_limit: clampPositiveInt(input.update.minLimit, base?.min_limit ?? DEFAULT_POLICY.min_limit, 100),
    connector_overrides: normalizedOverrides,
    created_at: base?.created_at ?? now,
    updated_at: now,
  };
}

export function simulateConnectorBackpressurePolicy(input: {
  connectorTypes: string[];
  requestedLimit: number;
  summariesByConnector: Record<string, ConnectorQueuePressureSummary>;
  currentPolicy: ConnectorBackpressurePolicyRecord | null;
  candidatePolicy: ConnectorBackpressurePolicyRecord;
}) {
  const requestedLimit = clampPositiveInt(input.requestedLimit, 25, 100);
  const perConnector = input.connectorTypes.map((connectorType) => {
    const summary = input.summariesByConnector[connectorType] ?? {
      queued: 0,
      retrying: 0,
      due_now: 0,
    };

    const currentResolved = resolveConnectorBackpressureConfig({
      connectorType,
      policy: input.currentPolicy,
    });
    const candidateResolved = resolveConnectorBackpressureConfig({
      connectorType,
      policy: input.candidatePolicy,
    });

    const currentDecision = resolveConnectorProcessBackpressure({
      requestedLimit,
      summary,
      config: currentResolved.config,
    });
    const candidateDecision = resolveConnectorProcessBackpressure({
      requestedLimit,
      summary,
      config: candidateResolved.config,
    });

    return {
      connector_type: connectorType,
      summary: {
        queued: clampNonNegativeInt(summary.queued),
        retrying: clampNonNegativeInt(summary.retrying),
        due_now: clampNonNegativeInt(summary.due_now),
      },
      current: {
        source: currentResolved.source,
        decision: currentDecision,
      },
      candidate: {
        source: candidateResolved.source,
        decision: candidateDecision,
      },
      impact: {
        effective_limit_delta: candidateDecision.effective_limit - currentDecision.effective_limit,
        throttled_changed: currentDecision.throttled !== candidateDecision.throttled,
      },
    };
  });

  const throttledBefore = perConnector.filter((item) => item.current.decision.throttled).length;
  const throttledAfter = perConnector.filter((item) => item.candidate.decision.throttled).length;

  return {
    requested_limit: requestedLimit,
    connector_count: perConnector.length,
    throttled_before: throttledBefore,
    throttled_after: throttledAfter,
    throttled_delta: throttledAfter - throttledBefore,
    per_connector: perConnector,
  };
}

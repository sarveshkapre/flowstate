import type { ConnectorBackpressurePolicyRecord } from "@flowstate/types";

import type { ConnectorProcessBackpressureConfig } from "./connector-backpressure.ts";
import { canonicalConnectorType } from "./connectors.ts";

export type ConnectorBackpressureRequestOverride = {
  enabled?: boolean;
  maxRetrying?: number;
  maxDueNow?: number;
  minLimit?: number;
};

export type ConnectorBackpressureRequestConfig = ConnectorProcessBackpressureConfig & {
  byConnector?: Record<string, ConnectorBackpressureRequestOverride>;
};

export type ConnectorBackpressureConfigSource =
  | "request_connector_override"
  | "request_default"
  | "policy_connector_override"
  | "policy_default"
  | "none";

export type ResolvedConnectorBackpressureConfig = {
  config?: ConnectorProcessBackpressureConfig;
  source: ConnectorBackpressureConfigSource;
  policy_applied: boolean;
};

function toPolicyConfig(input: {
  is_enabled: boolean;
  max_retrying: number;
  max_due_now: number;
  min_limit: number;
}): ConnectorProcessBackpressureConfig {
  return {
    enabled: input.is_enabled,
    maxRetrying: input.max_retrying,
    maxDueNow: input.max_due_now,
    minLimit: input.min_limit,
  };
}

function toRequestConfig(input: ConnectorBackpressureRequestOverride): ConnectorProcessBackpressureConfig {
  return {
    enabled: input.enabled,
    maxRetrying: input.maxRetrying,
    maxDueNow: input.maxDueNow,
    minLimit: input.minLimit,
  };
}

function selectOverride<T>(overrides: Record<string, T> | undefined, connectorType: string): T | null {
  if (!overrides) {
    return null;
  }

  const canonical = canonicalConnectorType(connectorType);
  if (!canonical) {
    return null;
  }

  if (canonical in overrides) {
    return overrides[canonical] ?? null;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (canonicalConnectorType(key) === canonical) {
      return value;
    }
  }

  return null;
}

export function resolveConnectorBackpressureConfig(input: {
  connectorType: string;
  requestBackpressure?: ConnectorBackpressureRequestConfig;
  policy?: ConnectorBackpressurePolicyRecord | null;
}): ResolvedConnectorBackpressureConfig {
  if (input.requestBackpressure) {
    const requestOverride = selectOverride(input.requestBackpressure.byConnector, input.connectorType);
    if (requestOverride) {
      return {
        config: toRequestConfig(requestOverride),
        source: "request_connector_override",
        policy_applied: false,
      };
    }

    return {
      config: {
        enabled: input.requestBackpressure.enabled,
        maxRetrying: input.requestBackpressure.maxRetrying,
        maxDueNow: input.requestBackpressure.maxDueNow,
        minLimit: input.requestBackpressure.minLimit,
      },
      source: "request_default",
      policy_applied: false,
    };
  }

  if (input.policy) {
    const policyOverride = selectOverride(input.policy.connector_overrides, input.connectorType);
    if (policyOverride) {
      return {
        config: toPolicyConfig(policyOverride),
        source: "policy_connector_override",
        policy_applied: true,
      };
    }

    return {
      config: toPolicyConfig(input.policy),
      source: "policy_default",
      policy_applied: true,
    };
  }

  return {
    config: undefined,
    source: "none",
    policy_applied: false,
  };
}

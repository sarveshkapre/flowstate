export type ConnectorQueuePressureSummary = {
  queued: number;
  retrying: number;
  due_now: number;
};

export type ConnectorProcessBackpressureConfig = {
  enabled?: boolean;
  maxRetrying?: number;
  maxDueNow?: number;
  minLimit?: number;
};

export type ConnectorProcessBackpressureReason = "retrying_limit" | "due_now_limit";

export type ConnectorProcessBackpressureDecision = {
  requested_limit: number;
  effective_limit: number;
  throttled: boolean;
  reason: ConnectorProcessBackpressureReason | null;
  summary: ConnectorQueuePressureSummary & { outstanding: number };
  thresholds: {
    max_retrying: number;
    max_due_now: number;
    min_limit: number;
  };
};

const DEFAULT_MAX_RETRYING = 50;
const DEFAULT_MAX_DUE_NOW = 100;
const DEFAULT_MIN_LIMIT = 1;

function clampPositiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function clampNonNegativeInt(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function resolveConnectorProcessBackpressure(input: {
  requestedLimit: number;
  summary: ConnectorQueuePressureSummary;
  config?: ConnectorProcessBackpressureConfig;
}): ConnectorProcessBackpressureDecision {
  const requestedLimit = clampPositiveInt(input.requestedLimit, 10, 100);
  const queued = clampNonNegativeInt(input.summary.queued);
  const retrying = clampNonNegativeInt(input.summary.retrying);
  const dueNow = clampNonNegativeInt(input.summary.due_now);
  const outstanding = queued + retrying;

  const enabled = input.config?.enabled === true;
  const maxRetrying = clampPositiveInt(input.config?.maxRetrying, DEFAULT_MAX_RETRYING, 10_000);
  const maxDueNow = clampPositiveInt(input.config?.maxDueNow, DEFAULT_MAX_DUE_NOW, 10_000);
  const minLimit = clampPositiveInt(input.config?.minLimit, DEFAULT_MIN_LIMIT, requestedLimit);

  if (!enabled) {
    return {
      requested_limit: requestedLimit,
      effective_limit: requestedLimit,
      throttled: false,
      reason: null,
      summary: {
        queued,
        retrying,
        due_now: dueNow,
        outstanding,
      },
      thresholds: {
        max_retrying: maxRetrying,
        max_due_now: maxDueNow,
        min_limit: minLimit,
      },
    };
  }

  if (retrying >= maxRetrying) {
    return {
      requested_limit: requestedLimit,
      effective_limit: minLimit,
      throttled: true,
      reason: "retrying_limit",
      summary: {
        queued,
        retrying,
        due_now: dueNow,
        outstanding,
      },
      thresholds: {
        max_retrying: maxRetrying,
        max_due_now: maxDueNow,
        min_limit: minLimit,
      },
    };
  }

  if (dueNow >= maxDueNow) {
    return {
      requested_limit: requestedLimit,
      effective_limit: minLimit,
      throttled: true,
      reason: "due_now_limit",
      summary: {
        queued,
        retrying,
        due_now: dueNow,
        outstanding,
      },
      thresholds: {
        max_retrying: maxRetrying,
        max_due_now: maxDueNow,
        min_limit: minLimit,
      },
    };
  }

  return {
    requested_limit: requestedLimit,
    effective_limit: requestedLimit,
    throttled: false,
    reason: null,
    summary: {
      queued,
      retrying,
      due_now: dueNow,
      outstanding,
    },
    thresholds: {
      max_retrying: maxRetrying,
      max_due_now: maxDueNow,
      min_limit: minLimit,
    },
  };
}

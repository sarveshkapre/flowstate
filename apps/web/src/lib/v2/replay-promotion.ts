export type PromotionGateThresholds = {
  minCandidateSuccessRate?: number;
  maxChangedVsBaselineRate?: number;
  minFieldAccuracy?: number;
  minComparedWithExpectedCount?: number;
};

export type PromotionGateName =
  | "min_candidate_success_rate"
  | "max_changed_vs_baseline_rate"
  | "min_field_accuracy"
  | "min_expected_samples";

export type PromotionGateResult = {
  gate: PromotionGateName;
  threshold: number;
  actual: number | null;
  comparator: ">=" | "<=";
  passed: boolean;
  reason: string | null;
};

type ReplayGateMetrics = {
  candidateSuccessRate: number;
  changedVsBaselineRate: number | null;
  minFieldAccuracy: number | null;
  comparedWithExpectedCount: number;
};

type EvaluatePromotionInput = {
  thresholds?: PromotionGateThresholds;
  metrics: ReplayGateMetrics;
};

function asFixedNumber(value: number) {
  return Number(value.toFixed(4));
}

function evaluateGate(input: {
  gate: PromotionGateName;
  threshold: number;
  actual: number | null;
  comparator: ">=" | "<=";
  reason?: string;
}): PromotionGateResult {
  const passed =
    input.actual !== null &&
    (input.comparator === ">=" ? input.actual >= input.threshold : input.actual <= input.threshold);

  return {
    gate: input.gate,
    threshold: asFixedNumber(input.threshold),
    actual: input.actual === null ? null : asFixedNumber(input.actual),
    comparator: input.comparator,
    passed,
    reason: input.reason ?? null,
  };
}

export function evaluatePromotionGates(input: EvaluatePromotionInput): {
  enabled: boolean;
  passed: boolean | null;
  gates: PromotionGateResult[];
} {
  const { thresholds, metrics } = input;
  const gates: PromotionGateResult[] = [];

  if (thresholds?.minCandidateSuccessRate !== undefined) {
    gates.push(
      evaluateGate({
        gate: "min_candidate_success_rate",
        threshold: thresholds.minCandidateSuccessRate,
        actual: metrics.candidateSuccessRate,
        comparator: ">=",
      }),
    );
  }

  if (thresholds?.maxChangedVsBaselineRate !== undefined) {
    gates.push(
      evaluateGate({
        gate: "max_changed_vs_baseline_rate",
        threshold: thresholds.maxChangedVsBaselineRate,
        actual: metrics.changedVsBaselineRate,
        comparator: "<=",
        reason: metrics.changedVsBaselineRate === null ? "Baseline flow version required for this gate" : undefined,
      }),
    );
  }

  if (thresholds?.minFieldAccuracy !== undefined) {
    gates.push(
      evaluateGate({
        gate: "min_field_accuracy",
        threshold: thresholds.minFieldAccuracy,
        actual: metrics.minFieldAccuracy,
        comparator: ">=",
        reason: metrics.minFieldAccuracy === null ? "No expected fields present in replay dataset" : undefined,
      }),
    );
  }

  if (thresholds?.minComparedWithExpectedCount !== undefined) {
    gates.push(
      evaluateGate({
        gate: "min_expected_samples",
        threshold: thresholds.minComparedWithExpectedCount,
        actual: metrics.comparedWithExpectedCount,
        comparator: ">=",
      }),
    );
  }

  const enabled = gates.length > 0;
  return {
    enabled,
    passed: enabled ? gates.every((gate) => gate.passed) : null,
    gates,
  };
}

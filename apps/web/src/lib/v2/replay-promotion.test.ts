import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePromotionGates } from "./replay-promotion.ts";

test("evaluatePromotionGates returns disabled result when no thresholds are configured", () => {
  const result = evaluatePromotionGates({
    metrics: {
      candidateSuccessRate: 0.97,
      changedVsBaselineRate: 0.05,
      minFieldAccuracy: 0.93,
      comparedWithExpectedCount: 42,
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.passed, null);
  assert.deepEqual(result.gates, []);
});

test("evaluatePromotionGates passes when all thresholds are satisfied", () => {
  const result = evaluatePromotionGates({
    thresholds: {
      minCandidateSuccessRate: 0.95,
      maxChangedVsBaselineRate: 0.1,
      minFieldAccuracy: 0.9,
      minComparedWithExpectedCount: 10,
    },
    metrics: {
      candidateSuccessRate: 0.97,
      changedVsBaselineRate: 0.05,
      minFieldAccuracy: 0.93,
      comparedWithExpectedCount: 42,
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.passed, true);
  assert.equal(result.gates.length, 4);
  assert.ok(result.gates.every((gate) => gate.passed));
});

test("evaluatePromotionGates fails with clear reasons when baseline or expected values are missing", () => {
  const result = evaluatePromotionGates({
    thresholds: {
      maxChangedVsBaselineRate: 0.1,
      minFieldAccuracy: 0.9,
    },
    metrics: {
      candidateSuccessRate: 0.97,
      changedVsBaselineRate: null,
      minFieldAccuracy: null,
      comparedWithExpectedCount: 0,
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.passed, false);
  assert.equal(result.gates.length, 2);
  const [baselineGate, expectedGate] = result.gates;
  assert.ok(baselineGate);
  assert.ok(expectedGate);
  assert.equal(baselineGate.reason, "Baseline flow version required for this gate");
  assert.equal(expectedGate.reason, "No expected fields present in replay dataset");
  assert.ok(result.gates.every((gate) => gate.passed === false));
});

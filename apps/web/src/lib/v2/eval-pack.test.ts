import assert from "node:assert/strict";
import test from "node:test";

import { selectTopCandidateRunIds } from "./eval-pack.ts";

test("selectTopCandidateRunIds returns highest scored unique run IDs", () => {
  const selected = selectTopCandidateRunIds({
    count: 3,
    candidates: [
      { run: { id: "run-1" }, score: 0.2 },
      { run: { id: "run-2" }, score: 2.5 },
      { run: { id: "run-2" }, score: 1.9 },
      { run: { id: "run-3" }, score: 2.5 },
      { run: { id: "run-4" }, score: 1.0 },
    ],
  });

  assert.deepEqual(selected, ["run-2", "run-3", "run-4"]);
});

test("selectTopCandidateRunIds clamps invalid count to at least one", () => {
  const selected = selectTopCandidateRunIds({
    count: 0,
    candidates: [
      { run: { id: "run-a" }, score: 1 },
      { run: { id: "run-b" }, score: 2 },
    ],
  });

  assert.deepEqual(selected, ["run-b"]);
});

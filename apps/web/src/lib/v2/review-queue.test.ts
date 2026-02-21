import assert from "node:assert/strict";
import test from "node:test";

import { isDecisionOwnedByQueue, isQueueProjectMatch } from "./review-queue.ts";

test("isQueueProjectMatch allows empty project and matches exact queue project", () => {
  assert.equal(isQueueProjectMatch(undefined, "proj_1"), true);
  assert.equal(isQueueProjectMatch(null, "proj_1"), true);
  assert.equal(isQueueProjectMatch("proj_1", "proj_1"), true);
  assert.equal(isQueueProjectMatch("proj_2", "proj_1"), false);
});

test("isDecisionOwnedByQueue validates both run and project ownership", () => {
  const queue = {
    id: "run_1",
    project_id: "proj_1",
  };

  assert.equal(isDecisionOwnedByQueue(null, queue), false);
  assert.equal(
    isDecisionOwnedByQueue(
      {
        run_id: "run_1",
        project_id: "proj_1",
      },
      queue,
    ),
    true,
  );
  assert.equal(
    isDecisionOwnedByQueue(
      {
        run_id: "run_2",
        project_id: "proj_1",
      },
      queue,
    ),
    false,
  );
  assert.equal(
    isDecisionOwnedByQueue(
      {
        run_id: "run_1",
        project_id: "proj_2",
      },
      queue,
    ),
    false,
  );
});

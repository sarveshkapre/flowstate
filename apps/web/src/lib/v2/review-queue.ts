import type { ReviewDecisionRecord, RunRecordV2 } from "@flowstate/types";

export function isQueueProjectMatch(providedProjectId: string | null | undefined, queueProjectId: string): boolean {
  if (!providedProjectId) {
    return true;
  }

  return providedProjectId === queueProjectId;
}

export function isDecisionOwnedByQueue(
  decision: Pick<ReviewDecisionRecord, "run_id" | "project_id"> | null,
  queue: Pick<RunRecordV2, "id" | "project_id">,
): boolean {
  if (!decision) {
    return false;
  }

  return decision.run_id === queue.id && decision.project_id === queue.project_id;
}

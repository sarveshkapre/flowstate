export type ActiveLearningCandidateLite = {
  run: { id: string };
  score: number;
};

export function selectTopCandidateRunIds(input: {
  candidates: ActiveLearningCandidateLite[];
  count: number;
}) {
  const normalizedCount = Number.isFinite(input.count) ? Math.max(1, Math.floor(input.count)) : 1;
  const seen = new Set<string>();
  const ordered = [...input.candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.run.id.localeCompare(right.run.id);
  });
  const selected: string[] = [];

  for (const candidate of ordered) {
    const runId = candidate.run.id;
    if (!runId || seen.has(runId)) {
      continue;
    }

    seen.add(runId);
    selected.push(runId);

    if (selected.length >= normalizedCount) {
      break;
    }
  }

  return selected;
}

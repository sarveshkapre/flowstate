import { parseDatasetIngestConfig, runDatasetBatchIngestOnce } from "../jobs/dataset-ingest";

async function tick() {
  const config = parseDatasetIngestConfig(process.env);
  const result = await runDatasetBatchIngestOnce({ config, logger: console });

  if (result.failures.length > 0) {
    console.error(`[dataset-ingest] tick completed with ${result.failures.length} failure(s)`, result.failures);
    return;
  }

  if (result.candidate_batch_count === 0) {
    console.log("[dataset-ingest] tick found no uploaded batches");
    return;
  }

  console.log(
    `[dataset-ingest] tick scanned ${result.candidate_batch_count} batches and ingested ${result.ingested_batch_count} batch(es)`,
  );
}

async function main() {
  const config = parseDatasetIngestConfig(process.env);

  console.log("[dataset-ingest] watcher started", {
    apiBaseUrl: config.apiBaseUrl,
    projectIds: config.projectIds,
    organizationId: config.organizationId,
    datasetIds: config.datasetIds,
    batchIds: config.batchIds,
    pollMs: config.pollMs,
    maxVideoFrames: config.maxVideoFrames,
    force: config.force,
  });

  await tick();
  setInterval(() => {
    void tick().catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[dataset-ingest] tick failed: ${message}`);
    });
  }, config.pollMs);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[dataset-ingest] fatal startup error: ${message}`);
  process.exitCode = 1;
});

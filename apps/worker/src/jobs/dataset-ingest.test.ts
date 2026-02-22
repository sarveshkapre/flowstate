import assert from "node:assert/strict";
import test from "node:test";

import { parseDatasetIngestConfig, runDatasetBatchIngestOnce } from "./dataset-ingest";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseDatasetIngestConfig applies defaults", () => {
  const config = parseDatasetIngestConfig({});

  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.deepEqual(config.projectIds, []);
  assert.equal(config.organizationId, null);
  assert.deepEqual(config.datasetIds, []);
  assert.deepEqual(config.batchIds, []);
  assert.equal(config.pollMs, 30_000);
  assert.equal(config.maxVideoFrames, 10);
  assert.equal(config.force, false);
});

test("parseDatasetIngestConfig normalizes custom values", () => {
  const config = parseDatasetIngestConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3100/",
    FLOWSTATE_DATASET_INGEST_PROJECT_IDS: " p1 , p2,p1 ",
    FLOWSTATE_DATASET_INGEST_ORGANIZATION_ID: " org_123 ",
    FLOWSTATE_DATASET_INGEST_DATASET_IDS: " d1,d2 ",
    FLOWSTATE_DATASET_INGEST_BATCH_IDS: " b1 , b2 ",
    FLOWSTATE_DATASET_INGEST_POLL_MS: "0",
    FLOWSTATE_DATASET_INGEST_MAX_VIDEO_FRAMES: "9999",
    FLOWSTATE_DATASET_INGEST_FORCE: "yes",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3100");
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
  assert.equal(config.organizationId, "org_123");
  assert.deepEqual(config.datasetIds, ["d1", "d2"]);
  assert.deepEqual(config.batchIds, ["b1", "b2"]);
  assert.equal(config.pollMs, 30_000);
  assert.equal(config.maxVideoFrames, 120);
  assert.equal(config.force, true);
});

test("runDatasetBatchIngestOnce ingests explicit batch IDs and skips already-ingested", async () => {
  const config = parseDatasetIngestConfig({
    FLOWSTATE_DATASET_INGEST_BATCH_IDS: "batch-a,batch-b",
    FLOWSTATE_DATASET_INGEST_FORCE: "false",
  });
  const seenRequests: Array<{ method?: string; url: string; body?: unknown }> = [];

  const result = await runDatasetBatchIngestOnce({
    config,
    fetchImpl: async (url, init) => {
      const request = { method: init?.method, url: String(url), body: init?.body };
      seenRequests.push(request);

      if (String(url).includes("/api/v2/projects")) {
        return jsonResponse(200, { projects: [] });
      }
      if (String(url).includes("/api/v2/batches/batch-a/ingest")) {
        return jsonResponse(200, { result: { created_assets_count: 12 } });
      }
      if (String(url).includes("/api/v2/batches/batch-b/ingest")) {
        return jsonResponse(409, { error: "already ingested" });
      }
      return jsonResponse(500, { error: "unexpected path" });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 0);
  assert.equal(result.dataset_count, 0);
  assert.equal(result.candidate_batch_count, 2);
  assert.equal(result.ingested_batch_count, 1);
  assert.equal(result.skipped_batch_count, 1);
  assert.equal(result.created_asset_count, 12);
  assert.deepEqual(result.failures, []);
  assert.ok(seenRequests.some((request) => request.url.endsWith("/api/v2/batches/batch-a/ingest")));
  assert.ok(seenRequests.some((request) => request.url.endsWith("/api/v2/batches/batch-b/ingest")));
});

test("runDatasetBatchIngestOnce discovers batches from project and dataset APIs", async () => {
  const config = parseDatasetIngestConfig({
    FLOWSTATE_DATASET_INGEST_ORGANIZATION_ID: "org_123",
  });
  const seenRequests: string[] = [];

  const result = await runDatasetBatchIngestOnce({
    config,
    fetchImpl: async (url) => {
      const requestUrl = String(url);
      seenRequests.push(requestUrl);

      if (requestUrl.includes("/api/v2/projects")) {
        return jsonResponse(200, {
          projects: [{ id: "project-1" }],
        });
      }
      if (requestUrl.includes("/api/v2/datasets?projectId=project-1")) {
        return jsonResponse(200, {
          datasets: [{ id: "dataset-1" }],
        });
      }
      if (requestUrl.includes("/api/v2/datasets/dataset-1/batches")) {
        return jsonResponse(200, {
          batches: [{ id: "batch-1" }],
        });
      }
      if (requestUrl.includes("/api/v2/batches/batch-1/ingest")) {
        return jsonResponse(200, {
          result: { created_assets_count: 3 },
        });
      }
      return jsonResponse(404, { error: "not found" });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.dataset_count, 1);
  assert.equal(result.candidate_batch_count, 1);
  assert.equal(result.ingested_batch_count, 1);
  assert.equal(result.skipped_batch_count, 0);
  assert.equal(result.created_asset_count, 3);
  assert.deepEqual(result.failures, []);
  assert.ok(seenRequests.some((url) => url.includes("/api/v2/projects?organizationId=org_123")));
  assert.ok(seenRequests.some((url) => url.includes("/api/v2/datasets?projectId=project-1")));
  assert.ok(seenRequests.some((url) => url.includes("/api/v2/datasets/dataset-1/batches?status=uploaded")));
});

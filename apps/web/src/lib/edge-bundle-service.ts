import { createHash } from "node:crypto";

import { type EdgeDeploymentBundleRecord } from "@flowstate/types";

import {
  createEdgeDeploymentBundleRecord,
  getWorkflow,
  listEdgeDeploymentBundles,
  writeEdgeBundleFile,
} from "@/lib/data-store";
import { buildEdgeBundleManifest, getEdgeAdapterDefinition } from "@/lib/edge-adapters";

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function createEdgeDeploymentBundle(input: {
  workflowId: string;
  adapterId: string;
  model?: string;
}): Promise<{ bundle: EdgeDeploymentBundleRecord; manifest: unknown } | null> {
  const workflow = await getWorkflow(input.workflowId);

  if (!workflow) {
    return null;
  }

  const adapter = getEdgeAdapterDefinition(input.adapterId);

  if (!adapter) {
    return null;
  }

  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const manifest = buildEdgeBundleManifest({ workflow, adapter, model });
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;

  const checksumSha256 = createHash("sha256").update(contents).digest("hex");
  const fileName = `${slugify(workflow.name) || workflow.id}-${adapter.id}-${Date.now()}.json`;

  const file = await writeEdgeBundleFile({ fileName, contents });
  const bundle = await createEdgeDeploymentBundleRecord({
    workflowId: workflow.id,
    workflowName: workflow.name,
    adapter: adapter.id,
    runtime: adapter.runtime,
    model,
    fileName,
    fileSizeBytes: file.fileSizeBytes,
    checksumSha256,
  });

  return { bundle, manifest };
}

export async function listBundles(input?: {
  workflowId?: string;
  limit?: number;
}) {
  return listEdgeDeploymentBundles(input);
}

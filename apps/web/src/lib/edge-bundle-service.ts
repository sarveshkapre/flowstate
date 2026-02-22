import { createHash } from "node:crypto";

import { type EdgeDeploymentBundleRecord } from "@flowstate/types";

import {
  createEdgeDeploymentBundleRecord,
  getWorkflow,
  listEdgeDeploymentBundles,
  writeEdgeBundleFile,
} from "@/lib/data-store";
import { buildEdgeBundleManifest, getEdgeAdapterDefinition } from "@/lib/edge-adapters";
import { resolveOpenAIModel } from "@/lib/openai-model";

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

  const model = resolveOpenAIModel(input.model);
  const manifest = buildEdgeBundleManifest({ workflow, adapter, model });
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;

  const checksumSha256 = createHash("sha256").update(contents).digest("hex");
  const fileName = `${slugify(workflow.name) || workflow.id}-${adapter.id}-${Date.now()}.json`;

  const file = await writeEdgeBundleFile({ fileName, contents });
  const bundle = await createEdgeDeploymentBundleRecord({
    organizationId: workflow.organization_id,
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
  organizationId?: string;
  workflowId?: string;
  limit?: number;
}) {
  return listEdgeDeploymentBundles(input);
}

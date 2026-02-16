import { type EdgeAdapter, edgeAdapterSchema, type EdgeRuntime, type WorkflowRecord } from "@flowstate/types";

import { extractionTemplates } from "@/lib/extraction-templates";

export type EdgeAdapterDefinition = {
  id: EdgeAdapter;
  name: string;
  runtime: EdgeRuntime;
  description: string;
  supportsWebhookDispatch: boolean;
  supportsAutoApprove: boolean;
  formatVersion: string;
};

const EDGE_ADAPTER_DEFINITIONS: Record<EdgeAdapter, EdgeAdapterDefinition> = {
  cloudflare_worker: {
    id: "cloudflare_worker",
    name: "Cloudflare Worker",
    runtime: "workerd",
    description: "HTTP worker bundle for low-latency extraction at global edge POPs.",
    supportsWebhookDispatch: true,
    supportsAutoApprove: true,
    formatVersion: "1.0.0",
  },
  vercel_edge_function: {
    id: "vercel_edge_function",
    name: "Vercel Edge Function",
    runtime: "v8_isolate",
    description: "Edge function config for request-time extraction and review gating.",
    supportsWebhookDispatch: true,
    supportsAutoApprove: true,
    formatVersion: "1.0.0",
  },
  browser_wasm: {
    id: "browser_wasm",
    name: "Browser WASM",
    runtime: "wasm_browser",
    description: "Browser-side orchestration config for local-first capture experiences.",
    supportsWebhookDispatch: false,
    supportsAutoApprove: true,
    formatVersion: "1.0.0",
  },
};

export function listEdgeAdapterDefinitions(): EdgeAdapterDefinition[] {
  return Object.values(EDGE_ADAPTER_DEFINITIONS);
}

export function getEdgeAdapterDefinition(adapterId: string): EdgeAdapterDefinition | null {
  const parsed = edgeAdapterSchema.safeParse(adapterId);

  if (!parsed.success) {
    return null;
  }

  return EDGE_ADAPTER_DEFINITIONS[parsed.data];
}

export function buildEdgeBundleManifest(input: {
  workflow: WorkflowRecord;
  adapter: EdgeAdapterDefinition;
  model: string;
}) {
  const template = extractionTemplates[input.workflow.document_type];

  return {
    manifest_version: "flowstate.edge.bundle.v1",
    generated_at: new Date().toISOString(),
    adapter: {
      id: input.adapter.id,
      runtime: input.adapter.runtime,
      name: input.adapter.name,
      format_version: input.adapter.formatVersion,
      supports_webhook_dispatch: input.adapter.supportsWebhookDispatch,
      supports_auto_approve: input.adapter.supportsAutoApprove,
    },
    openai: {
      provider: "openai",
      model: input.model,
      api: "responses",
      response_format: "json_schema",
    },
    workflow: {
      id: input.workflow.id,
      name: input.workflow.name,
      description: input.workflow.description,
      is_active: input.workflow.is_active,
      document_type: input.workflow.document_type,
      min_confidence_auto_approve: input.workflow.min_confidence_auto_approve,
      webhook_url: input.workflow.webhook_url,
    },
    extraction: {
      schema_name: template.schemaName,
      system_prompt: template.systemPrompt,
      user_prompt: template.userPrompt,
      json_schema: template.jsonSchema,
    },
    output_contract: {
      expected_review_states: ["pending", "approved", "rejected"],
      fields: Object.keys(template.jsonSchema.properties),
    },
  };
}

import { createHash } from "node:crypto";

import type { FlowNode, FlowVersionRecord } from "@flowstate/types";

import {
  createRunTrace,
  createRunV2,
  getFlowDeploymentByKey,
  getFlowV2,
  getFlowVersion,
  setRunV2Completed,
  setRunV2Failed,
  setRunV2Running,
} from "@/lib/data-store-v2";
import { resolveOpenAIModel } from "@/lib/openai-model";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function applyNode(node: FlowNode, context: Record<string, unknown>) {
  const current = { ...context };

  switch (node.type) {
    case "source_upload":
    case "source_webhook":
    case "source_folder":
    case "source_rtsp":
      return { ...current, source_type: node.type };
    case "validate": {
      const config = asObject(node.config);
      const required = Array.isArray(config.required_fields)
        ? config.required_fields.filter((item): item is string => typeof item === "string")
        : [];
      const missing = required.filter((field) => current[field] === undefined || current[field] === null || current[field] === "");
      return {
        ...current,
        validation: {
          required_fields: required,
          missing_fields: missing,
          is_valid: missing.length === 0,
        },
      };
    }
    case "dedupe": {
      const fingerprint = createHash("sha256").update(JSON.stringify(current)).digest("hex");
      return { ...current, dedupe_fingerprint: fingerprint };
    }
    case "redact": {
      const config = asObject(node.config);
      const fields = Array.isArray(config.fields)
        ? config.fields.filter((item): item is string => typeof item === "string")
        : [];

      const redacted = { ...current };
      for (const field of fields) {
        if (field in redacted) {
          redacted[field] = "[REDACTED]";
        }
      }

      return redacted;
    }
    case "classify": {
      const config = asObject(node.config);
      const labels = Array.isArray(config.labels)
        ? config.labels.filter((item): item is string => typeof item === "string")
        : [];
      const text = String(current.text || current.description || "").toLowerCase();
      const matched = labels.find((label) => text.includes(label.toLowerCase())) ?? labels[0] ?? "unclassified";
      return { ...current, classification: matched };
    }
    case "route": {
      const config = asObject(node.config);
      const byClass = asObject(config.by_class);
      const currentClass = String(current.classification || "unclassified");
      const route = typeof byClass[currentClass] === "string" ? (byClass[currentClass] as string) : "default";
      return { ...current, route };
    }
    case "human_review":
      return { ...current, review_status: "pending" };
    case "extract": {
      const config = asObject(node.config);
      const fields = Array.isArray(config.fields)
        ? config.fields.filter((item): item is string => typeof item === "string")
        : [];
      const extraction: Record<string, unknown> = {};

      for (const field of fields) {
        extraction[field] = current[field] ?? null;
      }

      return { ...current, extraction };
    }
    case "sink_webhook":
    case "sink_slack":
    case "sink_jira":
    case "sink_sqs":
    case "sink_db":
      return { ...current, sink: node.type };
    default:
      return current;
  }
}

export async function executeFlowVersionRun(input: {
  projectId: string;
  flowId: string;
  flowVersion: FlowVersionRecord;
  deploymentId?: string;
  payload: unknown;
}) {
  const run = await createRunV2({
    projectId: input.projectId,
    flowId: input.flowId,
    flowVersionId: input.flowVersion.id,
    deploymentId: input.deploymentId,
    inputRef: undefined,
  });

  const startedAt = Date.now();
  await setRunV2Running(run.id);

  try {
    let current = asObject(input.payload);
    const nodeOutputs: Record<string, unknown> = {};

    for (const node of input.flowVersion.graph.nodes) {
      current = applyNode(node, current);
      nodeOutputs[node.id] = current;
    }

    await createRunTrace({
      runId: run.id,
      model: resolveOpenAIModel(),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      metadata: {
        nodes_executed: input.flowVersion.graph.nodes.length,
        edges_defined: input.flowVersion.graph.edges.length,
      },
    });

    const completed = await setRunV2Completed({
      runId: run.id,
      outputRef: `run://${run.id}/output`,
    });

    return {
      run: completed,
      output: {
        final: current,
        nodes: nodeOutputs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown flow runtime error";
    const failed = await setRunV2Failed({
      runId: run.id,
      errorMessage: message,
    });

    return {
      run: failed,
      output: null,
    };
  }
}

export async function executeDeploymentByKey(input: {
  deploymentKey: string;
  payload: unknown;
}) {
  const deployment = await getFlowDeploymentByKey(input.deploymentKey);

  if (!deployment || !deployment.is_active) {
    return null;
  }

  const flow = await getFlowV2(deployment.flow_id);
  const flowVersion = await getFlowVersion(deployment.flow_version_id);

  if (!flow || !flowVersion) {
    return null;
  }

  const result = await executeFlowVersionRun({
    projectId: flow.project_id,
    flowId: flow.id,
    flowVersion,
    deploymentId: deployment.id,
    payload: input.payload,
  });

  return {
    deployment,
    flow,
    flowVersion,
    ...result,
  };
}

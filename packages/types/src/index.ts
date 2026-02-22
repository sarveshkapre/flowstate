import { z } from "zod";

export const documentTypeSchema = z.enum(["receipt", "invoice"]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  amount: z.number(),
});

export const receiptExtractionSchema = z.object({
  vendor: z.string(),
  date: z.string(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  payment_method: z.string().optional(),
  card_last4: z.string().optional(),
  line_items: z.array(lineItemSchema),
});

export const invoiceExtractionSchema = z.object({
  vendor: z.string(),
  invoice_number: z.string(),
  invoice_date: z.string(),
  due_date: z.string(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  line_items: z.array(lineItemSchema),
});

export const extractionByDocumentSchema = {
  receipt: receiptExtractionSchema,
  invoice: invoiceExtractionSchema,
} as const;

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
export type ExtractionResult = ReceiptExtraction | InvoiceExtraction;

export const extractionJobStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type ExtractionJobStatus = z.infer<typeof extractionJobStatusSchema>;

export const reviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const validationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["warning", "error"]),
});

export const validationResultSchema = z.object({
  is_valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  issues: z.array(validationIssueSchema),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const artifactRecordSchema = z.object({
  id: z.string(),
  original_name: z.string(),
  stored_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export const organizationRecordSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OrganizationRecord = z.infer<typeof organizationRecordSchema>;

export const projectMemberRoleSchema = z.enum(["owner", "admin", "builder", "reviewer", "viewer"]);
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

export const permissionSchema = z.enum([
  "manage_project",
  "manage_members",
  "manage_keys",
  "create_flow",
  "deploy_flow",
  "run_flow",
  "review_queue",
  "read_project",
]);
export type Permission = z.infer<typeof permissionSchema>;

export const projectVisibilitySchema = z.enum(["private", "public"]);
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

export const projectTypeSchema = z.enum([
  "object_detection",
  "classification",
  "instance_segmentation",
  "keypoint_detection",
  "multimodal",
  "semantic_segmentation",
]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const projectRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  annotation_group: z.string().default("objects"),
  visibility: projectVisibilitySchema.default("private"),
  project_type: projectTypeSchema.default("object_detection"),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectMembershipRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  user_email: z.string(),
  role: projectMemberRoleSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProjectMembershipRecord = z.infer<typeof projectMembershipRecordSchema>;

export const apiKeyScopeSchema = z.enum([
  "manage_projects",
  "manage_members",
  "manage_keys",
  "create_flow",
  "deploy_flow",
  "run_flow",
  "review_queue",
  "read_project",
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const apiKeyRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  project_id: z.string().nullable(),
  name: z.string(),
  key_prefix: z.string(),
  key_hash: z.string(),
  role: projectMemberRoleSchema,
  scopes: z.array(apiKeyScopeSchema),
  is_active: z.boolean(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;

export const magicLinkRecordSchema = z.object({
  id: z.string(),
  email: z.string(),
  token_hash: z.string(),
  expires_at: z.string(),
  consumed_at: z.string().nullable(),
  created_at: z.string(),
});
export type MagicLinkRecord = z.infer<typeof magicLinkRecordSchema>;

export const extractionJobRecordSchema = z.object({
  id: z.string(),
  artifact_id: z.string(),
  document_type: documentTypeSchema,
  status: extractionJobStatusSchema,
  review_status: reviewStatusSchema,
  reviewer: z.string().nullable(),
  review_notes: z.string().nullable(),
  result: z.unknown().nullable(),
  validation: validationResultSchema.nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ExtractionJobRecord = z.infer<typeof extractionJobRecordSchema>;

export const auditEventTypeSchema = z.enum([
  "job_created",
  "job_processing",
  "job_completed",
  "job_failed",
  "review_assigned",
  "review_decision",
  "webhook_dispatched",
  "workflow_created",
  "workflow_run_completed",
  "workflow_run_failed",
  "edge_bundle_created",
  "eval_run_created",
  "project_created",
  "project_member_assigned",
  "api_key_created",
  "api_key_used",
  "magic_link_requested",
  "magic_link_verified",
  "flow_created_v2",
  "flow_version_created",
  "flow_deployed_v2",
  "flow_deleted_v2",
  "run_created_v2",
  "run_completed_v2",
  "dataset_created_v2",
  "dataset_version_created_v2",
  "dataset_batch_created_v2",
  "dataset_batch_status_updated_v2",
  "dataset_asset_created_v2",
  "asset_annotation_created_v2",
  "asset_auto_labeled_v2",
  "review_decision_v2",
  "evidence_attached_v2",
  "eval_pack_created_v2",
  "connector_delivery_queued_v2",
  "connector_delivery_attempted_v2",
  "connector_delivered_v2",
  "connector_dead_lettered_v2",
  "review_alert_policy_updated_v2",
  "connector_guardian_policy_updated_v2",
  "connector_backpressure_policy_updated_v2",
  "edge_agent_config_updated_v2",
  "edge_agent_command_enqueued_v2",
  "edge_agent_command_acknowledged_v2",
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditEventRecordSchema = z.object({
  id: z.string(),
  job_id: z.string().nullable(),
  event_type: auditEventTypeSchema,
  actor: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export type AuditEventRecord = z.infer<typeof auditEventRecordSchema>;

export const webhookDeliveryRecordSchema = z.object({
  id: z.string(),
  target_url: z.string(),
  payload_size_bytes: z.number().int().nonnegative(),
  success: z.boolean(),
  status_code: z.number().int().nullable(),
  response_body: z.string().nullable(),
  created_at: z.string(),
});

export type WebhookDeliveryRecord = z.infer<typeof webhookDeliveryRecordSchema>;

export const datasetSnapshotRecordSchema = z.object({
  id: z.string(),
  review_status: reviewStatusSchema,
  item_count: z.number().int().nonnegative(),
  file_name: z.string(),
  created_at: z.string(),
});

export type DatasetSnapshotRecord = z.infer<typeof datasetSnapshotRecordSchema>;

export const workflowRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  document_type: documentTypeSchema,
  is_active: z.boolean(),
  min_confidence_auto_approve: z.number().min(0).max(1),
  webhook_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkflowRecord = z.infer<typeof workflowRecordSchema>;

export const workflowRunStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const workflowRunRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workflow_id: z.string(),
  artifact_id: z.string(),
  extraction_job_id: z.string().nullable(),
  status: workflowRunStatusSchema,
  auto_review_applied: z.boolean(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkflowRunRecord = z.infer<typeof workflowRunRecordSchema>;

export const edgeAdapterSchema = z.enum(["cloudflare_worker", "vercel_edge_function", "browser_wasm"]);
export type EdgeAdapter = z.infer<typeof edgeAdapterSchema>;

export const edgeRuntimeSchema = z.enum(["workerd", "v8_isolate", "wasm_browser"]);
export type EdgeRuntime = z.infer<typeof edgeRuntimeSchema>;

export const edgeDeploymentBundleRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workflow_id: z.string(),
  workflow_name: z.string(),
  adapter: edgeAdapterSchema,
  runtime: edgeRuntimeSchema,
  model: z.string(),
  file_name: z.string(),
  file_size_bytes: z.number().int().nonnegative(),
  checksum_sha256: z.string(),
  created_at: z.string(),
});

export type EdgeDeploymentBundleRecord = z.infer<typeof edgeDeploymentBundleRecordSchema>;

export const evalRunRecordSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  review_status: reviewStatusSchema,
  sample_limit: z.number().int().positive(),
  sample_count: z.number().int().nonnegative(),
  avg_confidence: z.number().min(0).max(1),
  avg_field_coverage: z.number().min(0).max(1),
  error_rate: z.number().min(0).max(1),
  warning_rate: z.number().min(0).max(1),
  created_at: z.string(),
});

export type EvalRunRecord = z.infer<typeof evalRunRecordSchema>;

export const flowNodeTypeSchema = z.enum([
  "source_upload",
  "source_webhook",
  "source_folder",
  "source_rtsp",
  "extract",
  "validate",
  "dedupe",
  "redact",
  "classify",
  "route",
  "human_review",
  "sink_webhook",
  "sink_slack",
  "sink_jira",
  "sink_sqs",
  "sink_db",
]);
export type FlowNodeType = z.infer<typeof flowNodeTypeSchema>;

export const flowNodeSchema = z.object({
  id: z.string(),
  type: flowNodeTypeSchema,
  label: z.string(),
  config: z.unknown(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  condition: z.string().nullable(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
});
export type FlowGraph = z.infer<typeof flowGraphSchema>;

export const flowRecordV2Schema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  current_version_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FlowRecordV2 = z.infer<typeof flowRecordV2Schema>;

export const flowVersionRecordSchema = z.object({
  id: z.string(),
  flow_id: z.string(),
  version_number: z.number().int().positive(),
  graph: flowGraphSchema,
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type FlowVersionRecord = z.infer<typeof flowVersionRecordSchema>;

export const flowDeploymentRecordSchema = z.object({
  id: z.string(),
  flow_id: z.string(),
  flow_version_id: z.string(),
  deployment_key: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type FlowDeploymentRecord = z.infer<typeof flowDeploymentRecordSchema>;

export const runStatusV2Schema = z.enum(["queued", "running", "completed", "failed"]);
export type RunStatusV2 = z.infer<typeof runStatusV2Schema>;

export const runRecordV2Schema = z.object({
  id: z.string(),
  project_id: z.string(),
  flow_id: z.string(),
  flow_version_id: z.string(),
  deployment_id: z.string().nullable(),
  status: runStatusV2Schema,
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RunRecordV2 = z.infer<typeof runRecordV2Schema>;

export const runTraceRecordSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  model: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});
export type RunTraceRecord = z.infer<typeof runTraceRecordSchema>;

export const datasetRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;

export const datasetVersionRecordSchema = z.object({
  id: z.string(),
  dataset_id: z.string(),
  version_number: z.number().int().positive(),
  item_count: z.number().int().nonnegative(),
  file_name: z.string(),
  created_at: z.string(),
});
export type DatasetVersionRecord = z.infer<typeof datasetVersionRecordSchema>;

export const datasetBatchSourceTypeSchema = z.enum(["image", "video", "pdf", "mixed"]);
export type DatasetBatchSourceType = z.infer<typeof datasetBatchSourceTypeSchema>;

export const datasetBatchStatusSchema = z.enum([
  "uploaded",
  "preprocessing",
  "ready_for_label",
  "in_labeling",
  "in_review",
  "approved",
  "rework",
  "exported",
]);
export type DatasetBatchStatus = z.infer<typeof datasetBatchStatusSchema>;

export const datasetBatchRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  dataset_id: z.string(),
  name: z.string(),
  tags: z.array(z.string()).default([]),
  source_type: datasetBatchSourceTypeSchema,
  status: datasetBatchStatusSchema,
  source_artifact_ids: z.array(z.string()),
  item_count: z.number().int().nonnegative(),
  labeled_count: z.number().int().nonnegative(),
  reviewed_count: z.number().int().nonnegative(),
  approved_count: z.number().int().nonnegative(),
  rejected_count: z.number().int().nonnegative(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DatasetBatchRecord = z.infer<typeof datasetBatchRecordSchema>;

export const datasetAssetTypeSchema = z.enum(["image", "video_frame", "pdf_page"]);
export type DatasetAssetType = z.infer<typeof datasetAssetTypeSchema>;

export const datasetAssetStatusSchema = z.enum(["pending", "ready", "failed", "archived"]);
export type DatasetAssetStatus = z.infer<typeof datasetAssetStatusSchema>;

export const datasetAssetRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  dataset_id: z.string(),
  batch_id: z.string(),
  artifact_id: z.string().nullable(),
  asset_type: datasetAssetTypeSchema,
  status: datasetAssetStatusSchema,
  storage_path: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  frame_index: z.number().int().nonnegative().nullable(),
  timestamp_ms: z.number().int().nonnegative().nullable(),
  page_number: z.number().int().positive().nullable(),
  sha256: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DatasetAssetRecord = z.infer<typeof datasetAssetRecordSchema>;

export const assetAnnotationSourceSchema = z.enum(["manual", "ai_prelabel", "imported"]);
export type AssetAnnotationSource = z.infer<typeof assetAnnotationSourceSchema>;

export const assetAnnotationGeometrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bbox"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(
      z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    ),
  }),
]);
export type AssetAnnotationGeometry = z.infer<typeof assetAnnotationGeometrySchema>;

export const assetAnnotationShapeSchema = z.object({
  id: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  geometry: assetAnnotationGeometrySchema,
});
export type AssetAnnotationShape = z.infer<typeof assetAnnotationShapeSchema>;

export const assetAnnotationRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  dataset_id: z.string(),
  batch_id: z.string(),
  asset_id: z.string(),
  source: assetAnnotationSourceSchema,
  is_latest: z.boolean(),
  shapes: z.array(assetAnnotationShapeSchema),
  notes: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AssetAnnotationRecord = z.infer<typeof assetAnnotationRecordSchema>;

export const reviewDecisionValueSchema = z.enum(["correct", "incorrect", "missing", "uncertain"]);
export type ReviewDecisionValue = z.infer<typeof reviewDecisionValueSchema>;

export const failureReasonCodeSchema = z.enum([
  "missing_field",
  "math_mismatch",
  "hallucinated_entity",
  "wrong_currency",
  "wrong_date",
  "wrong_class",
  "other",
]);
export type FailureReasonCode = z.infer<typeof failureReasonCodeSchema>;

export const reviewDecisionRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  run_id: z.string(),
  field_name: z.string(),
  decision: reviewDecisionValueSchema,
  failure_reason: failureReasonCodeSchema.nullable(),
  reviewer: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type ReviewDecisionRecord = z.infer<typeof reviewDecisionRecordSchema>;

export const evidenceRegionRecordSchema = z.object({
  id: z.string(),
  review_decision_id: z.string(),
  page: z.number().int().nonnegative(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  created_at: z.string(),
});
export type EvidenceRegionRecord = z.infer<typeof evidenceRegionRecordSchema>;

export const evalPackRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  candidate_run_ids: z.array(z.string()),
  created_at: z.string(),
});
export type EvalPackRecord = z.infer<typeof evalPackRecordSchema>;

export const reviewAlertPolicyRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  is_enabled: z.boolean(),
  connector_type: z.string(),
  stale_hours: z.number().int().positive(),
  queue_limit: z.number().int().positive(),
  min_unreviewed_queues: z.number().int().nonnegative(),
  min_at_risk_queues: z.number().int().nonnegative(),
  min_stale_queues: z.number().int().nonnegative(),
  min_avg_error_rate: z.number().min(0).max(1),
  idempotency_window_minutes: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ReviewAlertPolicyRecord = z.infer<typeof reviewAlertPolicyRecordSchema>;

export const connectorGuardianPolicyRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  is_enabled: z.boolean(),
  dry_run: z.boolean(),
  lookback_hours: z.number().int().positive(),
  risk_threshold: z.number().positive(),
  max_actions_per_project: z.number().int().positive(),
  action_limit: z.number().int().positive(),
  cooldown_minutes: z.number().int().nonnegative(),
  min_dead_letter_minutes: z.number().int().nonnegative(),
  allow_process_queue: z.boolean(),
  allow_redrive_dead_letters: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConnectorGuardianPolicyRecord = z.infer<typeof connectorGuardianPolicyRecordSchema>;

export const connectorBackpressurePolicyRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  is_enabled: z.boolean(),
  max_retrying: z.number().int().positive(),
  max_due_now: z.number().int().positive(),
  min_limit: z.number().int().positive(),
  connector_overrides: z
    .record(
      z.string(),
      z.object({
        is_enabled: z.boolean(),
        max_retrying: z.number().int().positive(),
        max_due_now: z.number().int().positive(),
        min_limit: z.number().int().positive(),
      }),
    )
    .default({}),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConnectorBackpressurePolicyRecord = z.infer<typeof connectorBackpressurePolicyRecordSchema>;

export const connectorBackpressurePolicyDraftRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  is_enabled: z.boolean(),
  max_retrying: z.number().int().positive(),
  max_due_now: z.number().int().positive(),
  min_limit: z.number().int().positive(),
  connector_overrides: z
    .record(
      z.string(),
      z.object({
        is_enabled: z.boolean(),
        max_retrying: z.number().int().positive(),
        max_due_now: z.number().int().positive(),
        min_limit: z.number().int().positive(),
      }),
    )
    .default({}),
  required_approvals: z.number().int().positive().max(10).default(1),
  approvals: z
    .array(
      z.object({
        actor: z.string(),
        approved_at: z.string(),
      }),
    )
    .default([]),
  activate_at: z.string().nullable().default(null),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConnectorBackpressurePolicyDraftRecord = z.infer<typeof connectorBackpressurePolicyDraftRecordSchema>;

export const environmentProfileSchema = z.enum(["local", "staging", "prod"]);
export type EnvironmentProfile = z.infer<typeof environmentProfileSchema>;

export const connectorDeliveryStatusSchema = z.enum(["queued", "retrying", "delivered", "dead_lettered"]);
export type ConnectorDeliveryStatus = z.infer<typeof connectorDeliveryStatusSchema>;

export const connectorDeliveryRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  connector_type: z.string(),
  idempotency_key: z.string().nullable(),
  payload_hash: z.string(),
  status: connectorDeliveryStatusSchema,
  attempt_count: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  last_status_code: z.number().int().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: z.string().nullable(),
  dead_letter_reason: z.string().nullable(),
  delivered_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConnectorDeliveryRecord = z.infer<typeof connectorDeliveryRecordSchema>;

export const connectorDeliveryAttemptRecordSchema = z.object({
  id: z.string(),
  delivery_id: z.string(),
  attempt_number: z.number().int().positive(),
  success: z.boolean(),
  status_code: z.number().int().nullable(),
  error_message: z.string().nullable(),
  response_body: z.string().nullable(),
  created_at: z.string(),
});
export type ConnectorDeliveryAttemptRecord = z.infer<typeof connectorDeliveryAttemptRecordSchema>;

export const edgeAgentRecordSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  platform: z.string(),
  status: z.enum(["online", "offline"]),
  last_heartbeat_at: z.string().nullable(),
  created_at: z.string(),
});
export type EdgeAgentRecord = z.infer<typeof edgeAgentRecordSchema>;

export const edgeAgentEventRecordSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  event_type: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
});
export type EdgeAgentEventRecord = z.infer<typeof edgeAgentEventRecordSchema>;

export const edgeAgentConfigRecordSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  version_number: z.number().int().positive(),
  config: z.unknown(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type EdgeAgentConfigRecord = z.infer<typeof edgeAgentConfigRecordSchema>;

export const edgeAgentCommandStatusSchema = z.enum(["pending", "claimed", "acknowledged", "failed"]);
export type EdgeAgentCommandStatus = z.infer<typeof edgeAgentCommandStatusSchema>;

export const edgeAgentCommandRecordSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  command_type: z.string(),
  payload: z.unknown(),
  status: edgeAgentCommandStatusSchema,
  claimed_at: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  result: z.unknown().nullable(),
  created_by: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EdgeAgentCommandRecord = z.infer<typeof edgeAgentCommandRecordSchema>;

export const syncCheckpointRecordSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  checkpoint_key: z.string(),
  checkpoint_value: z.string(),
  updated_at: z.string(),
});
export type SyncCheckpointRecord = z.infer<typeof syncCheckpointRecordSchema>;

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  type ArtifactRecord,
  artifactRecordSchema,
  type AuditEventRecord,
  type AuditEventType,
  auditEventRecordSchema,
  type DatasetSnapshotRecord,
  datasetSnapshotRecordSchema,
  type DocumentType,
  type ExtractionJobRecord,
  extractionJobRecordSchema,
  reviewStatusSchema,
  type ReviewStatus,
  type ValidationResult,
  type WebhookDeliveryRecord,
  edgeDeploymentBundleRecordSchema,
  type EdgeDeploymentBundleRecord,
  type WorkflowRecord,
  workflowRecordSchema,
  type WorkflowRunRecord,
  workflowRunRecordSchema,
  webhookDeliveryRecordSchema,
} from "@flowstate/types";

type DbState = {
  artifacts: ArtifactRecord[];
  extraction_jobs: ExtractionJobRecord[];
  webhook_deliveries: WebhookDeliveryRecord[];
  audit_events: AuditEventRecord[];
  dataset_snapshots: DatasetSnapshotRecord[];
  workflows: WorkflowRecord[];
  workflow_runs: WorkflowRunRecord[];
  edge_deployment_bundles: EdgeDeploymentBundleRecord[];
};

const DEFAULT_DB_STATE: DbState = {
  artifacts: [],
  extraction_jobs: [],
  webhook_deliveries: [],
  audit_events: [],
  dataset_snapshots: [],
  workflows: [],
  workflow_runs: [],
  edge_deployment_bundles: [],
};

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const DATA_DIR = process.env.FLOWSTATE_DATA_DIR
  ? path.resolve(process.env.FLOWSTATE_DATA_DIR)
  : path.join(WORKSPACE_ROOT, ".flowstate-data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");
const EDGE_BUNDLES_DIR = path.join(DATA_DIR, "edge-bundles");
const DB_FILE = path.join(DATA_DIR, "db.json");

let writeChain = Promise.resolve();

async function ensureDataInfrastructure() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  await fs.mkdir(EDGE_BUNDLES_DIR, { recursive: true });

  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB_STATE, null, 2), "utf8");
  }
}

async function readDbState(): Promise<DbState> {
  await ensureDataInfrastructure();
  const raw = await fs.readFile(DB_FILE, "utf8");
  const parsed = JSON.parse(raw) as Partial<DbState>;

  return {
    artifacts: (parsed.artifacts ?? []).map((item) => artifactRecordSchema.parse(item)),
    extraction_jobs: (parsed.extraction_jobs ?? []).map((item) => extractionJobRecordSchema.parse(item)),
    webhook_deliveries: (parsed.webhook_deliveries ?? []).map((item) => webhookDeliveryRecordSchema.parse(item)),
    audit_events: (parsed.audit_events ?? []).map((item) => auditEventRecordSchema.parse(item)),
    dataset_snapshots: (parsed.dataset_snapshots ?? []).map((item) => datasetSnapshotRecordSchema.parse(item)),
    workflows: (parsed.workflows ?? []).map((item) => workflowRecordSchema.parse(item)),
    workflow_runs: (parsed.workflow_runs ?? []).map((item) => workflowRunRecordSchema.parse(item)),
    edge_deployment_bundles: (parsed.edge_deployment_bundles ?? []).map((item) =>
      edgeDeploymentBundleRecordSchema.parse(item),
    ),
  };
}

async function writeDbState(state: DbState) {
  const tmpPath = `${DB_FILE}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmpPath, DB_FILE);
}

async function withWriteLock<T>(fn: (state: DbState) => Promise<T> | T): Promise<T> {
  const resultPromise = writeChain.then(async () => {
    const state = await readDbState();
    const result = await fn(state);
    await writeDbState(state);
    return result;
  });

  writeChain = resultPromise.then(
    () => undefined,
    () => undefined,
  );

  return resultPromise;
}

function inferExtension(fileName: string, mimeType: string): string {
  const fromName = path.extname(fileName).toLowerCase();

  if (fromName) {
    return fromName.slice(0, 10);
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType === "image/png") {
    return ".png";
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  return ".bin";
}

function appendAuditEvent(state: DbState, input: {
  eventType: AuditEventType;
  jobId?: string | null;
  actor?: string | null;
  metadata?: unknown;
}) {
  const event = auditEventRecordSchema.parse({
    id: randomUUID(),
    job_id: input.jobId ?? null,
    event_type: input.eventType,
    actor: input.actor ?? null,
    metadata: input.metadata ?? null,
    created_at: new Date().toISOString(),
  });

  state.audit_events.unshift(event);
  return event;
}

export async function createArtifact(input: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): Promise<ArtifactRecord> {
  return withWriteLock(async (state) => {
    const id = randomUUID();
    const ext = inferExtension(input.originalName, input.mimeType);
    const storedName = `${id}${ext}`;

    await fs.writeFile(path.join(UPLOADS_DIR, storedName), input.bytes);

    const artifact = artifactRecordSchema.parse({
      id,
      original_name: input.originalName,
      stored_name: storedName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      created_at: new Date().toISOString(),
    });

    state.artifacts.unshift(artifact);
    return artifact;
  });
}

export async function getArtifact(artifactId: string): Promise<ArtifactRecord | null> {
  const state = await readDbState();
  return state.artifacts.find((item) => item.id === artifactId) ?? null;
}

export async function listArtifacts(limit?: number): Promise<ArtifactRecord[]> {
  const state = await readDbState();
  return typeof limit === "number" ? state.artifacts.slice(0, limit) : state.artifacts;
}

export async function readArtifactBytes(artifactId: string): Promise<{ artifact: ArtifactRecord; bytes: Buffer } | null> {
  const artifact = await getArtifact(artifactId);

  if (!artifact) {
    return null;
  }

  try {
    const bytes = await fs.readFile(path.join(UPLOADS_DIR, artifact.stored_name));
    return { artifact, bytes };
  } catch {
    return null;
  }
}

export async function createExtractionJob(input: {
  artifactId: string;
  documentType: DocumentType;
}): Promise<ExtractionJobRecord> {
  return withWriteLock(async (state) => {
    const timestamp = new Date().toISOString();

    const job = extractionJobRecordSchema.parse({
      id: randomUUID(),
      artifact_id: input.artifactId,
      document_type: input.documentType,
      status: "queued",
      review_status: "pending",
      reviewer: null,
      review_notes: null,
      result: null,
      validation: null,
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    state.extraction_jobs.unshift(job);
    appendAuditEvent(state, {
      eventType: "job_created",
      jobId: job.id,
      actor: "system",
      metadata: { document_type: job.document_type },
    });

    return job;
  });
}

export async function listExtractionJobs(filters?: {
  status?: ExtractionJobRecord["status"];
  reviewStatus?: ExtractionJobRecord["review_status"];
  documentType?: DocumentType;
}): Promise<ExtractionJobRecord[]> {
  const state = await readDbState();

  return state.extraction_jobs.filter((job) => {
    if (filters?.status && job.status !== filters.status) {
      return false;
    }

    if (filters?.reviewStatus && job.review_status !== filters.reviewStatus) {
      return false;
    }

    if (filters?.documentType && job.document_type !== filters.documentType) {
      return false;
    }

    return true;
  });
}

export async function getExtractionJob(jobId: string): Promise<ExtractionJobRecord | null> {
  const state = await readDbState();
  return state.extraction_jobs.find((item) => item.id === jobId) ?? null;
}

export async function setExtractionJobProcessing(jobId: string): Promise<ExtractionJobRecord | null> {
  return withWriteLock(async (state) => {
    const job = state.extraction_jobs.find((item) => item.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "processing";
    job.error_message = null;
    job.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "job_processing",
      jobId,
      actor: "system",
    });

    return extractionJobRecordSchema.parse(job);
  });
}

export async function setExtractionJobCompleted(
  jobId: string,
  payload: {
    result: unknown;
    validation: ValidationResult;
  },
): Promise<ExtractionJobRecord | null> {
  return withWriteLock(async (state) => {
    const job = state.extraction_jobs.find((item) => item.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "completed";
    job.result = payload.result;
    job.validation = payload.validation;
    job.error_message = null;
    job.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "job_completed",
      jobId,
      actor: "system",
      metadata: {
        confidence: payload.validation.confidence,
        issues: payload.validation.issues.length,
      },
    });

    return extractionJobRecordSchema.parse(job);
  });
}

export async function setExtractionJobFailed(jobId: string, errorMessage: string): Promise<ExtractionJobRecord | null> {
  return withWriteLock(async (state) => {
    const job = state.extraction_jobs.find((item) => item.id === jobId);

    if (!job) {
      return null;
    }

    job.status = "failed";
    job.error_message = errorMessage;
    job.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "job_failed",
      jobId,
      actor: "system",
      metadata: { error: errorMessage },
    });

    return extractionJobRecordSchema.parse(job);
  });
}

export async function assignReviewer(input: {
  jobId: string;
  reviewer: string;
  actor?: string;
}): Promise<ExtractionJobRecord | null> {
  return withWriteLock(async (state) => {
    const job = state.extraction_jobs.find((item) => item.id === input.jobId);

    if (!job) {
      return null;
    }

    job.reviewer = input.reviewer.trim() || null;
    job.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "review_assigned",
      jobId: job.id,
      actor: input.actor ?? input.reviewer,
      metadata: { reviewer: job.reviewer },
    });

    return extractionJobRecordSchema.parse(job);
  });
}

export async function updateReviewStatus(input: {
  jobId: string;
  reviewStatus: "approved" | "rejected";
  reviewer?: string;
  reviewNotes?: string;
}): Promise<ExtractionJobRecord | null> {
  reviewStatusSchema.parse(input.reviewStatus);

  return withWriteLock(async (state) => {
    const job = state.extraction_jobs.find((item) => item.id === input.jobId);

    if (!job) {
      return null;
    }

    if (job.status !== "completed") {
      return null;
    }

    job.review_status = input.reviewStatus;
    job.reviewer = input.reviewer?.trim() ? input.reviewer.trim() : job.reviewer;
    job.review_notes = input.reviewNotes?.trim() ? input.reviewNotes.trim() : null;
    job.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "review_decision",
      jobId: job.id,
      actor: job.reviewer,
      metadata: {
        review_status: job.review_status,
        has_notes: Boolean(job.review_notes),
      },
    });

    return extractionJobRecordSchema.parse(job);
  });
}

export async function listAuditEvents(filters?: {
  jobId?: string;
  limit?: number;
}): Promise<AuditEventRecord[]> {
  const state = await readDbState();

  const events = state.audit_events.filter((event) => {
    if (filters?.jobId && event.job_id !== filters.jobId) {
      return false;
    }

    return true;
  });

  if (filters?.limit) {
    return events.slice(0, filters.limit);
  }

  return events;
}

export async function writeSnapshotJsonl(input: {
  fileName: string;
  lines: string[];
}): Promise<string> {
  await ensureDataInfrastructure();
  const targetPath = path.join(SNAPSHOTS_DIR, input.fileName);
  await fs.writeFile(targetPath, `${input.lines.join("\n")}\n`, "utf8");
  return targetPath;
}

export async function createDatasetSnapshotRecord(input: {
  reviewStatus: ReviewStatus;
  itemCount: number;
  fileName: string;
}): Promise<DatasetSnapshotRecord> {
  return withWriteLock(async (state) => {
    const snapshot = datasetSnapshotRecordSchema.parse({
      id: randomUUID(),
      review_status: input.reviewStatus,
      item_count: input.itemCount,
      file_name: input.fileName,
      created_at: new Date().toISOString(),
    });

    state.dataset_snapshots.unshift(snapshot);
    return snapshot;
  });
}

export async function listDatasetSnapshots(): Promise<DatasetSnapshotRecord[]> {
  const state = await readDbState();
  return state.dataset_snapshots;
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  documentType: DocumentType;
  minConfidenceAutoApprove: number;
  webhookUrl?: string;
  isActive?: boolean;
}): Promise<WorkflowRecord> {
  return withWriteLock(async (state) => {
    const timestamp = new Date().toISOString();

    const workflow = workflowRecordSchema.parse({
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      document_type: input.documentType,
      is_active: input.isActive ?? true,
      min_confidence_auto_approve: input.minConfidenceAutoApprove,
      webhook_url: input.webhookUrl?.trim() || null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    state.workflows.unshift(workflow);
    appendAuditEvent(state, {
      eventType: "workflow_created",
      actor: "system",
      metadata: { workflow_id: workflow.id, name: workflow.name },
    });

    return workflow;
  });
}

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const state = await readDbState();
  return state.workflows;
}

export async function getWorkflow(workflowId: string): Promise<WorkflowRecord | null> {
  const state = await readDbState();
  return state.workflows.find((item) => item.id === workflowId) ?? null;
}

export async function createWorkflowRun(input: {
  workflowId: string;
  artifactId: string;
}): Promise<WorkflowRunRecord> {
  return withWriteLock(async (state) => {
    const timestamp = new Date().toISOString();
    const run = workflowRunRecordSchema.parse({
      id: randomUUID(),
      workflow_id: input.workflowId,
      artifact_id: input.artifactId,
      extraction_job_id: null,
      status: "queued",
      auto_review_applied: false,
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    state.workflow_runs.unshift(run);
    return run;
  });
}

export async function listWorkflowRuns(filters?: {
  workflowId?: string;
  status?: WorkflowRunRecord["status"];
  limit?: number;
}): Promise<WorkflowRunRecord[]> {
  const state = await readDbState();

  const runs = state.workflow_runs.filter((run) => {
    if (filters?.workflowId && run.workflow_id !== filters.workflowId) {
      return false;
    }

    if (filters?.status && run.status !== filters.status) {
      return false;
    }

    return true;
  });

  if (filters?.limit) {
    return runs.slice(0, filters.limit);
  }

  return runs;
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunRecord | null> {
  const state = await readDbState();
  return state.workflow_runs.find((item) => item.id === runId) ?? null;
}

export async function setWorkflowRunRunning(runId: string): Promise<WorkflowRunRecord | null> {
  return withWriteLock(async (state) => {
    const run = state.workflow_runs.find((item) => item.id === runId);
    if (!run) {
      return null;
    }

    run.status = "running";
    run.error_message = null;
    run.updated_at = new Date().toISOString();

    return workflowRunRecordSchema.parse(run);
  });
}

export async function setWorkflowRunCompleted(input: {
  runId: string;
  extractionJobId: string;
  autoReviewApplied: boolean;
}): Promise<WorkflowRunRecord | null> {
  return withWriteLock(async (state) => {
    const run = state.workflow_runs.find((item) => item.id === input.runId);
    if (!run) {
      return null;
    }

    run.status = "completed";
    run.extraction_job_id = input.extractionJobId;
    run.auto_review_applied = input.autoReviewApplied;
    run.error_message = null;
    run.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "workflow_run_completed",
      jobId: input.extractionJobId,
      actor: "system",
      metadata: { workflow_id: run.workflow_id, run_id: run.id, auto_review_applied: input.autoReviewApplied },
    });

    return workflowRunRecordSchema.parse(run);
  });
}

export async function setWorkflowRunFailed(input: {
  runId: string;
  extractionJobId?: string | null;
  errorMessage: string;
}): Promise<WorkflowRunRecord | null> {
  return withWriteLock(async (state) => {
    const run = state.workflow_runs.find((item) => item.id === input.runId);
    if (!run) {
      return null;
    }

    run.status = "failed";
    run.extraction_job_id = input.extractionJobId ?? null;
    run.error_message = input.errorMessage;
    run.updated_at = new Date().toISOString();

    appendAuditEvent(state, {
      eventType: "workflow_run_failed",
      jobId: input.extractionJobId ?? null,
      actor: "system",
      metadata: { workflow_id: run.workflow_id, run_id: run.id, error: input.errorMessage },
    });

    return workflowRunRecordSchema.parse(run);
  });
}

export async function recordWebhookDelivery(input: {
  targetUrl: string;
  payloadSizeBytes: number;
  success: boolean;
  statusCode: number | null;
  responseBody: string | null;
  actor?: string;
  jobIds?: string[];
}) {
  return withWriteLock(async (state) => {
    const delivery = webhookDeliveryRecordSchema.parse({
      id: randomUUID(),
      target_url: input.targetUrl,
      payload_size_bytes: input.payloadSizeBytes,
      success: input.success,
      status_code: input.statusCode,
      response_body: input.responseBody,
      created_at: new Date().toISOString(),
    });

    state.webhook_deliveries.unshift(delivery);

    appendAuditEvent(state, {
      eventType: "webhook_dispatched",
      actor: input.actor ?? "system",
      metadata: {
        target_url: input.targetUrl,
        success: input.success,
        status_code: input.statusCode,
        jobs: input.jobIds?.length ?? 0,
      },
    });

    return delivery;
  });
}

export async function writeEdgeBundleFile(input: {
  fileName: string;
  contents: string;
}): Promise<{ filePath: string; fileSizeBytes: number }> {
  await ensureDataInfrastructure();
  const filePath = path.join(EDGE_BUNDLES_DIR, input.fileName);
  await fs.writeFile(filePath, input.contents, "utf8");
  const stats = await fs.stat(filePath);
  return { filePath, fileSizeBytes: stats.size };
}

export async function createEdgeDeploymentBundleRecord(input: {
  workflowId: string;
  workflowName: string;
  adapter: EdgeDeploymentBundleRecord["adapter"];
  runtime: EdgeDeploymentBundleRecord["runtime"];
  model: string;
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string;
}): Promise<EdgeDeploymentBundleRecord> {
  return withWriteLock(async (state) => {
    const record = edgeDeploymentBundleRecordSchema.parse({
      id: randomUUID(),
      workflow_id: input.workflowId,
      workflow_name: input.workflowName,
      adapter: input.adapter,
      runtime: input.runtime,
      model: input.model,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      checksum_sha256: input.checksumSha256,
      created_at: new Date().toISOString(),
    });

    state.edge_deployment_bundles.unshift(record);

    appendAuditEvent(state, {
      eventType: "edge_bundle_created",
      actor: "system",
      metadata: {
        bundle_id: record.id,
        workflow_id: record.workflow_id,
        adapter: record.adapter,
        runtime: record.runtime,
        file_name: record.file_name,
      },
    });

    return record;
  });
}

export async function listEdgeDeploymentBundles(filters?: {
  workflowId?: string;
  limit?: number;
}): Promise<EdgeDeploymentBundleRecord[]> {
  const state = await readDbState();
  const bundles = state.edge_deployment_bundles.filter((bundle) => {
    if (filters?.workflowId && bundle.workflow_id !== filters.workflowId) {
      return false;
    }

    return true;
  });

  if (filters?.limit) {
    return bundles.slice(0, filters.limit);
  }

  return bundles;
}

export async function getEdgeDeploymentBundle(bundleId: string): Promise<EdgeDeploymentBundleRecord | null> {
  const state = await readDbState();
  return state.edge_deployment_bundles.find((bundle) => bundle.id === bundleId) ?? null;
}

export async function readEdgeBundleContents(fileName: string): Promise<string | null> {
  await ensureDataInfrastructure();

  try {
    return await fs.readFile(path.join(EDGE_BUNDLES_DIR, fileName), "utf8");
  } catch {
    return null;
  }
}

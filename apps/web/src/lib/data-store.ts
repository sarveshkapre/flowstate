import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  type ArtifactRecord,
  artifactRecordSchema,
  type DocumentType,
  type ExtractionJobRecord,
  extractionJobRecordSchema,
  reviewStatusSchema,
  type ValidationResult,
  type WebhookDeliveryRecord,
  webhookDeliveryRecordSchema,
} from "@flowstate/types";

type DbState = {
  artifacts: ArtifactRecord[];
  extraction_jobs: ExtractionJobRecord[];
  webhook_deliveries: WebhookDeliveryRecord[];
};

const DEFAULT_DB_STATE: DbState = {
  artifacts: [],
  extraction_jobs: [],
  webhook_deliveries: [],
};

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const DATA_DIR = process.env.FLOWSTATE_DATA_DIR
  ? path.resolve(process.env.FLOWSTATE_DATA_DIR)
  : path.join(WORKSPACE_ROOT, ".flowstate-data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

let writeChain = Promise.resolve();

async function ensureDataInfrastructure() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

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

export async function listArtifacts(): Promise<ArtifactRecord[]> {
  const state = await readDbState();
  return state.artifacts;
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
    job.reviewer = input.reviewer?.trim() ? input.reviewer.trim() : null;
    job.review_notes = input.reviewNotes?.trim() ? input.reviewNotes.trim() : null;
    job.updated_at = new Date().toISOString();

    return extractionJobRecordSchema.parse(job);
  });
}

export async function recordWebhookDelivery(input: {
  targetUrl: string;
  payloadSizeBytes: number;
  success: boolean;
  statusCode: number | null;
  responseBody: string | null;
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
    return delivery;
  });
}

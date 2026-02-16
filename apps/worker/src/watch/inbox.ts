import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const API_BASE_URL = process.env.FLOWSTATE_LOCAL_API_BASE || "http://localhost:3000";
const WATCH_DIR = resolvePath(process.env.FLOWSTATE_WATCH_DIR || "~/Flowstate/inbox");
const ARCHIVE_DIR = resolvePath(process.env.FLOWSTATE_WATCH_ARCHIVE_DIR || "~/Flowstate/archive");
const ERROR_DIR = resolvePath(process.env.FLOWSTATE_WATCH_ERROR_DIR || "~/Flowstate/error");
const WORKFLOW_ID = process.env.FLOWSTATE_WATCH_WORKFLOW_ID?.trim() || null;
const DOCUMENT_TYPE = (process.env.FLOWSTATE_WATCH_DOCUMENT_TYPE?.trim() || "invoice") as "invoice" | "receipt";
const POLL_MS = Number(process.env.FLOWSTATE_WATCH_POLL_MS || 1500);
const STABLE_MS = Number(process.env.FLOWSTATE_WATCH_STABLE_MS || 1200);
const MAX_RETRIES = Number(process.env.FLOWSTATE_WATCH_MAX_RETRIES || 3);

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const inflight = new Set<string>();
const observedState = new Map<string, { size: number; seenAt: number }>();
const retryCounts = new Map<string, number>();

function resolvePath(input: string) {
  if (!input.startsWith("~/")) {
    return path.resolve(input);
  }

  return path.join(os.homedir(), input.slice(2));
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  return null;
}

async function ensureDirectories() {
  await fs.mkdir(WATCH_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.mkdir(ERROR_DIR, { recursive: true });
}

async function moveFile(sourcePath: string, targetDirectory: string) {
  await fs.mkdir(targetDirectory, { recursive: true });

  const baseName = path.basename(sourcePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetName = `${stamp}-${randomUUID().slice(0, 8)}-${baseName}`;
  const targetPath = path.join(targetDirectory, targetName);

  try {
    await fs.rename(sourcePath, targetPath);
    return targetPath;
  } catch (error) {
    const asNodeError = error as NodeJS.ErrnoException;

    if (asNodeError.code !== "EXDEV") {
      throw error;
    }

    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
    return targetPath;
  }
}

async function uploadArtifact(filePath: string) {
  const bytes = await fs.readFile(filePath);
  const mimeType = inferMimeType(filePath);

  if (!mimeType) {
    throw new Error(`Unsupported file extension: ${path.extname(filePath)}`);
  }

  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const response = await fetch(`${API_BASE_URL}/api/v1/uploads`, {
    method: "POST",
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as { artifact?: { id: string }; error?: string } | null;

  if (!response.ok || !payload?.artifact?.id) {
    throw new Error(payload?.error || `Upload failed (${response.status})`);
  }

  return payload.artifact.id;
}

async function triggerProcessing(artifactId: string) {
  if (WORKFLOW_ID) {
    const response = await fetch(`${API_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || `Workflow run failed (${response.status})`);
    }

    return;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/extractions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactId,
      documentType: DOCUMENT_TYPE,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Extraction failed (${response.status})`);
  }
}

async function processFile(filePath: string) {
  if (inflight.has(filePath)) {
    return;
  }

  inflight.add(filePath);

  try {
    const artifactId = await uploadArtifact(filePath);
    await triggerProcessing(artifactId);
    retryCounts.delete(filePath);
    observedState.delete(filePath);

    const archivePath = await moveFile(filePath, ARCHIVE_DIR);
    console.log(`[inbox-watcher] processed ${path.basename(filePath)} -> ${archivePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const retries = (retryCounts.get(filePath) || 0) + 1;
    retryCounts.set(filePath, retries);

    if (retries >= MAX_RETRIES) {
      observedState.delete(filePath);
      retryCounts.delete(filePath);
      const errorPath = await moveFile(filePath, ERROR_DIR);
      console.error(`[inbox-watcher] failed ${path.basename(filePath)} after ${retries} tries -> ${errorPath}: ${message}`);
    } else {
      console.error(`[inbox-watcher] retry ${retries}/${MAX_RETRIES} for ${path.basename(filePath)}: ${message}`);
    }
  } finally {
    inflight.delete(filePath);
  }
}

async function scanInbox() {
  const entries = await fs.readdir(WATCH_DIR, { withFileTypes: true });
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) {
        return;
      }

      const filePath = path.join(WATCH_DIR, entry.name);
      const extension = path.extname(entry.name).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        return;
      }

      const stats = await fs.stat(filePath);
      const previous = observedState.get(filePath);

      if (!previous || previous.size !== stats.size) {
        observedState.set(filePath, { size: stats.size, seenAt: now });
        return;
      }

      if (now - previous.seenAt < STABLE_MS) {
        return;
      }

      await processFile(filePath);
    }),
  );
}

async function bootstrap() {
  await ensureDirectories();

  console.log("[inbox-watcher] started", {
    apiBase: API_BASE_URL,
    watchDir: WATCH_DIR,
    archiveDir: ARCHIVE_DIR,
    errorDir: ERROR_DIR,
    workflowId: WORKFLOW_ID,
    documentType: DOCUMENT_TYPE,
    pollMs: POLL_MS,
    stableMs: STABLE_MS,
    maxRetries: MAX_RETRIES,
  });

  await scanInbox();

  setInterval(() => {
    void scanInbox().catch((error) => {
      const message = error instanceof Error ? error.message : "unknown scan error";
      console.error(`[inbox-watcher] scan failed: ${message}`);
    });
  }, POLL_MS);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[inbox-watcher] fatal startup error: ${message}`);
  process.exitCode = 1;
});

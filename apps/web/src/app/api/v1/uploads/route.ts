import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { createArtifact, listArtifacts } from "@/lib/data-store";
import { requireV1Permission } from "@/lib/v1/auth";

const execFile = promisify(execFileCallback);
const COMMAND_BUFFER_SIZE = 16 * 1024 * 1024;

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const MAX_UPLOAD_BYTES = readPositiveIntEnv("FLOWSTATE_MAX_UPLOAD_BYTES", 20 * 1024 * 1024);
const MAX_RAW_VIDEO_UPLOAD_BYTES = readPositiveIntEnv(
  "FLOWSTATE_MAX_RAW_VIDEO_UPLOAD_BYTES",
  512 * 1024 * 1024,
);
const VIDEO_UPLOAD_MAX_SECONDS = Math.min(
  30,
  Math.max(1, readPositiveIntEnv("FLOWSTATE_VIDEO_UPLOAD_MAX_SECONDS", 3)),
);

const IMAGE_FILE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_FILE_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);

type UploadKind = "image" | "video" | "pdf";
type VideoUploadStatus = {
  original_size_bytes: number;
  original_duration_seconds: number | null;
  processed_size_bytes: number;
  processed_duration_seconds: number | null;
  max_duration_seconds: number;
};

function fileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function detectUploadKind(file: File): UploadKind | null {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  const extension = fileExtension(file.name);
  if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (extension === ".pdf") {
    return "pdf";
  }

  return null;
}

function inferMimeType(file: File, kind: UploadKind) {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }

  const extension = fileExtension(file.name);
  if (kind === "image") {
    if (extension === ".png") {
      return "image/png";
    }
    if (extension === ".webp") {
      return "image/webp";
    }
    return "image/jpeg";
  }
  if (kind === "video") {
    return "video/mp4";
  }
  return "application/pdf";
}

function normalizeExecErrorMessage(command: string, error: unknown) {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    return `${command} binary is not available on PATH`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return `${command} failed`;
}

async function runCommand(command: string, args: string[]) {
  return execFile(command, args, {
    encoding: "utf8",
    maxBuffer: COMMAND_BUFFER_SIZE,
  });
}

function parseDurationSeconds(stdout: string) {
  const candidate = stdout.trim().split("\n")[0]?.trim() || "";
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function probeVideoDurationSeconds(filePath: string) {
  try {
    const result = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nokey=1:noprint_wrappers=1",
      filePath,
    ]);
    return parseDurationSeconds(result.stdout);
  } catch {
    return null;
  }
}

async function normalizeUploadedVideo(input: {
  rawBytes: Buffer;
  originalName: string;
  maxSeconds: number;
  maxBytes: number;
}) {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "flowstate-upload-"));
  const sourceExtension = fileExtension(input.originalName) || ".mp4";
  const sourcePath = path.join(tempDir, `source${sourceExtension}`);
  const normalizedPath = path.join(tempDir, "normalized.mp4");

  await fs.writeFile(sourcePath, input.rawBytes);
  try {
    const originalDurationSeconds = await probeVideoDurationSeconds(sourcePath);

    try {
      await runCommand("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "0",
        "-i",
        sourcePath,
        "-t",
        input.maxSeconds.toFixed(3),
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        normalizedPath,
      ]);
    } catch (error) {
      const normalized = normalizeExecErrorMessage("ffmpeg", error);
      if (normalized.includes("binary is not available on PATH")) {
        throw new Error(
          "ffmpeg binary is not available on PATH. Install with `brew install ffmpeg` and restart Flowstate.",
        );
      }
      throw new Error(normalized);
    }

    const normalizedBytes = await fs.readFile(normalizedPath);
    const processedDurationSeconds = await probeVideoDurationSeconds(normalizedPath);
    if (normalizedBytes.byteLength > input.maxBytes) {
      throw new Error(
        `Processed video exceeds ${input.maxBytes} bytes after ${input.maxSeconds}s trim. Try a lower-resolution source video.`,
      );
    }

    const parsed = path.parse(input.originalName);
    return {
      bytes: normalizedBytes,
      mimeType: "video/mp4",
      originalName: `${parsed.name || "video"}-clip.mp4`,
      sizeBytes: normalizedBytes.byteLength,
      uploadStatus: {
        original_size_bytes: input.rawBytes.byteLength,
        original_duration_seconds: originalDurationSeconds,
        processed_size_bytes: normalizedBytes.byteLength,
        processed_duration_seconds: processedDurationSeconds,
        max_duration_seconds: input.maxSeconds,
      } satisfies VideoUploadStatus,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  const artifacts = await listArtifacts(limit);
  return NextResponse.json({ artifacts });
}

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const kind = detectUploadKind(file);
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported file type. Use image, video, or PDF files." },
      { status: 400 },
    );
  }

  if (kind === "video" && file.size > MAX_RAW_VIDEO_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Video too large for preprocessing. Max raw video size is ${MAX_RAW_VIDEO_UPLOAD_BYTES} bytes.`,
      },
      { status: 400 },
    );
  }
  if (kind !== "video" && file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max size is ${MAX_UPLOAD_BYTES} bytes.` },
      { status: 400 },
    );
  }

  const rawBytes = Buffer.from(await file.arrayBuffer());
  let artifactInput: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    bytes: Buffer;
    uploadStatus?: VideoUploadStatus;
  };

  if (kind === "video") {
    try {
      artifactInput = await normalizeUploadedVideo({
        rawBytes,
        originalName: file.name,
        maxSeconds: VIDEO_UPLOAD_MAX_SECONDS,
        maxBytes: MAX_UPLOAD_BYTES,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Video preprocessing failed.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else {
    artifactInput = {
      originalName: file.name,
      mimeType: inferMimeType(file, kind),
      sizeBytes: file.size,
      bytes: rawBytes,
    };
  }

  const artifact = await createArtifact({
    originalName: artifactInput.originalName,
    mimeType: artifactInput.mimeType,
    sizeBytes: artifactInput.sizeBytes,
    bytes: artifactInput.bytes,
  });

  return NextResponse.json({
    artifact,
    file_url: `/api/v1/uploads/${artifact.id}/file`,
    upload_status: artifactInput.uploadStatus ?? null,
  });
}

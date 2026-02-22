import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const COMMAND_BUFFER_SIZE = 16 * 1024 * 1024;
const OUTPUT_PATTERN = "frame-%06d.jpg";

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

type ProbeResult = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  estimatedFrameCount: number | null;
  fps: number | null;
};

export type ExtractedVideoFrame = {
  frameIndex: number;
  timestampMs: number;
  width: number | null;
  height: number | null;
  sha256: string;
  filePath: string;
};

export type VideoFrameExtractionResult = {
  probe: ProbeResult;
  frames: ExtractedVideoFrame[];
};

export type ExtractVideoFramesInput = {
  videoPath: string;
  outputDir: string;
  maxFrames: number;
  runCommand?: CommandRunner;
};

function asPositiveNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return input;
  }

  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function parseFraction(input: unknown): number | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim();
  if (!normalized || normalized === "0/0") {
    return null;
  }

  const [left, right] = normalized.split("/");
  if (!left || !right) {
    return asPositiveNumber(normalized);
  }

  const numerator = Number(left);
  const denominator = Number(right);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function defaultCommandRunner(command: string, args: string[]) {
  return execFile(command, args, {
    encoding: "utf8",
    maxBuffer: COMMAND_BUFFER_SIZE,
  });
}

function normalizeExecErrorMessage(command: string, error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    return `${command} binary is not available on PATH`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return `${command} failed`;
}

function probeFromJson(stdout: string): ProbeResult {
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      width?: unknown;
      height?: unknown;
      duration?: unknown;
      nb_frames?: unknown;
      avg_frame_rate?: unknown;
      r_frame_rate?: unknown;
    }>;
    format?: { duration?: unknown };
  };

  const stream = parsed.streams?.[0];
  const width = asPositiveNumber(stream?.width);
  const height = asPositiveNumber(stream?.height);
  const durationSeconds =
    asPositiveNumber(stream?.duration) ??
    asPositiveNumber(parsed.format?.duration);
  const estimatedFrameCount = asPositiveNumber(stream?.nb_frames);
  const fps = parseFraction(stream?.avg_frame_rate) ?? parseFraction(stream?.r_frame_rate);

  return {
    width: width ? Math.floor(width) : null,
    height: height ? Math.floor(height) : null,
    durationSeconds,
    estimatedFrameCount: estimatedFrameCount ? Math.floor(estimatedFrameCount) : null,
    fps,
  };
}

function toTimestampMs(input: {
  frameIndex: number;
  frameCount: number;
  durationSeconds: number | null;
  fps: number | null;
}) {
  if (input.durationSeconds && input.durationSeconds > 0 && input.frameCount > 0) {
    const intervalMs = (input.durationSeconds * 1000) / input.frameCount;
    return Math.round((input.frameIndex - 1) * intervalMs);
  }

  if (input.fps && input.fps > 0) {
    return Math.round(((input.frameIndex - 1) * 1000) / input.fps);
  }

  return Math.max(0, (input.frameIndex - 1) * 1000);
}

function ffmpegFilter(input: {
  frameCountLimit: number;
  estimatedFrameCount: number | null;
  durationSeconds: number | null;
}) {
  if (input.estimatedFrameCount && input.estimatedFrameCount > input.frameCountLimit) {
    const step = Math.max(1, Math.floor(input.estimatedFrameCount / input.frameCountLimit));
    return `select=not(mod(n\\,${step}))`;
  }

  if (input.durationSeconds && input.durationSeconds > 0) {
    const fps = input.frameCountLimit / input.durationSeconds;
    const normalizedFps = Math.max(0.01, fps);
    return `fps=${normalizedFps.toFixed(6)}`;
  }

  return "fps=1";
}

export async function extractVideoFrames(input: ExtractVideoFramesInput): Promise<VideoFrameExtractionResult> {
  const runCommand = input.runCommand ?? defaultCommandRunner;
  const requestedFrames = Math.max(1, Math.floor(input.maxFrames));

  await fs.mkdir(input.outputDir, { recursive: true });
  await fs.rm(input.outputDir, { recursive: true, force: true });
  await fs.mkdir(input.outputDir, { recursive: true });

  let probe: ProbeResult;
  try {
    const probeResult = await runCommand("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration,nb_frames,avg_frame_rate,r_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      input.videoPath,
    ]);
    probe = probeFromJson(probeResult.stdout);
  } catch (error) {
    throw new Error(normalizeExecErrorMessage("ffprobe", error));
  }

  const frameCountLimit = probe.estimatedFrameCount
    ? Math.min(requestedFrames, Math.max(1, probe.estimatedFrameCount))
    : requestedFrames;
  const filter = ffmpegFilter({
    frameCountLimit,
    estimatedFrameCount: probe.estimatedFrameCount,
    durationSeconds: probe.durationSeconds,
  });
  const outputPattern = path.join(input.outputDir, OUTPUT_PATTERN);

  try {
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input.videoPath,
      "-vf",
      filter,
      "-frames:v",
      String(frameCountLimit),
      "-q:v",
      "2",
      outputPattern,
    ]);
  } catch (error) {
    throw new Error(normalizeExecErrorMessage("ffmpeg", error));
  }

  const frameFiles = (await fs.readdir(input.outputDir))
    .filter((name) => name.toLowerCase().endsWith(".jpg"))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, frameCountLimit);

  const frames: ExtractedVideoFrame[] = [];
  for (const [zeroBasedIndex, fileName] of frameFiles.entries()) {
    const filePath = path.join(input.outputDir, fileName);
    const bytes = await fs.readFile(filePath);
    frames.push({
      frameIndex: zeroBasedIndex + 1,
      timestampMs: toTimestampMs({
        frameIndex: zeroBasedIndex + 1,
        frameCount: frameFiles.length,
        durationSeconds: probe.durationSeconds,
        fps: probe.fps,
      }),
      width: probe.width,
      height: probe.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      filePath,
    });
  }

  return { probe, frames };
}

export const __private = {
  probeFromJson,
  parseFraction,
  ffmpegFilter,
  toTimestampMs,
};

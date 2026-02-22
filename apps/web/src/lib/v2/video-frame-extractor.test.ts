import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { __private, extractVideoFrames } from "./video-frame-extractor.ts";

test("extractVideoFrames uses ffprobe metadata and writes frame metadata from extracted files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "flowstate-video-extract-"));
  const outputDir = path.join(tempDir, "frames");
  const videoPath = path.join(tempDir, "input.mp4");
  await fs.writeFile(videoPath, "fake");

  const observed: Array<{ command: string; args: string[] }> = [];
  const runCommand = async (command: string, args: string[]) => {
    observed.push({ command, args });

    if (command === "ffprobe") {
      return {
        stdout: JSON.stringify({
          streams: [
            {
              width: 1280,
              height: 720,
              duration: "8",
              nb_frames: "240",
              avg_frame_rate: "30/1",
            },
          ],
          format: { duration: "8" },
        }),
        stderr: "",
      };
    }

    if (command === "ffmpeg") {
      const outputPattern = args[args.length - 1] ?? "";
      assert.ok(outputPattern.endsWith("frame-%06d.jpg"));
      await fs.mkdir(path.dirname(outputPattern), { recursive: true });
      await fs.writeFile(path.join(path.dirname(outputPattern), "frame-000001.jpg"), Buffer.from("a"));
      await fs.writeFile(path.join(path.dirname(outputPattern), "frame-000002.jpg"), Buffer.from("b"));
      await fs.writeFile(path.join(path.dirname(outputPattern), "frame-000003.jpg"), Buffer.from("c"));
      return { stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const result = await extractVideoFrames({
    videoPath,
    outputDir,
    maxFrames: 3,
    runCommand,
  });

  assert.equal(result.probe.width, 1280);
  assert.equal(result.probe.height, 720);
  assert.equal(result.frames.length, 3);
  assert.equal(result.frames[0]?.frameIndex, 1);
  assert.equal(result.frames[0]?.timestampMs, 0);
  assert.equal(result.frames[1]?.timestampMs, 2667);
  assert.ok(result.frames[0]?.sha256.length === 64);

  const ffmpegArgs = observed.find((entry) => entry.command === "ffmpeg")?.args ?? [];
  const filterArg = ffmpegArgs[ffmpegArgs.indexOf("-vf") + 1];
  assert.equal(filterArg, "select=not(mod(n\\,80))");

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("helper functions parse ffprobe-style fractions and fallback filter choices", () => {
  assert.equal(__private.parseFraction("30000/1001")?.toFixed(3), "29.970");
  assert.equal(__private.parseFraction("0/0"), null);
  assert.equal(
    __private.ffmpegFilter({
      frameCountLimit: 10,
      estimatedFrameCount: null,
      durationSeconds: 20,
    }),
    "fps=0.500000",
  );
  assert.equal(
    __private.ffmpegFilter({
      frameCountLimit: 4,
      estimatedFrameCount: null,
      durationSeconds: null,
    }),
    "fps=1",
  );
});

test("extractVideoFrames returns a clear error when ffprobe is unavailable", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "flowstate-video-extract-missing-"));
  const videoPath = path.join(tempDir, "input.mp4");
  await fs.writeFile(videoPath, "fake");

  const missingBinaryError = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
  await assert.rejects(
    () =>
      extractVideoFrames({
        videoPath,
        outputDir: path.join(tempDir, "frames"),
        maxFrames: 4,
        runCommand: async () => {
          throw missingBinaryError;
        },
      }),
    /ffprobe binary is not available on PATH/,
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

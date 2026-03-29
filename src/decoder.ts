import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { FileError, DependencyError, DecodeError } from "./errors.js";
import type { VideoInfo, FrameData } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Get video metadata using ffprobe.
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const args = [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];

  let stdout: string;
  try {
    const result = await execFileAsync("ffprobe", args, { timeout: 10_000 });
    stdout = result.stdout;
  } catch (err: unknown) {
    if (isEnoent(err)) {
      throw new DependencyError("ffprobe");
    }
    throw new FileError(filePath);
  }

  const probe = JSON.parse(stdout);
  const videoStream = probe.streams?.find(
    (s: Record<string, unknown>) => s.codec_type === "video"
  );

  if (!videoStream) {
    throw new DecodeError("No video stream found in file");
  }

  const hasAudio = probe.streams?.some(
    (s: Record<string, unknown>) => s.codec_type === "audio"
  ) ?? false;

  const width: number = videoStream.width;
  const height: number = videoStream.height;

  // Parse FPS from r_frame_rate (e.g., "30/1" or "24000/1001")
  const [num, den] = (videoStream.r_frame_rate as string).split("/").map(Number);
  const fps = den ? num / den : 30;

  const duration = parseFloat(probe.format?.duration ?? "0");
  const totalFrames = Math.round(duration * fps);

  return { width, height, fps, duration, totalFrames, hasAudio };
}

/**
 * Async generator that yields decoded frames from a video file.
 *
 * Spawns ffmpeg to decode video to raw RGB24 pixel data,
 * buffering chunks and yielding complete frames one at a time.
 */
export async function* extractFrames(
  filePath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  scaleQuality: "fast" | "balanced" | "quality" = "balanced"
): AsyncGenerator<FrameData> {
  const scaleFlags =
    scaleQuality === "fast"
      ? "fast_bilinear"
      : scaleQuality === "quality"
        ? "lanczos+accurate_rnd+full_chroma_int"
        : "bicubic";

  const args = [
    "-i", filePath,
    "-vf", `scale=${targetWidth}:${targetHeight}:flags=${scaleFlags},fps=${targetFps}`,
    "-pix_fmt", "rgb24",
    "-f", "rawvideo",
    "-v", "quiet",
    "pipe:1",
  ];

  const child = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Suppress ffmpeg's stderr output
  child.stderr.resume();

  const frameSize = targetWidth * targetHeight * 3; // RGB24 bytes per frame
  let buffer = Buffer.alloc(0);
  let frameIndex = 0;

  try {
    for await (const chunk of child.stdout) {
      buffer = Buffer.concat([buffer, chunk as Buffer]);

      while (buffer.length >= frameSize) {
        const data = buffer.subarray(0, frameSize);
        buffer = buffer.subarray(frameSize);

        yield {
          data,
          width: targetWidth,
          height: targetHeight,
          timestamp: frameIndex / targetFps,
        };
        frameIndex++;
      }
    }
  } finally {
    if (!child.killed) {
      child.kill();
    }
  }
}

/**
 * Check if an error is an ENOENT (command not found) error.
 */
function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

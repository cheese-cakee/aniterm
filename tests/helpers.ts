import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

/**
 * Generate a synthetic test video using ffmpeg.
 * Creates a 2-second 320x240 video with color bars and a sine wave audio tone.
 */
export async function createTestVideo(): Promise<string> {
  const dir = FIXTURES_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const path = join(dir, "test-video.mp4");

  if (existsSync(path)) return path;

  // Generate 2 seconds of color bars + sine wave audio
  const args = [
    "-y",
    // Video: 2 seconds of SMPTE color bars at 10fps, 320x240
    "-f", "lavfi", "-i", "smptebars=duration=2:size=320x240:rate=10",
    // Audio: 440Hz sine wave
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    path,
  ];

  await execFileAsync("ffmpeg", args, { timeout: 30_000 });
  return path;
}

/**
 * Generate a video-only test file (no audio track).
 */
export async function createSilentVideo(): Promise<string> {
  const dir = FIXTURES_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const path = join(dir, "test-silent.mp4");
  if (existsSync(path)) return path;

  const args = [
    "-y",
    "-f", "lavfi", "-i", "color=c=red:duration=1:size=160x120:rate=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    path,
  ];

  await execFileAsync("ffmpeg", args, { timeout: 30_000 });
  return path;
}

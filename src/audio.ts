import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";


const execFileAsync = promisify(execFile);

export interface AudioController {
  stop(): void;
  togglePause(): void;
}

/**
 * Extract audio from a video file to a temporary WAV file.
 * Returns the path to the extracted audio, or null if no audio track exists.
 */
export async function extractAudio(videoPath: string): Promise<string | null> {
  const audioPath = join(tmpdir(), `terminal-video-${randomUUID()}.wav`);

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", videoPath,
      "-vn", "-acodec", "pcm_s16le",
      "-ar", "44100", "-ac", "2",
      audioPath,
    ], { timeout: 30_000 });

    return existsSync(audioPath) ? audioPath : null;
  } catch {
    return null;
  }
}

/**
 * Play an audio file using ffplay in the background.
 * Returns a controller to stop/pause playback.
 */
export function playAudio(audioPath: string): AudioController {
  return spawnAudioController([
    "-nodisp", "-autoexit", "-loglevel", "quiet",
    audioPath,
  ]);
}

export function playAudioFromSource(sourcePath: string): AudioController {
  return spawnAudioController([
    "-nodisp", "-autoexit", "-loglevel", "quiet",
    "-vn",
    sourcePath,
  ]);
}

function spawnAudioController(ffplayArgs: string[]): AudioController {
  const child = spawn("ffplay", ffplayArgs, {
    stdio: ["pipe", "ignore", "ignore"],
  });

  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // ffplay not available — silent fallback
    }
  });

  return {
    stop() {
      if (!child.killed) {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write("q");
        }
        child.kill();
      }
    },
    togglePause() {
      if (child.killed || !child.stdin || child.stdin.destroyed) return;
      child.stdin.write("p");
    },
  };
}

/**
 * Clean up a temporary audio file.
 */
export async function cleanupAudio(path: string): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
  } catch {
    // File may already be cleaned up
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DependencyError } from "./errors.js";

const execFileAsync = promisify(execFile);
const MISSING_COMMAND_RE = /was not found|not recognized as an internal or external command|no such file or directory/i;
const MISSING_MODULE_RE = /no module named yt_dlp/i;

interface Runner {
  readonly command: string;
  readonly args: readonly string[];
}

interface DepCheck {
  readonly command: string;
  readonly args: readonly string[];
  readonly label: string;
}

const REQUIRED_DEPS: readonly DepCheck[] = [
  { command: "ffmpeg", args: ["-version"], label: "ffmpeg" },
  { command: "ffprobe", args: ["-version"], label: "ffprobe" },
];

/**
 * Check that a single external command is available on PATH.
 */
async function checkOne(dep: DepCheck): Promise<void> {
  try {
    await execFileAsync(dep.command, dep.args, { timeout: 5000 });
  } catch {
    throw new DependencyError(dep.label);
  }
}

/**
 * Verify all required external dependencies are installed.
 * Throws DependencyError with installation instructions on failure.
 */
export async function ensureDependencies(): Promise<void> {
  await Promise.all(REQUIRED_DEPS.map(checkOne));
}

/**
 * Check if ffplay is available (optional — for audio playback).
 */
export async function hasFfplay(): Promise<boolean> {
  try {
    await execFileAsync("ffplay", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if yt-dlp is available (optional — for YouTube support).
 */
export async function hasYtdl(): Promise<boolean> {
  const runners: readonly Runner[] = [
    { command: "yt-dlp", args: ["--version"] },
    { command: "python3", args: ["-m", "yt_dlp", "--version"] },
    { command: "python", args: ["-m", "yt_dlp", "--version"] },
    { command: "py", args: ["-3", "-m", "yt_dlp", "--version"] },
  ];

  for (const runner of runners) {
    try {
      await execFileAsync(runner.command, runner.args, { timeout: 5000 });
      return true;
    } catch (err: unknown) {
      const stderr =
        err instanceof Error && "stderr" in err && typeof (err as Error & { stderr?: unknown }).stderr === "string"
          ? ((err as Error & { stderr?: unknown }).stderr as string)
          : "";
      const rawCode = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
      const numericCode = typeof rawCode === "number" ? rawCode : undefined;

      if (
        rawCode === "ENOENT" ||
        numericCode === 9009 ||
        MISSING_COMMAND_RE.test(stderr) ||
        MISSING_MODULE_RE.test(stderr)
      ) {
        continue;
      }

      return false;
    }
  }

  return false;
}

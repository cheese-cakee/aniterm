import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { DependencyError, FileError } from "./errors.js";

const execFileAsync = promisify(execFile);

const YT_DLP_ARGS = ["-g", "-f", "best[ext=mp4]", "--js-runtimes", "nodejs"];
const MISSING_COMMAND_RE = /was not found|not recognized as an internal or external command|no such file or directory/i;
const MISSING_MODULE_RE = /no module named yt_dlp/i;

interface Runner {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

const YT_DLP_RUNNERS: readonly Runner[] = [
  { command: "yt-dlp", prefixArgs: [] },
  { command: "python3", prefixArgs: ["-m", "yt_dlp"] },
  { command: "python", prefixArgs: ["-m", "yt_dlp"] },
  { command: "py", prefixArgs: ["-3", "-m", "yt_dlp"] },
];

function getErrorCode(err: unknown): string | number | undefined {
  if (err instanceof Error && "code" in err) {
    return (err as NodeJS.ErrnoException).code;
  }
  return undefined;
}

function getErrorStderr(err: unknown): string {
  if (err instanceof Error && "stderr" in err) {
    const stderr = (err as Error & { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr : "";
  }
  return "";
}

function isCommandUnavailable(err: unknown): boolean {
  const code = getErrorCode(err);
  if (code === "ENOENT" || code === 9009) {
    return true;
  }
  return MISSING_COMMAND_RE.test(getErrorStderr(err));
}

function isMissingYtdlpModule(err: unknown): boolean {
  return MISSING_MODULE_RE.test(getErrorStderr(err));
}

/**
 * Try to run yt-dlp via multiple methods.
 * Returns stdout on success, throws on failure.
 */
async function runYtdl(args: string[]): Promise<string> {
  for (const runner of YT_DLP_RUNNERS) {
    try {
      const { stdout } = await execFileAsync(
        runner.command,
        [...runner.prefixArgs, ...args],
        { timeout: 30_000 }
      );
      return stdout.trim();
    } catch (err: unknown) {
      if (isCommandUnavailable(err) || isMissingYtdlpModule(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new DependencyError("yt-dlp (pip install yt-dlp)");
}

/**
 * Resolve a video source to a playable path.
 * - If it's a local file path that exists, return it as-is
 * - If it's a URL, use yt-dlp to get the direct stream URL
 */
export async function resolveVideo(input: string): Promise<string> {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const streamUrl = await runYtdl([...YT_DLP_ARGS, input]);
    return streamUrl;
  }

  if (!existsSync(input)) {
    throw new FileError(input);
  }

  return input;
}

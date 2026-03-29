import { getTerminalSize } from "./utils.js";
import { extractFrames, getVideoInfo } from "./decoder.js";
import {
  createFrameRenderer,
  fitToTerminal,
  renderProgressBar,
  renderInputLine,
  terminal,
} from "./renderer.js";
import { extractAudio, playAudio, playAudioFromSource, cleanupAudio } from "./audio.js";
import { resolveVideo } from "./ytdl.js";
import { hasFfplay } from "./deps.js";
import { resolvePlayOptions } from "./profiles.js";
import type { PlayOptions, PlaybackState, QueueItem, CommandAction } from "./types.js";
import type { AudioController } from "./audio.js";

const HELP_TEXT = [
  "\x1b[31m  /p        \x1b[0m  pause / play",
  "\x1b[31m  /q        \x1b[0m  quit",
  "\x1b[31m  /r        \x1b[0m  replay current video",
  "\x1b[31m  /add <f>  \x1b[0m  add video to queue",
  "\x1b[31m  /menu     \x1b[0m  show queue",
  "\x1b[31m  /h        \x1b[0m  show this help",
  "",
  "  press enter after typing a command",
].join("\n");

export async function play(
  queue: QueueItem[],
  options: PlayOptions = {}
): Promise<PlaybackState> {
  if (queue.length === 0) return "stopped";

  const resolvedOptions = resolvePlayOptions(options);
  const terminalSize = getTerminalSize();
  const term = {
    cols: resolvedOptions.maxCols ? Math.min(terminalSize.cols, resolvedOptions.maxCols) : terminalSize.cols,
    rows: resolvedOptions.maxRows ? Math.min(terminalSize.rows, resolvedOptions.maxRows) : terminalSize.rows,
  };
  let queueIndex = 0;
  let shouldQuit = false;

  const commandQueue: CommandAction[] = [];
  const inputState = { buffer: "" };
  const stopInput = startInputHandler(commandQueue, inputState);

  try {
    while (queueIndex < queue.length && !shouldQuit) {
      const item = queue[queueIndex];
      const resolved = await resolveVideo(item.source);

      process.stdout.write(`\x1b[31m  now playing: ${item.label}\x1b[0m\n`);

      const result = await playOne(resolved, options, term, commandQueue, inputState, queue);

      switch (result) {
        case "quit":
          shouldQuit = true;
          break;
        case "replay":
          break;
        case "stopped":
          queueIndex++;
          break;
        default:
          queueIndex++;
          break;
      }
    }
  } finally {
    stopInput();
  }

  return "stopped";
}

async function playOne(
  filePath: string,
  options: PlayOptions,
  term: { rows: number; cols: number },
  commandQueue: CommandAction[],
  inputState: { buffer: string },
  queue: QueueItem[]
): Promise<string> {
  const resolvedOptions = resolvePlayOptions(options);
  const info = await getVideoInfo(filePath);
  const aspect = info.width / info.height;
  const dims = fitToTerminal(aspect, term, resolvedOptions.renderMode);
  let outW = resolvedOptions.width ?? dims.width;
  let outH = resolvedOptions.height ?? dims.height;
  if (resolvedOptions.width === undefined && resolvedOptions.height === undefined) {
    outW = Math.max(1, Math.floor(outW * resolvedOptions.scale));
    outH = Math.max(1, Math.floor(outH * resolvedOptions.scale));
  }
  const decoderFps = Math.max(1, Math.min(info.fps, resolvedOptions.fps));
  const scaleQuality =
    resolvedOptions.activeProfile === "quality"
      ? "balanced"
      : resolvedOptions.activeProfile === "potato"
        ? "fast"
        : "balanced";

  let audioControl: AudioController | null = null;
  let audioPath: string | null = null;
  const frameRenderer = createFrameRenderer({
    renderMode: resolvedOptions.renderMode,
    colorMode: resolvedOptions.colorMode,
    ditherMode: resolvedOptions.ditherMode,
    gamma: resolvedOptions.gamma,
    contrast: resolvedOptions.contrast,
  });

  if (!resolvedOptions.noAudio && info.hasAudio && await hasFfplay()) {
    const lowPowerAudio = resolvedOptions.activeProfile === "potato" || resolvedOptions.adaptive;
    if (lowPowerAudio) {
      audioControl = playAudioFromSource(filePath);
    } else {
      audioPath = await extractAudio(filePath);
      if (audioPath) {
        audioControl = playAudio(audioPath);
      }
    }
  }

  terminal.enter();

  const cleanup = async () => {
    if (audioControl) audioControl.stop();
    if (audioPath) await cleanupAudio(audioPath);
    terminal.exit();
  };

  let paused = false;
  const startTime = process.hrtime.bigint();
  let renderedFrames = 0;
  let effectiveFps = Math.max(resolvedOptions.minFps, Math.min(resolvedOptions.maxFps, decoderFps));
  let frameBudgetMs = 1000 / effectiveFps;
  let lastRenderedAtMs = -Infinity;
  let movingRenderMs = frameBudgetMs;
  let movingTotalMs = frameBudgetMs;
  let missStreak = 0;
  let headroomStreak = 0;

  try {
      const frames = extractFrames(filePath, outW, outH, decoderFps, scaleQuality);
      const staleThresholdMs = frameBudgetMs * 1.6;

    for await (const frame of frames) {
      while (commandQueue.length > 0) {
        const cmd = commandQueue.shift()!;

        switch (cmd.type) {
          case "pause":
            paused = !paused;
            if (audioControl) {
              audioControl.togglePause();
            }
            break;
          case "quit":
            await cleanup();
            return "quit";
          case "replay":
            await cleanup();
            return "replay";
          case "help":
            await cleanup();
            process.stdout.write(HELP_TEXT + "\n\n");
            terminal.enter();
            break;
          case "add":
            if (cmd.arg) {
              const label = cmd.arg.split(/[/\\]/).pop() ?? cmd.arg;
              queue.push({ source: cmd.arg, label });
            }
            break;
          case "menu":
            await cleanup();
            printQueue(queue);
            terminal.enter();
            break;
        }
      }

      if (paused) {
        const elapsedSec = (Number(process.hrtime.bigint() - startTime) / 1_000_000) / 1000;
        const progressBar = renderProgressBar(elapsedSec, info.duration, term.cols, true);
        const inputLine = renderInputLine(inputState.buffer, term.cols);
        await terminal.writeFrame(frameRenderer.render(frame), progressBar, inputLine);
        await sleep(100);
        continue;
      }

      const nowMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      if (resolvedOptions.adaptive && nowMs - lastRenderedAtMs < frameBudgetMs * 0.9) {
        continue;
      }

      const frameStartNs = process.hrtime.bigint();
      const elapsedMs = Number(frameStartNs - startTime) / 1_000_000;
      const elapsedSec = elapsedMs / 1000;
      const latenessMs = elapsedMs - frame.timestamp * 1000;
      if (resolvedOptions.adaptive && latenessMs > staleThresholdMs) {
        continue;
      }
      const progressBar = renderProgressBar(elapsedSec, info.duration, term.cols, false);
      const inputLine = renderInputLine(inputState.buffer, term.cols);
      await terminal.writeFrame(frameRenderer.render(frame), progressBar, inputLine);
      const frameEndNs = process.hrtime.bigint();

      renderedFrames++;
      lastRenderedAtMs = Number(frameEndNs - startTime) / 1_000_000;

      const renderMs = Number(frameEndNs - frameStartNs) / 1_000_000;
      const totalMs = Number(process.hrtime.bigint() - frameStartNs) / 1_000_000;
      movingRenderMs = movingRenderMs * 0.9 + renderMs * 0.1;
      movingTotalMs = movingTotalMs * 0.9 + totalMs * 0.1;

      const drift = frameBudgetMs - totalMs;
      if (drift > 1) {
        await sleep(drift);
      }

      if (resolvedOptions.adaptive && renderedFrames >= 12) {
        if (movingTotalMs > frameBudgetMs * 1.12) {
          missStreak++;
          headroomStreak = 0;
        } else if (movingTotalMs < frameBudgetMs * 0.65) {
          headroomStreak++;
          missStreak = 0;
        } else {
          missStreak = 0;
          headroomStreak = 0;
        }

        if (missStreak >= 8) {
          const nextFps = Math.max(resolvedOptions.minFps, effectiveFps - 1);
          if (nextFps < effectiveFps) {
            effectiveFps = nextFps;
            frameBudgetMs = 1000 / effectiveFps;
            if (resolvedOptions.stats) {
                process.stdout.write(
                `\n\x1b[31m[adaptive] lower fps -> ${effectiveFps} (avg ${movingTotalMs.toFixed(1)}ms render ${movingRenderMs.toFixed(1)}ms)\x1b[0m\n`
              );
            }
          }
          missStreak = 0;
        } else if (headroomStreak >= 20) {
          const nextFps = Math.min(resolvedOptions.maxFps, effectiveFps + 1);
          if (nextFps > effectiveFps) {
            effectiveFps = nextFps;
            frameBudgetMs = 1000 / effectiveFps;
            if (resolvedOptions.stats) {
                process.stdout.write(
                `\n\x1b[31m[adaptive] raise fps -> ${effectiveFps} (avg ${movingTotalMs.toFixed(1)}ms render ${movingRenderMs.toFixed(1)}ms)\x1b[0m\n`
              );
            }
          }
          headroomStreak = 0;
        }
      }

      if (resolvedOptions.stats && renderedFrames % 30 === 0) {
        process.stdout.write(
          `\n\x1b[2m[stats] fps=${effectiveFps} budget=${frameBudgetMs.toFixed(1)}ms avgRender=${movingRenderMs.toFixed(1)}ms avgFrame=${movingTotalMs.toFixed(1)}ms\x1b[0m\n`
        );
      }
    }

    await cleanup();
    return "stopped";
  } catch {
    await cleanup();
    return "stopped";
  }
}

function startInputHandler(
  commandQueue: CommandAction[],
  inputState: { buffer: string }
): () => void {
  const onData = (data: Buffer) => {
    const char = data.toString();

    for (const c of char) {
      if (c === "\r" || c === "\n") {
        const cmd = inputState.buffer.trim();
        inputState.buffer = "";
        if (cmd.startsWith("/")) {
          commandQueue.push(parseCommand(cmd));
        }
      } else if (c === "\x7f" || c === "\b") {
        inputState.buffer = inputState.buffer.slice(0, -1);
      } else if (c >= " " && c <= "~") {
        // Only printable ASCII
        inputState.buffer += c;
      }
    }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", onData);

  return () => {
    process.stdin.removeListener("data", onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };
}

function parseCommand(input: string): CommandAction {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(" ") || undefined;

  switch (cmd) {
    case "p":
      return { type: "pause" };
    case "q":
      return { type: "quit" };
    case "r":
      return { type: "replay" };
    case "h":
    case "help":
      return { type: "help" };
    case "add":
      return { type: "add", arg };
    case "menu":
      return { type: "menu" };
    default:
      return { type: "none" };
  }
}

function printQueue(queue: QueueItem[]): void {
  if (queue.length === 0) {
    process.stdout.write("  queue empty\n\n");
  } else {
    process.stdout.write("  queue:\n");
    queue.forEach((item, i) => {
      process.stdout.write(`    ${i + 1}. ${item.label}\n`);
    });
    process.stdout.write("\n");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

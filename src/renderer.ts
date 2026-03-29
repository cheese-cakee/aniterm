import type { ColorMode, DitherMode, EffectiveRenderMode, FrameData, RenderMode, TerminalSize } from "./types.js";
import { rgbToAnsi256, ansi } from "./ansi.js";

const DEFAULT_ASCII_RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|\\/*tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

export interface FrameRenderer {
  render(frame: FrameData): string;
}

export interface FrameRendererOptions {
  readonly renderMode?: RenderMode;
  readonly colorMode?: ColorMode;
  readonly ditherMode?: DitherMode;
  readonly monoThreshold?: number;
  readonly cell?: string;
  readonly gamma?: number;
  readonly contrast?: number;
  readonly asciiRamp?: string;
}

interface RenderContext {
  width: number;
  height: number;
  lines: string[];
  rowParts: string[];
  rowParts2?: string[];
  ditherErrorA?: Float32Array;
  ditherErrorB?: Float32Array;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyTone(value: number, gamma: number, contrast: number): number {
  const normalized = clamp(value / 255, 0, 1);
  const corrected = Math.pow(normalized, 1 / gamma);
  const contrasted = (corrected - 0.5) * contrast + 0.5;
  return clamp(contrasted, 0, 1);
}

function encodeMono(r: number, g: number, b: number, threshold: number): number {
  return luminance(r, g, b) >= threshold ? 1 : 0;
}

function createColorPicker(colorMode: ColorMode, monoThreshold: number): (r: number, g: number, b: number) => string {
  if (colorMode === "mono") {
    return (r, g, b) => (encodeMono(r, g, b, monoThreshold) === 1 ? "\x1b[97m" : "\x1b[30m");
  }

  if (colorMode === "256") {
    return (r, g, b) => `\x1b[38;5;${rgbToAnsi256(r, g, b)}m`;
  }

  return (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
}

function createBgColorPicker(colorMode: ColorMode, monoThreshold: number): (r: number, g: number, b: number) => string {
  if (colorMode === "mono") {
    return (r, g, b) => (encodeMono(r, g, b, monoThreshold) === 1 ? "\x1b[47m" : "\x1b[40m");
  }

  if (colorMode === "256") {
    return (r, g, b) => `\x1b[48;5;${rgbToAnsi256(r, g, b)}m`;
  }

  return (r, g, b) => `\x1b[48;2;${r};${g};${b}m`;
}

function buildAsciiMap(ramp: string): string[] {
  const chars = [...ramp];
  return chars.length > 1 ? chars : [...DEFAULT_ASCII_RAMP];
}

function buildContext(width: number, height: number, renderMode: RenderMode): RenderContext {
  const base = {
    width,
    height,
    lines: new Array(height),
    rowParts: new Array(width * 2 + 4),
  };
  if (renderMode === "halfblock") {
    return {
      ...base,
      lines: new Array(Math.ceil(height / 2)),
      rowParts: new Array(width * 3 + 4),
      rowParts2: new Array(width * 3 + 4),
      ditherErrorA: new Float32Array(width + 2),
      ditherErrorB: new Float32Array(width + 2),
    };
  }
  if (renderMode === "ascii") {
    return {
      ...base,
      ditherErrorA: new Float32Array(width + 2),
      ditherErrorB: new Float32Array(width + 2),
    };
  }
  if (renderMode === "braille") {
    return {
      ...base,
      lines: new Array(Math.ceil(height / 4)),
      rowParts: new Array(Math.ceil(width / 2) * 2 + 4),
    };
  }
  return base;
}

function brailleCode(bits: number): string {
  return String.fromCodePoint(0x2800 + bits);
}

function renderBrailleFrame(
  frame: FrameData,
  ctx: RenderContext,
  getFgColor: (r: number, g: number, b: number) => string,
  colorCache: Map<number, string>,
  gamma: number,
  contrast: number,
  ditherMode: DitherMode
): string {
  const { data, width, height } = frame;
  const outWidth = Math.floor(width / 2);
  const outHeight = Math.ceil(height / 4);
  const rowBytes = width * 3;
  const thresholdBase = 0.5;

  const getColor = (r: number, g: number, b: number): string => {
    const key = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const value = getFgColor(r, g, b);
    colorCache.set(key, value);
    return value;
  };

  for (let yOut = 0; yOut < outHeight; yOut++) {
    let partIndex = 0;
    const yBase = yOut * 4;

    for (let xOut = 0; xOut < outWidth; xOut++) {
      const xBase = xOut * 2;
      let bits = 0;
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let samples = 0;

      const dotMap = [
        { dx: 0, dy: 0, bit: 0x01 },
        { dx: 0, dy: 1, bit: 0x02 },
        { dx: 0, dy: 2, bit: 0x04 },
        { dx: 1, dy: 0, bit: 0x08 },
        { dx: 1, dy: 1, bit: 0x10 },
        { dx: 1, dy: 2, bit: 0x20 },
        { dx: 0, dy: 3, bit: 0x40 },
        { dx: 1, dy: 3, bit: 0x80 },
      ] as const;

      for (const dot of dotMap) {
        const x = xBase + dot.dx;
        const y = yBase + dot.dy;
        if (x >= width || y >= height) continue;
        const offset = y * rowBytes + x * 3;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const tone = applyTone(luminance(r, g, b), gamma, contrast);
        let threshold = thresholdBase;
        if (ditherMode === "ordered") {
          threshold += orderedDitherLevel(x, y) * 0.2;
        }
        if (tone >= threshold) bits |= dot.bit;
        rAcc += r;
        gAcc += g;
        bAcc += b;
        samples++;
      }

      if (samples === 0 || bits === 0) {
        ctx.rowParts[partIndex++] = ansi.reset;
        ctx.rowParts[partIndex++] = " ";
        continue;
      }

      const rMean = Math.round(rAcc / samples);
      const gMean = Math.round(gAcc / samples);
      const bMean = Math.round(bAcc / samples);

      ctx.rowParts[partIndex++] = getColor(rMean, gMean, bMean);
      ctx.rowParts[partIndex++] = brailleCode(bits);
    }

    ctx.rowParts[partIndex] = ansi.reset;
    ctx.lines[yOut] = ctx.rowParts.join("");
  }

  return ctx.lines.slice(0, outHeight).join("\n");
}

function orderedDitherLevel(x: number, y: number): number {
  const bayer4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  return (bayer4[y % 4][x % 4] - 7.5) / 16;
}

function renderBlockFrame(
  frame: FrameData,
  ctx: RenderContext,
  getBgColor: (r: number, g: number, b: number) => string,
  colorCache: Map<number, string>,
  cell: string
): string {
  const { data, width, height } = frame;
  const rowBytes = width * 3;

  const getColor = (r: number, g: number, b: number): string => {
    const key = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const value = getBgColor(r, g, b);
    colorCache.set(key, value);
    return value;
  };

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    let partIndex = 0;

    for (let x = 0; x < width; x++) {
      const offset = rowStart + x * 3;
      ctx.rowParts[partIndex++] = getColor(data[offset], data[offset + 1], data[offset + 2]);
      ctx.rowParts[partIndex++] = cell;
    }

    ctx.rowParts[partIndex] = ansi.reset;
    ctx.lines[y] = ctx.rowParts.join("");
  }

  return ctx.lines.join("\n");
}

function renderAsciiFrame(
  frame: FrameData,
  ctx: RenderContext,
  getFgColor: (r: number, g: number, b: number) => string,
  colorCache: Map<number, string>,
  gamma: number,
  contrast: number,
  ditherMode: DitherMode,
  asciiMap: string[]
): string {
  const { data, width, height } = frame;
  const rowBytes = width * 3;
  const maxIndex = asciiMap.length - 1;
  const errA = ctx.ditherErrorA ?? new Float32Array(width + 2);
  const errB = ctx.ditherErrorB ?? new Float32Array(width + 2);

  const getColor = (r: number, g: number, b: number): string => {
    const key = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const value = getFgColor(r, g, b);
    colorCache.set(key, value);
    return value;
  };

  errA.fill(0);
  errB.fill(0);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    let partIndex = 0;
    errB.fill(0);

    for (let x = 0; x < width; x++) {
      const offset = rowStart + x * 3;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const tone = applyTone(luminance(r, g, b), gamma, contrast);

      let dithered = tone;
      if (ditherMode === "ordered") {
        dithered = clamp(tone + orderedDitherLevel(x, y) * 0.25, 0, 1);
      } else if (ditherMode === "floyd") {
        const corrected = clamp(tone + errA[x + 1], 0, 1);
        const quantized = Math.round(corrected * maxIndex) / maxIndex;
        const error = corrected - quantized;
        dithered = quantized;

        errA[x + 2] += error * (7 / 16);
        errB[x] += error * (3 / 16);
        errB[x + 1] += error * (5 / 16);
        errB[x + 2] += error * (1 / 16);
      }

      const glyphIndex = Math.round(dithered * maxIndex);
      ctx.rowParts[partIndex++] = getColor(r, g, b);
      ctx.rowParts[partIndex++] = asciiMap[glyphIndex];
    }

    ctx.rowParts[partIndex] = ansi.reset;
    ctx.lines[y] = ctx.rowParts.join("");
    errA.set(errB);
  }

  return ctx.lines.join("\n");
}

function renderHalfBlockFrame(
  frame: FrameData,
  ctx: RenderContext,
  getFgColor: (r: number, g: number, b: number) => string,
  getBgColor: (r: number, g: number, b: number) => string,
  fgCache: Map<number, string>,
  bgCache: Map<number, string>
): string {
  const { data, width, height } = frame;
  const rowBytes = width * 3;
  const outHeight = Math.ceil(height / 2);

  const getFg = (r: number, g: number, b: number): string => {
    const key = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = fgCache.get(key);
    if (cached) return cached;
    const value = getFgColor(r, g, b);
    fgCache.set(key, value);
    return value;
  };

  const getBg = (r: number, g: number, b: number): string => {
    const key = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = bgCache.get(key);
    if (cached) return cached;
    const value = getBgColor(r, g, b);
    bgCache.set(key, value);
    return value;
  };

  for (let yOut = 0; yOut < outHeight; yOut++) {
    const yTop = yOut * 2;
    const yBottom = Math.min(yTop + 1, height - 1);
    const rowTop = yTop * rowBytes;
    const rowBottom = yBottom * rowBytes;
    let partIndex = 0;

    for (let x = 0; x < width; x++) {
      const tOff = rowTop + x * 3;
      const bOff = rowBottom + x * 3;

      const tr = data[tOff];
      const tg = data[tOff + 1];
      const tb = data[tOff + 2];
      const br = data[bOff];
      const bg = data[bOff + 1];
      const bb = data[bOff + 2];

      ctx.rowParts[partIndex++] = getFg(tr, tg, tb);
      ctx.rowParts[partIndex++] = getBg(br, bg, bb);
      ctx.rowParts[partIndex++] = "▀";
    }

    ctx.rowParts[partIndex] = ansi.reset;
    ctx.lines[yOut] = ctx.rowParts.join("");
  }

  return ctx.lines.join("\n");
}

export function createFrameRenderer(options: FrameRendererOptions = {}): FrameRenderer {
  const requestedRenderMode = options.renderMode ?? "block";
  const renderMode: EffectiveRenderMode = requestedRenderMode === "auto" ? "ascii" : requestedRenderMode;
  const colorMode = options.colorMode ?? "truecolor";
  const monoThreshold = options.monoThreshold ?? 128;
  const gamma = clamp(options.gamma ?? 1, 0.1, 3);
  const contrast = clamp(options.contrast ?? 1, 0.1, 3);
  const ditherMode = options.ditherMode ?? "off";
  const cell = options.cell ?? "  ";
  const asciiMap = buildAsciiMap(options.asciiRamp ?? DEFAULT_ASCII_RAMP);

  const getFgColor = createColorPicker(colorMode, monoThreshold);
  const getBgColor = createBgColorPicker(colorMode, monoThreshold);

  const fgCache = new Map<number, string>();
  const bgCache = new Map<number, string>();

  let context = buildContext(0, 0, renderMode);

  return {
    render(frame: FrameData): string {
      if (frame.width !== context.width || frame.height !== context.height) {
        context = buildContext(frame.width, frame.height, renderMode);
      }

      if (renderMode === "ascii") {
        return renderAsciiFrame(
          frame,
          context,
          getFgColor,
          fgCache,
          gamma,
          contrast,
          ditherMode,
          asciiMap
        );
      }

      if (renderMode === "halfblock") {
        return renderHalfBlockFrame(frame, context, getFgColor, getBgColor, fgCache, bgCache);
      }

      if (renderMode === "braille") {
        return renderBrailleFrame(frame, context, getFgColor, fgCache, gamma, contrast, ditherMode);
      }

      return renderBlockFrame(frame, context, getBgColor, bgCache, cell);
    },
  };
}

const defaultRenderer = createFrameRenderer();

/**
 * Convert a raw RGB frame into an ANSI-colored terminal string.
 * Each pixel is rendered as two block characters to compensate for
 * character aspect ratio (~2x taller than wide).
 */
export function renderFrame(frame: FrameData): string {
  return defaultRenderer.render(frame);
}

/**
 * Calculate optimal output dimensions to fit the terminal.
 *
 * Each pixel maps to one character cell in halfblock/ascii modes.
 * For higher fidelity, we allow full terminal width in pixels.
 * Height uses remaining rows minus 3 (progress bar + input line + spacing).
 */
export function fitToTerminal(
  videoAspect: number,
  term: TerminalSize,
  renderMode: EffectiveRenderMode = "ascii"
): { width: number; height: number } {
  const usableRows = Math.max(1, term.rows - 2); // reserve 2 rows: progress + input
  const maxWidth = renderMode === "block"
    ? Math.max(1, Math.floor(term.cols / 2))
    : renderMode === "braille"
      ? Math.max(2, term.cols * 2)
      : Math.max(1, term.cols);
  const maxHeight = renderMode === "halfblock"
    ? Math.max(1, usableRows * 2)
    : renderMode === "braille"
      ? Math.max(4, usableRows * 4)
      : usableRows;

  let width = maxWidth;
  let height = Math.floor(width / videoAspect);

  if (height > maxHeight) {
    height = maxHeight;
    width = Math.floor(height * videoAspect);
  }

  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Format seconds as M:SS or H:MM:SS.
 */
function formatTime(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Build an ASCII progress bar string.
 *
 * Example: [████████░░░░░░░░] 0:45 / 1:30    /p pause  /q quit
 */
export function renderProgressBar(
  elapsed: number,
  duration: number,
  cols: number,
  paused: boolean
): string {
  const filledChar = "█";
  const emptyChar = "░";

  const timeStr = `${formatTime(elapsed)} / ${formatTime(duration)}`;
  const hint = paused ? "  paused" : "  /p pause  /q quit";
  const fixedLen = timeStr.length + hint.length + 4; // "[] " + space between

  const barWidth = Math.max(5, cols - fixedLen);
  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
  const filled = Math.round(progress * barWidth);

  const bar = filledChar.repeat(filled) + emptyChar.repeat(barWidth - filled);

  return `[${bar}] ${timeStr}${hint}`.padEnd(cols).slice(0, cols);
}

/**
 * Build an input echo line showing what the user is typing.
 */
export function renderInputLine(buffer: string, cols: number): string {
  const prompt = " > ";
  const line = prompt + buffer;
  return line.padEnd(cols).slice(0, cols);
}

/**
 * Terminal control sequences for efficient frame-by-frame rendering.
 */
let previousLines: string[] | null = null;

export const terminal = {

  enter() {
    previousLines = null;
    process.stdout.write(ansi.hideCursor + ansi.clearScreen);
  },

  exit() {
    previousLines = null;
    process.stdout.write(ansi.showCursor + ansi.reset + "\n");
  },

  /**
   * Write a frame with progress bar and input line.
   * Layout: frame on top, progress bar below, input line at bottom.
   */
  async writeFrame(frameStr: string, progressBar: string, inputLine: string) {
    const lines = frameStr.split("\n");
    lines.push(`${ansi.reset}${progressBar}`, inputLine);

    if (!previousLines || previousLines.length !== lines.length) {
      await writeChunk(ansi.home + lines.join("\n"));
      previousLines = lines;
      return;
    }

    let output = "";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === previousLines[i]) continue;
      output += `\x1b[${i + 1};1H${lines[i]}`;
    }

    if (output.length > 0) {
      await writeChunk(output);
      previousLines = lines;
    }
  },
};

async function writeChunk(chunk: string): Promise<void> {
  if (process.stdout.write(chunk)) return;
  await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

import { ANITERM_ASCII } from "./banner.js";

const RESET = "\x1b[0m";

export const ansi = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearScreen: "\x1b[2J",
  home: "\x1b[H",
  reset: RESET,
};

export function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const ri = Math.round((r / 255) * 5);
  const gi = Math.round((g / 255) * 5);
  const bi = Math.round((b / 255) * 5);
  return 16 + 36 * ri + 6 * gi + bi;
}

export function rgbToTrueColorBg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

export function rgbToBg256(r: number, g: number, b: number): string {
  return `\x1b[48;5;${rgbToAnsi256(r, g, b)}m`;
}

export function renderRow(
  row: Buffer,
  pixelWidth: number,
  useTrueColor = true
): string {
  const parts: string[] = new Array(pixelWidth);
  const colorFn = useTrueColor ? rgbToTrueColorBg : rgbToBg256;
  for (let i = 0; i < pixelWidth; i++) {
    const offset = i * 3;
    parts[i] = `${colorFn(row[offset], row[offset + 1], row[offset + 2])}  `;
  }
  parts.push(RESET);
  return parts.join("");
}

const RED = "\x1b[31m";
const DIM = "\x1b[2m";

const rawBanner = `${RED}${ANITERM_ASCII.trimEnd().split("\n").join(`${RESET}\n${RED}`)}${RESET}
${DIM}${RED}  anime openings and videos in your terminal${RESET}
${DIM}${RED}  best quality default  ·  /p pause  /q quit  /h help${RESET}
`;

export const anitermBanner = rawBanner;

export function showBanner(): void {
  process.stdout.write(`${ansi.reset}${anitermBanner}${ansi.reset}`);
}

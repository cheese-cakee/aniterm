import type { EffectiveRenderMode, RenderMode, TerminalCapabilities } from "./types.js";

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}

function envEquals(name: string, expected: string): boolean {
  return (process.env[name] ?? "").toLowerCase() === expected.toLowerCase();
}

export function detectTerminalCapabilities(): TerminalCapabilities {
  const term = (process.env.TERM ?? "").toLowerCase();
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase();

  const inTmux = hasEnv("TMUX");
  const inScreen = term.startsWith("screen");
  const trueColor =
    colorterm.includes("truecolor") ||
    colorterm.includes("24bit") ||
    term.includes("truecolor") ||
    hasEnv("WT_SESSION");
  const ansi256 = trueColor || term.includes("256color") || term.includes("xterm");
  const unicode = true;
  const kittyGraphics = term.includes("kitty") || envEquals("TERM_PROGRAM", "ghostty");
  const iTermInlineImages = termProgram === "iterm.app";
  const sixel = term.includes("sixel") || hasEnv("DECPS") || hasEnv("XTERM_SIXEL");

  return {
    unicode,
    ansi256,
    trueColor,
    kittyGraphics: kittyGraphics && !inScreen,
    iTermInlineImages: iTermInlineImages && !inScreen,
    sixel: sixel && !inScreen,
    inTmux,
    inScreen,
  };
}

export function resolveEffectiveRenderMode(
  requested: RenderMode,
  caps: TerminalCapabilities
): EffectiveRenderMode {
  if (requested !== "auto") return requested;
  // Auto mode biases toward color fidelity. Braille is kept as an explicit opt-in mode.
  if (caps.unicode && (caps.trueColor || caps.ansi256)) return "halfblock";
  if (caps.unicode) return "ascii";
  return "ascii";
}

export function resolveEffectiveColorMode(
  requested: "truecolor" | "256" | "mono",
  caps: TerminalCapabilities
): "truecolor" | "256" | "mono" {
  if (requested === "mono") return "mono";
  if (requested === "truecolor") return caps.trueColor ? "truecolor" : caps.ansi256 ? "256" : "mono";
  if (requested === "256") return caps.ansi256 ? "256" : "mono";
  return "mono";
}

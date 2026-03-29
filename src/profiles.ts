import type { ActiveProfile, PlayOptions, ProfileName, ResolvedPlayOptions } from "./types.js";
import { detectTerminalCapabilities, resolveEffectiveColorMode, resolveEffectiveRenderMode } from "./terminal-capabilities.js";

interface ProfileDefaults {
  readonly renderMode: Exclude<PlayOptions["renderMode"], undefined>;
  readonly colorMode: ResolvedPlayOptions["colorMode"];
  readonly ditherMode: ResolvedPlayOptions["ditherMode"];
  readonly adaptive: boolean;
  readonly fps: number;
  readonly minFps: number;
  readonly maxFps: number;
  readonly scale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly gamma: number;
  readonly contrast: number;
  readonly noAudio: boolean;
}

const PROFILE_DEFAULTS: Record<ActiveProfile, ProfileDefaults> = {
  potato: {
    renderMode: "halfblock",
    colorMode: "256",
    ditherMode: "ordered",
    adaptive: true,
    fps: 12,
    minFps: 10,
    maxFps: 14,
    scale: 0.55,
    minScale: 0.45,
    maxScale: 0.65,
    gamma: 1.05,
    contrast: 1.1,
    noAudio: false,
  },
  balanced: {
    renderMode: "halfblock",
    colorMode: "truecolor",
    ditherMode: "floyd",
    adaptive: true,
    fps: 22,
    minFps: 20,
    maxFps: 24,
    scale: 1,
    minScale: 0.85,
    maxScale: 1,
    gamma: 1.05,
    contrast: 1.15,
    noAudio: false,
  },
  quality: {
    renderMode: "auto",
    colorMode: "truecolor",
    ditherMode: "ordered",
    adaptive: true,
    fps: 34,
    minFps: 24,
    maxFps: 36,
    scale: 1,
    minScale: 1,
    maxScale: 1,
    gamma: 0.98,
    contrast: 1.2,
    noAudio: false,
  },
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 1;
const MIN_FPS = 1;
const MAX_FPS = 120;
const MIN_GAMMA = 0.1;
const MAX_GAMMA = 3;
const MIN_CONTRAST = 0.1;
const MAX_CONTRAST = 3;
const MIN_TERMINAL_DIM = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAutoProfile(profile: ProfileName, options: PlayOptions): ActiveProfile {
  if (profile !== "auto") return profile;
  if (options.scale !== undefined && options.scale <= 0.65) return "potato";
  if (options.renderMode === "ascii" || options.ditherMode === "floyd") return "quality";
  return "balanced";
}

export function resolvePlayOptions(options: PlayOptions = {}): ResolvedPlayOptions {
  const profile = options.profile ?? "quality";
  const activeProfile = normalizeAutoProfile(profile, options);
  const defaults = PROFILE_DEFAULTS[activeProfile];
  const capabilities = detectTerminalCapabilities();

  const fps = clamp(Math.round(options.fps ?? defaults.fps), MIN_FPS, MAX_FPS);
  const minFps = clamp(Math.round(options.minFps ?? defaults.minFps), MIN_FPS, MAX_FPS);
  const maxFps = clamp(Math.round(options.maxFps ?? defaults.maxFps), MIN_FPS, MAX_FPS);

  const scale = clamp(options.scale ?? defaults.scale, MIN_SCALE, MAX_SCALE);
  const minScale = clamp(options.minScale ?? defaults.minScale, MIN_SCALE, MAX_SCALE);
  const maxScale = clamp(options.maxScale ?? defaults.maxScale, MIN_SCALE, MAX_SCALE);

  const normalizedMinFps = Math.min(minFps, maxFps);
  const normalizedMaxFps = Math.max(minFps, maxFps);
  const normalizedFps = clamp(fps, normalizedMinFps, normalizedMaxFps);

  const normalizedMinScale = Math.min(minScale, maxScale);
  const normalizedMaxScale = Math.max(minScale, maxScale);
  const normalizedScale = clamp(scale, normalizedMinScale, normalizedMaxScale);

  return {
    width: options.width,
    height: options.height,
    maxCols: options.maxCols !== undefined ? Math.max(MIN_TERMINAL_DIM, Math.floor(options.maxCols)) : undefined,
    maxRows: options.maxRows !== undefined ? Math.max(MIN_TERMINAL_DIM, Math.floor(options.maxRows)) : undefined,
    profile,
    activeProfile,
    renderMode: resolveEffectiveRenderMode(options.renderMode ?? defaults.renderMode, capabilities),
    colorMode: resolveEffectiveColorMode(options.colorMode ?? defaults.colorMode, capabilities),
    ditherMode: options.ditherMode ?? defaults.ditherMode,
    adaptive: options.adaptive ?? defaults.adaptive,
    stats: options.stats ?? false,
    fps: normalizedFps,
    minFps: normalizedMinFps,
    maxFps: normalizedMaxFps,
    scale: normalizedScale,
    minScale: normalizedMinScale,
    maxScale: normalizedMaxScale,
    gamma: clamp(options.gamma ?? defaults.gamma, MIN_GAMMA, MAX_GAMMA),
    contrast: clamp(options.contrast ?? defaults.contrast, MIN_CONTRAST, MAX_CONTRAST),
    noAudio: options.noAudio ?? defaults.noAudio,
  };
}

export function formatResolvedOptions(options: ResolvedPlayOptions): string {
  return [
    `  profile: ${options.profile} -> ${options.activeProfile}`,
    `  render: ${options.renderMode}, color: ${options.colorMode}, dither: ${options.ditherMode}`,
    `  fps: ${options.fps} [${options.minFps}-${options.maxFps}], scale: ${options.scale.toFixed(2)} [${options.minScale.toFixed(2)}-${options.maxScale.toFixed(2)}]`,
    `  gamma: ${options.gamma.toFixed(2)}, contrast: ${options.contrast.toFixed(2)}, adaptive: ${options.adaptive ? "on" : "off"}, audio: ${options.noAudio ? "off" : "on"}`,
  ].join("\n");
}

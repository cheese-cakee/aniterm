export interface VideoInfo {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly totalFrames: number;
  readonly hasAudio: boolean;
}

export type RenderMode = "auto" | "block" | "ascii" | "halfblock" | "braille";
export type EffectiveRenderMode = Exclude<RenderMode, "auto">;
export type ColorMode = "truecolor" | "256" | "mono";
export type DitherMode = "off" | "ordered" | "floyd";
export type ProfileName = "potato" | "balanced" | "quality" | "auto";
export type ActiveProfile = Exclude<ProfileName, "auto">;

export interface TerminalCapabilities {
  readonly unicode: boolean;
  readonly ansi256: boolean;
  readonly trueColor: boolean;
  readonly kittyGraphics: boolean;
  readonly iTermInlineImages: boolean;
  readonly sixel: boolean;
  readonly inTmux: boolean;
  readonly inScreen: boolean;
}

export interface PlayOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly minFps?: number;
  readonly maxFps?: number;
  readonly scale?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly maxCols?: number;
  readonly maxRows?: number;
  readonly gamma?: number;
  readonly contrast?: number;
  readonly profile?: ProfileName;
  readonly renderMode?: RenderMode;
  readonly colorMode?: ColorMode;
  readonly ditherMode?: DitherMode;
  readonly adaptive?: boolean;
  readonly stats?: boolean;
  readonly noAudio?: boolean;
}

export interface ResolvedPlayOptions {
  readonly width?: number;
  readonly height?: number;
  readonly maxCols?: number;
  readonly maxRows?: number;
  readonly profile: ProfileName;
  readonly activeProfile: ActiveProfile;
  readonly renderMode: EffectiveRenderMode;
  readonly colorMode: ColorMode;
  readonly ditherMode: DitherMode;
  readonly adaptive: boolean;
  readonly stats: boolean;
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

export interface FrameData {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly timestamp: number;
}

export interface TerminalSize {
  readonly rows: number;
  readonly cols: number;
}

export type PlaybackState = "idle" | "playing" | "paused" | "stopped";

export interface QueueItem {
  readonly source: string;
  readonly label: string;
}

export interface CommandAction {
  readonly type: "pause" | "quit" | "replay" | "help" | "add" | "remove" | "menu" | "none";
  readonly arg?: string;
}

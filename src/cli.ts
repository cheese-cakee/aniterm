import { createInterface } from "node:readline";
import { play } from "./player.js";
import { ensureDependencies } from "./deps.js";
import { resolveVideo } from "./ytdl.js";
import { TerminalVideoError } from "./errors.js";
import { showBanner } from "./ansi.js";
import { isTTY } from "./utils.js";
import { formatResolvedOptions, resolvePlayOptions } from "./profiles.js";
import type { QueueItem, PlayOptions, ColorMode, DitherMode, ProfileName, RenderMode } from "./types.js";

const VERSION = "1.0.0";
const VALID_PROFILES: readonly ProfileName[] = ["potato", "balanced", "quality", "auto"];
const VALID_RENDER_MODES: readonly RenderMode[] = ["auto", "block", "ascii", "halfblock", "braille"];
const VALID_COLOR_MODES: readonly ColorMode[] = ["truecolor", "256", "mono"];
const VALID_DITHER_MODES: readonly DitherMode[] = ["off", "ordered", "floyd"];

const USAGE = [
  "",
  "usage:",
  "  aniterm [options] [video-or-url ...]",
  "",
  "options:",
  "  --profile <potato|balanced|quality|auto>",
  "  --render <auto|block|ascii|halfblock|braille>",
  "  --color <truecolor|256|mono>",
  "  --dither <off|ordered|floyd>",
  "  --fps <n>          --min-fps <n>      --max-fps <n>",
  "  --scale <n>        --min-scale <n>    --max-scale <n>",
  "  --max-cols <n>     --max-rows <n>",
  "  --gamma <n>        --contrast <n>",
  "  --adaptive <on|off>",
  "  --stats",
  "  --no-audio",
  "  -h, --help",
  "  -v, --version",
  "",
].join("\n");

const MENU = [
  "",
  "  \x1b[31mplay\x1b[0m      play a video (path or url)",
  "  \x1b[31madd\x1b[0m       add video to queue",
  "  \x1b[31mplayall\x1b[0m   play queue",
  "  \x1b[31mlist\x1b[0m      show queue",
  "  \x1b[31mremove\x1b[0m    remove from queue",
  "  \x1b[31mclear\x1b[0m     clear queue",
  "  \x1b[31mquit\x1b[0m      exit",
  "",
].join("\n");

interface ParsedCli {
  readonly options: PlayOptions;
  readonly inputs: string[];
  readonly showHelp: boolean;
  readonly showVersion: boolean;
  readonly errors: string[];
}

type MutablePlayOptions = { -readonly [K in keyof PlayOptions]?: PlayOptions[K] };

function hasValue<T extends string>(candidate: string, values: readonly T[]): candidate is T {
  return values.includes(candidate as T);
}

function parseNumber(value: string, flag: string, errors: string[]): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`invalid value for ${flag}: ${value}`);
    return undefined;
  }
  return parsed;
}

function parseAdaptive(value: string, errors: string[]): boolean | undefined {
  const lower = value.toLowerCase();
  if (lower === "on") return true;
  if (lower === "off") return false;
  errors.push(`invalid value for --adaptive: ${value} (expected on|off)`);
  return undefined;
}

function readFlagValue(args: string[], index: number, flag: string, errors: string[]): string | undefined {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    errors.push(`missing value for ${flag}`);
    return undefined;
  }
  return value;
}

function parseCliArgs(argv: string[]): ParsedCli {
  const options: MutablePlayOptions = {};
  const inputs: string[] = [];
  const errors: string[] = [];
  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      showHelp = true;
      continue;
    }

    if (token === "-v" || token === "--version") {
      showVersion = true;
      continue;
    }

    if (token === "--stats") {
      options.stats = true;
      continue;
    }

    if (token === "--no-audio") {
      options.noAudio = true;
      continue;
    }

    if (token === "--profile") {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        if (hasValue(value, VALID_PROFILES)) options.profile = value;
        else errors.push(`invalid --profile: ${value}`);
      }
      i++;
      continue;
    }

    if (token === "--render") {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        if (hasValue(value, VALID_RENDER_MODES)) options.renderMode = value;
        else errors.push(`invalid --render: ${value}`);
      }
      i++;
      continue;
    }

    if (token === "--color") {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        if (hasValue(value, VALID_COLOR_MODES)) options.colorMode = value;
        else errors.push(`invalid --color: ${value}`);
      }
      i++;
      continue;
    }

    if (token === "--dither") {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        if (hasValue(value, VALID_DITHER_MODES)) options.ditherMode = value;
        else errors.push(`invalid --dither: ${value}`);
      }
      i++;
      continue;
    }

    if (token === "--adaptive") {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        const adaptive = parseAdaptive(value, errors);
        if (adaptive !== undefined) options.adaptive = adaptive;
      }
      i++;
      continue;
    }

    if (
      token === "--fps" ||
      token === "--min-fps" ||
      token === "--max-fps" ||
      token === "--scale" ||
      token === "--min-scale" ||
      token === "--max-scale" ||
      token === "--max-cols" ||
      token === "--max-rows" ||
      token === "--gamma" ||
      token === "--contrast"
    ) {
      const value = readFlagValue(argv, i, token, errors);
      if (value) {
        const num = parseNumber(value, token, errors);
        if (num !== undefined) {
          if (token === "--fps") options.fps = num;
          else if (token === "--min-fps") options.minFps = num;
          else if (token === "--max-fps") options.maxFps = num;
          else if (token === "--scale") options.scale = num;
          else if (token === "--min-scale") options.minScale = num;
          else if (token === "--max-scale") options.maxScale = num;
          else if (token === "--max-cols") options.maxCols = Math.floor(num);
          else if (token === "--max-rows") options.maxRows = Math.floor(num);
          else if (token === "--gamma") options.gamma = num;
          else if (token === "--contrast") options.contrast = num;
        }
      }
      i++;
      continue;
    }

    if (token.startsWith("-")) {
      errors.push(`unknown option: ${token}`);
      continue;
    }

    inputs.push(token);
  }

  return { options, inputs, showHelp, showVersion, errors };
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.showHelp) {
    console.log(USAGE);
    return;
  }

  if (parsed.showVersion) {
    console.log(VERSION);
    return;
  }

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      console.error(`Error: ${err}`);
    }
    console.error(USAGE);
    process.exit(1);
  }

  if (!isTTY()) {
    console.error("Error: run this in a terminal.");
    process.exit(1);
  }

  await ensureDependencies();

  showBanner();
  console.log(`  aniterm v${VERSION}`);

  const queue: QueueItem[] = [];
  const options: PlayOptions = parsed.options;
  console.log(formatResolvedOptions(resolvePlayOptions(options)));

  if (parsed.inputs.length > 0) {
    const directQueue = await Promise.all(
      parsed.inputs.map(async (input) => ({
        source: await resolveVideo(input),
        label: input.split(/[/\\]/).pop() ?? input,
      }))
    );
    await play(directQueue, options);
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let running = true;

  while (running) {
    console.log(MENU);
    const choice = await prompt(rl, "  > ");

    switch (choice) {
      case "play": {
        const input = await prompt(rl, "  path or url: ");
        if (!input) break;
        const resolved = await resolveVideo(input);
        const label = input.split(/[/\\]/).pop() ?? input;
        await play([{ source: resolved, label }], options);
        break;
      }

      case "add": {
        const input = await prompt(rl, "  path or url: ");
        if (!input) break;
        const label = input.split(/[/\\]/).pop() ?? input;
        queue.push({ source: input, label });
        console.log(`  added: ${label} (${queue.length} in queue)`);
        break;
      }

      case "playall": {
        if (queue.length === 0) {
          console.log("  queue is empty. add videos first");
          break;
        }
        const resolved = await Promise.all(
          queue.map(async (item) => ({
            source: await resolveVideo(item.source),
            label: item.label,
          }))
        );
        console.log(`\n  playing ${resolved.length} video(s)...`);
        await play(resolved, options);
        break;
      }

      case "list": {
        if (queue.length === 0) {
          console.log("  queue is empty");
        } else {
          console.log("  queue:");
          queue.forEach((item, i) => {
            console.log(`    ${i + 1}. ${item.label}`);
          });
        }
        break;
      }

      case "remove": {
        if (queue.length === 0) {
          console.log("  queue is empty");
          break;
        }
        queue.forEach((item, i) => {
          console.log(`    ${i + 1}. ${item.label}`);
        });
        const idx = await prompt(rl, "  remove number: ");
        const n = parseInt(idx) - 1;
        if (n >= 0 && n < queue.length) {
          const removed = queue.splice(n, 1)[0];
          console.log(`  removed: ${removed.label}`);
        } else {
          console.log("  invalid number");
        }
        break;
      }

      case "clear":
        queue.length = 0;
        console.log("  queue cleared");
        break;

      case "quit":
        running = false;
        break;

      default:
        if (choice) console.log("  unknown command");
        break;
    }

    if (running) console.log("");
  }

  rl.close();
  console.log("  bye");
}

main().catch((err) => {
  if (err instanceof TerminalVideoError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});

# aniterm

watch anime openings in your terminal. or any video really.

<p align="left">
  <img src="./assets/aniterm-banner-red.svg" alt="aniterm red ascii logo" width="760" />
</p>

```text
   _        _
   / \   ___| |_ ___  _ __ ___
  / _ \ / __| __/ _ \| '__/ __|
 / ___ \__ \ || (_) | |  \__ \
/_/   \_\___/\__\___/|_|  |___/
```

## install

```bash
npm install -g aniterm
```

**requires [ffmpeg](https://ffmpeg.org/download.html)** on your PATH.

for YouTube support, also install [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## usage

```bash
# play a local video
aniterm video.mp4

# play a YouTube link (needs yt-dlp)
aniterm "https://youtube.com/watch?v=NbdM922nITE"

# play multiple videos (queue)
aniterm opening1.mp4 opening2.mp4

# disable audio
aniterm video.mp4 --no-audio

# just show video info
aniterm video.mp4 --info
```

## controls

during playback, type a command and press enter:

| command | action |
|---------|--------|
| `/p` | pause / play |
| `/q` | quit |
| `/r` | replay current video |
| `/add <file>` | add video to queue |
| `/menu` | show queue |
| `/h` | show help |

## jjk 8-bit openings

these look insane in the terminal:

- [AIZO - King Gnu (8-bit)](https://www.youtube.com/watch?v=NbdM922nITE)
- [AIZO - King Gnu (8-bit cover)](https://www.youtube.com/watch?v=XD8IoycT59Q)

```bash
aniterm "https://youtube.com/watch?v=NbdM922nITE"
```

## how it works

1. ffmpeg decodes video to raw RGB24 frames
2. each pixel becomes two colored block characters (`██`) using ANSI escape codes
3. ffplay plays audio in the background, synced to frame timing
4. stdin reads slash commands in raw mode

## tips

- 8-bit and pixel art videos look best — low resolution = crisp terminal rendering
- zoom out in your terminal (`Ctrl+-`) for more pixels
- works on Windows, macOS, and Linux

## programmatic API

```typescript
import { play } from "aniterm";

await play([{ source: "video.mp4", label: "my video" }]);
```

## license

MIT

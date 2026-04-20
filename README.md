# aniterm

```text
 █████╗ ███╗   ██╗██╗████████╗███████╗██████╗ ███╗   ███╗
██╔══██╗████╗  ██║██║╚══██╔══╝██╔════╝██╔══██╗████╗ ████║
███████║██╔██╗ ██║██║   ██║   █████╗  ██████╔╝██╔████╔██║
██╔══██║██║╚██╗██║██║   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║
██║  ██║██║ ╚████║██║   ██║   ███████╗██║  ██║██║ ╚═╝ ██║
╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
  anime openings and videos in your terminal
```

Watch anime openings (or any video) directly in your terminal.
High-performance C++ — OpenCV decoding, CLAHE + edge-adaptive sharpening,
halfblock `▀` 24-bit truecolor rendering.

## install

### dependencies

```bash
# Ubuntu / Debian
sudo apt install libopencv-dev cmake build-essential ffmpeg

# Arch Linux
sudo pacman -S opencv cmake base-devel ffmpeg

# macOS
brew install opencv cmake ffmpeg
```

For YouTube support, install [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```bash
pip install yt-dlp
```

### build

```bash
git clone https://github.com/cheese-cakee/aniterm
cd aniterm
make
# binary → build/aniterm
```

Or with CMake directly:

```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

## usage

```bash
# play a local video
./build/aniterm video.mp4

# play a YouTube URL (needs yt-dlp)
./build/aniterm "https://youtube.com/watch?v=NbdM922nITE"

# queue multiple videos
./build/aniterm op1.mp4 op2.mp4

# no audio
./build/aniterm video.mp4 --no-audio

# custom fps / quality
./build/aniterm video.mp4 --fps 30 --contrast 1.3 --gamma 0.85
```

## controls

Type a command and press enter during playback:

| command | action |
|---------|--------|
| `/p` | pause / resume |
| `/q` | quit |
| `/r` | replay current video |
| `/add <file>` | add video to queue |
| `/menu` | show queue |
| `/h` | show help |

## options

```
--fps <n>            target fps (0 = source fps)
--no-audio           disable audio playback
--contrast <n>       contrast multiplier  (default: 1.2)
--brightness <n>     brightness offset    (default: 0.0)
--gamma <n>          gamma correction     (default: 0.9)
--no-clahe           disable CLAHE enhancement
--no-sharpen         disable edge sharpening
--dither <0|1|2>     0=none 1=floyd-steinberg 2=atkinson
--max-cols <n>       cap terminal columns
--max-rows <n>       cap terminal rows
-h, --help           show help
-v, --version        show version
```

## how it works

1. **OpenCV** `VideoCapture` decodes frames natively — no ffmpeg pipe overhead
2. Each frame is preprocessed: CLAHE contrast enhancement on the L channel (LAB colorspace), then Sobel edge detection drives an adaptive sharpening blend
3. Frames are rendered as halfblock characters (`▀`) with 24-bit truecolor — top pixel = fg color, bottom pixel = bg color — doubling effective vertical resolution
4. A background decoder thread feeds a lock-free `FrameQueue` (cap 32); the render thread paces output to PTS timestamps via `std::chrono::steady_clock`
5. **ffplay** plays audio in a child process; `SIGSTOP`/`SIGCONT` pause/resume it in sync with the render loop

## tips

- Zoom out in your terminal (`Ctrl+−`) for more pixels on screen
- Pixel art and 8-bit videos look especially crisp
- JJK openings look insane:
  ```bash
  ./build/aniterm "https://youtube.com/watch?v=NbdM922nITE"
  ```

## license

MIT

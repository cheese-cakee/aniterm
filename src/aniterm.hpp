#pragma once

#include <opencv2/opencv.hpp>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// ─── ANSI helpers ────────────────────────────────────────────────────────────
static constexpr const char* RESET   = "\x1b[0m";
static constexpr const char* HIDE_CURSOR = "\x1b[?25l";
static constexpr const char* SHOW_CURSOR = "\x1b[?25h";
static constexpr const char* CLEAR_SCREEN = "\x1b[2J";
static constexpr const char* HOME    = "\x1b[H";
static constexpr const char* RED     = "\x1b[31m";
static constexpr const char* DIM     = "\x1b[2m";

// ─── Terminal size ────────────────────────────────────────────────────────────
struct TermSize { int cols, rows; };
TermSize get_term_size();

// ─── Renderer ─────────────────────────────────────────────────────────────────
struct RenderOptions {
    int    width          = 0;
    int    height         = 0;
    double contrast       = 1.2;
    double brightness     = 0.0;
    double gamma          = 0.9;
    bool   use_clahe      = true;
    bool   edge_sharpen   = true;
    // dither: 0=none, 1=floyd, 2=atkinson
    int    dither         = 1;
    double target_fps     = 0.0;
};

// Render one frame to a string of ANSI escape codes.
// frame must be BGR, already resized to (width x height*2).
std::string render_frame(const cv::Mat& frame, const RenderOptions& opts);

// ─── Frame queue ──────────────────────────────────────────────────────────────
struct FrameEntry {
    cv::Mat  mat;      // BGR, already resized
    double   pts;      // presentation timestamp in seconds
};

class FrameQueue {
public:
    explicit FrameQueue(int capacity = 32);
    void push(FrameEntry entry);
    bool pop(FrameEntry& out);   // returns false if done and empty
    void mark_done();
    void clear();
    bool is_done() const;
    int  size() const;
private:
    std::deque<FrameEntry>      q_;
    mutable std::mutex          mu_;
    std::condition_variable     cv_push_, cv_pop_;
    int                         cap_;
    std::atomic<bool>           done_{false};
};

// ─── Audio ────────────────────────────────────────────────────────────────────
struct AudioHandle {
    pid_t pid = -1;
    void stop();
    void toggle_pause();
};
AudioHandle play_audio(const std::string& path);

// ─── yt-dlp ───────────────────────────────────────────────────────────────────
// Returns a real file path (may download to /tmp). Empty on failure.
std::string resolve_source(const std::string& input);

// ─── Player ───────────────────────────────────────────────────────────────────
struct QueueItem {
    std::string source;
    std::string label;
};

struct PlayOptions {
    RenderOptions render;
    bool no_audio = false;
    int  max_cols = 0;
    int  max_rows = 0;
};

// Returns "quit", "replay", or "next"
std::string play_one(const QueueItem& item,
                     std::vector<QueueItem>& queue,
                     const PlayOptions& opts);

void play_queue(std::vector<QueueItem>& queue, const PlayOptions& opts);
